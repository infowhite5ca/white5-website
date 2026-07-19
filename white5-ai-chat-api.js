import { WHITE5_AI_INSTRUCTIONS } from "./white5-ai-knowledge.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 24;
const buckets = new Map();

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function cleanText(value, maxLength) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (origin === "https://www.white5.ca" || origin === "https://white5.ca") return true;
  return /^https:\/\/[a-z0-9-]+\.white5-website\.pages\.dev$/i.test(origin);
}

function checkRateLimit(request) {
  const now = Date.now();
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const current = buckets.get(ip);

  if (!current || current.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }

  if (current.count >= RATE_LIMIT) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  buckets.set(ip, current);

  if (buckets.size > 3000) {
    for (const [key, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(key);
    }
  }

  return { allowed: true, retryAfter: 0 };
}

function sanitizeMessages(value) {
  if (!Array.isArray(value)) return [];

  return value
    .slice(-12)
    .map((message) => {
      const role = message?.role === "assistant" ? "assistant" : "user";
      const maxLength = role === "assistant" ? 2200 : 1400;
      return {
        role,
        content: cleanText(message?.content, maxLength),
      };
    })
    .filter((message) => message.content.length > 0);
}

export async function handleWhite5AiChat(request, env) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405, { allow: "POST" });
  }

  if (!env.OPENAI_API_KEY) {
    return json({ ok: false, error: "AI chat is not configured" }, 503);
  }

  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin)) {
    return json({ ok: false, error: "Origin not allowed" }, 403);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 40000) {
    return json({ ok: false, error: "Request is too large" }, 413);
  }

  const rate = checkRateLimit(request);
  if (!rate.allowed) {
    return json(
      { ok: false, error: "Too many messages. Please try again shortly." },
      429,
      { "retry-after": String(rate.retryAfter) },
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request" }, 400);
  }

  const messages = sanitizeMessages(payload?.messages);
  const latest = messages[messages.length - 1];
  if (!latest || latest.role !== "user") {
    return json({ ok: false, error: "A customer message is required" }, 400);
  }

  const pagePath = cleanText(payload?.page?.path, 200) || "/";
  const pageTitle = cleanText(payload?.page?.title, 200) || "White5 website";
  const model = cleanText(env.OPENAI_CHAT_MODEL, 100) || "gpt-5-mini";

  const input = [
    {
      role: "developer",
      content: `Current public website page: ${pageTitle} (${pagePath}). Use this only to make the reply more relevant.`,
    },
    ...messages,
  ];

  let openAIResponse;
  try {
    openAIResponse = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        model,
        instructions: WHITE5_AI_INSTRUCTIONS,
        input,
        reasoning: { effort: "minimal" },
        text: { verbosity: "low" },
        max_output_tokens: 500,
        store: false,
        stream: true,
      }),
    });
  } catch {
    return json({ ok: false, error: "AI service is temporarily unavailable" }, 502);
  }

  if (!openAIResponse.ok || !openAIResponse.body) {
    const failure = await openAIResponse.json().catch(() => ({}));
    const errorType = cleanText(failure?.error?.type, 120) || null;
    const errorCode = cleanText(failure?.error?.code, 120) || null;

    return json(
      {
        ok: false,
        error: openAIResponse.status === 429
          ? "AI usage limit reached. Please call or use the quote form."
          : "AI service is temporarily unavailable",
        type: errorType,
        code: errorCode,
      },
      openAIResponse.status === 429 ? 429 : 502,
    );
  }

  return new Response(openAIResponse.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    },
  });
}
