# Content desk for businesses: blueprint (impeccable shape, 19 Nov 2026)

**Surface:** web/app.html, the Brand Cockpit "Line Map" world (direction contract `.impeccable/surfaces/web-app-html.md`).
**Mode:** Operate.
**Owner decision:** reuse the Brand desk engine and screens. Do not build a new look.

## Who and when
- **The owner, on PC or phone.** Each morning he opens a business (Costareen or Oliareen) and sees:
  - what is ready;
  - what is coming next in the 60-day plan;
  - what the ERP's own events (new product, shipment) made.
  He approves with one tap.
- **The page handlers.** Today they are not ERP users. They receive the approved video and caption on WhatsApp from the
  business's own number, and download them.

## What changes against the personal Brand desk (same cockpit, business mode)
The cockpit opens on any business that has a content desk engine (`BIZ.businesses[].desk`). The top bar shows the
business's own name, never "Rahman" or "ব্র্যান্ড ডেস্ক".

| Rail item (personal) | Business mode |
|---|---|
| হোম (metro map of the week) | kept: the lines are the business's networks, the stations its drafts |
| পরিকল্পনা (plan) | kept: shows that business's 60-day plan and how far along it is |
| পোস্ট (posts waiting) | kept, with a different action: **"তৈরি — পেজে দিন"** instead of publish. Video preview, **"ভিডিও নামান"** and **"WhatsApp-এ পাঠান"** to a page handler |
| আইডিয়া | kept (idea bank, series) |
| নিয়ম | kept, plus a **"পেজ চালান যারা"** block (name + WhatsApp, max 10) |
| ঘটনা (new) | ERP events list: নতুন প্রোডাক্ট / শিপমেন্ট আসছে / শিপমেন্ট এসেছে, with their state (অপেক্ষায় / ড্রাফট হয়েছে / ভিডিও হয়েছে) |
| ইনবক্স, ব্যবসা ও সাইট, মিডিয়া, শোনা, মানুষ, সংযোগ, দর্শক, লেখার ধরন, LinkedIn | hidden (personal only) |
| ফলাফল, রুটিন | kept (empty until posting exists; routine shows the business slots) |

## The one screen that is new: a post card in business mode
- The card looks the same as today: a phone-sized card in the network's own UI, with a See-more fold.
- When a video exists, the video sits inside the card (9:16, poster frame), and three buttons run under it in one row:
  - **তৈরি** (approve; black primary);
  - **ভিডিও নামান** (download);
  - **WhatsApp-এ পাঠান**. This opens a small sheet with the handler list; one tap sends from the business's own number;
    a sent row shows ✓ and the time.
- Hard checks (brand lock, fact lock, education-only) show as a red line above the buttons, in the existing flag style,
  and disable **তৈরি**.
- Copy, in Bangla with আপনি: "ক্যাপশন কপি করুন" sits next to WhatsApp, because a page handler pastes the caption.

## States
- **No engine yet:** the rail shows only হোম with one plain sentence: "এই ব্যবসার কনটেন্ট ডেস্ক এখনো চালু হয়নি।"
- **Engine offline:** use the same message the Brand desk uses ("Mac বন্ধ …").
- **No WhatsApp channel for this business:** the WhatsApp button is shown disabled, with the reason given in a "?" help
  (no grey hint text).
- **No handlers:** the send sheet links to নিয়ম › পেজ চালান যারা.

## Visual rules
These come from the contract and must not change:
- white ground, ink #16181D, panels #F2F3F5, 1px rules;
- network-line colours only, plus stuck red and waiting amber;
- pill tabs and black bars for what waits;
- Pretendard and Hind Siliguri.

The business's own logo and name stand in the top bar. No new colours.

## Not in this stage
Posting through Postiz for businesses, metrics, handler accounts inside the ERP.
