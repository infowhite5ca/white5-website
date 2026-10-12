# White5 direct photo uploads — 2026-10-12

## Delivered

Added upload_media to the existing White5 MCP gateway and GBP provider, with
ChatGPT file input metadata preserved through MCP registration. The existing
ChatGPT White5 catalog was refreshed and visibly shows the new tools: 60 total,
39 read and 21 write. No reconnection, new Worker, Google project, OAuth scope,
secret or storage binding was needed.

New tools:
- upload_media: preview, then confirmed download/staging of an attached JPEG/PNG.
- create_gbp_media: separately confirmed publication to the GBP photo gallery.
- list_gbp_media: paginated gallery reads.

Staging returns a URL usable by the existing create_gbp_post/update_gbp_post
photo fields. Google local posts require a URL, so unsupported binary dataRef
fields were not added to those existing schemas.

## Handling and limits

JPEG/PNG, 10 KB to 5 MiB, minimum 250x250 pixels, maximum 100 megapixels. File
headers, declared MIME, dimensions and bounded streamed size are checked. This
is header validation rather than a complete image decoder; Google performs final
image/content validation. HEIC, WebP, SVG and video require conversion first.

Only recognized OpenAI attachment download hosts are fetched. No authorization
headers are forwarded, redirects are rejected, and signed input URLs are neither
stored nor returned in previews/errors. Downloads have a timeout and byte limit.

Photo bytes are stored under a separate gbp-photo:v1 prefix in existing KV for
72 hours. The generated URL has a random 64-hex identifier, is readable by anyone
holding it, and expires via KV TTL plus an explicit serving-time check. The route
supports GET/HEAD, disables caching and MIME sniffing, and exposes no listing.
Original photo metadata is not stripped. Upload only content intended for sharing.

Every real upload requires confirmed:true and write scope. Staging does not
publish a photo to Google. Gallery/post publication requires explicit approval
of the photo and destination. COVER/PROFILE gallery categories may replace the
corresponding existing profile photo. No automatic Google write retry occurs.

## Verification

- 22 automated tests passed, including real PNG byte staging/serving in mocked
  storage, JPEG header inspection, TTL, confirmation guards, MIME/size/dimension
  failures, redirect/SSRF denial, error redaction, file metadata on MCP tools/list,
  gallery request schema and all prior integration regressions.
- Both TypeScript projects passed; both Wrangler dry-run builds passed.
- Production MCP initialize/tools/list: 60 tools; upload_media advertises
  openai/fileParams and all four required/optional file-schema properties.
- Production upload_media and create_gbp_media previews passed without a download
  or publication. Production list_gbp_media returned a gallery item.
- Accounts, locations, posts (5), reviews (7), performance, OAuth refresh, Square,
  Zoho, Google Ads and Meta checks passed.
- Authorized /health: HTTP 200, version 1.3.0, degraded:false, all services true.
- ChatGPT UI independently confirms the new tools after Refresh tools.

No user photo was supplied for this change, so actual ChatGPT attachment delivery
through the full live staging path has not yet been exercised. The downloader and
storage path are tested with synthetic fixtures, and production discovery/previews
are verified. No Google photo or post was published during testing.

## Deployment

| Worker | Cloudflare deployment version |
| --- | --- |
| white5-mcp | 9e19e9ea-1479-4cf3-9f63-645dd104f17a |
| white5-google-business-mcp | c5f24f49-7919-4615-8f2e-9b96a4980eb2 |

Gateway runtime 1.3.0; GBP MCP version 0.3.0. Existing binding/config retained.
The first gateway deployment attempt failed on a malformed Cloudflare API response;
the second completed and its production runtime/catalog were verified.

## Changed files

- google-business-profile-mcp/src/media.ts: photo validation, staging and serving.
- Provider tools.ts, operations.ts, google-auth-handler.ts and server.ts:
  schemas, routing, confirmation and file metadata.
- Gateway catalog.ts, server.ts, env.ts and generated gbp-tools.json:
  aliases, metadata forwarding, safe previews and version.
- white5-mcp/tests/gbp.test.mjs and scripts/verify-production.mjs.
- Both READMEs and this report.

Private evidence: white5-mcp/.local/production-verification.json,
production-catalog.json and chatgpt-upload-media.png (not committed).

References:
- https://developers.openai.com/plugins/reference#file-apis
- https://developers.google.com/my-business/content/upload-photos
- https://developers.google.com/my-business/reference/rest/v4/accounts.locations.media
