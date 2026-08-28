# White5 Zoho Mail MCP connector

Private remote MCP connector for the `info@white5.ca` Zoho Mail mailbox. It is a separate Cloudflare Worker and does not change the website AI assistant.

## Available tools

- `list_folders` — list mailbox folders.
- `list_emails` — list Inbox, Sent, Drafts, Spam, Trash, Archive, Notification, or Newsletter.
- `search_emails` — search message text and metadata.
- `read_email` — read one message body.
- `mark_emails_read` — mark up to 50 messages as read or unread.
- `archive_emails` — archive up to 50 messages.
- `mark_emails_spam` — move up to 50 messages to Spam.
- `delete_emails_to_trash` — move up to 50 confirmed messages to Trash; never permanently delete them.
- `create_draft` — create a draft without sending.
- `send_email` — send a new email after explicit user confirmation.
- `reply_email` — send a reply after explicit user confirmation.

Permanent deletion, mailbox settings, and attachments are intentionally excluded.

## Security model

- ChatGPT authenticates to the connector with OAuth and PKCE.
- Zoho authenticates the mailbox owner with its Authorization Code flow.
- The Zoho refresh token is stored in Cloudflare's OAuth KV data and is never returned by an MCP tool.
- Authorization is rejected unless the Zoho account contains the configured mailbox (`info@white5.ca` by default) and that address can send mail.
- Read and write permissions are separate MCP scopes.
- Email content is returned with an explicit untrusted-content warning.
- Send and reply tools are marked as external write actions and their descriptions require explicit user confirmation.
- No token, recipient list, subject, or message body is written to logs.

## One-time setup

Requirements: a Cloudflare account and administrator access to the White5 Zoho account.

1. From this directory, sign in to Cloudflare and deploy once to reserve the Worker URL and automatically provision the `OAUTH_KV` binding:

   ```bash
   npx wrangler login
   npm run deploy
   ```

2. In the [Zoho API Console](https://api-console.zoho.com/), create a **Server-based Application** with:

   - Client name: `White5 Zoho Mail Connector`
   - Homepage URL: the deployed Worker origin, for example `https://white5-zoho-mail-mcp.<your-subdomain>.workers.dev`
   - Authorized redirect URI: the same origin plus `/oauth/zoho/callback`

   A Zoho Self Client is not suitable because this connector needs a browser OAuth callback.

3. Store the Zoho credentials as Cloudflare secrets. Enter each value only when Wrangler prompts for it:

   ```bash
   npx wrangler secret put ZOHO_CLIENT_ID
   npx wrangler secret put ZOHO_CLIENT_SECRET
   ```

4. Deploy the configured Worker:

   ```bash
   npm run deploy
   ```

5. In ChatGPT, enable Developer mode and add a custom MCP app using:

   ```text
   https://white5-zoho-mail-mcp.<your-subdomain>.workers.dev/mcp
   ```

   Choose OAuth authentication. During the first connection, sign in to the Zoho Canada account that owns `info@white5.ca` and accept the requested Mail permissions.

## Zoho permissions

The connector requests only:

- `ZohoMail.accounts.READ`
- `ZohoMail.folders.READ`
- `ZohoMail.messages.READ`
- `ZohoMail.messages.CREATE`
- `ZohoMail.messages.UPDATE`
- `ZohoMail.messages.DELETE`

The Zoho authorization uses `access_type=offline` so the Worker receives a refresh token. Zoho access tokens are refreshed server-side when tools run.

## Local development

```bash
cp .dev.vars.example .dev.vars
npm install
npm run types
npm run typecheck
npm run dev
```

Never commit `.dev.vars`, client secrets, refresh tokens, access tokens, or Wrangler state.

## Validation

```bash
npm run typecheck
npm run dry-run
```

The dry run builds the exact Cloudflare Worker bundle without deploying it or sending email.
