import {
  AuthorizationError,
  type AuthRequest,
} from "@cloudflare/workers-oauth-provider";
import {
  type ConnectorEnv,
  exchangeAuthorizationCode,
  identifyAllowedMailbox,
  ZOHO_ACCOUNTS_BASE,
  ZOHO_MAIL_SCOPES,
} from "./zoho-client";

const AUTH_STATE_TTL_SECONDS = 10 * 60;
const CONNECTOR_SCOPES = ["mail:read", "mail:write"];

interface StoredAuthorization {
  request: AuthRequest;
  createdAt: number;
}

function safeOAuthError(error: AuthorizationError): Response {
  if (!error.redirectUri) return new Response(error.description, { status: 400 });
  const redirect = new URL(error.redirectUri);
  redirect.searchParams.set("error", error.code);
  redirect.searchParams.set("error_description", error.description);
  if (error.state) redirect.searchParams.set("state", error.state);
  if (error.issuer) redirect.searchParams.set("iss", error.issuer);
  return Response.redirect(redirect, 302);
}

function callbackUri(request: Request): string {
  return `${new URL(request.url).origin}/oauth/zoho/callback`;
}

function redirectAuthorizationError(
  request: AuthRequest,
  code: string,
  description: string,
): Response {
  const redirect = new URL(request.redirectUri);
  redirect.searchParams.set("error", code);
  redirect.searchParams.set("error_description", description.slice(0, 500));
  if (request.state) redirect.searchParams.set("state", request.state);
  if (request.issuer) redirect.searchParams.set("iss", request.issuer);
  return Response.redirect(redirect, 302);
}

async function beginZohoAuthorization(request: Request, env: ConnectorEnv): Promise<Response> {
  if (!env.ZOHO_CLIENT_ID || !env.ZOHO_CLIENT_SECRET) {
    return new Response("Zoho OAuth credentials are not configured.", { status: 503 });
  }

  let oauthRequest: AuthRequest;
  try {
    oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    if (error instanceof AuthorizationError) return safeOAuthError(error);
    throw error;
  }

  const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
  if (!client) return new Response("Unknown OAuth client.", { status: 400 });

  const state = crypto.randomUUID();
  const stored: StoredAuthorization = { request: oauthRequest, createdAt: Date.now() };
  await env.OAUTH_KV.put(`zoho-state:${state}`, JSON.stringify(stored), {
    expirationTtl: AUTH_STATE_TTL_SECONDS,
  });

  const authorize = new URL(`${ZOHO_ACCOUNTS_BASE}/oauth/v2/auth`);
  authorize.searchParams.set("client_id", env.ZOHO_CLIENT_ID);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", callbackUri(request));
  authorize.searchParams.set("scope", ZOHO_MAIL_SCOPES.join(","));
  authorize.searchParams.set("access_type", "offline");
  authorize.searchParams.set("prompt", "consent");
  authorize.searchParams.set("state", state);
  return Response.redirect(authorize, 302);
}

async function finishZohoAuthorization(request: Request, env: ConnectorEnv): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  if (!state) return new Response("Missing OAuth state.", { status: 400 });

  const key = `zoho-state:${state}`;
  const raw = await env.OAUTH_KV.get(key);
  await env.OAUTH_KV.delete(key);
  if (!raw) return new Response("Authorization request expired or was already used.", { status: 400 });

  let stored: StoredAuthorization;
  try {
    stored = JSON.parse(raw) as StoredAuthorization;
  } catch {
    return new Response("Invalid authorization state.", { status: 400 });
  }
  if (!stored.request || Date.now() - stored.createdAt > AUTH_STATE_TTL_SECONDS * 1_000) {
    return new Response("Authorization request expired.", { status: 400 });
  }

  const upstreamError = url.searchParams.get("error");
  if (upstreamError) {
    return redirectAuthorizationError(
      stored.request,
      "access_denied",
      url.searchParams.get("error_description") || "Zoho access was not granted.",
    );
  }

  const code = url.searchParams.get("code") || "";
  if (!code) return redirectAuthorizationError(stored.request, "access_denied", "Zoho did not return an authorization code.");

  try {
    const tokens = await exchangeAuthorizationCode(env, code, callbackUri(request));
    const mailbox = await identifyAllowedMailbox(env, tokens.accessToken);
    const client = await env.OAUTH_PROVIDER.lookupClient(stored.request.clientId);
    if (!client) return new Response("OAuth client is no longer registered.", { status: 400 });

    const grantedScopes = stored.request.scope.filter((scope) => CONNECTOR_SCOPES.includes(scope));
    const scopes = stored.request.scope.length === 0 ? CONNECTOR_SCOPES : grantedScopes;
    if (scopes.length === 0) {
      return redirectAuthorizationError(stored.request, "invalid_scope", "No supported connector scope was requested.");
    }
    const props = {
      userId: `zoho:${mailbox.accountId}:${mailbox.email}`,
      email: mailbox.email,
      accountId: mailbox.accountId,
      fromAddress: mailbox.fromAddress,
      refreshToken: tokens.refreshToken,
      scopes,
    };
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: stored.request,
      userId: props.userId,
      metadata: { clientName: client.clientName || "MCP client", mailbox: mailbox.email },
      scope: scopes,
      props,
    });
    return Response.redirect(redirectTo, 302);
  } catch (error) {
    const description = error instanceof Error ? error.message : "Zoho authorization failed.";
    return redirectAuthorizationError(stored.request, "access_denied", description);
  }
}

export const authHandler: ExportedHandler<ConnectorEnv> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/authorize") {
      return beginZohoAuthorization(request, env);
    }
    if (request.method === "GET" && url.pathname === "/oauth/zoho/callback") {
      return finishZohoAuthorization(request, env);
    }
    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({
        ok: true,
        service: "White5 Zoho Mail MCP",
        version: "0.2.0",
        toolCount: 11,
        endpoint: "/mcp",
        authentication: "OAuth",
      }, { headers: { "cache-control": "no-store" } });
    }
    return new Response("Not found", { status: 404 });
  },
};
