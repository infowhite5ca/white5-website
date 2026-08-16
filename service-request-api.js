const ZOHO_TOKEN_URL = "https://accounts.zohocloud.ca/oauth/v2/token";
const ZOHO_MAIL_API = "https://mail.zohocloud.ca/api";
const RECIPIENT = "info@white5.ca";
const MAX_BODY_BYTES = 25_000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
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

function isPreviewRequest(request) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname.endsWith(".white5-website.pages.dev") && hostname !== "white5-website.pages.dev";
}

async function verifyTurnstile(token, request, env) {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return { success: false, configurationError: true };

  const body = new URLSearchParams({ secret, response: token });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) body.set("remoteip", ip);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const result = await response.json().catch(() => ({}));
  return { success: response.ok && result.success === true };
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
    throw new Error(`Zoho token refresh failed: ${clean(result.error || response.status, 200)}`);
  }
  return result.access_token;
}

function collectAddresses(account) {
  const values = [account.primaryEmailAddress, account.mailboxAddress, account.incomingUserName];
  if (Array.isArray(account.emailAddress)) {
    for (const item of account.emailAddress) values.push(item?.mailId);
  }
  if (Array.isArray(account.sendMailDetails)) {
    for (const item of account.sendMailDetails) {
      if (item?.status !== false) values.push(item?.fromAddress);
    }
  }
  return [...new Set(values.map((value) => clean(value, 320)).filter(Boolean))];
}

async function getMailAccount(accessToken) {
  const response = await fetch(`${ZOHO_MAIL_API}/accounts`, {
    headers: {
      accept: "application/json",
      authorization: `Zoho-oauthtoken ${accessToken}`,
    },
  });
  const result = await response.json().catch(() => ({}));
  const target = RECIPIENT.toLowerCase();
  const account = (Array.isArray(result.data) ? result.data : []).find((item) =>
    collectAddresses(item).some((address) => address.toLowerCase() === target),
  );
  if (!response.ok || !account?.accountId) {
    throw new Error(`Zoho account lookup failed: ${clean(result?.status?.description || response.status, 300)}`);
  }

  const available = collectAddresses(account);
  const sender = available.find((address) => address.toLowerCase() === "website@white5.ca")
    || available.find((address) => address.toLowerCase() !== target)
    || RECIPIENT;
  return { accountId: String(account.accountId), sender };
}

function buildMessage(fields, requestId) {
  return [
    "NEW WHITE5 SERVICE REQUEST",
    "",
    `Request ID: ${requestId}`,
    `Name: ${fields.name}`,
    `Address: ${fields.address}`,
    `Email: ${fields.email || "Not provided"}`,
    `Phone: ${fields.phone || "Not provided"}`,
    "",
    `Services: ${fields.services.join(", ")}`,
    `Estimated starting price: $${fields.estimate}`,
    "",
    "Service details:",
    fields.details,
    "",
    "Customer notes:",
    fields.notes || "Not provided",
    "",
    `Submitted: ${new Date().toISOString()}`,
  ].join("\n");
}

async function sendLead(accessToken, account, fields, requestId) {
  const payload = {
    fromAddress: account.sender,
    toAddress: RECIPIENT,
    subject: `NEW WEBSITE LEAD - ${fields.name}`,
    content: buildMessage(fields, requestId),
    mailFormat: "plaintext",
    encoding: "UTF-8",
  };
  const response = await fetch(
    `${ZOHO_MAIL_API}/accounts/${encodeURIComponent(account.accountId)}/messages`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Zoho-oauthtoken ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  const result = await response.json().catch(() => ({}));
  const messageId = clean(result?.data?.messageId, 200);
  if (!response.ok || Number(result?.status?.code || 0) !== 200 || !messageId) {
    throw new Error(`Zoho send failed: ${clean(result?.status?.description || response.status, 300)}`);
  }
  return messageId;
}

export async function handleServiceRequest(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) return json({ ok: false, error: "Invalid origin" }, 403);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return json({ ok: false, error: "Request is too large" }, 413);

  const requiredSecrets = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "TURNSTILE_SECRET_KEY"];
  if (requiredSecrets.some((name) => !env[name])) {
    return json({ ok: false, error: "Service request delivery is not configured" }, 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request" }, 400);
  }

  if (clean(payload.website, 200)) return json({ ok: true });
  if (payload.consent !== true) return json({ ok: false, error: "Contact consent is required." }, 400);

  const turnstile = await verifyTurnstile(clean(payload.turnstileToken, 4096), request, env);
  if (turnstile.configurationError) return json({ ok: false, error: "Spam protection is not configured" }, 503);
  if (!turnstile.success) return json({ ok: false, error: "Spam protection check failed. Please try again." }, 400);

  const services = Array.isArray(payload.services)
    ? payload.services.map((value) => clean(value, 100)).filter(Boolean).slice(0, 10)
    : [];
  const estimateValue = Number(payload.estimate);
  const fields = {
    name: clean(payload.name, 120),
    address: clean(payload.address, 240),
    email: clean(payload.email, 160),
    phone: clean(payload.phone, 50),
    notes: clean(payload.notes, 2000),
    services,
    estimate: Number.isFinite(estimateValue) ? Math.max(0, Math.min(estimateValue, 100000)) : 0,
    details: clean(payload.details, 5000),
  };

  if (!fields.name || !fields.address || (!fields.email && !fields.phone) || !fields.services.length) {
    return json({ ok: false, error: "Please complete your name, address, contact information, and service details." }, 400);
  }

  const requestId = crypto.randomUUID();
  try {
    const accessToken = await getAccessToken(env);
    const account = await getMailAccount(accessToken);
    const messageId = await sendLead(accessToken, account, fields, requestId);
    console.log(JSON.stringify({
      message: "service_request_sent",
      requestId,
      hasEmail: Boolean(fields.email),
      hasPhone: Boolean(fields.phone),
      serviceCount: fields.services.length,
    }));
    return json({
      ok: true,
      requestId,
      messageId: isPreviewRequest(request) ? messageId : undefined,
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: "service_request_failed",
      requestId,
      error: error instanceof Error ? error.message : String(error),
    }));
    return json({
      ok: false,
      error: isPreviewRequest(request)
        ? (error instanceof Error ? error.message : String(error))
        : "We could not send your request. Please call 403-479-3905.",
    }, 502);
  }
}
