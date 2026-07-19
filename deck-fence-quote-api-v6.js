const MAX_FILES = 5;
const MAX_FILE_BYTES = 800_000;
const MAX_TOTAL_BYTES = 3_200_000;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";
const ZOHO_TOKEN_URL = "https://accounts.zohocloud.ca/oauth/v2/token";
const ZOHO_MAIL_API = "https://mail.zohocloud.ca/api";
const RECIPIENT = "info@white5.ca";

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
  const secret = isPreviewRequest(request) ? TURNSTILE_TEST_SECRET_KEY : env.TURNSTILE_SECRET_KEY;
  if (!secret) return { success: false, configurationError: true };

  const body = new URLSearchParams({ secret, response: token });
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

function collectAddresses(account) {
  const addresses = [account.primaryEmailAddress, account.mailboxAddress, account.incomingUserName];
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

  const target = RECIPIENT.toLowerCase();
  const accounts = Array.isArray(result.data) ? result.data : [];
  const account = accounts.find((item) =>
    collectAddresses(item).some((address) => address.toLowerCase() === target),
  );
  if (!account?.accountId) {
    throw new Error(`Zoho account lookup failed: ${RECIPIENT} was not found`);
  }

  const addresses = collectAddresses(account);
  const sender = addresses.find((address) => address.toLowerCase() === "website@white5.ca")
    || addresses.find((address) => address.toLowerCase() === "info.white5.ca@gmail.com")
    || addresses.find((address) => address.toLowerCase() !== target)
    || addresses.find((address) => address.toLowerCase() === target)
    || RECIPIENT;

  return { accountId: String(account.accountId), sender };
}

function normalizeFileName(file, index) {
  const source = clean(file.name, 120) || `project-photo-${index + 1}.jpg`;
  return source.replace(/[^a-zA-Z0-9._-]/g, "-");
}

async function uploadOneAttachment(accessToken, accountId, file, index) {
  const fileName = normalizeFileName(file, index);
  const url = `${ZOHO_MAIL_API}/accounts/${encodeURIComponent(accountId)}/messages/attachments?fileName=${encodeURIComponent(fileName)}&isInline=false`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Zoho-oauthtoken ${accessToken}`,
      "content-type": "application/json",
    },
    body: await file.arrayBuffer(),
  });

  const raw = await response.text();
  let result = {};
  try { result = JSON.parse(raw); } catch {}
  const data = result?.data;

  if (!response.ok || !data?.storeName || !data?.attachmentPath || !data?.attachmentName) {
    const description = clean(
      result?.status?.description || result?.data?.moreInfo || raw || `HTTP ${response.status}`,
      700,
    );
    throw new Error(`Zoho attachment upload failed: HTTP ${response.status}; ${description}`);
  }

  return {
    storeName: data.storeName,
    attachmentPath: data.attachmentPath,
    attachmentName: data.attachmentName,
  };
}

async function uploadAttachments(accessToken, accountId, files) {
  const uploaded = [];
  for (const [index, file] of files.entries()) {
    uploaded.push(await uploadOneAttachment(accessToken, accountId, file, index));
  }
  return uploaded;
}

function buildPlainText(fields) {
  return [
    "NEW WHITE5 WEBSITE LEAD",
    "",
    `Name: ${fields.name}`,
    `Phone: ${fields.phone}`,
    `Email: ${fields.email || "Not provided"}`,
    `Preferred contact: ${fields.preferredContact}`,
    "",
    `Project type: ${fields.projectType}`,
    `Services: ${fields.services.join(", ")}`,
    `Project size: ${fields.projectSize}`,
    `Approx. square footage: ${fields.squareFootage || "Not provided"}`,
    `Desired start: ${fields.desiredStart}`,
    `Budget: ${fields.budget}`,
    "",
    `Street address: ${fields.streetAddress}`,
    `City: ${fields.city}`,
    `Postal code: ${fields.postalCode || "Not provided"}`,
    "",
    "Additional notes:",
    fields.notes || "Not provided",
    "",
    `Submitted: ${new Date().toISOString()}`,
  ].join("\n");
}

async function sendLead(accessToken, account, fields, files) {
  const attachments = await uploadAttachments(accessToken, account.accountId, files);
  const payload = {
    fromAddress: account.sender,
    toAddress: RECIPIENT,
    subject: `NEW WEBSITE LEAD - ${fields.projectType} - ${fields.name}`,
    content: buildPlainText(fields),
    mailFormat: "plaintext",
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
  const apiStatus = Number(result?.status?.code || 0);
  const messageId = clean(result?.data?.messageId || "", 200);
  const description = clean(result?.status?.description || result?.data?.moreInfo || "", 500);
  if (!response.ok || apiStatus !== 200 || !messageId) {
    throw new Error(`Zoho send failed: HTTP ${response.status}; API ${apiStatus || "missing"}; ${description || "missing messageId"}`);
  }
  return messageId;
}

export async function handleDeckFenceQuoteV6(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) return json({ ok: false, error: "Invalid origin" }, 403);

  const requiredSecrets = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"];
  const missingSecrets = requiredSecrets.filter((name) => !env[name]);
  if (missingSecrets.length) {
    return json({ ok: false, error: "Zoho Mail is not configured", missing: missingSecrets }, 503);
  }

  let formData;
  try { formData = await request.formData(); }
  catch { return json({ ok: false, error: "Invalid form submission" }, 400); }

  const turnstile = await verifyTurnstile(clean(formData.get("turnstileToken"), 4096), request, env);
  if (turnstile.configurationError) return json({ ok: false, error: "Spam protection is not configured" }, 503);
  if (!turnstile.success) return json({ ok: false, error: "Spam protection check failed. Please try again." }, 400);

  const fields = {
    name: clean(formData.get("name"), 120),
    phone: clean(formData.get("phone"), 50),
    email: clean(formData.get("email"), 160),
    preferredContact: clean(formData.get("preferredContact"), 80),
    projectType: clean(formData.get("projectType"), 40),
    services: formData.getAll("services").map((value) => clean(value, 100)).filter(Boolean),
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
    ["name", fields.name], ["phone", fields.phone], ["preferred contact", fields.preferredContact],
    ["project type", fields.projectType], ["project size", fields.projectSize],
    ["desired start", fields.desiredStart], ["budget", fields.budget],
    ["street address", fields.streetAddress], ["city", fields.city],
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (!fields.services.length) missing.push("services");
  if (fields.preferredContact === "Email" && !fields.email) missing.push("email");
  if (missing.length) return json({ ok: false, error: `Missing required fields: ${missing.join(", ")}` }, 400);

  const files = formData.getAll("photos").filter((item) => item instanceof File && item.size > 0);
  if (files.length > MAX_FILES) return json({ ok: false, error: `Please upload no more than ${MAX_FILES} photos.` }, 400);

  let totalBytes = 0;
  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) return json({ ok: false, error: "Photos must be JPG, PNG, or WebP." }, 400);
    if (file.size > MAX_FILE_BYTES) return json({ ok: false, error: "One of the photos is too large. Please try a smaller image." }, 400);
    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_BYTES) return json({ ok: false, error: "The combined photo size is too large." }, 400);
  }

  try {
    const accessToken = await getAccessToken(env);
    const account = await getMailAccount(accessToken);
    const messageId = await sendLead(accessToken, account, fields, files);
    return json({
      ok: true,
      messageId,
      sender: isPreviewRequest(request) ? account.sender : undefined,
      recipient: isPreviewRequest(request) ? RECIPIENT : undefined,
      attachmentCount: isPreviewRequest(request) ? files.length : undefined,
    });
  } catch (error) {
    console.error("Deck/fence quote Zoho email failed", error);
    return json({
      ok: false,
      error: isPreviewRequest(request)
        ? (error instanceof Error ? error.message : String(error))
        : "We could not send your request. Please call 403-479-3905.",
    }, 502);
  }
}

export function handleDeckFenceConfigV6(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
  const siteKey = isPreviewRequest(request) ? TURNSTILE_TEST_SITE_KEY : env.TURNSTILE_SITE_KEY;
  return json({ ok: Boolean(siteKey), turnstileSiteKey: siteKey || "" }, siteKey ? 200 : 503);
}
