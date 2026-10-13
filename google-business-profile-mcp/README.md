# White5 Google Business Profile MCP

Cloudflare Worker MCP connector for the existing White5 Google Business Profile.

Current release: **1.0.0**, 74 provider operations. See the
[management report and operating guide](../GBP-MANAGEMENT-REPORT.md) for all tools,
confirmed deployment versions, approval workflow, API access and limitations.
The existing gateway exposes these as 76 GBP names, including two compatibility
aliases. Every mutation requires a current exact previewId plus confirmed:true;
destructive/security operations additionally require a separate confirmation phrase.

Two existing Workers use different Google projects. The current gateway still
uses `white5-google-business-mcp`, whose project 230933935136 is explicitly
approved in Google's October 7 email. The alternate `My First Project` adapter
has zero quotas and must not replace it. See [verified approval and account
access status](APPROVED-PROJECT.md) before choosing a deployment config.

## Google OAuth

Authorized redirect URI:

`https://white5-google-business-mcp.volodymyronufriichuk68.workers.dev/oauth/google/callback`

Scopes:

- `openid`
- `email`
- `https://www.googleapis.com/auth/business.manage`

## Cloudflare secrets

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `ALLOWED_GOOGLE_EMAIL` (required to restrict Google authorization to White5)
- optional `GOOGLE_REFRESH_TOKEN` for the private White5 gateway binding

The Worker needs the existing `OAUTH_KV` KV namespace binding and `GBP_CONTROL`
Durable Object binding/migration in wrangler.jsonc. GBP_CONTROL stores approval
claims, receipts, private drafts and optional jobs. No recurring jobs are enabled
by deployment. Do not remove either binding when updating the Worker.

The private `White5Service` entry point can instead load an AES-GCM encrypted
refresh token from `OAUTH_KV`. The one-time `/oauth/google/install` flow writes
that encrypted value only when a temporary `GOOGLE_INSTALL_TOKEN` secret is
present. Remove the installation secret after consent completes.

## White5 gateway

The unified `white5-mcp` Worker binds this Worker as
`GOOGLE_BUSINESS -> white5-google-business-mcp#White5Service`. The gateway
publishes the Google Business tools under `*_gbp_*` aliases and retains the
existing White5 OAuth flow.

## Live verification

Run `npm run live-oauth-probe`, open the one-time `AUTH_URL`, and complete
Google consent. The probe keeps tokens in memory only, checks MCP
initialization plus every connector tool, and always calls `reply_to_review`
with `confirmed:false`.

`list_reviews`, `list_posts`, and `reply_to_review` use the Google My Business
API v4 service (`mybusiness.googleapis.com`). That API must be enabled in the
Google Cloud project in addition to Account Management and Business Information,
and the project must have Google Business Profile API access (non-zero quota).

## Tools

- `connection_status`
- `list_accounts`
- `list_locations`
- `get_location`
- `list_reviews`
- `list_posts`
- `reply_to_review` (preview unless `confirmed:true`)
- `get_review`
- `prepare_post` (local validation only; Google has no post draft endpoint)
- `create_post`, `update_post`, `delete_post` (confirmation required)
- `update_location` (confirmation required; defaults to Google validateOnly)
- `get_performance` (daily Search/Maps impressions, website and call clicks)
- `get_location_permissions` (admins and Voice of Merchant state)
- `set_primary_location` (confirmation required; private KV only)

The Performance API and My Business Verifications API must be enabled for their
respective capabilities. A 403 SERVICE_DISABLED is reported as `api_disabled`,
not an expired login or successful empty result. Other errors distinguish missing
scope, authentication failure, project access/quota restrictions, ambiguous
permissions, unavailable resources and rate limits.

The OAuth callback binds a short-lived, single-use state record to a Secure,
HttpOnly browser cookie. Refresh credentials stay encrypted in existing KV.
GET requests retry transient failures with bounded Retry-After handling; mutations
are never automatically retried. Invocation logs are disabled to keep OAuth
authorization codes and installation tokens out of request URL logs.

Run `node scripts/test-gbp.mjs` from `../white5-mcp` for automated provider and
gateway tests, then typecheck and dry-run both Workers before deployment.

## Direct photo uploads (2026-10-12)

The gateway exposes `upload_media` with OpenAI `openai/fileParams: ["file"]`.
Attach a photo to ChatGPT; the host supplies the file object (`download_url`,
`file_id`, optional `mime_type` and `file_name`). Do not invent file references or
paste base64 into tool arguments. Download URLs are fetched only from allowed
OpenAI attachment hosts, with no credentials forwarded and no redirects.

`confirmed:false` is a local metadata preview, with no file download. With explicit
approval and `confirmed:true`, the tool stages JPEG/PNG bytes in the existing
OAUTH_KV namespace under an isolated gbp-photo:v1 prefix. It accepts 10 KB–5 MiB,
minimum 250x250 pixels, maximum 100 megapixels. File signatures, header dimensions,
MIME agreement and stream size are checked; Google remains the final decoder and
content/moderation validator. HEIC, WebP, SVG and videos are not supported.

The returned sourceUrl is unguessable but readable by anyone holding it. It
expires after 72 hours, enforced by both KV TTL and the serving route. No directory
listing is exposed; signed input URLs are not stored or echoed. No public R2
bucket, new Worker, secret, OAuth scope or Google project is required. The URL
route disables caching and content sniffing. Photo bytes are not transformed;
only upload photos/metadata you intend to share.

Staging never publishes a Google post or gallery item. After separate approval:
- Use sourceUrl with existing create_gbp_post/update_gbp_post photo fields.
- Use create_gbp_media for the profile gallery, choosing a category. COVER and
  PROFILE can replace the profile's corresponding photo; approval must cover it.
- Use list_gbp_media to read existing gallery items and check the result.

Use the staged URL before expiry. Re-upload if it expires; Google fetches the
photo during publication and hosts its own copy thereafter. Approval or staging
success does not guarantee acceptance or immediate visibility by Google.

References: https://developers.openai.com/plugins/reference#file-apis and
https://developers.google.com/my-business/content/upload-photos (local post media
supports sourceUrl, not binary dataRef).
