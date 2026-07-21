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

function actionMap(items) {
  const result = {};
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.action_type) continue;
    const numericValue = Number(item.value);
    result[item.action_type] = Number.isFinite(numericValue)
      ? numericValue
      : item.value;
  }
  return result;
}

function firstMetric(map, types) {
  for (const type of types) {
    if (map[type] !== undefined) return map[type];
  }
  return 0;
}

function normalizeInsights(row) {
  const actions = actionMap(row?.actions);
  const costs = actionMap(row?.cost_per_action_type);
  const leadTypes = [
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
    leads: Number(firstMetric(actions, leadTypes) || 0),
    costPerLead: Number(firstMetric(costs, leadTypes) || 0),
    actions,
    costPerActionType: costs,
  };
}

function statusPriority(status) {
  if (status === "ACTIVE") return 0;
  if (status === "PAUSED") return 1;
  return 2;
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
    const [campaignsResult, insightsResult] = await Promise.all([
      requestMeta(`${accountId}/campaigns`, env, {
        fields: "id,name,status,effective_status,objective,created_time,updated_time",
        limit: 200,
      }),
      requestMeta(`${accountId}/insights`, env, {
        fields: [
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
        ].join(","),
        level: "campaign",
        limit: 200,
        ...rangeParams,
      }),
    ]);

    if (!campaignsResult.response.ok) {
      return json({
        ok: false,
        error: "Could not read Meta campaigns",
        meta: campaignsResult.payload,
      }, campaignsResult.response.status);
    }
    if (!insightsResult.response.ok) {
      return json({
        ok: false,
        error: "Could not read Meta campaign insights",
        meta: insightsResult.payload,
      }, insightsResult.response.status);
    }

    const campaigns = Array.isArray(campaignsResult.payload?.data)
      ? campaignsResult.payload.data
      : [];
    const insightRows = Array.isArray(insightsResult.payload?.data)
      ? insightsResult.payload.data
      : [];
    const insightsByCampaignId = new Map(
      insightRows.map((row) => [row.campaign_id, row]),
    );

    const results = campaigns
      .map((campaign) => ({
        ok: true,
        campaign: {
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          effectiveStatus: campaign.effective_status,
          objective: campaign.objective,
          createdTime: campaign.created_time,
          updatedTime: campaign.updated_time,
        },
        insights: normalizeInsights(insightsByCampaignId.get(campaign.id)),
      }))
      .sort((a, b) => {
        const statusDifference = statusPriority(a.campaign.effectiveStatus)
          - statusPriority(b.campaign.effectiveStatus);
        if (statusDifference !== 0) return statusDifference;
        return (b.campaign.updatedTime || "").localeCompare(a.campaign.updatedTime || "");
      });

    const totals = results.reduce((sum, item) => {
      sum.impressions += item.insights.impressions;
      sum.reach += item.insights.reach;
      sum.clicks += item.insights.clicks;
      sum.inlineLinkClicks += item.insights.inlineLinkClicks;
      sum.spend += item.insights.spend;
      sum.leads += item.insights.leads;
      return sum;
    }, {
      impressions: 0,
      reach: 0,
      clicks: 0,
      inlineLinkClicks: 0,
      spend: 0,
      leads: 0,
    });

    totals.ctr = totals.impressions > 0
      ? (totals.clicks / totals.impressions) * 100
      : 0;
    totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
    totals.costPerLead = totals.leads > 0 ? totals.spend / totals.leads : 0;

    return json({
      ok: true,
      apiVersion: META_API_VERSION,
      adAccountId: accountId,
      range: since && until ? { since, until } : { datePreset: "last_7d" },
      campaignCount: results.length,
      hasMoreCampaigns: Boolean(campaignsResult.payload?.paging?.next),
      hasMoreInsightRows: Boolean(insightsResult.payload?.paging?.next),
      totals,
      campaigns: results,
      appSecretProofEnabled: Boolean(env.META_APP_SECRET),
    });
  } catch (error) {
    return json({
      ok: false,
      error: "Could not read Meta campaign insights",
      details: error instanceof Error ? error.message : String(error),
    }, 502);
  }
}
