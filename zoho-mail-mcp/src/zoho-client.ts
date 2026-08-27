export const ZOHO_ACCOUNTS_BASE = "https://accounts.zohocloud.ca";
export const ZOHO_MAIL_API_BASE = "https://mail.zohocloud.ca/api";

export const ZOHO_MAIL_SCOPES = [
  "ZohoMail.accounts.READ",
  "ZohoMail.folders.READ",
  "ZohoMail.messages.READ",
  "ZohoMail.messages.CREATE",
] as const;

export interface ConnectorEnv {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
  ZOHO_CLIENT_ID: string;
  ZOHO_CLIENT_SECRET: string;
  ALLOWED_ZOHO_EMAIL?: string;
}

export interface MailAuthProps {
  userId: string;
  email: string;
  accountId: string;
  fromAddress: string;
  refreshToken: string;
  scopes: string[];
}

type JsonObject = Record<string, unknown>;

export class ZohoApiError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "ZohoApiError";
  }
}

function text(value: unknown, maxLength = 2_000): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function zohoDescription(payload: JsonObject): string {
  const status = asObject(payload.status);
  const data = asObject(payload.data);
  const error = asObject(payload.error);
  return text(
    status.description
      ?? data.moreInfo
      ?? error.message
      ?? payload.message
      ?? "Zoho returned an unexpected response",
    700,
  );
}

async function parseJson(response: Response): Promise<JsonObject> {
  return asObject(await response.json().catch(() => ({})));
}

export async function exchangeAuthorizationCode(
  env: ConnectorEnv,
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    redirect_uri: redirectUri,
    code,
  });
  const response = await fetch(`${ZOHO_ACCOUNTS_BASE}/oauth/v2/token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = await parseJson(response);
  const accessToken = text(payload.access_token, 4_000);
  const refreshToken = text(payload.refresh_token, 4_000);
  if (!response.ok || !accessToken || !refreshToken) {
    throw new ZohoApiError(
      `Zoho authorization failed: ${text(payload.error, 300) || response.status}`,
      502,
    );
  }
  return { accessToken, refreshToken };
}

export async function refreshAccessToken(
  env: ConnectorEnv,
  refreshToken: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    refresh_token: refreshToken,
  });
  const response = await fetch(`${ZOHO_ACCOUNTS_BASE}/oauth/v2/token`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = await parseJson(response);
  const accessToken = text(payload.access_token, 4_000);
  if (!response.ok || !accessToken) {
    throw new ZohoApiError(
      `Zoho token refresh failed: ${text(payload.error, 300) || response.status}`,
      response.status === 400 || response.status === 401 ? 401 : 502,
    );
  }
  return accessToken;
}

export async function zohoRequest(
  accessToken: string,
  path: string,
  init: RequestInit = {},
  query: Record<string, string | number | boolean | undefined> = {},
): Promise<JsonObject> {
  const url = new URL(`${ZOHO_MAIL_API_BASE}${path}`);
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") url.searchParams.set(name, String(value));
  }
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Zoho-oauthtoken ${accessToken}`);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(url, { ...init, headers });
  const payload = await parseJson(response);
  const apiCode = Number(asObject(payload.status).code ?? 0);
  if (!response.ok || (apiCode !== 0 && apiCode !== 200)) {
    throw new ZohoApiError(
      `Zoho Mail API failed: ${zohoDescription(payload)}`,
      response.status === 401 || response.status === 403 ? response.status : 502,
    );
  }
  return payload;
}

function accountAddresses(account: JsonObject): string[] {
  const addresses: unknown[] = [
    account.primaryEmailAddress,
    account.mailboxAddress,
    account.incomingUserName,
  ];
  for (const item of asArray(account.emailAddress)) {
    addresses.push(asObject(item).mailId);
  }
  for (const item of asArray(account.sendMailDetails)) {
    const record = asObject(item);
    if (record.status !== false) addresses.push(record.fromAddress);
  }
  return [...new Set(addresses.map((item) => text(item, 320)).filter(Boolean))];
}

export async function identifyAllowedMailbox(
  env: ConnectorEnv,
  accessToken: string,
): Promise<{ accountId: string; email: string; fromAddress: string }> {
  const allowedEmail = text(env.ALLOWED_ZOHO_EMAIL || "info@white5.ca", 320).toLowerCase();
  const payload = await zohoRequest(accessToken, "/accounts");
  const accounts = asArray(payload.data).map(asObject);
  const account = accounts.find((candidate) =>
    accountAddresses(candidate).some((address) => address.toLowerCase() === allowedEmail),
  );
  const accountId = text(account?.accountId, 120);
  if (!account || !accountId) {
    throw new ZohoApiError(`This Zoho login does not contain the allowed mailbox ${allowedEmail}.`, 403);
  }
  const addresses = accountAddresses(account);
  const fromAddress = addresses.find((address) => address.toLowerCase() === allowedEmail);
  if (!fromAddress) {
    throw new ZohoApiError(`${allowedEmail} is not available as a sender.`, 403);
  }
  return { accountId, email: allowedEmail, fromAddress };
}

export function sanitizeFolder(item: unknown) {
  const folder = asObject(item);
  return {
    folderId: text(folder.folderId, 120),
    folderName: text(folder.folderName, 300),
    folderType: text(folder.folderType, 100),
    path: text(folder.path, 500),
    unreadCount: Number(folder.unreadCount ?? 0),
    messageCount: Number(folder.messageCount ?? 0),
  };
}

export function sanitizeMessage(item: unknown) {
  const message = asObject(item);
  return {
    messageId: text(message.messageId, 120),
    folderId: text(message.folderId, 120),
    threadId: text(message.threadId, 120),
    subject: text(message.subject || "(No subject)", 700),
    sender: text(message.sender, 500),
    fromAddress: text(message.fromAddress, 1_000),
    toAddress: text(message.toAddress, 2_000),
    ccAddress: text(message.ccAddress, 2_000),
    summary: text(message.summary, 4_000),
    receivedTime: text(message.receivedTime, 100),
    sentDateInGMT: text(message.sentDateInGMT, 100),
    hasAttachment: String(message.hasAttachment ?? "0") !== "0",
    status: text(message.status, 40),
  };
}

export async function getFolders(accessToken: string, accountId: string) {
  const payload = await zohoRequest(
    accessToken,
    `/accounts/${encodeURIComponent(accountId)}/folders`,
  );
  return asArray(payload.data).map(sanitizeFolder).filter((folder) => folder.folderId);
}

export async function findFolder(
  accessToken: string,
  accountId: string,
  requested: string,
) {
  const folders = await getFolders(accessToken, accountId);
  const wanted = requested.trim().toLowerCase();
  const aliases: Record<string, string[]> = {
    inbox: ["inbox"],
    sent: ["sent", "sent mail"],
    drafts: ["draft", "drafts"],
  };
  const candidates = aliases[wanted] ?? [wanted];
  const folder = folders.find((item) =>
    candidates.includes(item.folderType.toLowerCase())
      || candidates.includes(item.folderName.toLowerCase()),
  );
  if (!folder) throw new ZohoApiError(`Zoho folder '${requested}' was not found.`, 404);
  return folder;
}

export function resultData(payload: JsonObject): JsonObject {
  return asObject(payload.data);
}

export function resultItems(payload: JsonObject): unknown[] {
  return asArray(payload.data);
}

