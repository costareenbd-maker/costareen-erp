# FilaDash theme system (research output)

Files in this folder:

- `fd_themes.js`: the deliverable. ES5. `FD_THEME_TOKENS` (45 tokens), `FD_THEMES` (15 themes × light + dark, every token set), and helpers `fdThemeApply(key, mode, accentHex?)`, `fdThemeClear()`, `fdAccentTokens(hex, mode, baseTokens)` for the accent override.
- `build.js`: the generator and contrast checker. Theme specs are short (11 neutrals, accent, gradient end, 4 status colours, 8 chart colours). It derives the rest and writes `fd_themes.js` and `contrast.md`. Run it with `node build.js`. There are no dependencies.
- `header.js.txt`, `footer.js.txt`: the credit block and the helpers that go into the output.
- `contrast.md`: the full contrast table. It is copied below.

## Sources surveyed

| System | Licence | Light | Dark | Used? |
|---|---|---|---|---|
| Tailwind CSS colour palette | MIT | yes | yes | Yes. Accents for Emerald, Ocean, Rose, Violet, Sunset, Slate |
| shadcn/ui themes (Zinc, Slate, Rose, Violet...) | MIT | yes | yes | Yes. Token structure and Slate mono |
| Radix Colors | MIT | yes | yes (12-step scales, P3) | No. Best scales for a future "custom accent" picker |
| daisyUI themes (35) | MIT | some | some | No. Many are novelty themes; few suit a ledger |
| Catppuccin (Latte/Frappé/Macchiato/Mocha) | MIT | Latte | 3 flavours | Yes |
| Nord | MIT | Snow Storm only (no official light) | yes | Yes |
| Dracula + Alucard | MIT | Alucard (official) | yes | Yes |
| Tokyo Night (Night/Storm/Light) | MIT | yes | yes | Yes |
| Rosé Pine (main/Moon/Dawn) | MIT | Dawn | yes | Yes |
| Solarized | MIT | yes | yes | Yes |
| Flexoki | MIT | yes | yes | Yes |
| Gruvbox (morhetz) | MIT/X11 | yes | yes | Yes |
| Open Props | MIT | yes | yes | No. These are colour scales, not themes |
| Material 3 dynamic colour (material-color-utilities) | Apache-2.0 | yes | yes | No. A candidate for "theme from logo/photo" later |
| GitHub Primer primitives | MIT | yes | yes (+ colour-blind and high-contrast) | No. Its colour-blind and high-contrast modes are a good model if those are wanted |
| One Dark (Atom) | MIT | One Light | yes | No. Too close to Tokyo Night |

Every source used is MIT, so it can be reused and changed as long as the copyright and licence notice is kept. The credit block at the top of `fd_themes.js` does that. To be fully correct, also list them on the app's About or Licences screen. Only colour values are used, not code or assets.

## The 15 themes

| key | Name | Light | Dark | Notes |
|---|---|---|---|---|
| filadash | FilaDash | indigo #5B4FE9 on #F6F7FB | amber #F5A623 on #0F1621 | Partner's look. Copied 1:1 from `web/app.html`; only charts, logo and tooltip were added |
| emerald | Emerald | #047857 | #34D399 | Tailwind emerald-700 / 400 |
| ocean | Ocean | #2563EB | #38BDF8 | Tailwind blue-600 / sky-400 |
| rose | Rose | #E11D48 | #FB7185 | Losses use deeper red #B91C1C so they don't look like the accent |
| violet | Violet | #7C3AED | #A78BFA | |
| sunset | Sunset | #C2410C | #FB923C | Orange to pink gradient |
| slate | Slate (mono) | #18181B | #FAFAFA | shadcn Zinc. Colour only for profit, loss and charts |
| catppuccin | Catppuccin | Latte mauve | Mocha mauve | Pastel |
| nord | Nord | Frost #5E81AC (nudged to #5778A0) | Frost #88C0D0 | Calm and low-saturation |
| dracula | Dracula | Alucard purple #644AC9 | purple #BD93F9 | |
| tokyonight | Tokyo Night | #2959AA | #7AA2F7 | |
| rosepine | Rosé Pine | Dawn iris (nudged) | iris #C4A7E7 | No green in the source, so profit uses Foam/Pine (teal) |
| solarized | Solarized | blue (nudged darker) | blue (nudged lighter) | Classic warm-paper light |
| flexoki | Flexoki | blue-600 #205EA6 | blue-400 #4385BE | Ink-on-paper, good for long tables |
| gruvbox | Gruvbox | orange #AF3A03 | orange #FE8019 | Warm retro |

Suggested picker order: FilaDash, Ocean, Emerald, Violet, Rose, Sunset, Slate, then a "Community themes" group with Catppuccin, Nord, Tokyo Night, Dracula, Rosé Pine, Solarized, Flexoki and Gruvbox. Show each as a card with a mini preview: page, card, accent button, and a green and red figure.

## How the derived tokens are made (same rules as `fdAccentTokens`)

- In light mode the accent gets white text, and the accent is darkened until white text on it is at least 4.5:1 and the accent on page and card is at least 3:1. In dark mode the label is a deep tint of the accent, and the accent is lightened until the same limits are met.
- `accent-hover`: light mode mixes 12% black in; dark mode mixes 14% white in.
- `accent-soft` / `-soft-2`: light mode mixes 10% / 16% accent into the card colour (solid hex); dark mode uses rgba .14 / .22. These match the FilaDash originals.
- `accent-border`: rgba .35 (light) or .45 (dark).
- `accent-glow`, `hero-shadow`, `nav-active-bg`: use the same formulas as FilaDash, with the accent swapped in.
- `accent-text`, `positive-text`, `negative-text`, `warning-text`, `info-text`: the base colour, nudged until it reaches 4.5:1 on the card, the page and its own soft badge.
- `text-2`, `text-3`: at least 4.5:1 on card, page and surface-2 (table head). `text-faint`: at least 3:1, for placeholders and hints only.
- `tooltip-bg`: always dark, because `.fdrev-tip` uses `color:#fff`. White on it is checked to be at least 4.5:1.
- `chart-1..8`: at least 3:1 on the card (WCAG 1.4.11 for graphics). FilaDash's own chart colours were kept as they are.

## Extra options worth offering (Appearance panel)

1. **Theme**: the 15 above. Light/dark stays a separate switch, and also allow "Auto (follow device)".
2. **Accent override**: a colour input with 10 to 12 preset dots (Tailwind 600s). Use `fdThemeApply(theme, mode, '#hex')`. It works out hover, text, soft, border, glow, gradient and nav colours and enforces contrast. It was tested on 300 combinations (15 themes × 2 modes × 10 hostile colours, including pure yellow, white, black and grey) with 0 failures.
3. **Chart colours**: keep Theme / Amber / Indigo / Mixed, but make **"Theme" use the theme's own `--fd-chart-1..8`**. Today `fdPalApply()` overwrites them with accent shades (inline style), so theme chart colours would never show. Rename today's behaviour to "Accent shades". Consider adding a "Colour-blind safe" palette (Okabe-Ito: #0072B2 #E69F00 #009E73 #D55E00 #CC79A7 #56B4E9 #F0E442 #000000).
4. **Density**: Comfortable / Compact. Use `data-density="compact"` on `<html>` to reduce table row height (about 44 to 34px), card padding and gaps. This matters most for invoices and stock lists.
5. **Corners**: Rounded / Soft / Sharp. Add one `--fd-radius` token (e.g. 14 / 8 / 3px) and have cards, buttons and inputs read it.
6. **Text size**: 13 / 14.5 (now) / 16px on body, with Bengali `size-adjust` kept.
7. **Background**: Plain / Subtle gradient (a radial accent-soft wash in the top corner) / Photo (existing). With a photo, make cards slightly translucent with a backdrop blur, and keep the contrast checks against the card, not the photo.
8. **Accessibility extras** (cheap to add later): "High contrast" (text-3 becomes text-2, borders become border-strong, accent-text at 7:1) and "Reduce motion".

Storage: keep these per-device in localStorage (`fd_theme`, `fd_accent`, `fd_density`, `fd_radius`, `fd_font`, `fd_bg`). Optionally save them per user on the server later.

## Integration notes

- Inline custom properties on `<html>` beat the `:root[data-skin="fd"]` stylesheet rules. When the light/dark switch flips, call `fdThemeApply(key, mode)` again; the existing MutationObserver on `data-theme` is a good hook. `fdThemeClear()` returns to the stylesheet defaults.
- To stop a first-paint flash, apply the saved theme in a tiny inline `<script>` in `<head>` before the CSS paints.
- Tokens not covered here (`--fd-shadow-card*`, `--fd-glow-*`, `--fd-focus-ring`) still come from the stylesheet. The amber glows in dark mode would look odd on, say, Ocean. Either derive them from `--fd-accent-border` in CSS or add them to the token list.
- **The FilaDash defaults have 2 small contrast misses** (see below): light `text-3` #6B7190 on page #F6F7FB is 4.47 (fix: #686E8C), and light negative text #DC2626 on its pink badge #FDE8E8 is 4.11 (fix: #C81E1E). They were kept unchanged on purpose because they are the partner's values.

## Contrast results (generated by build.js)

| Theme | Mode | Text/card (≥4.5) | Text-2/card (≥4.5) | Text-3/bg (≥4.5) | Faint/card (≥3) | Accent/bg (≥3) | OnAccent/accent (≥4.5) | AccentText/card (≥4.5) | Pos-text/soft (≥4.5) | Neg-text/soft (≥4.5) | Warn-text/soft (≥4.5) | Info-text/soft (≥4.5) | White/tooltip (≥4.5) | Min chart/card |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FilaDash | light | 17.69 | 7.93 | **4.47 ✗** | 3.17 | 5.25 | 5.62 | 6.92 | 4.53 | **4.11 ✗** | 4.94 | 5.03 | 15.73 | 2.15 |
| FilaDash | dark | 15.47 | 10.36 | 6.01 | 3.61 | 8.95 | 9.10 | 8.26 | 7.56 | 7.54 | 8.00 | 7.55 | 15.73 | 6.05 |
| Emerald | light | 17.80 | 8.34 | 5.02 | 3.23 | 5.13 | 5.48 | 5.78 | 4.52 | 4.52 | 4.55 | 4.52 | 17.80 | 3.01 |
| Emerald | dark | 15.61 | 10.73 | 6.72 | 3.88 | 9.73 | 8.89 | 8.83 | 7.17 | 5.08 | 7.55 | 5.27 | 12.99 | 6.14 |
| Ocean | light | 17.85 | 7.58 | 5.06 | 3.29 | 4.81 | 5.17 | 5.70 | 4.52 | 4.52 | 4.55 | 4.61 | 17.85 | 3.01 |
| Ocean | dark | 15.71 | 11.59 | 7.35 | 3.62 | 8.80 | 8.15 | 8.03 | 7.40 | 5.14 | 7.72 | 7.12 | 13.26 | 5.77 |
| Rose | light | 17.93 | 8.70 | 5.36 | 3.22 | 4.42 | 4.70 | 5.80 | 4.52 | 5.29 | 4.55 | 4.52 | 17.93 | 3.01 |
| Rose | dark | 16.26 | 11.24 | 6.62 | 3.54 | 7.08 | 6.65 | 6.59 | 7.76 | 5.19 | 7.85 | 5.62 | 14.40 | 6.52 |
| Violet | light | 18.06 | 8.72 | 5.18 | 3.34 | 5.30 | 5.70 | 5.79 | 4.52 | 4.52 | 4.55 | 4.52 | 18.06 | 3.01 |
| Violet | dark | 16.18 | 11.45 | 6.71 | 3.56 | 6.99 | 6.56 | 6.59 | 7.75 | 5.23 | 7.93 | 5.58 | 14.48 | 6.52 |
| Sunset | light | 17.49 | 7.63 | 5.06 | 3.25 | 4.89 | 5.18 | 5.74 | 4.52 | 4.52 | 4.56 | 4.52 | 17.49 | 3.01 |
| Sunset | dark | 16.33 | 11.45 | 6.63 | 3.59 | 8.36 | 7.72 | 7.76 | 7.58 | 5.15 | 8.32 | 5.52 | 14.00 | 6.45 |
| Slate (mono) | light | 19.90 | 10.44 | 4.53 | 3.34 | 16.12 | 16.97 | 17.72 | 4.52 | 4.52 | 4.55 | 4.52 | 19.90 | 3.01 |
| Slate (mono) | dark | 17.63 | 12.45 | 7.76 | 3.81 | 19.06 | 16.97 | 17.63 | 8.04 | 5.47 | 8.28 | 5.84 | 14.89 | 3.81 |
| Catppuccin | light | 7.06 | 5.53 | 4.65 | 3.23 | 4.45 | 5.41 | 5.66 | 4.59 | 4.51 | 4.58 | 4.53 | 7.99 | 3.02 |
| Catppuccin | dark | 11.34 | 9.26 | 7.89 | 4.44 | 8.64 | 9.23 | 8.07 | 7.82 | 5.53 | 8.90 | 5.91 | 18.75 | 7.08 |
| Nord | light | 11.86 | 9.55 | 6.06 | 3.52 | 3.75 | 4.57 | 5.53 | 4.98 | 4.55 | 5.12 | 4.58 | 12.49 | 3.01 |
| Nord | dark | 8.73 | 8.26 | 9.25 | 4.05 | 6.24 | 6.24 | 6.80 | 4.54 | 4.53 | 4.76 | 4.50 | 14.58 | 3.03 |
| Dracula | light | 15.89 | 10.47 | 5.23 | 3.30 | 5.51 | 6.24 | 6.02 | 4.99 | 4.50 | 4.57 | 4.87 | 16.48 | 4.80 |
| Dracula | dark | 13.36 | 10.95 | 7.32 | 3.03 | 6.55 | 6.55 | 6.81 | 7.32 | 4.53 | 8.44 | 7.12 | 17.34 | 3.03 |
| Tokyo Night | light | 9.98 | 8.95 | 4.56 | 3.40 | 5.48 | 6.77 | 6.15 | 5.68 | 5.29 | 4.53 | 4.62 | 10.98 | 5.05 |
| Tokyo Night | dark | 9.63 | 7.37 | 7.04 | 3.04 | 6.79 | 6.79 | 6.75 | 6.31 | 4.72 | 5.86 | 6.61 | 17.99 | 5.88 |
| Rosé Pine | light | 7.00 | 5.27 | 4.80 | 3.22 | 4.15 | 4.53 | 5.45 | 4.98 | 4.51 | 4.58 | 4.50 | 7.27 | 3.01 |
| Rosé Pine | dark | 12.50 | 8.32 | 5.48 | 3.20 | 8.43 | 8.43 | 7.88 | 7.06 | 4.63 | 7.34 | 4.53 | 15.17 | 3.05 |
| Solarized | light | 12.05 | 5.14 | 4.56 | 3.44 | 3.77 | 4.62 | 5.54 | 4.66 | 4.53 | 4.56 | 4.55 | 13.00 | 3.02 |
| Solarized | dark | 10.61 | 5.22 | 5.97 | 3.04 | 4.55 | 4.55 | 6.28 | 4.51 | 4.51 | 4.53 | 4.52 | 16.77 | 3.01 |
| Flexoki | light | 18.62 | 10.36 | 4.54 | 3.36 | 5.72 | 6.54 | 6.36 | 4.52 | 5.18 | 4.56 | 4.52 | 19.14 | 3.39 |
| Flexoki | dark | 10.77 | 8.37 | 5.83 | 3.37 | 4.86 | 4.86 | 5.97 | 4.54 | 4.51 | 5.69 | 4.88 | 14.91 | 3.97 |
| Gruvbox | light | 10.53 | 8.01 | 5.18 | 3.47 | 4.87 | 6.12 | 5.82 | 4.56 | 6.24 | 4.58 | 5.03 | 11.60 | 3.43 |
| Gruvbox | dark | 10.75 | 8.59 | 7.53 | 4.02 | 6.49 | 6.49 | 6.54 | 5.38 | 4.54 | 6.34 | 4.52 | 11.60 | 4.29 |

**Failures:** FilaDash light Text-3/bg 4.47; FilaDash light Neg-text/soft 4.11

**Source values nudged for contrast:**

- Emerald light: text-faint #8A968F → #86928B
- Ocean light: text-faint #8B9AAE → #818FA2
- Sunset light: text-faint #A29C97 → #938E89
- Slate (mono) light: text-3 #71717A → #6F6F78
- Slate (mono) light: text-faint #A1A1AA → #8C8C94
- Catppuccin light: text-3 #6C6F85 → #63667A
- Catppuccin light: text-faint #8C8FA1 → #828596
- Nord light: text-faint #7B88A1 → #79859E
- Nord light: accent #5E81AC → #5778A0
- Dracula light: text-faint #8E89B5 → #8B86B1
- Tokyo Night light: text-3 #6C6E75 → #66676E
- Tokyo Night light: text-faint #9699A3 → #81848C
- Tokyo Night dark: text-faint #565F89 → #646C92
- Rosé Pine light: text-3 #797593 → #6D6984
- Rosé Pine light: text-faint #9893A5 → #8F8A9B
- Rosé Pine light: accent #907AA9 → #826E98
- Solarized light: text-2 #586E75 → #566C73
- Solarized light: text-3 #657B83 → #586B72
- Solarized light: text-faint #93A1A1 → #7B8787
- Solarized light: accent #268BD2 → #217AB9
- Solarized dark: text-2 #93A1A1 → #99A7A7
- Solarized dark: text-3 #839496 → #98A6A8
- Solarized dark: text-faint #657B83 → #687E85
- Solarized dark: accent #268BD2 → #3794D6
- Flexoki light: text-3 #6F6E69 → #6E6D68
- Flexoki light: text-faint #9F9D96 → #8C8A84
- Flexoki dark: text-3 #878580 → #8F8E89
- Gruvbox light: text-faint #928374 → #8F8072

**Chart colours darkened (light) / lightened (dark) to reach 3:1 on the card:**

- Emerald light #0EA5E9→#0D9EE0
- Emerald light #F59E0B→#CE8509
- Emerald light #14B8A6→#12A695
- Emerald light #84CC16→#6AA312
- Ocean light #0EA5E9→#0D9EE0
- Ocean light #14B8A6→#12A695
- Ocean light #22C55E→#1DA951
- Ocean light #F59E0B→#CE8509
- Rose light #0EA5E9→#0D9EE0
- Rose light #F59E0B→#CE8509
- Rose light #14B8A6→#12A695
- Rose light #22C55E→#1DA951
- Violet light #06B6D4→#05A2BD
- Violet light #22C55E→#1DA951
- Violet light #F59E0B→#CE8509
- Sunset light #F59E0B→#CE8509
- Sunset light #0EA5E9→#0D9EE0
- Sunset light #14B8A6→#12A695
- Sunset light #84CC16→#6AA312
- Slate (mono) light #22C55E→#1DA951
- Slate (mono) light #F59E0B→#CE8509
- Slate (mono) light #06B6D4→#05A2BD
- Slate (mono) light #A1A1AA→#94949C
- Catppuccin light #FE640B→#EC5D0A
- Catppuccin light #40A02B→#3F9E2B
- Catppuccin light #EA76CB→#CC67B1
- Catppuccin light #DF8E1D→#C07A19
- Nord light #88C0D0→#6A96A2
- Nord light #B48EAD→#A985A3
- Nord light #A3BE8C→#81966F
- Nord light #D08770→#C47F69
- Nord light #EBCB8B→#A48E61
- Nord light #8FBCBB→#729696
- Nord dark #BF616A→#C7767D
- Rosé Pine light #D7827E→#CC7C78
- Rosé Pine light #EA9D34→#C5842C
- Rosé Pine dark #524F67→#6A687C
- Solarized light #2AA198→#299E95
- Solarized light #859900→#849700
- Solarized light #B58900→#B38800
- Solarized dark #CB4B16→#CE5422
- Solarized dark #D33682→#D53E87
- Solarized dark #6C71C4→#6D72C5
- Solarized dark #DC322F→#DE3E3B
