import coreWorker from "./worker-core.js";
import { createPausedWindowCampaignWithBudgetFix } from "./meta-window-campaign-budget-fix.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/meta/create-window-campaign") {
      return createPausedWindowCampaignWithBudgetFix(request, env);
    }

    return coreWorker.fetch(request, env, ctx);
  },
};
