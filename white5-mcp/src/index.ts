import { createMcpHandler } from "agents/mcp/server";
import { ORIGIN, VERSION, type Env } from "./env";
import { createServer } from "./server";
import { health } from "./health";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return health(env, request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1]);
    }
    if (url.pathname !== "/mcp") {
      if (![/^\/\.well-known\//, /^\/authorize$/, /^\/oauth\/(token|register)$/].some((pattern) => pattern.test(url.pathname))) return new Response("Not found", { status: 404 });
      return env.ZOHO.authorize(request);
    }
    const origin = request.headers.get("origin");
    if (origin && ![ORIGIN, "https://chatgpt.com", "https://chat.openai.com"].includes(origin)) return new Response("Origin is not allowed", { status: 403 });
    let auth: Response;
    try {
      auth = await env.ZOHO.authorize(new Request(`${ORIGIN}/mcp`, { method: "GET", headers: { authorization: request.headers.get("authorization") || "" } }));
    } catch {
      return new Response("Zoho authorization service unavailable", { status: 503 });
    }
    if (!auth.ok) return auth;
    const identity = await auth.json<{ scopes?: string[] }>();
    const token = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!token || !identity.scopes?.includes("white5:read")) return new Response("White5 authorization required", { status: 401 });
    return createMcpHandler(() => createServer(env, { ...identity, scopes: identity.scopes!, accessToken: token }), { route: "/mcp", legacy: "stateless" })(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
