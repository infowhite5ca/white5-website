# White5 GBP management — production release, 2026-10-13

The existing White5 gateway and GBP Worker are deployed. Production MCP advertises
115 tools: 76 GBP names representing 74 distinct operations, plus the unchanged
39 other integration/gateway tools. The GBP provider previously had 19 operations;
55 have been added. ChatGPT's refreshed White5 catalog was inspected: **40 write,
75 read tools**, including services, media batches, audits and scheduling.

No Google profile content, services, prices, replies, photos, account permissions,
advertising budgets or campaign states were changed in this release's live tests.
No recurring job or scheduled publication was activated.

## Deployment and source preservation

| Component | Runtime | Deployed Cloudflare version |
| --- | --- | --- |
| `white5-google-business-mcp` | 1.0.0 | `e1b12948-a0b5-44b0-9909-a126cf5bdf9a` |
| `white5-mcp` | 1.4.0 | `84709f6a-9381-49a0-9b42-cf1adb268e93` |

Production endpoint: https://white5-mcp.volodymyronufriichuk68.workers.dev/mcp

The original deployed Worker bundles, settings and deployment records were backed
up before replacement, under ignored local directories:

- `white5-mcp/.local/backups/2026-10-12T10-43-34.824Z/`
- `white5-mcp/.local/backups/2026-10-12T22-02-41.384Z/`

The second backup confirmed the same original bundle hashes:

| Original module | SHA-256 |
| --- | --- |
| Gateway index.js | `c63a66acde4c41d290bd61cdac0f031a1252cf12e87f047a1dcbdaa6a078d435` |
| GBP server.js | `a77eae336225edbb8352d5de7c63ee45ab1fa9d10bd1702c6b707b7e4ca61887` |

The repository is `infowhite5ca/white5-website`, branch
`codex/google-business-profile-mcp`. No replacement Worker or website deployment
was created. No staging environment was configured; local Worker builds/tests
preceded deployment to the existing production Workers.

## Root cause, OAuth project and actual Google errors

The previous implementation and static gateway catalog exposed only a limited
GBP tool set. Reconnecting ChatGPT could not add missing server operations or
enable Google APIs. This release extends both the provider and gateway catalog.

The deployed GOOGLE_CLIENT_ID belongs to **White5 Google Ads API**, project
`concrete-zephyr-505300-g2`, number **230933935136**. It is not My First Project
686968841791. The approved project/client, existing business.manage consent,
encrypted refresh storage and gateway binding were preserved. The alternate
Worker `white5-google-business-profile-mcp` was not deployed.

Google's October 7 approval identified project 230933935136 and 300 QPM. Authenticated
requests, rather than that email alone, now confirm access. Earlier core failures
were HTTP 403 / PERMISSION_DENIED / ErrorInfo SERVICE_DISABLED for
`mybusiness.googleapis.com` and `businessprofileperformance.googleapis.com`, with
consumer `projects/230933935136`. Those core APIs were fixed in the earlier
integration work; see the historical GBP-INTEGRATION-REPORT.md.

At the start of this upgrade, the additional verification, place-action and
notification calls also returned 403 SERVICE_DISABLED for that same consumer.
With the owner's explicit approval, these three APIs were enabled on October 13:

- `mybusinessverifications.googleapis.com`
- `mybusinessplaceactions.googleapis.com`
- `mybusinessnotifications.googleapis.com`

Account Management, Business Information, Google My Business v4, Performance,
Verifications, Place Actions and Notifications now accept the tested reads.
All **nine capability checks** report available: accounts, business information,
media, posts, reviews, performance, verification, place actions and notifications.
There is no remaining API enablement requirement for these tested capabilities.

One resource-specific restriction remains: `GET /v1/accounts/.../admins` returns
Google **400 INVALID_ARGUMENT** for White5's PERSONAL account. The connector
reports this limitation with the account type and directs callers to
location-level administrators, which work. It does not report an OAuth failure.
Requesting new verification options on the already verified service-area profile
also returned 400; the tool now first checks Voice of Merchant and returns
`not_required` with `optionsRequested:false` when that state is already present.

## Profile and live findings

| Item | Verified result |
| --- | --- |
| Account | `accounts/115421274606058010150` |
| Primary profile | `locations/8623115222428082795` |
| Business / website | White5 / https://white5.ca |
| Location / timezone | Calgary, Alberta / America/Edmonton |
| Authority | Voice of Merchant and business authority true; location admins accessible |
| Accessible profiles | One account, one location; official duplicate search returned no candidates |
| Existing services | 6, service-list modification eligible, no fixed prices returned |
| Business / customer media | 29 / 2 |
| Local posts | 5 |
| Reviews | 7, with 3 unanswered |
| Verification history | 3 completed entries |
| Eligible place action | APPOINTMENT; no current action links |
| Notifications | Configuration readable, no Pub/Sub topic configured |
| Private drafts / jobs / reports | Empty during verification |

The primary identity remains in private Worker KV. These results do not prove
there are no inaccessible duplicates. No duplicate was merged or modified.

Ten October 12 business photos are present in the API. The public count of three
is the owner's observation, not an independently established moderation result.
The API does not expose a reliable public-visibility/moderation approval field for
these media items. `check_gbp_media_publication` therefore distinguishes accepted
API entries from public visibility and recommends manual gallery inspection.

The audit reports pending Google updates, missing holiday hours and unanswered
reviews. The limited homepage comparison finds White5's name and profile phone.
Category suitability, description quality and search opportunities still require
human judgment; returned evidence is not a ranking guarantee or a full SEO audit.

## Services prepared for owner review

The preparation tool returns these nine proposals without publishing or pricing:

1. Exterior Window Cleaning
2. Interior & Exterior Window Cleaning
3. Glass & Mirror Cleaning
4. Gutter Cleaning
5. Pressure Washing
6. Deck Cleaning
7. Deck Sanding
8. Deck Staining
9. Fence Cleaning & Staining

Eligible structured service IDs are retrieved from the profile's actual categories.
Google controls structured service labels. Custom proposals flag category review
before approval, particularly deck/fence work. Existing unrelated items and their
unknown fields are preserved. Explicit service keys support update/remove; duplicate
keys and ineligible structured IDs are rejected. PATCH uses `updateMask=serviceItems`
and reads the list back after a confirmed operation.

Prices use CAD Money `{currencyCode:"CAD", units:"140", nanos:0}` only for a
genuinely fixed $140 service. This is not a representation of "From $140".
Omitting price leaves/removes the fixed price on the explicitly edited item.
No prices or new services have been approved or published.

## Approval, storage and operation safety

Every write follows the same workflow:

1. Read the current resource; validate the exact proposed arguments.
2. Return `before`, `after`, target and a ten-minute `previewId`.
3. Obtain explicit owner approval of that exact preview. Reinvoke with the same
   arguments, `confirmed:true`, and its `previewId`.
4. Reject expired, changed, stale, cross-owner or consumed previews. Destructive,
   verification and manager changes additionally require the exact separate phrase.
5. Atomically claim the operation, perform only the approved mutation, and read back.

Changing `validateOnly` after preview requires another preview. For location/services
publishing, prepare with `validateOnly:false` and approve that exact proposal; the
default `validateOnly:true` submits Google validation only after confirmation.

The internal `GBP_CONTROL` SQLite Durable Object stores approvals, atomic claims,
idempotency receipts, private drafts, jobs and audit records. `OAUTH_KV` and all
existing secrets are preserved. Google refresh tokens remain encrypted at rest.
Receipts prevent duplicate execution; a repeated identical operation returns its
receipt. A deliberate repeat needs a new idempotency key and fresh approval.
Unknown write outcomes require inspection rather than automatic retry. Read retries
use bounded backoff and rate-limit handling. Private state updates use compare-and-set.

No public route exposes the control object. OAuth cookies/state, resource validation,
allowed Google hosts and attachment URL restrictions remain enforced. Invocation URL
logging is disabled to avoid logging OAuth query credentials. No token or client
secret was added to source, reports or commits. Detailed local verification evidence
is ignored by Git because it includes private business/customer data.

### Media and scheduling boundaries

JPEG/PNG attachment staging and MP4 video staging use temporary, unguessable White5
URLs with 72-hour expiry. Anyone with a resulting URL can read that media; the
preview explains this. Photos are validated at 10 KB–5 MiB and at least 250×250.
Supported MP4 inputs are limited to 75 MiB, 30 seconds, at least 720p and the
implemented MP4 container parser; this is not universal video transcoding support.
Video responses support GET/HEAD and explicit byte ranges.

Batch staging/gallery creation support up to ten items with per-item results.
SHA-256 detects duplicate staged bytes; source URL checks detect repeated gallery
submissions. These are potential-duplicate checks, not perceptual matching of all
Google-hosted images. Failed/uncertain publication is never blindly retried.
Gallery upload and Google acceptance do not establish public visibility.

STANDARD/EVENT/OFFER input schemas are supported with topic/date/link/CTA validation.
Actual publishing remains subject to Google's location/content eligibility; no
live publication was performed to test it. New post media uses photos. Existing
Google post videos are preserved when updating other fields.

Optional schedules use Durable Object alarms, not a newly created service. The
owner must approve exact content/time. Reports are stored privately for retrieval;
there is no automatic email, push delivery to ChatGPT or real-time alert channel.
Weekly recurrences use seven-day UTC intervals; monthly recurrences use UTC month
arithmetic. The preview displays America/Edmonton time; local clock times can shift
at daylight-saving changes. Month-end dates follow JavaScript UTC month rollover.
Temporary media URLs are rejected for scheduled posts. No schedule is enabled.

## Official endpoints and access

| API base / reference | Used operations |
| --- | --- |
| [Account Management](https://developers.google.com/my-business/reference/accountmanagement/rest) — `mybusinessaccountmanagement.googleapis.com/v1` | accounts, location/account admins, invitations; manager create/delete only |
| [Business Information](https://developers.google.com/my-business/reference/businessinformation/rest) — `mybusinessbusinessinformation.googleapis.com/v1` | accounts.locations.list, locations.get/patch/getGoogleUpdated, categories.list/batchGet, attributes.list, locations.attributes.get/patch, googleLocations.search |
| [Google My Business v4](https://developers.google.com/my-business/reference/rest) — `mybusiness.googleapis.com/v4` | localPosts list/get/create/patch/delete; media list/get/create/patch/delete; customers media list/get; reviews list/get/updateReply/deleteReply |
| [Performance](https://developers.google.com/my-business/reference/performance/rest) — `businessprofileperformance.googleapis.com/v1` | locations.fetchMultiDailyMetricsTimeSeries; searchkeywords.impressions.monthly.list |
| [Verifications](https://developers.google.com/my-business/reference/verifications/rest) — `mybusinessverifications.googleapis.com/v1` | VoiceOfMerchantState, fetchVerificationOptions, verify, verifications.list/complete |
| [Place Actions](https://developers.google.com/my-business/reference/placeactions/rest) — `mybusinessplaceactions.googleapis.com/v1` | placeActionTypeMetadata.list; placeActionLinks list/get/create/patch/delete |
| [Notifications](https://developers.google.com/my-business/reference/notifications/rest) — `mybusinessnotifications.googleapis.com/v1` | accounts.getNotificationSetting/updateNotificationSetting |

OAuth refresh uses `https://oauth2.googleapis.com/token`, with the existing
`https://www.googleapis.com/auth/business.manage` consent. Services use Business
Information `serviceItems` and Google's [ServiceItem/Money schema](https://developers.google.com/my-business/reference/businessinformation/rest/v1/ServiceItem).
Eligible attribute metadata uses `attributeMetadata`, including pagination, and
location-specific queries omit incompatible language/region parameters as required
by [attributes.list](https://developers.google.com/my-business/reference/businessinformation/rest/v1/attributes/list).

## Explicitly unavailable, restricted or manual capabilities

| Feature | Status and alternative |
| --- | --- |
| Q&A | Discontinued November 3, 2025; not implemented and no retired notification types. Use available Maps UI features. |
| Completed calls / call history | Retired endpoints not used. Performance CALL_CLICKS measures clicks, not completed calls. |
| Media moderation/public visibility | Not exposed reliably by the used API. Inspect the public Maps gallery. |
| Customer media deletion/editing | Not exposed by this connector; use Google's reporting/management UI where permitted. |
| COVER/PROFILE metadata patch | Rejected by schema; supported creation workflow has its own explicit approval. |
| WhatsApp / direct quote action button | Not established for White5. Only APPOINTMENT eligibility was returned; no unsupported action type invented. |
| Account admins on PERSONAL account | Google 400 INVALID_ARGUMENT. Location administrators are available. |
| Owner transfer/removal or location deletion/closure | Intentionally unavailable. Requires a separate owner-controlled process in Google UI. |
| Pub/Sub event delivery | Configuration read/update supported. No topic, subscription or push consumer created. Existing topic permissions and delivery infrastructure would need separate setup. Polling/report storage is available and is not real time. |
| Scheduled business-information edits | Not implemented. `profile_changes` is a read-only monitoring report, not scheduled profile mutation. |
| Arbitrary video formats / transcoding | Not implemented. Supply a supported MP4 or convert locally before attachment. |
| Live write acceptance | Not tested against real GBP content without exact owner approval. Read-back and failure handling are implemented and tested with mocks. |

## Validation results

- **41/41 automated tests pass**: schemas, service preservation/prices, preview
  expiry/tampering/stale state, cross-owner checks, write scope, concurrent claims,
  replay, scheduling safety, OAuth state/encryption/refresh, attachment SSRF/MIME
  checks, photo storage/read-back, MP4 parsing, errors 401/403/404/429, quota-zero
  classification, retry safety, registry/routing, partial health and old schemas.
- Both TypeScript checks and both Wrangler dry-run builds pass.
- npm production dependency audits report **zero vulnerabilities** in both projects.
- Production OAuth/PKCE, connector token refresh, MCP initialize/tools/list and
  read calls pass. No credentials are saved by the protocol verifier.
- Authenticated production `/health`: HTTP 200, `degraded:false`, with zoho,
  square, google_ads, meta_ads and gbp true from real checks. Public health keeps
  account-dependent Zoho checks explicitly unchecked; it does not invent success.
- Square connection (two locations), Google Ads accounts, Zoho folders and Meta
  connection status pass. Other provider Workers and schemas were not changed.
- Live GBP account/location/category/service/attribute/media/customer-media/post/
  review/performance/keyword/verification/action-type/notification reads pass.
  Account-admin restriction above remains explicitly reported. No action-link GET
  could be tested because this location has no action links.
- Non-mutating live previews pass for services, posts, private drafts, location,
  schedule, attributes, batch attachment staging and review replies.
- A live legacy VIDEO post exposed an update validation defect; it was fixed,
  regression-tested and redeployed. Focused production retest now returns a valid
  unexecuted update preview, preserving the old media.
- Final ChatGPT catalog is visibly **115 tools (40 write / 75 read)** after refresh.

Reproduce from `white5-mcp`: `node scripts/test-gbp.mjs`,
`node scripts/generate-gbp-catalog.mjs --check`,
`node scripts/verify-management.mjs`, and `node scripts/verify-production.mjs`.
The last script requires the existing owner's normal browser sign-in. For the
legacy-video regression alone: `node scripts/verify-management.mjs --post-preview`.
Run `npm run typecheck` and `npm run dry-run` in each Worker directory.

Local evidence: `white5-mcp/.local/management-verification.json`,
`post-preview-verification.json`, `production-verification.json`,
`production-catalog.json`, and `proof/*.png`. The full management run records the
initial video-preview failure; the subsequent focused report confirms its fix.

## Files changed

- Provider `src/management/{api,schemas,services,reads,mutations,control}.ts`:
  resource clients, schemas, services, capability/read tools, approval workflow,
  private storage and optional scheduling.
- Provider `src/video.ts`, `src/media.ts`, `src/google-auth-handler.ts`: attachment
  staging, video validation/serving, existing photo flow integration.
- Provider `src/{google-client,operations,tools,server}.ts`: API host allowlist,
  dispatch, tool definitions/annotations, Durable Object export and runtime version.
- Provider `wrangler.jsonc`, `tsconfig.json`, package manifests/locks: binding,
  migration, node types, security dependency updates and deployment settings.
- Gateway `src/{catalog,gbp-tools,env,server}`: aliases/generated schemas, version
  and accurate preview description; existing other provider tools preserved.
- Gateway Wrangler/package files: logging safety and dependency updates.
- `white5-mcp/scripts/{backup-gbp,verify-management,test-gbp,verify-production}.mjs`
  and `tests/{gbp,management,helpers}.mjs`: backups, unit/integration/live checks.
- Worker READMEs, APPROVED-PROJECT.md and this report: current operating guidance.

## Commands the owner can use in ChatGPT

- «Перевір повністю Google Business Profile White5 і покажи пріоритетні проблеми».
- «Покажи послуги White5 та підготуй дев'ять узгоджених назв без фіксованих цін».
- «Завантаж ці прикріплені фото у White5 і покажи попередній перегляд перед публікацією».
- «Порівняй покази Search і Maps та кліки за вересень і серпень 2026».
- «Знайди відгуки без відповіді та запропонуй тексти. Поки нічого не надсилай».
- «Підготуй пост на [дата, час Edmonton] і покажи точний текст та розклад для погодження».

No reconnect or new Google OAuth application is required. The catalog refresh has
already been performed. Owner action is needed only to approve actual content,
prices, permission changes, notification infrastructure or a schedule when desired.

## Complete tool inventory

The following inventory maps provider operation names to the exact ChatGPT names.
"Existing" refers to the 19-operation provider before this upgrade. Compatibility
aliases are retained; no duplicate tool names are registered.

| Change | Provider operation | ChatGPT tool name(s) | Mode |
| --- | --- | --- | --- |
| New | `create_media_batch` | `create_gbp_media_batch` | Preview + confirm |
| New | `capabilities` | `get_gbp_capabilities` | Read |
| New | `list_categories` | `list_gbp_categories` | Read |
| New | `get_category_types` | `get_gbp_category_types` | Read |
| New | `get_google_updates` | `get_gbp_google_updates` | Read |
| New | `find_duplicates` | `find_gbp_duplicates` | Read |
| New | `list_services` | `list_gbp_services` | Read |
| New | `get_service_types` | `get_gbp_service_types` | Read |
| New | `prepare_white5_services` | `prepare_gbp_white5_services` | Read |
| New | `update_services` | `update_gbp_services` | Preview + confirm |
| New | `list_attributes` | `list_gbp_attributes` | Read |
| New | `get_attributes` | `get_gbp_attributes` | Read |
| New | `update_attributes` | `update_gbp_attributes` | Preview + confirm |
| New | `get_media` | `get_gbp_media` | Read |
| New | `list_customer_media` | `list_gbp_customer_media` | Read |
| New | `get_customer_media` | `get_gbp_customer_media` | Read |
| New | `update_media` | `update_gbp_media` | Preview + confirm |
| New | `delete_media` | `delete_gbp_media` | Preview + confirm |
| New | `check_media_publication` | `check_gbp_media_publication` | Read |
| New | `get_post` | `get_gbp_post` | Read |
| New | `save_post_draft` | `save_gbp_post_draft` | Preview + confirm |
| New | `list_post_drafts` | `list_gbp_post_drafts` | Read |
| New | `get_post_draft` | `get_gbp_post_draft` | Read |
| New | `delete_post_draft` | `delete_gbp_post_draft` | Preview + confirm |
| New | `review_summary` | `review_gbp_summary` | Read |
| New | `suggest_review_reply` | `suggest_gbp_review_reply` | Read |
| New | `delete_review_reply` | `delete_gbp_review_reply` | Preview + confirm |
| New | `search_keywords` | `search_gbp_keywords` | Read |
| New | `compare_performance` | `compare_gbp_performance` | Read |
| New | `performance_summary` | `performance_gbp_summary` | Read |
| New | `list_action_types` | `list_gbp_action_types` | Read |
| New | `list_action_links` | `list_gbp_action_links` | Read |
| New | `get_action_link` | `get_gbp_action_link` | Read |
| New | `create_action_link` | `create_gbp_action_link` | Preview + confirm |
| New | `update_action_link` | `update_gbp_action_link` | Preview + confirm |
| New | `delete_action_link` | `delete_gbp_action_link` | Preview + confirm |
| New | `get_voice_of_merchant` | `get_gbp_voice_of_merchant` | Read |
| New | `list_verifications` | `list_gbp_verifications` | Read |
| New | `get_verification_options` | `get_gbp_verification_options` | Read |
| New | `start_verification` | `start_gbp_verification` | Preview + confirm |
| New | `complete_verification` | `complete_gbp_verification` | Preview + confirm |
| New | `list_admins` | `list_gbp_admins` | Read |
| New | `list_invitations` | `list_gbp_invitations` | Read |
| New | `invite_manager` | `invite_gbp_manager` | Preview + confirm |
| New | `remove_manager` | `remove_gbp_manager` | Preview + confirm |
| New | `get_notifications` | `get_gbp_notifications` | Read |
| New | `update_notifications` | `update_gbp_notifications` | Preview + confirm |
| New | `poll_changes` | `poll_gbp_changes` | Read |
| New | `run_full_audit` | `run_full_gbp_audit` | Read |
| New | `schedule_job` | `schedule_gbp_job` | Preview + confirm |
| New | `list_jobs` | `list_gbp_jobs` | Read |
| New | `cancel_job` | `cancel_gbp_job` | Preview + confirm |
| New | `list_reports` | `list_gbp_reports` | Read |
| New | `get_audit_log` | `get_gbp_audit_log` | Read |
| Existing | `upload_media` | `upload_media` | Preview + confirm |
| New | `upload_media_batch` | `upload_gbp_media_batch` | Preview + confirm |
| Existing | `create_media` | `create_gbp_media` | Preview + confirm |
| Existing | `list_media` | `list_gbp_media` | Read |
| Existing | `connection_status` | `get_gbp_status`, `gbp_connection_status` | Read |
| Existing | `list_accounts` | `list_gbp_accounts` | Read |
| Existing | `list_locations` | `list_gbp_locations` | Read |
| Existing | `get_location` | `get_gbp_location` | Read |
| Existing | `list_reviews` | `list_gbp_reviews` | Read |
| Existing | `get_review` | `get_gbp_review` | Read |
| Existing | `list_posts` | `list_gbp_posts` | Read |
| Existing | `prepare_post` | `prepare_gbp_post` | Read |
| Existing | `create_post` | `create_gbp_post` | Preview + confirm |
| Existing | `update_post` | `update_gbp_post` | Preview + confirm |
| Existing | `delete_post` | `delete_gbp_post` | Preview + confirm |
| Existing | `reply_to_review` | `reply_gbp_review`, `reply_to_gbp_review` | Preview + confirm |
| Existing | `update_location` | `update_gbp_location` | Preview + confirm |
| Existing | `get_performance` | `get_gbp_performance` | Read |
| Existing | `get_location_permissions` | `get_gbp_location_permissions` | Read |
| Existing | `set_primary_location` | `set_gbp_primary_location` | Preview + confirm |
