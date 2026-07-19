const META_API_VERSION = "v25.0";

const CAMPAIGN = Object.freeze({
  campaignName: "White5 | Deck & Fence Renovation | Calgary",
  adSetName: "White5 | Calgary +25 km | Website Leads | 20 CAD",
  adName: "White5 | Deck & Fence Renovation | Deck Photo 1",
  dailyBudgetMinor: 2000,
  pixelId: "1587609516129238",
  landingPageUrl: "https://www.white5.ca/deck-fence-quote.html",
  imageUrl: "https://www.white5.ca/images/meta-deck-ad.jpg",
  primaryText: "Calgary homeowners — is your deck or fence looking grey, worn, or weathered? White5 provides careful washing, sanding, staining, and minor wood repairs. Send us a few photos and request your free estimate online.",
  headline: "Restore Your Deck or Fence",
  description: "Free estimate in Calgary & area",
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

function validateRequest(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!env.ADMIN_API_KEY) return json({ ok: false, error: "ADMIN_API_KEY is not configured" }, 500);
  if (request.headers.get("x-admin-key") !== env.ADMIN_API_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

  const required = ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID", "META_PAGE_ID"];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) return json({ ok: false, error: "Missing Cloudflare secrets", missing }, 500);
  return null;
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

function findByName(payload, name) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data.find((item) => item?.name === name) || null;
}

function failure(result, step, created, ids) {
  return json({
    ok: false,
    error: "Meta API request failed",
    step,
    created,
    ids,
    meta: result.payload,
    adsStarted: false,
    spendEnabled: false,
  }, result.response.status);
}

async function findCalgary(env) {
  const result = await requestMeta("search", env, {
    type: "adgeolocation",
    q: "Calgary",
    country_code: "CA",
    location_types: JSON.stringify(["city"]),
    limit: 25,
  });
  if (!result.response.ok) return result;

  const locations = Array.isArray(result.payload.data) ? result.payload.data : [];
  const match = locations.find((item) =>
    item?.name === "Calgary" &&
    item?.country_code === "CA" &&
    (!item?.region || item.region === "Alberta"),
  ) || locations.find((item) => item?.name === "Calgary" && item?.country_code === "CA");

  if (!match?.key) {
    return {
      response: new Response(null, { status: 404 }),
      payload: { error: { message: "Calgary targeting location was not found" } },
    };
  }
  return { response: result.response, payload: match };
}

async function findInstagram(env) {
  const result = await requestMeta(env.META_PAGE_ID, env, {
    fields: "instagram_business_account{id,username}",
  });
  if (!result.response.ok) return null;
  return result.payload?.instagram_business_account || null;
}

async function createAd(accountId, adSetId, instagram, env) {
  const objectStorySpec = {
    page_id: env.META_PAGE_ID,
    ...(instagram?.id ? { instagram_actor_id: instagram.id } : {}),
    link_data: {
      link: CAMPAIGN.landingPageUrl,
      picture: CAMPAIGN.imageUrl,
      message: CAMPAIGN.primaryText,
      name: CAMPAIGN.headline,
      description: CAMPAIGN.description,
      call_to_action: {
        type: "GET_QUOTE",
        value: { link: CAMPAIGN.landingPageUrl },
      },
    },
  };

  let result = await requestMeta(`${accountId}/ads`, env, {}, {
    method: "POST",
    body: {
      name: CAMPAIGN.adName,
      adset_id: adSetId,
      status: "PAUSED",
      creative: JSON.stringify({ object_story_spec: objectStorySpec }),
    },
  });

  if (!result.response.ok && result.payload?.error?.error_subcode === 1341012 && instagram?.id) {
    delete objectStorySpec.instagram_actor_id;
    result = await requestMeta(`${accountId}/ads`, env, {}, {
      method: "POST",
      body: {
        name: CAMPAIGN.adName,
        adset_id: adSetId,
        status: "PAUSED",
        creative: JSON.stringify({ object_story_spec: objectStorySpec }),
      },
    });
  }

  return result;
}

export async function createPausedDeckFenceCampaign(request, env) {
  const validationError = validateRequest(request, env);
  if (validationError) return validationError;

  const accountId = getAdAccountId(env);
  const created = { campaign: false, adSet: false, ad: false };
  const ids = { campaignId: null, adSetId: null, adId: null };

  try {
    const location = await findCalgary(env);
    if (!location.response.ok) return failure(location, "find_calgary_targeting", created, ids);

    const instagram = await findInstagram(env);
    const targeting = {
      age_min: 30,
      age_max: 65,
      geo_locations: {
        cities: [{ key: String(location.payload.key), radius: 25, distance_unit: "kilometer" }],
        location_types: ["home"],
      },
      publisher_platforms: instagram ? ["facebook", "instagram"] : ["facebook"],
    };

    const campaigns = await requestMeta(`${accountId}/campaigns`, env, {
      fields: "id,name,status,effective_status,objective",
      limit: 200,
    });
    if (!campaigns.response.ok) return failure(campaigns, "list_campaigns", created, ids);

    let campaign = findByName(campaigns.payload, CAMPAIGN.campaignName);
    if (!campaign) {
      const result = await requestMeta(`${accountId}/campaigns`, env, {}, {
        method: "POST",
        body: {
          name: CAMPAIGN.campaignName,
          objective: "OUTCOME_LEADS",
          buying_type: "AUCTION",
          status: "PAUSED",
          special_ad_categories: JSON.stringify([]),
        },
      });
      if (!result.response.ok) return failure(result, "create_campaign", created, ids);
      campaign = { id: result.payload.id, name: CAMPAIGN.campaignName };
      created.campaign = true;
    }
    ids.campaignId = campaign.id;

    const adSets = await requestMeta(`${campaign.id}/adsets`, env, {
      fields: "id,name,status,effective_status",
      limit: 100,
    });
    if (!adSets.response.ok) return failure(adSets, "list_ad_sets", created, ids);

    let adSet = findByName(adSets.payload, CAMPAIGN.adSetName);
    if (!adSet) {
      const result = await requestMeta(`${accountId}/adsets`, env, {}, {
        method: "POST",
        body: {
          name: CAMPAIGN.adSetName,
          campaign_id: campaign.id,
          daily_budget: CAMPAIGN.dailyBudgetMinor,
          billing_event: "IMPRESSIONS",
          optimization_goal: "OFFSITE_CONVERSIONS",
          bid_strategy: "LOWEST_COST_WITHOUT_CAP",
          destination_type: "WEBSITE",
          promoted_object: JSON.stringify({
            pixel_id: CAMPAIGN.pixelId,
            custom_event_type: "LEAD",
          }),
          targeting: JSON.stringify(targeting),
          status: "PAUSED",
        },
      });
      if (!result.response.ok) return failure(result, "create_ad_set", created, ids);
      adSet = { id: result.payload.id, name: CAMPAIGN.adSetName };
      created.adSet = true;
    }
    ids.adSetId = adSet.id;

    const ads = await requestMeta(`${adSet.id}/ads`, env, {
      fields: "id,name,status,effective_status",
      limit: 100,
    });
    if (!ads.response.ok) return failure(ads, "list_ads", created, ids);

    let ad = findByName(ads.payload, CAMPAIGN.adName);
    if (!ad) {
      const result = await createAd(accountId, adSet.id, instagram, env);
      if (!result.response.ok) return failure(result, "create_ad", created, ids);
      ad = { id: result.payload.id, name: CAMPAIGN.adName };
      created.ad = true;
    }
    ids.adId = ad.id;

    return json({
      ok: true,
      apiVersion: META_API_VERSION,
      idempotent: !created.campaign && !created.adSet && !created.ad,
      created,
      ids,
      configuration: {
        campaignName: CAMPAIGN.campaignName,
        objective: "OUTCOME_LEADS",
        destination: "WEBSITE",
        optimization: "LEAD",
        pixelId: CAMPAIGN.pixelId,
        dailyBudget: "20 CAD",
        location: "Calgary + 25 km, people living in this location",
        age: "30–65+",
        platforms: instagram ? ["facebook", "instagram"] : ["facebook"],
        landingPageUrl: CAMPAIGN.landingPageUrl,
        imageUrl: CAMPAIGN.imageUrl,
      },
      statuses: { campaign: "PAUSED", adSet: "PAUSED", ad: "PAUSED" },
      adsStarted: false,
      spendEnabled: false,
    });
  } catch (error) {
    return json({
      ok: false,
      error: "Could not create the paused deck and fence campaign",
      details: error instanceof Error ? error.message : String(error),
      created,
      ids,
      adsStarted: false,
      spendEnabled: false,
    }, 502);
  }
}
