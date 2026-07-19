import coreWorker from "./worker-core.js";
import { createPausedWindowCampaignWithProfileRetry } from "./meta-window-campaign-profile-retry.js";
import { handleDeckFenceQuote, handleDeckFenceConfig } from "./deck-fence-quote-api.js";
import { handleZohoStatus, handleZohoTestSend } from "./zoho-diagnostic-api.js";

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
      return handleDeckFenceQuote(request, env);
    }

    if (url.pathname === "/api/deck-fence-config") {
      return handleDeckFenceConfig(request, env);
    }

    if (url.pathname === "/api/zoho/status") {
      return handleZohoStatus(request, env);
    }

    if (url.pathname === "/api/zoho/test-send") {
      return handleZohoTestSend(request, env);
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
