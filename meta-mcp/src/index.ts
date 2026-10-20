import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const SERVICE_NAME = "White5 Meta Ads";
const SERVICE_VERSION = "0.1.0";
const DEFAULT_API_VERSION = "v26.0";
const GRAPH_ORIGIN = "https://graph.facebook.com";
const MAX_META_RESPONSE_BYTES = 10 * 1024 * 1024;

const ACCOUNT_FIELDS = [
  "id",
  "account_id",
  "name",
  "account_status",
  "disable_reason",
  "currency",
  "timezone_name",
  "amount_spent",
  "balance",
  "spend_cap",
  "business",
].join(",");

const CAMPAIGN_FIELDS = [
  "id",
  "name",
  "status",
  "effective_status",
  "objective",
  "buying_type",
  "daily_budget",
  "lifetime_budget",
  "special_ad_categories",
  "created_time",
  "updated_time",
].join(",");

const AD_SET_FIELDS = [
  "id",
  "name",
  "campaign_id",
  "status",
  "effective_status",
  "daily_budget",
  "lifetime_budget",
  "billing_event",
  "optimization_goal",
  "bid_strategy",
  "targeting",
  "promoted_object",
  "start_time",
  "end_time",
  "created_time",
  "updated_time",
].join(",");

const AD_FIELDS = [
  "id",
  "name",
  "adset_id",
  "campaign_id",
  "status",
  "effective_status",
  "creative{id,name,object_story_spec,effective_object_story_id}",
  "tracking_specs",
  "conversion_domain",
  "created_time",
  "updated_time",
].join(",");

const CREATIVE_FIELDS = [
  "id",
  "name",
  "status",
  "account_id",
  "object_story_id",
  "object_story_spec",
  "asset_feed_spec",
  "effective_object_story_id",
  "thumbnail_url",
  "url_tags",
].join(",");

const INSIGHT_FIELDS = [
  "account_id",
  "account_name",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "date_start",
  "date_stop",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "inline_link_clicks",
  "spend",
  "ctr",
  "cpc",
  "cpm",
  "actions",
  "cost_per_action_type",
  "action_values",
].join(",");

const CORE_TOOL_NAMES = [
  "white5_meta_core",
  "white5_meta_tool_catalog",
  "get_meta_connection_status",
  "inspect_meta_token",
  "get_account_overview",
  "list_campaigns",
  "get_account_insights",
  "get_campaign_insights",
  "list_ad_sets",
  "list_ads",
  "list_ad_creatives",
  "diagnose_page_access",
  "list_pixels",
  "list_lead_forms",
  "graph_get",
  "graph_mutation",
] as const;

const GENERIC_READ_TOOL_NAMES = [
  "list_ad_accounts",
  "get_ad_account",
  "list_businesses",
  "get_business",
  "list_business_users",
  "list_business_system_users",
  "list_assigned_ad_accounts",
  "list_assigned_pages",
  "list_pages",
  "get_page",
  "get_campaign",
  "get_campaign_delivery_diagnostics",
  "list_campaign_issues",
  "get_ad_set",
  "get_ad_set_insights",
  "get_ad_set_delivery_estimate",
  "get_ad",
  "get_ad_insights",
  "get_ad_preview",
  "get_ad_creative",
  "list_ad_images",
  "get_ad_image",
  "list_ad_videos",
  "get_ad_video",
  "get_video_status",
  "search_targeting",
  "validate_targeting",
  "get_reach_estimate",
  "list_custom_audiences",
  "get_custom_audience",
  "list_saved_audiences",
  "get_saved_audience",
  "list_product_catalogs",
  "get_product_catalog",
  "list_product_sets",
  "list_pixels_for_business",
  "get_pixel",
  "get_pixel_stats",
  "list_datasets",
  "get_dataset",
  "get_event_match_quality",
  "get_aggregated_event_measurement_config",
  "get_lead_form",
  "list_leads",
  "get_lead",
  "list_offline_event_sets",
  "get_offline_event_set",
  "list_custom_conversions",
  "get_custom_conversion",
  "list_ads_activity",
  "get_account_spend_limits",
  "get_funding_source_details",
  "list_ad_rules",
  "get_ad_rule",
  "list_recommendations",
  "get_ad_library_report",
] as const;

const GENERIC_WRITE_TOOL_NAMES = [
  "create_campaign",
  "update_campaign",
  "update_campaign_status",
  "delete_campaign",
  "create_ad_set",
  "update_ad_set",
  "update_ad_set_status",
  "update_ad_set_budget",
  "delete_ad_set",
  "create_ad",
  "update_ad",
  "update_ad_status",
  "delete_ad",
  "create_ad_creative",
  "update_ad_creative",
  "upload_ad_image",
  "upload_ad_video",
  "create_custom_audience",
  "update_custom_audience",
  "delete_custom_audience",
  "create_saved_audience",
  "update_saved_audience",
  "delete_saved_audience",
  "create_lead_form",
  "archive_lead_form",
  "create_custom_conversion",
  "update_custom_conversion",
  "delete_custom_conversion",
  "send_conversion_event",
  "upload_offline_events",
  "create_ad_rule",
  "update_ad_rule",
  "delete_ad_rule",
  "execute_ad_rule",
  "create_product_set",
  "update_product_set",
  "delete_product_set",
  "create_ad_label",
  "attach_ad_label",
  "remove_ad_label",
] as const;

const ALL_TOOL_NAMES = [
  ...CORE_TOOL_NAMES,
  ...GENERIC_READ_TOOL_NAMES,
  ...GENERIC_WRITE_TOOL_NAMES,
] as const;

const datePresetSchema = z.enum([
  "today",
  "yesterday",
  "last_3d",
  "last_7d",
  "last_14d",
  "last_28d",
  "last_30d",
  "last_90d",
  "this_month",
  "last_month",
  "maximum",
]);

const insightLevelSchema = z.enum(["account", "campaign", "adset", "ad"]);
const idSchema = z.string().regex(/^\d+$/);
const objectPathSchema = z.string()
  .min(1)
  .max(300)
  .regex(/^(?:me|debug_token|search|act_\d+|\d+)(?:\/[A-Za-z0-9_.-]+)*$/);
const fieldsSchema = z.string().min(1).max(8_000);
const limitSchema = z.number().int().min(1).max(500).default(100);
const paramsSchema = z.record(z.string(), z.unknown()).default({});
const bodySchema = z.record(z.string(), z.unknown()).default({});

type MetaMethod = "GET" | "POST" | "DELETE";
type MetaOptions = {
  method?: MetaMethod;
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
  authorization?: string;
  includeAppSecretProof?: boolean;
  sanitizeResponse?: boolean;
};

class MetaApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, payload: unknown) {
    super(`Meta API request failed with HTTP ${status}`);
    this.name = "MetaApiError";
    this.status = status;
    this.payload = sanitizeMetaPayload(payload);
  }
}

function apiVersion(env: Env): string {
  return env.META_API_VERSION || DEFAULT_API_VERSION;
}

function adAccountId(env: Env): string {
  return env.META_AD_ACCOUNT_ID.startsWith("act_")
    ? env.META_AD_ACCOUNT_ID
    : `act_${env.META_AD_ACCOUNT_ID}`;
}

function valueForMeta(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function addParams(target: URLSearchParams, values: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue;
    target.set(name, valueForMeta(value));
  }
}

async function appSecretProof(accessToken: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(accessToken),
  );
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function timingSafeSecretMatch(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return timingSafeEqual(
    new Uint8Array(providedHash),
    new Uint8Array(expectedHash),
  );
}

export function sanitizeMetaPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeMetaPayload(item));
  if (value === null || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    const normalized = key.toLowerCase();
    if (
      normalized === "access_token"
      || normalized === "appsecret_proof"
      || normalized === "client_secret"
      || normalized === "app_secret"
    ) {
      continue;
    }
    if (key === "paging" && item && typeof item === "object" && !Array.isArray(item)) {
      const paging = item as Record<string, unknown>;
      output.paging = paging.cursors
        ? { cursors: sanitizeMetaPayload(paging.cursors) }
        : {};
      continue;
    }
    output[key] = sanitizeMetaPayload(item);
  }
  return output;
}

export function assertSafeObjectPath(path: string, env: Env): void {
  if (!objectPathSchema.safeParse(path).success || path.includes("..")) {
    throw new Error("Invalid Meta Graph object path");
  }
  if (path.startsWith("act_") && !path.startsWith(`${adAccountId(env)}/`) && path !== adAccountId(env)) {
    throw new Error(`Ad-account paths must be scoped to ${adAccountId(env)}`);
  }
}

function assertNoSecretFields(values: Record<string, unknown>): void {
  const forbidden = new Set([
    "access_token",
    "appsecret_proof",
    "client_secret",
    "app_secret",
  ]);
  for (const key of Object.keys(values)) {
    if (forbidden.has(key.toLowerCase())) {
      throw new Error(`Do not provide secret field ${key}; credentials come from Worker secrets`);
    }
  }
}

async function parseMetaResponse(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_META_RESPONSE_BYTES) {
    throw new Error("Meta response exceeded the configured safety limit");
  }
  const text = await response.text();
  if (text.length > MAX_META_RESPONSE_BYTES) {
    throw new Error("Meta response exceeded the configured safety limit");
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: "Meta returned a non-JSON response" } };
  }
}

async function metaFetch(env: Env, path: string, options: MetaOptions = {}): Promise<unknown> {
  assertSafeObjectPath(path, env);
  const method = options.method || "GET";
  const params = options.params || {};
  const body = options.body || {};
  assertNoSecretFields(params);
  assertNoSecretFields(body);

  const authorization = options.authorization || env.META_ACCESS_TOKEN;
  const url = new URL(`${GRAPH_ORIGIN}/${apiVersion(env)}/${path}`);
  addParams(url.searchParams, params);
  if (options.includeAppSecretProof !== false && env.META_APP_SECRET) {
    url.searchParams.set(
      "appsecret_proof",
      await appSecretProof(authorization, env.META_APP_SECRET),
    );
  }

  const headers = new Headers({ accept: "application/json" });
  headers.set("authorization", `Bearer ${authorization}`);
  const init: RequestInit = { method, headers };
  if (method !== "GET" && Object.keys(body).length > 0) {
    const form = new URLSearchParams();
    addParams(form, body);
    headers.set("content-type", "application/x-www-form-urlencoded");
    init.body = form.toString();
  }

  const response = await fetch(url, init);
  const payload = await parseMetaResponse(response);
  if (!response.ok) throw new MetaApiError(response.status, payload);
  return options.sanitizeResponse === false ? payload : sanitizeMetaPayload(payload);
}

export async function getPageAccessToken(env: Env): Promise<string> {
  const payload = await metaFetch(env, "me/assigned_pages", {
    params: { fields: "id,name,access_token,tasks", limit: 100 },
    sanitizeResponse: false,
  }) as { data?: Array<Record<string, unknown>> };
  const page = payload.data?.find((item) => String(item.id || "") === env.META_PAGE_ID);
  const accessToken = page?.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error(
      `No Page access token is available for ${env.META_PAGE_ID}; assign the White5 Page to the System User with MANAGE_LEADS`,
    );
  }
  return accessToken;
}

async function leadFetch(
  env: Env,
  path: string,
  options: Omit<MetaOptions, "authorization"> = {},
): Promise<unknown> {
  const pageAccessToken = await getPageAccessToken(env);
  return metaFetch(env, path, { ...options, authorization: pageAccessToken });
}

export async function fetchLeadForms(
  env: Env,
  limit: number,
  after?: string,
): Promise<unknown> {
  return leadFetch(env, `${env.META_PAGE_ID}/leadgen_forms`, {
    params: collectionParams("id,name,status,created_time,leads_count,locale", limit, after),
  });
}

async function metaOutcome(
  env: Env,
  path: string,
  options: MetaOptions = {},
): Promise<Record<string, unknown>> {
  try {
    return { ok: true, data: await metaFetch(env, path, options) };
  } catch (error) {
    if (error instanceof MetaApiError) {
      return { ok: false, status: error.status, error: error.message, meta: error.payload };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown Meta API error",
    };
  }
}

function asStructuredContent(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function textResult(value: unknown) {
  const sanitized = sanitizeMetaPayload(value);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(sanitized, null, 2) }],
    structuredContent: asStructuredContent(sanitized),
  };
}

function collectionParams(
  fields: string,
  limit: number,
  after: string | undefined,
): Record<string, unknown> {
  return { fields, limit, ...(after ? { after } : {}) };
}

async function connectionStatus(env: Env): Promise<Record<string, unknown>> {
  const [account, page, tokenOwner, pixel] = await Promise.all([
    metaOutcome(env, adAccountId(env), { params: { fields: ACCOUNT_FIELDS } }),
    metaOutcome(env, env.META_PAGE_ID, {
      params: { fields: "id,name,username,verification_status,tasks" },
    }),
    metaOutcome(env, "me", { params: { fields: "id,name" } }),
    metaOutcome(env, env.META_PIXEL_ID, {
      params: { fields: "id,name,last_fired_time,is_created_by_business" },
    }),
  ]);

  return {
    ok: account.ok === true,
    service: SERVICE_NAME,
    apiVersion: apiVersion(env),
    assets: {
      businessId: env.META_BUSINESS_ID,
      adAccountId: adAccountId(env),
      pageId: env.META_PAGE_ID,
      pixelId: env.META_PIXEL_ID,
    },
    checks: { account, page, tokenOwner, pixel },
    pageAccessReady: page.ok === true,
    appSecretProofEnabled: Boolean(env.META_APP_SECRET),
    tokenInspectionEnabled: Boolean(env.META_APP_ID && env.META_APP_SECRET),
  };
}

async function inspectToken(env: Env): Promise<unknown> {
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    throw new Error("META_APP_ID and META_APP_SECRET are required for token inspection");
  }
  const appAccessToken = `${env.META_APP_ID}|${env.META_APP_SECRET}`;
  return metaFetch(env, "debug_token", {
    params: { input_token: env.META_ACCESS_TOKEN },
    authorization: appAccessToken,
    includeAppSecretProof: false,
  });
}

async function accountInsights(
  env: Env,
  level: z.infer<typeof insightLevelSchema>,
  datePreset: z.infer<typeof datePresetSchema>,
  limit: number,
  after?: string,
): Promise<unknown> {
  return metaFetch(env, `${adAccountId(env)}/insights`, {
    params: {
      fields: INSIGHT_FIELDS,
      level,
      date_preset: datePreset,
      limit,
      ...(after ? { after } : {}),
    },
  });
}

function writePreview(
  tool: string,
  method: MetaMethod,
  objectPath: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ok: true,
    dryRun: true,
    tool,
    request: { method, objectPath, body: sanitizeMetaPayload(body) },
    note: "No Meta API mutation was sent. Set dry_run=false and confirm_apply=true only after user approval.",
  };
}

function enforcePausedCreation(tool: string, body: Record<string, unknown>): Record<string, unknown> {
  if (tool === "create_campaign" || tool === "create_ad_set" || tool === "create_ad") {
    return { ...body, status: "PAUSED" };
  }
  return body;
}

async function executeMutation(
  env: Env,
  tool: string,
  objectPath: string,
  method: MetaMethod,
  rawBody: Record<string, unknown>,
  dryRun: boolean,
  confirmApply: boolean,
): Promise<unknown> {
  assertSafeObjectPath(objectPath, env);
  assertNoSecretFields(rawBody);
  const body = enforcePausedCreation(tool, rawBody);

  if (dryRun) return writePreview(tool, method, objectPath, body);
  if (!confirmApply) {
    throw new Error("Live Meta mutations require confirm_apply=true after explicit user approval");
  }
  return metaFetch(env, objectPath, { method, body });
}

function genericDescription(name: string, write: boolean): string {
  if (write) {
    return `White5 Meta Marketing API write operation: ${name}. Supply a Graph object path and form body. Defaults to dry-run and requires explicit confirmation for live changes.`;
  }
  return `White5 Meta Marketing API read operation: ${name}. Supply a safe Graph object path and query parameters.`;
}

function createServer(env: Env): McpServer {
  const server = new McpServer({ name: SERVICE_NAME, version: SERVICE_VERSION });

  server.registerTool(
    "white5_meta_tool_catalog",
    {
      description: "Always-visible catalog of the White5 Meta Ads connector capabilities and safety model.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => textResult({
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      apiVersion: apiVersion(env),
      toolCount: ALL_TOOL_NAMES.length,
      coreTools: CORE_TOOL_NAMES,
      readTools: GENERIC_READ_TOOL_NAMES,
      writeTools: GENERIC_WRITE_TOOL_NAMES,
      safety: {
        writeDefault: "dry_run",
        liveWriteRequirements: ["dry_run=false", "confirm_apply=true", "explicit user approval"],
        creationStatus: "PAUSED",
      },
    }),
  );

  server.registerTool(
    "get_meta_connection_status",
    {
      description: "Check the White5 Meta ad account, System User, Facebook Page, Pixel, and connector readiness without changing anything.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async () => textResult(await connectionStatus(env)),
  );

  server.registerTool(
    "inspect_meta_token",
    {
      description: "Inspect the configured Meta token validity, app ID, expiry, granular scopes, and user ID. Requires META_APP_ID and META_APP_SECRET.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async () => textResult(await inspectToken(env)),
  );

  server.registerTool(
    "get_account_overview",
    {
      description: "Read the configured White5 Meta ad-account identity, status, currency, timezone, balance, spend cap, and owning business.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async () => textResult(await metaFetch(env, adAccountId(env), {
      params: { fields: ACCOUNT_FIELDS },
    })),
  );

  server.registerTool(
    "list_campaigns",
    {
      description: "List White5 Meta campaigns with delivery status, objective, budgets, and timestamps.",
      inputSchema: {
        limit: limitSchema,
        after: z.string().min(1).max(1_000).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ limit, after }) => textResult(await metaFetch(env, `${adAccountId(env)}/campaigns`, {
      params: collectionParams(CAMPAIGN_FIELDS, limit, after),
    })),
  );

  server.registerTool(
    "get_account_insights",
    {
      description: "Read White5 Meta performance at account, campaign, ad-set, or ad level.",
      inputSchema: {
        level: insightLevelSchema.default("campaign"),
        date_preset: datePresetSchema.default("last_30d"),
        limit: limitSchema,
        after: z.string().min(1).max(1_000).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ level, date_preset, limit, after }) => textResult(
      await accountInsights(env, level, date_preset, limit, after),
    ),
  );

  server.registerTool(
    "get_campaign_insights",
    {
      description: "Read performance for one White5 Meta campaign.",
      inputSchema: {
        campaign_id: idSchema,
        date_preset: datePresetSchema.default("last_30d"),
        level: z.enum(["campaign", "adset", "ad"]).default("campaign"),
        limit: limitSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ campaign_id, date_preset, level, limit }) => textResult(
      await metaFetch(env, `${campaign_id}/insights`, {
        params: { fields: INSIGHT_FIELDS, date_preset, level, limit },
      }),
    ),
  );

  server.registerTool(
    "list_ad_sets",
    {
      description: "List White5 Meta ad sets with campaign, budget, optimization, targeting, schedule, and delivery status.",
      inputSchema: { limit: limitSchema, after: z.string().min(1).max(1_000).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ limit, after }) => textResult(await metaFetch(env, `${adAccountId(env)}/adsets`, {
      params: collectionParams(AD_SET_FIELDS, limit, after),
    })),
  );

  server.registerTool(
    "list_ads",
    {
      description: "List White5 Meta ads with campaign, ad set, creative, tracking, destination, and delivery status.",
      inputSchema: { limit: limitSchema, after: z.string().min(1).max(1_000).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ limit, after }) => textResult(await metaFetch(env, `${adAccountId(env)}/ads`, {
      params: collectionParams(AD_FIELDS, limit, after),
    })),
  );

  server.registerTool(
    "list_ad_creatives",
    {
      description: "List White5 Meta ad creatives and their Page story, asset-feed, thumbnail, and URL-tag configuration.",
      inputSchema: { limit: limitSchema, after: z.string().min(1).max(1_000).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ limit, after }) => textResult(await metaFetch(env, `${adAccountId(env)}/adcreatives`, {
      params: collectionParams(CREATIVE_FIELDS, limit, after),
    })),
  );

  server.registerTool(
    "diagnose_page_access",
    {
      description: "Verify whether the Meta System User can access the White5 Facebook Page and list assigned Page tasks. Use this for the previous creative permission error.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async () => textResult(await metaOutcome(env, env.META_PAGE_ID, {
      params: { fields: "id,name,username,verification_status,tasks,access_token" },
    })),
  );

  server.registerTool(
    "list_pixels",
    {
      description: "List Pixels assigned to the White5 ad account and compare them with the configured website Pixel.",
      inputSchema: { limit: limitSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ limit }) => textResult(await metaFetch(env, `${adAccountId(env)}/adspixels`, {
      params: { fields: "id,name,last_fired_time,is_created_by_business", limit },
    })),
  );

  server.registerTool(
    "list_lead_forms",
    {
      description: "List lead-generation forms owned by the White5 Facebook Page. Requires Page and lead permissions.",
      inputSchema: { limit: limitSchema, after: z.string().min(1).max(1_000).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ limit, after }) => textResult(await fetchLeadForms(env, limit, after)),
  );

  server.registerTool(
    "graph_get",
    {
      description: "Advanced bounded read-only Meta Graph API request for White5 diagnostics and unsupported read fields.",
      inputSchema: { object_path: objectPathSchema, params: paramsSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ object_path, params }) => textResult(await metaFetch(env, object_path, { params })),
  );

  server.registerTool(
    "graph_mutation",
    {
      description: "Advanced bounded Meta Graph mutation. Dry-run by default; live writes require explicit confirmation.",
      inputSchema: {
        object_path: objectPathSchema,
        method: z.enum(["POST", "DELETE"]).default("POST"),
        body: bodySchema,
        dry_run: z.boolean().default(true),
        confirm_apply: z.boolean().default(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ object_path, method, body, dry_run, confirm_apply }) => textResult(
      await executeMutation(env, "graph_mutation", object_path, method, body, dry_run, confirm_apply),
    ),
  );

  server.registerTool(
    "white5_meta_core",
    {
      description: "Compact always-visible entry point for the most common White5 Meta Ads reads when a client hides long tool lists.",
      inputSchema: {
        action: z.enum([
          "connection_status",
          "token_status",
          "account_overview",
          "campaigns",
          "account_insights",
          "campaign_insights",
          "ad_sets",
          "ads",
          "creatives",
          "page_access",
          "pixels",
          "lead_forms",
        ]),
        object_id: idSchema.optional(),
        date_preset: datePresetSchema.default("last_30d"),
        level: insightLevelSchema.default("campaign"),
        limit: limitSchema,
        after: z.string().min(1).max(1_000).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ action, object_id, date_preset, level, limit, after }) => {
      switch (action) {
        case "connection_status": return textResult(await connectionStatus(env));
        case "token_status": return textResult(await inspectToken(env));
        case "account_overview": return textResult(await metaFetch(env, adAccountId(env), { params: { fields: ACCOUNT_FIELDS } }));
        case "campaigns": return textResult(await metaFetch(env, `${adAccountId(env)}/campaigns`, { params: collectionParams(CAMPAIGN_FIELDS, limit, after) }));
        case "account_insights": return textResult(await accountInsights(env, level, date_preset, limit, after));
        case "campaign_insights": {
          if (!object_id) throw new Error("object_id is required for campaign_insights");
          return textResult(await metaFetch(env, `${object_id}/insights`, { params: { fields: INSIGHT_FIELDS, date_preset, level, limit } }));
        }
        case "ad_sets": return textResult(await metaFetch(env, `${adAccountId(env)}/adsets`, { params: collectionParams(AD_SET_FIELDS, limit, after) }));
        case "ads": return textResult(await metaFetch(env, `${adAccountId(env)}/ads`, { params: collectionParams(AD_FIELDS, limit, after) }));
        case "creatives": return textResult(await metaFetch(env, `${adAccountId(env)}/adcreatives`, { params: collectionParams(CREATIVE_FIELDS, limit, after) }));
        case "page_access": return textResult(await metaOutcome(env, env.META_PAGE_ID, { params: { fields: "id,name,username,verification_status,tasks" } }));
        case "pixels": return textResult(await metaFetch(env, `${adAccountId(env)}/adspixels`, { params: { fields: "id,name,last_fired_time,is_created_by_business", limit } }));
        case "lead_forms": return textResult(await fetchLeadForms(env, limit, after));
      }
    },
  );

  for (const name of GENERIC_READ_TOOL_NAMES) {
    server.registerTool(
      name,
      {
        description: genericDescription(name, false),
        inputSchema: { object_path: objectPathSchema, params: paramsSchema },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      },
      async ({ object_path, params }) => textResult(
        await (name === "get_lead_form" || name === "list_leads" || name === "get_lead"
          ? leadFetch(env, object_path, { params })
          : metaFetch(env, object_path, { params })),
      ),
    );
  }

  for (const name of GENERIC_WRITE_TOOL_NAMES) {
    const defaultMethod: MetaMethod = name.startsWith("delete_") ? "DELETE" : "POST";
    const destructive = name.startsWith("delete_")
      || name.startsWith("archive_")
      || name.startsWith("remove_")
      || name.includes("status");
    server.registerTool(
      name,
      {
        description: genericDescription(name, true),
        inputSchema: {
          object_path: objectPathSchema,
          body: bodySchema,
          method: z.enum(["POST", "DELETE"]).default(defaultMethod),
          dry_run: z.boolean().default(true),
          confirm_apply: z.boolean().default(false),
        },
        annotations: { readOnlyHint: false, destructiveHint: destructive, openWorldHint: true },
      },
      async ({ object_path, body, method, dry_run, confirm_apply }) => textResult(
        await executeMutation(env, name, object_path, method, body, dry_run, confirm_apply),
      ),
    );
  }

  return server;
}

function health(env: Env): Response {
  return Response.json({
    ok: true,
    service: "white5-meta-ads-mcp",
    version: SERVICE_VERSION,
    apiVersion: apiVersion(env),
    toolCount: ALL_TOOL_NAMES.length,
    assetsConfigured: {
      business: Boolean(env.META_BUSINESS_ID),
      adAccount: Boolean(env.META_AD_ACCOUNT_ID),
      page: Boolean(env.META_PAGE_ID),
      pixel: Boolean(env.META_PIXEL_ID),
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return health(env);

    if (!env.MCP_ACCESS_KEY || !env.META_ACCESS_TOKEN) {
      console.error(JSON.stringify({
        message: "required secrets missing",
        hasMcpKey: Boolean(env.MCP_ACCESS_KEY),
        hasMetaToken: Boolean(env.META_ACCESS_TOKEN),
      }));
      return Response.json({ error: "Service is not configured" }, { status: 503 });
    }

    const prefix = "/mcp/";
    if (!url.pathname.startsWith(prefix)) return new Response("Not found", { status: 404 });
    const suppliedKey = decodeURIComponent(url.pathname.slice(prefix.length));
    if (!suppliedKey || !(await timingSafeSecretMatch(suppliedKey, env.MCP_ACCESS_KEY))) {
      return new Response("Not found", { status: 404 });
    }

    console.log(JSON.stringify({
      message: "MCP request",
      method: request.method,
      service: "white5-meta-ads-mcp",
    }));

    try {
      const handler = createMcpHandler(() => createServer(env), {
        route: url.pathname,
      });
      return await handler(request, env, ctx);
    } catch (error) {
      console.error(JSON.stringify({
        message: "MCP request failed",
        error: error instanceof Error ? error.message : "Unknown error",
      }));
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
