import { AuthorizationError, type AuthRequest } from "@cloudflare/workers-oauth-provider";
import { type ConnectorEnv, exchangeAuthorizationCode, GOOGLE_SCOPES, identifyGoogleUser } from "./google-client";

const STATE_TTL = 10 * 60;
const CONNECTOR_SCOPES = ["business:read", "business:write"];
interface StoredAuthorization { request: AuthRequest; createdAt: number }

function callbackUri(request: Request): string {
  return `${new URL(request.url).origin}/oauth/google/callback`;
}

function oauthError(error: AuthorizationError): Response {
  if (!error.redirectUri) return new Response(error.description, { status: 400 });
  const url = new URL(error.redirectUri);
  url.searchParams.set("error", error.code);
  url.searchParams.set("error_description", error.description);
  if (error.state) url.searchParams.set("state", error.state);
  return Response.redirect(url, 302);
}

function redirectError(request: AuthRequest, description: string): Response {
  const url = new URL(request.redirectUri);
  url.searchParams.set("error", "access_denied");
  url.searchParams.set("error_description", description.slice(0, 500));
  if (request.state) url.searchParams.set("state", request.state);
  return Response.redirect(url, 302);
}

async function begin(request: Request, env: ConnectorEnv): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return new Response("Google OAuth credentials are not configured.", { status: 503 });
  let authRequest: AuthRequest;
  try { authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request); }
  catch (error) { if (error instanceof AuthorizationError) return oauthError(error); throw error; }
  const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  if (!client) return new Response("Unknown OAuth client.", { status: 400 });
  const state = crypto.randomUUID();
  await env.OAUTH_KV.put(`google-state:${state}`, JSON.stringify({ request: authRequest, createdAt: Date.now() } satisfies StoredAuthorization), { expirationTtl: STATE_TTL });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", callbackUri(request));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return Response.redirect(url, 302);
}

async function finish(request: Request, env: ConnectorEnv): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const raw = state ? await env.OAUTH_KV.get(`google-state:${state}`) : null;
  if (state) await env.OAUTH_KV.delete(`google-state:${state}`);
  if (!raw) return new Response("Authorization request expired or was already used.", { status: 400 });
  const stored = JSON.parse(raw) as StoredAuthorization;
  if (Date.now() - stored.createdAt > STATE_TTL * 1000) return redirectError(stored.request, "Authorization request expired.");
  if (url.searchParams.get("error")) return redirectError(stored.request, url.searchParams.get("error_description") || "Google access was not granted.");
  try {
    const tokens = await exchangeAuthorizationCode(env, url.searchParams.get("code") || "", callbackUri(request));
    const user = await identifyGoogleUser(env, tokens.accessToken);
    const client = await env.OAUTH_PROVIDER.lookupClient(stored.request.clientId);
    if (!client) return new Response("OAuth client is no longer registered.", { status: 400 });
    const requested = stored.request.scope.length ? stored.request.scope : CONNECTOR_SCOPES;
    const scopes = requested.filter((scope) => CONNECTOR_SCOPES.includes(scope));
    if (!scopes.length) return redirectError(stored.request, "No supported connector scope was requested.");
    const props = { userId: `google-${user.subject}`, email: user.email, refreshToken: tokens.refreshToken, scopes };
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: stored.request,
      userId: props.userId,
      metadata: { clientName: client.clientName || "MCP client", googleEmail: user.email },
      scope: scopes,
      props,
    });
    return Response.redirect(redirectTo, 302);
  } catch (error) {
    return redirectError(stored.request, error instanceof Error ? error.message : "Google authorization failed.");
  }
}

export const authHandler: ExportedHandler<ConnectorEnv> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/authorize") return begin(request, env);
    if (request.method === "GET" && url.pathname === "/oauth/google/callback") return finish(request, env);
    if (request.method === "GET" && url.pathname === "/") return Response.json({
      ok: true,
      service: "White5 Google Business Profile MCP",
      version: "0.1.0",
      endpoint: "/mcp",
      googleCallback: "/oauth/google/callback",
    }, { headers: { "cache-control": "no-store" } });
    return new Response("Not found", { status: 404 });
  },
};
