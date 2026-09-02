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

const SITE_SHELL_ASSETS = `
  <link rel="stylesheet" href="/site.css?v=ia-20260902">
  <script defer src="/site.js?v=ia-20260902"></script>
`;

const SITE_HEADER_HTML = "<div class=\"site-header__inner\">\n  <a class=\"site-logo\" href=\"/\" aria-label=\"White5 home\"><img src=\"/logo.png\" alt=\"White5 Exterior Cleaning\"></a>\n  <button class=\"nav-toggle\" type=\"button\" aria-expanded=\"false\" aria-controls=\"site-menu\" aria-label=\"Open menu\"><span class=\"nav-toggle__bars\" aria-hidden=\"true\"></span></button>\n  <nav class=\"site-nav\" id=\"site-menu\" aria-label=\"Main navigation\">\n    <a href=\"/\">Home</a>\n    <div class=\"nav-dropdown\">\n      <button class=\"nav-dropdown__button\" type=\"button\" aria-expanded=\"false\">Services <span class=\"chevron\" aria-hidden=\"true\"></span></button>\n      <div class=\"nav-dropdown__menu\">\n        <a href=\"/window-cleaning\">Window Cleaning</a>\n        <a href=\"/gutter-cleaning\">Gutter Cleaning</a>\n        <a href=\"/pressure-washing\">Pressure Washing</a>\n        <a href=\"/deck-cleaning-staining\">Deck Cleaning &amp; Staining</a>\n      </div>\n    </div>\n    <a href=\"/#gallery\">Gallery</a>\n    <a href=\"/#about\">About</a>\n    <a href=\"/#contact\">Contact</a>\n    <a class=\"site-nav__cta\" href=\"/services.html#estimate\">Get Free Estimate</a>\n  </nav>\n</div>";

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

class HtmlAppender {
  constructor(content) {
    this.content = content;
  }

  element(element) {
    element.append(this.content, { html: true });
  }
}

class MainHeaderRewriter {
  element(element) {
    element.setInnerContent(SITE_HEADER_HTML, { html: true });
    element.setAttribute("class", "topbar site-header");
  }
}

class PrivacyFooterInjector {
  element(element) {
    element.append(' | <a href="/#faq">FAQ</a> | <a href="/privacy.html">Privacy Policy</a>', { html: true });
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

    if (url.pathname === "/faq" || url.pathname === "/faq.html") {
      return Response.redirect(new URL("/#faq", url), 301);
    }

    if (url.pathname === "/gallery" || url.pathname === "/gallery.html") {
      return Response.redirect(new URL("/#gallery", url), 301);
    }

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
      .on("head", new HtmlAppender(CHAT_ASSETS + SITE_SHELL_ASSETS))
      .on("header.topbar", new MainHeaderRewriter())
      .on("footer .container", new PrivacyFooterInjector())
      .on("#consent", new ConsentInputInjector());

    if (!GOOGLE_TAG_ALREADY_EMBEDDED_PATHS.has(url.pathname)) {
      rewriter = rewriter.on("head", new HtmlAppender(GOOGLE_ADS_TAG_SCRIPT));
    }

    const isHomePage = url.pathname === "/" || url.pathname === "/index.html";

    if (isHomePage) {
      rewriter = rewriter.on("head", new HtmlAppender(HOME_SERVICE_STYLES));
    }

    if (url.pathname === "/services" || url.pathname === "/services.html") {
      rewriter = rewriter.on("head", new HtmlAppender(SERVICES_BACKGROUND_STYLES));
    }

    const transformedResponse = rewriter.transform(response);

    if (isHomePage) {
      const freshHeaders = new Headers(transformedResponse.headers);
      freshHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate");
      freshHeaders.set("Pragma", "no-cache");
      freshHeaders.set("Expires", "0");
      freshHeaders.delete("ETag");
      freshHeaders.delete("Content-Length");

      return new Response(transformedResponse.body, {
        status: transformedResponse.status,
        statusText: transformedResponse.statusText,
        headers: freshHeaders,
      });
    }

    return transformedResponse;
  },
};
