// The language of what the customer receives (invoice PDF): business_config
// 'doc_lang' = 'en' (default) or 'bn'. Only the printed labels change; names,
// products and figures stay as written. The PDF server has Noto Sans Bengali.

import { getConfig } from './ext.js';

const BN = {
  'INVOICE': 'ইনভয়েস', 'Paid in full': 'সম্পূর্ণ পরিশোধিত', 'Total due': 'মোট বাকি', 'Invoice no.': 'ইনভয়েস নং', 'Date': 'তারিখ',
  'Payment': 'পেমেন্ট', 'Delivery': 'ডেলিভারি', 'From': 'প্রেরক', 'Bill To': 'ক্রেতা', 'Deliver To': 'ডেলিভারির ঠিকানা',
  'Item Description': 'পণ্যের বিবরণ', 'Qty': 'পরিমাণ', 'Price': 'দাম', 'Discount': 'ছাড়', 'Total': 'মোট', 'Payment Details': 'পেমেন্টের তথ্য',
  'A/C name': 'হিসাবের নাম', 'A/C number': 'হিসাব নম্বর', 'Branch': 'শাখা', 'Note': 'নোট', 'Subtotal': 'সাবটোটাল', 'Item discounts': 'পণ্যে ছাড়',
  'Invoice discount': 'ইনভয়েস ছাড়', 'Paid': 'পরিশোধিত', 'Due': 'বাকি', 'Nothing due': 'কোনো বাকি নেই',
  'Thank you for your order.': 'আপনার অর্ডারের জন্য ধন্যবাদ।', 'Walk-in customer': 'সরাসরি ক্রেতা',
};
const PHRASES = [
  [' · warranty until ', ' · ওয়ারেন্টি পর্যন্ত '],
  ['any bank app, bKash,<br>Nagad or Rocket', 'যেকোনো ব্যাংক অ্যাপ, বিকাশ,<br>নগদ বা রকেট'],
];

export async function docLang(ctx) {
  const v = String((await getConfig(ctx, 'doc_lang', 'en')) || 'en').trim().toLowerCase();
  return v === 'bn' ? 'bn' : 'en';
}

/** Turn the printed labels of a document's HTML into Bangla. */
export function docBangla(html) {
  let s = String(html || '');
  for (const [a, b] of PHRASES) s = s.split(a).join(b);
  return s.replace(/>([^<>]{1,40})</g, (m, t) => {
    const k = t.trim();
    return BN[k] ? '>' + t.replace(k, BN[k]) + '<' : m;
  });
}
