const MAX_FILES = 5;
const MAX_FILE_BYTES = 800_000;
const MAX_TOTAL_BYTES = 3_200_000;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";
const ZOHO_TOKEN_URL = "https://accounts.zohocloud.ca/oauth/v2/token";
const ZOHO_MAIL_API = "https://mail.zohocloud.ca/api";
const WHITE5_EMAIL = "info@white5.ca";

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

function escapeHtml(value) {
  return clean(value, 5000)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function listValues(formData, name) {
  return formData.getAll(name).map((value) => clean(value, 100)).filter(Boolean);
}

function isPreviewRequest(request) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname.endsWith(".white5-website.pages.dev") && hostname !== "white5-website.pages.dev";
}

async function verifyTurnstile(token, request, env) {
  const secret = isPreviewRequest(request)
    ? TURNSTILE_TEST_SECRET_KEY
    : env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    return { success: false, configurationError: true };
  }

  const body = new URLSearchParams({
    secret,
    response: token,
  });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) body.set("remoteip", ip);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) return { success: false };
  return response.json();
}

function buildHtml(fields) {
  const row = (label, value) => `<tr><th style="padding:8px 12px;text-align:left;background:#eef7ff;border:1px solid #d6e5ef">${escapeHtml(label)}</th><td style="padding:8px 12px;border:1px solid #d6e5ef">${escapeHtml(value || "Not provided")}</td></tr>`;
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0b1f33"><h2>New Deck / Fence Quote Request</h2><table style="border-collapse:collapse;width:100%;max-width:760px">${row("Name", fields.name)}${row("Phone", fields.phone)}${row("Email", fields.email)}${row("Preferred contact", fields.preferredContact)}${row("Project type", fields.projectType)}${row("Services", fields.services.join(", "))}${row("Project size", fields.projectSize)}${row("Approx. square footage", fields.squareFootage)}${row("Desired start", fields.desiredStart)}${row("Budget", fields.budget)}${row("Street address", fields.streetAddress)}${row("City", fields.city)}${row("Postal code", fields.postalCode)}${row("Additional notes", fields.notes)}${row("Submitted", new Date().toISOString())}</table></body></html>`;
}

function hasRequiredZohoSecrets(env) {
  return Boolean(env.ZOHO_CLIENT_ID && env.ZOHO_CLIENT_SECRET && env.ZOHO_REFRESH_TOKEN);
}

async function getZohoAccessToken(env) {
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

function accountContainsAddress(account, address) {
  const target = address.toLowerCase();
  const direct = [
    account.primaryEmailAddress,
    account.mailboxAddress,
    account.incomingUserName,
  ].filter(Boolean).map((value) => String(value).toLowerCase());

  const emailAddresses = Array.isArray(account.emailAddress)
    ? account.emailAddress.map((item) => String(item?.mailId || "").toLowerCase())
    : [];
  const sendAddresses = Array.isArray(account.sendMailDetails)
    ? account.sendMailDetails.map((item) => String(item?.fromAddress || "").toLowerCase())
    : [];

  return [...direct, ...emailAddresses, ...sendAddresses].includes(target);
}

async function getZohoMailAccount(accessToken) {
  const response = await fetch(`${ZOHO_MAIL_API}/accounts`, {
    headers: {
      accept: "application/json",
      authorization: `Zoho-oauthtoken ${accessToken}`,
    },
  });
  const result = await response.json().catch(() => ({}));
  const accounts = Array.isArray(result.data) ? result.data : [];
  const account = accounts.find((item) => accountContainsAddress(item, WHITE5_EMAIL));

  if (!response.ok || !account?.accountId) {
    throw new Error(`Zoho account lookup failed: ${result?.status?.description || response.status}`);
  }

  return {
    accountId: String(account.accountId),
    fromAddress: WHITE5_EMAIL,
  };
}

async function uploadZohoAttachment(accessToken, accountId, file, fallbackName) {
  const fileName = clean(file.name, 120) || fallbackName;
  const url = `${ZOHO_MAIL_API}/accounts/${encodeURIComponent(accountId)}/messages/attachments?fileName=${encodeURIComponent(fileName)}&isInline=false`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Zoho-oauthtoken ${accessToken}`,
      "content-type": file.type || "application/octet-stream",
    },
    body: file,
  });
  const result = await response.json().catch(() => ({}));
  const data = result.data;

  if (!response.ok || !data?.storeName || !data?.attachmentPath || !data?.attachmentName) {
    throw new Error(`Zoho attachment upload failed: ${result?.status?.description || response.status}`);
  }

  return {
    storeName: data.storeName,
    attachmentPath: data.attachmentPath,
    attachmentName: data.attachmentName,
  };
}

async function sendZohoMail(accessToken, account, fields, files) {
  const attachments = [];
  for (const [index, file] of files.entries()) {
    attachments.push(await uploadZohoAttachment(
      accessToken,
      account.accountId,
      file,
      `project-photo-${index + 1}.jpg`,
    ));
  }

  const payload = {
    fromAddress: account.fromAddress,
    toAddress: WHITE5_EMAIL,
    subject: `Deck/Fence Quote — ${fields.projectType} — ${fields.name}`,
    content: buildHtml(fields),
    mailFormat: "html",
    encoding: "UTF-8",
  };
  if (attachments.length) payload.attachments = attachments;

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
  const zohoStatus = Number(result?.status?.code || 0);
  const messageId = clean(result?.data?.messageId || "", 200);
  const description = clean(result?.status?.description || "", 500);
  const moreInfo = clean(result?.data?.moreInfo || "", 500);

  if (!response.ok || zohoStatus !== 200 || !messageId) {
    throw new Error(
      `Zoho send failed: HTTP ${response.status}; API ${zohoStatus || "missing"}; ${description || moreInfo || "missing messageId"}`,
    );
  }

  return result;
}

export async function handleDeckFenceQuote(request, env) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) {
    return json({ ok: false, error: "Invalid origin" }, 403);
  }

  if (!hasRequiredZohoSecrets(env)) {
    return json({ ok: false, error: "Zoho Mail is not configured" }, 503);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: "Invalid form submission" }, 400);
  }

  if (clean(formData.get("company"), 100)) {
    return json({ ok: true });
  }

  const turnstileToken = clean(formData.get("turnstileToken"), 4096);
  const turnstile = await verifyTurnstile(turnstileToken, request, env);
  if (turnstile.configurationError) {
    return json({ ok: false, error: "Spam protection is not configured" }, 503);
  }
  if (!turnstile.success) {
    return json({ ok: false, error: "Spam protection check failed. Please try again." }, 400);
  }

  const fields = {
    name: clean(formData.get("name"), 120),
    phone: clean(formData.get("phone"), 50),
    email: clean(formData.get("email"), 160),
    preferredContact: clean(formData.get("preferredContact"), 40),
    projectType: clean(formData.get("projectType"), 40),
    services: listValues(formData, "services"),
    projectSize: clean(formData.get("projectSize"), 40),
    squareFootage: clean(formData.get("squareFootage"), 30),
    desiredStart: clean(formData.get("desiredStart"), 50),
    budget: clean(formData.get("budget"), 50),
    streetAddress: clean(formData.get("streetAddress"), 200),
    city: clean(formData.get("city"), 100),
    postalCode: clean(formData.get("postalCode"), 20),
    notes: clean(formData.get("notes"), 2000),
  };

  const required = [
    ["name", fields.name],
    ["phone", fields.phone],
    ["preferred contact", fields.preferredContact],
    ["project type", fields.projectType],
    ["project size", fields.projectSize],
    ["desired start", fields.desiredStart],
    ["budget", fields.budget],
    ["street address", fields.streetAddress],
    ["city", fields.city],
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (!fields.services.length) missing.push("services");
  if (fields.preferredContact === "Email" && !fields.email) missing.push("email");
  if (missing.length) {
    return json({ ok: false, error: `Missing required fields: ${missing.join(", ")}` }, 400);
  }

  const files = formData.getAll("photos").filter((item) => item instanceof File && item.size > 0);
  if (files.length > MAX_FILES) {
    return json({ ok: false, error: `Please upload no more than ${MAX_FILES} photos.` }, 400);
  }

  let totalBytes = 0;
  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return json({ ok: false, error: "Photos must be JPG, PNG, or WebP." }, 400);
    }
    if (file.size > MAX_FILE_BYTES) {
      return json({ ok: false, error: "One of the photos is too large. Please try a smaller image." }, 400);
    }
    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      return json({ ok: false, error: "The combined photo size is too large." }, 400);
    }
  }

  try {
    const accessToken = await getZohoAccessToken(env);
    const account = await getZohoMailAccount(accessToken);
    const result = await sendZohoMail(accessToken, account, fields, files);
    return json({ ok: true, messageId: clean(result?.data?.messageId || "", 200) });
  } catch (error) {
    console.error("Deck/fence quote Zoho email failed", error);
    const diagnostic = error instanceof Error ? error.message : String(error);
    return json({
      ok: false,
      error: isPreviewRequest(request)
        ? diagnostic
        : "We could not send your request. Please call 403-479-3905.",
    }, 502);
  }
}

export function handleDeckFenceConfig(request, env) {
  if (request.method !== "GET") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const siteKey = isPreviewRequest(request)
    ? TURNSTILE_TEST_SITE_KEY
    : env.TURNSTILE_SITE_KEY;

  return json({
    ok: Boolean(siteKey),
    turnstileSiteKey: siteKey || "",
  }, siteKey ? 200 : 503);
}
