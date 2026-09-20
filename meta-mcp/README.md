# White5 Meta Ads MCP

Private MCP server for the White5 Meta ad account. It reuses the White5 Meta
Marketing API work, upgrades it to Graph API `v26.0`, and exposes safe read and
write tools to ChatGPT and the future White5 CRM.

## White5 assets

- Business: `435078803026689`
- Ad account: `act_1242143730059500`
- Facebook Page: `435075943026975`
- Pixel: `1587609516129238`

## Required secrets

Set these with `wrangler secret put`; never commit them:

- `META_ACCESS_TOKEN` — production System User token with assigned ad-account
  and Page assets.
- `META_APP_SECRET` — secret for the Meta app that issued the token.
- `MCP_ACCESS_KEY` — long random secret embedded only in the private MCP URL.

Optional:

- `META_APP_ID` — enables the `inspect_meta_token` diagnostic. White5 currently
  has two candidate Meta apps, so select the app that actually issued the token.

Minimum useful token permissions are `ads_read` and `ads_management`. Page ad
creative and Lead Ads tools also require the applicable Page/lead permissions
and the System User must be assigned the White5 Facebook Page in Business
Settings. The previous White5 blocker was missing Page asset access.

## Safety model

- Read tools never mutate Meta.
- Every write tool defaults to `dry_run: true`.
- A live mutation requires both `dry_run: false` and `confirm_apply: true`.
- Campaigns, ad sets, and ads created through the generic mutation tool are
  forced to `PAUSED` unless the caller is explicitly using a status-update tool.
- API payloads are sanitized so access tokens and signed pagination URLs are
  never returned to the MCP client or logs.

## Local verification

```bash
npm install
npm run check
```

## Deploy

```bash
npx wrangler secret put META_ACCESS_TOKEN
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_APP_ID
npx wrangler secret put MCP_ACCESS_KEY
npm run deploy
```

After deployment:

- Health: `https://<worker-domain>/health`
- MCP: `https://<worker-domain>/mcp/<MCP_ACCESS_KEY>`

Run `get_meta_connection_status` first. A healthy ad-account response paired
with a failed Page check means the System User still needs Page asset access.
