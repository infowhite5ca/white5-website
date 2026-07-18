import { createPausedWindowCampaign } from "./meta-window-campaign.js";

export async function createPausedWindowCampaignWithoutInstagramActor(request, env) {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async function patchedFetch(input, init) {
    if (init?.body && typeof init.body === "string" && init.body.includes("instagram_actor_id")) {
      const form = new URLSearchParams(init.body);
      const creative = form.get("creative");
      if (creative) {
        try {
          const parsed = JSON.parse(creative);
          if (parsed?.object_story_spec?.instagram_actor_id) {
            delete parsed.object_story_spec.instagram_actor_id;
            form.set("creative", JSON.stringify(parsed));
            init = { ...init, body: form.toString() };
          }
        } catch {
          // Preserve the original request if the creative payload cannot be parsed.
        }
      }
    }
    return originalFetch(input, init);
  };

  try {
    return await createPausedWindowCampaign(request, env);
  } finally {
    globalThis.fetch = originalFetch;
  }
}
