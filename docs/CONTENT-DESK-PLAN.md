# Content desk for Costareen and Oliareen: plan (19 Nov 2026, waiting for the owner's yes)

The owner asked for the Brand desk's output quality for the two businesses. The Brand desk already produces upload-ready
posts and videos; the ERP's Advertisement > Content card has not met his expectations. This plan builds on three maps:
the Brand desk pipeline (bridge.py), the ERP's Advertisement code and event sources, and a GitHub/evidence review
(`G:\bendar-brand\research_notes\Content desk\github_and_evidence.md`).

## Owner's hard rules (19 Nov 2026, these override everything below)

1. **AI per brand.**
   - Personal brand: Claude, as today.
   - Oliareen and Costareen: ChatGPT. For now both businesses run on the one shared ChatGPT account, and they move to
     separate accounts later.
2. **No mixing and no hallucination.** A business post may only say what comes from that business's own data. See
   "Guards" below.
3. **ZERO loss for the personal setup.** If the personal Brand desk or its studio loses even 0.001% in output quality
   or in speed of improvement, the owner drops this system and builds a separate engine.

   Therefore the personal bridge, its database, its runbooks and its studio are **frozen: not touched, not refactored,
   not shared**. The business engine is a **fork**:
   - a copy of the bridge code in its own container, with its own database and its own studio folder;
   - improvements flow ONE WAY, from the personal engine into the fork, by a deliberate merge;
   - nothing ever flows back into the personal engine unless the owner says so;
   - the fork never uses the personal Claude limit, the personal Postiz, the personal Immich album or the personal
     voice;
   - Flow credits and machine time: **personal first**. Business video jobs run only when the personal queue is empty,
     inside a fixed daily credit share.

## Publishing until the businesses have Postiz (owner 19 Nov 2026)

- Nothing is published automatically. Finished drafts and videos are kept in the ERP, inside the business's Content
  desk, for download.
- The people who run each page either download them, or get them on WhatsApp from **that business's own** WhatsApp
  (Costareen = its own Evolution number; never the owner's personal gateway). They post by hand.
- Postiz per business comes later, as a separate stage.

## Size and cost of the fork (measured 19 Nov 2026)

- Bridge code: 15 MB, using the same python:3.12-alpine image; no new install.
- Database: a separate database on the same Postgres server. The personal one is 89 MB.
- Video studio: the same OpenMontage install (venv, Remotion, ffmpeg) with a separate projects folder and profile per
  business. Each video leaves about 200 MB of work files.
- Mac: 58 GB free on /, 40 GB free on /data (89% used), 15 GB RAM available. That is enough.
- PC G: has 53 GB free (93% used). This is the tight spot. Business video work files are cleaned after send and only
  final.mp4 is kept; deletion needs a backup or the owner's yes.
- ERP file storage (Supabase) has a quota: store compressed finals (10-20 MB each) and move old ones to the Mac.
  Check the quota at C0.

## Guards against mixing and hallucination (businesses on one shared ChatGPT account)

- **Every AI call is stateless.** It carries brand id + only that brand's profile and data. There is no chat memory and
  no reused thread, and one business's text never goes into another's prompt.
- **Fact lock.** Product names, prices, stock counts, dates and specs in a draft must match the ERP or website data
  for that business (numbers and Latin words are checked, like shots-1 `factCheck`). If they do not match, the draft is
  rewritten, and on a second failure it is held, never posted.
- **Brand lock.** Each brand has a word list: its own product and brand names, and the other business's names. A draft
  or video that mentions the other business, or that uses a clip, voice, colour or rule from another profile, is
  refused. Tests prove this for every pair.
- **Oliareen education guard.** No price, product, packaging or buy-CTA. This reuses the playbook's five layers.
- **Separate storage.** Each instance has its own database schema, Postiz workspace, Immich album, B-roll tags and
  lessons files.

## Decision: one engine design, run as a separate fork for the businesses (personal untouched)

The Brand desk engine is generic: idea bank → series/routine slots → writer + editor → media/cards → approve → pacer →
Postiz → metrics → growth levels → critiques → lessons. Its vocabulary is hard-coded for the personal brand:
- the series codes and seeds;
- the topic keys;
- the creator-first regexes (`PLAN_SALES`, `PLAN_BANNED`);
- the reader personas;
- the voice files;
- the Seoul/Dhaka times;
- the Claude key.

Its database has no business column, and the ERP already speaks to "one bridge per ERP business"
(`brand_bridge` config, branddesk.js).

So:
- **Same code, three instances.** Each bridge container runs with its own profile folder and its own database schema:
  `personal` (today), `oliareen` and `costareen`.
- **The ERP Brand desk screen opens for any business that has a bridge.** It follows the "Only me" rule: the owner
  sees it first.
- **One video studio.** The OpenMontage job carries `brand` and loads that brand's profile. Each brand has its own:
  - voice and look/template;
  - music and B-roll tags;
  - corrections and lessons files.

  A shared craft-lessons file (for example Bangla number reading or caption timing) feeds all three. A brand lock refuses
  another brand's clip, voice or rule, and is tested.
- **The ERP's Advertisement card stays for Paid ads and figures.** Its writers (3D-only prompts, "price in every post")
  are retired for these two businesses once the desk runs.

Rejected:
- Porting the whole engine into Supabase: a big rewrite, and it loses what already works.
- Two separate builds: twice the fixes, and the businesses would not share improvements.

## Profiles

| | Oliareen | Costareen |
|---|---|---|
| Rule | Education only. 60-day playbook: zero commercial clues, no product/packaging/price/"buy" | Promotes itself: "order from us", stock updates, shipment updates; price allowed; real stock only |
| Series | Ingredient School, Routine Building, Dhaka Skin Reality, Sun Protection, Mistakes, Myth vs Reality, Know Your Skin, Interactive, Dermatologist (real doctor only) | New in, Stock today, Coming soon, Arrived, How to use / set up, Fix it (print problems), Compare |
| Source of facts | Playbook briefs + cited research | ERP product data + website text (`product_ai`) + events |
| Pictures | Veo lifestyle/motion, hands/textures; never packaging | Real product photos from the website (Bambu Lab, Elegoo, Polymaker), AI scenes around the real product, Veo B-roll |
| CTA | save / share / comment / next episode | order, inbox, WhatsApp (only stock > 0) |
| AI | Oliareen's own ChatGPT account (today it shares Costareen's: must change) | Costareen's own ChatGPT account |
| Voice | Its own ElevenLabs voice (owner picks) | Its own ElevenLabs voice (owner picks) |

## Costareen event posts (new)

Today no ERP event is emitted for products or shipments. They will be wrapped like crm-1's `wrapCrm`:
`addProduct` / `erpSaveProduct`, `erpPoCreate`, and `receiveShipment`. The wrapping happens at the function level so
that the excel and joint paths are caught too. Each event creates a draft through the bridge:
- **product created** → "new in" draft (merged with other new products within 24 h into one post);
- **shipment ordered** → "coming soon" draft on order date + N days, and only when the arrival date is known;
- **shipment received** → "arrived" draft. Evidence says this is strongest as a message to people who asked: a
  WhatsApp waitlist is a later stage.

Every event post is tagged with its type and compared with the 14-day median on the same network, so the engine learns
what works.

## Stages

- **C0 (changed after the owner's zero-loss rule): fork, do not refactor the personal bridge.** Make a copy of the
  bridge as the business engine with its own container, database and studio folder, and de-hardcode ONLY the copy.
  First record a "before" baseline of the personal desk (drafts per day, lint passes, video build time, growth levels)
  and check it again after every stage. If personal gets any worse, roll back. Move the following into
  `profiles/<brand>/` of the fork:
  - the seeds and series codes;
  - the topic keys;
  - the policy regexes;
  - the readers;
  - the voice files;
  - the times and the AI secret.

  Then prove that `personal` output is unchanged with a test.
- **C1: Oliareen instance.** Profile from the 60-day playbook. Then:
  - its own Postiz workspace and accounts (the owner connects them);
  - its own Immich album;
  - its own ChatGPT key (the owner gives it);
  - the ERP desk opens for Oliareen (Only me).
- **C2: Costareen instance and ERP events.** Sell profile, event drafts, real stock guard, website photos.
  Owner additions (19 Nov 2026):
  - Costareen gets a video EVERY day from its own 60-day plan.
  - Shipment "coming" and "arrived" events get their OWN dedicated videos, on top of the daily one.
  - **Costareen 60-day plan:** researched first (customer psychology, what makes a BD buyer of printers and filament
    buy), built like the Oliareen playbook, and promotional FROM DAY 1.
  - Oliareen stays education-only until the owner says so.
  - Costareen is the test bed for promotion. What works there is later considered for Oliareen and other businesses,
    the same way the Brand desk proved the engine.
- **C3: studio brand profiles.** The brand lock and the per-brand lessons files. Then the side-by-side test on one
  video: Claude-directed against ChatGPT-directed. The result decides which AI runs the business studio, and the owner
  makes the final call.
- **C4: retire the old content writers** for these two businesses. Paid ads and figures stay.

Every page change uses impeccable and follows the Brand Cockpit "Line Map" direction contract. The work is built on dev
first, then live on the owner's word.

## Needs the owner's hand

- An Oliareen ChatGPT account (or key) of its own.
- One ElevenLabs voice for each business.
- Connecting each business's pages in its Postiz workspace.
- Choosing N, the number of days after the order date when "coming soon" goes out.
