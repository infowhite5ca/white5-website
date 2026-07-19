import { handleZohoAttachmentDiagnostic } from "./zoho-attachment-diagnostic.js";

export async function handleZohoAttachmentDiagnosticLink(request, env) {
  const url = new URL(request.url);
  const isPreview = url.hostname.endsWith(".white5-website.pages.dev")
    && url.hostname !== "white5-website.pages.dev";

  if (!isPreview) {
    return new Response("Not found", { status: 404 });
  }
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (!env.ADMIN_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "ADMIN_API_KEY is not configured" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const internalRequest = new Request(request.url, {
    method: "POST",
    headers: { "x-admin-key": env.ADMIN_API_KEY },
  });
  return handleZohoAttachmentDiagnostic(internalRequest, env);
}
