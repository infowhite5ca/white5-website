import type { ConnectorEnv } from "./zoho-client";
import { authHandler } from "./zoho-auth-handler";

const COOKIE_NAME = "__Host-white5_consent";
const GATEWAY_ORIGIN = "https://white5-mcp.volodymyronufriichuk68.workers.dev";
const CONSENT_TTL_SECONDS = 10 * 60;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] || character);
}

function cookieValue(request: Request, name: string): string {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function htmlResponse(html: string, nonce: string): Response {
  return new Response(html, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; form-action 'self' https://accounts.zohocloud.ca; frame-ancestors 'none'; base-uri 'none'",
      "x-content-type-options": "nosniff",
      "set-cookie": `${COOKIE_NAME}=${encodeURIComponent(nonce)}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${CONSENT_TTL_SECONDS}`,
    },
  });
}

export async function gatewayConsent(request: Request, env: ConnectorEnv): Promise<Response> {
  if (!env.GATEWAY_OAUTH_KV) return new Response("Gateway OAuth storage is not configured.", { status: 503 });

  if (request.method === "GET") {
    const authorization = await env.OAUTH_PROVIDER.parseAuthRequest(request);
    const client = await env.OAUTH_PROVIDER.lookupClient(authorization.clientId);
    if (!client) return new Response("Unknown OAuth client.", { status: 400 });

    const nonce = crypto.randomUUID();
    await env.GATEWAY_OAUTH_KV.put(`gateway-consent:${nonce}`, request.url, {
      expirationTtl: CONSENT_TTL_SECONDS,
    });
    const scopes = authorization.scope.length > 0
      ? authorization.scope
      : ["white5:read", "white5:write"];
    const writes = scopes.includes("white5:write");
    return htmlResponse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize White5</title></head>
<body><main><h1>Authorize White5</h1>
<p><strong>${escapeHtml(client.clientName || "MCP client")}</strong> requests access to the White5 connector.</p>
<ul><li>Read White5 connected services</li>${writes ? "<li>Use write-capable tools only when their own confirmation requirements are met</li>" : ""}</ul>
<form method="post" action="/authorize">
<input type="hidden" name="consent_nonce" value="${escapeHtml(nonce)}">
<button type="submit" name="decision" value="approve">Approve</button>
<button type="submit" name="decision" value="deny">Deny</button>
</form></main></body></html>`, nonce);
  }

  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (request.headers.get("origin") !== GATEWAY_ORIGIN) return new Response("Invalid request origin.", { status: 403 });

  const body = await request.text();
  if (body.length > 4_096) return new Response("Request is too large.", { status: 413 });
  const form = new URLSearchParams(body);
  const nonce = form.get("consent_nonce") || "";
  if (!/^[0-9a-f-]{36}$/i.test(nonce) || cookieValue(request, COOKIE_NAME) !== nonce) {
    return new Response("Invalid or expired consent request.", { status: 400 });
  }

  const key = `gateway-consent:${nonce}`;
  const authorizationUrl = await env.GATEWAY_OAUTH_KV.get(key);
  await env.GATEWAY_OAUTH_KV.delete(key);
  if (!authorizationUrl || new URL(authorizationUrl).origin !== GATEWAY_ORIGIN) {
    return new Response("Invalid or expired consent request.", { status: 400 });
  }

  const response = form.get("decision") === "approve"
    ? await authHandler.fetch!(new Request(authorizationUrl) as Request<unknown, IncomingRequestCfProperties>, env, {} as ExecutionContext)
    : new Response("Authorization denied.", { status: 403 });
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.append("set-cookie", `${COOKIE_NAME}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
