# Growth research: what pulls customers in and keeps them (2026-10-06)

Status: **research and plan. Nothing in here is built unless marked "exists".**
Asked by the owner: check the earlier plan (four free customer tools, warranty automation,
phone scanning) against real evidence, and find what to add for printer owners, print buyers,
print farms, resellers and designers. Read with `PLATFORM-BLUEPRINT.md` (the market between
companies, already built) and `JOINT-POOL-BLUEPRINT.md`.

How sure: local facts marked (seen) were read on the page itself. Facts marked (listing) came
from a search listing and were not opened. Figures from vendor blogs are a direction, not a
measurement.

## 1. What the evidence says

| Finding | Where from | What it means for us |
|---|---|---|
| Other shops in Bangladesh already take a file and give a price: RoboticsBD has an "instant price quote" site, Artin3D has "Upload STL & get quote", RH BD publishes per-gram prices (PLA+ ৳5, PETG ৳7, ABS ৳9, TPU ৳12, resin ৳18 per gram). | RoboticsBD (listing; the page blocked me), Artin3D (seen), RH BD (listing) | An instant quote is expected, not special. We need one, and the special part is giving the same tool to every farm on our platform under its own name. |
| The same Bambu A1 is sold locally with very different warranties: "4 Day General Warranty" at one shop (seen, ৳61,370), setup + 1 month at another, 1 year at a third (listings). The maker's own store gives 2 years (listing). | electronics.com.bd (seen), RoboticsBD, Robotonbd | A warranty the customer can see and check is a selling point. Serial + warranty tracking (exists) matters more than we treated it. |
| Local pain: spare parts take long to import, humidity ruins filament, load shedding kills long prints, beginners lack design / slicing / troubleshooting skills. Buyers named: university students (BUET, MIST), bedroom businesses, hobbyists, jewellery and dental labs. | Artin3D beginner guide (seen) | Content and bundles for humidity and power cuts; help in Bangla; spare parts on hand. |
| Why people give up the hobby: setup and calibration, constant maintenance, failed prints, and nothing left to print once the novelty fades. | BGR, XDA, JLC3DP, MakerHacks (listings) | A print-problem guide and a weekly "what to print" are worth more than a filament picker. |
| Cash on delivery: a vendor source calls a 40 % return rate typical in Pakistan and Bangladesh and says about 70 % of failed deliveries are operational (address, timing), not fraud. Its fixes: check the address, confirm the delivery window on WhatsApp, take a 10-15 % advance, score the order before dispatch. | EasySell (seen; vendor blog) | COD check + WhatsApp confirmation + advance for risky orders. Advance on COD exists; WhatsApp exists. |
| Pathao gives merchants a fraud check by phone number (delivery history in its own network). Paid checkers and an open-source package do the same across Steadfast, Pathao, RedX, Paperfly, Carrybee. | Pathao blog (seen), Fraud BD, GitHub package (listings) | A delivery-history score on New invoice is doable; the data source needs a small test first. |
| Sellers price by feel and lose money. Worked example: US$1.87 of filament, 9 print hours, true cost US$15.46 (labour 65 %), sold at US$12. | Ardent Workshop (seen) | A true-cost calculator in taka (filament, electricity, machine wear, failures, labour, packaging) is a real need for farms. |
| Farm software abroad (SimplyPrint, Printago, AutoFarm3D) is about controlling printers and Etsy / Shopify orders. | Their own sites (listings) | Do not compete on printer control. Nobody serves the local reality: Facebook orders, COD, bKash, Steadfast, Bangla. That is our lane (inference). |
| 2026: filament prices in the US rose up to 59 % (tariffs, feedstock, TPU shortage). Advice given to farms: buy from locally held stock, store dry, use refills. | Filament Cheat Sheet (seen) | A local supplier with steady stock and a locked price is valued by farms. |
| Designers: stolen files resold on Etsy / Temu is a running complaint; MakerWorld started a copyright protection programme and commercial-licence memberships (reported US$3-300 a month, 10 % platform fee); Thangs designers sell memberships with a commercial licence (about US$10-20 a month). | Bambu forum, Tom's Hardware headline, 3Druck, Thangs (listings) | Designers want a way to be paid by people who sell prints. We can track each print sold (the ERP has every invoice line); the big platforms cannot. |
| AI image-to-3D is print-ready in 2026 (Meshy inside Bambu's MakerLab: photo to a watertight model). MakerLab's personalisers (name signs, figurines from photos) are promoted heavily. | PR Newswire, 3dprinting.com, Bambu (listings) | People without CAD can now get a model. Personalised items and photo-to-figurine are services we can offer without a designer for each job. |
| Loyalty programmes: repeat purchase reported at about 27 % without and 40-50 % with one; tiered programmes about 1.8x revenue per member; members spend 12-18 % more per order. | LaunchMyStore citing Shopify, Accenture, Annex Cloud (seen; second-hand) | Points with levels are worth building. Treat the numbers as direction only. |
| Maker communities run on points and contests: MakerWorld points (downloads, prints, boosts, weekly themes) turn into gift cards and filament; Printables gives Prusameters, also for referrals, and runs a contest every second Friday. Its most popular theme was "Repairs". | MakerWorld, Printables / Prusa blog (listings) | Points, a weekly theme and a regular contest are proven in this exact hobby. People love fixing things: a repair-parts angle fits. |
| Resellers who hold no stock are a proven local model (ShopUp / Mokam / REDX: buy wholesale, courier delivers to the reseller's customer, credit "Baki"). | ShopUp, Future Startup (listings) | Drop-shipping for resellers on our platform is a known pattern here, not an experiment. |
| Unauthorised lotteries are an offence (Penal Code s. 294A). | bdlaws, TBS (listings) | No lucky draws. Contests judged on merit and gifts for everyone are fine. |

Technical checks of the earlier plan:
- **Phone camera scanning**: the browser's built-in barcode reader works in Chrome on Android but is
  switched off in Safari (iPhone) and missing in Firefox. So a scanning library must be bundled.
  Still free, nothing to install.
- **Quote by slicer on the office VPS**: against the standing rule (VPS is read-only for us) and a
  thing to maintain. A browser can read the file and work out volume, surface and size itself.
  An open-source slicer that runs in the browser exists (Kiri:Moto) but wants about 8 GB of
  memory: not for phones. So: an estimate in the browser, a real slice by staff for big jobs.
- **Colour match from a photo**: phone photos shift colour with the light. A public library of
  about 3,000 instrument-measured filament colours exists (FilamentColors, open API). Measured
  colour chips and "closest colour we stock" are more honest and more useful.

## 2. Verdict on the earlier plan

| Earlier item | Verdict |
|---|---|
| Filament picker, printer advisor | Keep. Merge into one "Help me choose". Small. |
| Colour match from a photo | Demote. Do measured colour chips, "closest in stock" when a colour is out, and a physical swatch card in parcels. |
| Instant print quote (slicer on VPS) | Keep the idea, change the method (browser estimate). Give it to every farm on the platform. |
| Print Doctor (dropped: "needs AI") | Bring back without AI: pictures of the failure, tap the one that looks like yours, get the cause and the fix in Bangla. This answers the biggest reason people quit. |
| "Where is my order" chat | Replace by a customer page (no AI). |
| Phone camera scan | Keep, with the scanning library. |
| Warranty by serial, registration card | Right, and a selling point. Add a warranty page the customer can open. |
| AI chat assistant | Still later, if ever. Rules first. |

The earlier plan was four small tools for strangers. The evidence points at three bigger things:
keep the customers we already have, solve failed prints, and give farms and resellers orders.

## 3. Who needs what

**Printer owners (hobbyists, students with a printer)**
- Fewer failed prints: Print Doctor; tested settings for each filament we sell on each common
  printer (a QR on the invoice line opens the settings); humidity and load-shedding help
  (dry box + silica bundles, a "which UPS for my printer" helper).
- Something to print: a weekly "print of the week" (file, settings, which filament).
- Never running out: refill reminder timed from their own buying rhythm; "your colour is back".
- Trust: warranty page, spare parts on hand or on pre-order with a date.

**People buying prints (students' projects, gifts, small businesses, labs)**
- A price without waiting in the inbox: instant estimate.
- No 3D file: design desk (send a sketch or photo, a designer quotes); name-sign / keychain
  maker in Bangla and English; photo to lithophane; photo to figurine as a service.
- A broken part at home: "send a photo of the broken part" (repair requests).
- Trust: order page with parcel status, reviews with photos.

**Print farms and sellers**
- Orders: a public print-job board whose requests go to farms on our market. Jobs are what
  pull a seller onto a platform.
- Correct prices: true-cost calculator in taka.
- Fewer fake orders: COD check, WhatsApp confirmation, advance for risky orders.
- Order in the workshop: job board (which printer, which stage), grams taken from stock per job,
  quote -> job -> invoice (quotation -> invoice exists).
- Supply: volume price levels, credit (dues exist), low-stock hint that offers our stock (exists).
- Their own quote link under their own name.

**Resellers**
- Sell without stock: pick from our list at reseller price, enter their customer and their
  selling price, we ship under their name, COD is collected, their margin is settled.
  The "seller as agent" bookkeeping in `JOINT-POOL-BLUEPRINT.md` is the same pattern.

**Designers**
- Paid custom work: design desk with profile, ratings, payout.
- Later: a licensed catalogue. A designer lists a model with a royalty per print; farms on the
  platform may print and sell it; the ERP counts each one sold and settles the royalty.
  This is the one thing the big model sites cannot do.

**Schools, universities, labs**
- Quotations (exist), bulk supply, VAT invoices (not built: plan D8), lab packs, project-season offers.

## 4. Making it a habit (the owner's word: "addicted")

Model: trigger -> one easy action -> a reward that varies -> something of theirs stored with us.

| Step | What we do |
|---|---|
| Trigger | Refill reminder at the moment they are likely low. "Your colour is back." Friday print of the week. A monsoon note when humidity is high. Warranty about to end. For farms: "PLA under 2 kg - reorder?" |
| Action | One tap: "same as last time" reorder; the customer page opens from a link, no password. |
| Reward | Points on every paid order. Bonus points for a photo review. A free sample of a new colour in every parcel (they collect a swatch card). A monthly contest judged on merit. Moving up a level. |
| Stored with us | Their printers and settings, their points and level, a progress bar to the next level ("3.2 kg more for Farm price"), their gallery and reviews. For farms: their whole business. |

Guardrails (not optional): no fake countdowns, no fake "only 1 left", no fake reviews, no lucky
draws, an easy STOP on WhatsApp (exists). Online buyers here are already wary; being the shop
that never tricks them is the advantage. The habit must come from being useful every time.

## 5. Build order

Each item is one stage: built, tested, deployed, checked, recorded.
Size: S = small, M = medium, L = large.

**Group 1 - keep the customers we have**
1. Customer page (M). A secret link / QR per customer on every invoice and WhatsApp message:
   parcel status, invoices and statement, dues, warranty by serial + registration, one-tap
   reorder (lands in Web orders), points. Uses: invoice QR, courier status, statement, serials.
2. Maker Points and levels (M). Earned when an invoice is paid, taken back on a return; levels
   by 12-month spend; referral code. Every point traceable, like money.
3. Refill and back-in-stock reminders (S-M). From each customer's own filament purchases; sent
   by the existing WhatsApp campaigns with opt-out.
4. Warranty automation + phone scan (M). Agreed earlier: category rules, bulk set, scan with
   the camera, registration card.
5. COD check (S once the data source is proven). Phone -> delivery history; WhatsApp "confirm
   your delivery"; suggest an advance for risky orders.

**Group 2 - bring strangers in (public pages, each company's own brand)**
6. Print Doctor in Bangla and English (M, mostly writing and pictures) + monsoon and UPS helpers.
7. Help me choose: filament and printer, live stock and prices, measured colour chips (S-M).
8. Instant estimate -> "get it printed" (M). Calibrated on about 20 real slices.
9. Name-sign / keychain maker, lithophane maker (M-L). Photo to figurine as a service by staff.
10. Repair-part requests (S on top of the design desk).

**Group 3 - pull farms, resellers, designers onto the platform**
11. Farm kit: true-cost calculator (S), job board (M), grams per job (M), own quote link (S after 8).
12. Public print-job board feeding the market's wanted board (exists) (M).
13. Reseller drop-shipping with settlement (L).
14. Design desk (M); licensed catalogue with royalty per print (L).

## 6. Not doing, and why

- AI chat first: cost and wrong answers; rules cover most of it.
- A slicer on the office VPS: standing rule, and upkeep.
- Controlling printers / farm automation: others do it well; not our lane.
- A full designer marketplace before there are buyers: empty shelves on both sides.
- Lucky draws: illegal without government authorisation.
- Dark patterns of any kind.

## 7. Open decisions (owner)

1. Does Costareen print for customers itself, or only pass print jobs to farms on the market?
2. Points: suggested 1 point per ৳100 paid, 1 point = ৳1 off; levels at ৳25,000 and ৳100,000
   spent in 12 months (today's rule: VIP at ৳50,000 or 5 orders).
3. Start with Group 1? (Recommended: it uses what exists and pays back first.)

## 8. Limits of this research

- RoboticsBD's quote tool and two other local pages refused to load; I know they exist, not how good they are.
- COD and loyalty figures are from vendor blogs.
- No customer of ours was asked. Ten short calls with real customers would beat any of the above.

## 9. Sources

Local market
- https://artin3dbd.com/3d-printing-in-bangladesh-2026-the-ultimate-beginners-guide/
- https://3dprint.robotics.com.bd/
- https://www.facebook.com/rh3dprintbd/
- https://www.electronics.com.bd/3d-printer-components/bambu-lab-a1
- https://www.robotonbd.com/bambu-lab-a1-3d-printer/
- https://store.roboticsbd.com/3d-printer/4035-350-bambu-lab-a1-3d-printer-robotics-bangladesh.html
- https://www.bdtronics.com/3d-print-your-name.html
- https://www.6wresearch.com/industry-report/bangladesh-3d-printing-filament-market
- https://www.thedailystar.net/youth/campus/news/how-bot-engineers-building-the-infrastructure-bangladeshi-robotics-needs-4218981

Cash on delivery, trust, resellers
- https://easysellapp.com/blogs/wiki/cod-ecommerce-pakistan-bangladesh-cash-collection-delivery-2026
- https://pathao.com/blog/avoid-courier-fraud-bangladesh/
- https://fraudbd.com/api-documentation
- https://github.com/AbiruzzamanMolla/Fraud-Checker-BD-Courier-Laravel
- https://bdnews24.com/business/bangladeshs-e-commerce-players-reel-from-scams.-can-they-win-back-trust
- https://shopup.org/
- https://futurestartup.com/2022/01/29/b2b-commerce-platform-mokam-seeks-to-strengthen-relationship-with-partners/
- http://bdlaws.minlaw.gov.bd/act-11/section-3113.html

Hobbyists, farms, pricing
- https://www.bgr.com/2093521/common-3d-printing-mistakes-beginners/
- https://www.xda-developers.com/dont-buy-3d-printer-until-read-this/
- https://jlc3dp.com/blog/why-not-buy-3d-printer
- https://www.makerhacks.com/3d-printing-reality/
- https://www.ardentworkshop.com/blog/how-to-price-3d-prints/
- https://filamentcheatsheet.com/blog/filament-price-surge-2026-tariffs/
- https://simplyprint.io/print-farms
- https://printago.io/
- https://www.3dque.com/autofarm3d-lite

Designers, AI models, communities
- https://forum.bambulab.com/t/unauthorized-sales-and-stolen-designs/69204
- https://www.tomshardware.com/3d-printing/makerworld-launches-copyright-protection-program-to-help-3d-designers-tackle-knockoffs
- https://3druck.com/en/programs/makerworld-introduces-commercial-licenses-for-3d-models-13144256/
- https://www.fabbaloo.com/news/etsy-policy-shift-may-disrupt-makers-and-3d-printing-services
- https://3dprinting.com/software-guides/ai-3d-model-generators/
- https://blog.bambulab.com/new-launch-of-makerlab-experiments/
- https://bambuhub.net/guides/makerworld-points-rewards
- https://www.printables.com/prusameter
- https://blog.prusa3d.com/flash-contests-two-years-anniversary_90777/

Loyalty and habit
- https://launchmystore.io/blog/ecommerce-loyalty-programs-customer-rewards
- https://amplitude.com/blog/the-hook-model
- https://shop.polymaker.com/products/panchroma-pla-refill-filament

Technical checks
- https://caniuse.com/mdn-api_barcodedetector
- https://github.com/GridSpace/grid-apps/wiki/Kiri:Moto
- https://filamentcolors.xyz/
