// White5 Cloudflare Pages Worker.
import coreWorker from "./worker-core.js";
import { createPausedWindowCampaignWithProfileRetry } from "./meta-window-campaign-profile-retry.js";
import { updateWindowAdWithWebsiteAndWhatsApp } from "./meta-window-ad-multichannel.js";
import { createPausedDeckFenceCampaignWithImageFallback } from "./meta-deck-fence-campaign-image-fallback.js";
import { inspectDeckAd } from "./meta-deck-ad-inspector.js";
import { handleMetaInsights } from "./meta-insights-api.js";
import { handleDeckFenceQuoteV9 } from "./deck-fence-quote-api-v9.js";
import { handleDeckFenceConfigV6 } from "./deck-fence-quote-api-v6.js";
import { handleZohoStatus, handleZohoTestSend } from "./zoho-diagnostic-api.js";
import { handleZohoInbox, handleZohoMessage } from "./zoho-mail-reader-api.js";
import { handleZohoTokenDiagnostic } from "./zoho-token-diagnostic.js";
import { handleWhite5AiChat } from "./white5-ai-chat-api-v3.js";

const CHAT_ASSETS = `
  <link rel="stylesheet" href="/white5-ai-chat.css?v=photo-1">
  <script defer src="/white5-ai-chat.js?v=photo-1"></script>
`;

class ChatHeadInjector {
  element(element) {
    element.append(CHAT_ASSETS, { html: true });
  }
}

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

    if (url.pathname === "/api/ai-chat") {
      return handleWhite5AiChat(request, env);
    }

    if (url.pathname === "/api/meta/create-window-campaign") {
      return createPausedWindowCampaignWithProfileRetry(request, env);
    }

    if (url.pathname === "/api/meta/update-window-ad-channels") {
      return updateWindowAdWithWebsiteAndWhatsApp(request, env);
    }

    if (url.pathname === "/api/meta/create-deck-fence-campaign") {
      return createPausedDeckFenceCampaignWithImageFallback(request, env);
    }

    if (url.pathname === "/api/meta/deck-ad") {
      return inspectDeckAd(request, env);
    }

    if (url.pathname === "/api/meta/insights") {
      return handleMetaInsights(request, env);
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

    if (url.pathname === "/api/zoho/inbox") {
      return handleZohoInbox(request, env);
    }

    if (url.pathname === "/api/zoho/message") {
      return handleZohoMessage(request, env);
    }

    if (url.pathname === "/api/zoho/token-diagnostic") {
      return handleZohoTokenDiagnostic(request, env);
    }

    const response = await coreWorker.fetch(request, env, ctx);
    const contentType = response.headers.get("content-type") || "";

    if (
      !contentType.includes("text/html")
      || url.pathname.startsWith("/meta-admin")
      || url.pathname.startsWith("/zoho-admin")
      || url.pathname.startsWith("/zoho-token-exchange")
    ) {
      return response;
    }

    return new HTMLRewriter()
      .on("head", new ChatHeadInjector())
      .on("footer .container", new PrivacyFooterInjector())
      .on("#consent", new ConsentInputInjector())
      .transform(response);
  },
};
