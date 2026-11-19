# Content desk build checklist (owner go 19 Nov 2026: "build it all in one go, no input needed")

Read with docs/CONTENT-DESK-PLAN.md (the decisions). Tick here as each step is DONE AND CHECKED. If the context is
lost, resume from the first unticked line.

Owner rules for this build:
- Build the stages one after another without waiting: C0 → check → C1 → check → C2 …
- Personal Brand desk: zero loss. Never touch its bridge, DB, runbooks or studio.
- Voice: the owner's own ElevenLabs clone is used for ALL businesses (owner 19 Nov: "all businesses are mine").
- AI: businesses use ChatGPT (one shared account for now); personal uses Claude.
- Nothing is published automatically. Videos wait in the ERP; page handlers download them or get them by WhatsApp.
- ERP screens: impeccable, blueprint first, then build. Owner-only "Only me" flag. Build on dev first.

## Checklist
- [x] S0 Self-critique after every video → LESSONS.md, applied to the next one (RUNBOOK-HYBRID step 9, 19 Nov)
- [x] S1 Engine DR kit: spec + one-command restore + daily backup to F:\engine-backups (19 Nov)
- [x] R1 Research: Costareen 60-day plan (BD 3D-printer/filament buyer psychology, promotional from day 1)
- [x] C0a Personal desk baseline recorded (drafts/day, lint passes, video build time, growth levels)
- [x] C0b Business bridge fork: own code copy, own container per brand, own DB, profile folder, loops limited
- [x] C0c Personal baseline re-checked: unchanged
- [x] C1a Oliareen profile (education-only guard, readers, series from the 60-day playbook)
- [x] C1b Oliareen 60-day calendar loaded as series/ideas; drafts generate
- [x] C2a Costareen profile (promotional, real stock, website photos, fact lock)
- [x] C2b Costareen 60-day plan (from R1) loaded
- [x] C2c ERP events: product created / PO created ("coming") / shipment received ("arrived") → bridge drafts + dedicated videos
- [x] C3a Business video studio: ChatGPT writes props JSON → house template renders; owner clone voice; brand look per profile
- [x] C3b Brand lock + fact lock + tests (no cross-brand words, clips, rules)
- [x] C3c Queue: personal first (render + Flow); daily credit share
- [x] C3d Side-by-side test: ChatGPT-directed vs Claude-directed video
- [x] E1 ERP blueprint (impeccable shape) for the business Content desk screen
- [x] E2 ERP build: desk opens per business; download + send-to-handler WhatsApp; Only me
- [x] C4 Old Advertisement Content writer hidden for businesses with a Content desk (Paid ads + figures stay)
- [x] T1 Tests green, dev deploy, screen checked desktop + phone
- [ ] T2 CHANGES.md, memory, commit, tag; report to owner; live release on his word

## Log
- 19 Nov: R1 research notes in bendar-brand/research_notes/Costareen 60 day plan; plans in bizdesk/profiles/<brand>/PLAN.md + series_s1.json (60 each).
- 19 Nov: fork = bizdesk/make_fork.py -> bridge_biz.py (5 anchored patches); profiles/_common.py (brand lock, fact lock, guard); Mac /opt/brand/bizdesk (compose, setup.sh), DBs bizdesk_<brand> from personal schema, Caddy /__biz-<brand>/, dev ERP check-in OK (Oliareen demo 1182..., Demo 3D Shop b529...). Personal bridge md5 unchanged, not restarted; baseline before/after equal (31.6 drafts/day).
- 19 Nov: first test drafts both brands OK on ChatGPT (Costareen price 1550 from catalogue; Oliareen SPF education, no selling).
- 19 Nov: studio: make_biz_template.py -> templates/biz-house (voice from bizdesk, no AI chip, theme); bizvideo.py (ChatGPT props + checks + render + self-critique). E1 blueprint .impeccable/shape/content-desk.md.
- TODO personal (owner rule, not a personal-engine change in quality): bendar-house template still shows the AI chip by default - must drop before the template is default again on 3 Dec.
- 19 Nov: first business videos rendered: bizdesk/studio/out/costareen/bz-costareen-d2.mp4 (31.7 s), out/oliareen/bz-oliareen-d2.mp4 (34.8 s); sent to owner. Fixes found by running: fact lock read layout numbers (now only shown text), brief duration must be a number, scene ids, product photo bars (now blurred fill), empty bubbles, big rotations (clamped 8 deg).
- 19 Nov C3d side-by-side (draft 2, Costareen): Claude-directed clearly better (filled values, Bangla, bigger). Kept ChatGPT per owner rule; the Claude props became examples/costareen.json, the few-shot quality bar in the ChatGPT prompt. Sheet: out/costareen/side-by-side-d2.jpg.
- 19 Nov C3c: Windows task "Business video studio" hourly :45 (run_all.cmd), personal lock first, max 2/day/brand (ElevenLabs chars shared). No Flow/Veo in business videos yet (no credit clash).
- 19 Nov C3b: bizdesk/tests_locks.py 17/17 pass (brand lock both ways, fact lock, layout numbers, Oliareen selling + drug claims, foreign clips, empty items).
- 19 Nov: ERP server content-desk-1 (+1b studio upload) and page content-desk-ui-1/1b/1c merged to main by devsync and deployed to DEV; both test videos uploaded into their dev businesses; screen checked on dev (video plays, handlers save, 375 px ok); personal baseline unchanged after everything (bridge md5 same, not restarted, 31.6 drafts/day). Event videos skip the daily cap.
- LEFT: T2 live release on owner word; owner inputs (page handler numbers, Oliareen WhatsApp + own ChatGPT later).
