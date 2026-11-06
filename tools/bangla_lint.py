#!/usr/bin/env python3
"""Bangla copy lint for the ERP (F5, 6 Nov 2026). Rules: docs/bangla/GLOSSARY.md section 0.

Looks only at string literals that contain Bangla letters (the page dictionary I18N_BN, L(en, bn) pairs, BN = {...}
blocks, server copy, AI prompts). It never sees people's own words: those are data at runtime, not literals.

  tumi     তুমি / তোমার forms and তুমি-imperatives (পাঠাও, বদলাও, লেখো ...)   -> error
  banned   words the glossary bans (পণ্য per D7, ভারসাম্য, বকেয়া, সংরক্ষণ ...) -> error
  english  English words left inside a Bangla string (brand names, codes allowed) -> warning (errors with --strict)

Usage:  python tools/bangla_lint.py [paths...] [--only tumi,banned,english] [--strict] [--max N]
        no paths = web/*.html, web/*.js and supabase/functions/erp/**/*.js
A line that must keep a flagged word (for example a prompt that says "never use তুমি") ends with: bangla-lint: ok
Exit code 1 when an error (or, with --strict, a warning) is found.
"""
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT = ['web/*.html', 'web/*.js', 'supabase/functions/erp/*.js', 'supabase/functions/erp/*.ts',
           'supabase/functions/erp/handlers/*.js', 'supabase/functions/erp/lib/*.js']
SKIP = re.compile(r'(^|[\\/])(index|index-local|index-dev)\.html$|[\\/]legacy[\\/]|\.min\.')

BN = 'ঀ-৿'
HAS_BN = re.compile('[অ-হড়-য়]')   # Bangla letters (not ৳ or digits alone)
# a Bangla "word" boundary: not preceded / followed by another Bangla letter or sign
def W(word):
    return re.compile('(?<![' + BN + '])' + word + '(?![' + BN + '])')

TUMI = [W(w) for w in [
    'তুমি', 'তোমার', 'তোমাকে', 'তোমায়', 'তোমরা', 'তোমাদের', 'তুই', 'তোর',
    'করো', 'দাও', 'পাঠাও', 'বদলাও', 'লেখো', 'দেখো', 'দেখাও', 'খোলো', 'রাখো', 'চাপো', 'যাও', 'বলো',
    'ফেরাও', 'মোছো', 'খোঁজো', 'চালাও', 'বানাও', 'জানাও', 'শোনো', 'পড়ো', 'থামো', 'এসো', 'লাগাও', 'সাজাও',
    'মেলাও', 'ভরো', 'ধরো', 'ছাড়ো', 'তোলো', 'বসাও', 'বোঝাও', 'শেখাও', 'ঘোরাও', 'সরাও', 'ফেলো', 'চেনো', 'আনো',
    'কেনো', 'বেচো', 'গোনো', 'মেটাও', 'ঢোকাও', 'বাড়াও', 'কমাও', 'লুকাও', 'ছাপাও', 'থাকো', 'ভাবো', 'চেষ্টা করো',
]] + [re.compile('(?<![' + BN + '])নাও(?![' + BN + '])(?! হ)')]   # "নাও হতে পারে" (may not) is not a তুমি form
# word -> what to say instead (glossary sections 1 and 2, eval-clarify.md section 3, D7)
BANNED = {
    'পণ্য': 'প্রোডাক্ট (D7)', 'ভারসাম্য': 'ব্যালেন্স', 'অবৈতনিক': 'অপরিশোধিত / বাকি', 'ছাঁকনি': 'ফিল্টার',
    'বকেয়া': 'বাকি', 'প্রদত্ত': 'পরিশোধিত / দেওয়া', 'উদ্ধৃতি': 'কোটেশন',
    'পুনর্বিন্যাস': 'রিঅর্ডার', 'প্রচারাভিযান': 'ক্যাম্পেইন', 'ঋণাত্মক': '০-এর কম',
    'পরিচালন খরচ': 'চলতি খরচ', 'মিটমাট': 'হিসাব মেটানো', 'অনুসন্ধান': 'খুঁজুন',
    'মাসিক আয়': 'এ মাসের বিক্রি', 'এ মাসের আয়': 'এ মাসের বিক্রি', 'ত্যাগ করুন': 'সাইন আউট',
}
BANNED_RX = [(re.compile('(?<![' + BN + '])' + k), k, v) for k, v in BANNED.items()]
BANNED_RX += [
    (re.compile('সমূহ'), 'সমূহ', 'drop it'),
    # বিক্রিতে (in the sale) is fine; only the bookish adjective বিক্রিত / বিক্রীত is banned
    (re.compile('(?<![' + BN + '])বিক্র[িী]ত(?![' + BN + '])'), 'বিক্রিত', 'বিক্রি হওয়া'),
    # সংরক্ষণ as "save" (a button, "সংরক্ষণ করুন", "সংরক্ষণ হচ্ছে"); storage advice (সংরক্ষণ: ...) is fine
    (re.compile('(?<![' + BN + '])সংরক্ষণ(?= কর| হ|$)'), 'সংরক্ষণ', 'সেভ'),
]

# Latin words allowed inside Bangla copy: brands, products, codes, units, keys people press (glossary rule 4)
ALLOW = set('''
whatsapp steadfast bkash nagad rocket upay google drive gmail sheets woocommerce shopify wordpress chatgpt gemini openai
claude facebook instagram messenger youtube tiktok telegram excel pathao redx paperfly carrybee daraz meta pinterest
erp ai pdf sku csv api json qr rmb usd bdt url sms otp ok id wifi ssl seo html css png jpg jpeg webp gif mp4 stl gcode
esc enter tab ctrl shift alt cmd del costareen filadash bambu bambulab creality elegoo anycubic prusa esun sunlu pla
petg abs tpu asa resin oliareen postiz immich shlink umami kanboard memos karakeep miniflux listmonk authentik twenty
scriberr opencut openshorts n8n matrix pagespeed lighthouse alt meta title sitemap robots h1 www http https com bd
gpt luna terra sol mcp vps mac windows android iphone ios chrome edge firefox safari zernio uploadpost cloudflare
supabase github ssh ip dns otp tk kg mm cm ml gb mb kb linkedin vaultwarden
'''.split())
LATIN = re.compile(r"(?<![A-Za-z0-9_./@-])[A-Za-z][A-Za-z']{2,}(?![A-Za-z0-9_@-])")
STRIP = [re.compile(p) for p in [r'<[^>]*>', r'^[^<>]*>', r'<[^<>]*$', r'[\w-]+="[^"]*"?', r'\$\{[^}]*\}', r'https?://\S+', r'&[a-z]+;', r'\$\d', r'\{[a-z_]+\}',
                                 r'[\w.-]+@[\w.-]+', r'[A-Za-z_]+\.[A-Za-z_.]+', r'#[A-Za-z_-]+']]

LIT = re.compile(r"'(?:[^'\\\n]|\\.)*'|\"(?:[^\"\\\n]|\\.)*\"|`(?:[^`\\]|\\.)*`")
OK_MARK = 'bangla-lint: ok'


def literals(line):
    for m in LIT.finditer(line):
        s = m.group(0)[1:-1]
        if HAS_BN.search(s):
            yield m.start(), s


def english_words(s):
    # an English sentence that quotes Bangla (an AI prompt, a code comment) is English copy, not a Bangla string
    if len(re.findall('[A-Za-z]', s)) > len(HAS_BN.findall(s)):
        return []
    for rx in STRIP:
        s = rx.sub(' ', s)
    out = []
    for w in LATIN.findall(s):
        lw = w.lower().strip("'")
        if lw in ALLOW or (w.isupper() and len(w) <= 6):
            continue
        out.append(w)
    return out


def lint_file(path, only):
    found = []
    try:
        text = open(path, encoding='utf-8').read()
    except (OSError, UnicodeDecodeError):
        return found
    for n, line in enumerate(text.split('\n'), 1):
        if OK_MARK in line or not HAS_BN.search(line):
            continue
        for col, s in literals(line):
            if 'tumi' in only:
                for rx in TUMI:
                    for m in rx.finditer(s):
                        found.append(('error', 'tumi', n, col + m.start(), m.group(0), 'আপনি form (করুন, দিন, পাঠান ...)', s))
            if 'banned' in only:
                for rx, k, v in BANNED_RX:
                    for m in rx.finditer(s):
                        found.append(('error', 'banned', n, col + m.start(), k, v, s))
            if 'english' in only:
                ws = english_words(s)
                if ws:
                    found.append(('warning', 'english', n, col, ' '.join(dict.fromkeys(ws)), 'say it in Bangla, or allow it in ALLOW if it is a name', s))
    return found


def snippet(s, word):
    i = s.find(word.split(' ')[0])
    i = max(0, i - 30)
    return s[i:i + 90].replace('\n', ' ')


def main(argv):
    only, strict, mx, paths = {'tumi', 'banned', 'english'}, False, 0, []
    it = iter(argv)
    for a in it:
        if a == '--only':
            only = set(next(it).split(','))
        elif a == '--strict':
            strict = True
        elif a == '--max':
            mx = int(next(it))
        else:
            paths.append(a)
    files = []
    for p in paths or [os.path.join(ROOT, g) for g in DEFAULT]:
        if os.path.isdir(p):
            files += glob.glob(os.path.join(p, '**', '*.*'), recursive=True)
        else:
            files += glob.glob(p) or [p]
    files = sorted(f for f in set(files) if not SKIP.search(f) and f.endswith(('.html', '.js', '.mjs', '.ts', '.py')))
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    errors = warnings = 0
    shown = 0
    for f in files:
        for level, rule, n, col, word, fix, s in lint_file(f, only):
            if level == 'error':
                errors += 1
            else:
                warnings += 1
            if mx and shown >= mx:
                continue
            shown += 1
            rel = os.path.relpath(f, ROOT).replace('\\', '/')
            print('%s:%d:%d %s %s: "%s" -> %s   | %s' % (rel, n, col + 1, level, rule, word, fix, snippet(s, word)))
    print('bangla_lint: %d error(s), %d warning(s) in %d file(s)' % (errors, warnings, len(files)))
    return 1 if errors or (strict and warnings) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
