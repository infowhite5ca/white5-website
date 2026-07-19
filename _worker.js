// Force a fresh Cloudflare Pages preview deployment.
import coreWorker from "./worker-core.js";
import { createPausedWindowCampaignWithProfileRetry } from "./meta-window-campaign-profile-retry.js";
import { handleDeckFenceQuoteV8 } from "./deck-fence-quote-api-v8.js";
import { handleDeckFenceConfigV6 } from "./deck-fence-quote-api-v6.js";
import { handleZohoStatus, handleZohoTestSend } from "./zoho-diagnostic-api.js";
import { handleZohoAttachmentDiagnostic } from "./zoho-attachment-diagnostic.js";
import { handleZohoAttachmentDiagnosticLink } from "./zoho-attachment-link.js";

class PrivacyFooterInjector {
  element(element) {
    element.append(' | <a href="/privacy.html">Privacy Policy</a>', { html: true });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/meta/create-window-campaign") {
      return createPausedWindowCampaignWithProfileRetry(request, env);
    }

    if (url.pathname === "/api/deck-fence-quote") {
      return handleDeckFenceQuoteV8(request, env);
    }

    if (url.pathname === "/api/deck-fence-config") {
      return handleDeckFenceConfigV6(request, env);
    }

    if (url.pathname === "/api/zoho/status") {
      return handleZohoStatus(request, env);
    }

    if (url.pathname === "/api/zoho/test-send") {
      return handleZohoTestSend(request, env);
    }

    if (url.pathname === "/api/zoho/attachment-diagnostic") {
      return handleZohoAttachmentDiagnostic(request, env);
    }

    if (url.pathname === "/api/zoho/attachment-diagnostic-7f3c9a2b") {
      return handleZohoAttachmentDiagnosticLink(request, env);
    }

    const response = await coreWorker.fetch(request, env, ctx);
    const contentType = response.headers.get("content-type") || "";

    if (
      !contentType.includes("text/html")
      || url.pathname.startsWith("/meta-admin")
      || url.pathname.startsWith("/zoho-admin")
    ) {
      return response;
    }

    return new HTMLRewriter()
      .on("footer .container", new PrivacyFooterInjector())
      .transform(response);
  },
};
