# Assessment B - detector + technical audit (23 Nov 2026)

Target: `web/app.html` (65,764 lines, 6.25 MB). Scope of the code audit: the four blocks written today -
`flow-1` (65471-65556), `unity-1` (65557-65684), `whole-1` (65685-65716), `whole-2` (65718-65761) - plus the plan
code they style (`pnMapHtml` 63097, `pnRow` 63087, `pfNow` 63086, `pnAfter` 63144).

Method: source reading + the bundled detector + computed contrast (WCAG formula; the dark look modelled with the CSS
`invert(1) hue-rotate(180deg)` matrices). **Nothing here was rendered in a browser** - items marked "verify on screen"
are source-certain about the rule but not about how it looks. No project file was edited. Assessment A's files were
not read.

## Audit Health Score

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 2 | Folded desk menu = icon buttons with no accessible name; schedule chips are mouse/touch only (a keyboard path exists); 10.5-11.5px Bangla |
| 2 | Performance | 3 | No observer loop. Dark look = one full-page filter layer + a second filter on every photo/video; Plan draws twice on open |
| 3 | Theming | 2 | Dark is done by inverting the sheet: saturated photo colours do not come back, lime "you are here" turns dark green, sheets/popups stay white; ~95 hard-coded hex in the 4 blocks |
| 4 | Responsive | 2 | New phone rules set 36px / 26px (project rule: 44px); `#view details>summary{display:flex}` removes the fold arrow on ERP screens; `.linkbtn` nowrap can widen tables |
| 5 | Implementation Integrity | 2 | `@font-face` alias re-points "Noto Sans Bengali" for the whole page to remote files; a now-useless Google Fonts request; dead selectors; desk rail width hard-coded and off by 32px on laptops |
| **Total** | | **11/20** | **Acceptable (significant work needed)** |

## Implementation Integrity Verdict

**Pass, with reservations.** The four blocks are coherent and product-specific (one shell, one lime "you are here",
state = shape on the schedule, reduced motion respected, focus kept across redraws). The reservations are the two
shortcuts in `whole-1`: theming by `filter:invert` and unifying the Bangla face by aliasing font names. Both work on
the happy path and both have side effects outside what was tested (photo colours, the ERP's own Bangla text, offline).

## Executive Summary

- Audit Health Score **11/20** (Acceptable).
- Issues: **P0 0 - P1 3 - P2 9 - P3 5**.
- Top issues:
  1. Dark look: photos / videos / logos are not restored exactly (pure red comes back #AB3E3E, yellow #E8BD86) - on a
     filament shop's media pages colour is the content.
  2. `#view details>summary{display:flex}` (phone) strips the disclosure arrow from every plain `<details>` on ERP
     screens (History, Timeline, "How to fix" ...).
  3. Folded desk menu: buttons lose their text, there is no `aria-label`; `title` is only added on mouse hover.
  4. The font alias silently changes the Bangla face of ERP text that named "Noto Sans Bengali" (English-UI mode,
     help cards, drawers) from the bundled, offline-safe file to a remote gstatic file.
  5. New tap-height fixes stop at 36px / 26px while PRODUCT.md says 44px.
- Next steps: `/impeccable harden` (P1s), `/impeccable colorize` (dark look), `/impeccable adapt` (tap targets),
  `/impeccable distill` (dead CSS, font alias), `/impeccable polish`.

---

## 1. Detector

Command: `impeccable detect --json web/app.html` from the project root. Ran in 0.9 s, **exit 2**, no crash on the
6 MB file (no tail-only fallback needed). `.impeccable/config.json` ignoreValues were respected (not edited).

**346 findings.** The detector reports each distinct value once (first place seen), so counts = distinct values.

| Rule | Severity | Count | Where |
|------|----------|-------|-------|
| design-system-color | advisory | 299 | whole file; 60 in the desk (58068+); **1 in today's blocks** (#FDE7E3, line 65506) |
| design-system-font-size | advisory | 19 | 82-471 (13), 5165, 9213, 11048, 12480, 19823, 23677 |
| design-system-radius | advisory | 16 | 87-333 (9), 11043, 12697, 19065, 20996, 34740, 35832, 59411 |
| design-system-font | warning | 5 | 491, 9628, 58080, 59186, 60450 |
| pulsing-dot | warning | 2 | `.aw-typing i` (34344), `.ct-dots i` (59381) |
| marquee | warning | 2 | `.ph-prog i` (58195), `.cd-prog i` (64392) |
| side-tab | warning | 1 | `.cash_card[aria-pressed="true"]` (13272) |
| dark-glow | warning | 1 | "#5b4fe9 glow on dark page" (no line given) |
| repeating-stripes-gradient | advisory | 1 | first at 58355 |

(The five non-design-system rules come back with `line: 0`; line numbers above were found by grep.)

### Verified in context

**True**

- `design-system-font` 59186 + 60450 "Anek Bangla" - true, and now worse: since `whole-1` the name "Anek Bangla" is an
  alias for Hind Siliguri files, yet line 60450 still asks Google Fonts for `Noto+Sans+Bengali` + `Anek+Bangla`. See P2-6.
- `design-system-color` (desk, 60 values) - true as drift. Evidence: four near-identical alert tints (#FDECEA 59200,
  #FFE3DF, #FDF1EF, #FFF6F4) and today a fifth (#FDE7E3 x3); five wait tints (#FFF6DB, #FCEBBF, #FFF8E6, #FFF4D6 and
  today #FFE7A3 x3). See P2-9.
- `design-system-radius` 59411 (22px) - true, isolated. Today's blocks add 18px and 24px (not flagged: counted once elsewhere).
- `pulsing-dot` `.aw-typing i` (34344) - true in one respect: it is a real "thinking" indicator (fine), but it has no
  reduced-motion rule (the fd rule at 23530 only removes transitions). P3.
- `repeating-stripes` `.ph-media` (58568) - true, decorative placeholder stripes. Advisory only.
- `design-system-font-size` / `-radius` at lines 82-471 - true but old base/print CSS, outside today's work.

**False positive**

- `design-system-font` 491 Georgia - the "minimal" printed invoice template; printed documents keep their own look (PRODUCT.md).
- `design-system-font` 9628 `Monospace">' ` - parser artefact from an inline `style="...font-family:monospace">`; monospace on an API-key field is correct.
- `design-system-font` 58080 "Pretendard Variable" - the `@font-face` itself; documented in DESIGN.md line 352 and accepted in config as "pretendard" (the ignore value does not match the quoted name).
- `design-system-radius` 19065 `6px"><button class="btn` and 20996 `4mm` - parser artefact / print unit.
- `pulsing-dot` `.ct-dots i` (59381) - typing indicator, has a reduced-motion rule at 59385.
- `marquee` `.ph-prog i`, `.cd-prog i` - indeterminate progress bars, each with a reduced-motion alternative (`animation:none;width:100%`).
- `side-tab` `.cash_card[aria-pressed]` 13272 - classic-skin rule, overridden for every skin by 53639 (`box-shadow:0 0 0 2px ... !important`), so the stripe never paints.
- `repeating-stripes` 58355 / 58367 / 58419 / 59065 - hatch = "queued / future / none" in charts; it encodes state without colour. Functional.
- `dark-glow` #5b4fe9 - could not be tied to a line; #5B4FE9 is the old FilaDash indigo accent (23273) whose glow token is replaced in the Clean look (accent = ink). Not in today's blocks. Treat as legacy.
- `design-system-color` network brand colours (#1877F2, #0A66C2, #C13584, #0095F6 ...) and phone-preview greys (#65676B, #050505) - they imitate the networks on purpose.

---

## 2. Findings by severity

### P1 - major

**[P1-1] Dark look: photos, videos and logos do not come back to their real colours**
- Location: `whole-1` 65700-65701 (`filter:invert(1) hue-rotate(180deg)` on `.bc-main,.bc-side`, the same filter again on `img,video,canvas,picture,iframe,.bc-lb svg`).
- Category: Theming.
- Impact: `hue-rotate` clips, so the pair is not its own inverse for saturated colours. Computed round trip:
  #FF0000 -> #AB3E3E, #0000FF -> #1F1F44, #00FF00 -> #2FC02F, #FFD400 -> #E8BD86, #E62117 (YouTube) -> #B7443A,
  #E4FF5A -> #D1ECC9; skin tones, greys, mid colours survive. Media, post previews and network logos look washed or
  brown in dark. Also inside the inverted sheet: lime "you are here" (#E4FF5A) becomes #082300 dark green with light
  text, while the menu beside it (not inverted) stays lime - DESIGN.md says lime is the dark-mode selected colour;
  shadows become light halos; the sheet itself lands on #0C0C0A, darker than the ERP ground #121316 (1.05:1) and
  unlike every ERP dark card (#1B1D22), so "a sheet like every ERP card" is not true in dark.
- Recommendation: the lasting fix is real dark tokens - the desk already reads everything through 10 tokens on `.bc`
  and `.cs` (58085, 59460): add
  `:root[data-theme="dark"] .bc,:root[data-theme="dark"] .cs{--bc-ink:#F2F3F5;--bc-ink-2:#B8BCC6;--bc-ink-3:#9A9EA8;--bc-rule:#2A2D34;--bc-ground:#1B1D22;--bc-shelf:#23262C;--bc-alert:#F87171;--bc-alert-ink:#FCA5A5;--bc-wait:#FBBF24;--bc-good:#4ADE80;color-scheme:dark}`
  and replace the literal `#fff / #17181C / #F2F3F5 / #F7F8F9 / #FAFAFB / #E4E6EA / #FFE7A3 / #FDE7E3` in flow-1 /
  whole-2 with tokens (P2-9). If the filter must stay for now, two stop-gaps: (a) set the sheet background to
  `#E0E2E7` (inverts to exactly #1B1D22) instead of `#F3F3F1`; (b) add the lime "you are here" elements
  (`.bc-pills button.on,.pn-dh.on,.hm-days button.on`) to the turn-back list so they stay lime with ink text.
  Neither fixes photo colours - the filter pair cannot restore saturated pixels.
- Suggested command: `/impeccable colorize`

**[P1-2] Phone: every plain `<details>` on ERP screens loses its arrow**
- Location: `whole-2` 65740 `@media (max-width:759px){ #view details>summary{min-height:36px;display:flex;align-items:center} }`.
- Category: Responsive / Implementation Integrity.
- Impact: the browser draws the disclosure triangle only while `summary` is `display:list-item`. The rule has
  specificity (1,0,2), so it wins over nearly everything. Plain summaries it hits (no custom arrow): "History"
  (36167, 36271), "Timeline" (36315), "Returns and cancellations..." (36229), "Orders the shield flagged" (36232),
  Watchdog (40202), "Channels we listen to" (41692), "How to fix" (28848), `.nai-more` (45107). On a phone they now
  read as plain text - nothing says they open. Side effect: `.qz-row summary` (415, a 28px `display:grid;
  place-items:center` button) becomes flex and its glyph is no longer centred horizontally. (58 `<summary>` in the
  ERP part; those with their own `::after` arrow are fine.)
- Recommendation: keep the tap height, keep the marker:
  `#view details>summary{min-height:44px;padding-block:10px;box-sizing:border-box}` (no `display`), or if flex is
  wanted add an arrow: `#view details>summary:not([class*="nt-"]):not(.dai-brow>*)::before{content:"\25B8";margin-right:8px}`
  `#view details[open]>summary::before{content:"\25BE"}` and exclude `.qz-row summary`.
- Suggested command: `/impeccable harden`

**[P1-3] Folded desk menu: icon buttons have no name**
- Location: `unity-1` 65611 `body.side-mini .bc-rail button>span:not(.bc-vh){display:none}`; markup `railHtml` 61487
  (`<button data-bc="sec">` + `<svg aria-hidden>` + `<span>label</span>`, no `aria-label`); title only via the
  `mouseover` listener at 65665.
- Category: Accessibility. WCAG 4.1.2 Name, Role, Value (A), 2.4.6.
- Impact: with the menu folded, a screen reader says "button" 16 times (or just the badge number); a keyboard user
  gets no tooltip because `title` is set on mouse hover only.
- Recommendation: hide visually, not from the tree - replace `display:none` for the label with the existing
  `.bc-vh` recipe: `body.side-mini .bc-rail button>span:not(.bc-vh){position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}`;
  and set `title` in `railHtml` (`title="' + s[1] + '"`) instead of on hover, then delete the `mouseover` listener.
- Suggested command: `/impeccable harden`

### P2 - minor

**[P2-1] Schedule chips are mouse/touch only, and carry a dead `aria-label`**
- Location: 63127 `<i aria-hidden="true" class="pf-chip ..." data-bc="pnpost" aria-label="..." title="...">`; CSS 65494.
- Category: Accessibility (WCAG 2.1.1 is met through the other path; 4.1.2 hygiene).
- Finding: chips are `<i>` with no `tabindex`, so they are not keyboard reachable and `:focus-visible` never applies
  to them (no focus style exists or is needed today). **A keyboard path to the same action exists**: day heads are
  real buttons with a roving tabindex and arrow keys (63101, 63159) and an `aria-label` that gives the day's counts;
  choosing a day lists its slots, and each slot with a draft has a real `<button data-bc="pnpost">পোস্ট দেখুন`
  (63090). For a slot without a draft the chip only selects its day + highlights the row, which the day head also
  does. So this is not a blocker. But `aria-hidden="true"` makes the long `aria-label` dead text, and the chip's time
  is the only place the slot time is visible in the map - a screen reader gets it from the rows instead (fine).
- Recommendation: either make them real - `<button type="button" class="pf-chip" tabindex="-1" ...>` without
  `aria-hidden` and add `.pf-chip:focus-visible{outline:2px solid var(--bc-ink);outline-offset:2px}` (the CSS already
  starts with `all:unset`, so a button drops in) - or keep them decorative and delete the `aria-label` attribute.
  Same for `.pn-adm[data-bc="pnadday"]` (63107): clickable `<i>`, 14px, no keyboard path except the folded box in the day.
- Suggested command: `/impeccable harden`

**[P2-2] New tap heights stop short of the project's 44px rule**
- Location: `whole-1` 65704-65705 (36px), `whole-2` 65738-65742 (36px, `td a` = text + 16px, 26px for `.fig-i/.nvg-i/.dcon-q`); `flow-1` chips 24px high with 4px gaps (65494), legend chips 18px (not interactive), `details.pf-adbox>summary` about 43px.
- Category: Responsive. PRODUCT.md "touch targets ... at least 44 px"; WCAG 2.5.8 (24px) is met.
- Impact: better than the <30px that was measured, still under the product's own bar; the 26px "?" dots are the weakest.
- Recommendation: use 44 where the layout allows: `.pn-link,details.pn-adr>summary,#view .cd-score,#view .cd-more{min-height:44px}`;
  for the small round "?" buttons keep the 18-26px look but enlarge the hit area:
  `#view .fig-i,#view .nvg-i,#view .dcon-q{position:relative}` + `::after{content:"";position:absolute;inset:-10px}`.
  Chips: on a phone give `.pf-chip{height:32px}` and `PFH` rows 36 instead of 28 (63133), or accept them as a shortcut since the rows below are the real targets.
- Suggested command: `/impeccable adapt`

**[P2-3] `.linkbtn` may no longer wrap on a phone**
- Location: `whole-2` 65741 `#view .linkbtn{white-space:nowrap;min-width:max-content}`.
- Category: Responsive. Verify on screen at 375px.
- Impact: `.linkbtn` is also used for long text - product names in stock tables (1443), customer names (10833). Those
  can no longer break, so the name column takes its full width and the table (or the page) scrolls sideways - against
  "no sideways scroll at 375 px".
- Recommendation: limit it to short codes: `#view td.num .linkbtn,#view th .linkbtn,#view .linkbtn.invpdf,#view .linkbtn[data-openinv]{white-space:nowrap}` and drop `min-width:max-content`.
- Suggested command: `/impeccable adapt`

**[P2-4] `#view td a` rule is global**
- Location: `whole-2` 65741 `#view a.nt-qinv,#view .ib-c a,#view td a{display:inline-block;padding-block:8px}`.
- Category: Implementation Integrity / Responsive.
- Impact: every link in every table cell on every ERP screen gets +16px height on a phone (specificity 1,0,2 beats
  class rules), so dense tables grow taller and any link styled as a flex/inline-flex control in a cell is forced to
  inline-block. Verify on screen: Sales, Stock, Money tables.
- Recommendation: target the measured offenders by class, or use a hit-area pseudo-element instead of padding.
- Suggested command: `/impeccable adapt`

**[P2-5] Font alias changes the ERP's own Bangla face and makes it depend on the network**
- Location: `whole-1` 65693-65698 (six `@font-face` for "Noto Sans Bengali" and "Anek Bangla" pointing at Hind Siliguri files on fonts.gstatic.com, v14).
- Category: Implementation Integrity.
- What else uses these names: "Anek Bangla" - 12 desk rules only (58285-60103): safe. "Noto Sans Bengali" - 246
  lines, 11 of them in the ERP: the bundled faces at 23263/23265 (`fonts/NotoSansBengali-*.ttf`, weight 100-599 and
  600-900, `size-adjust:92%`), the English-UI font token `--fd-font` (23287), `--ap-sans` (37009), help cards
  `.hg-card ol` (25071), drawers `.fd22-drw [lang=bn]` (28280); the Bangla-UI stacks (17971, 54693) put Hind Siliguri first anyway.
- Impact: a later `@font-face` with a matching weight wins, so for weights 400/500/600/700-900 the bundled Noto file is
  now dead for the WHOLE page and Hind Siliguri is used instead - including Bangla names and messages shown while the
  ERP is in English, where Noto at 92% was chosen on purpose. Weights the alias does not declare (300, 450, 650) still
  fall to bundled Noto, so two faces can mix. `size-adjust:92%` is gone for the aliased weights (Hind is smaller, so
  probably harmless - verify). If gstatic is blocked or the device is offline, Bangla now falls to the system font,
  not the bundled file. The four URLs answer 200 today (checked), CSP allows gstatic (`_headers` line 8); the version
  in the path is pinned by hand. Printed invoices open as their own documents, so they are not touched.
- Recommendation: do what the comment says without aliasing: delete the six rules and change the desk stacks -
  one search-and-replace in lines 58068-65560 of `"Anek Bangla","Noto Sans Bengali"` and leading
  `"Noto Sans Bengali"` to `"Hind Siliguri","Noto Sans Bengali"`, or better one token
  `.bc,.cs{--bc-bn:"Hind Siliguri","Noto Sans Bengali",system-ui,sans-serif}`. If the alias stays, scope it by name:
  rename to a private family (`"BC Bangla"`) used only in desk rules, so the ERP's "Noto Sans Bengali" keeps its bundled file.
- Suggested command: `/impeccable distill`

**[P2-6] A Google Fonts request that can no longer do anything**
- Location: 60447-60451 `fonts()` loads `css2?family=Noto+Sans+Bengali:wght@400;500;600;700&family=Anek+Bangla:wght@600;700` (called at 60369 and 63467).
- Category: Performance / Implementation Integrity.
- Impact: the alias in `whole-1` comes later in the document and overrides every Bengali face that stylesheet
  declares, so it is a render-path request for nothing (its Latin subset still styles Latin letters in
  "Noto Sans Bengali"-first rules, e.g. "AI", "LinkedIn" inside chips - an accident, not a decision).
- Recommendation: delete `fonts()` and its two calls (or make it load Hind Siliguri, which line 18034 already does for the Bangla UI).
- Suggested command: `/impeccable optimize`

**[P2-7] Desk menu width is hard-coded and differs from the ERP's on laptops**
- Location: `unity-1` 65581 `body{--u1-w:228px}body.side-mini{--u1-w:76px}`.
- Category: Implementation Integrity (verify on screen at 1100px).
- Impact: the ERP side menu is `--side-w`: 228px (25147), **196px between 761 and 1279px** (43956), 72px folded
  (34470). So on a shop laptop the menu jumps 32px wider when going to the desk, and 4px when folded - the "one
  shell, same width" promise breaks exactly where the owner works.
- Recommendation: `body{--u1-w:var(--side-w,228px)}` and delete the `side-mini` override.
- Suggested command: `/impeccable polish`

**[P2-8] Dark look covers only the page sheet**
- Location: `whole-1` 65700; not covered: post sheet `.cs` (59460), phone "more" sheet `.bc-sheet` (58533), score layer `.sc-layer` (65172), tooltip `.bc-tip` (58431).
- Category: Theming.
- Impact: in dark the desk page is dark but every sheet opened from it is white (they sit outside `.bc-main`) - a
  full-screen white flash on a phone at night. In the old "Classic" look with dark theme the rail uses `--fd-*`
  fallbacks that are light-theme values: group labels #5F6370 on #0B0E14 = 3.2:1 (fails 4.5), white pills on a dark page.
- Recommendation: solved by the token route in P1-1 (`.cs` already shares the token names). For Classic: give the
  rail fallbacks the classic tokens, e.g. `color:var(--fd-text-2,var(--ink-2,#5F6370))`, `background:var(--fd-card,var(--surface,#fff))`.
- Suggested command: `/impeccable colorize`

**[P2-9] Hard-coded colours where tokens exist**
- Location: flow-1 + unity-1 + whole-1 + whole-2: about 95 literal hex values; #17181C x26 (token exists: `--bc-ink`
  #16181D, `--fd-text`), #FFF x18 (`--bc-ground`), #F2F3F5 (`--bc-shelf`), #E4E6EA (`--bc-rule`), #5C626E
  (`--bc-ink-3`), #E0301E/#A8260F (used correctly through tokens in most places, literal in two), new literals
  #FFE7A3, #FDE7E3, #9AA0AB, #E7E9ED, #FAFAFB, #F7F8F9.
- Category: Theming.
- Impact: two inks one unit apart (#16181D vs #17181C) inside one component; a 5th alert tint and a 5th wait tint;
  nothing in these blocks can follow a theme without the filter.
- Recommendation: add `--bc-wait-soft:#FFE7A3; --bc-alert-soft:#FDE7E3; --bc-rule-2:#9AA0AB; --bc-hover:#F7F8F9` to
  the `.bc,.cs` token line and replace literals; use `var(--bc-ink)` for every #17181C inside `.bc`.
- Suggested command: `/impeccable colorize`

### P3 - polish

- **[P3-1] Chip outlines are under 3:1.** `color-mix(var(--c) 60%, #fff)` on white: Telegram 1.91, Bluesky 2.14,
  Facebook 2.31, Instagram 2.61, Threads 2.65, LinkedIn 2.66, YouTube 2.72 (only TikTok 4.94 and X 3.38 pass); dashed
  "AI makes" outline and "tick" ring #9AA0AB = 2.63. Text and the solid dot carry the meaning, so this is not a
  failure of 1.4.11, but "outlined = goes" is the state signal. Fix: mix 80% (`color-mix(in srgb,var(--c) 80%,#fff)`) and #7A808B for the grey rings.
- **[P3-2] Plan redraw on width change is safe but wider than needed** (`C._pfRe`, 63147). It cannot spin: the guard
  allows one pending redraw, the redraw writes the new `--pn-col` into the markup, the next `pnAfter` finds
  `col === C.pnCol` and stops. Two notes: (a) any 1px change of `floor(width/7)` triggers a full `draw()` although
  the markup only depends on `pfPer`/`pfWide`; (b) theoretical ping-pong at exactly col 131/132 (pfPer 2 -> 1 doubles
  the chip rows; if that adds/removes the page scrollbar on Windows the width flips back) - needs a page barely
  taller than the window, unlikely on Plan. Fix both: redraw only when the bucket changes -
  `var bk = (col >= 132 ? 'w' : 'n') + Math.max(1, Math.floor((col - 8) / (col >= 132 ? 88 : 50))); if (bk !== C._pfBk) { C._pfBk = bk; ...draw... }`.
  Also: on first open `C.pnCol` is empty, so Plan always renders twice (64px default, then real) - seed `C.pnCol`
  from `root().clientWidth` before the first `pnMapHtml`.
- **[P3-3] unity-1 observers: no loop.** Body-class `MutationObserver` -> `sync` -> `measure` toggles `u1-wide` /
  adds `u1-out`, which re-fires the observer once; the second pass changes nothing (`classList.toggle(x, same)` does
  not write). `ResizeObserver(measure)` on `#bc_root` only writes a body class and `--u1-top`; neither changes the
  root's width. The `#clGreet` observer rewrites once and then matches `G_BN`. Costs: `sync` runs on every body class
  change anywhere in the ERP and reads `clientWidth`/`offsetHeight` (forced layout) even when the desk is closed -
  add `if (!live && !wasLive) return;` at the top of `sync`. The `ResizeObserver` is never disconnected (one element, harmless).
- **[P3-4] Dead / leftover CSS.** `svg[data-logo]` and `.u1-keep` (65701) and `.um-i small` (65707) match nothing in
  the file; `.pn-map.pf .pn-mline{display:none}` hides an element `pnMapHtml` still emits (63135 - stop emitting it);
  `.pn-dh.on` is styled three times (59948, 65486-65487); `.hm-col.today` (65730) now also beats the phone rule
  `.hm-col.cur{background:transparent;box-shadow:none}` (59279), so on a phone today's column gets the lime band and
  an 18px radius it was told not to have - verify on screen; `.um-t,.mw-i small{font-size:11.5px}` (65707) is
  unscoped but those class names exist only in the desk, so no leak today.
- **[P3-5] Small Bangla.** `.pn-dh em` 10.5px, chips 11.5px, rail sub-label 11.5px, folded badge 10.5px. Contrast is
  fine (6.1:1) but PRODUCT.md asks for large Bangla; 12px is the floor used elsewhere in the desk.

---

## 3. What was checked and is fine

- **Contrast (computed, light; dark = inverted values in brackets).** Chip text #16181D on #fff 17.8 (17.0); chip
  am/pm part, `.tick/.soon`, `.pf-st.gone` #5C626E: on white 6.13, on today band #FAFFDE 5.95, on selected column
  5.72, on both 5.56, on #FAFAFB 5.87, on row hover #F7F8F9 5.76 (7.2-7.8); `.gone` on the 9% network tints 5.07
  (TikTok) to 5.59 (6.8-7.3); `.wt` #17181C on #FFE7A3 14.5 (13.6); `.need` #454A55 on white 8.9; `.x` #A8260F on
  #FDE7E3 6.0 (9.6); `.pf-st` default #454A55 on #F2F3F5 8.0; `.pf-st.q` white on #17181C 17.7; day head chosen
  #17181C on lime 15.8 (13.5); rail label #5F6370 on #EDEEF1 5.2, rail dark #B8BCC6 on #1B1D22 8.9. **All text
  pairs in today's blocks pass AA in light and in the inverted dark.** The one failing pair is older:
  `.pn-dh.past` #8A909B on white 3.21 (59945).
- **Reduced motion.** `u1In` runs only under `prefers-reduced-motion:no-preference`; chip hover transition is removed
  by `.bc *{transition:none!important}` (58156); `pnadday` scroll honours the setting (63894). Opacity-only fade, no
  transform on the root (the comment explains why) - correct.
- **`details/summary`.** `pf-adbox` summary is a real `summary` with `:focus-visible`, custom "দেখুন/লুকান" text in
  place of the hidden marker, Enter/Space reach the delegated click (`pfad`, 63893) and focus survives the redraw
  (`fsel` in `draw`, 63420). Nested `details.pn-adr` keeps its native arrow in the desk (the `display:flex` at 65705
  removes it on the phone - same pattern as P1-2, small).
- **Filter side effects.** No `position:fixed` element lives inside `.bc-main`/`.bc-side` (rail, scrim, sheets,
  tooltip, score layer are outside), so the filter's new containing block breaks nothing; sticky children are
  unaffected. Cost that remains: the whole sheet becomes one filtered layer as tall as the page, and each of the up
  to 7 `<video>` / 21 `<img>` templates gets a second filter pass (video frames lose the hardware overlay path) -
  dark mode on a mid-range phone will scroll heavier on Media. No `<picture>`, canvas, iframe or CSS background
  photos in the desk, so nothing is double- or un-turned.
- **Container queries.** `@container bc` is declared once (58084) and all four blocks cut at the same 760px line the
  script uses (`narrowNow`, `u1-wide`). `.pn-link` / `details.pn-adr>summary` in whole-1 sit inside `@container bc`,
  so they cannot reach ERP screens.
- **Toast wrapper** (65630): only mutes non-error toasts while `html.bd-landing` is set; that class is removed by
  `uncover()` and by a 15 s timer (line 19), so it cannot stick.
- **Focus.** `.bc :focus-visible` 2px ink ring (58088) applies to everything new that is focusable; skip link kept (65571).

## 4. Bangla lint

`python tools/bangla_lint.py`: **3 errors, 1473 warnings in 230 files.**

Errors (none in app.html, none in text added today - both files last changed 22 Nov):
- `supabase/functions/erp/handlers/branddesk.js:822` and `:827` - banned "ছাঁকনি" -> ফিল্টার ("এই ছাঁকনিটা চেনা নেই...").
- `supabase/functions/erp/handlers/contentdesk.js:195` - banned "পণ্য" -> প্রোডাক্ট ("আরও N টি পণ্য").

app.html: 60 warnings, 3 of them in today's blocks, all in the `whole-1` dictionary (line 65711): "kWh" (a unit),
"Webhook" (n8n's own word), "auto" (a quoted setting value) - acceptable; add them to ALLOW. unity-1, flow-1 and
whole-2 text: no warnings.

Not caught by the lint: whole-2 writes "এখনো" ('এই স্ক্রিনের গাইড এখনো নেই।') while whole-1 writes "এখনও" five
times; file-wide it is এখনো 149 lines vs এখনও 13 - pick one (one word per idea).

## 5. Patterns

- Global selectors under `#view` used to fix measured cases (`details>summary`, `td a`, `.linkbtn`) - each fixes the
  measured screens and changes many unmeasured ones. Prefer the class that was measured.
- Colour by literal inside a tokenised component; theme by filter instead of by token.
- Fixes by aliasing/overriding later in the file (font names, `.pn-dh.on` x3, `.hm-col.today` x2) rather than
  changing the first rule - the file grows and the earlier rule stays as dead weight.

## 6. Positive findings

- State = shape on the chips (outline / tint+tick / amber / dashed / red / ring), so colour is never the only signal.
- Redraw keeps keyboard focus for id-less buttons (`fsel`), and morphdom keeps scroll - the new `pfad` toggle benefits.
- Motion is opacity-only, short (240ms), and off under reduced motion.
- Observers are guarded (`_pfRe`, `!RO`, `G_BN` compare); none loops.
- I18N additions never overwrite an existing key (`=== undefined` check).

## Recommended actions

1. **[P1] `/impeccable harden`** - restore summary arrows on phone (65740); name the folded menu buttons (65611, 61487); chips: real buttons or drop the dead aria-label.
2. **[P1] `/impeccable colorize`** - replace the invert filter with dark values for the ten `--bc-*` tokens on `.bc,.cs`; tokenise the literals in the four blocks.
3. **[P2] `/impeccable adapt`** - 44px targets; narrow `#view .linkbtn` and `#view td a`.
4. **[P2] `/impeccable distill`** - remove the font alias and `fonts()`; one Bangla font token; delete dead selectors; `--u1-w:var(--side-w)`.
5. **[P3] `/impeccable optimize`** - bucketed Plan redraw, early return in `sync`.
6. `/impeccable polish` - last.
