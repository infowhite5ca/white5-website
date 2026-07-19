import { createPausedDeckFenceCampaignWithBudgetFix } from "./meta-deck-fence-campaign-budget-fix.js";

const META_API_VERSION = "v25.0";
const AD_NAME = "White5 | Deck & Fence Renovation | Deck Photo 1";
const LANDING_PAGE_URL = "https://www.white5.ca/deck-fence-quote.html";
const FALLBACK_IMAGE_URL = "https://www.white5.ca/images/power-washing-1.jpg";

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

async function requestMeta(path, env, params = {}, options = {}) {
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/${path}`);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
  }
  url.searchParams.set("access_token", env.META_ACCESS_TOKEN);
  if (env.META_APP_SECRET) {
    url.searchParams.set(
      "appsecret_proof",
      await createAppSecretProof(env.META_ACCESS_TOKEN, env.META_APP_SECRET),
    );
  }

  const init = {
    method: options.method || "GET",
    headers: { accept: "application/json" },
  };
  if (options.body) {
    const form = new URLSearchParams();
    for (const [name, value] of Object.entries(options.body)) {
      if (value !== undefined && value !== null) form.set(name, String(value));
    }
    init.headers["content-type"] = "application/x-www-form-urlencoded";
    init.body = form.toString();
  }

  const response = await fetch(url, init);
  let payload;
  try { payload = await response.json(); }
  catch { payload = { error: { message: "Meta returned a non-JSON response" } }; }
  return { response, payload };
}

export async function createPausedDeckFenceCampaignWithImageFallback(request, env) {
  const initialResponse = await createPausedDeckFenceCampaignWithBudgetFix(request, env);
  const initialPayload = await initialResponse.clone().json().catch(() => null);

  if (
    initialResponse.ok
    || initialPayload?.step !== "create_ad"
    || initialPayload?.meta?.error?.error_subcode !== 2446496
    || !initialPayload?.ids?.adSetId
  ) {
    return initialResponse;
  }

  const accountId = getAdAccountId(env);
  const adSetId = initialPayload.ids.adSetId;

  const existing = await requestMeta(`${adSetId}/ads`, env, {
    fields: "id,name,status,effective_status",
    limit: 100,
  });

  if (!existing.response.ok) {
    return json({
      ...initialPayload,
      step: "list_ads_before_image_fallback",
      meta: existing.payload,
    }, existing.response.status);
  }

  const existingAd = (Array.isArray(existing.payload?.data) ? existing.payload.data : [])
    .find((item) => item?.name === AD_NAME);

  if (existingAd?.id) {
    return json({
      ok: true,
      created: { campaign: false, adSet: false, ad: false },
      ids: {
        campaignId: initialPayload.ids.campaignId,
        adSetId,
        adId: existingAd.id,
      },
      imageFallbackUsed: true,
      imageUrl: FALLBACK_IMAGE_URL,
      statuses: { campaign: "PAUSED", adSet: "PAUSED", ad: "PAUSED" },
      adsStarted: false,
      spendEnabled: false,
    });
  }

  const creative = {
    object_story_spec: {
      page_id: env.META_PAGE_ID,
      link_data: {
        link: LANDING_PAGE_URL,
        picture: FALLBACK_IMAGE_URL,
        message: "Calgary homeowners — is your deck or fence looking grey, worn, or weathered? White5 provides careful washing, sanding, staining, and minor wood repairs. Send us a few photos and request your free estimate online.",
        name: "Restore Your Deck or Fence",
        description: "Free estimate in Calgary & area",
        call_to_action: {
          type: "GET_QUOTE",
          value: { link: LANDING_PAGE_URL },
        },
      },
    },
  };

  const created = await requestMeta(`${accountId}/ads`, env, {}, {
    method: "POST",
    body: {
      name: AD_NAME,
      adset_id: adSetId,
      status: "PAUSED",
      creative: JSON.stringify(creative),
    },
  });

  if (!created.response.ok) {
    return json({
      ok: false,
      error: "Meta API request failed",
      step: "create_ad_with_fallback_image",
      created: { campaign: false, adSet: false, ad: false },
      ids: {
        campaignId: initialPayload.ids.campaignId,
        adSetId,
        adId: null,
      },
      meta: created.payload,
      imageFallbackUsed: true,
      imageUrl: FALLBACK_IMAGE_URL,
      adsStarted: false,
      spendEnabled: false,
    }, created.response.status);
  }

  return json({
    ok: true,
    created: { campaign: false, adSet: false, ad: true },
    ids: {
      campaignId: initialPayload.ids.campaignId,
      adSetId,
      adId: created.payload.id,
    },
    imageFallbackUsed: true,
    imageUrl: FALLBACK_IMAGE_URL,
    statuses: { campaign: "PAUSED", adSet: "PAUSED", ad: "PAUSED" },
    adsStarted: false,
    spendEnabled: false,
  });
}
