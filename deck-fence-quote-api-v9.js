import { handleDeckFenceQuoteV8 } from "./deck-fence-quote-api-v8.js";

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

export async function handleDeckFenceQuoteV9(request, env) {
  if (request.method !== "POST") return handleDeckFenceQuoteV8(request, env);

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: "Invalid form submission" }, 400);
  }

  if (String(formData.get("consent") || "") !== "yes") {
    return json({ ok: false, error: "Contact consent is required." }, 400);
  }

  const headers = new Headers(request.headers);
  headers.delete("content-type");
  headers.delete("content-length");

  const forwardedRequest = new Request(request.url, {
    method: "POST",
    headers,
    body: formData,
  });

  return handleDeckFenceQuoteV8(forwardedRequest, env);
}
