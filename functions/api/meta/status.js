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

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.ADMIN_API_KEY) {
    return json({ ok: false, error: "ADMIN_API_KEY is not configured" }, 500);
  }

  const suppliedKey = request.headers.get("x-admin-key");
  if (!suppliedKey || suppliedKey !== env.ADMIN_API_KEY) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const required = [
    "META_ACCESS_TOKEN",
    "META_AD_ACCOUNT_ID",
    "META_PAGE_ID",
  ];

  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) {
    return json({ ok: false, error: "Missing Cloudflare secrets", missing }, 500);
  }

  const accountId = env.META_AD_ACCOUNT_ID.startsWith("act_")
    ? env.META_AD_ACCOUNT_ID
    : `act_${env.META_AD_ACCOUNT_ID}`;

  const url = new URL(
    `https://graph.facebook.com/${META_API_VERSION}/${accountId}`,
  );
  url.searchParams.set(
    "fields",
    "id,name,account_status,currency,timezone_name",
  );
  url.searchParams.set("access_token", env.META_ACCESS_TOKEN);

  if (env.META_APP_SECRET) {
    const proof = await createAppSecretProof(
      env.META_ACCESS_TOKEN,
      env.META_APP_SECRET,
    );
    url.searchParams.set("appsecret_proof", proof);
  }

  try {
    const metaResponse = await fetch(url, {
      headers: { accept: "application/json" },
    });
    const payload = await metaResponse.json();

    if (!metaResponse.ok) {
      return json(
        {
          ok: false,
          error: "Meta API request failed",
          meta: payload,
        },
        metaResponse.status,
      );
    }

    return json({
      ok: true,
      apiVersion: META_API_VERSION,
      adAccount: payload,
      pageIdConfigured: Boolean(env.META_PAGE_ID),
      appSecretProofEnabled: Boolean(env.META_APP_SECRET),
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: "Could not reach Meta API",
        details: error instanceof Error ? error.message : String(error),
      },
      502,
    );
  }
}
