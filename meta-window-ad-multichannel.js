const META_API_VERSION = "v25.0";

const WINDOW = Object.freeze({
  campaignName: "White5 | Window & Screen Cleaning | Calgary",
  adSetName: "White5 | Calgary | Website Leads | 20 CAD",
  adName: "White5 | Window & Screen Cleaning | Image 1",
  websiteUrl: "https://www.white5.ca/services.html#quote",
  whatsappUrl: "https://wa.me/14034793905?text=Hi%20White5%2C%20I%27d%20like%20a%20window%20cleaning%20quote.",
  imageUrl: "https://www.white5.ca/images/window-cleaning-1.jpg",
  primaryText: "Calgary homeowners — make your windows shine again. White5 provides careful interior and exterior window cleaning, screens, and tracks. Get your free estimate on our website: https://www.white5.ca/services.html#quote\n\nPrefer WhatsApp? Message White5 directly: https://wa.me/14034793905?text=Hi%20White5%2C%20I%27d%20like%20a%20window%20cleaning%20quote.",
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
  const items = Array.isArray(payload?.data) ? payload.data : [];
  return items.find((item) => item?.name === name) || null;
}

function failure(step, result, details = {}) {
  return json({
    ok: false,
    error: "Meta API request failed",
    step,
    ...details,
    meta: result.payload,
  }, result.response.status);
}

export async function updateWindowAdWithWebsiteAndWhatsApp(request, env) {
  const validationError = validateRequest(request, env);
  if (validationError) return validationError;

  const accountId = getAdAccountId(env);

  const campaigns = await requestMeta(`${accountId}/campaigns`, env, {
    fields: "id,name,status,effective_status",
    limit: 200,
  });
  if (!campaigns.response.ok) return failure("list_campaigns", campaigns);

  const campaign = findByName(campaigns.payload, WINDOW.campaignName);
  if (!campaign?.id) {
    return json({ ok: false, error: "Window cleaning campaign was not found" }, 404);
  }

  const adSets = await requestMeta(`${campaign.id}/adsets`, env, {
    fields: "id,name,status,effective_status",
    limit: 100,
  });
  if (!adSets.response.ok) return failure("list_ad_sets", adSets, { campaign });

  const adSet = findByName(adSets.payload, WINDOW.adSetName);
  if (!adSet?.id) {
    return json({ ok: false, error: "Window cleaning website ad set was not found", campaign }, 404);
  }

  const ads = await requestMeta(`${adSet.id}/ads`, env, {
    fields: "id,name,status,effective_status,creative",
    limit: 100,
  });
  if (!ads.response.ok) return failure("list_ads", ads, { campaign, adSet });

  const ad = findByName(ads.payload, WINDOW.adName);
  if (!ad?.id) {
    return json({ ok: false, error: "Window cleaning ad was not found", campaign, adSet }, 404);
  }

  let currentCreative = null;
  const creativeId = ad?.creative?.id;
  if (creativeId) {
    const creativeResult = await requestMeta(creativeId, env, {
      fields: "id,name,object_story_spec",
    });
    if (!creativeResult.response.ok) {
      return failure("read_current_creative", creativeResult, { campaign, adSet, ad });
    }
    currentCreative = creativeResult.payload;
  }

  const previousStory = currentCreative?.object_story_spec || {};
  const previousLinkData = previousStory?.link_data || {};

  const linkData = {
    link: WINDOW.websiteUrl,
    message: WINDOW.primaryText,
    name: WINDOW.headline,
    description: WINDOW.description,
    call_to_action: {
      type: "GET_QUOTE",
      value: { link: WINDOW.websiteUrl },
    },
  };

  if (previousLinkData.image_hash) linkData.image_hash = previousLinkData.image_hash;
  else linkData.picture = previousLinkData.picture || WINDOW.imageUrl;

  const objectStorySpec = {
    page_id: previousStory.page_id || env.META_PAGE_ID,
    ...(previousStory.instagram_actor_id ? { instagram_actor_id: previousStory.instagram_actor_id } : {}),
    link_data: linkData,
  };

  const updated = await requestMeta(ad.id, env, {}, {
    method: "POST",
    body: {
      creative: JSON.stringify({ object_story_spec: objectStorySpec }),
    },
  });
  if (!updated.response.ok) {
    return failure("update_window_ad_creative", updated, {
      campaign,
      adSet,
      ad,
      requestedWebsiteUrl: WINDOW.websiteUrl,
      requestedWhatsAppUrl: WINDOW.whatsappUrl,
    });
  }

  const refreshed = await requestMeta(ad.id, env, {
    fields: "id,name,status,effective_status,creative",
  });

  return json({
    ok: true,
    changed: true,
    campaign,
    adSet,
    adBefore: ad,
    adAfter: refreshed.response.ok ? refreshed.payload : null,
    website: {
      url: WINDOW.websiteUrl,
      button: "GET_QUOTE",
    },
    whatsapp: {
      url: WINDOW.whatsappUrl,
      placement: "primary text direct link",
      phone: "+1 403-479-3905",
    },
    note: "The ad keeps one Get Quote button to the website and adds a direct WhatsApp link in the primary text. Existing campaign and ad-set budgets are unchanged.",
  });
}
