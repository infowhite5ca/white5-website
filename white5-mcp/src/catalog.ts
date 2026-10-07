import currentTools from "./upstream-tools.json";
import type { Provider } from "./env";

export interface ToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
}

const googleBusinessTools: ToolDefinition[] = [
  {
    name: "connection_status",
    title: "Check GBP connection",
    description: "Checks the connected Google identity and access to Business Profile accounts.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "list_accounts",
    title: "List GBP accounts",
    description: "Lists Business Profile accounts owned or managed by the connected Google user.",
    inputSchema: {
      type: "object",
      properties: { pageSize: { type: "integer", minimum: 1, maximum: 20, default: 20 }, pageToken: { type: "string" } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "list_locations",
    title: "List GBP locations",
    description: "Lists locations for one Business Profile account.",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string" },
        pageSize: { type: "integer", minimum: 1, maximum: 100, default: 100 },
        pageToken: { type: "string" },
        readMask: { type: "string", minLength: 1, default: "name,title,storeCode,websiteUri,phoneNumbers,categories,regularHours,specialHours,serviceArea,metadata,profile" },
      },
      required: ["account"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "get_location",
    title: "Get GBP location",
    description: "Gets Business Profile location details using Business Information API.",
    inputSchema: {
      type: "object",
      properties: {
        location: { type: "string" },
        readMask: { type: "string", minLength: 1, default: "name,title,storeCode,websiteUri,phoneNumbers,categories,regularHours,specialHours,serviceArea,metadata,profile" },
      },
      required: ["location"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "list_reviews",
    title: "List GBP reviews",
    description: "Lists reviews for one Business Profile location.",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string" }, location: { type: "string" },
        pageSize: { type: "integer", minimum: 1, maximum: 50, default: 50 },
        pageToken: { type: "string" }, orderBy: { type: "string", enum: ["rating", "rating desc", "updateTime desc"] },
      },
      required: ["account", "location"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "list_posts",
    title: "List GBP posts",
    description: "Lists local posts for one Business Profile location.",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string" }, location: { type: "string" },
        pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 }, pageToken: { type: "string" },
      },
      required: ["account", "location"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "reply_to_review",
    title: "Reply to GBP review",
    description: "Replies to a review only after explicit confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        reviewName: { type: "string", pattern: "^accounts/[^/]+/locations/[^/]+/reviews/[^/]+$" },
        comment: { type: "string", minLength: 1, maxLength: 4096 }, confirmed: { type: "boolean", default: false },
      },
      required: ["reviewName", "comment"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
];

export const upstream = {
  ...(currentTools as Record<string, ToolDefinition[]>),
  google_business: googleBusinessTools,
} as Record<Provider, ToolDefinition[]>;

export const aliases: Array<{ name: string; provider: Provider; upstream: string; description?: string }> = [
  ...["search_emails", "read_email", "send_email", "send_email_with_attachments", "reply_email", "send_calendar_invite", "update_calendar_invite", "cancel_calendar_invite", "list_emails"].map((name) => ({ name, provider: "zoho" as const, upstream: name })),
  { name: "list_email_folders", provider: "zoho", upstream: "list_folders" },
  { name: "create_email_draft", provider: "zoho", upstream: "create_draft", description: "Create a Zoho email draft, including real attachments. Never sends. Requires confirmed:true; otherwise returns a local preview." },
  ...["search_customers", "create_customer", "get_customer", "get_invoice", "create_estimate", "get_customer_history", "square_connection_check", "generate_calendar_ics", "prepare_customer_reminder"].map((name) => ({ name, provider: "square" as const, upstream: name })),
  { name: "list_square_locations", provider: "square", upstream: "list_locations" },
  { name: "create_invoice", provider: "square", upstream: "create_draft_invoice", description: "Create a Square DRAFT invoice and its order only after confirmed:true. Never publishes, sends, charges or emails. Without confirmation returns a local preview." },
  { name: "get_google_ads_summary", provider: "google_ads", upstream: "get_account_performance" },
  { name: "get_google_ads_campaigns", provider: "google_ads", upstream: "list_campaigns" },
  { name: "get_google_ads_search_terms", provider: "google_ads", upstream: "get_search_terms" },
  { name: "update_google_ads_budget", provider: "google_ads", upstream: "update_campaign_daily_budget" },
  { name: "get_google_ads_campaign_settings", provider: "google_ads", upstream: "get_campaign_settings" },
  { name: "get_google_ads_assets", provider: "google_ads", upstream: "list_assets" },
  { name: "get_google_ads_keywords", provider: "google_ads", upstream: "list_keywords" },
  { name: "get_google_ads_accounts", provider: "google_ads", upstream: "list_accessible_accounts" },
  { name: "get_meta_ads_summary", provider: "meta_ads", upstream: "get_account_insights" },
  { name: "get_meta_campaigns", provider: "meta_ads", upstream: "list_campaigns" },
  { name: "get_meta_ad_sets", provider: "meta_ads", upstream: "list_ad_sets" },
  { name: "get_meta_ads", provider: "meta_ads", upstream: "list_ads" },
  { name: "gbp_connection_status", provider: "google_business", upstream: "connection_status" },
  { name: "list_gbp_accounts", provider: "google_business", upstream: "list_accounts" },
  { name: "list_gbp_locations", provider: "google_business", upstream: "list_locations" },
  { name: "get_gbp_location", provider: "google_business", upstream: "get_location" },
  { name: "list_gbp_reviews", provider: "google_business", upstream: "list_reviews" },
  { name: "list_gbp_posts", provider: "google_business", upstream: "list_posts" },
  { name: "reply_to_gbp_review", provider: "google_business", upstream: "reply_to_review", description: "Preview a Google Business Profile review reply by default. Sending requires confirmed:true after explicit user approval." },
];

export function findTool(provider: Provider, name: string): ToolDefinition {
  const tool = upstream[provider]?.find((entry) => entry.name === name);
  if (!tool) throw new Error(`Unknown ${provider} tool: ${name}`);
  return tool;
}
