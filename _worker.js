// Force a fresh Cloudflare Pages preview deployment.
import coreWorker from "./worker-core.js";
import { createPausedWindowCampaignWithProfileRetry } from "./meta-window-campaign-profile-retry.js";
import { createPausedDeckFenceCampaign } from "./meta-deck-fence-campaign.js";
import { handleDeckFenceQuoteV9 } from "./deck-fence-quote-api-v9.js";
import { handleDeckFenceConfigV6 } from "./deck-fence-quote-api-v6.js";
import { handleZohoStatus, handleZohoTestSend } from "./zoho-diagnostic-api.js";

class PrivacyFooterInjector {
  element(element) {
    element.append(' | <a href="/privacy.html">Privacy Policy</a>', { html: true });
  }
}

class ConsentInputInjector {
  element(element) {
    element.setAttribute("name", "consent");
    element.setAttribute("value", "yes");
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/meta/create-window-campaign") {
      return createPausedWindowCampaignWithProfileRetry(request, env);
    }

    if (url.pathname === "/api/meta/create-deck-fence-campaign") {
      return createPausedDeckFenceCampaign(request, env);
    }

    if (url.pathname === "/api/deck-fence-quote") {
      return handleDeckFenceQuoteV9(request, env);
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
      .on("#consent", new ConsentInputInjector())
      .transform(response);
  },
};
