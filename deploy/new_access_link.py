"""Make the first access link on the live system, for the owner of the business."""
import base64, hashlib, json, os, secrets, sys, urllib.request
REF = 'oqzcuuytytqadqjlwdsh'
BIZ = '81e318e7-fbde-4fcc-9b9f-b0061fe29c14'

def q(sql):
    req = urllib.request.Request('https://api.supabase.com/v1/projects/%s/database/query' % REF, method='POST',
        headers={'Authorization': 'Bearer ' + os.environ['SUPABASE_ACCESS_TOKEN'], 'Content-Type': 'application/json', 'User-Agent': 'costareen-deploy'},
        data=json.dumps({'query': sql}).encode())
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode() or '[]')

label = sys.argv[1] if len(sys.argv) > 1 else 'Owner'
owner = q("select user_id from memberships where business_id = '%s' and role = 'owner' order by created_at limit 1" % BIZ)[0]['user_id']
key = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip('=')
h = hashlib.sha256(key.encode()).hexdigest()
q("insert into erp_access_keys (key_hash, user_id, label) values ('%s', '%s', '%s')" % (h, owner, label.replace("'", "''")))
print('https://erp.costareen.com/#k=' + key)
