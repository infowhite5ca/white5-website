const META_API_VERSION = "v25.0";
const META_PIXEL_ID = "1587609516129238";

const OPENAI_PIXEL_SCRIPT = `
  <!-- OpenAI Ads Measurement Pixel -->
  <script>
    (function (w, d, s, u) {
      if (w.oaiq) return;
      var q = function () { q.q.push(arguments); };
      q.q = [];
      w.oaiq = q;
      var js = d.createElement(s);
      js.async = true;
      js.src = u;
      var f = d.getElementsByTagName(s)[0];
      f.parentNode.insertBefore(js, f);
    })(window, document, "script", "https://bzrcdn.openai.com/sdk/oaiq.min.js");
    oaiq("init", { pixelId: "ASWYvC7c9ygeDn78fUwQf" });

    function white5_report_openai_lead() {
      if (typeof oaiq === "function") {
        oaiq("measure", "lead_created", { type: "customer_action" });
      }
    }

    (function () {
      function wrapLeadFunction(name) {
        var original = window[name];
        if (typeof original !== "function" || original.__white5OpenAIWrapped) return;
        window[name] = function () {
          white5_report_openai_lead();
          return original.apply(this, arguments);
        };
        window[name].__white5OpenAIWrapped = true;
      }

      function patchLeadTracking() {
        wrapLeadFunction("white5_report_conversion_event");
        wrapLeadFunction("gtag_report_conversion");
      }

      patchLeadTracking();
      document.addEventListener("DOMContentLoaded", patchLeadTracking);
      window.addEventListener("load", patchLeadTracking);
    })();
  </script>
`;

const META_PIXEL_SCRIPT = `
  <!-- Meta Pixel Code -->
  <script>
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', '${META_PIXEL_ID}');
    fbq('track', 'PageView');

    function white5_report_meta_lead() {
      if (typeof fbq === 'function') {
        fbq('track', 'Lead');
      }
    }

    (function () {
      function patchMetaLeadTracking() {
        var original = window.sendRequestEmail;
        if (typeof original !== 'function' || original.__white5MetaWrapped) return;

        window.sendRequestEmail = function () {
          var estimate = typeof window.calculateEstimate === 'function'
            ? window.calculateEstimate(false)
            : true;
          if (estimate === null) return;

          var emailElement = document.getElementById('customerEmail');
          var phoneElement = document.getElementById('customerPhone');
          var email = emailElement ? emailElement.value.trim() : '';
          var phone = phoneElement ? phoneElement.value.trim() : '';

          if (!email && !phone) {
            alert('Please enter your email or phone number.');
            return;
          }

          white5_report_meta_lead();
          return original.apply(this, arguments);
        };
        window.sendRequestEmail.__white5MetaWrapped = true;
      }

      patchMetaLeadTracking();
      document.addEventListener('DOMContentLoaded', patchMetaLeadTracking);
      window.addEventListener('load', patchMetaLeadTracking);
    })();
  </script>
  <noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1" /></noscript>
`;

class HeadInjector {
  element(element) {
    element.append(OPENAI_PIXEL_SCRIPT, { html: true });
    element.append(META_PIXEL_SCRIPT, { html: true });
  }
}

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

function validateAdminRequest(request, env, allowedMethods = ["GET"]) {
  if (!allowedMethods.includes(request.method)) {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

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

  return null;
}

function getMetaAdAccountId(env) {
  return env.META_AD_ACCOUNT_ID.startsWith("act_")
    ? env.META_AD_ACCOUNT_ID
    : `act_${env.META_AD_ACCOUNT_ID}`;
}

async function buildMetaUrl(path, env, params = {}) {
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/${path}`);

  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, String(value));
  }

  url.searchParams.set("access_token", env.META_ACCESS_TOKEN);

  if (env.META_APP_SECRET) {
    const proof = await createAppSecretProof(
      env.META_ACCESS_TOKEN,
      env.META_APP_SECRET,
    );
    url.searchParams.set("appsecret_proof", proof);
  }

  return url;
}

async function requestMeta(path, env, params = {}, options = {}) {
  const url = await buildMetaUrl(path, env, params);
  const fetchOptions = {
    method: options.method || "GET",
    headers: { accept: "application/json" },
  };

  if (options.body) {
    const form = new URLSearchParams();
    for (const [name, value] of Object.entries(options.body)) {
      form.set(name, String(value));
    }
    fetchOptions.headers["content-type"] = "application/x-www-form-urlencoded";
    fetchOptions.body = form.toString();
  }

  const response = await fetch(url, fetchOptions);
  const payload = await response.json();
  return { response, payload };
}

function metaFailure(payload, status) {
  return json(
    {
      ok: false,
      error: "Meta API request failed",
      meta: payload,
    },
    status,
  );
}

async function handleMetaStatus(request, env) {
  const validationError = validateAdminRequest(request, env);
  if (validationError) return validationError;

  const accountId = getMetaAdAccountId(env);

  try {
    const { response, payload } = await requestMeta(accountId, env, {
      fields: "id,name,account_status,currency,timezone_name",
    });

    if (!response.ok) {
      return metaFailure(payload, response.status);
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

async function handleMetaCampaigns(request, env) {
  const validationError = validateAdminRequest(request, env);
  if (validationError) return validationError;

  const accountId = getMetaAdAccountId(env);

  try {
    const { response, payload } = await requestMeta(
      `${accountId}/campaigns`,
      env,
      {
        fields: "id,name,status,effective_status,objective,buying_type,created_time,updated_time",
        limit: 100,
      },
    );

    if (!response.ok) {
      return metaFailure(payload, response.status);
    }

    const campaigns = Array.isArray(payload.data) ? payload.data : [];

    return json({
      ok: true,
      apiVersion: META_API_VERSION,
      adAccountId: accountId,
      count: campaigns.length,
      hasMore: Boolean(payload.paging?.next),
      campaigns,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: "Could not read Meta campaigns",
        details: error instanceof Error ? error.message : String(error),
      },
      502,
    );
  }
}

async function handleMetaTracking(request, env) {
  const validationError = validateAdminRequest(request, env, ["POST"]);
  if (validationError) return validationError;

  const accountId = getMetaAdAccountId(env);

  try {
    const existing = await requestMeta(`${accountId}/adspixels`, env, {
      fields: "id,name,last_fired_time",
      limit: 100,
    });

    if (!existing.response.ok) {
      return metaFailure(existing.payload, existing.response.status);
    }

    let pixels = Array.isArray(existing.payload.data) ? existing.payload.data : [];
    let created = false;

    if (pixels.length === 0) {
      const createdPixel = await requestMeta(
        `${accountId}/adspixels`,
        env,
        {},
        {
          method: "POST",
          body: { name: "White5 Website Pixel" },
        },
      );

      if (!createdPixel.response.ok) {
        return metaFailure(createdPixel.payload, createdPixel.response.status);
      }

      created = true;
      pixels = [{ id: createdPixel.payload.id, name: "White5 Website Pixel" }];
    }

    return json({
      ok: true,
      apiVersion: META_API_VERSION,
      created,
      pixel: pixels[0],
      installedPixelId: META_PIXEL_ID,
      adsStarted: false,
      spendEnabled: false,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: "Could not prepare Meta tracking",
        details: error instanceof Error ? error.message : String(error),
      },
      502,
    );
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/meta/status") {
      return handleMetaStatus(request, env);
    }

    if (url.pathname === "/api/meta/campaigns") {
      return handleMetaCampaigns(request, env);
    }

    if (url.pathname === "/api/meta/tracking") {
      return handleMetaTracking(request, env);
    }

    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("text/html")) {
      return response;
    }

    if (url.pathname.startsWith("/meta-admin")) {
      return response;
    }

    return new HTMLRewriter()
      .on("head", new HeadInjector())
      .transform(response);
  },
};
