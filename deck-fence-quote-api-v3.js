import { handleDeckFenceQuoteV2, handleDeckFenceConfigV2 } from "./deck-fence-quote-api-v2.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function handleDeckFenceQuoteV3(request, env) {
  if (request.method !== "POST") {
    return handleDeckFenceQuoteV2(request, env);
  }

  let formData;
  try {
    formData = await request.clone().formData();
  } catch {
    return json({ ok: false, error: "Invalid form submission" }, 400);
  }

  // Samsung/Chrome autofill can populate the off-screen field named "company".
  // Turnstile already protects this form, so do not allow that field to create a fake success.
  formData.delete("company");

  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");

  const cleanRequest = new Request(request.url, {
    method: "POST",
    headers,
    body: formData,
  });

  const response = await handleDeckFenceQuoteV2(cleanRequest, env);
  const result = await response.clone().json().catch(() => null);

  if (response.ok && result?.ok && !result?.messageId) {
    return json({
      ok: false,
      error: "Zoho did not return a message ID. The request was not confirmed as sent.",
    }, 502);
  }

  return response;
}

export function handleDeckFenceConfigV3(request, env) {
  return handleDeckFenceConfigV2(request, env);
}
