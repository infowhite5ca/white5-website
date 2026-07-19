const ZOHO_TOKEN_URL = "https://accounts.zohocloud.ca/oauth/v2/token";
const ZOHO_MAIL_API = "https://mail.zohocloud.ca/api";
const RECIPIENT = "info@white5.ca";
const TEST_SECRET = atob("MXgwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDBBQQ==");
const MAX_FILES = 5;
const MAX_FILE_BYTES = 800000;
const MAX_TOTAL_BYTES = 3200000;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function text(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

function isPreview(request) {
  const host = new URL(request.url).hostname.toLowerCase();
  return host.endsWith(".white5-website.pages.dev") && host !== "white5-website.pages.dev";
}

async function verifyTurnstile(token, request, env) {
  const secret = isPreview(request) ? TEST_SECRET : env.TURNSTILE_SECRET_KEY;
  if (!secret) return false;
  const body = new URLSearchParams({ secret, response: token });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) body.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const result = await response.json().catch(() => ({}));
  return response.ok && result.success === true;
}

async function accessToken(env) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    refresh_token: env.ZOHO_REFRESH_TOKEN,
  });
  const response = await fetch(ZOHO_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) throw new Error(`Zoho token failed: ${result.error || response.status}`);
  return result.access_token;
}

function addresses(account) {
  const values = [account.primaryEmailAddress, account.mailboxAddress, account.incomingUserName];
  if (Array.isArray(account.emailAddress)) for (const item of account.emailAddress) values.push(item?.mailId);
  if (Array.isArray(account.sendMailDetails)) for (const item of account.sendMailDetails) if (item?.status !== false) values.push(item?.fromAddress);
  return [...new Set(values.map((value) => text(value, 320)).filter(Boolean))];
}

async function mailAccount(token) {
  const response = await fetch(`${ZOHO_MAIL_API}/accounts`, {
    headers: { authorization: `Zoho-oauthtoken ${token}` },
  });
  const result = await response.json().catch(() => ({}));
  const target = RECIPIENT.toLowerCase();
  const account = (Array.isArray(result.data) ? result.data : []).find((item) =>
    addresses(item).some((address) => address.toLowerCase() === target),
  );
  if (!response.ok || !account?.accountId) throw new Error(`Zoho account failed: ${result?.status?.description || response.status}`);
  const available = addresses(account);
  const sender = available.find((address) => address.toLowerCase() === "website@white5.ca")
    || available.find((address) => address.toLowerCase() === "info.white5.ca@gmail.com")
    || available.find((address) => address.toLowerCase() !== target)
    || RECIPIENT;
  return { accountId: String(account.accountId), sender };
}

function safeName(file, index) {
  return (text(file.name, 120) || `project-photo-${index + 1}.jpg`).replace(/[^a-zA-Z0-9._-]/g, "-");
}

async function uploadPhoto(token, accountId, file, index) {
  const form = new FormData();
  form.append("attach", file, safeName(file, index));
  const response = await fetch(`${ZOHO_MAIL_API}/accounts/${encodeURIComponent(accountId)}/messages/attachments?uploadType=multipart&isInline=false`, {
    method: "POST",
    headers: { authorization: `Zoho-oauthtoken ${token}` },
    body: form,
  });
  const raw = await response.text();
  let result = {};
  try { result = JSON.parse(raw); } catch {}
  const data = Array.isArray(result?.data) ? result.data[0] : result?.data;
  if (!response.ok || !data?.storeName || !data?.attachmentPath || !data?.attachmentName) {
    throw new Error(`Zoho attachment upload failed: HTTP ${response.status}; ${text(result?.status?.description || raw, 700)}`);
  }
  return { storeName: data.storeName, attachmentPath: data.attachmentPath, attachmentName: data.attachmentName };
}

function message(fields) {
  return [
    "NEW WHITE5 WEBSITE LEAD", "",
    `Name: ${fields.name}`, `Phone: ${fields.phone}`, `Email: ${fields.email || "Not provided"}`,
    `Preferred contact: ${fields.preferredContact}`, "",
    `Project type: ${fields.projectType}`, `Services: ${fields.services.join(", ")}`,
    `Project size: ${fields.projectSize}`, `Approx. square footage: ${fields.squareFootage || "Not provided"}`,
    `Desired start: ${fields.desiredStart}`, `Budget: ${fields.budget}`, "",
    `Street address: ${fields.streetAddress}`, `City: ${fields.city}`,
    `Postal code: ${fields.postalCode || "Not provided"}`, "", "Additional notes:",
    fields.notes || "Not provided", "", `Submitted: ${new Date().toISOString()}`,
  ].join("\n");
}

export async function handleDeckFenceQuoteV7(request, env) {
  if (request.method !== "POST") return reply({ ok: false, error: "Method not allowed" }, 405);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return reply({ ok: false, error: "Invalid origin" }, 403);
  if (!env.ZOHO_CLIENT_ID || !env.ZOHO_CLIENT_SECRET || !env.ZOHO_REFRESH_TOKEN) return reply({ ok: false, error: "Zoho Mail is not configured" }, 503);

  let form;
  try { form = await request.formData(); } catch { return reply({ ok: false, error: "Invalid form submission" }, 400); }
  if (!(await verifyTurnstile(text(form.get("turnstileToken"), 4096), request, env))) return reply({ ok: false, error: "Spam protection check failed. Please try again." }, 400);

  const fields = {
    name: text(form.get("name"), 120), phone: text(form.get("phone"), 50), email: text(form.get("email"), 160),
    preferredContact: text(form.get("preferredContact"), 80), projectType: text(form.get("projectType"), 40),
    services: form.getAll("services").map((value) => text(value, 100)).filter(Boolean), projectSize: text(form.get("projectSize"), 40),
    squareFootage: text(form.get("squareFootage"), 30), desiredStart: text(form.get("desiredStart"), 50), budget: text(form.get("budget"), 50),
    streetAddress: text(form.get("streetAddress"), 200), city: text(form.get("city"), 100), postalCode: text(form.get("postalCode"), 20), notes: text(form.get("notes"), 2000),
  };
  const required = [fields.name, fields.phone, fields.preferredContact, fields.projectType, fields.projectSize, fields.desiredStart, fields.budget, fields.streetAddress, fields.city];
  if (required.some((value) => !value) || !fields.services.length || (fields.preferredContact === "Email" && !fields.email)) return reply({ ok: false, error: "Please complete all required fields." }, 400);

  const files = form.getAll("photos").filter((item) => item instanceof File && item.size > 0);
  if (files.length > MAX_FILES) return reply({ ok: false, error: `Please upload no more than ${MAX_FILES} photos.` }, 400);
  let total = 0;
  for (const file of files) {
    if (!ALLOWED.has(file.type)) return reply({ ok: false, error: "Photos must be JPG, PNG, or WebP." }, 400);
    if (file.size > MAX_FILE_BYTES) return reply({ ok: false, error: "One of the photos is too large." }, 400);
    total += file.size;
  }
  if (total > MAX_TOTAL_BYTES) return reply({ ok: false, error: "The combined photo size is too large." }, 400);

  try {
    const token = await accessToken(env);
    const account = await mailAccount(token);
    const attachments = [];
    for (const [index, file] of files.entries()) attachments.push(await uploadPhoto(token, account.accountId, file, index));
    const payload = {
      fromAddress: account.sender, toAddress: RECIPIENT,
      subject: `NEW WEBSITE LEAD - ${fields.projectType} - ${fields.name}`,
      content: message(fields), mailFormat: "plaintext", encoding: "UTF-8",
    };
    if (attachments.length) payload.attachments = attachments;
    const response = await fetch(`${ZOHO_MAIL_API}/accounts/${encodeURIComponent(account.accountId)}/messages`, {
      method: "POST",
      headers: { authorization: `Zoho-oauthtoken ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    const messageId = text(result?.data?.messageId, 200);
    if (!response.ok || Number(result?.status?.code || 0) !== 200 || !messageId) throw new Error(`Zoho send failed: ${result?.status?.description || response.status}`);
    return reply({ ok: true, messageId, attachmentCount: isPreview(request) ? files.length : undefined, uploadMethod: isPreview(request) ? "multipart/form-data automatic header" : undefined });
  } catch (error) {
    console.error("Deck/fence quote failed", error);
    return reply({ ok: false, error: isPreview(request) ? String(error?.message || error) : "We could not send your request. Please call 403-479-3905." }, 502);
  }
}
