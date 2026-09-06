const ZOHO_TOKEN_URL = "https://accounts.zohocloud.ca/oauth/v2/token";
const ZOHO_MAIL_API = "https://mail.zohocloud.ca/api";
const RECIPIENT = "info@white5.ca";
const MAX_BODY_BYTES = 25_000;
const MAX_PHOTO_BODY_BYTES = 3_250_000;
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 800_000;
const MAX_TOTAL_PHOTO_BYTES = 3_200_000;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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

export function handleServiceRequestConfig(request, env) {
  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
  const key = env.TURNSTILE_SITE_KEY;
  return json({ ok: Boolean(key), turnstileSiteKey: key || "" }, key ? 200 : 503);
}

async function readLimitedBody(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RangeError("Request is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function isImageFile(file) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (file.type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.type === "image/png") return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (file.type === "image/webp") return [82, 73, 70, 70].every((value, index) => bytes[index] === value)
    && [87, 69, 66, 80].every((value, index) => bytes[index + 8] === value);
  return false;
}

async function uploadPhoto(accessToken, accountId, file, index) {
  const safeName = (clean(file.name, 120) || `window-photo-${index + 1}.jpg`).replace(/[^a-zA-Z0-9._-]/g, "-");
  const form = new FormData();
  form.append("attach", file, safeName);
  const response = await fetch(`${ZOHO_MAIL_API}/accounts/${encodeURIComponent(accountId)}/messages/attachments?uploadType=multipart&isInline=false`, {
    method: "POST",
    headers: { authorization: `Zoho-oauthtoken ${accessToken}` },
    body: form,
  });
  const result = await response.json().catch(() => ({}));
  const attachment = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!response.ok || !attachment?.storeName || !attachment?.attachmentPath || !attachment?.attachmentName) {
    throw new Error(`Zoho photo upload failed: ${clean(result?.status?.description || response.status, 200)}`);
  }
  return { storeName: attachment.storeName, attachmentPath: attachment.attachmentPath, attachmentName: attachment.attachmentName };
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
    fields.estimate === null ? "Personal estimate requested — no price has been calculated." : `Estimated starting price: $${fields.estimate}`,
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

async function sendLead(accessToken, account, fields, requestId, photos) {
  const payload = {
    fromAddress: account.sender,
    toAddress: RECIPIENT,
    subject: `NEW WEBSITE LEAD - ${fields.name}`,
    content: buildMessage(fields, requestId),
    mailFormat: "plaintext",
    encoding: "UTF-8",
  };
  if (photos.length) {
    payload.attachments = [];
    for (const [index, file] of photos.entries()) {
      payload.attachments.push(await uploadPhoto(accessToken, account.accountId, file, index));
    }
  }
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
  const contentType = request.headers.get("content-type") || "";
  const multipart = contentType.toLowerCase().startsWith("multipart/form-data");
  const bodyLimit = multipart ? MAX_PHOTO_BODY_BYTES : MAX_BODY_BYTES;
  if (contentLength > bodyLimit) return json({ ok: false, error: "Request is too large" }, 413);

  const requiredSecrets = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "TURNSTILE_SECRET_KEY"];
  if (requiredSecrets.some((name) => !env[name])) {
    return json({ ok: false, error: "Service request delivery is not configured" }, 503);
  }

  let payload;
  let photos = [];
  try {
    const bytes = await readLimitedBody(request, bodyLimit);
    if (multipart) {
      const form = await new Response(bytes, { headers: { "content-type": contentType } }).formData();
      payload = Object.fromEntries(form);
      payload.services = form.getAll("services");
      payload.consent = form.get("consent") === "yes";
      photos = form.getAll("photos").filter((item) => item instanceof File && item.size > 0);
    } else {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid payload");
  } catch (error) {
    if (error instanceof RangeError) return json({ ok: false, error: "Request is too large" }, 413);
    return json({ ok: false, error: "Invalid request" }, 400);
  }

  if (clean(payload.website, 200)) return json({ ok: true });
  if (payload.consent !== true) return json({ ok: false, error: "Contact consent is required." }, 400);

  let turnstile;
  try {
    turnstile = await verifyTurnstile(clean(payload.turnstileToken, 4096), request, env);
  } catch {
    return json({ ok: false, error: "Spam protection is temporarily unavailable. Please try again." }, 503);
  }
  if (turnstile.configurationError) return json({ ok: false, error: "Spam protection is not configured" }, 503);
  if (!turnstile.success) return json({ ok: false, error: "Spam protection check failed. Please try again." }, 400);

  const services = Array.isArray(payload.services)
    ? payload.services.map((value) => clean(value, 100)).filter(Boolean).slice(0, 10)
    : [];
  const estimateValue = payload.estimate === undefined || payload.estimate === null || payload.estimate === ""
    ? NaN : Number(payload.estimate);
  const fields = {
    name: clean(payload.name, 120),
    address: clean(payload.address, 240),
    email: clean(payload.email, 160),
    phone: clean(payload.phone, 50),
    notes: clean(payload.notes, 2000),
    services,
    estimate: Number.isFinite(estimateValue) ? Math.max(0, Math.min(estimateValue, 100000)) : null,
    details: clean(payload.details, 5000),
  };

  if (!fields.name || !fields.address || (!fields.email && !fields.phone) || !fields.services.length) {
    return json({ ok: false, error: "Please complete your name, address, contact information, and service details." }, 400);
  }

  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) {
    return json({ ok: false, error: "Please enter a valid email address." }, 400);
  }
  if (photos.length > MAX_PHOTOS) return json({ ok: false, error: "Please select no more than 5 photos." }, 400);
  let photoBytes = 0;
  for (const file of photos) {
    if (!PHOTO_TYPES.has(file.type) || !(await isImageFile(file))) return json({ ok: false, error: "Photos must be valid JPG, PNG or WebP images." }, 400);
    if (file.size > MAX_PHOTO_BYTES) return json({ ok: false, error: "One photo is too large. Please choose a smaller image." }, 400);
    photoBytes += file.size;
  }
  if (photoBytes > MAX_TOTAL_PHOTO_BYTES) return json({ ok: false, error: "The combined photo size is too large." }, 400);

  const requestId = crypto.randomUUID();
  try {
    const accessToken = await getAccessToken(env);
    const account = await getMailAccount(accessToken);
    const messageId = await sendLead(accessToken, account, fields, requestId, photos);
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
