# Approval correction — do not migrate to My First Project

**2026-10-11:** The October 7 Google approval email explicitly names project
230933935136 (White5 Google Ads API), with 300 QPM. That is the current gateway
provider's project. My First Project was incorrectly assumed to be the approved
target. The migration steps below are historical and MUST NOT be executed.

The default wrangler.jsonc and npm deploy target the correct provider.
The historical filenames wrangler.approved-project.jsonc and
src/approved-project-server.ts, and --approved-project probe flag, refer to the
alternate My First Project adapter; their names are not evidence of approval.

The approval recipient sees the private API but lacks IAM membership in the
approved project. A scoped Service Usage Admin grant is prepared, awaiting user
confirmation. Resolve that account-access mismatch and activate APIs in
230933935136. Do not copy secrets, rotate clients, or change the gateway binding.

## Historical alternate-project investigation, 2026-10-10

The original discovery was incomplete: two existing GBP Workers use different
Google projects. This was confirmed against their live Google authorization
redirects and Google Cloud's OAuth client list on 2026-10-10.

| Existing Worker | Google project | OAuth client prefix |
|---|---|---|
| white5-google-business-mcp | White5 Google Ads API / concrete-zephyr-505300-g2 | 230933935136 |
| white5-google-business-profile-mcp | My First Project / project-64f4298a-2ff5-4652-854 | 686968841791 |

The second project has Account Management, Business Information, Google My
Business v4 and Performance APIs enabled. Its displayed V4 quota is 3,000
requests/minute, but this does NOT establish access to the other APIs:
authenticated Account Management, Business Information and Performance requests
all return 429 RESOURCE_EXHAUSTED / RATE_LIMIT_EXCEEDED with
consumer=projects/686968841791 and quota_limit_value=0. The Account Management
console also displays 0 requests/minute. Posts and reviews return 404 NOT_FOUND.
The first project's disabled APIs explain the gateway's previous 403 errors.

The approved project's existing Worker already holds its client secret and has
the correct callback URI. Do not export its secrets, create a replacement Worker,
or rotate its client merely to connect the gateway.

`wrangler.approved-project.jsonc` updates this existing Worker, preserving its KV
namespace and credentials. `src/approved-project-server.ts` adds the common private
White5Service entrypoint and the one-time gateway installation route. Its original
public OAuth endpoints, scope business-profile:read, and three read-only tools
are preserved by `src/legacy-public.js`, recovered from the deployed source.
The recovery script extracts application code and imports installed dependencies;
the snapshot SHA256 is recorded in the recovered file. No secrets are included.

Before changing the gateway binding:

1. Deploy with `wrangler deploy --config wrangler.approved-project.jsonc --keep-vars`.
2. From white5-mcp run `node scripts/install-approved-gbp.mjs`. This uses a temporary
   install credential, never prints it, and removes it on completion or timeout.
   Google authorization stores the refresh token encrypted in the existing KV.
3. Run `node scripts/probe-bindings.mjs --approved-project --select-primary` after
   the user's authorization to save the same verified White5 location privately.
4. Only after successful read-only checks change GOOGLE_BUSINESS to the existing
   white5-google-business-profile-mcp#White5Service and deploy the gateway.
5. Verify production tools, health and all four other integrations again.

Current checkpoint (2026-10-10): provider adapter deployed as
9d457b3d-8661-43a9-b483-854ff75125ac. The user approved business.manage consent;
authorization completed and encrypted refresh-token storage and live refresh both
work. The temporary installation credential was removed. The public legacy
three-tool interface remains unchanged.

Gateway binding has not changed because moving it now would break working
account/location discovery. `npm run deploy` intentionally still targets the
current gateway provider; use the explicit approved-project config for this
adapter. Resolve the intended project's zero quotas with Google before steps 3–5.
The config filename denotes the reportedly approved project, not verified API access.

Google consent displayed Testing status. Before relying on unattended access,
review production publishing status: external Testing apps using business.manage
normally receive refresh tokens with a seven-day lifetime. No OAuth publishing
or broader-access change has been made.

See ../GBP-GOOGLE-SUPPORT-DRAFT.md for an unsent support request and
../GBP-INTEGRATION-REPORT.md for current production results.
