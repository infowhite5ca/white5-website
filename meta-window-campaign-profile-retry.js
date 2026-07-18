import { createPausedWindowCampaignWithBudgetFix } from "./meta-window-campaign-budget-fix.js";

const META_API_VERSION = "v25.0";
const AD = Object.freeze({
  name: "White5 | Window & Screen Cleaning | Image 1",
  landingPageUrl: "https://www.white5.ca/services.html#quote",
  imageUrl: "https://www.white5.ca/images/window-cleaning-1.jpg",
  primaryText: "Calgary homeowners — make your windows shine again. White5 provides careful window and screen cleaning, including interior and exterior windows, screens, and tracks. Get your free estimate online.",
  headline: "Window & Screen Cleaning",
  description: "Free estimates in Calgary",
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function createAppSecretProof(accessToken, appSecret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(accessToken),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getAdAccountId(env) {
  return env.META_AD_ACCOUNT_ID.startsWith("act_")
    ? env.META_AD_ACCOUNT_ID
    : `act_${env.META_AD_ACCOUNT_ID}`;
}

async function requestMeta(path, env, body) {
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/${path}`);
  url.searchParams.set("access_token", env.META_ACCESS_TOKEN);
  if (env.META_APP_SECRET) {
    url.searchParams.set(
      "appsecret_proof",
      await createAppSecretProof(env.META_ACCESS_TOKEN, env.META_APP_SECRET),
    );
  }

  const form = new URLSearchParams();
  for (const [name, value] of Object.entries(body)) {
    form.set(name, String(value));
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = { error: { message: "Meta returned a non-JSON response" } };
  }
  return { response, payload };
}

export async function createPausedWindowCampaignWithProfileRetry(request, env) {
  const initialResponse = await createPausedWindowCampaignWithBudgetFix(request, env);
  let initialPayload;

  try {
    initialPayload = await initialResponse.json();
  } catch {
    return initialResponse;
  }

  const shouldRetry =
    !initialPayload?.ok &&
    initialPayload?.step === "create_ad" &&
    initialPayload?.meta?.error?.error_subcode === 1341012 &&
    initialPayload?.ids?.adSetId;

  if (!shouldRetry) {
    return json(initialPayload, initialResponse.status);
  }

  const objectStorySpec = {
    page_id: env.META_PAGE_ID,
    link_data: {
      link: AD.landingPageUrl,
      picture: AD.imageUrl,
      message: AD.primaryText,
      name: AD.headline,
      description: AD.description,
      call_to_action: {
        type: "GET_QUOTE",
        value: { link: AD.landingPageUrl },
      },
    },
  };

  const accountId = getAdAccountId(env);
  const retry = await requestMeta(`${accountId}/ads`, env, {
    name: AD.name,
    adset_id: initialPayload.ids.adSetId,
    status: "PAUSED",
    creative: JSON.stringify({ object_story_spec: objectStorySpec }),
  });

  if (!retry.response.ok) {
    return json({
      ...initialPayload,
      step: "create_ad_without_instagram_actor",
      meta: retry.payload,
      adsStarted: false,
      spendEnabled: false,
    }, retry.response.status);
  }

  return json({
    ok: true,
    apiVersion: META_API_VERSION,
    idempotent: false,
    created: {
      campaign: false,
      adSet: false,
      ad: true,
    },
    ids: {
      campaignId: initialPayload.ids.campaignId,
      adSetId: initialPayload.ids.adSetId,
      adId: retry.payload.id,
    },
    configuration: {
      campaignName: "White5 | Window & Screen Cleaning | Calgary",
      objective: "OUTCOME_LEADS",
      destination: "WEBSITE",
      optimization: "LEAD",
      pixelId: "1587609516129238",
      dailyBudget: "20 CAD",
      location: "Calgary + 25 km, people living in this location",
      platforms: ["facebook", "instagram"],
      landingPageUrl: AD.landingPageUrl,
      imageUrl: AD.imageUrl,
      identity: "White5 Facebook Page; no explicit Instagram actor",
    },
    statuses: {
      campaign: "PAUSED",
      adSet: "PAUSED",
      ad: "PAUSED",
    },
    adsStarted: false,
    spendEnabled: false,
  });
}
