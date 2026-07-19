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

export async function handleDeckFenceQuoteV4(request, env) {
  if (request.method !== "POST") {
    return handleDeckFenceQuoteV2(request, env);
  }

  let formData;
  try {
    formData = await request.clone().formData();
  } catch {
    return json({ ok: false, error: "Invalid form submission" }, 400);
  }

  // Ignore the old honeypot value because some mobile autofill tools populate it.
  formData.delete("company");

  // Zoho Mail's send-message endpoint does not document a per-message replyTo field.
  // Preserve the customer's address in the email body instead of passing replyTo,
  // which was causing Zoho to return HTTP/API 500.
  const customerEmail = String(formData.get("email") || "").trim();
  if (customerEmail) {
    const existingNotes = String(formData.get("notes") || "").trim();
    formData.set(
      "notes",
      `Customer email: ${customerEmail}${existingNotes ? `\n\n${existingNotes}` : ""}`,
    );
    formData.set("email", "");

    if (String(formData.get("preferredContact") || "") === "Email") {
      formData.set("preferredContact", "Email - address listed in notes");
    }
  }

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
      error: "Zoho did not confirm the message as sent.",
    }, 502);
  }

  return response;
}

export function handleDeckFenceConfigV4(request, env) {
  return handleDeckFenceConfigV2(request, env);
}
