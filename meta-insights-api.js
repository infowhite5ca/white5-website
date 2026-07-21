const META_API_VERSION = "v25.0";

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
  if (request.method !== "GET") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  if (!env.ADMIN_API_KEY) {
    return json({ ok: false, error: "ADMIN_API_KEY is not configured" }, 500);
  }

  if (request.headers.get("x-admin-key") !== env.ADMIN_API_KEY) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const required = ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"];
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    return json({ ok: false, error: "Missing Cloudflare secrets", missing }, 500);
  }

  return null;
}

function getAdAccountId(env) {
  return env.META_AD_ACCOUNT_ID.startsWith("act_")
    ? env.META_AD_ACCOUNT_ID
    : `act_${env.META_AD_ACCOUNT_ID}`;
}

async function requestMeta(path, env, params = {}) {
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/${path}`);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(name, String(value));
    }
  }
  url.searchParams.set("access_token", env.META_ACCESS_TOKEN);

  if (env.META_APP_SECRET) {
    url.searchParams.set(
      "appsecret_proof",
      await createAppSecretProof(env.META_ACCESS_TOKEN, env.META_APP_SECRET),
    );
  }

  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = { error: { message: "Meta returned a non-JSON response" } };
  }

  return { response, payload };
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}

function actionMap(actions) {
  const result = {};
  for (const item of Array.isArray(actions) ? actions : []) {
    if (!item?.action_type) continue;
    const value = Number(item.value);
    result[item.action_type] = Number.isFinite(value) ? value : item.value;
  }
  return result;
}

function firstMetric(map, actionTypes) {
  for (const actionType of actionTypes) {
    if (map[actionType] !== undefined) return map[actionType];
  }
  return 0;
}

function normalizeInsights(row) {
  const actions = actionMap(row?.actions);
  const costs = actionMap(row?.cost_per_action_type);

  const leadActionTypes = [
    "offsite_conversion.fb_pixel_lead",
    "onsite_conversion.lead_grouped",
    "lead",
    "omni_lead",
  ];

  return {
    dateStart: row?.date_start || null,
    dateStop: row?.date_stop || null,
    impressions: Number(row?.impressions || 0),
    reach: Number(row?.reach || 0),
    frequency: Number(row?.frequency || 0),
    clicks: Number(row?.clicks || 0),
    inlineLinkClicks: Number(row?.inline_link_clicks || 0),
    spend: Number(row?.spend || 0),
    ctr: Number(row?.ctr || 0),
    cpc: Number(row?.cpc || 0),
    cpm: Number(row?.cpm || 0),
    leads: Number(firstMetric(actions, leadActionTypes) || 0),
    costPerLead: Number(firstMetric(costs, leadActionTypes) || 0),
    actions,
    costPerActionType: costs,
  };
}

function statusRank(campaign) {
  const status = campaign?.effective_status || campaign?.status || "";
  if (status === "ACTIVE") return 0;
  if (status === "PAUSED") return 1;
  if (status === "IN_PROCESS" || status === "WITH_ISSUES") return 2;
  if (status === "ARCHIVED") return 3;
  return 4;
}

async function loadCampaignInsights(campaign, env, rangeParams) {
  const fields = [
    "campaign_id",
    "campaign_name",
    "date_start",
    "date_stop",
    "impressions",
    "reach",
    "frequency",
    "clicks",
    "inline_link_clicks",
    "spend",
    "ctr",
    "cpc",
    "cpm",
    "actions",
    "cost_per_action_type",
  ].join(",");

  const { response, payload } = await requestMeta(
    `${campaign.id}/insights`,
    env,
    {
      fields,
      level: "campaign",
      ...rangeParams,
    },
  );

  if (!response.ok) {
    return {
      ok: false,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        effectiveStatus: campaign.effective_status,
        objective: campaign.objective,
        buyingType: campaign.buying_type,
        createdTime: campaign.created_time,
        updatedTime: campaign.updated_time,
      },
      meta: payload,
      httpStatus: response.status,
    };
  }

  const row = Array.isArray(payload?.data) ? payload.data[0] : null;
  return {
    ok: true,
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      effectiveStatus: campaign.effective_status,
      objective: campaign.objective,
      buyingType: campaign.buying_type,
      createdTime: campaign.created_time,
      updatedTime: campaign.updated_time,
    },
    insights: normalizeInsights(row),
  };
}

export async function handleMetaInsights(request, env) {
  const validationError = validateRequest(request, env);
  if (validationError) return validationError;

  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  const until = url.searchParams.get("until");

  if ((since && !until) || (!since && until)) {
    return json({
      ok: false,
      error: "Provide both since and until, or neither for last_7d",
    }, 400);
  }

  if ((since && !isDate(since)) || (until && !isDate(until))) {
    return json({
      ok: false,
      error: "since and until must use YYYY-MM-DD",
    }, 400);
  }

  const rangeParams = since && until
    ? { time_range: JSON.stringify({ since, until }) }
    : { date_preset: "last_7d" };

  const accountId = getAdAccountId(env);

  try {
    const campaignsResponse = await requestMeta(`${accountId}/campaigns`, env, {
      fields: "id,name,status,effective_status,objective,buying_type,created_time,updated_time",
      limit: 200,
    });

    if (!campaignsResponse.response.ok) {
      return json({
        ok: false,
        error: "Could not read Meta campaigns",
        meta: campaignsResponse.payload,
      }, campaignsResponse.response.status);
    }

    const allCampaigns = (Array.isArray(campaignsResponse.payload?.data)
      ? campaignsResponse.payload.data
      : [])
      .sort((a, b) => {
        const rankDifference = statusRank(a) - statusRank(b);
        if (rankDifference !== 0) return rankDifference;
        return String(a?.name || "").localeCompare(String(b?.name || ""));
      });

    const results = await Promise.all(
      allCampaigns.map((campaign) =>
        loadCampaignInsights(campaign, env, rangeParams)),
    );

    const failed = results.filter((result) => !result.ok);

    return json({
      ok: failed.length === 0,
      apiVersion: META_API_VERSION,
      adAccountId: accountId,
      range: since && until ? { since, until } : { datePreset: "last_7d" },
      campaignCount: allCampaigns.length,
      successfulCampaignCount: results.length - failed.length,
      failedCampaignCount: failed.length,
      hasMoreCampaigns: Boolean(campaignsResponse.payload?.paging?.next),
      campaigns: results,
      appSecretProofEnabled: Boolean(env.META_APP_SECRET),
      readOnly: true,
    }, failed.length === 0 ? 200 : 502);
  } catch (error) {
    return json({
      ok: false,
      error: "Could not read Meta campaign insights",
      details: error instanceof Error ? error.message : String(error),
    }, 502);
  }
}
