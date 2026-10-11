# White5 GBP integration — 2026-10-10

## Result

Deployed the existing `white5-mcp` gateway (runtime version 1.2.0) and existing
`white5-google-business-mcp` provider. No replacement server was created.
Production MCP advertises 57 tools, including 18 GBP names/compatibility aliases
for 16 provider operations. ChatGPT's White5 app was refreshed and its UI now
shows the GBP tools (38 read tools, 19 write tools total).

Core account/location discovery and local draft validation work. Posts, reviews,
and performance are implemented but remain blocked by project API access.
The intended My First Project provider is also deployed and authorized, but live
Google requests prove its modern GBP quotas are zero. The gateway has not been
switched to it because that would break working discovery. Full API capability
and completion of the entire task are not claimed.

## Root cause and authorization evidence

- Production initially advertised 46 tools including seven GBP aliases, while
  the ChatGPT connection exposed an older 38-tool catalog with no GBP provider.
  Repeated OAuth reconnection did not update that catalog. Used **Refresh tools**
  in the existing app and verified GBP names in the resulting ChatGPT UI.
- The provider was incomplete: posts/reviews had only basic read/reply coverage,
  no requested post writes or performance, and health mostly checked configuration.
- Existing Google refresh credentials work with `business.manage` scope.
  Account Management and Business Information authenticated reads succeed.
- The provider currently bound to the gateway uses `concrete-zephyr-505300-g2`,
  number `230933935136`, display name **White5 Google Ads API**.
- A second existing Worker, `white5-google-business-profile-mcp`, uses
  **My First Project**, ID `project-64f4298a-2ff5-4652-854`, number `686968841791`.
  The OAuth client prefixes and Cloud Console client list confirm the mismatch.
  Its original three public tools and OAuth routes are preserved; a private
  White5Service adapter has been deployed using its existing secrets and KV.
- The user approved this second client's business.manage grant. Authorization,
  encrypted token storage and live refresh succeeded; the temporary install
  secret was removed. No credentials were copied into source or terminal output.
- Authenticated requests in My First Project return 429 RESOURCE_EXHAUSTED,
  RATE_LIMIT_EXCEEDED, consumer projects/686968841791, quota_limit_value 0 for
  Account Management, Business Information and Performance. Console confirms
  Account Management quota 0. Enabled API status and the v4 displayed general
  quota of 3,000/min do not establish access to these other APIs.
- My First Project posts/reviews requests return 404 NOT_FOUND. The response
  alone cannot establish whether resource access or project access is responsible;
  listing resources under that client is blocked by the zero quotas.
- Posts/reviews return HTTP 403 `SERVICE_DISABLED` for `mybusiness.googleapis.com`.
  The v4 Google My Business API was not visible in this project's API Library;
  its direct page failed to load. The reported approval does not establish usable
  v4 access. Verify GBP approval for this exact project with Google if unavailable.
- Performance returns HTTP 403 `SERVICE_DISABLED` for
  `businessprofileperformance.googleapis.com`.
- Verification state API is separately disabled; Business Information reports
  `metadata.hasVoiceOfMerchant=true`, and Account Management returns ownership.

## Primary profile

Paginated through all accessible accounts and locations. One account and one
White5 location were accessible: White5, white5.ca, service area including Calgary,
Airdrie and Okotoks. It has Voice of Merchant, no duplicate marker, and the connected
account has PRIMARY_OWNER permission. Saved its account/location in the existing
private KV key `gbp-primary-location:v1`. No Google listing changed. Reviews could
not contribute to selection because the v4 API is disabled; no other accessible
candidate was found. This does not prove that no inaccessible duplicates exist.

## Implemented tools

`get_gbp_status`, `list_gbp_accounts`, `list_gbp_locations`, `get_gbp_location`,
`list_gbp_posts`, `prepare_gbp_post`, `create_gbp_post`, `update_gbp_post`,
`delete_gbp_post`, `list_gbp_reviews`, `get_gbp_review`, `reply_gbp_review`,
`update_gbp_location`, `get_gbp_performance`, `get_gbp_location_permissions`,
`set_gbp_primary_location`. Retained `gbp_connection_status` and
`reply_to_gbp_review` compatibility aliases.

STANDARD posts accept text, public photo URLs and CTA/website links. Preparation
is a local draft, not a Google-side draft. Information updates use an allowlist
and default to Google's validateOnly. Performance includes Search/Maps impression
splits, website clicks and call clicks; call clicks do not mean completed calls.
All mutations require `confirmed:true` after explicit user approval.

OAuth state is bound to a secure browser cookie and short-lived single-use KV
record. Existing encrypted refresh-token storage is retained. Requests validate
resource IDs and URLs, use bounded read retries, respect rate limits, avoid write
retries and sanitize errors. OAuth request URL invocation logging is disabled.

## Tests and production verification

- 16 automated tests passed: preview/no-network guards, schemas, methods/masks,
  write scopes, 401/403/404/429 handling, retry behavior, refresh-scope validation,
  encrypted storage/tampering, OAuth state rejection, catalog compatibility,
  health degradation and MCP protocol registration/routing. Additional tests cover
  legacy public compatibility, structured zero-quota errors without retries,
  secret redaction, and successful OAuth refresh with unavailable account access.
- Both TypeScript projects pass `tsc --noEmit`; generated catalog matches source;
  Wrangler builds and production deployments succeeded; `git diff --check` passes.
- Production OAuth/PKCE exchange and connector token refresh succeeded.
- Production initialize/tools/list succeeded (57 tools); GBP status, account list,
  location list, location details and local post preview succeeded.
- Fresh production checks after the diagnostic deployments confirm posts, reviews
  and performance return accurate 403 `api_disabled` errors identifying project
  230933935136. No live business write tests were performed.
- Production Square connection, Google Ads account listing, Zoho folder listing
  and Meta connection checks all passed. Their original provider schema catalog
  is unchanged. No advertising budgets or campaign states changed.
- Authorized health returned all five service connection flags true, with GBP
  restrictions separately reported. Final public health returns HTTP 200,
  `degraded:true`, GBP/account connectivity true and explicit unavailable
  posts/reviews/performance. Public Zoho is `null` (not checked without a bearer),
  rather than hardcoded true. Missing GBP does not fail healthy providers.
- Unauthenticated production `/mcp` correctly returns HTTP 401.

Safe local evidence: `white5-mcp/.local/production-verification.json`,
`production-catalog.json` and `chatgpt-gbp-tools.png`. Ignored snapshots can contain
private operational data and are intentionally excluded from Git.

## Deployment

Gateway: `white5-mcp`, Cloudflare version
`b3dc85ad-1966-4675-a274-9abda64853c3`.

GBP provider: `white5-google-business-mcp`, Cloudflare version
`de42f558-41e7-4455-8101-3010724ea9fa`.

Intended-project adapter: existing `white5-google-business-profile-mcp`, version
`9d457b3d-8661-43a9-b483-854ff75125ac`. Its gateway migration is blocked by Google;
the current gateway deployment and binding remain unchanged.

Endpoints:
- https://white5-mcp.volodymyronufriichuk68.workers.dev/health
- https://white5-mcp.volodymyronufriichuk68.workers.dev/mcp

Bindings, routes, account, secrets and KV namespace retained. Source is in the
existing `infowhite5ca/white5-website` repository. The available Zoho source did
not match its live private entrypoint; it was not modified or redeployed.

## Files changed

- Provider: `src/tools.ts`, `src/operations.ts`, `src/google-client.ts`,
  `src/google-auth-handler.ts`, `src/server.ts`, `src/service.ts`,
  `wrangler.jsonc`, `package.json`, `scripts/live-oauth-probe.mjs`, `README.md`.
- Gateway: `src/gbp-tools.json`, `src/catalog.ts`, `src/env.ts`, `src/index.ts`,
  `src/server.ts`, `src/health.ts`, `.gitignore`, `README.md`.
- Gateway scripts: `generate-gbp-catalog.mjs`, `inspect-deployment.mjs`,
  `probe-bindings.mjs`, `test-gbp.mjs`, `verify-production.mjs`.
- Tests: `white5-mcp/tests/gbp.test.mjs`; this report.
- Intended-project adapter: `src/approved-project-server.ts`, `src/legacy-public.js`,
  `src/legacy-public.d.ts`, `wrangler.approved-project.jsonc`,
  `scripts/recover-legacy-public.mjs`, `APPROVED-PROJECT.md`.
- Installation helper: `white5-mcp/scripts/install-approved-gbp.mjs`.
- Unsent support draft: `GBP-GOOGLE-SUPPORT-DRAFT.md`.

## Remaining actions

1. Ask Google to confirm approval for My First Project (686968841791), resolve
   its zero modern GBP quotas and clarify v4 NOT_FOUND. An unsent support draft
   is ready in GBP-GOOGLE-SUPPORT-DRAFT.md. Reconnecting White5 cannot fix quotas.
2. After Google resolves access, run the intended-project read-only probe and
   save the primary location; then change GOOGLE_BUSINESS to the already-existing
   white5-google-business-profile-mcp#White5Service and deploy/verify the gateway.
   Secrets do not need to be moved or exposed.
3. Google consent displayed Testing status. Review publishing status before
   unattended production use: external Testing apps with business.manage normally
   issue seven-day refresh tokens. No publishing or broader-access change was made.
4. ChatGPT's catalog is refreshed; use a new conversation if an existing one
   retains older metadata. This active Codex tool session still contains its
   original static tool set; no claim of an end-to-end new-chat tool call is made.

References: [Google setup](https://developers.google.com/my-business/content/basic-setup),
[Local Posts](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts),
[Google zero-quota guidance](https://developers.google.com/my-business/content/limits),
[OAuth token expiration](https://developers.google.com/identity/protocols/oauth2#expiration),
[ChatGPT tool refresh](https://developers.openai.com/plugins/deploy/connect-chatgpt).
