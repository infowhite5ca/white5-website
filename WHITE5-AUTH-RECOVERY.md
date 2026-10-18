# White5 authorization recovery — 2026-10-18

White5 gateway authentication is restored and verified through the existing
connected White5 app. No reconnect or new OAuth consent was needed.

## Cause

The Zoho deployments on October 13 (`dfff8c48-b345-496f-ac87-65aeb2c51f1c`
and `f088c546-6d50-43d9-9f91-6e4365827d27`) exported only the default HTTP
handler. They omitted the `White5Service` RPC entrypoint and the original
gateway KV binding. `white5-mcp` still targeted that named entrypoint, so
OAuth discovery returned HTTP 500 and `/mcp` returned HTTP 503. The public
health endpoint caught the binding error and reported Zoho as false.

## Recovery and prevention

1. Backed up the active Zoho bundle, settings and version metadata into ignored
   `white5-mcp/.local/zoho-recovery/` without logging secret values.
2. Restored compatible version `541b3854-93b2-4ecb-9033-dc7060e4bc0a` to
   immediately restore entrypoint access and both original KV namespaces.
3. Restored the source implementation from the existing gateway restoration
   branch, retaining all 15 mail tools and their schemas.
4. Corrected internal RPC cleanup so it waits for asynchronous tool results
   before closing transports. Added the client package as a direct dependency.
5. Added OAuth namespace-isolation, discovery, invalid authorization and MCP
   transport regression tests. The dry-run post-check rejects a build missing
   the named export or either original namespace. `npm run deploy` runs these
   checks and preserves dashboard variables. Invocation URL logging is disabled.
6. Deployed the checked source to `white5-zoho-mail-mcp`, version
   `a36f4e95-9743-4e20-9acf-926723ee23c6`.

The gateway, GBP, Square, Google Ads, Meta Ads and website were not redeployed.
Existing secrets and both original OAuth namespaces were retained.

## Verification

- TypeScript passes. All five new automated gateway tests pass.
- Wrangler dry-run succeeds, and the built `White5Service` export / KV contract passes.
- Production `/health` returns HTTP 200 with `ok:true`.
- Authorization-server and protected-resource discovery return HTTP 200.
- `/mcp` without authorization returns the expected HTTP 401.
- The already connected White5 app successfully invokes `list_email_folders`
  against `info@white5.ca` (11 folders).
- The same app successfully invokes `get_gbp_status`: Google token refresh,
  account, location, posts, reviews and performance checks all succeed.
- Square connection, Google Ads accessible accounts and Meta connection checks
  all succeed through the unified White5 app.

The public health response intentionally leaves per-user Zoho mailbox status
unchecked (`zoho:null`, `configured:true`), so it still reports `degraded:true`
without a bearer token. This is distinct from the repaired binding failure;
the connected app's real mailbox read confirms Zoho is working.

The Windows host was near its virtual-memory commit limit during builds. The
successful dry-run and deployment used the installed Wrangler CLI directly,
with reduced task-local Node/Go memory settings, avoiding extra launcher
processes. No user application or OS setting was changed.
