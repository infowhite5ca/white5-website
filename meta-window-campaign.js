const CAMPAIGN = Object.freeze({
  campaignName: "White5 | Window & Screen Cleaning | Calgary",
  adSetName: "White5 | Calgary | Website Leads | 20 CAD",
  adName: "White5 | Window & Screen Cleaning | Image 1",
  dailyBudgetMinor: 2000,
  pixelId: "1587609516129238",
  landingPageUrl: "https://www.white5.ca/services.html#quote",
  imageUrl: "https://www.white5.ca/images/window-cleaning-1.jpg",
  primaryText: "Calgary homeowners — make your windows shine again. White5 provides careful window and screen cleaning, including interior and exterior windows, screens, and tracks. Get your free estimate online.",
  headline: "Window & Screen Cleaning",
  description: "Free estimates in Calgary",
});

function findByName(payload, name) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data.find((item) => item?.name === name) || null;
}

function failure(json, result, step, created, ids) {
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

async function findCalgary(requestMeta, env) {
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
    item?.name === "Calgary" && item?.country_code === "CA" &&
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

async function findInstagram(requestMeta, env) {
  const result = await requestMeta(env.META_PAGE_ID, env, {
    fields: "instagram_business_account{id,username}",
  });
  if (!result.response.ok) return null;
  return result.payload?.instagram_business_account || null;
}

export async function createPausedWindowCampaign({
  request,
  env,
  json,
  validateAdminRequest,
  getMetaAdAccountId,
  requestMeta,
}) {
  const validationError = validateAdminRequest(request, env, ["POST"]);
  if (validationError) return validationError;

  const accountId = getMetaAdAccountId(env);
  const created = { campaign: false, adSet: false, ad: false };
  const ids = { campaignId: null, adSetId: null, adId: null };

  try {
    const location = await findCalgary(requestMeta, env);
    if (!location.response.ok) return failure(json, location, "find_calgary_targeting", created, ids);

    const instagram = await findInstagram(requestMeta, env);
    const targeting = {
      age_min: 18,
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
    if (!campaigns.response.ok) return failure(json, campaigns, "list_campaigns", created, ids);

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
      if (!result.response.ok) return failure(json, result, "create_campaign", created, ids);
      campaign = { id: result.payload.id, name: CAMPAIGN.campaignName };
      created.campaign = true;
    }
    ids.campaignId = campaign.id;

    const adSets = await requestMeta(`${campaign.id}/adsets`, env, {
      fields: "id,name,status,effective_status",
      limit: 100,
    });
    if (!adSets.response.ok) return failure(json, adSets, "list_ad_sets", created, ids);

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
      if (!result.response.ok) return failure(json, result, "create_ad_set", created, ids);
      adSet = { id: result.payload.id, name: CAMPAIGN.adSetName };
      created.adSet = true;
    }
    ids.adSetId = adSet.id;

    const ads = await requestMeta(`${adSet.id}/ads`, env, {
      fields: "id,name,status,effective_status",
      limit: 100,
    });
    if (!ads.response.ok) return failure(json, ads, "list_ads", created, ids);

    let ad = findByName(ads.payload, CAMPAIGN.adName);
    if (!ad) {
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

      const result = await requestMeta(`${accountId}/ads`, env, {}, {
        method: "POST",
        body: {
          name: CAMPAIGN.adName,
          adset_id: adSet.id,
          status: "PAUSED",
          creative: JSON.stringify({ object_story_spec: objectStorySpec }),
        },
      });
      if (!result.response.ok) return failure(json, result, "create_ad", created, ids);
      ad = { id: result.payload.id, name: CAMPAIGN.adName };
      created.ad = true;
    }
    ids.adId = ad.id;

    return json({
      ok: true,
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
      error: "Could not create the paused window campaign",
      details: error instanceof Error ? error.message : String(error),
      created,
      ids,
      adsStarted: false,
      spendEnabled: false,
    }, 502);
  }
}
