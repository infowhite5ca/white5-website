import { createHash } from "node:crypto";
import { GoogleApiError, type ConnectorEnv } from "./google-client";
const TTL = 72 * 3600,
  MAX = 75 * 1024 * 1024,
  CHUNK = 4 * 1024 * 1024;
const fail = (message: string) =>
  new GoogleApiError(message, 400, "invalid_media");
const tag = (b: Uint8Array, n: number) =>
  String.fromCharCode(...b.subarray(n, n + 4));
function boxes(bytes: Uint8Array) {
  const list = [];
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  for (let p = 0; p + 8 <= bytes.length; ) {
    const size = v.getUint32(p);
    if (size < 8 || p + size > bytes.length)
      throw fail("Malformed MP4 metadata.");
    list.push({
      type: tag(bytes, p + 4),
      data: bytes.subarray(p + 8, p + size),
    });
    p += size;
  }
  return list;
}
export function inspectMovie(moov: Uint8Array) {
  let duration = 0,
    width = 0,
    height = 0;
  for (const box of boxes(moov)) {
    if (box.type === "mvhd") {
      const b = box.data,
        v = new DataView(b.buffer, b.byteOffset, b.length),
        version = b[0];
      const scale = v.getUint32(version === 1 ? 20 : 12),
        ticks = version === 1 ? Number(v.getBigUint64(24)) : v.getUint32(16);
      duration = ticks / scale;
    }
    if (box.type === "trak") {
      const children = boxes(box.data),
        mdia = children.find((b) => b.type === "mdia");
      if (!mdia) continue;
      const handler = boxes(mdia.data).find((b) => b.type === "hdlr");
      if (!handler || tag(handler.data, 8) !== "vide") continue;
      const tk = children.find((b) => b.type === "tkhd");
      if (tk) {
        const v = new DataView(
          tk.data.buffer,
          tk.data.byteOffset,
          tk.data.length,
        );
        width = v.getUint32(tk.data.length - 8) / 65536;
        height = v.getUint32(tk.data.length - 4) / 65536;
      }
    }
  }
  if (!Number.isFinite(duration) || duration <= 0 || duration > 30)
    throw fail("Video must have a valid duration of at most 30 seconds.");
  if (Math.min(width, height) < 720)
    throw fail("Video resolution must be at least 720p.");
  return { durationSeconds: duration, width, height };
}
// Parse only top-level metadata, never buffer the movie payload in Worker memory.
export class MovieScanner {
  private header = new Uint8Array(0);
  private remaining = 0;
  private type = "";
  private chunks: Uint8Array[] = [];
  private metadataSize = 0;
  moov?: Uint8Array;
  ftyp = false;
  push(input: Uint8Array) {
    let p = 0;
    while (p < input.length) {
      if (!this.remaining) {
        const need = 8 - this.header.length,
          take = Math.min(need, input.length - p),
          next = new Uint8Array(this.header.length + take);
        next.set(this.header);
        next.set(input.subarray(p, p + take), this.header.length);
        this.header = next;
        p += take;
        if (next.length < 8) continue;
        const size = new DataView(next.buffer).getUint32(0);
        this.type = tag(next, 4);
        if (size < 8 || size > MAX)
          throw fail("Unsupported or malformed MP4 box size.");
        this.remaining = size - 8;
        this.header = new Uint8Array(0);
        if (this.type === "ftyp") this.ftyp = true;
        if (this.type === "moov" && this.remaining > 2 * 1024 * 1024)
          throw fail("MP4 metadata exceeds safe bounds.");
        if (!this.remaining) continue;
      }
      const take = Math.min(this.remaining, input.length - p);
      if (this.type === "moov") {
        this.chunks.push(input.slice(p, p + take));
        this.metadataSize += take;
      }
      p += take;
      this.remaining -= take;
      if (!this.remaining && this.type === "moov") {
        this.moov = new Uint8Array(this.metadataSize);
        let offset = 0;
        for (const c of this.chunks) {
          this.moov.set(c, offset);
          offset += c.length;
        }
        this.chunks = [];
        this.metadataSize = 0;
      }
    }
  }
  finish() {
    if (this.remaining || this.header.length || !this.ftyp || !this.moov)
      throw fail("Truncated MP4 or missing movie metadata.");
    return inspectMovie(this.moov);
  }
}
export async function stageVideo(
  env: ConnectorEnv,
  response: Response,
  origin: string,
) {
  if (Number(response.headers.get("content-length")) > MAX) {
    await response.body?.cancel();
    throw fail("Video exceeds 75 MiB.");
  }
  const type = response.headers.get("content-type")?.split(";")[0];
  if (type && !["video/mp4", "application/octet-stream"].includes(type)) {
    await response.body?.cancel();
    throw fail("Video must be an MP4 file.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw fail("Video is empty.");
  const id =
      crypto.randomUUID().replaceAll("-", "") +
      crypto.randomUUID().replaceAll("-", ""),
    scanner = new MovieScanner(),
    hash = createHash("sha256");
  let buffer = new Uint8Array(CHUNK),
    used = 0,
    total = 0,
    index = 0;
  const stored: string[] = [];
  const flush = async () => {
    const key = `gbp-video:v1:${id}:${index++}`;
    await env.OAUTH_KV.put(key, buffer.slice(0, used).buffer, {
      expirationTtl: TTL,
    });
    stored.push(key);
    used = 0;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX) throw fail("Video exceeds 75 MiB.");
      hash.update(value);
      scanner.push(value);
      for (let p = 0; p < value.length; ) {
        const n = Math.min(CHUNK - used, value.length - p);
        buffer.set(value.subarray(p, p + n), used);
        used += n;
        p += n;
        if (used === CHUNK) await flush();
      }
    }
    if (used) await flush();
    const info = scanner.finish();
    const sha256 = hash.digest("hex");
    const previous = await env.OAUTH_KV.get<any>(
      "gbp-media-sha256:" + sha256,
      "json",
    );
    if (previous && Date.parse(previous.expiresAt) > Date.now() + 60000) {
      for (const key of stored) await env.OAUTH_KV.delete(key);
      return { ...previous, duplicate: true };
    }
    const expiresAt = new Date(Date.now() + TTL * 1000).toISOString();
    await env.OAUTH_KV.put(
      "gbp-video:v1:" + id,
      JSON.stringify({ chunks: index, size: total, expiresAt }),
      { expirationTtl: TTL },
    );
    const result = {
      uploaded: true,
      published: false,
      sourceUrl: origin + "/media/video/" + id,
      expiresAt,
      mimeType: "video/mp4",
      sizeBytes: total,
      ...info,
      sha256,
      visibility:
        "Anyone with this temporary URL can read the video for 72 hours.",
    };
    await env.OAUTH_KV.put(
      "gbp-media-sha256:" + sha256,
      JSON.stringify(result),
      { expirationTtl: TTL },
    );
    return result;
  } catch (e) {
    await reader.cancel().catch(() => {});
    for (const key of stored) await env.OAUTH_KV.delete(key);
    if (e instanceof GoogleApiError) throw e;
    throw fail(
      "Video download or validation failed; attach a valid MP4 and retry.",
    );
  } finally {
    reader.releaseLock();
  }
}
export async function serveVideo(
  request: Request,
  env: ConnectorEnv,
  id: string,
) {
  const info = await env.OAUTH_KV.get<any>("gbp-video:v1:" + id, "json");
  const headers: Record<string, string> = {
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-type": "video/mp4",
    "accept-ranges": "bytes",
  };
  if (!info || Date.parse(info.expiresAt) <= Date.now())
    return new Response(null, { status: 404, headers });
  let start = 0,
    end = info.size - 1,
    status = 200;
  const range = request.headers.get("range");
  if (range) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!m) return new Response(null, { status: 416, headers });
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), end) : end;
    if (start > end) return new Response(null, { status: 416, headers });
    headers["content-range"] = `bytes ${start}-${end}/${info.size}`;
    status = 206;
  }
  headers["content-length"] = String(end - start + 1);
  let index = Math.floor(start / CHUNK);
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        if (index > Math.floor(end / CHUNK)) {
          controller.close();
          return;
        }
        const data = await env.OAUTH_KV.get(
          "gbp-video:v1:" + id + ":" + index,
          "arrayBuffer",
        );
        if (!data) throw new Error();
        const bytes = new Uint8Array(data);
        controller.enqueue(
          bytes.slice(
            Math.max(0, start - index * CHUNK),
            Math.min(bytes.length, end - index * CHUNK + 1),
          ),
        );
        index++;
      } catch {
        controller.error(new Error("Media expired or unavailable."));
      }
    },
  });
  return new Response(request.method === "HEAD" ? null : stream, {
    status,
    headers,
  });
}
