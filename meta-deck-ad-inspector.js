const META_API_VERSION = "v25.0";
const DECK_AD_ID = "120250694591460755";
const EXPECTED_URL = "https://www.white5.ca/deck-fence-quote.html";

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
  if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!env.ADMIN_API_KEY) return json({ ok: false, error: "ADMIN_API_KEY is not configured" }, 500);
  if (request.headers.get("x-admin-key") !== env.ADMIN_API_KEY) return json({ ok: false, error: "Unauthorized" }, 401);

  const required = ["META_ACCESS_TOKEN"];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) return json({ ok: false, error: "Missing Cloudflare secrets", missing }, 500);
  return null;
}

async function requestMeta(path, env, params = {}) {
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

  const response = await fetch(url, { headers: { accept: "application/json" } });
  let payload;
  try { payload = await response.json(); }
  catch { payload = { error: { message: "Meta returned a non-JSON response" } }; }
  return { response, payload };
}

function collectUrls(creative) {
  const urls = new Set();
  const story = creative?.object_story_spec || {};
  const linkData = story?.link_data || {};

  if (typeof linkData.link === "string") urls.add(linkData.link);
  if (typeof linkData?.call_to_action?.value?.link === "string") {
    urls.add(linkData.call_to_action.value.link);
  }

  const feed = creative?.asset_feed_spec || {};
  for (const item of Array.isArray(feed.link_urls) ? feed.link_urls : []) {
    if (typeof item?.website_url === "string") urls.add(item.website_url);
    if (typeof item?.display_url === "string") urls.add(item.display_url);
  }

  return [...urls];
}

export async function inspectDeckAd(request, env) {
  const validationError = validateRequest(request, env);
  if (validationError) return validationError;

  const adResult = await requestMeta(DECK_AD_ID, env, {
    fields: "id,name,status,effective_status,adset_id,campaign_id,creative",
  });

  if (!adResult.response.ok) {
    return json({
      ok: false,
      error: "Could not read Meta ad",
      meta: adResult.payload,
    }, adResult.response.status);
  }

  const creativeId = adResult.payload?.creative?.id;
  let creative = null;

  if (creativeId) {
    const creativeResult = await requestMeta(creativeId, env, {
      fields: "id,name,object_story_spec,asset_feed_spec",
    });
    if (!creativeResult.response.ok) {
      return json({
        ok: false,
        error: "Could not read Meta creative",
        ad: adResult.payload,
        meta: creativeResult.payload,
      }, creativeResult.response.status);
    }
    creative = creativeResult.payload;
  }

  const destinationUrls = collectUrls(creative);
  const normalized = destinationUrls.map((value) => value.replace(/\/$/, ""));
  const expected = EXPECTED_URL.replace(/\/$/, "");
  const usesQuoteForm = normalized.includes(expected);
  const usesMessenger = destinationUrls.some((value) => /facebook\.com\/messages|fb\.com\/messenger|messenger/i.test(value));

  return json({
    ok: true,
    ad: {
      id: adResult.payload.id,
      name: adResult.payload.name,
      status: adResult.payload.status,
      effectiveStatus: adResult.payload.effective_status,
      campaignId: adResult.payload.campaign_id,
      adSetId: adResult.payload.adset_id,
      creativeId,
    },
    destinationUrls,
    expectedUrl: EXPECTED_URL,
    verification: {
      usesQuoteForm,
      usesMessenger,
      destinationIsCorrect: usesQuoteForm && !usesMessenger,
    },
    creative,
    changedAnything: false,
    spendEnabled: false,
  });
}
