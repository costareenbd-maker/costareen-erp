"""Sign-in accounts for the web ERP, from this computer - no e-mail needed.

    1  Set a password for an account (typed hidden here, never shown or saved)
    2  Make a one-time "set your password" link for an account (send it by WhatsApp)

Run from "Costareen - accounts.cmd" on the Desktop, or:
    cd deploy; source secrets.env; python accounts.py
Needs SUPABASE_ACCESS_TOKEN (secrets.env). Staff accounts are made in the ERP first
(Settings > Users > invite: name, e-mail, role); this tool then gives them their link.
"""
import getpass, json, os, sys, urllib.request, urllib.error

REF = 'oqzcuuytytqadqjlwdsh'
URL = 'https://%s.supabase.co' % REF
SITE = 'https://erp.costareen.com'


def req(url, method='GET', body=None, headers=None):
    r = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                               headers=dict({'Content-Type': 'application/json', 'User-Agent': 'costareen-deploy'}, **(headers or {})))
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode() or 'null')
        except Exception: return e.code, None


def service_key():
    tok = os.environ.get('SUPABASE_ACCESS_TOKEN', '').strip()
    if not tok: sys.exit('SUPABASE_ACCESS_TOKEN is missing (secrets.env).')
    code, keys = req('https://api.supabase.com/v1/projects/%s/api-keys?reveal=true' % REF, headers={'Authorization': 'Bearer ' + tok})
    if code >= 300 or not isinstance(keys, list): sys.exit('Could not read the project keys (%s).' % code)
    for k in keys:
        if k.get('name') == 'service_role' and k.get('api_key'): return k['api_key']
    sys.exit('No service key found.')


def admin(path, method='GET', body=None):
    k = SKEY
    return req(URL + '/auth/v1/admin' + path, method, body, {'apikey': k, 'Authorization': 'Bearer ' + k})


def find_user(email):
    page = 1
    while page < 20:
        code, out = admin('/users?page=%d&per_page=200' % page)
        users = (out or {}).get('users', []) if isinstance(out, dict) else []
        for u in users:
            if (u.get('email') or '').lower() == email: return u
        if len(users) < 200: return None
        page += 1
    return None


def set_password():
    email = (input('Account e-mail [costareen.bd@gmail.com]: ').strip() or 'costareen.bd@gmail.com').lower()
    u = find_user(email)
    if not u: print('  No account with that e-mail. Invite them in the ERP first (Settings > Users).'); return
    p1 = getpass.getpass('New password (10+ characters, hidden): ')
    if len(p1) < 10: print('  Too short - at least 10 characters.'); return
    p2 = getpass.getpass('Same password again: ')
    if p1 != p2: print('  The two did not match. Nothing changed.'); return
    code, out = admin('/users/' + u['id'], 'PUT', {'password': p1, 'email_confirm': True})
    if code < 300: print('  Done. Sign in at %s with %s and that password.' % (SITE, email))
    else: print('  Not changed (%s): %s' % (code, (out or {}).get('msg') or (out or {}).get('message') or out))


def make_link():
    email = input('Staff e-mail: ').strip().lower()
    if not email: return
    u = find_user(email)
    if not u: print('  No account with that e-mail. Invite them in the ERP first (Settings > Users > name, e-mail, role).'); return
    code, out = admin('/generate_link', 'POST', {'type': 'recovery', 'email': email, 'redirect_to': SITE})
    link = (out or {}).get('action_link') or ((out or {}).get('properties') or {}).get('action_link') if isinstance(out, dict) else None
    if code < 300 and link:
        print('\n  Send this to %s (WhatsApp is fine). It works ONCE and expires in about an hour:\n\n  %s\n' % (email, link))
        print('  They open it, choose their own password, and from then on sign in at %s.' % SITE)
    else: print('  Could not make the link (%s): %s' % (code, out))


if __name__ == '__main__':
    print('Costareen ERP - accounts\n')
    SKEY = service_key()
    while True:
        print('\n  1  Set a password for an account (yours or anyone\'s)')
        print('  2  Make a one-time "set your password" link for a staff member')
        print('  q  Quit')
        c = input('Choose: ').strip().lower()
        if c == '1': set_password()
        elif c == '2': make_link()
        elif c in ('q', ''): break
