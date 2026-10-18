# Bangla (bn-BD) glossary and style rules for the ERP

Audience: shopkeepers and sales staff in Bangladesh, not accountants.
Goal: the words they already say at the counter and see in TallyKhata, bKash, and courier panels. The goal is not textbook Sadhu Bangla, and it is not machine translation.

Source key (full URLs at the bottom):
- **[TK]** TallyKhata, the Bangla bookkeeping app with over 1M shopkeepers
- **[AOSP]** Android/Google Bangla strings
- **[MOZ]** Mozilla bn-BD style guide (based on the Ankur Bangla rules)
- **[JOOM]** Joomla Bengali style guide
- **[NBR]** National Board of Revenue VAT gazette
- **[EDU]** Bangladesh school accounting terms (sattacademy, teachers.gov.bd)
- **[ERPN]** ERPNext/Frappe bn.csv
- **[SF]** Steadfast courier
- **[BIK]** Bikroy software listings in Bangla

Caution on [ERPN]: the ERPNext/Frappe Bangla file is largely machine translated, so it is used only as a counter-example. Examples of its errors:
- Balance → ভারসাম্য (means equilibrium)
- Unpaid → অবৈতনিক (means honorary/unsalaried)
- Filter → ছাঁকনি (a kitchen sieve)
- Buying Settings → রাজধানীতে সেটিংস ("settings in the capital")
- Logout → ত্যাগ করুন

Odoo ships no Bangla file for accounting: `addons/account/i18n` has no bn.po.

---

## 1. Style rules

1. **Address the user as আপনি** and use polite verb forms: করুন, দিন, লিখুন, বেছে নিন [MOZ][JOOM]. Write in Cholito (spoken standard) Bangla, never Sadhu [MOZ].
2. **Buttons use the verb + করুন form when the label is a phrase**, for example "সেভ করুন", "পরীক্ষা করুন", "লোগো আপলোড করুন". A **single-word** button can be the bare word when it is a fixed UI convention: বাতিল, কপি, প্রিন্ট, খুলুন, মুছুন. Do not mix the two in one dialog.
   - Use **সেভ করুন**, not সংরক্ষণ করুন. Google's own Bangla Contacts app uses "সেভ করুন" [AOSP], and the loanword is what staff say. সংরক্ষণ is correct but bookish.
3. **Prefer the word shopkeepers already use, including English loanwords written in Bangla script**, when a pure Bangla word sounds odd or is ambiguous [MOZ][JOOM]. TallyKhata writes কাস্টমার, সাপ্লায়ার, স্টক, পেমেন্ট, and uses বাকি, খরচ, কেনা, বেচা, দেনা-পাওনা [TK]. Avoid machine-made "pure" words such as ছাঁকনি, প্রক্রিয়াকরণ, or ভারসাম্য.
4. **Keep in English (Latin letters):**
   - brand, product, and service names: Steadfast, bKash, Nagad, WhatsApp, Google Drive, WooCommerce, Shopify, WordPress
   - codes and file types: SKU, PDF, CSV, API, JSON, QR, RMB, USD
   - invoice and consignment numbers (INV-1001), technical keys (`next_invoice_num`, `ck_`, `cs_`), URLs
   - examples the user must type exactly, such as the date format 2026-10-05

   [MOZ]: brand names are never translated, and abbreviations stay as they are.

   Never insert the owner's brand name ("Costareen") where the English says "ERP". The app is multi-tenant, so other shops use it too.
5. **Digits:**
   - Use Bangla digits ০-৯ in Bangla sentences and labels, money included: "৳১,২৫০", "১১ সংখ্যা", "৩০ দিন". TallyKhata's Bangla pages use Bangla numerals throughout ("৩০ মিনিটে", "১০ লাখের") [TK]. Android's Bangla strings write fixed numbers in Bangla digits ("১০", "৯৯৯+") [AOSP].
   - Keep Latin digits inside codes, phone numbers shown in input fields, invoice and consignment numbers, and typed-format examples.
   - Group numbers the South Asian way: ১২,৩৪,৫৬৭ [MOZ].
   - Numbers that arrive through patterns ($1) are in Latin digits today. Converting them is a code job (see REVIEW.md), not a translation job.
   - **Evidence gap:** the Bangla pages of bKash and Nagad returned HTTP 403, so their digit style could not be checked here.
6. **Currency:** use the symbol **৳** before figures in tables and totals, as in ৳৫০০. In sentences write **টাকা** after the number: "৫০০ টাকা". English "TK" or "Tk" becomes টাকা. Use BDT only in exports or English documents. [MOZ] lists টাকা / ৳ / BDT.
7. **Dates:**
   - Display dates as "১২ জুন ২০২৬", or ১২/০৬/২০২৬ in tables (dd/mm/yyyy) [MOZ].
   - When the user must type a date, show the machine format exactly, for example 2026-10-05.
   - The week starts on শনিবার in business use. [MOZ] lists রবিবার as the first day and শুক্রবার as the day off; follow the app's existing calendar.
8. **Punctuation:**
   - End a sentence with **দাঁড়ি (।)**, not a full stop [MOZ].
   - Commas, colons, question marks, and quotation marks are the same as in English.
   - Labels and buttons have no দাঁড়ি.
   - Use "—" for a dash.
9. **Plurals and "(s)":**
   - Do not copy "(s)". A number followed by the classifier **টি** (things) or **জন** (people) is already plural-neutral: "৩টি পার্সেল", "২ জন গ্রাহক".
   - Do not add -গুলো or -সমূহ after a number.
   - When the number is printed by code before a static label ("5 parcel(s) to send"), the label must not start with টি. The code inserts a space, so you would get "৫ টি". Write the noun only: "পার্সেল পাঠাতে হবে".
10. **Placeholders** ($1, $2, …) must all survive translation. Their order may change to fit Bangla word order (verb last).
11. **One English word gets one Bangla word.** If a Bangla word is already used for another concept (বাকি = due), do not reuse it for a different English word (Pending ≠ বাকি).
12. **Avoid** school-maths or legal words that staff do not use at work:
   - ঋণাত্মক → use "০-এর কম"
   - বিক্রীত/বিক্রিত → use "বিক্রি হওয়া"
   - -সমূহ → drop it
   - পরিচালন খরচ → use চলতি খরচ
   - মিটমাট (settling a dispute) → use "হিসাব মেটানো" for money
   - বিরোধ → use "সেভ হয়নি:"

---

## 2. Core vocabulary

"Loanword?" says when the English word written in Bangla script is the better choice.

| English | Bangla (house choice) | Alternative | Note / loanword? | Source(s) |
|---|---|---|---|---|
| invoice | **ইনভয়েস** | ক্যাশ মেমো (printed shop memo) | Loanword chosen. NBR's formal term is (মূসক) চালানপত্র and ERPNext uses চালান, but in shops চালান also means a goods consignment or delivery challan, so it is ambiguous. Use চালানপত্র only on a legal VAT form (Mushak-6.3). | [NBR] [ERPN] [BIK] |
| bill (utility/supplier) | **বিল** | — | Same word in all sources. | [ERPN] [SF] |
| receipt (proof of payment) | **রসিদ** | — | Not প্রাপ্তি (machine translation in ERPNext). | [ERPN] |
| due / owed by customer | **বাকি** | পাওনা (from the shop's side) | The word every shopkeeper uses. Do not use বকেয়া, which is formal. | [TK] |
| you owe (payable) | **দেনা** | — | Pair with পাওনা, as in TallyKhata's দেনা-পাওনা. | [TK] [EDU] |
| paid | **পরিশোধিত** (status); **পরিশোধ** (action) | দেওয়া হয়েছে | Not প্রদত্ত. | [EDU] |
| partly paid | **আংশিক পরিশোধ** | — | | |
| unpaid | **অপরিশোধিত** | পরিশোধ হয়নি | Never অবৈতনিক (ERPNext error). | [ERPN] counter-example |
| advance | **অগ্রিম** | — | | [ERPN] (অগ্রিম) |
| deposit (into bank) | **জমা** | — | | [TK] |
| balance (account) | **ব্যালেন্স** | স্থিতি (formal) | Loanword: it is what bKash/Nagad users see. Never ভারসাম্য. For "balance still owed" use বাকি. | [ERPN] counter-example |
| refund (money back) | **টাকা ফেরত** | রিফান্ড | | |
| return (goods back) | **ফেরত** | রিটার্ন | Investor "return" (profit) stays **রিটার্ন** so the two never clash. | [EDU] (বিক্রয় ফেরত) |
| discount | **ছাড়** | ডিসকাউন্ট | Textbook word বাট্টা is too formal. | [EDU] [ERPN] |
| delivery charge | **ডেলিভারি চার্জ** | — | Loanword. Courier panels say this. | [SF] |
| cash on delivery | **ক্যাশ অন ডেলিভারি** | COD | Loanword. Keep "COD" when space is tight. | [SF] |
| courier | **কুরিয়ার** | — | | [SF] |
| parcel | **পার্সেল** | — | | [SF] |
| consignment (courier ID) | **কনসাইনমেন্ট** | — | Loanword. Steadfast calls it the "consignment ID". | [SF] |
| stock | **স্টক** | মজুদ (formal) | Loanword. | [TK] [ERPN] |
| in stock / out of stock | **স্টকে আছে / স্টক শেষ** (স্টকে নেই) | — | | |
| reorder (level) | **রিঅর্ডার (সীমা)** | আবার অর্ডার | ERPNext's পুনর্বিন্যাস স্তর is wrong: it means "re-arrangement". | [ERPN] counter-example |
| shipment (inbound from supplier) | **শিপমেন্ট** | মালের চালান | Changed from চালান to avoid clashing with invoice/challan. | [NBR] (চালানপত্র = invoice) |
| receive (goods) | **গ্রহণ** (স্টক গ্রহণ) | মাল বুঝে নেওয়া | Receive money = **আদায়** / পাওয়া. | |
| supplier | **সাপ্লায়ার** | সরবরাহকারী (formal, NBR) | Loanword, as TallyKhata uses. | [TK] [NBR] |
| purchase order | **সাপ্লায়ার অর্ডার** | ক্রয় আদেশ (formal) | | [ERPN] |
| customer | **গ্রাহক** | কাস্টমার | Kept গ্রাহক because it is already used consistently 30+ times and bKash/banks use it. কাস্টমার is equally fine. | [TK] (কাস্টমার) |
| product | **পণ্য** | প্রোডাক্ট, মাল (spoken) | NBR uses পণ্য. | [NBR] |
| item (line on a list) | **আইটেম** | | | [ERPN] |
| SKU / code | **SKU / কোড** | — | Keep "SKU" in Latin. | [MOZ] abbreviations |
| category | **ক্যাটাগরি** | শ্রেণি | | |
| brand | **ব্র্যান্ড** | — | | [ERPN] |
| unit (count) / unit of measure | **ইউনিট** / **পিস** | একক (formal) | একক দাম is stiff. Use **প্রতিটির দাম**. | |
| price | **দাম** | মূল্য (formal) | | [ERPN] (মূল্য) |
| cost (what we paid per unit) | **কেনা দাম** | ক্রয়মূল্য | Keep খরচ for *expenses*. "Cost" as খরচ was confusing in profit screens. | [TK] (কেনা) |
| landed cost | **আনার খরচসহ দাম** | পড়তা (trade word) | Explain once. পড়তা is common among importers but has no web source here. | — |
| selling price | **বিক্রির দাম** | বিক্রয়মূল্য | | |
| wholesale | **পাইকারি** | হোলসেল | | |
| profit | **লাভ** | মুনাফা (formal) | | [ERPN] (লাভ) |
| loss | **লোকসান** | ক্ষতি | | |
| gross profit | **মোট লাভ** | — | ERPNext's পুরো লাভ is a machine translation. | [ERPN] counter-example |
| net profit | **নিট লাভ** | — | ERPNext wrongly gives মোট লাভ for net. | [ERPN] counter-example |
| margin | **মার্জিন** | লাভের হার | | [ERPN] |
| expense | **খরচ** | ব্যয় (formal) | | [TK] [EDU] |
| fixed / recurring / one-off expense | **স্থায়ী / নিয়মিত / একবারের খরচ** | — | নির্দিষ্ট খরচ read as "specified expense". | [EDU] |
| capital | **মূলধন** | — | | [EDU] |
| investor | **বিনিয়োগকারী** | — | | |
| shareholder | **শেয়ারহোল্ডার** | — | Loanword. ভাগীদার (ERPNext) is unclear. | [ERPN] |
| owner | **মালিক** | — | | [ERPN] |
| manager | **ম্যানেজার** | — | | [ERPN] |
| amount (money) | **টাকা** (label), **টাকার অঙ্ক** (prompt) | — | Do not use bare অঙ্ক (which means a maths sum) or পরিমাণ (reserved for quantity). | |
| quantity | **পরিমাণ** | সংখ্যা | | [ERPN] |
| account (money) | **অ্যাকাউন্ট** (টাকার অঙ্ক) | হিসাব | Login account is also অ্যাকাউন্ট. Context makes it clear. | [AOSP] |
| bank | **ব্যাংক** | — | | [EDU] |
| cash | **ক্যাশ** (label) / **নগদ** (in sentences) | — | Both are used by shops. Payment method names stay as configured. | [TK] |
| transfer | **ট্রান্সফার** | স্থানান্তর (formal) | | |
| statement | **স্টেটমেন্ট** | হিসাব বিবরণী | Loanword. bKash shows "statement" to its users. | [bKash press] |
| ledger / book | **খাতা** | খতিয়ান (accounting term) | | [TK] [EDU] |
| report | **রিপোর্ট** | — | | [ERPN] |
| dashboard | **ড্যাশবোর্ড** | — | | |
| settings | **সেটিংস** | — | | [AOSP] [ERPN] |
| save | **সেভ করুন** | সংরক্ষণ করুন | | [AOSP] Contacts |
| cancel | **বাতিল (করুন)** | — | | [AOSP] |
| delete | **মুছুন** | — | | [AOSP] |
| strike out (keep, crossed through) | **কেটে দিন** / কাটা | — | Different from মুছুন: nothing is deleted. | |
| clear (empty a form) | **খালি করুন** | — | Do not reuse মুছুন. | |
| edit | **এডিট** | সম্পাদনা করুন | Android uses সম্পাদনা. For shop staff, এডিট is the shorter, commoner word. | [AOSP] |
| search | **খুঁজুন** | সার্চ | Not অনুসন্ধান. | [AOSP] Calendar |
| filter | **ফিল্টার** | — | Never ছাঁকনি. | [ERPN] counter-example |
| export / download | **এক্সপোর্ট / ডাউনলোড** | রপ্তানি (= goods export only) | Data import is **ইমপোর্ট**. Goods import is **আমদানি**. Keep them apart. | [AOSP] Contacts |
| print | **প্রিন্ট** | ছাপা | | |
| approve / allow | **অনুমতি দিন** | অনুমোদন | | [AOSP] |
| pending (waiting) | **অপেক্ষায়** | — | Never বাকি, which means due. | |
| month end / close month | **মাস বন্ধ** | মাস-শেষ হিসাব | | |
| settlement | **হিসাব মেটানো** | সেটেলমেন্ট | Not মিটমাট. | |
| joint stock / joint pool | **যৌথ পুল** | যৌথ স্টক | | |
| partner | **অংশীদার**; partnership **অংশীদারি** | পার্টনার | | |
| commission | **কমিশন** | — | | [ERPN] |
| warranty | **ওয়ারেন্টি** | — | | |
| serial number | **সিরিয়াল নম্বর** | ক্রমিক নং | | [ERPN] |
| repair | **মেরামত** | রিপেয়ার | | |
| labour (repair charge) | **মজুরি** | কাজের চার্জ | | |
| pre-order | **প্রি-অর্ডার** | আগাম অর্ডার | | |
| quotation | **কোটেশন** | — | ERPNext's উদ্ধৃতি means "a quote from a text" (wrong sense). | [ERPN] counter-example |
| follow-up / payment reminder | **ফলো-আপ**; due reminder **তাগাদা** | রিমাইন্ডার | TallyKhata names its reminder feature "Tagada Message". | [TK] |
| campaign | **ক্যাম্পেইন** | প্রচারণা | ERPNext's প্রচারাভিযান is too formal. | [ERPN] |
| inbox | **ইনবক্স** | — | | |
| lead | **লিড** | — | | [ERPN] |
| template | **টেমপ্লেট** | — | | |
| sync | **সিঙ্ক** | — | | [AOSP] |
| backup | **ব্যাকআপ** | — | | [AOSP] [ERPN] |
| sign in / sign out | **সাইন ইন / সাইন আউট** | লগইন | | |
| device | **ডিভাইস** | — | | [AOSP] |
| role | **পদ** | রোল | Not ভূমিকা: ERPNext's ভূমিকা means "part played / preface". | [ERPN] counter-example |
| permission | **অনুমতি** | অ্যাক্সেস | | [AOSP] |
| status | **অবস্থা** | স্ট্যাটাস | | |
| done (button) | **ঠিক আছে** | হয়ে গেছে | | [AOSP] |
| undo | **আগের মতো করুন** | পূর্বাবস্থায় ফেরান | | [AOSP] |
| run (a job) | **চালু করুন** | — | Not চালান, which is also the word for invoice/challan. | |
| conflict (someone else saved) | **সেভ হয়নি:** + reason | — | | |

---

## 3. Sources (all checked 19 Oct 2026)

- ERPNext Bangla translations (counter-evidence): https://raw.githubusercontent.com/frappe/erpnext/version-13/erpnext/translations/bn.csv
- Frappe Bangla translations: https://raw.githubusercontent.com/frappe/frappe/version-14/frappe/translations/bn.csv
- ERPNext translation process: https://docs.frappe.io/erpnext/translations
- Odoo accounting i18n folder (no bn.po present): https://github.com/odoo/odoo/tree/17.0/addons/account/i18n
- Mozilla bn-BD style guide (Ankur-derived): https://wiki.mozilla.org/L10n:Teams:bn-BD/StyleGuide
- Joomla Bengali style guide: https://docs.sandbox.joomla.org/Bengali_Style_Guide
- Android framework Bangla strings: https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/master/core/res/res/values-bn/strings.xml
- Android Contacts Bangla strings: https://raw.githubusercontent.com/aosp-mirror/platform_packages_apps_contacts/master/res/values-bn/strings.xml
- Android Calendar Bangla strings: https://raw.githubusercontent.com/aosp-mirror/platform_packages_apps_calendar/master/res/values-bn/strings.xml
- NBR gazette on মূসক-৬.৩ চালানপত্র / পণ্য স্থানান্তর চালানপত্র: https://www.dpp.gov.bd/bgpress/index.php/document/get_extraordinary/33982
- TallyKhata (Bangla home page): https://www.tallykhata.com/ ; English page: https://www.tallykhata.com/en/home-eng/ ; Daily Star on its Tagada feature: https://thedailystar.net/node/2097349
- School accounting terms (মূলধন, খতিয়ান, দেনাদার, পাওনাদার, ক্রয়/বিক্রয় ফেরত, বাট্টা): https://sattacademy.com/guide/হিসাব ; https://teachers.gov.bd/index.php/content/details/581807
- Steadfast courier terms (parcel, consignment ID, delivery charge, COD): https://www.steadfast.com.bd/terms-and-condition and https://www.steadfast.com.bd/terms-and-condition-in-bangla
- bKash statement feature (press): https://www.tbsnews.net/node/1205681
- Bikroy Bangla software listings (চালান, বিল, মেমো, ইনভয়েস side by side): https://bikroy.com/bn/computer-software/inventory-management

Could not be checked:
- bKash and Nagad Bangla pages returned HTTP 403.
- Google Play's Bangla listings came back empty.
- No Bangla text was found for the Daraz Seller Center, Pathao, Hishabee, or the Microsoft Language Portal.
