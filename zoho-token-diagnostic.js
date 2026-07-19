const ZOHO_TOKEN_URL = "https://accounts.zohocloud.ca/oauth/v2/token";
const ZOHO_MAIL_ACCOUNTS_URL = "https://mail.zohocloud.ca/api/accounts";
const EXPECTED_SCOPES = [
  "ZohoMail.accounts.READ",
  "ZohoMail.folders.READ",
  "ZohoMail.messages.READ",
  "ZohoMail.messages.CREATE",
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function clean(value, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function validate(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!env.ADMIN_API_KEY) return json({ ok: false, error: "ADMIN_API_KEY is not configured" }, 500);
  if (request.headers.get("x-admin-key") !== env.ADMIN_API_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

  const required = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) return json({ ok: false, error: "Missing Cloudflare secrets", missing }, 500);
  return null;
}

function parseScopes(value) {
  return [...new Set(String(value || "")
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean))];
}

export async function handleZohoTokenDiagnostic(request, env) {
  const validation = validate(request, env);
  if (validation) return validation;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    refresh_token: env.ZOHO_REFRESH_TOKEN,
  });

  const tokenResponse = await fetch(ZOHO_TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const tokenResult = await tokenResponse.json().catch(() => ({}));

  if (!tokenResponse.ok || !tokenResult.access_token) {
    return json({
      ok: false,
      stage: "refresh_token",
      tokenRefreshOk: false,
      httpStatus: tokenResponse.status,
      error: clean(tokenResult.error || tokenResult.error_description || "Zoho did not return an access token", 500),
      secretsExposed: false,
    }, tokenResponse.status || 502);
  }

  const grantedScopes = parseScopes(tokenResult.scope);
  const missingScopes = tokenResult.scope
    ? EXPECTED_SCOPES.filter((scope) => !grantedScopes.includes(scope))
    : [];

  const accountsResponse = await fetch(ZOHO_MAIL_ACCOUNTS_URL, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Zoho-oauthtoken ${tokenResult.access_token}`,
    },
  });
  const accountsResult = await accountsResponse.json().catch(() => ({}));
  const description = clean(
    accountsResult?.status?.description
      || accountsResult?.data?.moreInfo
      || accountsResult?.error?.message
      || accountsResult?.message
      || "",
    700,
  );

  return json({
    ok: true,
    tokenRefreshOk: true,
    tokenMetadata: {
      scopeReportedByZoho: Boolean(tokenResult.scope),
      grantedScopes,
      expectedScopes: EXPECTED_SCOPES,
      missingScopes,
      apiDomain: clean(tokenResult.api_domain, 300) || null,
      location: clean(tokenResult.location, 100) || null,
      tokenType: clean(tokenResult.token_type, 100) || null,
      expiresIn: Number(tokenResult.expires_in) || null,
    },
    accountsTest: {
      endpoint: ZOHO_MAIL_ACCOUNTS_URL,
      httpStatus: accountsResponse.status,
      authorized: accountsResponse.ok && Number(accountsResult?.status?.code || 200) === 200,
      apiCode: Number(accountsResult?.status?.code || 0) || null,
      description: description || null,
    },
    interpretation: accountsResponse.ok
      ? "The current Cloudflare refresh token can access Zoho Mail accounts."
      : tokenResult.scope && missingScopes.length
        ? "Zoho reports that the current refresh token is missing one or more required scopes."
        : "The refresh token works, but Zoho Mail rejected the generated access token. Use this result to identify whether the issue is scope or data-center authorization.",
    secretsExposed: false,
    changedAnything: false,
  });
}
