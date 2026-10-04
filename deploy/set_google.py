"""Let businesses connect their Google Drive (once per system, by the system provider).

1. https://console.cloud.google.com -> create a project (e.g. "Costareen ERP").
2. APIs & Services -> Library -> enable "Google Drive API" (and "Google Sheets API" for the backup sheet).
3. APIs & Services -> OAuth consent screen -> External; app name, support e-mail; scopes: .../auth/drive.file, openid, email;
   add your own Google address as a test user (or publish the app).
4. APIs & Services -> Credentials -> Create credentials -> OAuth client ID -> Web application.
   Authorized redirect URI (exactly):
       https://oqzcuuytytqadqjlwdsh.supabase.co/functions/v1/erp?google=back
5. Copy the client ID and client secret, then:

    cd deploy; source secrets.env
    python set_google.py --client-id <id>          (the secret is asked for, never typed on the command line)
    python deploy.py function

Then each owner: Settings > Connections > Google Drive > Connect.
drive.file means the ERP sees only the files and folders it made itself, nothing else in the Drive.
"""
import getpass, json, os, sys, urllib.request

REF = 'oqzcuuytytqadqjlwdsh'


def main():
    if '--client-id' in sys.argv and sys.argv.index('--client-id') + 1 < len(sys.argv):
        cid = sys.argv[sys.argv.index('--client-id') + 1].strip()
    else:
        cid = input('Client ID (ends with .apps.googleusercontent.com): ').strip()
    sec = getpass.getpass('Client secret: ').strip()
    if not cid.endswith('.apps.googleusercontent.com') or not sec:
        sys.exit('That does not look like a Google OAuth client ID / secret.')
    tok = os.environ.get('SUPABASE_ACCESS_TOKEN', '').strip()
    if not tok:
        sys.exit('Set SUPABASE_ACCESS_TOKEN first (source secrets.env).')
    body = [{'name': 'GOOGLE_CLIENT_ID', 'value': cid}, {'name': 'GOOGLE_CLIENT_SECRET', 'value': sec}]
    req = urllib.request.Request('https://api.supabase.com/v1/projects/%s/secrets' % REF, method='POST', data=json.dumps(body).encode(),
                                 headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json', 'User-Agent': 'costareen-deploy'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            print('saved', r.status)
    except urllib.error.HTTPError as e:
        sys.exit('Supabase said: ' + e.read().decode()[:400])
    if '--deploy' in sys.argv:
        import subprocess
        here = os.path.dirname(os.path.abspath(__file__))
        print('Switching it on (deploying the server, about a minute)...')
        r1 = subprocess.run([sys.executable, os.path.join(here, 'deploy.py'), 'function'], cwd=here)
        r2 = subprocess.run([sys.executable, os.path.join(here, 'deploy.py'), 'cron'], cwd=here)
        if r1.returncode == 0 and r2.returncode == 0:
            print()
            print('Done. Open the ERP: Settings > Connections > Google Drive > Connect.')
        else:
            print()
            print('The keys are saved, but switching on failed. Run it again, or ask Claude.')
    else:
        print('Now: python deploy.py function   (and python deploy.py cron once, for the copy timer)')


if __name__ == '__main__':
    main()
