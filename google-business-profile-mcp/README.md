# White5 Google Business Profile MCP

Cloudflare Worker MCP connector for the existing White5 Google Business Profile.

Two existing Workers use different Google projects. The current gateway still
uses `white5-google-business-mcp`. The intended `My First Project` adapter is
deployed separately to the pre-existing `white5-google-business-profile-mcp`,
but its Google quotas are zero. See [migration status](APPROVED-PROJECT.md) before
changing the gateway binding or choosing a deployment config.

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

The Worker also needs an `OAUTH_KV` KV namespace binding.

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
