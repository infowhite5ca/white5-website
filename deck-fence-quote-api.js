const MAX_FILES = 5;
const MAX_FILE_BYTES = 800_000;
const MAX_TOTAL_BYTES = 3_200_000;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

async function verifyTurnstile(token, request, env) {
  if (!env.TURNSTILE_SECRET_KEY) {
    return { success: false, configurationError: true };
  }

  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
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

function buildText(fields) {
  return [
    "New Deck / Fence Quote Request",
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
    `Additional notes: ${fields.notes || "None"}`,
    "",
    `Submitted: ${new Date().toISOString()}`,
  ].join("\n");
}

function buildHtml(fields) {
  const row = (label, value) => `<tr><th style="padding:8px 12px;text-align:left;background:#eef7ff;border:1px solid #d6e5ef">${escapeHtml(label)}</th><td style="padding:8px 12px;border:1px solid #d6e5ef">${escapeHtml(value || "Not provided")}</td></tr>`;
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0b1f33"><h2>New Deck / Fence Quote Request</h2><table style="border-collapse:collapse;width:100%;max-width:760px">${row("Name", fields.name)}${row("Phone", fields.phone)}${row("Email", fields.email)}${row("Preferred contact", fields.preferredContact)}${row("Project type", fields.projectType)}${row("Services", fields.services.join(", "))}${row("Project size", fields.projectSize)}${row("Approx. square footage", fields.squareFootage)}${row("Desired start", fields.desiredStart)}${row("Budget", fields.budget)}${row("Street address", fields.streetAddress)}${row("City", fields.city)}${row("Postal code", fields.postalCode)}${row("Additional notes", fields.notes)}${row("Submitted", new Date().toISOString())}</table></body></html>`;
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

  if (!env.EMAIL_SERVICE) {
    return json({ ok: false, error: "Email service is not configured" }, 503);
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
  const attachments = [];
  for (const [index, file] of files.entries()) {
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
    attachments.push({
      content: arrayBufferToBase64(await file.arrayBuffer()),
      filename: clean(file.name, 120) || `project-photo-${index + 1}.jpg`,
      type: file.type,
    });
  }

  try {
    const response = await env.EMAIL_SERVICE.fetch("https://email-service.internal/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject: `Deck/Fence Quote — ${fields.projectType} — ${fields.name}`,
        text: buildText(fields),
        html: buildHtml(fields),
        replyTo: fields.email || "",
        attachments,
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) {
      throw new Error(result.error || `Email service returned ${response.status}`);
    }

    return json({ ok: true, messageId: result.messageId || "" });
  } catch (error) {
    console.error("Deck/fence quote email failed", error);
    return json({ ok: false, error: "We could not send your request. Please call 403-479-3905." }, 502);
  }
}

export function handleDeckFenceConfig(request, env) {
  if (request.method !== "GET") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  return json({
    ok: Boolean(env.TURNSTILE_SITE_KEY),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
  }, env.TURNSTILE_SITE_KEY ? 200 : 503);
}
