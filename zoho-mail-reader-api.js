const ZOHO_TOKEN_URL = "https://accounts.zohocloud.ca/oauth/v2/token";
const ZOHO_MAIL_API = "https://mail.zohocloud.ca/api";
const WHITE5_EMAIL = "info@white5.ca";
const REQUIRED_READ_SCOPES = [
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

function validateAdmin(request, env) {
  if (request.method !== "GET") {
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
    throw new Error(`Zoho token refresh failed: ${clean(result.error || response.status, 300)}`);
  }
  return result.access_token;
}

function allAddresses(account) {
  const addresses = [
    account?.primaryEmailAddress,
    account?.mailboxAddress,
    account?.incomingUserName,
  ];
  if (Array.isArray(account?.emailAddress)) {
    for (const item of account.emailAddress) addresses.push(item?.mailId);
  }
  if (Array.isArray(account?.sendMailDetails)) {
    for (const item of account.sendMailDetails) addresses.push(item?.fromAddress);
  }
  return [...new Set(addresses.map((value) => clean(value, 320)).filter(Boolean))];
}

function isScopeError(description) {
  return /scope|oauth|permission|authorization|unauthorized|forbidden/i.test(String(description || ""));
}

async function zohoGet(accessToken, path, params = {}) {
  const url = new URL(`${ZOHO_MAIL_API}${path}`);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(name, String(value));
    }
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Zoho-oauthtoken ${accessToken}`,
    },
  });
  const result = await response.json().catch(() => ({}));
  const apiCode = Number(result?.status?.code || 0);
  const description = clean(
    result?.status?.description
      || result?.data?.moreInfo
      || result?.error?.message
      || result?.message
      || "",
    700,
  );

  if (!response.ok || (apiCode && apiCode !== 200)) {
    const error = new Error(`Zoho Mail API failed: HTTP ${response.status}; API ${apiCode || "unknown"}; ${description || "no description"}`);
    error.httpStatus = response.status;
    error.apiCode = apiCode;
    error.description = description;
    error.reauthorizationRequired = response.status === 401 || response.status === 403 || isScopeError(description);
    throw error;
  }
  return result;
}

async function getMailAccount(accessToken) {
  const result = await zohoGet(accessToken, "/accounts");
  const accounts = Array.isArray(result.data) ? result.data : [];
  const target = WHITE5_EMAIL.toLowerCase();
  const account = accounts.find((item) =>
    allAddresses(item).some((address) => address.toLowerCase() === target),
  );
  if (!account?.accountId) {
    throw new Error(`Zoho account lookup failed: ${WHITE5_EMAIL} was not found`);
  }
  return { accountId: String(account.accountId) };
}

async function getInbox(accessToken, accountId) {
  const result = await zohoGet(
    accessToken,
    `/accounts/${encodeURIComponent(accountId)}/folders`,
  );
  const folders = Array.isArray(result.data) ? result.data : [];
  const inbox = folders.find((folder) => String(folder?.folderType || "").toLowerCase() === "inbox")
    || folders.find((folder) => String(folder?.folderName || "").toLowerCase() === "inbox")
    || folders.find((folder) => String(folder?.path || "").toLowerCase() === "/inbox");

  if (!inbox?.folderId) {
    throw new Error("Zoho Inbox folder was not found");
  }
  return {
    folderId: String(inbox.folderId),
    folderName: clean(inbox.folderName || "Inbox", 200),
  };
}

function sanitizeMessage(item) {
  return {
    messageId: clean(item?.messageId, 100),
    folderId: clean(item?.folderId, 100),
    threadId: clean(item?.threadId, 100),
    subject: clean(item?.subject || "(No subject)", 500),
    sender: clean(item?.sender, 300),
    fromAddress: clean(item?.fromAddress, 500),
    toAddress: clean(item?.toAddress, 1000),
    summary: clean(item?.summary, 3000),
    receivedTime: clean(item?.receivedTime, 100),
    sentDateInGMT: clean(item?.sentDateInGMT, 100),
    hasAttachment: String(item?.hasAttachment || "0") !== "0",
    flag: clean(item?.flagid, 100),
    rawStatus: clean(item?.status, 20),
  };
}

function readerError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const reauthorizationRequired = Boolean(error?.reauthorizationRequired);
  return json({
    ok: false,
    error: message,
    reauthorizationRequired,
    requiredScopes: reauthorizationRequired ? REQUIRED_READ_SCOPES : undefined,
    nextStep: reauthorizationRequired
      ? "Generate a new Zoho grant code with the listed scopes, exchange it for a new refresh token, and replace ZOHO_REFRESH_TOKEN in Cloudflare."
      : undefined,
  }, Number(error?.httpStatus) >= 400 ? Number(error.httpStatus) : 502);
}

export async function handleZohoInbox(request, env) {
  const validation = validateAdmin(request, env);
  if (validation) return validation;

  const url = new URL(request.url);
  const requestedStatus = ["all", "read", "unread"].includes(url.searchParams.get("status"))
    ? url.searchParams.get("status")
    : "unread";
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
  const limit = Math.min(50, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 20));

  try {
    const accessToken = await getAccessToken(env);
    const account = await getMailAccount(accessToken);
    const inbox = await getInbox(accessToken, account.accountId);
    const result = await zohoGet(
      accessToken,
      `/accounts/${encodeURIComponent(account.accountId)}/messages/view`,
      {
        folderId: inbox.folderId,
        start: 1,
        limit,
        status: requestedStatus,
        sortBy: "date",
        sortorder: "false",
        includeto: "true",
      },
    );

    const messages = (Array.isArray(result.data) ? result.data : [])
      .map(sanitizeMessage)
      .filter((message) => message.messageId && message.folderId);

    return json({
      ok: true,
      mailbox: WHITE5_EMAIL,
      folder: inbox.folderName,
      requestedStatus,
      count: messages.length,
      messages,
      readOnly: true,
    });
  } catch (error) {
    return readerError(error);
  }
}

export async function handleZohoMessage(request, env) {
  const validation = validateAdmin(request, env);
  if (validation) return validation;

  const url = new URL(request.url);
  const folderId = clean(url.searchParams.get("folderId"), 100);
  const messageId = clean(url.searchParams.get("messageId"), 100);
  if (!/^\d+$/.test(folderId) || !/^\d+$/.test(messageId)) {
    return json({ ok: false, error: "Valid folderId and messageId are required" }, 400);
  }

  try {
    const accessToken = await getAccessToken(env);
    const account = await getMailAccount(accessToken);
    const result = await zohoGet(
      accessToken,
      `/accounts/${encodeURIComponent(account.accountId)}/folders/${encodeURIComponent(folderId)}/messages/${encodeURIComponent(messageId)}/content`,
      { includeBlockContent: "false" },
    );

    return json({
      ok: true,
      mailbox: WHITE5_EMAIL,
      folderId,
      messageId,
      content: clean(result?.data?.content, 120000),
      readOnly: true,
    });
  } catch (error) {
    return readerError(error);
  }
}
