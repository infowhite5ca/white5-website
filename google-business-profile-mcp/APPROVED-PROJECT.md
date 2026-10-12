# Approved production Google project

Verified 2026-10-11 against Google's October 7 approval email and live APIs.

| Setting | Production value |
| --- | --- |
| Google project | White5 Google Ads API |
| Project ID | concrete-zephyr-505300-g2 |
| Project number | 230933935136 |
| GBP Worker | white5-google-business-mcp |
| Gateway binding | GOOGLE_BUSINESS -> white5-google-business-mcp#White5Service |
| Deployment config | wrangler.jsonc (default npm deploy) |

This project is explicitly approved with 300 QPM. Account Management, Business
Information, Google My Business v4 and Performance all pass authenticated reads.
OAuth business.manage authorization and token refresh pass. Posts, reviews and
performance became available after enabling the missing APIs on October 11.
Temporary Service Usage Admin/Browser roles used for activation were removed;
production connectivity was verified again afterward.

Do not migrate to My First Project (686968841791). That alternate existing Worker,
white5-google-business-profile-mcp, has zero modern GBP quotas and is not the
project approved in the email. Historical filenames wrangler.approved-project.jsonc,
src/approved-project-server.ts and the --approved-project probe option refer to
that alternate adapter. Their names do not establish approval. The gateway does
not use it. No credential copying or OAuth client change is required.

Optional My Business Verifications API remains disabled; the separate verification
history call reports that accurately. Business Information profile status works.
See ../GBP-INTEGRATION-REPORT.md for final deployment IDs, tests and limitations.
