# Review of the current Bangla (19 Oct 2026)

Reviewed:
- all 1,273 entries in `current_bn.json`
- all 333 templates in `current_bn_patterns.json`

They were checked against `GLOSSARY.md` and against plain spoken Bangla.

Output:
- `corrections.json`: **124 entries** to change, about 10% of the file.
- `pattern_corrections.json`: **20 templates** to change, about 6%.

Every key is byte-identical to the source, both files parse as JSON, and every changed template keeps exactly the same set of $n placeholders (checked by script).

## Overall verdict

The current Bangla is **not machine translation**:
- It is mostly natural spoken Bangla.
- It uses আপনি and করুন correctly.
- It writes দাঁড়ি.
- It writes Bangla digits.
- It keeps brands and codes in English.
- It is consistent for most core words: ইনভয়েস 81 times, বাকি, স্টক, সাপ্লায়ার, গ্রাহক, পণ্য, সেভ.

That is better than ERPNext's Bangla file, which is plainly machine-made. The problems are a set of **specific wrong or ambiguous word choices that repeat**, plus loose ends. These are what make it read "not quite right".

## Top problems, with examples

1. **"অঙ্ক" for amount of money** (19 places). অঙ্ক means a maths sum or digit. Examples:
   - "একটি অঙ্ক লিখুন"
   - Amount column "অঙ্ক"
   - "বড় অঙ্ক আগে"

   Labels now say **টাকা**, and prompts say **টাকার অঙ্ক** ("০-এর বেশি টাকা লিখুন").

2. **One Bangla word for two different things:**
   - *Pending* (courier status) was **বাকি**, the same word as *Due*. A parcel "বাকি" and an invoice "বাকি" meant different things on the same screen. Pending is now **অপেক্ষায়**.
   - *Run* (a job) was **চালান**, which is also the shopkeeper and NBR word for invoice/challan. It is now **চালু করুন**.
   - *Clear* (form) was **মুছুন**, the same as *Delete*. It is now **খালি করুন**.
   - *Attached* was **সংযুক্ত**, the same as *Connected*. It is now **যুক্ত**.

3. **"চালান" for supplier shipment** (9 entries and 2 patterns). NBR's legal word for a VAT invoice is চালানপত্র (Mushak-6.3), and many shops call a delivery challan চালান. In an app that prints invoices, this is a real risk of confusion. Shipment is now **শিপমেন্ট**.

4. **"Cost" written as খরচ (expense).** On the profit screens, "Cost", "Cost each", "Product cost", "The goods cost", and "Cost of goods sold" all read as *expenses*. They now read **কেনা দাম**: "বিক্রি হওয়া পণ্যের কেনা দাম". খরচ is kept for real expenses.

5. **Stiff, bookish or literal words:**
   - ঋণাত্মক (negative) → "০-এর কম"
   - পরিচালন খরচ → চলতি খরচ
   - ব্যবসাসমূহ → ব্যবসা
   - বিরোধ for CONFLICT → "সেভ হয়নি:"
   - মিটমাট (making up a quarrel) for settling money → "হিসাব মেটানো"
   - "দরজা বন্ধ" ("door is shut", literal) → plain meaning
   - "এই ডিভাইস ভুলে যাবেন?" ("forget", literal) → "সরিয়ে দেবেন?"
   - "চেহারা" for Appearance → "দেখার ধরন"
   - "কিছুতে মনোযোগ লাগবে না" → "সব ঠিক আছে"
   - "শেষ মনে করানো" → **শেষ তাগাদা** (TallyKhata's own word)

6. **Role = ভূমিকা** (4 places). This is the ERPNext/Frappe machine word ("part played / preface"). It is now **পদ**.

7. **Fixed expense = নির্দিষ্ট খরচ** (which reads as "specified expense"). It is now **স্থায়ী খরচ**, the school accounting term, in 9 places.

8. **Buttons left as bare nouns where the label is a phrase.** Examples:
   - "লোগো আপলোড"
   - "পরিবর্তন সেভ"
   - "সেভ করে পরীক্ষা"
   - "স্থগিত"
   - "আমন্ত্রণ"
   - "এখনই ব্যাকআপ"

   These now end in করুন, জানান, পাঠান or নিন.

9. **Owner's brand inserted where the English says "ERP"**: "Costareen সিঙ্ক প্লাগইন", "Costareen ওয়েবসাইট প্লাগইন". The ERP is meant for other businesses too (CLAUDE.md §1), so these now say ERP.

10. **Grammar and loose ends:**
    - "না-সেভ করা" → "সেভ না করা"
    - "ইস্যুর তারিখ বা পরে" → "ইস্যুর তারিখে বা তার পরে"
    - "অগ্রিম কীভাবে দিল" → "দেওয়া হলো"
    - "ইনভয়েস ৩০দি" (made-up abbreviation) → "ইনভয়েস (৩০ দিন)"
    - "টি পার্সেল পাঠাতে হবে": the label started with টি after a number printed by code, which gives "৫ টি". Now "পার্সেল পাঠাতে হবে".
    - "Customer pickup" was left untranslated. Now "গ্রাহক নিজে নেবেন", matching "Pickup".

11. **Patterns:**
    - #46 dropped the instruction "Check next_invoice_num in SETTINGS". It is now added back.
    - #49 (pickup) reworded.
    - #87 now matches the renamed button "বাকি আদায় / ঠিক করুন".
    - #74, #96, #108 and #306 follow the term changes above.

## Counts by kind (approximate; some entries fit two kinds)

| Kind | Entries | Patterns |
|---|---|---|
| amount / অঙ্ক | 15 | 4 |
| term clash (Pending, Run, Clear, Attached, Role) | 9 | 1 |
| shipment চালান → শিপমেন্ট | 8 | 2 |
| cost → কেনা দাম | 9 | 0 |
| fixed → স্থায়ী | 9 | 0 |
| stiff / literal wording | about 30 | 5 |
| button verb form | about 15 | 0 |
| grammar / missing content / brand | about 15 | 8 |

## Left alone on purpose

- **গ্রাহক** for customer. TallyKhata writes কাস্টমার, but গ্রাহক is used consistently and is understood everywhere. Not worth 34 changes.
- **এডিট**, not সম্পাদনা (Android's word): এডিট is shorter and commoner with shop staff.
- **সেভ করুন**, not সংরক্ষণ করুন: Google's Bangla Contacts app uses সেভ করুন.
- **ক্যাশ অন ডেলিভারি**, **কনসাইনমেন্ট**, **ডেলিভারি চার্জ**: these are the courier industry's own words.
- English values that are data, not labels, such as "Status must be Active or Discontinued" and "(Cash, bKash...)", stay in English. They must match what the user picks.

## Needs a developer, not a translator

1. **Digits from patterns stay Latin.** Static text uses ০-৯, but every $1 that captures a number arrives as 0-9. The same screen shows "৩০ দিন" and "30 দিন". Fix this in the translate function: convert digits in captured numbers, except captures that are codes, phones or invoice numbers. The glossary rule is Bangla digits in Bangla text.
2. **Pattern #310** `^Group\ (.+?)\ famil(.+?)\?$` → `$1 ফ্যামিলি গ্রুপ করবেন?$2`. Here `$2` captures the English suffix "y"/"ies", so the Bangla shows "…করবেন?y". The brief says to keep every placeholder, so it is **not** changed in pattern_corrections.json. The right fix is to drop `$2` from the template, or make that group non-capturing: `famil(?:y|ies)`.
3. **Entry "Website sync key not set. Run "Setup Website Sync" from the menu first."** The Bangla says "set it in Settings → Connections" instead. That is probably correct for the web ERP, where the sheet menu item does not exist, but the English and Bangla disagree. Fix the English, or confirm.
4. **Number + label pieces** ("parcel(s) to send", "campaign(s) working by themselves", "One logo for" + "this business") are sentence fragments joined by code. Bangla word order (verb last) does not always fit. Full-sentence templates would read better.

## Where I was unsure, or the evidence was thin

- **bKash, Nagad and Daraz Bangla UIs could not be read.** Their Bangla pages returned HTTP 403 or empty Play Store listings. So the choice of Bangla digits for money rests on TallyKhata, Android and Mozilla, not on the payment apps. If the owner sees bKash showing Latin digits on his phone, switch only the money format and keep the rest.
- **Landed cost.** "আনার খরচসহ" (kept) and the trade word **পড়তা** are both natural. I found no written source for পড়তা, so it is in the glossary as an alternative only.
- **"Lands at" → "আনার পর দাম"** and the price-book column **"In" → "আসা"** (left unchanged): I could not tell from the text alone what "In" holds. Check it on screen.
- **পদ vs রোল for Role.** পদ is natural for Owner/Manager/Sales. Some staff may know "রোল" from other apps.
- **Fixed = স্থায়ী.** This is right for rent and salary, but "স্থায়ী" can also suggest "permanent". The label's sub-line ("প্রতি মাসে একই") makes it clear.
- I did not read app.html, so terms were judged from the English key alone. A few short labels (Sell, Open, Lines, Type) could need a different form once seen in place.
