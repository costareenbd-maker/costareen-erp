"""Connect with Facebook for the Inbox: add the provider's Meta app once (handlers/metaconnect.js).

1. https://developers.facebook.com -> My Apps -> Create app -> "Other" -> type "Business"; name it (e.g. "Costareen ERP"),
   pick your Business portfolio (Business Manager).
2. In the app, add the products: Facebook Login for Business, Messenger, Instagram, WhatsApp, Webhooks.
3. Facebook Login for Business -> Settings -> Valid OAuth Redirect URIs (exactly):
       https://<project>.supabase.co/functions/v1/erp?meta=back
   (the dev ERP: zukqxkcpmxcogbhkdpyw; the live ERP: oqzcuuytytqadqjlwdsh)
   Optional: Facebook Login for Business -> Configurations -> create one with the permissions; copy its Configuration ID.
4. App settings -> Basic: copy the App ID and the App secret (press Show), then:

    cd deploy; source secrets.env
    python set_meta.py --dev --app-id <id> [--config-id <id>] --deploy      (the secret is asked for, never typed on the command line)

While the app is in Development mode, only people with a role on the app (you, your team) can log in and message it -
enough to test your own page. Your own page's messages need no App Review; the customers' names and photos do.
"""
import getpass, json, os, sys, subprocess, urllib.request, urllib.error

DEV, LIVE = 'zukqxkcpmxcogbhkdpyw', 'oqzcuuytytqadqjlwdsh'


def arg(name):
    return sys.argv[sys.argv.index(name) + 1].strip() if name in sys.argv and sys.argv.index(name) + 1 < len(sys.argv) else ''


def main():
    ref = DEV if '--dev' in sys.argv else LIVE if '--live' in sys.argv else ''
    if not ref:
        sys.exit('Say which ERP: --dev or --live. Nothing changed.')
    app = arg('--app-id') or input('App ID (only digits): ').strip()
    app = ''.join(ch for ch in app if ch.isdigit())
    if len(app) < 10:
        sys.exit('A Meta App ID is 15-16 digits. Nothing changed.')
    print('App secret: paste it with a RIGHT-CLICK in this window (Ctrl+V does not paste here), then press Enter.')
    sec = getpass.getpass('App secret (hidden): ')
    sec = ''.join(ch for ch in sec if ch.isprintable() and not ch.isspace())
    if len(sec) != 32 or any(c not in '0123456789abcdef' for c in sec.lower()):
        sys.exit('A Meta App secret is 32 letters and digits (got %d). Paste it with a right-click. Nothing changed.' % len(sec))
    # ask Meta whether the ID and the secret belong together, before saving anything
    try:
        with urllib.request.urlopen('https://graph.facebook.com/oauth/access_token?client_id=%s&client_secret=%s&grant_type=client_credentials' % (app, sec), timeout=30) as r:
            if 'access_token' not in r.read().decode():
                sys.exit('Meta gave no answer for this app. Nothing changed.')
        print('Meta accepted the App ID and secret.')
    except urllib.error.HTTPError as e:
        sys.exit('Meta says the App ID and secret do not belong together: ' + e.read().decode('utf-8', 'replace')[:200] + ' - nothing changed.')
    tok = os.environ.get('SUPABASE_ACCESS_TOKEN', '').strip()
    if not tok:
        sys.exit('Set SUPABASE_ACCESS_TOKEN first (source secrets.env).')
    body = [{'name': 'META_APP_ID', 'value': app}, {'name': 'META_APP_SECRET', 'value': sec}]
    cfg = arg('--config-id')
    if cfg:
        body.append({'name': 'META_CONFIG_ID', 'value': ''.join(ch for ch in cfg if ch.isdigit())})
    req = urllib.request.Request('https://api.supabase.com/v1/projects/%s/secrets' % ref, method='POST', data=json.dumps(body).encode(),
                                 headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json', 'User-Agent': 'costareen-deploy'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            print('saved', r.status)
    except urllib.error.HTTPError as e:
        sys.exit('Supabase said: ' + e.read().decode()[:400])
    print('The redirect address to put in the Meta app: https://%s.supabase.co/functions/v1/erp?meta=back' % ref)
    if '--deploy' in sys.argv:
        here = os.path.dirname(os.path.abspath(__file__))
        env = dict(os.environ, ERP_TARGET='dev') if ref == DEV else os.environ
        print('Switching it on (deploying the server, about a minute)...')
        r1 = subprocess.run([sys.executable, os.path.join(here, 'deploy.py'), 'function'], cwd=here, env=env)
        print('Done. Open the ERP: Settings > Connections > Connect with Facebook.' if r1.returncode == 0 else 'The keys are saved, but the deploy failed. Run it again, or ask Claude.')
    else:
        print('Now deploy the function (python deploy.py function).')


if __name__ == '__main__':
    main()
