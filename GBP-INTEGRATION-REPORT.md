# White5 GBP integration — completed 2026-10-11

## Result

The existing production `white5-mcp` gateway and `white5-google-business-mcp`
provider are deployed and working. Production MCP lists 57 tools, including
18 GBP names/compatibility aliases for 16 operations. The connected White5 tools
were invoked successfully in this conversation, confirming discovery and use.
No replacement MCP server was created.

## Root cause and Google project

The missing functionality combined an outdated ChatGPT tool catalog, incomplete
GBP operations, and disabled Google APIs in the production OAuth project.
The catalog was refreshed and the implementation completed. Reconnecting the
connector alone could not fix the Google API restrictions.

The active GOOGLE_CLIENT_ID belongs to **White5 Google Ads API**, project ID
`concrete-zephyr-505300-g2`, number **230933935136**. It does not belong to
My First Project (686968841791). Google's October 7 approval email explicitly
approves 230933935136 with 300 QPM. The earlier proposed migration to My First
Project was incorrect and has been abandoned.

Before the fix, authenticated Google requests returned HTTP 403,
`PERMISSION_DENIED`, ErrorInfo reason `SERVICE_DISABLED`, with consumer
`projects/230933935136` and service `mybusiness.googleapis.com` for posts/reviews
or `businessprofileperformance.googleapis.com` for performance. These were API
activation failures, not expired OAuth credentials or missing profile ownership.

The approval recipient could see the private Google My Business API but lacked
IAM access to the approved project. The project owner could access the project
but could not see that private API. With explicit user approval, temporary
Service Usage Admin and Browser roles allowed activation of Google My Business
and Business Profile Performance in the correct project. Both temporary roles
were then removed; the original project Owner remains. GBP status and every core
capability were checked successfully after cleanup.

Account Management, Business Information, Google My Business v4 and Performance
now accept authenticated production requests. Google OAuth business.manage scope
and refresh work. The active OAuth client, secrets and gateway binding remain in
place. No further Worker configuration change is required for this API fix.

## Primary profile

All accessible accounts/locations were paginated: one account and one White5
location were available, with white5.ca and a Calgary/Airdrie/Okotoks service area.
Business Information reports Voice of Merchant, no duplicate marker, and the
connected user is PRIMARY_OWNER. Reviews now confirm 7 reviews averaging 5.0.
The selected account/location is stored in existing private KV under
`gbp-primary-location:v1`. No listing was merged, deleted or modified.
This does not establish that no inaccessible duplicates exist.

## Tools

`get_gbp_status`, `list_gbp_accounts`, `list_gbp_locations`, `get_gbp_location`,
`list_gbp_posts`, `prepare_gbp_post`, `create_gbp_post`, `update_gbp_post`,
`delete_gbp_post`, `list_gbp_reviews`, `get_gbp_review`, `reply_gbp_review`,
`update_gbp_location`, `get_gbp_performance`, `get_gbp_location_permissions`,
`set_gbp_primary_location`. Compatibility aliases: `gbp_connection_status` and
`reply_to_gbp_review`.

STANDARD posts support text, public photo URLs and CTA/website links. Preparation
creates a local draft only. Business information updates use validated field
allowlists and default to Google's validateOnly. Performance includes Search and
Maps impression splits, website clicks and call clicks (not completed calls).
All mutations require confirmed:true following explicit user confirmation.

OAuth uses secure cookies, short-lived single-use state and encrypted refresh
storage. Resource validation, sanitized errors, bounded transient read retries,
rate-limit handling and zero-quota diagnostics are implemented. Writes are not
blindly retried. Credentials are excluded from source, logs and reports.

## Tests and live results

- 16 automated tests passed, covering schemas, local previews, confirmation guards,
  OAuth state/storage/scope, 401/403/404/429 errors, retries, zero quotas, redaction,
  legacy compatibility, catalog/routing and health degradation.
- Both TypeScript projects passed typechecking; catalog generation, Wrangler
  builds and deployments succeeded. Existing integration schemas are preserved.
- Production OAuth/PKCE and connector token refresh passed.
- Production initialize/tools/list passed: 57 tools.
- Account/location discovery and location details passed.
- Posts: 5 retrieved. Reviews: 7 retrieved; individual review GET also passed.
- Performance: September 2026 daily data request for the four Search/Maps
  impression metrics, website clicks and call clicks passed.
- Text/photo/CTA draft validation passed locally, without sending a Google write.
- Square connection, Google Ads accounts, Zoho folders and Meta connection passed.
- Authorized /health: HTTP 200, ok:true, degraded:false; zoho, square, google_ads,
  meta_ads and gbp all true. All five GBP capability checks are available.
- Final public /health: HTTP 200 and GBP fully available. Public Zoho is null and
  degraded:true because its live check requires a bearer token; it is not a
  reported Zoho outage. Unauthenticated /mcp correctly returns HTTP 401.
- Native connected White5 tools also passed after temporary IAM removal.

No posts, replies, business edits, ad budgets or campaign states were changed.
Live write operations were deliberately not executed. Automated schema/guard
validation is not a claim that Google accepted a real publication.

## Deployment

| Worker | Deployed Cloudflare version |
| --- | --- |
| white5-mcp (runtime 1.2.0) | b3dc85ad-1966-4675-a274-9abda64853c3 |
| white5-google-business-mcp | de42f558-41e7-4455-8101-3010724ea9fa |

Production endpoints:
- https://white5-mcp.volodymyronufriichuk68.workers.dev/health
- https://white5-mcp.volodymyronufriichuk68.workers.dev/mcp

Existing binding: `GOOGLE_BUSINESS -> white5-google-business-mcp#White5Service`.
Routes, Cloudflare account, secret storage and KV are retained. Existing Zoho,
Square, Google Ads and Meta providers were not replaced.

Repository: `infowhite5ca/white5-website`, branch
`codex/google-business-profile-mcp`. Implementation commits:
`2c13e6f0973d161141ded8f297bf8db836903bab` and
`721a696db1f14ff5efabb06ed99300ff15e6fb9e`.

## Files changed across the implementation

- `google-business-profile-mcp/src/`: tools.ts, operations.ts, google-client.ts,
  google-auth-handler.ts, server.ts, service.ts.
- Provider configuration/docs: wrangler.jsonc, package.json, README.md,
  APPROVED-PROJECT.md, scripts/live-oauth-probe.mjs.
- `white5-mcp/src/`: gbp-tools.json, catalog.ts, env.ts, index.ts, server.ts,
  health.ts; gateway README.md and .gitignore.
- Gateway scripts: generate-gbp-catalog.mjs, inspect-deployment.mjs,
  probe-bindings.mjs, test-gbp.mjs, verify-production.mjs,
  install-approved-gbp.mjs; tests/gbp.test.mjs.
- Historical alternate adapter: src/approved-project-server.ts, src/legacy-public.js,
  src/legacy-public.d.ts, wrangler.approved-project.jsonc,
  scripts/recover-legacy-public.mjs. Despite those filenames, this adapter belongs
  to My First Project and is NOT the approved production target. Its existing
  Worker was retained, with gateway binding unchanged.
- GBP-INTEGRATION-REPORT.md and GBP-GOOGLE-SUPPORT-DRAFT.md.

## Remaining actions and limits

No user action or reconnection is needed for the requested core integration.
The optional My Business Verifications API is disabled and its dedicated
verification-history call reports 403 SERVICE_DISABLED accurately. Profile
status remains available through Business Information's Voice of Merchant.
Enable that additional API only if verification-history workflows are needed.
No Google support message was sent; a new access application is unnecessary.

Private local evidence (excluded from Git):
`white5-mcp/.local/production-verification.json`, `production-catalog.json`,
`chatgpt-gbp-tools.png`, and `gbp-iam-cleaned.png`.

Official references: [setup](https://developers.google.com/my-business/content/basic-setup),
[accounts](https://developers.google.com/my-business/reference/accountmanagement/rest/v1/accounts/list),
[locations](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations/list),
[posts](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts).
