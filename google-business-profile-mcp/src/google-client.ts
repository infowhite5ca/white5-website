export const GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/business.manage"] as const;
export interface ConnectorEnv {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REFRESH_TOKEN?: string;
  GOOGLE_INSTALL_TOKEN?: string;
  ALLOWED_GOOGLE_EMAIL?: string;
}
export interface GoogleAuthProps { userId: string; email?: string; refreshToken: string; scopes: string[] }
type JsonObject = Record<string, any>;
type GoogleDiagnostics = { status?: string; metadata: Record<string, string> };
export class GoogleApiError extends Error {
  constructor(message: string, readonly status = 502, readonly category = "upstream_error", readonly reason?: string, readonly retryAfter?: number, readonly google?: GoogleDiagnostics) { super(message); this.name = "GoogleApiError"; }
}
export function classifyGoogleError(status: number, payload: JsonObject, retryAfter?: number): GoogleApiError {
  const error = payload.error;
  const detail = error?.details?.find((d: JsonObject) => d["@type"]?.endsWith("ErrorInfo"));
  const rawReason = detail?.reason || (typeof error === "string" ? error : "");
  const reason = /^[A-Za-z0-9_]{1,100}$/.test(rawReason) ? rawReason : undefined;
  // Only expose documented quota/project identifiers, never arbitrary upstream data.
  const metadata: Record<string, string> = {};
  const allowed: Record<string, RegExp> = {
    service: /^[a-z0-9]+\.googleapis\.com$/,
    consumer: /^projects\/\d+$/,
    quota_limit_value: /^\d+$/,
    quota_limit: /^[A-Za-z0-9_/-]{1,150}$/,
    quota_metric: /^[a-z0-9]+\.googleapis\.com\/[A-Za-z0-9_/-]{1,150}$/,
    quota_location: /^(global|[a-z]+(?:-[a-z0-9]+)+)$/,
  };
  for (const [key, pattern] of Object.entries(allowed)) {
    const value = detail?.metadata?.[key];
    if (typeof value === "string" && pattern.test(value)) metadata[key] = value;
  }
  const google = { status: typeof error?.status === "string" && /^[A-Z_]{1,50}$/.test(error.status) ? error.status : undefined, metadata };
  // Interpret upstream messages but never echo credential or request content.
  const message = typeof error?.message === "string" ? error.message : "";
  let category = "upstream_error", safe = "Google API request failed.";
  if (status === 401 || ["invalid_grant", "invalid_client", "unauthorized_client"].includes(rawReason)) { category = "authentication_failed"; safe = "Google authorization is invalid or expired; check the existing OAuth credentials and grant."; }
  else if (rawReason === "SERVICE_DISABLED" || /has not been used.*disabled|API.*disabled/i.test(message)) { category = "api_disabled"; safe = "The required Google API is disabled in the OAuth application project. Enable that API in the existing project."; }
  else if (rawReason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT" || /insufficient.*scope/i.test(message)) { category = "insufficient_scope"; safe = "The Google grant lacks the required business.manage scope."; }
  else if (status === 429) { category = metadata.quota_limit_value === "0" || /limit[^0-9]*0(?:\D|$)|quota[^0-9]*0(?:\D|$)/i.test(message) ? "project_quota_zero" : "rate_limited"; safe = category === "project_quota_zero" ? "Project quota is zero; Business Profile API project access must be approved." : "Google rate or quota limit reached. Retry after the indicated delay."; }
  else if (status === 403) { category = /project.*(not.*approved|not.*allowed|access.*denied)|accessNotConfigured/i.test(message) ? "project_access_restricted" : "permission_denied"; safe = category === "project_access_restricted" ? "Google restricts API access for this project." : "Google denied this operation. Check location ownership/manager permissions and project API access; this response alone does not identify which permission is missing."; }
  else if (status === 404) { category = "not_found_or_unavailable"; safe = "The resource was not found or is unavailable to this Google account."; }
  else if (status === 400) { category = "invalid_request"; safe = "Google rejected the request fields or resource. Check the tool schema and location capability."; }
  else if (status >= 500) { category = "transient_failure"; safe = "Google is temporarily unavailable."; }
  return new GoogleApiError(safe, status, category, reason, retryAfter, google);
}
async function readJson(response: Response): Promise<JsonObject> { return response.status === 204 ? {} : await response.json<JsonObject>().catch(() => ({})); }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function googleRequest(accessToken: string, url: string, init: RequestInit = {}): Promise<JsonObject> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !["mybusinessaccountmanagement.googleapis.com", "mybusinessbusinessinformation.googleapis.com", "mybusiness.googleapis.com", "businessprofileperformance.googleapis.com", "mybusinessverifications.googleapis.com", "openidconnect.googleapis.com"].includes(parsed.hostname)) throw new GoogleApiError("Unsupported Google endpoint.", 400, "invalid_request");
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json"); headers.set("authorization", `Bearer ${accessToken}`); headers.set("X-GOOG-API-FORMAT-VERSION", "2");
  if (init.body) headers.set("content-type", "application/json");
  const readOnly = !init.method || init.method === "GET";
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try { response = await fetch(url, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(15000) }); }
    catch {
      if (readOnly && attempt < 2) { await sleep(250 * 2 ** attempt); continue; }
      throw new GoogleApiError(readOnly ? "Google request timed out or could not connect." : "Write outcome is unknown after a network failure. Read the resource before retrying; do not blindly repeat the write.", 504, readOnly ? "transient_failure" : "write_outcome_unknown");
    }
    const payload = await readJson(response);
    if (response.ok) return payload;
    const retryHeader = response.headers.get("retry-after");
    const retryAfter = retryHeader ? (/^\d+$/.test(retryHeader) ? Number(retryHeader) : Math.max(0, Math.ceil((Date.parse(retryHeader) - Date.now()) / 1000))) : undefined;
    const error = classifyGoogleError(response.status, payload, Number.isFinite(retryAfter) ? retryAfter : undefined);
    if (readOnly && attempt < 2 && (response.status === 429 || response.status >= 500) && error.category !== "project_quota_zero" && (error.retryAfter ?? 0) <= 2) {
      await sleep(error.retryAfter !== undefined ? error.retryAfter * 1000 : 250 * 2 ** attempt + Math.random() * 100); continue;
    }
    throw error;
  }
}
async function tokenRequest(env: ConnectorEnv, fields: Record<string, string>) {
  let response: Response;
  try { response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...fields }), redirect: "manual", signal: AbortSignal.timeout(15000) }); }
  catch { throw new GoogleApiError("Google OAuth service could not be reached.", 504, "transient_failure"); }
  const payload = await readJson(response);
  if (!response.ok || !payload.access_token) throw classifyGoogleError(response.status, payload);
  if (payload.scope && !String(payload.scope).split(" ").includes(GOOGLE_SCOPES[2])) throw new GoogleApiError("Google authorization lacks business.manage.", 403, "insufficient_scope");
  return payload;
}
export async function exchangeAuthorizationCode(env: ConnectorEnv, code: string, redirectUri: string) {
  const payload = await tokenRequest(env, { code, grant_type: "authorization_code", redirect_uri: redirectUri });
  if (!payload.refresh_token) throw new GoogleApiError("Google did not return an offline refresh token. Authorize the existing Google application with consent.", 400, "authentication_failed");
  return { accessToken: String(payload.access_token), refreshToken: String(payload.refresh_token) };
}
export async function refreshAccessToken(env: ConnectorEnv, refreshToken: string): Promise<string> {
  return String((await tokenRequest(env, { refresh_token: refreshToken, grant_type: "refresh_token" })).access_token);
}
export async function identifyGoogleUser(env: ConnectorEnv, accessToken: string) {
  const payload = await googleRequest(accessToken, "https://openidconnect.googleapis.com/v1/userinfo");
  const email = String(payload.email || "").toLowerCase(), subject = String(payload.sub || "");
  if (!email || !subject || payload.email_verified !== true) throw new GoogleApiError("Google identity could not be verified.", 403, "authentication_failed");
  const allowed = String(env.ALLOWED_GOOGLE_EMAIL || "").trim().toLowerCase();
  if (!allowed || email !== allowed) throw new GoogleApiError("Connect the configured authorized Google account.", 403, "permission_denied");
  return { email, subject };
}
