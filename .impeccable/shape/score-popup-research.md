# Research: one universal score + "how the score came" popup (score-ui-1, 20 Nov 2026)

Owner's ask: every video, picture and post gets one score on top (e.g. 91); the number is a button; the popup shows
which checks ran, who judged (AI judge, code rules, ffmpeg, vision judge), each part's score, what was changed and what
is left. Data: bridge `fit_report().scorecard` = `{score, parts[{key,name,score,who[],items[],before,changed[],gate[],
audit[]}], learned}`; drafts list `w.uscore`.

## What good products do

| Product | How the composite is shown | What we take |
|---|---|---|
| **Lighthouse** ([scoring](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring), [variability](https://developers.google.com/web/tools/lighthouse/variability)) | Big gauge number, 3 colour bands (0-49 / 50-89 / 90-100), then each metric with its **weight**. Docs say outright the score fluctuates between runs, "think of it as a distribution", and the median of 5 runs is twice as stable as 1. 100 is "not expected". | Show each part's **weight** next to its score so the owner sees why virality moves the total most. Say in one line that AI scores move a few points run to run. Three bands, not a gradient. |
| **Grammarly** ([support](https://support.grammarly.com/hc/en-us/articles/360007144751-What-is-Performance-and-how-is-it-calculated), [API](https://developer.grammarly.com/writing-score-api.html)) | "Overall score" at the top is itself a click target that opens the breakdown into 4 named categories (correctness, clarity, engagement, delivery), each with its own suggestions. | Exactly the owner's pattern: number = button -> per-part breakdown -> the concrete fixes per part. |
| **Credit Karma** ([factors](https://www.creditkarma.com/lp/goals-credit), [UK help](https://help.creditkarma.co.uk/s/article/What-key-factors-impact-my-credit-score)) | Each factor carries an **impact label** (high / medium / low) instead of a raw weight, plus a plain sentence of what helps. | Weight as a word is easier on a phone than "45%"; we show both: "বড় প্রভাব · ৪৫%". |
| **Surfer / Clearscope** ([Surfer](https://docs.surferseo.com/en/articles/5700317-what-is-content-score), [Clearscope](https://www.clearscope.io/support/how-does-clearscope-grade-your-content)) | Surfer: 0-100 with a band ("67-100 optimum"), sub-scores, updates live. Clearscope: deliberately a **letter grade** (A++ .. F) to avoid false precision; each term shows a green check when done. | Checklist rows: tick / cross per check, the fix is the row text. Keep the number (owner asked for it) but pair it with a band word (ভালো / মাঝারি / দুর্বল) so 88 vs 91 is not read as a real difference. |
| **A/B tools** ([VWO "chance to win"](https://wingify.com/blog/interpret-a-b-test-results-from-software/)) | Report a probability / range with a clear threshold, not a bare point estimate. | When the AI judge ran twice and the two runs disagreed on some questions (a judge item that averages to x.5), say so: "দুই বিচারে N টা প্রশ্নে মতভেদ". |
| **LLM-as-judge research** ([Deepchecks](https://deepchecks.com/llm-judge-calibration-automated-issues/), [survey](https://www.sciencedirect.com/science/article/pii/S2666675825004564), [How to report LLM-judge evals](https://www.alphaxiv.org/abs/2511.21140), [Overconfidence](https://arxiv.org/html/2508.06225v2)) | "Numerical scores appear precise even when they are not"; the same judge gives different scores to the same input (sampling variance); raw judge scores are biased and need an uncertainty band. | Label the number honestly as an **AI estimate** ("AI-এর আনুমানিক স্কোর"); show a ± band ("সাধারণত ±৩-৫ ওঠানামা"); keep code-rule checks (deterministic) visually apart from AI-judge items. |
| **Progressive disclosure for XAI** ([HAL, Docus.ai study](https://hal.science/hal-05331557v1/file/OperationalizingSelectiveTransparency.pdf), [NN/g on AI disclosure](https://www.nngroup.com/articles/disclose-ai-paced/)) | Minimum up front (score + confidence), details on request; clinicians followed the logic better than with a one-shot dump. | Popup level 1 = score, band, before->after, one row per part (name, bar, score, who-judged chips). Level 2 (tap a row) = checks, judge answers, fixes left, what changed. |

## Design rules baked in

1. **Honest label:** the big number carries "AI-এর আনুমানিক স্কোর" and a band word; never "ভাইরাল হবে".
2. **Uncertainty:** one quiet line under the number: AI judges move ±৩-৫ between runs; if the judge ran twice, say
   "দুবার বিচার করে গড়" and how many questions the two runs disagreed on (judge item = 0.5 / 1.5). No fake decimals.
3. **Before -> after** when `before` exists (virality first audit vs now), with the delta as a word + number.
4. **Owner is final:** a fixed footer line in the popup: "শেষ কথা আপনার রিভিউ; স্কোর শুধু সাহায্য।"
5. **Who judged is scannable:** small chips per part, each typed by kind (কোড / AI / ffmpeg / ভিশন) so on 390 px the eye
   reads the kind before the detail. Code = deterministic, AI = estimate.
6. **Weights visible:** each part row shows its share of the total ("ভাগ ৪৫%"), like Lighthouse.
7. **What changed / what is left** in the expanded row: changed modules as a "বদলানো হয়েছে" list; fixes still open as a
   numbered list (the audit fixes, lowest module first). Gate items (hard stops) shown in stuck red above everything.
8. **Three colour bands only** (>=85 good, 60-84 mid, <60 weak), using the world's own colours: good = ink outline,
   mid = waiting amber, weak = stuck red. No new hues (direction contract).
9. **Missing data:** "এখনো যাচাই হয়নি" as a neutral outline chip; never a 0.
10. **Phone 390:** sheet is the existing bottom sheet (pnSheet); rows are full-width buttons >=44 px tall; bars are
    inline, not a chart.

## Shape brief (impeccable shape, 20 Nov 2026; run as a subagent with no question tool, so decided from the owner's brief)

- **Job / mode:** Operate. The owner, on PC or phone, glances at a waiting draft and wants to know "can I trust this
  piece?" in one look, and "why that number, what is left" in one tap. Success = he approves or sends back faster.
- **Direction:** inside the Brand Cockpit "Line Map" world (no new hues). Score bands map onto the world's own signals:
  good = Ink ring, mid = waiting amber, weak = stuck red (soft). Card chip = a 38px (44px phone) pill button with an
  800 Pretendard figure, next to "প্ল্যানের সাথে মিল". Content desk cards get the same chip in their header.
- **Popup:** existing comment-sheet shell (pnSheet) in the cockpit, a matching bottom sheet on the Content desk.
  Order: big figure + band word + "AI-এর আনুমানিক স্কোর" -> before->after -> one-line uncertainty (±৩-৫, judge ran twice,
  disagreements) -> hard stops -> one row per part (name, share of total, score, bar, who-judged chips typed কোড / AI /
  মাপ / ছবি দেখে) -> tap a row: checks (tick/cross), AI judge summary, what changed, what is left -> footer "শেষ কথা
  আপনার রিভিউ". The plan-fit sheet gets the same figure as a full-width button on top that opens the popup (with a back
  button to the plan sheet).
- **States:** no scorecard yet (bridge not deployed / draft not audited) = dashed chip "এখনো যাচাই হয়নি" and a plain
  explanation in the popup; loading = shimmer; error = the existing retry callout.
- **Untouched:** everything else on the cockpit and the Content desk; bridge code; no server change (the handlers pass
  bridge JSON through, so `scorecard` and `uscore` already reach the page).
