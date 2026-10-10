import { VERSION, type Env, type White5ServiceBinding } from "./env";
async function timeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Health check timed out.")), 12000); })]); }
  finally { clearTimeout(timer); }
}
export async function health(env: Env, token?: string) {
  const services: Record<string, boolean | null> = {};
  const checks: Record<string, unknown> = {};
  let limitedGbp = false;
  const read = async (key: string, service: White5ServiceBinding, name: string) => {
    try {
      const result = await timeout(service.rpc({ method: "tools/call", name, arguments: {} }, key === "zoho" ? token : undefined));
      const data = JSON.parse(result.content?.find(item => item.type === "text")?.text || "{}");
      services[key] = !result.isError && data.connected !== false && data.ok !== false;
      checks[key] = { checked: true, healthy: services[key] };
    } catch { services[key] = false; checks[key] = { checked: true, healthy: false }; }
  };
  await Promise.all([
    token ? read("zoho", env.ZOHO, "list_folders") : (async () => {
      // Zoho credentials are per-user. Do not call configuration presence a successful API check.
      try { const state = await timeout(env.ZOHO.status()); services.zoho = null; checks.zoho = { configured: state.configured, checked: false, reason: "Bearer authorization required for a live mailbox check" }; }
      catch { services.zoho = false; checks.zoho = { configured: false, checked: false }; }
    })(),
    read("square", env.SQUARE, "square_connection_check"),
    read("google_ads", env.GOOGLE_ADS, "list_accessible_accounts"),
    read("meta_ads", env.META_ADS, "get_meta_connection_status"),
    (async () => {
      try { const state = await timeout(env.GOOGLE_BUSINESS.status()); services.gbp = state.connected === true; limitedGbp = Object.values(state.capabilities ?? {}).some(capability => (capability as { available?: boolean }).available === false); checks.gbp = { checked: true, connected: state.connected === true, capabilities: state.capabilities, category: state.category }; }
      catch { services.gbp = false; checks.gbp = { checked: true, connected: false }; }
    })(),
  ]);
  services.google_business = services.gbp; // Keep the old health key for existing clients.
  const ready = ["zoho", "square", "google_ads", "meta_ads"].every(key => services[key] !== false);
  return Response.json({ ok: ready, service: "white5-mcp", version: VERSION, degraded: limitedGbp || Object.values(services).some(value => value !== true), services, checks }, { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } });
}
