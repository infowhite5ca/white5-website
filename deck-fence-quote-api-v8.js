import { handleDeckFenceQuoteV7 } from "./deck-fence-quote-api-v7.js";

const PREVIEW_TURNSTILE_SECRET = atob("MXgwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwQUE=");

function isPreview(request) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname.endsWith(".white5-website.pages.dev") && hostname !== "white5-website.pages.dev";
}

export function handleDeckFenceQuoteV8(request, env) {
  if (!isPreview(request)) return handleDeckFenceQuoteV7(request, env);

  const url = new URL(request.url);
  url.hostname = "white5-website.pages.dev";

  const headers = new Headers(request.headers);
  headers.delete("origin");

  const forwardedRequest = new Request(url.toString(), {
    method: request.method,
    headers,
    body: request.body,
  });

  const previewEnv = new Proxy(env, {
    get(target, property, receiver) {
      if (property === "TURNSTILE_SECRET_KEY") return PREVIEW_TURNSTILE_SECRET;
      return Reflect.get(target, property, receiver);
    },
  });

  return handleDeckFenceQuoteV7(forwardedRequest, previewEnv);
}
