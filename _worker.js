import coreWorker from "./worker-core.js";
import { createPausedWindowCampaign } from "./meta-window-campaign.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/meta/create-window-campaign") {
      return createPausedWindowCampaign(request, env);
    }

    return coreWorker.fetch(request, env, ctx);
  },
};
