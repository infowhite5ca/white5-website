import { WorkerEntrypoint } from "cloudflare:workers";
import { z } from "zod";
import { googleRequest, refreshAccessToken, type ConnectorEnv, type GoogleAuthProps } from "./google-client";
import { loadInternalGoogleRefreshToken } from "./stored-google-token";

export interface InternalMcpRequest {
  method: "tools/list" | "tools/call";
  name?: string;
  arguments?: Record<string, unknown>;
}

const schemas = {
  connection_status: z.object({}),
  list_accounts: z.object({ pageSize: z.number().int().min(1).max(20).default(20), pageToken: z.string().optional() }),
  list_locations: z.object({ account: z.string(), pageSize: z.number().int().min(1).max(100).default(100), pageToken: z.string().optional(), readMask: z.string().min(1).default("name,title,storeCode,websiteUri,phoneNumbers,categories,regularHours,specialHours,serviceArea,metadata,profile") }),
  get_location: z.object({ location: z.string(), readMask: z.string().min(1).default("name,title,storeCode,websiteUri,phoneNumbers,categories,regularHours,specialHours,serviceArea,metadata,profile") }),
  list_reviews: z.object({ account: z.string(), location: z.string(), pageSize: z.number().int().min(1).max(50).default(50), pageToken: z.string().optional(), orderBy: z.enum(["rating", "rating desc", "updateTime desc"]).optional() }),
  list_posts: z.object({ account: z.string(), location: z.string(), pageSize: z.number().int().min(1).max(100).default(20), pageToken: z.string().optional() }),
  reply_to_review: z.object({ reviewName: z.string().regex(/^accounts\/[^/]+\/locations\/[^/]+\/reviews\/[^/]+$/), comment: z.string().min(1).max(4096), confirmed: z.boolean().default(false) }),
};

type ToolName = keyof typeof schemas;

function ok(data: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }; }
function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected Google Business Profile service error.";
  return { isError: true, content: [{ type: "text" as const, text: `google_business: ${message.slice(0, 1_000)}` }] };
}
function resourceName(value: string, prefix: "accounts" | "locations") {
  const clean = value.trim();
  if (new RegExp(`^${prefix}/[^/]+$`).test(clean)) return clean;
  if (/^[0-9]+$/.test(clean)) return `${prefix}/${clean}`;
  throw new Error(`Use ${prefix}/ID or the numeric ID.`);
}
function sanitizeResult<T>(value: T, env: ConnectorEnv): T {
  const secrets = [env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REFRESH_TOKEN].filter((secret): secret is string => Boolean(secret));
  const blockedKeys = /^(access_token|refresh_token|client_secret|authorization)$/i;
  const visit = (input: unknown): unknown => {
    if (typeof input === "string") return secrets.reduce((result, secret) => result.replaceAll(secret, "[REDACTED]"), input);
    if (Array.isArray(input)) return input.map(visit);
    if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, blockedKeys.test(key) ? "[REDACTED]" : visit(item)]));
    return input;
  };
  return visit(value) as T;
}

async function invoke(env: ConnectorEnv, props: GoogleAuthProps, name: ToolName, rawArgs: Record<string, unknown>) {
  const args = schemas[name].parse(rawArgs) as any;
  if (name === "reply_to_review" && !args.confirmed) return ok({ sent: false, preview: true, reviewName: args.reviewName, comment: args.comment });
  let accessToken: string;
  try { accessToken = await refreshAccessToken(env, props.refreshToken); }
  catch (error) { throw new Error(`Google token refresh failed: ${error instanceof Error ? error.message : "unknown error"}`); }
  if (name === "connection_status") return ok({ connected: true, email: props.email, ...await googleRequest(accessToken, "https://mybusinessaccountmanagement.googleapis.com/v1/accounts") });
  if (name === "list_accounts") {
    const url = new URL("https://mybusinessaccountmanagement.googleapis.com/v1/accounts");
    url.searchParams.set("pageSize", String(args.pageSize)); if (args.pageToken) url.searchParams.set("pageToken", args.pageToken);
    return ok(await googleRequest(accessToken, url.toString()));
  }
  if (name === "list_locations") {
    const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${resourceName(args.account, "accounts")}/locations`);
    url.searchParams.set("pageSize", String(args.pageSize)); url.searchParams.set("readMask", args.readMask); if (args.pageToken) url.searchParams.set("pageToken", args.pageToken);
    return ok(await googleRequest(accessToken, url.toString()));
  }
  if (name === "get_location") {
    const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${resourceName(args.location, "locations")}`);
    url.searchParams.set("readMask", args.readMask);
    return ok(await googleRequest(accessToken, url.toString()));
  }
  if (name === "list_reviews" || name === "list_posts") {
    const parent = `${resourceName(args.account, "accounts")}/${resourceName(args.location, "locations")}`;
    const suffix = name === "list_reviews" ? "reviews" : "localPosts";
    const url = new URL(`https://mybusiness.googleapis.com/v4/${parent}/${suffix}`);
    url.searchParams.set("pageSize", String(args.pageSize)); if (args.pageToken) url.searchParams.set("pageToken", args.pageToken); if (name === "list_reviews" && args.orderBy) url.searchParams.set("orderBy", args.orderBy);
    return ok(await googleRequest(accessToken, url.toString()));
  }
  return ok(await googleRequest(accessToken, `https://mybusiness.googleapis.com/v4/${args.reviewName}/reply`, { method: "PUT", body: JSON.stringify({ comment: args.comment }) }));
}

export class White5Service extends WorkerEntrypoint<ConnectorEnv> {
  async status() {
    return { configured: Boolean(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET && await loadInternalGoogleRefreshToken(this.env) && this.env.ALLOWED_GOOGLE_EMAIL) };
  }

  async rpc(request: InternalMcpRequest) {
    try {
      const refreshToken = await loadInternalGoogleRefreshToken(this.env);
      if (!refreshToken || !this.env.ALLOWED_GOOGLE_EMAIL) throw new Error("Internal Google Business Profile authorization is not configured.");
      if (request.method === "tools/list") return { tools: Object.keys(schemas).map((name) => ({ name })) };
      if (!request.name || !(request.name in schemas)) throw new Error("Unknown Google Business Profile tool.");
      const props: GoogleAuthProps = { userId: "white5-internal-google-business", email: this.env.ALLOWED_GOOGLE_EMAIL, refreshToken, scopes: ["business:read", "business:write"] };
      return sanitizeResult(await invoke(this.env, props, request.name as ToolName, request.arguments || {}), this.env);
    } catch (error) {
      return sanitizeResult(errorResult(error), this.env);
    }
  }
}
