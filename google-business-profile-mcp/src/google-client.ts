export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/business.manage",
] as const;

export interface ConnectorEnv {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ALLOWED_GOOGLE_EMAIL?: string;
}

export interface GoogleAuthProps {
  userId: string;
  email: string;
  refreshToken: string;
  scopes: string[];
}

type JsonObject = Record<string, unknown>;

export class GoogleApiError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = "GoogleApiError";
  }
}

async function readJson(response: Response): Promise<JsonObject> {
  return await response.json<JsonObject>().catch(() => ({}));
}

function errorMessage(payload: JsonObject): string {
  const error = payload.error;
  if (error && typeof error === "object") {
    const message = (error as JsonObject).message;
    if (typeof message === "string") return message;
  }
  if (typeof error === "string") return error;
  if (typeof payload.error_description === "string") return payload.error_description;
  return "Google API request failed.";
}

export async function exchangeAuthorizationCode(env: ConnectorEnv, code: string, redirectUri: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  const payload = await readJson(response);
  const accessToken = String(payload.access_token || "");
  const refreshToken = String(payload.refresh_token || "");
  if (!response.ok || !accessToken) throw new GoogleApiError(errorMessage(payload), response.status);
  if (!refreshToken) throw new GoogleApiError("Google did not return a refresh token. Reconnect with consent enabled.", 400);
  return { accessToken, refreshToken };
}

export async function refreshAccessToken(env: ConnectorEnv, refreshToken: string): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await readJson(response);
  const token = String(payload.access_token || "");
  if (!response.ok || !token) throw new GoogleApiError(errorMessage(payload), response.status);
  return token;
}

export async function googleRequest(accessToken: string, url: string, init: RequestInit = {}): Promise<JsonObject> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${accessToken}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const payload = await readJson(response);
  if (!response.ok) throw new GoogleApiError(`Google API ${response.status}: ${errorMessage(payload)}`, response.status);
  return payload;
}

export async function identifyGoogleUser(env: ConnectorEnv, accessToken: string) {
  const payload = await googleRequest(accessToken, "https://openidconnect.googleapis.com/v1/userinfo");
  const email = String(payload.email || "").toLowerCase();
  const subject = String(payload.sub || "");
  if (!email || !subject) throw new GoogleApiError("Google identity could not be verified.", 403);
  const allowed = String(env.ALLOWED_GOOGLE_EMAIL || "").trim().toLowerCase();
  if (allowed && email !== allowed) throw new GoogleApiError(`Connect the authorized Google account ${allowed}.`, 403);
  return { email, subject };
}
