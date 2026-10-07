# White5 Google Business Profile MCP

Cloudflare Worker MCP connector for the existing White5 Google Business Profile.

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
- optional `ALLOWED_GOOGLE_EMAIL`
- optional `GOOGLE_REFRESH_TOKEN` for the private White5 gateway binding

The Worker also needs an `OAUTH_KV` KV namespace binding.

The private `White5Service` entry point can instead load an AES-GCM encrypted
refresh token from `OAUTH_KV`. The one-time `/oauth/google/install` flow writes
that encrypted value only when a temporary `GOOGLE_INSTALL_TOKEN` secret is
present. Remove the installation secret after consent completes.

## White5 gateway

The unified `white5-mcp` Worker binds this Worker as
`GOOGLE_BUSINESS -> white5-google-business-mcp#White5Service`. The gateway
publishes the Google Business tools under `gbp_*` aliases and retains the
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

## Initial tools

- `connection_status`
- `list_accounts`
- `list_locations`
- `get_location`
- `list_reviews`
- `list_posts`
- `reply_to_review` (preview unless `confirmed:true`)
