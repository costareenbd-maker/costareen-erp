"""content-desk-ui-2 (21 Nov 2026): swap the Content desk page block in a page source (main web/app.html or the live page
source) for the redesigned one. Replaces content-desk-ui-1 (up to its C4 style) and removes the channels-1 block.
    python deploy/deskui2_page.py <app.html> <desk2.html>"""
import sys

path, block = sys.argv[1], open(sys.argv[2], encoding='utf-8').read().strip('\n') + '\n'
s = open(path, encoding='utf-8').read()
END = '<style>\n/* C4 (content-desk-ui-1)'
for start in ('<!-- content-desk-ui-2 (21 Nov 2026', '<!-- content-desk-ui-1 (19 Nov 2026)'):
    if start in s:
        i = s.index(start); j = s.index(END, i)
        s = s[:i] + block + s[j:]
        break
else:
    raise SystemExit('content desk block not found')
if '<!-- channels-1 (owner 21 Nov 2026' in s:
    i = s.index('\n<!-- channels-1 (owner 21 Nov 2026'); j = s.index('</script>\n', i) + len('</script>\n')
    s = s[:i] + '\n' + s[j:].lstrip('\n')
assert s.count('<!-- content-desk-ui-2 (21 Nov 2026') == 1 and 'window.cdxApi' not in s
open(path, 'w', encoding='utf-8', newline='\n').write(s)
print('content-desk-ui-2 in', path)
