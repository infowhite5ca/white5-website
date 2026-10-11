import { z } from "zod";
import { schemas, toolDefinitions, WRITES, METRICS, type ToolName } from "./tools";
import { GoogleApiError, googleRequest, refreshAccessToken, type ConnectorEnv, type GoogleAuthProps } from "./google-client";
export { schemas, toolDefinitions, WRITES };
const ACCOUNTS = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO = "https://mybusinessbusinessinformation.googleapis.com/v1";
const V4 = "https://mybusiness.googleapis.com/v4";
export const PRIMARY_KEY = "gbp-primary-location:v1";
const resource = (value: string, prefix: string) => value.startsWith(`${prefix}/`) ? value : `${prefix}/${value}`;
export function ok(data: unknown) { return { content: [{ type: "text" as const, text: JSON.stringify(data) }] }; }
export function safeError(error: unknown) {
  if (error instanceof GoogleApiError) return { available: false, status: error.status, category: error.category, message: error.message, reason: error.reason, retryAfter: error.retryAfter, google: error.google };
  if (error instanceof z.ZodError) return { available: false, status: 400, category: "invalid_request", issues: error.issues.map(issue => ({ path: issue.path, code: issue.code, message: issue.message })) };
  return { available: false, status: 500, category: "internal_error", message: "The GBP operation could not be completed." };
}
export function failed(error: unknown) { return { isError: true, ...ok(safeError(error)) }; }
function performanceUrl(location: string, start: string, end: string, metrics: readonly string[]) {
  const url = new URL(`https://businessprofileperformance.googleapis.com/v1/${resource(location, "locations")}:fetchMultiDailyMetricsTimeSeries`);
  for (const metric of metrics) url.searchParams.append("dailyMetrics", metric);
  for (const [key, date] of [["start_date", start], ["end_date", end]]) {
    const parts = date.split("-");
    ["year", "month", "day"].forEach((field, index) => url.searchParams.set(`dailyRange.${key}.${field}`, String(Number(parts[index]))));
  }
  return url.toString();
}
export async function invoke(env: ConnectorEnv, props: GoogleAuthProps | undefined, name: ToolName, raw: Record<string, unknown>) {
  if (!Object.hasOwn(schemas, name)) throw new GoogleApiError("Unknown GBP tool.", 400, "invalid_request");
  const args = schemas[name].parse(raw) as any;
  const account = args.account && resource(args.account, "accounts"), location = args.location && resource(args.location, "locations");
  let url = "", method = "GET", body: any;
  if (name === "create_post" || name === "prepare_post") { url = `${V4}/${account}/${location}/localPosts`; method = "POST"; body = args.post; }
  if (name === "update_post") { url = `${V4}/${args.postName}?updateMask=${Object.keys(args.post).join(",")}`; method = "PATCH"; body = args.post; }
  if (name === "delete_post") { url = `${V4}/${args.postName}`; method = "DELETE"; }
  if (name === "reply_to_review") { url = `${V4}/${args.reviewName}/reply`; method = "PUT"; body = { comment: args.comment }; }
  if (name === "update_location") { url = `${INFO}/${location}?updateMask=${Object.keys(args.changes).join(",")}&validateOnly=${args.validateOnly}`; method = "PATCH"; body = args.changes; }
  if (name === "prepare_post" || (WRITES.has(name) && !args.confirmed)) return ok({ executed: false, sent: false, preview: true, validation: "local_schema_only", googleDraftCreated: false, method, url: url || undefined, body, ...(name === "set_primary_location" ? { account, location } : {}), requires: name === "prepare_post" ? "Call create_gbp_post only after explicit user approval." : "confirmed:true after explicit approval of the exact change" });
  if (!props?.refreshToken) throw new GoogleApiError("GBP authorization is not configured.", 503, "not_configured");
  if (!props.scopes.includes(WRITES.has(name) ? "business:write" : "business:read")) throw new GoogleApiError("Required connector scope is missing.", 403, "insufficient_scope");
  let token = await refreshAccessToken(env, props.refreshToken);
  const request = async (target: string, init: RequestInit = {}): Promise<Record<string, any>> => {
    try { return await googleRequest(token, target, init); }
    catch (error) {
      if (error instanceof GoogleApiError && error.status === 401 && (!init.method || init.method === "GET")) {
        token = await refreshAccessToken(env, props.refreshToken);
        return googleRequest(token, target, init);
      }
      throw error;
    }
  };
  const capability = async (target: string) => { try { return { available: true, data: await request(target) }; } catch (e) { return safeError(e); } };
  if (name === "connection_status") {
    const accountCheck = await capability(`${ACCOUNTS}/accounts?pageSize=20`);
    const accounts = "data" in accountCheck ? accountCheck.data : undefined;
    const saved = await env.OAUTH_KV.get<{ account: string; location: string }>(PRIMARY_KEY, "json");
    const primary = location ? { account, location } : saved;
    const capabilities: Record<string, any> = { accounts: accounts ? { available: true } : accountCheck, locations: { available: null, status: "not_checked" }, posts: { available: null, status: "not_checked" }, reviews: { available: null, status: "not_checked" }, performance: { available: null, status: "not_checked" } };
    if (primary) {
      const parent = `${primary.account}/${primary.location}`;
      const end = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const checks = await Promise.all([
        capability(`${INFO}/${primary.location}?readMask=name,title,metadata`),
        capability(`${V4}/${parent}/localPosts?pageSize=1`),
        capability(`${V4}/${parent}/reviews?pageSize=1`),
        capability(performanceUrl(primary.location, end, end, ["WEBSITE_CLICKS"])),
      ]);
      ["locations", "posts", "reviews", "performance"].forEach((key, index) => { const check = checks[index]; capabilities[key] = "data" in check ? { available: true } : check; });
    }
    return ok({ connected: Boolean(accounts), tokenRefresh: true, requiredScope: "https://www.googleapis.com/auth/business.manage", accounts: accounts?.accounts || [], nextPageToken: accounts?.nextPageToken, primary, capabilities, metrics: METRICS, writes: "explicit_confirmation_required", postDrafts: "local_only" });
  }
  if (name === "get_location_permissions") return ok({ administrators: await capability(`${ACCOUNTS}/${location}/admins`), verification: await capability(`https://mybusinessverifications.googleapis.com/v1/${location}/VoiceOfMerchantState`) });
  if (name === "set_primary_location") {
    let pageToken: string | undefined, found = false;
    do {
      const result = await request(`${INFO}/${account}/locations?readMask=name,title,metadata&pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
      found = (result.locations || []).some((entry: any) => entry.name === location && /^white\s*5$/i.test(entry.title) && entry.metadata?.hasVoiceOfMerchant === true && !entry.metadata?.duplicateLocation);
      pageToken = result.nextPageToken;
    } while (!found && pageToken);
    if (!found) throw new GoogleApiError("Select an accessible White5 location with Voice of Merchant that is not marked as a duplicate.", 400, "invalid_primary_location");
    await env.OAUTH_KV.put(PRIMARY_KEY, JSON.stringify({ account, location, selectedAt: new Date().toISOString() }));
    return ok({ saved: true, account, location, googleProfileModified: false });
  }
  if (name === "list_accounts") url = `${ACCOUNTS}/accounts`;
  if (name === "list_locations") url = `${INFO}/${account}/locations`;
  if (name === "get_location") url = `${INFO}/${location}`;
  if (name === "get_review") url = `${V4}/${args.reviewName}`;
  if (name === "list_reviews" || name === "list_posts") url = `${V4}/${account}/${location}/${name === "list_reviews" ? "reviews" : "localPosts"}`;
  if (name === "get_performance") url = performanceUrl(location, args.startDate, args.endDate, args.metrics);
  const target = new URL(url);
  for (const key of ["pageSize", "pageToken", "readMask", "orderBy"]) if (args[key] !== undefined) target.searchParams.set(key, String(args[key]));
  const result = await request(target.toString(), { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  return ok(name === "update_location" && args.validateOnly ? { executed: false, validated: true, validation: "google_api", result } : name === "delete_post" ? { deleted: true, postName: args.postName } : result);
}
