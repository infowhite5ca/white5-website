import { stageVideo, serveVideo } from "./video";
import { GoogleApiError, type ConnectorEnv } from "./google-client";

export const MEDIA_ORIGIN = "https://white5-google-business-mcp.volodymyronufriichuk68.workers.dev";
export const MEDIA_TTL = 72 * 60 * 60;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PREFIX = "gbp-photo:v1:";
const fail = (message: string, status = 400) => new GoogleApiError(message, status, "invalid_media");

// Do not turn this into an arbitrary URL fetcher. Signed ChatGPT download URLs
// carry their own authorization; never forward a Google/gateway bearer to them.
export function isFileDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value), host = url.hostname;
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash &&
      (host === "files.oaiusercontent.com" || host.endsWith(".oaiusercontent.com") ||
       host === "files.openai.com" || /^oai[a-z0-9-]*\.blob\.core\.windows\.net$/.test(host));
  } catch { return false; }
}

export function inspectPhoto(bytes: Uint8Array) {
  if (bytes.length < 10240 || bytes.length > MAX_PHOTO_BYTES) throw fail("Photos must be between 10 KB and 5 MiB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let mime = "", width = 0, height = 0;
  const png = [137,80,78,71,13,10,26,10];
  if (png.every((value, index) => bytes[index] === value)) {
    if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452 || view.getUint32(bytes.length - 8) !== 0x49454e44) throw fail("Invalid or truncated PNG photo.");
    mime = "image/png"; width = view.getUint32(16); height = view.getUint32(20);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    if (bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw fail("Invalid or truncated JPEG photo.");
    mime = "image/jpeg";
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        if (length < 8) break;
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  } else throw fail("Only JPEG and PNG photos are supported. Convert HEIC/WebP before uploading.");
  if (width < 250 || height < 250 || width * height > 100_000_000) throw fail("Photo dimensions must be at least 250 x 250 pixels and at most 100 megapixels.");
  return { mime, width, height, size: bytes.length };
}

export async function stagePhoto(env: ConnectorEnv, file: { download_url: string; mime_type?: string }) {
  if (!isFileDownloadUrl(file.download_url)) throw fail("Use the signed download URL supplied by ChatGPT for the attached file.");
  let response: Response;
  try { response = await fetch(file.download_url, { redirect: "manual", signal: AbortSignal.timeout(30000) }); }
  catch { throw fail("The attached photo could not be downloaded. Attach it again and retry.", 502); }
  if (!response.ok) {
    await response.body?.cancel();
    throw fail("The attachment link is unavailable, expired, or redirects. Attach the photo again.", 400);
  }
  if (file.mime_type === "video/mp4") return stageVideo(env, response, MEDIA_ORIGIN);
  const declaredSize = Number(response.headers.get("content-length"));
  if (declaredSize > MAX_PHOTO_BYTES) { await response.body?.cancel(); throw fail("Photo exceeds the 5 MiB limit.", 413); }
  const reader = response.body?.getReader();
  if (!reader) throw fail("The attached photo is empty.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_PHOTO_BYTES) { await reader.cancel(); throw fail("Photo exceeds the 5 MiB limit.", 413); }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof GoogleApiError) throw error;
    throw fail("The photo download was interrupted. Attach it again and retry.", 502);
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const info = inspectPhoto(bytes);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(x=>x.toString(16).padStart(2,"0")).join("");
  for (const declared of [file.mime_type, response.headers.get("content-type")?.split(";")[0].trim()]) {
    if (declared && declared !== "application/octet-stream" && declared !== info.mime) throw fail("The photo contents do not match the declared MIME type.");
  }
  // The unguessable URL is readable by anyone holding it so Google can fetch it.
  // Only photo bytes/metadata are stored; never persist the signed input URL.
  const previous=await env.OAUTH_KV.get<any>("gbp-media-sha256:"+sha256,"json");
  if(previous && Date.parse(previous.expiresAt)>Date.now()+60000) return {...previous,duplicate:true};
  const id = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const expiresAt = Date.now() + MEDIA_TTL * 1000;
  await env.OAUTH_KV.put(`${PREFIX}${id}`, bytes.buffer, { expirationTtl: MEDIA_TTL, metadata: { ...info, expiresAt } });
  const result = { uploaded: true, published: false, sha256, sourceUrl: `${MEDIA_ORIGIN}/media/photo/${id}`, expiresAt: new Date(expiresAt).toISOString(),
    mimeType: info.mime, sizeBytes: info.size, width: info.width, height: info.height,
    visibility: "Anyone with the temporary URL can read this photo for 72 hours.",
    next: "Use sourceUrl in create_gbp_post or create_gbp_media only after explicit publication approval. Upload again if expired." };
  await env.OAUTH_KV.put("gbp-media-sha256:"+sha256,JSON.stringify(result),{expirationTtl:MEDIA_TTL});
  return result;
}

export async function servePhoto(request: Request, env: ConnectorEnv): Promise<Response> {
  const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { ...headers, allow: "GET, HEAD" } });
  const video=/^\/media\/video\/([a-f0-9]{64})$/.exec(new URL(request.url).pathname);
  if(video)return serveVideo(request,env,video[1]);
  const match = /^\/media\/photo\/([a-f0-9]{64})$/.exec(new URL(request.url).pathname);
  if (!match) return new Response(null, { status: 404, headers });
  const { value, metadata } = await env.OAUTH_KV.getWithMetadata<{ mime: string; expiresAt: number }>(`${PREFIX}${match[1]}`, "arrayBuffer");
  if (!value || !metadata || metadata.expiresAt <= Date.now() || !["image/png", "image/jpeg"].includes(metadata.mime)) return new Response(null, { status: 404, headers });
  return new Response(request.method === "HEAD" ? null : value, { headers: { ...headers, "content-type": metadata.mime, "content-length": String(value.byteLength), "content-disposition": "inline" } });
}
