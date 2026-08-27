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
import { handleServiceRequest } from "./service-request-api.js";

const GOOGLE_ADS_TAG_ID = "AW-18208326566";
const GOOGLE_ADS_TAG_SCRIPT = `
  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_TAG_ID}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${GOOGLE_ADS_TAG_ID}');
  </script>
`;

const GOOGLE_TAG_ALREADY_EMBEDDED_PATHS = new Set([
  "/",
  "/index.html",
  "/gallery.html",
  "/services.html",
  "/deck-fence-quote.html",
]);

const CHAT_ASSETS = `
  <link rel="stylesheet" href="/white5-ai-chat.css?v=optional-contact-1">
  <script defer src="/white5-ai-chat.js?v=optional-contact-1"></script>
`;

const SERVICES_BACKGROUND_STYLES = `
  <style id="white5-service-backgrounds">
    #estimate > .container > .service-row {
      display: block;
      position: relative;
      overflow: hidden;
      isolation: isolate;
      border: 1px solid rgba(255,255,255,.18);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      background-size: cover;
      background-repeat: no-repeat;
      background-position: center;
    }

    #estimate > .container > .service-row:nth-of-type(1) {
      background-image:
        linear-gradient(180deg, rgba(4,18,30,.48), rgba(4,18,30,.76)),
        url('/images/window-cleaning-4.jpg');
      background-position: center 42%;
    }

    #estimate > .container > .service-row:nth-of-type(2) {
      background-image:
        linear-gradient(180deg, rgba(4,22,25,.46), rgba(4,22,25,.76)),
        url('/images/gutter-cleaning-1.jpg');
      background-position: center 45%;
    }

    #estimate > .container > .service-row:nth-of-type(3) {
      background-image:
        linear-gradient(180deg, rgba(5,17,27,.48), rgba(5,17,27,.78)),
        url('/images/power-washing-1.jpg');
      background-position: center 50%;
    }

    #estimate .service-row .service-photo {
      display: none;
    }

    #estimate .service-row .service-content {
      min-height: 520px;
      padding: 26px;
      border: 0;
      border-radius: inherit;
      background: linear-gradient(180deg, rgba(5,18,30,.08), rgba(5,18,30,.28));
      box-shadow: none;
      backdrop-filter: none;
    }

    #estimate .service-row .option-card {
      background: rgba(7,25,35,.62);
      border-color: rgba(255,255,255,.2);
      box-shadow: 0 8px 22px rgba(0,0,0,.14);
      backdrop-filter: blur(5px);
    }

    #estimate .service-row .service-toggle,
    #estimate .service-row .counter button,
    #estimate .service-row .story-btn,
    #estimate .service-row .surface-btn,
    #estimate .service-row .roof-btn {
      background-color: rgba(7,25,35,.62);
      backdrop-filter: blur(4px);
    }

    #estimate .service-row .note,
    #estimate .service-row p,
    #estimate .service-row .unit,
    #estimate .service-row .counter-row {
      color: rgba(245,251,255,.94);
      text-shadow: 0 1px 3px rgba(0,0,0,.78);
    }

    @media (max-width: 1060px) {
      #estimate .service-row .service-content {
        min-height: 0;
      }
    }

    @media (max-width: 640px) {
      #estimate > .container > .service-row {
        border-radius: 20px;
        background-position: center;
      }

      #estimate > .container > .service-row:nth-of-type(1) {
        background-position: 48% center;
      }

      #estimate > .container > .service-row:nth-of-type(2) {
        background-position: 58% center;
      }

      #estimate > .container > .service-row:nth-of-type(3) {
        background-position: 52% center;
      }

      #estimate .service-row .service-content {
        padding: 18px;
        background: linear-gradient(180deg, rgba(4,18,29,.2), rgba(4,18,29,.38));
      }

      #estimate .service-row .option-card {
        background: rgba(7,25,35,.7);
      }
    }
  </style>
`;

const HOME_SERVICE_STYLES = `
  <style id="white5-home-service-backgrounds">
    #services .services-grid > .service-card {
      overflow: hidden;
      position: relative;
      isolation: isolate;
      min-height: 390px;
      background-size: cover;
      background-repeat: no-repeat;
      border-color: rgba(255,255,255,.24);
      box-shadow: 0 18px 46px rgba(0,0,0,.3);
    }

    #services .services-grid > .service-card:nth-child(1) {
      background-image:
        linear-gradient(180deg, rgba(4,18,30,.42), rgba(4,18,30,.82)),
        url('/images/window-cleaning-4.jpg');
      background-position: center 44%;
    }

    #services .services-grid > .service-card:nth-child(2) {
      background-image:
        linear-gradient(180deg, rgba(4,22,25,.42), rgba(4,22,25,.82)),
        url('/images/gutter-cleaning-1.jpg');
      background-position: center 46%;
    }

    #services .services-grid > .service-card:nth-child(3) {
      background-image:
        linear-gradient(180deg, rgba(5,17,27,.38), rgba(5,17,27,.82)),
        url('/images/home-power-washing-deck.webp');
      background-position: center 48%;
    }

    #services .service-card h3,
    #services .service-card p,
    #services .service-card li {
      color: #fff;
      text-shadow: 0 2px 5px rgba(0,0,0,.9);
    }

    #services .service-card ul {
      color: #fff;
    }

    #services .service-card .ghost-btn {
      background: rgba(5,18,30,.58);
      border-color: rgba(255,255,255,.26);
      backdrop-filter: blur(5px);
    }

    @media (max-width: 1060px) {
      #services .services-grid > .service-card {
        min-height: 360px;
      }
    }

    @media (max-width: 640px) {
      #services .services-grid > .service-card {
        min-height: 380px;
      }

      #services .services-grid > .service-card:nth-child(1) {
        background-position: 48% center;
      }

      #services .services-grid > .service-card:nth-child(2) {
        background-position: 56% center;
      }

      #services .services-grid > .service-card:nth-child(3) {
        background-position: 52% center;
      }
    }
  </style>
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

class HtmlAppender {
  constructor(content) {
    this.content = content;
  }

  element(element) {
    element.append(this.content, { html: true });
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
      return handleWhite5AiChat(request, env, ctx);
    }

    if (url.pathname === "/api/service-request") {
      return handleServiceRequest(request, env);
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
      .on("head", new HtmlAppender(CHAT_ASSETS))
      .on("nav.nav", new NavigationFaqInjector())
      .on("footer .container", new PrivacyFooterInjector())
      .on("#consent", new ConsentInputInjector());

    if (!GOOGLE_TAG_ALREADY_EMBEDDED_PATHS.has(url.pathname)) {
      rewriter = rewriter.on("head", new HtmlAppender(GOOGLE_ADS_TAG_SCRIPT));
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      rewriter = rewriter
        .on("head", new HtmlAppender(HOME_SERVICE_STYLES))
        .on("#faq", new HomeFaqRewriter());
    }

    if (url.pathname === "/services" || url.pathname === "/services.html") {
      rewriter = rewriter.on("head", new HtmlAppender(SERVICES_BACKGROUND_STYLES));
    }

    return rewriter.transform(response);
  },
};
