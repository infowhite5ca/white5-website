const ZOHO_TOKEN_URL = "https://accounts.zohocloud.ca/oauth/v2/token";
const ZOHO_MAIL_API = "https://mail.zohocloud.ca/api";
const RECIPIENT = "info@white5.ca";

function clean(value, maxLength = 500) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

async function getAccessToken(env) {
  const required = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"];
  if (required.some((name) => !env[name])) {
    throw new Error("Zoho Mail delivery is not configured");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    refresh_token: env.ZOHO_REFRESH_TOKEN,
  });
  const response = await fetch(ZOHO_TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) {
    throw new Error(`Zoho token refresh failed: ${clean(result.error || response.status, 200)}`);
  }
  return result.access_token;
}

function collectAddresses(account) {
  const values = [account.primaryEmailAddress, account.mailboxAddress, account.incomingUserName];
  if (Array.isArray(account.emailAddress)) {
    for (const item of account.emailAddress) values.push(item?.mailId);
  }
  if (Array.isArray(account.sendMailDetails)) {
    for (const item of account.sendMailDetails) {
      if (item?.status !== false) values.push(item?.fromAddress);
    }
  }
  return [...new Set(values.map((value) => clean(value, 320)).filter(Boolean))];
}

async function getMailAccount(accessToken) {
  const response = await fetch(`${ZOHO_MAIL_API}/accounts`, {
    headers: {
      accept: "application/json",
      authorization: `Zoho-oauthtoken ${accessToken}`,
    },
  });
  const result = await response.json().catch(() => ({}));
  const target = RECIPIENT.toLowerCase();
  const account = (Array.isArray(result.data) ? result.data : []).find((item) =>
    collectAddresses(item).some((address) => address.toLowerCase() === target),
  );
  if (!response.ok || !account?.accountId) {
    throw new Error(`Zoho account lookup failed: ${clean(result?.status?.description || response.status, 300)}`);
  }

  const available = collectAddresses(account);
  const sender = available.find((address) => address.toLowerCase() === "website@white5.ca")
    || available.find((address) => address.toLowerCase() !== target)
    || RECIPIENT;
  return { accountId: String(account.accountId), sender };
}

function imageFile(image, index) {
  const match = String(image?.dataUrl || "").match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error("Invalid AI-chat photo");

  const subtype = match[1].toLowerCase();
  const mime = subtype === "jpeg" ? "image/jpeg" : `image/${subtype}`;
  const extension = subtype === "jpeg" ? "jpg" : subtype;
  const originalBase = clean(image?.name, 120)
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `photo-${index + 1}`;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  return new File([bytes], `${originalBase}.${extension}`, { type: mime });
}

function attachmentList(result) {
  const values = Array.isArray(result?.data) ? result.data : [result?.data];
  return values
    .filter((item) => item?.storeName && item?.attachmentPath && item?.attachmentName)
    .map((item) => ({
      storeName: item.storeName,
      attachmentPath: item.attachmentPath,
      attachmentName: item.attachmentName,
    }));
}

async function uploadPhotos(accessToken, accountId, images) {
  const form = new FormData();
  images.forEach((image, index) => {
    const file = imageFile(image, index);
    form.append("attach", file, file.name);
  });

  const response = await fetch(
    `${ZOHO_MAIL_API}/accounts/${encodeURIComponent(accountId)}/messages/attachments?uploadType=multipart&isInline=false`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Zoho-oauthtoken ${accessToken}`,
      },
      body: form,
    },
  );
  const result = await response.json().catch(() => ({}));
  const attachments = attachmentList(result);
  if (!response.ok || attachments.length !== images.length) {
    throw new Error(`Zoho photo upload failed: ${clean(result?.status?.description || response.status, 300)}`);
  }
  return attachments;
}

function transcript(messages) {
  return messages
    .map((message) => `${message.role === "assistant" ? "White5 AI" : "Visitor"}: ${clean(message.content, 2200)}`)
    .join("\n\n");
}

async function sendPhotoLead(accessToken, account, details, attachments) {
  const contact = details.contact || {};
  const content = [
    "NEW WHITE5 AI PHOTO LEAD",
    "",
    `Lead ID: ${details.requestId}`,
    `Photos: ${details.photoCount}`,
    `Page: ${details.pageTitle} (${details.pagePath})`,
    `Submitted: ${new Date().toISOString()}`,
    "",
    "CONTACT DETAILS (OPTIONAL)",
    `Name: ${clean(contact.name, 100) || "Not provided"}`,
    `Email: ${clean(contact.email, 254) || "Not provided"}`,
    `Phone: ${clean(contact.phone, 40) || "Not provided"}`,
    "",
    "CHAT TRANSCRIPT",
    transcript(details.messages),
    "",
    "The attached customer photos are stored with this Zoho Mail message for White5 follow-up.",
  ].join("\n");
  const payload = {
    fromAddress: account.sender,
    toAddress: RECIPIENT,
    subject: `AI PHOTO LEAD - ${details.photoCount} photo${details.photoCount === 1 ? "" : "s"} - ${details.requestId.slice(0, 8)}`,
    content,
    mailFormat: "plaintext",
    encoding: "UTF-8",
    attachments,
  };
  const response = await fetch(
    `${ZOHO_MAIL_API}/accounts/${encodeURIComponent(account.accountId)}/messages`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Zoho-oauthtoken ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  const result = await response.json().catch(() => ({}));
  const messageId = clean(result?.data?.messageId, 200);
  if (!response.ok || Number(result?.status?.code || 0) !== 200 || !messageId) {
    throw new Error(`Zoho photo-lead send failed: ${clean(result?.status?.description || response.status, 300)}`);
  }
  return messageId;
}

export async function notifyAiPhotoLead({ env, requestId, images, messages, pagePath, pageTitle, contact }) {
  const accessToken = await getAccessToken(env);
  const account = await getMailAccount(accessToken);
  const attachments = await uploadPhotos(accessToken, account.accountId, images);
  return sendPhotoLead(accessToken, account, {
    requestId,
    photoCount: images.length,
    messages,
    pagePath,
    pageTitle,
    contact,
  }, attachments);
}
