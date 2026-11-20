"""channels-1: put the hooks and the channels-1 block into a page source (main web/app.html or the live page source).
    python deploy/channels1_page.py <app.html> <block.html>"""
import os, sys, importlib.util

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('h', os.path.join(here, 'channels1_hooks.py'))
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
path, block = sys.argv[1], open(sys.argv[2], encoding='utf-8').read()
h.apply(path)
s = open(path, encoding='utf-8').read()
if '<!-- channels-1 (owner 21 Nov 2026' in s:
    i = s.index('\n<!-- channels-1 (owner 21 Nov 2026'); j = s.index('</script>\n', i) + len('</script>\n')
    s = s[:i] + s[j:]
k = s.rindex('</body>')
s = s[:k].rstrip('\n') + '\n' + block.strip('\n') + '\n' + s[k:]
open(path, 'w', encoding='utf-8', newline='\n').write(s)
print('block in', path)
