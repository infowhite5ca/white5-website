// White5 Cloudflare Pages Worker.
import coreWorker from "./worker-core.js";
import { createPausedWindowCampaignWithProfileRetry } from "./meta-window-campaign-profile-retry.js";
import { updateWindowAdWithWebsiteAndWhatsApp } from "./meta-window-ad-multichannel.js";
import { createPausedDeckFenceCampaignWithImageFallback } from "./meta-deck-fence-campaign-image-fallback.js";
import { inspectDeckAd } from "./meta-deck-ad-inspector.js";
import { handleMetaInsights } from "./meta-insights-api-v2.js";
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

const HOME_FAQ_CONTENT = `<div class="container">
  <div class="section-head">
    <h2>Frequently Asked Questions</h2>
    <p>Clear answers about pricing, appointments, preparation, insurance, and expected results.</p>
  </div>
  <div class="faq-grid">
    <article class="faq-card">
      <h3>How much does window cleaning cost in Calgary?</h3>
      <p>Pricing depends on the number and size of windows, property height, access, and the services selected. White5 provides free estimates, and clear photos help us quote more accurately.</p>
    </article>
    <article class="faq-card">
      <h3>Do you clean gutters and eavestroughs in Calgary?</h3>
      <p>Yes. Standard cleaning includes accessible debris removal, a basic downspout-flow check, and a visual inspection of the cleaned areas.</p>
    </article>
    <article class="faq-card">
      <h3>Do you offer power washing for driveways and patios?</h3>
      <p>Yes. White5 cleans suitable driveways, sidewalks, patios, siding, decks, fences, and other exterior surfaces using a method appropriate for the material and condition.</p>
    </article>
    <article class="faq-card">
      <h3>Do you provide free estimates?</h3>
      <p>Yes. Estimates are free. You can use the online estimator or send your address, service details, and photos for a more accurate quote.</p>
    </article>
    <article class="faq-card">
      <h3>What areas do you serve?</h3>
      <p>White5 serves Calgary and nearby communities, including Airdrie, Chestermere, and Okotoks. Availability may depend on the location and size of the job.</p>
    </article>
    <article class="faq-card">
      <h3>Is White5 insured?</h3>
      <p>Yes. White5 carries $2 million in liability insurance for exterior cleaning work. Proof of insurance can be provided when required.</p>
    </article>
    <article class="faq-card">
      <h3>Do I need to be home?</h3>
      <p>For exterior-only work, usually not, as long as safe access has been arranged. Someone must be present when interior access is required unless another arrangement is confirmed.</p>
    </article>
    <article class="faq-card">
      <h3>What happens if the weather is bad?</h3>
      <p>Light rain may not stop the work, but heavy rain, thunderstorms, strong winds, freezing temperatures, or unsafe roof conditions may require rescheduling.</p>
    </article>
    <article class="faq-card">
      <h3>Will purified water remove hard-water stains?</h3>
      <p>Purified water removes normal dirt and residue, but established mineral staining or glass damage may require separate restoration treatment.</p>
    </article>
    <article class="faq-card">
      <h3>What should I send for an accurate quote?</h3>
      <p>Send the property address, requested service, number of storeys, clear photos, access concerns, and details about heavy buildup, damage, or special stains.</p>
    </article>
  </div>
  <div class="hero-actions">
    <a class="water-btn" href="/faq.html">View All Questions</a>
  </div>
</div>`;

class ChatHeadInjector {
  element(element) {
    element.append(CHAT_ASSETS, { html: true });
  }
}

class NavigationFaqInjector {
  element(element) {
    element.append('<a href="/faq.html">FAQ</a>', { html: true });
  }
}

class HomeFaqRewriter {
  element(element) {
    element.setInnerContent(HOME_FAQ_CONTENT, { html: true });
  }
}

class PrivacyFooterInjector {
  element(element) {
    element.append(' | <a href="/faq.html">FAQ</a> | <a href="/privacy.html">Privacy Policy</a>', { html: true });
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

    let rewriter = new HTMLRewriter()
      .on("head", new ChatHeadInjector())
      .on("nav.nav", new NavigationFaqInjector())
      .on("footer .container", new PrivacyFooterInjector())
      .on("#consent", new ConsentInputInjector());

    if (url.pathname === "/" || url.pathname === "/index.html") {
      rewriter = rewriter.on("#faq", new HomeFaqRewriter());
    }

    return rewriter.transform(response);
  },
};
