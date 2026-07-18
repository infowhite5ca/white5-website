import coreWorker from "./worker-core.js";
import { createPausedWindowCampaignWithBudgetFix } from "./meta-window-campaign-budget-fix.js";

class PrivacyFooterInjector {
  element(element) {
    element.append(' | <a href="/privacy.html">Privacy Policy</a>', { html: true });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/meta/create-window-campaign") {
      return createPausedWindowCampaignWithBudgetFix(request, env);
    }

    const response = await coreWorker.fetch(request, env, ctx);
    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("text/html") || url.pathname.startsWith("/meta-admin")) {
      return response;
    }

    return new HTMLRewriter()
      .on("footer .container", new PrivacyFooterInjector())
      .transform(response);
  },
};
