const ZOHO_TOKEN_URL = "https://accounts.zohocloud.ca/oauth/v2/token";
const ZOHO_MAIL_API = "https://mail.zohocloud.ca/api";
const WHITE5_EMAIL = "info@white5.ca";
const TEST_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlqG2kAAAAASUVORK5CYII=";

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

function clean(value, maxLength = 700) {
  return String(value || "").trim().slice(0, maxLength);
}

function validateAdmin(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!env.ADMIN_API_KEY) return json({ ok: false, error: "ADMIN_API_KEY is not configured" }, 500);
  if (request.headers.get("x-admin-key") !== env.ADMIN_API_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

  const required = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) return json({ ok: false, error: "Missing Cloudflare secrets", missing }, 500);
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
  if (!response.ok) throw new Error(`Zoho account lookup failed: ${result?.status?.description || response.status}`);

  const target = WHITE5_EMAIL.toLowerCase();
  const accounts = Array.isArray(result.data) ? result.data : [];
  const account = accounts.find((item) => allAddresses(item).some((address) => address.toLowerCase() === target));
  if (!account?.accountId) throw new Error(`Zoho account lookup failed: ${WHITE5_EMAIL} was not found`);

  const addresses = allAddresses(account);
  const sender = addresses.find((address) => address.toLowerCase() === "website@white5.ca")
    || addresses.find((address) => address.toLowerCase() === "info.white5.ca@gmail.com")
    || addresses.find((address) => address.toLowerCase() !== target)
    || addresses.find((address) => address.toLowerCase() === target)
    || WHITE5_EMAIL;

  return { accountId: String(account.accountId), sender };
}

function pngBytes() {
  const binary = atob(TEST_PNG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function summarizeResult(response, raw, parsed) {
  return {
    httpStatus: response.status,
    ok: response.ok,
    apiCode: parsed?.status?.code || null,
    description: clean(parsed?.status?.description || parsed?.data?.moreInfo || raw || "", 700),
  };
}

function attachmentFrom(parsed) {
  const data = Array.isArray(parsed?.data) ? parsed.data[0] : parsed?.data;
  if (!data?.storeName || !data?.attachmentPath || !data?.attachmentName) return null;
  return {
    storeName: data.storeName,
    attachmentPath: data.attachmentPath,
    attachmentName: data.attachmentName,
  };
}

async function attemptMultipart(accessToken, accountId, bytes, forceJsonHeader) {
  const fileName = `white5-attachment-test-${Date.now()}.png`;
  const form = new FormData();
  form.append("attach", new File([bytes], fileName, { type: "image/png" }), fileName);
  const headers = {
    accept: "application/json",
    authorization: `Zoho-oauthtoken ${accessToken}`,
  };
  if (forceJsonHeader) headers["content-type"] = "application/json";

  const response = await fetch(`${ZOHO_MAIL_API}/accounts/${encodeURIComponent(accountId)}/messages/attachments?uploadType=multipart&isInline=false`, {
    method: "POST",
    headers,
    body: form,
  });
  const raw = await response.text();
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch {}
  return {
    method: forceJsonHeader ? "multipart body + application/json header" : "multipart/form-data automatic header",
    result: summarizeResult(response, raw, parsed),
    attachment: attachmentFrom(parsed),
  };
}

async function attemptRaw(accessToken, accountId, bytes) {
  const fileName = `white5-attachment-test-${Date.now()}.png`;
  const response = await fetch(`${ZOHO_MAIL_API}/accounts/${encodeURIComponent(accountId)}/messages/attachments?fileName=${encodeURIComponent(fileName)}&isInline=false`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Zoho-oauthtoken ${accessToken}`,
      "content-type": "application/json",
    },
    body: bytes,
  });
  const raw = await response.text();
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch {}
  return {
    method: "raw PNG body + application/json header",
    result: summarizeResult(response, raw, parsed),
    attachment: attachmentFrom(parsed),
  };
}

async function sendAttachmentTestEmail(accessToken, account, attachment, method) {
  const payload = {
    fromAddress: account.sender,
    toAddress: WHITE5_EMAIL,
    subject: `White5 Zoho attachment test — ${new Date().toISOString()}`,
    content: `<p>Zoho attachment upload succeeded using: <strong>${method}</strong>.</p>`,
    mailFormat: "html",
    encoding: "UTF-8",
    attachments: [attachment],
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
  const raw = await response.text();
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch {}
  return {
    ...summarizeResult(response, raw, parsed),
    messageId: clean(parsed?.data?.messageId || "", 200) || null,
  };
}

export async function handleZohoAttachmentDiagnostic(request, env) {
  const validation = validateAdmin(request, env);
  if (validation) return validation;

  try {
    const accessToken = await getAccessToken(env);
    const account = await getMailAccount(accessToken);
    const bytes = pngBytes();
    const attempts = [];

    attempts.push(await attemptMultipart(accessToken, account.accountId, bytes, false));
    if (!attempts[0].attachment) attempts.push(await attemptMultipart(accessToken, account.accountId, bytes, true));
    if (!attempts.some((item) => item.attachment)) attempts.push(await attemptRaw(accessToken, account.accountId, bytes));

    const successful = attempts.find((item) => item.attachment);
    if (!successful) {
      return json({
        ok: false,
        conclusion: "Zoho Canada attachment endpoint rejected every documented upload format from this Cloudflare Worker.",
        attempts: attempts.map(({ attachment, ...item }) => item),
      }, 502);
    }

    const email = await sendAttachmentTestEmail(accessToken, account, successful.attachment, successful.method);
    return json({
      ok: email.ok && Boolean(email.messageId),
      uploadMethod: successful.method,
      upload: successful.result,
      email,
      recipient: WHITE5_EMAIL,
    }, email.ok && email.messageId ? 200 : 502);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 502);
  }
}
