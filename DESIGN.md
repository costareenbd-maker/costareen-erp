---
name: Costareen ERP
description: The Clean look - a tidy shop counter for daily trading work, light and dark
colors:
  canvas: "#EDEEF1"
  card: "#FFFFFF"
  surface-2: "#F3F4F6"
  surface-3: "#E7E8EC"
  border: "#E6E7EB"
  border-strong: "#D7D9DF"
  ink: "#17181C"
  ink-2: "#4A4D57"
  ink-3: "#7A7E8A"
  ink-faint: "#9A9EA8"
  counter-lime: "#E4FF5A"
  accent-violet: "#6D5BFF"
  accent-violet-text: "#5748E6"
  positive: "#22C55E"
  positive-text: "#15803D"
  negative: "#EF4444"
  negative-text: "#DC2626"
  warning: "#F59E0B"
  warning-text: "#9A5B00"
  tile-peach: "#FFF1E3"
  tile-lavender: "#EFEAFF"
  tile-mint: "#E3F8F6"
  tile-lemon: "#F8FADB"
  tile-sky: "#E8F1FF"
  dark-canvas: "#121316"
  dark-card: "#1B1D22"
  dark-surface-2: "#23262C"
  dark-ink: "#F2F3F5"
  placeholder: "#686C77"
  dark-placeholder: "#9A9EA8"
  tile-positive-text: "#14703A"
  tile-negative-text: "#B91C1C"
typography:
  page-title:
    fontFamily: "Inter, Noto Sans Bengali, Segoe UI, Nirmala UI, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  greeting:
    fontFamily: "Inter, Noto Sans Bengali, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    letterSpacing: "-0.02em"
  card-title:
    fontFamily: "Inter, Noto Sans Bengali, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    letterSpacing: "-0.01em"
  figure:
    fontFamily: "Inter, Noto Sans Bengali, system-ui, sans-serif"
    fontSize: "clamp(22px, 1.1vw + 14px, 32px)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
    fontFeature: "tnum"
  body:
    fontFamily: "Inter, Noto Sans Bengali, Segoe UI, Nirmala UI, system-ui, sans-serif"
    fontSize: "14.5px"
    lineHeight: 1.5
  label:
    fontFamily: "Inter, Noto Sans Bengali, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
  bangla-body:
    fontFamily: "Hind Siliguri, Noto Sans Bengali, Nirmala UI, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.55
  bangla-label:
    fontFamily: "Hind Siliguri, Noto Sans Bengali, Nirmala UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  code:
    fontFamily: "ui-monospace, JetBrains Mono, Cascadia Mono, Menlo, Consolas, monospace"
    fontSize: "12.5px"
rounded:
  input: "12px"
  button-small: "10px"
  table: "16px"
  card: "20px"
  pill: "999px"
spacing:
  gap-tight: "6px"
  table-cell: "12px 14px"
  card-pad: "22px 24px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.card}"
    rounded: "{rounded.input}"
    height: "38px"
    padding: "0 16px"
  button-secondary:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    height: "38px"
    padding: "0 16px"
  button-small:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button-small}"
    height: "32px"
    padding: "0 12px"
  nav-item:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink-2}"
    rounded: "14px"
    height: "46px"
  nav-item-active:
    backgroundColor: "{colors.counter-lime}"
    textColor: "{colors.ink}"
    rounded: "14px"
    height: "46px"
  chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
  chip-on:
    backgroundColor: "{colors.counter-lime}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.card}"
    padding: "{spacing.card-pad}"
  input:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    height: "40px"
    padding: "8px 12px"
---

# Design System: Costareen ERP

## Overview

**Creative North Star: "The Tidy Counter"**

The ERP is a shop counter kept in order: everything the staff need is within reach, nothing shouts, and the one thing
that must be seen is lit in lime. A pale grey canvas holds white, borderless, generously rounded cards; the side menu is
a column of soft pills; figures sit large and calm in pastel tiles. The feel is soft and sure: round corners, big touch
targets, a dark primary button that says "this is the action". It is built for a phone in one hand at the counter as
much as for a long desk session, in Bangla first.

The look is a layer over the FilaDash design system (`html[data-look="clean"]`); every function stays as it was. The
older "Current" look is kept behind Theme › Look until the owner says to remove it. Printed documents (invoices,
quotations) keep their own look and are out of scope here.

Because the ERP will be sold to other businesses, nothing in the system is Costareen-coloured: the business's own name
and logo lead in the top bar and menu; the palette below is the product's, not one shop's.

**Key Characteristics:**
- Pale grey canvas, white borderless cards, 20px corners.
- Lime marks "you are here / this is on" and nothing else - and only ONE lime row per screen (crit2-ui, 10 Nov 2026):
  the screen's primary selection. Every other segment / chip row shows its selected item in the neutral selected style
  (Deep Shelf grey, Ink text, bold, a hairline ring).
- Dark (Ink) primary button in light mode; near-white primary button with Ink text in dark mode.
- Pastel KPI tiles that cycle peach, lavender, mint, lemon, sky.
- Flat tables with a muted head and hairline rows.
- Pills everywhere a choice is made (tabs, chips, segments, the business switch).

## Colors

A quiet near-neutral grey system with one loud signal colour (lime) and soft pastel tiles for figures.

### Primary
- **Counter Lime** (counter-lime): the selected state - active menu pill, selected tab, chip and segment, a switch that
  is on. Always carries Ink text, never white. Not a button fill in either theme (since crit-look, 10 Nov 2026).
- **Counter Ink** (ink): text, and the light-mode primary button fill. The strongest mark on a light screen.

### Secondary
- **Quiet Violet** (accent-violet-text): links only. Since polish-1 (30 Oct 2026) the shared FilaDash accent is Ink in
  light mode and Lime in dark mode, so no widget fills a selected state or a button with violet any more.

### Tertiary
- **Pastel Tiles** (tile-peach, tile-lavender, tile-mint, tile-lemon, tile-sky): KPI tile backgrounds, cycled in that
  order; dark mode uses deep tinted equivalents. Never for text or buttons.

### Neutral
- **Canvas Grey** (canvas): page background and the side menu's ground.
- **Card White** (card): every card, dialog, table panel, nav pill at rest, the top-bar tool pill.
- **Shelf Grey** (surface-2) and **Deep Shelf** (surface-3): input fills, secondary buttons, table hover, hover states.
- **Hairline** (border) and **Firm Hairline** (border-strong): table rows, dividers, scrollbars.
- **Ink 2 / Ink 3 / Faint** (ink-2, ink-3, ink-faint): secondary text, sub-lines and table heads, placeholders.
- **Status**: positive / positive-text (money in, a change for the better), negative / negative-text (dues, refusals,
  danger, a change for the worse), warning / warning-text (attention). A trend is coloured by meaning, not direction: an
  expense falling is green. On pastel tiles the trend text darkens to tile-positive-text / tile-negative-text (4.5:1).
- **Placeholders**: placeholder (light) / dark-placeholder (dark), at least 4.5:1 on Shelf Grey.

### Named Rules
**The One Lime Rule.** Lime means "selected" or "on". It is never decoration, never a background for a whole section,
and its text is always Ink.
**The Accent Is Ink Rule.** The shared accent (`--fd-accent`) is Ink (light) / near-white #ECEDF0 with Ink text (dark);
a new widget that needs a filled "main" state uses it, and a selected state uses Lime directly. Icon squares, avatars and
count badges stay neutral in both themes.
**The Dark-Text-on-Light-Fill Rule.** Any fill lighter than mid-grey (lime, pastel, soft status) carries Ink text. In
dark mode the accent fill is lime, so white text on it is a bug (fixed 29 Oct 2026, clean-contrast-1).

## Typography

**Body Font:** Inter (latin, variable) with Noto Sans Bengali for Bangla, then Segoe UI / Nirmala UI / system-ui.
**Bangla Font:** Hind Siliguri (Google Fonts, 400/500/600/700, loaded when the page turns Bangla), then Noto Sans Bengali,
Nirmala UI, system-ui. Under `html[lang=bn]` it is the face of body, buttons and fields.
**Code Font:** ui-monospace, JetBrains Mono, Cascadia Mono, Menlo, Consolas, monospace - only for codes, serials, keys,
links and checks' ids (12-12.5px), never as decoration.

**Character:** One family, weight does the work: heavy titles and figures, semibold labels and buttons, regular body.
Numbers use tabular figures so columns of money line up.

### Hierarchy
- **Page title** (800, 28px, 1.2, -0.02em): the screen name ("Dashboard", "Stock entry").
- **Greeting** (600, 22px, -0.02em): "Welcome, Rahman" in the Clean top bar; 17px on phones.
- **Card title** (700, 18px, -0.01em): every card heading.
- **Figure** (700, 22-32px fluid, 1.1, -0.025em, tabular): KPI values and money totals.
- **Body** (400, 14.5px, 1.5): everything else.
- **Label** (600, 12.5px): form labels, table heads, small notes.
- **Bangla body / label** (Hind Siliguri, 14px; line height 1.55 for text, 1.4 for labels, buttons and pills): Bangla
  never goes under 14px; tiny badges and chips 12.5px.
- **Code** (monospace, 12.5px): invoice codes in tables, serials, access keys.

### Named Rules
**The Bangla Size Rule.** Bangla text never goes below the body size for anything a person must read; Bangla glyphs need
the room. Shrink by trimming words, not by shrinking type.

## Layout

Desktop: a side menu of pills (folds to an icon rail between 761 and 1279px), a transparent top bar (greeting left;
business pill, "+ New", one white tool pill with chat, search, light/dark and bell, then the avatar on the right), and
a card grid below. Cards sit 16-20px apart; inside a card the padding is 22px by 24px. Tables span their card and keep
12px by 14px cells.

Phone (760px and below): bottom tab bar (Invoice, Sales, Customers, Inbox, More) plus a folding menu; the top bar shows
the business pill, "+", the tool pill and the avatar, tightened to 12px side padding; greeting and the light/dark button
hide there (light/dark stays in the account menu). Nothing scrolls sideways at 375px.

The menu, top bar and title paint from the device's last copy on reload; nothing may appear and then vanish.

## Elevation & Depth

Flat by default, separated by tone: white cards on a grey canvas need almost no shadow (`0 1px 2px` at 3% ink). Lift is
reserved for things that float: popovers and menus get a soft, wide shadow; the hero tile on the dashboard gets a deeper
one. Dialogs dim the page with a light blur behind them.

### Named Rules
**The Tone-Not-Shadow Rule.** Depth comes from canvas grey against card white. A card never gets a border and never gets
a heavy shadow at rest.

## Shapes

Soft and consistent: cards and KPI tiles 20px, tables 16px inside their card, nav pills 14px, buttons and inputs 12px
(small buttons 10px), every choice control (tab, chip, segment, badge, search, business switch, tool buttons) a full
pill. No square corners on interactive things.

## Components

### Buttons
- **Shape:** gently rounded (12px; small 10px), 38px tall (small 32px), no border.
- **Primary:** Ink fill with white text in light mode; near-white fill with Ink text in dark mode. One per area.
- **Secondary:** Shelf Grey fill, Ink text; hover to Deep Shelf.
- **Danger:** soft red fill with red text; solid red only for the final, irreversible step.
- **Focus:** a 3px ring (ink at 18% light, lime at 30% dark). Disabled at 45% opacity.
- **Top bar:** sticky, on a solid canvas ground; once the page scrolls it gets a hairline and a soft shadow.

### Chips, tabs and segments
- **Style:** pills on Shelf Grey (chips) or Card White (tabs), semibold Ink-2 text.
- **State:** selected = Lime with Ink text for the screen's ONE primary selection row; any second row (view switch,
  sub-filter, per-row segment) = neutral selected: Deep Shelf (surface-3), Ink text, 700, 1px Firm Hairline ring.
  Never violet for a new selected state. A filter row longer than ~6 chips shows the common four + "More filters".

### Cards / Containers
- **Corner Style:** 20px.
- **Background:** Card White (dark: dark-card).
- **Shadow Strategy:** the faint card shadow only; see Elevation.
- **Border:** none.
- **Internal Padding:** 22px by 24px.

### KPI tiles
- Pastel tile (cycled), 20px corners, no border or shadow; a 48px white icon square; the figure in Figure type; trend as
  plain green or red text with no pill behind it.

### Inputs / Fields
- **Style:** filled Shelf Grey, transparent 1px border, 12px corners, 40px tall.
- **Focus:** border turns Ink, fill turns white, plus the focus ring.
- **Labels:** 12.5px semibold Ink-2 above the field. No grey hint text beside a label; help goes behind a "?" button.

### Navigation
- **Side menu:** white pills (46px tall, 14px corners) on the grey canvas, group labels in caps-free 12.5px semibold; hover to
  Shelf Grey; the current screen is a Lime pill with bold Ink text and an inverted count badge.
- **Phone:** bottom tab bar; the business pill shows the name, shrinking with an ellipsis.

### Tables
- Flat: transparent head in 12.5px Ink-3, hairline rows, hover row in Shelf Grey, group and total rows in Shelf Grey bold.

## Do's and Don'ts

### Do:
- **Do** use Lime only for the selected / on state, always with Ink (#17181C) text.
- **Do** keep cards white, borderless, 20px round, on the grey canvas.
- **Do** put a new ability on the first screen as a visible button with a verb-first label.
- **Do** keep Bangla at body size or larger and check every screen at 375px with no sideways scroll.
- **Do** check light and dark: any light fill carries Ink text.

- **Do** give every phone tap target 40px (small "?" / "i" buttons keep their look and grow their tap area).
- **Do** theme browser surfaces: selection is Lime with Ink text, checkboxes and radios take the accent.

### Don't:
- **Don't** put white text on lime, pastel or soft status fills.
- **Don't** add borders or heavy shadows to cards at rest.
- **Don't** use violet for a new selected state; the selected state is lime.
- **Don't** put grey hint text beside form labels; use a "?" help button.
- **Don't** hard-code Costareen's name, logo or colours into a screen; the business's own branding leads.
- **Don't** let anything appear and then vanish on reload.
