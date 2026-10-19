# Advertising automation: plan (20 Oct 2026)

Owner's ask: content made for the business automatically (photo and video), published to every platform in one click
with a caption fitted to each platform; inspiration from pages and reel links he gives; rules the system follows to
grow and go viral; a professional marketer. And: paid Facebook campaigns from the ERP.

What exists already: Campaigns > Advertisement (what to advertise, a week plan, AI-written drafts, playbook), Creators
tracker, the Inbox with the Meta login (one Facebook login for the whole ERP; the app already asks for posting and ads
permissions), product photos and figures in the ERP, Gemini on the provider's key.

## 1. What is possible, honestly

| Platform | Publish from the ERP | How | Blocker |
|---|---|---|---|
| Facebook Page (post, photo, reel, story) | Yes | Graph API, the same Meta app | App Review: pages_manage_posts (+ pages_read_engagement for results) |
| Instagram (post, reel, carousel, story) | Yes | Instagram Content Publishing API | Instagram must be a Business/Creator account linked to the Page (today neither page has one linked); App Review: instagram_content_publish, instagram_manage_insights |
| Facebook Marketplace | No API | Draft + copy only (as now) | Meta gives no API for Marketplace listings |
| WhatsApp status / channel | No API | Draft + copy | — |
| TikTok | Yes, later | TikTok Content Posting API (own TikTok developer app, its own audit) | A second app + audit; videos only |
| YouTube Shorts | Yes, later | YouTube Data API (own Google Cloud project) | Quota is small (about 6 uploads a day); fine for Shorts |
| Paid Facebook/Instagram ads | **Yes** | Meta Marketing API (campaign → ad set → ad on a post we made) | App Review: ads_management; an ad account in the Costareen portfolio with a payment method; business verification (in review now). The old portfolio's ad accounts are restricted since 2019 - make a fresh one in the new portfolio |

"One click to every platform" therefore means Facebook + Instagram first, TikTok and YouTube Shorts as a second stage,
Marketplace and WhatsApp as copy-and-paste with a ready caption.

Reading other people's pages and reels for inspiration: Meta gives no API for other pages' content. Options: (a) the
owner pastes a reel/post link; the server fetches the public video (yt-dlp) for analysis only - never re-posted - and
Gemini writes a "style card" (hook in the first 2 s, shot list, pace, caption pattern, music type, on-screen text);
(b) Apify "Instagram/Facebook scraper" actors to watch whole pages (paid, ~$5-30 a month, works against Meta's terms
for the scraped side - use sparingly, for public business pages only). I recommend (a) to start.

## 2. The pieces to build (stages, each shippable alone)

### S1. Publish from the ERP (Facebook + Instagram)
- Advertisement tab: a draft becomes a **Post**: media (product photo, uploaded photo/video, or a made one), caption per
  platform (Facebook: longer, price, link; Instagram: shorter, hashtags, no link; Marketplace/WhatsApp: copy boxes),
  schedule time, **Publish now / Schedule**, **Needs approval** switch (staff draft, owner approves).
- Server: erpPost* on the Meta login's page token: `/{page}/photos`, `/{page}/videos` (reels), `/{ig}/media` +
  `media_publish`; a scheduled queue run by the minute timer; results stored (post id, link).
- Results: reach, reactions, comments, shares, saves, video views per post, read nightly (page insights) and shown on
  the post; a weekly "what worked" list.
- Migration: `posts` (business, product, media, captions jsonb, state draft/approved/scheduled/published/failed,
  platform ids, stats jsonb), `post_media`.

### S2. Content factory (photo and video made for you)
- **Photo cards**: product photo + price + name + offer on brand templates (SVG → PNG on the server, like the invoice
  pictures): clean product shot, "only N left", before/after, bundle. Zero AI cost.
- **AI photos**: product cut-out placed in a scene (desk, printer, workshop) with an image model (Gemini image
  generation / Imagen, or Flux through fal.ai, about ৳3-5 a picture). Only from our own product photos - never invented
  products.
- **Template reels** (the workhorse): short vertical videos made by code from photos, text and music: product spin
  from 4 photos, price reveal, "3 reasons", timelapse + caption, customer print showcase. Built with **Remotion**
  (video from React code) or ffmpeg on the office VPS, 10-20 s, 1080x1920, with Bangla/English text and a licensed
  music bed (Meta's own sound library when posting a reel keeps it safe). Cost: nothing per video.
- **AI video** (Veo 3 / Kling / Runway through fal.ai) only for hero clips: ৳10-50 per second - use for 3-5 s inserts,
  not whole reels. Voice-over in Bangla: Gemini TTS or ElevenLabs.
- **Real footage**: the system asks staff for a 10 s phone clip of a print when a plan needs one (a task in the Inbox
  Notifications), then cuts, captions and sizes it.

### S3. Inspiration and the rules
- **Inspiration box**: paste reel/post links or page names → style cards (hook, structure, shot list, caption style).
  The week plan then says "make Tuesday's reel in the style of card 3".
- **Rules** (owner-written, the system obeys): price in every post; one product per post; no fake scarcity (only real
  stock counts, with a real end date); Bangla first with English product names; hashtags set per platform; posting
  windows (e.g. 12:30 and 20:30 Dhaka); max posts a day; never post a product with no stock; claims only from the
  product's own details; what never to post (competitor names, politics...). Stored like the Inbox's agent rules.
- **Hook library**: 50 proven hook patterns for product reels (from the playbook + what worked for us); the writer
  picks and rotates, never repeating a hook within 30 days.
- **Learning loop**: nightly insights → each post's score vs the page's 30-day median → the writer is told which hooks,
  formats, products and times won; the week plan leans to them. A weekly report in the Day-review style.

### S4. Paid campaigns
- Pick a published post → **Boost**: objective (messages / website sales / reach), audience (Bangladesh, interests
  "3D printing", lookalike of our customers from the ERP's phone list uploaded as a Custom Audience - with consent
  wording), daily budget, days. The ERP creates campaign → ad set → ad through the Marketing API, PAUSED, and shows
  the preview and the total; **the owner presses Start** - the system never spends without him. Hard caps: a daily and
  monthly spend ceiling in Settings; every spend written to Expenses (Advertising) from the ad account's insights.
- Results: spend, reach, messages started, website purchases (the Pixel is on the site), cost per message / per order,
  compared with the chat orders and web orders that followed. Auto-pause rules: cost per message above X, or budget
  cap reached.
- Needs: a new ad account inside the Costareen portfolio, a card or bKash-funded prepaid balance on it, business
  verification approved, ads_management + ads_read in App Review.

### S5. TikTok and YouTube Shorts (later)
Same posts, two more targets. TikTok needs its own developer app and audit; YouTube its own Google project. Or run them
through **Postiz** (open-source scheduler, self-hosted on the office VPS) if we prefer not to code them.

## 3. Skills, repos, APIs and keys to arrange

| Need | Choice | Cost | Who gets it |
|---|---|---|---|
| Posting + insights + ads | Meta Graph + Marketing API, the existing app 2156436555228139 | free | Add the permissions to the SAME App Review as messaging (one submission): pages_manage_posts, pages_read_engagement, instagram_content_publish, instagram_manage_insights, ads_management, ads_read, business_management |
| Instagram | Link the Instagram account to the Costareen 3D page (Business account) | free | Owner, in Instagram settings |
| Text, captions, style cards, scoring | Gemini (already) | ~free | — |
| Pictures | Gemini image generation or fal.ai (Flux) | ৳3-5 each | Owner: fal.ai account + key if we go beyond Gemini |
| Video assembly | Remotion + ffmpeg on the office VPS (62.171.167.199) | free | Me |
| AI video (hero clips only) | fal.ai (Kling / Veo) | ৳10-50 per second | Owner: fal.ai balance |
| Bangla voice | Gemini TTS first; ElevenLabs if quality is not enough | ~free / $5 a month | — |
| Reel/post link analysis | yt-dlp + Gemini (video understanding) | free | Me |
| Page watching (optional) | Apify Instagram/Facebook actors | $5-30 a month | Owner, only if wanted |
| Music | Meta's sound library at posting time; or a licensed pack (Epidemic/Artlist) for TikTok/YouTube | $0 / ~$15 a month | later |
| Ads payment | New ad account in the Costareen portfolio + card | the ad spend itself | Owner |
| TikTok / YouTube | TikTok for Developers app; Google Cloud project with YouTube Data API | free | Owner creates, I wire (S5) |

Rough running cost at 1 post a day with a template reel and one AI photo: under ৳200 a month, plus ad spend.

## 4. Order and what I need from the owner

1. **Now (owner):** link Instagram to the Costareen 3D page; when business verification is approved, submit ONE App
   Review covering messaging AND posting/insights/ads (I add the texts and the screencast scenes for the extra
   permissions to docs/meta/APP-REVIEW.md); create an ad account in the Costareen portfolio when ready to spend.
2. **S1** (build now, test on the old account's pages in dev; live once the permissions are approved).
3. **S2** photo cards + template reels (the VPS renders; the ERP shows previews).
4. **S3** inspiration box + rules + learning loop.
5. **S4** paid campaigns, behind the spend caps and the owner's Start button.
6. **S5** TikTok / YouTube.

Owner-only ("Only me" app flag) like every new feature; staff get it when he opens it.
