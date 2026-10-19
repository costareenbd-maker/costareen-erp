# Connecting every social network: what the provider sets up once (20 Oct 2026)

The ERP can post to these networks. Facebook, Instagram and their stories use the Meta app already in place. The
others each need the provider (us) to register one developer app, once, and put its keys in the function's secrets;
after that every company presses **Connect** under Settings → Connections and logs in with its own account.

The way back from every login page is the same address, which must be registered on each app:

```
https://oqzcuuytytqadqjlwdsh.supabase.co/functions/v1/erp?social=back
```
(the ERP adds `&p=<network>` itself; register the address exactly as above, and with `&p=threads` etc. where the
network insists on an exact match - Threads, LinkedIn and Pinterest do).

| Network | Where to register | Keys (function secrets) | Scopes / notes |
|---|---|---|---|
| Threads | developers.facebook.com → the Costareen ERP app → add the **Threads API** use case (its own app id/secret) | `THREADS_APP_ID`, `THREADS_APP_SECRET` | threads_basic, threads_content_publish, threads_manage_insights. Needs App Review like Facebook. |
| TikTok | developers.tiktok.com → Manage apps → add **Login Kit** + **Content Posting API** | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | user.info.basic, video.publish, video.upload. Until TikTok audits the app, its posts are visible to the posting account only. |
| YouTube Shorts | console.cloud.google.com → the ERP's Google project → enable **YouTube Data API v3**; the existing OAuth client | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (already set for Drive) | youtube.upload, youtube.readonly. Add the way-back address to the OAuth client's redirect URIs. Google verification needed to leave "testing" (100 users). |
| LinkedIn | linkedin.com/developers → create app (needs a Company Page) → products: **Sign In with LinkedIn using OpenID Connect** + **Share on LinkedIn** | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | openid, profile, w_member_social (posts from the person's profile; a Company Page needs the Community Management API - later). Pictures only from here; videos later. |
| X (Twitter) | developer.x.com → project + app → User authentication: OAuth 2.0, type Web App, read + write | `X_CLIENT_ID`, `X_CLIENT_SECRET` | tweet.read, tweet.write, users.read, offline.access. The free tier allows a limited number of posts a month; check the current limit before relying on it. Pictures only from here. |
| Pinterest | developers.pinterest.com → create app (needs a business account) → request **standard access** | `PINTEREST_APP_ID`, `PINTEREST_APP_SECRET` | boards:read, pins:read, pins:write, user_accounts:read. Pins go to the account's first board. Pictures only. |
| Telegram channel | nothing to register: the owner makes a bot with @BotFather, adds it as an admin of the channel, pastes the token and the channel under Settings → Connections | none | Works today. |
| WhatsApp status, Facebook Marketplace | no API exists | none | Captions are written; the owner copies them. |

Put the keys in with:

```
cd deploy && source secrets.env && python deploy.py secrets THREADS_APP_ID=... THREADS_APP_SECRET=... TIKTOK_CLIENT_KEY=... TIKTOK_CLIENT_SECRET=... LINKEDIN_CLIENT_ID=... LINKEDIN_CLIENT_SECRET=... X_CLIENT_ID=... X_CLIENT_SECRET=... PINTEREST_APP_ID=... PINTEREST_APP_SECRET=...
```

Until a network's keys are set, Settings → Connections shows "not set up by the provider yet" for it and the Posts
form keeps its box greyed out; the captions for it are still written, so a post made today can be sent there later.

## Posting bridges (20 Oct 2026, tag social-bridge-1)

Instead of registering a developer app on each network and waiting for its review, a network can post through a
**bridge**: a third-party posting service whose own app is already approved. `handlers/bridges.js`. Staff never see
the service: the Posts form shows TikTok / YouTube / LinkedIn / X / Pinterest / Threads as simply "connected".

| Service | Free tier | Connect how | Key env (provider's) |
|---|---|---|---|
| Zernio (zernio.com) | 2 accounts, unlimited posts | link from its API, per company profile | `BRIDGE_ZERNIO_KEY` |
| Publora (publora.com) | 3 accounts, 15 posts/month, no X | on its own site, then Refresh | `BRIDGE_PUBLORA_KEY` |
| Upload-Post (upload-post.com) | 2 profiles, 10 uploads/month, no TikTok | branded connect page (48 h link), per company profile | `BRIDGE_UPLOADPOST_KEY` |

- Provider's key in the environment = one bridge for every company (each company gets its own profile on
  Zernio / Upload-Post). A company can also paste its own key under Settings → Connections → Posting bridges.
- Routing (`socialnet.publishTo`): our own key for the network first; otherwise the first bridge that holds an
  active account for it. Zernio and Publora answer "pending"; the minute timer (`socialTick`) asks again until
  published and keeps the network's link. Upload-Post answers at once.
- Stats for bridged posts are not read (they live on the service's dashboard).
- **Terms:** combine different services; never two free accounts of one service (its terms forbid it).
- Buffer: new API is GraphQL and its docs are thin; not added yet. Ayrshare has no free plan.
- Not done: Pinterest needs a board id (Upload-Post refuses without it); X on the free tiers is only via Zernio.
