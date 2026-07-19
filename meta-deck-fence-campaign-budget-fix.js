import { createPausedDeckFenceCampaign } from "./meta-deck-fence-campaign.js";

const META_API_VERSION = "v25.0";
const CAMPAIGN_NAME = "White5 | Deck & Fence Renovation | Calgary";

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

async function withCreatedCampaignResult(response, campaignId) {
  let payload;
  try { payload = await response.json(); }
  catch { return response; }

  if (payload && typeof payload === "object") {
    payload.created = {
      ...(payload.created || {}),
      campaign: true,
    };
    payload.ids = {
      ...(payload.ids || {}),
      campaignId,
    };
    if (payload.ok) payload.idempotent = false;
  }

  return json(payload, response.status);
}

export async function createPausedDeckFenceCampaignWithBudgetFix(request, env) {
  const validationError = validateRequest(request, env);
  if (validationError) return validationError;

  const accountId = getAdAccountId(env);

  try {
    const existing = await requestMeta(`${accountId}/campaigns`, env, {
      fields: "id,name,status,effective_status,objective",
      limit: 200,
    });

    if (!existing.response.ok) {
      return json({
        ok: false,
        error: "Meta API request failed",
        step: "list_campaigns_before_budget_fix",
        meta: existing.payload,
        adsStarted: false,
        spendEnabled: false,
      }, existing.response.status);
    }

    const campaigns = Array.isArray(existing.payload?.data) ? existing.payload.data : [];
    const campaign = campaigns.find((item) => item?.name === CAMPAIGN_NAME);

    if (campaign?.id) {
      return createPausedDeckFenceCampaign(request, env);
    }

    const created = await requestMeta(`${accountId}/campaigns`, env, {}, {
      method: "POST",
      body: {
        name: CAMPAIGN_NAME,
        objective: "OUTCOME_LEADS",
        buying_type: "AUCTION",
        status: "PAUSED",
        special_ad_categories: JSON.stringify([]),
        is_adset_budget_sharing_enabled: false,
      },
    });

    if (!created.response.ok) {
      return json({
        ok: false,
        error: "Meta API request failed",
        step: "create_campaign_with_budget_sharing_flag",
        created: { campaign: false, adSet: false, ad: false },
        ids: { campaignId: null, adSetId: null, adId: null },
        meta: created.payload,
        adsStarted: false,
        spendEnabled: false,
      }, created.response.status);
    }

    const result = await createPausedDeckFenceCampaign(request, env);
    return withCreatedCampaignResult(result, created.payload.id);
  } catch (error) {
    return json({
      ok: false,
      error: "Could not apply Meta budget-sharing compatibility fix",
      details: error instanceof Error ? error.message : String(error),
      adsStarted: false,
      spendEnabled: false,
    }, 502);
  }
}
