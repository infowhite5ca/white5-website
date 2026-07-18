# White5 Meta Marketing API setup

The repository now contains a protected Cloudflare Pages Function at:

`GET /api/meta/status`

It checks whether White5 can reach the connected Meta ad account. It does not create, edit, activate, or spend on campaigns.

## Cloudflare secrets

In the Cloudflare dashboard, open the White5 Pages/Workers project and add these encrypted secrets for Production and Preview:

- `META_ACCESS_TOKEN` — the token generated for White5 Ads Manager
- `META_AD_ACCOUNT_ID` — `act_1242143730059500`
- `META_PAGE_ID` — `435075943026975`
- `META_APP_SECRET` — optional but recommended; copy it from Meta App Settings, never from Graph API Explorer
- `ADMIN_API_KEY` — create a long random private password used only to protect White5 admin endpoints

Never commit the actual values to GitHub.

## Test

After deployment, send a GET request to:

`https://www.white5.ca/api/meta/status`

with this HTTP header:

`x-admin-key: <ADMIN_API_KEY>`

Expected success response:

```json
{
  "ok": true,
  "apiVersion": "v25.0",
  "adAccount": {
    "id": "act_...",
    "name": "...",
    "account_status": 1,
    "currency": "CAD",
    "timezone_name": "America/Edmonton"
  },
  "pageIdConfigured": true
}
```

## Security

- Do not paste the Meta access token, Meta App Secret, or `ADMIN_API_KEY` into chat.
- The endpoint requires `x-admin-key` and returns no token values.
- The endpoint uses `appsecret_proof` automatically when `META_APP_SECRET` is configured.
- All future campaign-creation endpoints must create campaigns in `PAUSED` status by default.
