import { WHITE5_AI_INSTRUCTIONS } from "./white5-ai-knowledge.js";
import { notifyAiPhotoLead } from "./white5-ai-lead-mail.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 24;
const MAX_REQUEST_BYTES = 6 * 1024 * 1024;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 1100 * 1024;
const MAX_IMAGE_DATA_URL_CHARS = 1600000;
const MAX_TOTAL_IMAGE_DATA_URL_CHARS = 5400000;
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
      const maxLength = role === "assistant" ? 2200 : 1600;
      return {
        role,
        content: cleanText(message?.content, maxLength),
      };
    })
    .filter((message) => message.content.length > 0);
}

function sanitizeImages(value) {
  if (value == null) return { images: [], error: null };
  if (!Array.isArray(value)) return { images: [], error: "Invalid photo list" };
  if (value.length > MAX_IMAGES) {
    return { images: [], error: `Please attach no more than ${MAX_IMAGES} photos.` };
  }

  const images = [];
  let totalChars = 0;

  for (const item of value) {
    const dataUrl = String(item?.dataUrl || "");
    if (!dataUrl) continue;

    if (dataUrl.length > MAX_IMAGE_DATA_URL_CHARS) {
      return { images: [], error: "One photo is still too large after compression." };
    }

    const match = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) {
      return { images: [], error: "Only JPG, PNG, and WebP photos are supported." };
    }

    const base64 = match[2];
    const approximateBytes = Math.floor((base64.length * 3) / 4);
    if (approximateBytes > MAX_IMAGE_BYTES) {
      return { images: [], error: "One photo is too large. Please choose a smaller image." };
    }

    totalChars += dataUrl.length;
    if (totalChars > MAX_TOTAL_IMAGE_DATA_URL_CHARS) {
      return { images: [], error: "The combined photo upload is too large." };
    }

    images.push({
      dataUrl,
      name: cleanText(item?.name, 120) || `photo-${images.length + 1}`,
    });
  }

  return { images, error: null };
}

function sanitizeContact(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { name: "", email: "", phone: "" };
  }

  return {
    name: cleanText(value.name, 100),
    email: cleanText(value.email, 254),
    phone: cleanText(value.phone, 40),
  };
}

function extractOutputText(result) {
  if (typeof result?.output_text === "string" && result.output_text.trim()) {
    return result.output_text.trim();
  }

  const output = Array.isArray(result?.output) ? result.output : [];
  const pieces = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string") {
        pieces.push(part.text);
      }
    }
  }
  return pieces.join("").trim();
}

function publicError(error, status) {
  const code = cleanText(error?.code || error?.type, 120).toLowerCase();
  const message = cleanText(error?.message, 500);
  const lowerMessage = message.toLowerCase();

  if (status === 401 || code.includes("invalid_api_key")) {
    return {
      status: 502,
      message: "White5 AI key was rejected. The site administrator needs to replace OPENAI_API_KEY in Cloudflare.",
      code: code || "invalid_api_key",
    };
  }

  if (status === 429 || code.includes("quota") || code.includes("billing")) {
    return {
      status: 429,
      message: "White5 AI billing balance or usage limit needs attention. Please use the quote form or call 403-479-3905 for now.",
      code: code || "usage_limit",
    };
  }

  if (code.includes("model_not_found")) {
    return {
      status: 502,
      message: "The configured AI model is unavailable. White5 needs to update the model setting.",
      code,
    };
  }

  if (
    code.includes("invalid_image")
    || code.includes("image_parse")
    || lowerMessage.includes("image")
  ) {
    return {
      status: 400,
      message: "One of the photos could not be read. Please remove it and try a JPG, PNG, or WebP image.",
      code: code || "invalid_image",
    };
  }

  return {
    status: 502,
    message: message && status < 500
      ? `White5 AI request failed: ${message}`
      : "White5 AI is temporarily unavailable. Please try again or use the quote form.",
    code: code || "openai_error",
  };
}

function sseResponse(text) {
  const encoder = new TextEncoder();
  const chunks = text.match(/.{1,28}(?:\s+|$)/gs) || [text];
  let index = 0;

  const stream = new ReadableStream({
    async pull(controller) {
      if (index < chunks.length) {
        const delta = chunks[index++];
        const event = `event: response.output_text.delta\ndata: ${JSON.stringify({ delta })}\n\n`;
        controller.enqueue(encoder.encode(event));
        if (index < chunks.length) await new Promise((resolve) => setTimeout(resolve, 18));
        return;
      }

      const completed = {
        response: {
          output: [{ content: [{ type: "output_text", text }] }],
        },
      };
      controller.enqueue(encoder.encode(`event: response.completed\ndata: ${JSON.stringify(completed)}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function handleWhite5AiChat(request, env, ctx) {
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
  if (contentLength > MAX_REQUEST_BYTES) {
    return json({ ok: false, error: "The message and photos are too large." }, 413);
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

  const imageResult = sanitizeImages(payload?.images);
  if (imageResult.error) {
    return json({ ok: false, error: imageResult.error }, 400);
  }
  const contact = sanitizeContact(payload?.contact);

  const messages = sanitizeMessages(payload?.messages);
  if (!messages.length && imageResult.images.length) {
    messages.push({ role: "user", content: "Please review the attached photos and tell me what visible details matter for a White5 quote." });
  }

  const latest = messages[messages.length - 1];
  if (!latest || latest.role !== "user") {
    return json({ ok: false, error: "A customer message or photo is required" }, 400);
  }

  const pagePath = cleanText(payload?.page?.path, 200) || "/";
  const pageTitle = cleanText(payload?.page?.title, 200) || "White5 website";
  const model = cleanText(env.OPENAI_CHAT_MODEL, 100) || "gpt-5.4-mini";

  const priorMessages = messages.slice(0, -1);
  const latestContent = [
    { type: "input_text", text: latest.content },
    ...imageResult.images.map((image) => ({
      type: "input_image",
      image_url: image.dataUrl,
      detail: "auto",
    })),
  ];

  const input = [
    {
      role: "developer",
      content: `Current public website page: ${pageTitle} (${pagePath}). Use this only to make the reply more relevant. The current customer message includes ${imageResult.images.length} attached photo(s).`,
    },
    ...priorMessages,
    {
      role: "user",
      content: latestContent,
    },
  ];

  if (imageResult.images.length) {
    const requestId = crypto.randomUUID();
    const notification = notifyAiPhotoLead({
      env,
      requestId,
      images: imageResult.images,
      messages,
      pagePath,
      pageTitle,
      contact,
    }).then((messageId) => {
      console.log(JSON.stringify({
        message: "ai_photo_lead_sent",
        requestId,
        photoCount: imageResult.images.length,
        hasContact: Boolean(contact.name || contact.email || contact.phone),
        messageId,
      }));
    }).catch((error) => {
      console.error(JSON.stringify({
        message: "ai_photo_lead_failed",
        requestId,
        photoCount: imageResult.images.length,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
    ctx.waitUntil(notification);
  }

  let response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: WHITE5_AI_INSTRUCTIONS,
        input,
        reasoning: { effort: "none" },
        text: { verbosity: "low" },
        max_output_tokens: 550,
        store: false,
        stream: false,
      }),
    });
  } catch {
    return json({ ok: false, error: "White5 AI could not reach OpenAI." }, 502);
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.status === "failed" || result?.error) {
    const safe = publicError(result?.error || result, response.status);
    return json({ ok: false, error: safe.message, code: safe.code }, safe.status);
  }

  const reply = extractOutputText(result);
  if (!reply) {
    return json({ ok: false, error: "White5 AI returned an empty response. Please try again." }, 502);
  }

  return sseResponse(reply);
}
