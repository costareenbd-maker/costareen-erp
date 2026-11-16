"""shots-1: load the AI video engine pack into an ERP (erpVideoPackSet, platform admin).

The pack (VIDEO_RULES.md + the realism / physics lines of build_prompt.py) comes from the owner's paid course, and this
repository is public - so the pack is never committed. It stays on the owner's PC (G:\\ai-video-course\\engine) and this
script sends it to the ERP, which keeps it in erp_provider_secrets (VIDEO_PACK). Without it the ERP uses the short
fallback rules in lib/shots.js.

Usage (Git Bash):
  ERP_API=https://<dev api>/functions/v1/erp ERP_KEY=<platform admin owner key> python deploy/video_pack_upload.py [engine dir]
"""
import ast, hashlib, json, os, pathlib, sys, urllib.request

ENGINE = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else r'G:\ai-video-course\engine')
api, key = os.environ.get('ERP_API', ''), os.environ.get('ERP_KEY', '')
if not api or not key:
    sys.exit('Set ERP_API and ERP_KEY (a platform admin owner key).')
rules = (ENGINE / 'VIDEO_RULES.md').read_text(encoding='utf-8')
consts = {}
for node in ast.parse((ENGINE / 'build_prompt.py').read_text(encoding='utf-8')).body:
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in ('REALISM', 'PHYSICS'):
        consts[node.targets[0].id] = ast.literal_eval(node.value)
version = 'pack-' + hashlib.sha256((rules + json.dumps(consts, sort_keys=True)).encode()).hexdigest()[:8]
body = {'name': 'erpVideoPackSet', 'args': [{'rules': rules, 'realism': consts.get('REALISM', ''), 'physics': consts.get('PHYSICS', ''), 'version': version}],
        'token': {'key': key, 'device': 'video-pack-upload'}}
req = urllib.request.Request(api, data=json.dumps(body).encode(), headers={'content-type': 'application/json', 'user-agent': 'erp-video-pack'})
with urllib.request.urlopen(req, timeout=60) as r:
    out = json.loads(r.read().decode('utf-8'))
print(json.dumps(out)[:400] if not out.get('ok') else 'loaded ' + out['result']['pack'])
