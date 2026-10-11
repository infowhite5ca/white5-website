// Recovered from deployed white5-google-business-profile-mcp on 2026-10-10.
// Snapshot SHA256: d85842a7b3944bd2ae740061d76384ab5ab0b44224dcedcdc31552dba888c220
// Existing public OAuth endpoints and three read-only tool schemas are retained.
import {McpServer} from '@modelcontextprotocol/server';
import oauth_provider_default from '@cloudflare/workers-oauth-provider';
import {createMcpHandler, getMcpAuthContext} from 'agents/mcp/server';
import {z as external_exports} from 'zod';
const createStatelessMcpHandler = createMcpHandler;
// src/index.ts
var GOOGLE_BUSINESS_SCOPE = "https://www.googleapis.com/auth/business.manage";
var MCP_SCOPE = "business-profile:read";
var STATE_TTL_SECONDS = 10 * 60;
var LOCATION_READ_MASK = "name,title,storeCode,storefrontAddress,websiteUri,phoneNumbers,regularHours,openInfo,metadata";
var UserFacingError = class extends Error {

};
var credentialsSchema = external_exports.object({
  accessToken: external_exports.string().min(1),
  expiresAt: external_exports.number().finite(),
  refreshToken: external_exports.string().min(1).optional()
});
var apiHandler = {
  fetch(request, env, ctx) {
    return createStatelessMcpHandler(() => createServer(env))(request, env, ctx);
  }
};
var authHandler = {
  async fetch(request, env) {
    const url2 = new URL(request.url);
    switch (`${request.method} ${url2.pathname}`) {
      case "GET /":
        return json2({
          name: "White5 Google Business Profile MCP",
          mcp_endpoint: "/mcp",
          authentication: "OAuth 2.1 via Google",
          tools: ["list_business_accounts", "list_locations", "get_location"]
        });
      case "GET /authorize":
        return startAuthorization(request, env);
      case "POST /authorize":
        return approveAuthorization(request, env);
      case "GET /oauth/google/callback":
        return completeGoogleAuthorization(request, env);
      default:
        return new Response("Not found", { status: 404 });
    }
  }
};
function createProvider(env) {
  const origin = publicOrigin(env);
  return new oauth_provider_default({
    apiRoute: "/mcp",
    apiHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    clientIdMetadataDocumentEnabled: true,
    defaultHandler: authHandler,
    scopesSupported: [MCP_SCOPE],
    resourceMetadata: {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: [MCP_SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "White5 Google Business Profile MCP"
    }
  });
}
var index_default = {
  async fetch(request, env, ctx) {
    try {
      return await createProvider(env).fetch(request, env, ctx);
    } catch (error62) {
      console.error("Worker configuration error", error62 instanceof Error ? error62.message : "unknown");
      return new Response("The MCP connector is not configured correctly.", { status: 500 });
    }
  }
};
function createServer(env) {
  const server = new McpServer({
    name: "White5 Google Business Profile",
    version: "1.0.0"
  });
  server.registerTool(
    "list_business_accounts",
    {
      description: "List Google Business Profile accounts that the authenticated Google user can access. This tool is read-only.",
      inputSchema: {
        page_size: external_exports.number().int().min(1).max(20).optional(),
        page_token: external_exports.string().min(1).optional()
      }
    },
    async ({ page_size, page_token }) => toolResult(async () => {
      const params = new URLSearchParams({ pageSize: String(page_size ?? 20) });
      if (page_token) params.set("pageToken", page_token);
      return googleApi(
        `https://mybusinessaccountmanagement.googleapis.com/v1/accounts?${params}`,
        env
      );
    })
  );
  server.registerTool(
    "list_locations",
    {
      description: "List locations for one Google Business Profile account. Use an account name returned by list_business_accounts, such as accounts/123. This tool is read-only.",
      inputSchema: {
        account_name: external_exports.string().regex(/^accounts\/[^/]+$/),
        page_size: external_exports.number().int().min(1).max(100).optional(),
        page_token: external_exports.string().min(1).optional()
      }
    },
    async ({ account_name, page_size, page_token }) => toolResult(async () => {
      const params = new URLSearchParams({
        pageSize: String(page_size ?? 100),
        readMask: LOCATION_READ_MASK
      });
      if (page_token) params.set("pageToken", page_token);
      return googleApi(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${account_name}/locations?${params}`,
        env
      );
    })
  );
  server.registerTool(
    "get_location",
    {
      description: "Get business information for one Google Business Profile location. Use a location name returned by list_locations, such as locations/123. This tool is read-only.",
      inputSchema: { location_name: external_exports.string().regex(/^locations\/[^/]+$/) }
    },
    async ({ location_name }) => toolResult(
      () => googleApi(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${location_name}?${new URLSearchParams({ readMask: LOCATION_READ_MASK })}`,
        env
      )
    )
  );
  return server;
}
async function toolResult(action) {
  try {
    return {
      content: [{ type: "text", text: JSON.stringify(await action(), null, 2) }]
    };
  } catch (error62) {
    const message = error62 instanceof UserFacingError ? error62.message : "The Google Business Profile request failed. Reconnect the MCP server and try again.";
    return { content: [{ type: "text", text: message }], isError: true };
  }
}
async function googleApi(url2, env) {
  const response = await fetch(url2, {
    headers: { Authorization: `Bearer ${await googleAccessToken(env)}` }
  });
  if (!response.ok) {
    console.warn("Google Business Profile API request failed", response.status);
    throw new UserFacingError(
      response.status === 401 || response.status === 403 ? "Google did not authorize this request. Reconnect the MCP server and confirm the Business Profile permission." : `Google Business Profile returned HTTP ${response.status}. Try again shortly.`
    );
  }
  return response.json();
}
async function googleAccessToken(env) {
  const props = credentialsSchema.safeParse(getMcpAuthContext()?.props);
  if (!props.success) {
    throw new UserFacingError("No Google Business Profile connection is available. Reconnect the MCP server.");
  }
  if (props.data.expiresAt > Date.now() + 6e4) return props.data.accessToken;
  if (!props.data.refreshToken) {
    throw new UserFacingError("The Google connection expired. Reconnect the MCP server to continue.");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: props.data.refreshToken
    })
  });
  if (!response.ok) {
    console.warn("Google OAuth token refresh failed", response.status);
    throw new UserFacingError("The Google connection expired. Reconnect the MCP server to continue.");
  }
  const refreshed = await response.json();
  if (!refreshed.access_token) {
    throw new UserFacingError("Google did not return an access token. Reconnect the MCP server.");
  }
  return refreshed.access_token;
}
async function startAuthorization(request, env) {
  const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  if (!authRequest.clientId) return new Response("Invalid OAuth client", { status: 400 });
  const flowId = randomToken();
  const csrfToken = randomToken();
  await env.OAUTH_KV.put(`gbp-oauth:${flowId}`, JSON.stringify({ authRequest, csrfToken }), {
    expirationTtl: STATE_TTL_SECONDS
  });
  const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  return html(
    renderApprovalPage(client?.clientName ?? "an MCP client", authRequest.scope, flowId, csrfToken),
    { "Set-Cookie": secureCookie("__Host-GBP-CSRF", csrfToken, STATE_TTL_SECONDS) }
  );
}
async function approveAuthorization(request, env) {
  const form = await request.formData();
  const flowId = formValue(form, "flow_id");
  const csrf = formValue(form, "csrf_token");
  const csrfCookie = readCookie(request, "__Host-GBP-CSRF");
  const pending = flowId ? await env.OAUTH_KV.get(`gbp-oauth:${flowId}`, "json") : null;
  if (!flowId || !csrf || !csrfCookie || !pending || typeof pending.csrfToken !== "string" || !constantTimeEqual(csrf, pending.csrfToken) || !constantTimeEqual(csrf, csrfCookie)) {
    console.warn("OAuth consent rejected", {
      hasFlow: Boolean(flowId),
      hasFormToken: Boolean(csrf),
      hasCookie: Boolean(csrfCookie),
      hasPending: Boolean(pending)
    });
    return new Response("Invalid authorization request", { status: 400 });
  }
  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.search = new URLSearchParams({
    access_type: "offline",
    client_id: env.GOOGLE_CLIENT_ID,
    include_granted_scopes: "true",
    prompt: "consent",
    redirect_uri: `${publicOrigin(env)}/oauth/google/callback`,
    response_type: "code",
    scope: `${GOOGLE_BUSINESS_SCOPE} openid email`,
    state: flowId
  }).toString();
  const headers = new Headers({ Location: google.href });
  console.info("OAuth consent accepted; redirecting to Google");
  headers.append("Set-Cookie", secureCookie("__Host-GBP-STATE", await sha256(flowId), STATE_TTL_SECONDS));
  headers.append("Set-Cookie", clearCookie("__Host-GBP-CSRF"));
  return new Response(null, { status: 302, headers });
}
async function completeGoogleAuthorization(request, env) {
  const url2 = new URL(request.url);
  const flowId = url2.searchParams.get("state");
  const stateCookie = readCookie(request, "__Host-GBP-STATE");
  if (!flowId || !stateCookie || !constantTimeEqual(await sha256(flowId), stateCookie)) {
    return new Response("Invalid or expired Google authorization state", { status: 400 });
  }
  const pending = await env.OAUTH_KV.get(`gbp-oauth:${flowId}`, "json");
  await env.OAUTH_KV.delete(`gbp-oauth:${flowId}`);
  if (!pending) return new Response("Google authorization state expired. Please try again.", { status: 400 });
  if (url2.searchParams.has("error")) return new Response("Google permission was not granted.", { status: 403 });
  const code = url2.searchParams.get("code");
  if (!code) return new Response("Google did not return an authorization code.", { status: 400 });
  const tokens = await exchangeAuthorizationCode(code, `${publicOrigin(env)}/oauth/google/callback`, env);
  const identity = await googleIdentity(tokens.accessToken);
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: pending.authRequest,
    userId: `google:${identity.sub}`,
    scope: pending.authRequest.scope,
    metadata: { label: identity.email ?? "Google Business Profile" },
    props: tokens
  });
  return new Response(null, {
    status: 302,
    headers: { Location: redirectTo, "Set-Cookie": clearCookie("__Host-GBP-STATE") }
  });
}
async function exchangeAuthorizationCode(code, redirectUri, env) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    })
  });
  if (!response.ok) {
    console.warn("Google OAuth code exchange failed", response.status);
    throw new UserFacingError("Google authorization could not be completed. Please try again.");
  }
  const data = await response.json();
  if (!data.access_token || !data.expires_in) {
    throw new UserFacingError("Google did not return the required authorization tokens.");
  }
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1e3,
    ...data.refresh_token ? { refreshToken: data.refresh_token } : {}
  };
}
async function googleIdentity(accessToken) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new UserFacingError("Google identity verification failed. Please try again.");
  const data = await response.json();
  const identity = external_exports.object({ sub: external_exports.string().min(1), email: external_exports.string().email().optional() }).safeParse(data);
  if (!identity.success) throw new UserFacingError("Google identity verification returned an invalid response.");
  return identity.data;
}
function publicOrigin(env) {
  const url2 = new URL(env.MCP_PUBLIC_ORIGIN);
  if (url2.protocol !== "https:" || url2.pathname !== "/" || url2.search || url2.hash || url2.username || url2.password) {
    throw new Error("MCP_PUBLIC_ORIGIN must be an HTTPS origin without a path");
  }
  return url2.origin;
}
function renderApprovalPage(clientName, scopes, flowId, csrfToken) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect Google Business Profile</title></head><body><main><h1>Connect Google Business Profile</h1><p><strong>${escapeHtml(clientName)}</strong> is requesting access to this read-only MCP connector.</p><p>The next page is Google\u2019s consent screen for the Business Profile permission.</p><p>Requested MCP scope: <code>${escapeHtml(scopes.join(" "))}</code></p><form method="post" action="/authorize"><input type="hidden" name="flow_id" value="${escapeHtml(flowId)}"><input type="hidden" name="csrf_token" value="${escapeHtml(csrfToken)}"><button type="submit">Continue to Google</button></form></main></body></html>`;
}
function html(body, headers = {}) {
  return new Response(body, {
    headers: {
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://accounts.google.com; base-uri 'none'; frame-ancestors 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...headers
    }
  });
}
function json2(body) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" }
  });
}
function formValue(form, key) {
  const candidate = form.get(key);
  return typeof candidate === "string" ? candidate : void 0;
}
function readCookie(request, name) {
  return request.headers.get("Cookie")?.split(";").map((part) => part.trim().split("=", 2)).find(([key]) => key === name)?.[1];
}
function secureCookie(name, value, maxAge) {
  return `${name}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}
function clearCookie(name) {
  return `${name}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`;
}
function randomToken() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}
async function sha256(value) {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
function escapeHtml(value) {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#039;";
      default:
        return character;
    }
  });
}
export {
  index_default as default
};
