import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const ORIGIN = "https://white5-google-business-mcp.volodymyronufriichuk68.workers.dev";
const MCP_URL = `${ORIGIN}/mcp`;
const SCOPES = "business:read business:write";

function base64url(value) {
  return value.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function parseMcpResponse(text) {
  const payload = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .find((line) => line && line !== "[DONE]") || text;
  return JSON.parse(payload);
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`${url} returned ${response.status} with a non-JSON response.`); }
  if (!response.ok) {
    const message = payload.error_description || payload.error?.message || payload.error || text;
    throw new Error(`${url} returned ${response.status}: ${String(message).slice(0, 500)}`);
  }
  return payload;
}

async function mcpCall(accessToken, id, method, params) {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP ${method} returned ${response.status}: ${text.slice(0, 500)}`);
  const payload = parseMcpResponse(text);
  if (payload.error) throw new Error(`MCP ${method} failed: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

async function toolCall(accessToken, id, name, args = {}) {
  const result = await mcpCall(accessToken, id, "tools/call", { name, arguments: args });
  const text = result?.content?.find((item) => item.type === "text")?.text || "{}";
  let data;
  try { data = JSON.parse(text); }
  catch { data = { message: text }; }
  return { ok: !result?.isError, data };
}

function resourceId(name, prefix) {
  if (typeof name !== "string" || !name.startsWith(`${prefix}/`)) return null;
  return name;
}

const callback = await new Promise((resolve, reject) => {
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("Google authorization received. You can return to Codex.");
    resolve({ server, url });
  });
  server.once("error", reject);
  server.listen(0, "127.0.0.1", async () => {
    try {
      const address = server.address();
      const redirectUri = `http://127.0.0.1:${address.port}/callback`;
      const registration = await requestJson(`${ORIGIN}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "White5 GBP live verification",
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          scope: SCOPES,
        }),
      });
      const verifier = base64url(randomBytes(48));
      const challenge = base64url(createHash("sha256").update(verifier).digest());
      const state = base64url(randomBytes(24));
      const authorize = new URL(`${ORIGIN}/authorize`);
      authorize.search = new URLSearchParams({
        response_type: "code",
        client_id: registration.client_id,
        redirect_uri: redirectUri,
        scope: SCOPES,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: MCP_URL,
      }).toString();
      console.log(`AUTH_URL=${authorize}`);
      server.oauth = { clientId: registration.client_id, redirectUri, state, verifier };
    } catch (error) {
      server.close();
      reject(error);
    }
  });
});

const { server, url } = callback;
server.close();
const { clientId, redirectUri, state, verifier } = server.oauth;
if (url.searchParams.get("state") !== state) throw new Error("OAuth state validation failed.");
if (url.searchParams.get("error")) throw new Error(`OAuth failed: ${url.searchParams.get("error_description") || url.searchParams.get("error")}`);
const code = url.searchParams.get("code");
if (!code) throw new Error("OAuth callback did not include an authorization code.");

const tokens = await requestJson(`${ORIGIN}/oauth/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource: MCP_URL,
  }),
});
const accessToken = tokens.access_token;
if (!accessToken) throw new Error("Connector token exchange did not return an access token.");

const initialize = await mcpCall(accessToken, 1, "initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "white5-live-probe", version: "1.0.0" },
});
const tools = await mcpCall(accessToken, 2, "tools/list", {});
const connection = await toolCall(accessToken, 3, "connection_status");
const accounts = await toolCall(accessToken, 4, "list_accounts", { pageSize: 20 });
const account = resourceId(accounts.data?.accounts?.[0]?.name, "accounts");
if (!connection.ok || !accounts.ok || !account) throw new Error("Google API returned no accessible Business Profile account.");

const locations = await toolCall(accessToken, 5, "list_locations", { account, pageSize: 100 });
const location = resourceId(locations.data?.locations?.[0]?.name, "locations");
if (!locations.ok || !location) throw new Error("Google API returned no accessible Business Profile location.");

const locationDetails = await toolCall(accessToken, 6, "get_location", { location });
const reviews = await toolCall(accessToken, 7, "list_reviews", { account, location, pageSize: 50 });
const posts = await toolCall(accessToken, 8, "list_posts", { account, location, pageSize: 20 });
const reviewName = reviews.data?.reviews?.[0]?.name || `${account}/${location}/reviews/preview-validation`;
const preview = await toolCall(accessToken, 9, "reply_to_review", {
  reviewName,
  comment: "Preview verification only — not sent.",
  confirmed: false,
});

console.log(JSON.stringify({
  initialize: { protocolVersion: initialize.protocolVersion, server: initialize.serverInfo?.name },
  tools: tools.tools?.map((tool) => tool.name) || [],
  connection_status: { ok: connection.ok, connected: connection.data?.connected === true },
  list_accounts: { ok: accounts.ok, count: accounts.data?.accounts?.length || 0 },
  list_locations: { ok: locations.ok, count: locations.data?.locations?.length || 0 },
  get_location: { ok: locationDetails.ok, nameMatches: locationDetails.data?.name === location },
  list_reviews: { ok: reviews.ok, count: reviews.data?.reviews?.length || 0, error: reviews.ok ? undefined : reviews.data?.message },
  list_posts: { ok: posts.ok, count: posts.data?.localPosts?.length || 0, error: posts.ok ? undefined : posts.data?.message },
  reply_to_review: { ok: preview.ok, preview: preview.data?.preview === true, sent: preview.data?.sent === true },
}, null, 2));
