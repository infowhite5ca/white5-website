const ZOHO_TOKEN_URL = "https://accounts.zohocloud.ca/oauth/v2/token";
const ZOHO_MAIL_API = "https://mail.zohocloud.ca/api";
const WHITE5_EMAIL = "info@white5.ca";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function clean(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function validateAdmin(request, env, allowedMethods) {
  if (!allowedMethods.includes(request.method)) {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  if (!env.ADMIN_API_KEY) {
    return json({ ok: false, error: "ADMIN_API_KEY is not configured" }, 500);
  }
  if (request.headers.get("x-admin-key") !== env.ADMIN_API_KEY) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const required = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) {
    return json({ ok: false, error: "Missing Cloudflare secrets", missing }, 500);
  }
  return null;
}

async function getAccessToken(env) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    refresh_token: env.ZOHO_REFRESH_TOKEN,
  });

  const response = await fetch(ZOHO_TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) {
    throw new Error(`Zoho token refresh failed: ${result.error || response.status}`);
  }
  return result.access_token;
}

function allAddresses(account) {
  const addresses = [
    account.primaryEmailAddress,
    account.mailboxAddress,
    account.incomingUserName,
  ];
  if (Array.isArray(account.emailAddress)) {
    for (const item of account.emailAddress) addresses.push(item?.mailId);
  }
  if (Array.isArray(account.sendMailDetails)) {
    for (const item of account.sendMailDetails) {
      if (item?.status !== false) addresses.push(item?.fromAddress);
    }
  }
  return [...new Set(addresses.map((value) => clean(value, 320)).filter(Boolean))];
}

async function getMailAccount(accessToken) {
  const response = await fetch(`${ZOHO_MAIL_API}/accounts`, {
    headers: {
      accept: "application/json",
      authorization: `Zoho-oauthtoken ${accessToken}`,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Zoho account lookup failed: ${result?.status?.description || response.status}`);
  }

  const accounts = Array.isArray(result.data) ? result.data : [];
  const target = WHITE5_EMAIL.toLowerCase();
  const account = accounts.find((item) =>
    allAddresses(item).some((address) => address.toLowerCase() === target),
  );
  if (!account?.accountId) {
    throw new Error(`Zoho account lookup failed: ${WHITE5_EMAIL} was not found`);
  }

  const addresses = allAddresses(account);
  const sender = addresses.find((address) => address.toLowerCase() === "website@white5.ca")
    || addresses.find((address) => address.toLowerCase() !== target)
    || addresses.find((address) => address.toLowerCase() === target)
    || WHITE5_EMAIL;

  return {
    accountId: String(account.accountId),
    sender,
    addresses,
  };
}

async function sendTestMessage(accessToken, account) {
  const payload = {
    fromAddress: account.sender,
    toAddress: WHITE5_EMAIL,
    subject: `White5 Zoho API test — ${new Date().toISOString()}`,
    content: "<p>This test email was sent automatically from the White5 Cloudflare Worker through the Zoho Mail API.</p>",
    mailFormat: "html",
    encoding: "UTF-8",
  };

  const response = await fetch(`${ZOHO_MAIL_API}/accounts/${encodeURIComponent(account.accountId)}/messages`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Zoho-oauthtoken ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  const statusCode = Number(result?.status?.code || 0);
  const messageId = clean(result?.data?.messageId || "", 200);
  if (!response.ok || statusCode !== 200 || !messageId) {
    const description = clean(result?.status?.description || result?.data?.moreInfo || "", 500);
    throw new Error(`Zoho send failed: HTTP ${response.status}; API ${statusCode || "missing"}; ${description || "missing messageId"}`);
  }
  return messageId;
}

export async function handleZohoStatus(request, env) {
  const validation = validateAdmin(request, env, ["GET"]);
  if (validation) return validation;

  try {
    const accessToken = await getAccessToken(env);
    const account = await getMailAccount(accessToken);
    return json({
      ok: true,
      tokenRefresh: true,
      accountFound: true,
      accountIdEnding: account.accountId.slice(-6),
      sender: account.sender,
      availableAddresses: account.addresses,
      recipient: WHITE5_EMAIL,
    });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, 502);
  }
}

export async function handleZohoTestSend(request, env) {
  const validation = validateAdmin(request, env, ["POST"]);
  if (validation) return validation;

  try {
    const accessToken = await getAccessToken(env);
    const account = await getMailAccount(accessToken);
    const messageId = await sendTestMessage(accessToken, account);
    return json({
      ok: true,
      messageId,
      sender: account.sender,
      recipient: WHITE5_EMAIL,
    });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, 502);
  }
}
