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

The Worker also needs an `OAUTH_KV` KV namespace binding.

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
