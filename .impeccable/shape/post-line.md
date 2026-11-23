# Post line (line-1) — design brief

Owner, 24 Nov 2026 (Plan pop-up + Posts page): "'পরের ধাপে খুলবে' — I don't understand what the next step is. A post
(8 kg carton, courier charged 16 kg) shows no picture in 'full post', and 'পোস্ট দেখুন' doesn't take me to the
picture either. I want to see the actual post, the way Facebook will show it, picture and caption, interactive (see
more). Replace the lower list where 'পোস্ট দেখুন' lands with the platform-wise model we built before: platforms
down the page, time sideways; now at the start; posts move on as they go out, posted ones drop down and leave after a
few days. Sideways: 7 / 10 / 14 days, or pick from–to dates and jump there - better than zooming."

Mode: **Operate**. The Line Map world of the desk stays; previews reuse the desk's own phone cards (phoneCard), so a
post looks exactly as on the Posts page's approval cards.

## Why the picture was missing
The Posts page's যাবে / গেছে rows only had the post's first 280 characters from the cockpit; the pictures and videos
live on the Mac's post line (pacer) and on the waiting draft. New read: bridge `/line` → ERP `erpBrandDeskLine`
{start, days} returns every post of the window per network with its whole text and media (post line items,
Postiz posts not already on the line, drafts waiting for approval). Read only.

## 1. "পরের ধাপে খুলবে" explained in the pop-up
Each network posts at step 1..max (growth gate). A slot of a higher step stays grey until the network steps up by
itself: once a day the Mac measures the last 14 days' median views; past the gate it steps up (and back down if views
fall > 25 %). The pop-up says: this network is at step n of m; this slot belongs to step k; the gate in words; today's
median; next check in d days. No action.

## 2. Post preview sheet ("পুরো পোস্ট দেখুন")
- From the Plan pop-up (slots with a post) and from every lane card.
- A sheet over the desk (right side on PC, bottom sheet on phone), focus-trapped, Esc / × / outside closes.
- Inside: the phone card exactly as the network shows it (avatar, name, time, caption with "see more", picture
  carousel count or playable video, reactions bar), then one meta line (network · day time · state) and actions:
  review → "অনুমোদনের পাতায় যান" (the waiting card with its editor); scheduled/posted → "পোস্ট পাতায় দেখুন".

## 3. Posts page যাবে / গেছে → the post line (lanes)
- Rows = networks (vertical), each row a horizontal scroller of phone-card previews in time order.
- যাবে: starts at now (an "এখন" marker heads every lane), upcoming posts to the right.
- গেছে: newest first going back; posted items older than the window are simply not shown (the Mac's post line
  keeps a sent post's media 7 days, so the default is 7).
- Above the lanes: range chips ৩ / ৭ / ১০ / ১৪ দিন + a from-date picker; a date strip of the window — tapping a date
  scrolls every lane to its first post on/after that day (side-scroll jump, no zoom).
- The existing network filter pills keep working (one network = one lane).
- Card: time + state tag on top (অনুমোদন বাকি / যাবে / গেছে / আটকে), the phone card at 300 px, tap opens the sheet.
- Empty lane: one quiet line "এই সময়ে এই নেটওয়ার্কে কিছু নেই".

## Look and craft
Desk tokens; Noto Sans Bengali; cards on the desk shelf with 12 px radius; lanes separated by hairlines; horizontal
scroll with snap; images lazy; reduced motion respected; dark theme mixes; phone: lane cards 260 px, chips 44 px.
## Checks
PC 1440 + phone 390, light + dark, bn + en desk; keyboard (Tab into lanes, Enter opens sheet, Esc closes);
no overflow of the page; no console errors; posts with picture, video, text only, waiting draft.
