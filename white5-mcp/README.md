# White5 MCP Gateway

Unified MCP gateway for White5 provider Workers:

- Zoho Mail
- Square
- Google Ads
- Meta Ads
- Google Business Profile

The production endpoint is:

`https://white5-mcp.volodymyronufriichuk68.workers.dev/mcp`

Authentication remains owned by the existing White5 OAuth flow. Provider
Workers are connected through private Cloudflare service bindings.

## Google Business Profile

The existing `GOOGLE_BUSINESS` binding targets
`white5-google-business-mcp#White5Service`. No extra server is required.
`src/gbp-tools.json` is generated from `../google-business-profile-mcp/src/tools.ts`.
Existing provider schemas in `src/upstream-tools.json` remain unchanged.

Tools cover status, account/location discovery, profile information, permissions,
posts, reviews, daily performance, local post previews and primary selection.
All writes preview by default and require `confirmed:true` after approval of the
exact change. Profile updates also default to Google's `validateOnly:true`.

`/health` performs live reads and reports each GBP capability separately.
`services.gbp` means account authorization works, not that every Google API is
enabled. `degraded:true` includes unavailable GBP capabilities. Public health
reports Zoho as `null` because its mailbox check requires the user's bearer token;
authorized health checks all five integrations. GBP restrictions do not break
otherwise healthy providers.

## Validation and deployment

From this directory after installing dependencies in both projects:

```sh
node scripts/generate-gbp-catalog.mjs --check
node scripts/test-gbp.mjs
npm run typecheck
npm run dry-run
npm run deploy
```

Deploy provider changes from `../google-business-profile-mcp` first using its
existing Wrangler configuration. `--keep-vars` preserves dashboard variables;
secrets and KV are retained. Never copy credentials into source or diagnostics.

`node scripts/probe-bindings.mjs` checks private bindings with Wrangler's existing
Cloudflare authorization. `--select-primary` writes only private KV after finding
one unambiguous verified White5 location; obtain user confirmation before using it.
`node scripts/verify-production.mjs` runs a normal OAuth/PKCE browser flow, keeps
tokens in memory, and checks production MCP plus all existing integrations.
Safe reports and downloaded deployment snapshots go into ignored `.local/`.

After changing the advertised catalog, use **Refresh tools** in the existing
ChatGPT White5 app settings. Existing conversations can retain older tool metadata;
start a new conversation to use the refreshed catalog. Reconnecting OAuth is not
a substitute for updating the catalog.
