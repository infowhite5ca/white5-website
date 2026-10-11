# Google GBP support request — draft, not sent

Subject: Reported GBP Basic API Access approval, but project still has zero quotas

Hello Google Business Profile API support,

Please confirm whether GBP Basic API Access has been granted to this exact project:

- Project name: My First Project
- Project ID: project-64f4298a-2ff5-4652-854
- Project number: 686968841791
- Business: White5, Calgary, Alberta, Canada, https://white5.ca

OAuth authorization with business.manage and refresh-token exchange both succeed.
Account Management, Business Information, Google My Business v4 and Performance
APIs are enabled in this project. Live read-only requests on 2026-10-10 returned:

| Service | HTTP / Google status | ErrorInfo |
|---|---|---|
| mybusinessaccountmanagement.googleapis.com | 429 RESOURCE_EXHAUSTED | RATE_LIMIT_EXCEEDED, quota_limit_value=0 |
| mybusinessbusinessinformation.googleapis.com | 429 RESOURCE_EXHAUSTED | RATE_LIMIT_EXCEEDED, quota_limit_value=0 |
| businessprofileperformance.googleapis.com | 429 RESOURCE_EXHAUSTED | RATE_LIMIT_EXCEEDED, quota_limit_value=0 |
| mybusiness.googleapis.com, localPosts and reviews | 404 NOT_FOUND | No additional ErrorInfo returned |

The 429 responses identify consumer projects/686968841791 and quota limit
DefaultRequestsPerMinutePerProject. Google Cloud Console also shows the Account
Management Requests per minute quota as 0. The v4 quota page displays a nonzero
general quota; it does not resolve the zero quotas on the other services.

Please confirm the approved project number and activate the applicable GBP API
access/quotas, or identify any remaining eligibility or approval requirement.
Please also clarify the v4 NOT_FOUND responses for the existing profile.

We also have an older separate project, White5 Google Ads API,
concrete-zephyr-505300-g2 (230933935136), where the same Google profile owner can
list the White5 account/location but v4 returns SERVICE_DISABLED. Please confirm
which project the prior approval applies to; we do not want to submit duplicate
access applications or transfer credentials unnecessarily.

No tokens, client secrets, review content or customer data are included here.
Attach the existing approval/case reference when submitting this draft.

Official access instructions: https://developers.google.com/my-business/content/prereqs
Contact form: https://support.google.com/business/contact/api_default
