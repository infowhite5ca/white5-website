export const VERSION = "1.4.0";
export const ORIGIN = "https://white5-mcp.volodymyronufriichuk68.workers.dev";

export interface InternalMcpRequest {
  method: "tools/list" | "tools/call";
  name?: string;
  arguments?: Record<string, unknown>;
}

export interface White5ServiceBinding {
  status(): Promise<{ configured: boolean; connected?: boolean; capabilities?: Record<string, unknown>; category?: string }>;
  authorize(request: Request): Promise<Response>;
  rpc(request: InternalMcpRequest, gatewayAccessToken?: string): Promise<{
    isError?: boolean;
    content: any[];
    [key: string]: unknown;
  }>;
}

export interface Env {
  GOOGLE_ADS: White5ServiceBinding;
  META_ADS: White5ServiceBinding;
  SQUARE: White5ServiceBinding;
  ZOHO: White5ServiceBinding;
  GOOGLE_BUSINESS: White5ServiceBinding;
  MCP_ACCESS_KEY?: string;
}

export type Provider = "zoho" | "square" | "google_ads" | "meta_ads" | "google_business";
