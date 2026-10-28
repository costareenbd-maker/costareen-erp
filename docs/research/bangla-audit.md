# Bangla UI text audit (ERP)

Date: 28 Oct 2026. Read-only audit of the English → Bangla dictionary in `web/app.html`, judged against the Oliareen store's Bangla research (`G:\starter-kit\starter-kit\docs\bangla-glossary.md`, `docs\copy-rules.md`, and the strings shipped in `frontend\src\lib\i18n.ts`).

Output: `bangla-audit.json` — English key → corrected Bangla, **only for entries that change**. Keys are copied from the parsed source, so they match byte for byte. `app.html` was not edited.

## Counts

| | Entries | Changed |
|---|---|---|
| Main table `var I18N_BN = {…}` (line 17833) | 2,179 | 413 |
| Add-on table `var W = {…}` merged into I18N_BN (line ~34816) | 51 | 12 |
| Late direct assignments `I18N_BN['Look']` etc. (line 40764) | 4 | 0 |
| **Total reviewed** | **2,234** | **425** |

About four in five entries were already natural and are left alone. Placeholders, numbers, HTML, brand names, URLs and leading/trailing spaces are unchanged in every edited value (checked by script).

## Rule of thumb used

Same as the store glossary (Mozilla bn-BD + Daraz/Pathao/bKash practice): address people as আপনি, write spoken-standard Bangla, and **keep the English office word in Bangla script when the "pure" Bangla is bookish**. In a Bangladeshi shop office people say *invoice, stock, supplier, courier, customer, partner, investor, receive, payment, return, refund, connect, user, role, delete* in English — so the ERP does too. Everyday Bangla words people really use stay Bangla (বাকি, লাভ, খরচ, দাম, খাতা, মূলধন, অগ্রিম, ছাড়, তাক, মেরামত).

## Term decisions

| English | Chosen Bangla | Was | Reason |
|---|---|---|---|
| Customer(s) | কাস্টমার | গ্রাহক (66 entries) | Office/shop speech, pairs with সাপ্লায়ার; store rule R15 bans গ্রাহক/ক্রেতা for customer-facing copy |
| Partner / Partnership | পার্টনার / পার্টনারশিপ | অংশীদার / অংশীদারি (15) | অংশীদার is legal register; owners say পার্টনার |
| Investor | ইনভেস্টর | বিনিয়োগকারী (20) | Bookish; বিনিয়োগ (investment) kept |
| Connect / Connected / Disconnect / Connections | কানেক্ট করুন / কানেক্টেড / ডিসকানেক্ট / কানেকশন | সংযুক্ত, যুক্ত, বিচ্ছিন্ন, সংযোগ (25+) | বিচ্ছিন্ন/সংযুক্ত are bookish; menu path "সেটিংস → কানেকশন" now matches the tab label everywhere |
| Delete | ডিলিট করুন | মুছুন, মুছে ফেলা (6) | Glossary: ডিলিট করুন, never মুছুন for records. মুছবেন kept for clearing typed text |
| Remove | বাদ দিন | সরান (19) | Store uses বাদ দিন for Remove; সরান kept for "move" and "unlink" |
| Choose / Select | বেছে নিন | বাছুন (6) | Glossary: never বাছুন |
| Clear (search/filter) | ক্লিয়ার করুন · সার্চ | খালি করুন, খোঁজ মুছুন | Glossary Search/Clear row |
| Receive (stock, orders) | রিসিভ | গ্রহণ (14) | Glossary never গ্রহণ; "মাল রিসিভ" is shop speech |
| Return / Returned / Refund | রিটার্ন / রিটার্ন হয়েছে / রিফান্ড | ফেরত (16) | Glossary: ফেরত is ambiguous. ফেরত kept where it means "give money back" to an investor |
| Paid / Unpaid / Part paid | পেমেন্ট হয়েছে / পেমেন্ট হয়নি / আংশিক পেমেন্ট | পরিশোধিত, অপরিশোধিত, পরিশোধ (18) | Glossary payment status; never পরিশোধিত |
| Grand total | মোট | সর্বমোট | Glossary Totals row |
| Status / State | স্ট্যাটাস | অবস্থা | Glossary: never অবস্থা for status ("কাটা অবস্থায়" = crossed out, kept) |
| Confirm | কনফার্ম করুন | নিশ্চিত করুন | Glossary (অর্ডার কনফার্ম করুন) |
| User(s) | ইউজার | ব্যবহারকারী (6) | Office speech; matches "Settings > Users" hints now written in Bangla |
| Role | রোল | পদ (8) | পদ means job title; the ERP roles are Sales/Manager/Owner |
| Fixed expense | ফিক্সড খরচ | স্থায়ী খরচ (10) | Textbook term vs what shop owners say |
| Adjustment | অ্যাডজাস্টমেন্ট | সমন্বয় | Stock-room speech |
| Reorder level | রিঅর্ডার লেভেল | রিঅর্ডার সীমা (7) | One term; the settings field already said লেভেল |
| Digits (phone, code) | ডিজিট | সংখ্যা (9) | Glossary OTP row: never সংখ্যা |
| Alerts | অ্যালার্ট | সতর্কবার্তা | Bookish |
| Activity log | অ্যাক্টিভিটি লগ | কার্যকলাপের তালিকা | Bookish |
| Invite | ইনভাইট | আমন্ত্রণ | আমন্ত্রণ reads as a wedding card |
| Deal (partner trade) | ডিল | চুক্তি | Glossary uses ডিল; চুক্তি kept for "agreed share/price" |
| Parts | পার্টস | যন্ত্রাংশ | Repair-shop speech |
| Cash | ক্যাশ | নগদ | নগদ is also the Nagad wallet — ambiguous on a payments screen |
| Help · Assistant | হেল্প · অ্যাসিস্ট্যান্ট | সাহায্য · সহকারী | Glossary: হেল্প; never সহকারী (store ships অ্যাসিস্ট্যান্ট) |
| Background photo | ব্যাকগ্রাউন্ড ছবি | পেছনের ছবি | "পেছনের ছবি" reads as "photo of the back" |
| Button | বাটন | বোতাম | বোতাম is a shirt button |
| Top products / colours / posts | বেশি বিক্রি হওয়া … / সবচেয়ে ভালো চলা পোস্ট | সেরা … | Copy rule R8: "best" only with a count; says what it measures |
| Customise | কাস্টমাইজ করুন | সাজান | সাজান is already "Sort" |
| Maintenance · Recovery · Processing · Analytics · Overview | মেইনটেন্যান্স · রিকভারি · প্রসেসিং · অ্যানালিটিক্স · ওভারভিউ | রক্ষণাবেক্ষণ · পুনরুদ্ধার · প্রক্রিয়াধীন · বিশ্লেষণ · সারসংক্ষেপ | Bookish menu labels |
| Run (a job) · Play | চালান | চালু করুন | চালু করুন = switch on |

Also fixed: buttons that were nouns made verb + object ("অনুমোদন" → "অনুমোদন দিন", "আবার চেষ্টা" → "আবার চেষ্টা করুন", "Reset" → "রিসেট করুন"); তুমি-form "থামাও" → neutral "থামবে"; banned-list word রূপান্তর removed (2 entries); "নকল করুন" (= counterfeit) → "ফলো করুন"; "Save draft/rules/key" → সেভ (was রাখুন) to match every other Save; Latin 01 → ০১ in phone hints; "বিনা খরচে / বিনা মূল্যে" → ফ্রি.

Kept on purpose: অনুমোদন (approve — natural, understood), অগ্রিম (advance), মূলধন, মেরামত, খসড়া, ঐচ্ছিক (store uses it), পণ্য (store uses পণ্য, so the 3 প্রোডাক্ট entries became পণ্য), বদলান for Change (the store ships it), সমুদ্রপথ/বিমানপথ, স্থগিত (suspend), ব্যর্থ.

## 25 before → after examples

| English key | Before | After |
|---|---|---|
| Delete | মুছুন | ডিলিট করুন |
| Choose a photo | একটি ছবি বাছুন | একটি ছবি বেছে নিন |
| Customers | গ্রাহক | কাস্টমার |
| Partnership | অংশীদারি | পার্টনারশিপ |
| Investors | বিনিয়োগকারী | ইনভেস্টর |
| Connections | সংযোগ | কানেকশন |
| Disconnect Google Drive? | Google Drive সংযোগ বিচ্ছিন্ন করবেন? | Google Drive ডিসকানেক্ট করবেন? |
| Receive stock | স্টক গ্রহণ | স্টক রিসিভ |
| Status | অবস্থা | স্ট্যাটাস |
| Grand total | সর্বমোট | মোট |
| Unpaid | অপরিশোধিত | পেমেন্ট হয়নি |
| Returned | ফেরত | রিটার্ন হয়েছে |
| Processing | প্রক্রিয়াধীন | প্রসেসিং |
| Maintenance | রক্ষণাবেক্ষণ | মেইনটেন্যান্স |
| Recovery | পুনরুদ্ধার | রিকভারি |
| Money alerts | টাকার সতর্কবার্তা | টাকার অ্যালার্ট |
| Role | পদ | রোল |
| Fixed | স্থায়ী | ফিক্সড |
| Type the 6 digits the app shows. | অ্যাপে দেখানো ৬ সংখ্যা লিখুন। | অ্যাপে দেখানো ৬ ডিজিটের কোড লিখুন। |
| Customise | সাজান | কাস্টমাইজ করুন |
| Pause when cost per result passes | প্রতি ফলের খরচ এর বেশি হলে থামাও | প্রতি ফলাফলের খরচ এর বেশি হলে থামবে |
| Enter the rate you paid (TK per RMB), so the prices can be turned into cost. | যে রেটে দিয়েছেন লিখুন (প্রতি RMB-তে টাকা), যাতে দাম খরচে রূপান্তর হয়। | যে রেটে দিয়েছেন লিখুন (প্রতি RMB-তে টাকা), যাতে দাম থেকে খরচ হিসাব করা যায়। |
| Message the assistant… | সহকারীকে লিখুন… | অ্যাসিস্ট্যান্টকে লিখুন… |
| Copy this | এটি নকল করুন | এটা ফলো করুন |
| Top products | সেরা পণ্য | বেশি বিক্রি হওয়া পণ্য |
## Not covered / follow-ups

- **Pattern table `I18N_PAT` (line 17834, ~490 regex entries) is outside this file** because its keys are regexes, not dictionary keys. About 40 of its Bangla templates still use the old words (গ্রাহক, বিনিয়োগকারী, গ্রহণ, সমন্বয়, অর্জিত, রিঅর্ডার সীমা, যুক্ত). Give it the same term pass so a screen does not show "কাস্টমার" in a label and "গ্রাহক" in the sentence under it.
- `Overview` and `Done` in the add-on table are dead (the main table already has them), so they were not edited.
- `Look` and `Clean` are overwritten at runtime by line 40764 (`চেহারা`, `ক্লিন`); the main-table values for those keys never show.
- A business's own Bangla words (Settings › Bangla words, `BN_OWN`) still win over these, as before.
- English values left in Latin inside Bangla (e.g. "Owner? Sign in with email", "Active / Discontinued", "Business Suite → Settings → Ad accounts") are literal labels of English-only screens or third-party menus, so they stay.
