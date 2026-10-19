# Advertising automation: the review against the best open-source tools (20 Oct 2026)

Owner: "pick the best ones, compare with your logic, copy their logic and code where you can, then polish". Done for
S1 (publishing) and S2 (content factory). What was looked at, what was taken, what was left out and why.

## The tools compared

| Tool | What it is | Taken into the ERP |
|---|---|---|
| **MoneyPrinterTurbo** (harry0703, MIT, ~120k stars) - the standard "topic in, short video out" pipeline | script → stock footage → TTS → subtitles → music → ffmpeg | the pipeline shape (slides / clips → voice → word-timed captions → music under the voice → one ffmpeg pass), its encode settings (30 fps, yuv420p, BT.709 colour tagging, AAC 48 kHz), its caption rules (3-5 words a cue, big, outlined, bottom third), Ken Burns on stills, music fade-out, the "voice decides the length" rule |
| **ShortGPT** (RayVentura) | the same idea, edge-tts voices + captions | the choice of **edge-tts** (Microsoft's neural voices, free, Bangla included: bn-BD-NabanitaNeural / PradeepNeural) with word boundaries → karaoke-style captions |
| **Postiz** (gitroomhq, AGPL, the biggest open-source scheduler) | publishing to 30+ networks through the official APIs | its Facebook and Instagram providers line by line: Reels through `video_reels` start → upload by link (`file_url` header, OAuth) → poll `video_status` → finish `PUBLISHED`; Page **stories** (`photo_stories`, `video_stories`); Instagram **stories** (`media_type=STORIES`) and `share_to_feed` on reels; the 30 s / 8-minute processing wait; its Meta error-code table (2207003, 2207020, 2207010, 2207082, 2207026, 2207050, 36003, 9007); its insight metrics (`post_impressions_unique`, `post_clicks`, `fb_reels_total_plays`, `total_video_views`, Instagram `views, reach, saved, likes, comments, shares`) |
| **Mixpost** (Laravel) | the polished alternative; Instagram/TikTok/YouTube only in the paid Pro edition | nothing - its publishing code is paid |
| Meta's own docs (Reels Publishing guide, Instagram Content Publishing) | the source of truth | checked Postiz's flows against them; the Reels video spec (9:16, 1080x1920, 24-60 fps fixed, closed GOP 2-5 s, AAC 48 kHz stereo 128k+) is now what the render server produces |
| **Product-photography-AI**, product-photo-generator-cog, Keou Studio | rembg + Stable Diffusion / ComfyUI product scenes | not taken: they need a GPU; the office server has none. Gemini's image model does the same job for about ৳5 a picture; the model list is read from the key (erpSocialAiModels) so renames do not break it |
| Viral-hook skills (vyralcontent viral-hooks, josiahsiegel hook templates) | hook archetypes for the first 2 seconds | the ten archetypes (question, negative, number, curiosity gap, POV, result-first, price, comparison, cliffhanger, objection) are in the script writer, rotated per product and kept with each video for the learning loop |

## What the ERP does that none of them do

- The facts come from the books: price, stock ("only 24 left" is the real count), the product's own photo; a card with an
  untrue stock count is refused.
- One click from a made picture or reel to a post with a caption per platform, and the post goes out through the one
  Meta login the Inbox already has - no second system, no second app review.
- Staff draft, the owner approves; every action is in the activity log; costs are in the AI cost book.
- Bangla first: the voices, the captions (Noto Sans Bengali through libass), the templates.

## What was left out, on purpose

- **A second scheduler (Postiz/Mixpost self-hosted)**: it would still need our own Meta app review and would split the
  data. Kept for TikTok/YouTube later, where Postiz's providers save real work (S5).
- **Stock footage (Pexels/Pixabay)**: MoneyPrinterTurbo's b-roll. Needs a free Pexels key from the owner; the render
  server already accepts a clip by link, so this is a small S3 addition.
- **Background music packs**: MoneyPrinterTurbo ships songs of unclear licence. The ERP takes the owner's own MP3 only.
- **GPU image pipelines**: no GPU.

## How it is wired

```
ERP (Supabase edge function)                     office server (czrender, /opt/czrender)
  socialmake.js: facts, templates, script  ──►   /render/png   headless Chromium: cards, slides (Bangla fonts)
                 voice text + slides HTML  ──►   /render/video edge-tts voice → word timings → ASS captions
                                                               ffmpeg: Ken Burns, crossfades, captions, music, Reels spec
                                                               PUT result into Supabase storage (signed upload URL)
  social.js: Facebook / Instagram / stories / reels through the page token; the minute timer finishes what Meta is
             still processing and reads the figures
```

## Next adoptions (in order)

1. S3: Pexels b-roll for hooks (owner's free key), the inspiration box (yt-dlp + Gemini video understanding → style
   cards), the rules, the nightly learning loop over the figures already read.
2. S4: paid campaigns through the Marketing API (campaign → ad set → ad on a published post, PAUSED until the owner
   presses Start; spend caps; spend into Expenses).
3. S5: TikTok and YouTube Shorts - through Postiz's providers (self-hosted) or straight, once the owner has the
   developer apps.
