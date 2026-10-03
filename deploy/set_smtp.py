"""Send the system's e-mails (invitations, password resets) through a real mail service.

Supabase's built-in mailer sends only a few e-mails an hour - fine for testing,
not for inviting a team. This sets the project's sign-in e-mails to go through
your own SMTP server, and tells the ERP so (Settings > Connections shows it).

    cd deploy; source secrets.env
    python set_smtp.py --host smtp.gmail.com --port 587 --user costareen.bd@gmail.com \
                       --from costareen.bd@gmail.com --name "Costareen ERP"
    (the password is asked for, never typed on the command line)

Gmail: turn on 2-step verification on the account, then make an "App password"
(Google Account > Security > App passwords) and use that, not the normal password.
Gmail allows about 500 e-mails a day. Zoho, Brevo or Resend work the same way.
"""
import getpass, json, os, sys, urllib.request

REF = 'oqzcuuytytqadqjlwdsh'


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


def call(url, method, body):
    tok = os.environ.get('SUPABASE_ACCESS_TOKEN', '').strip()
    if not tok:
        sys.exit('Set SUPABASE_ACCESS_TOKEN first (source secrets.env).')
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode(),
                                 headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json', 'User-Agent': 'costareen-deploy'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def main():
    host, user = arg('--host'), arg('--user')
    if not host or not user:
        sys.exit(__doc__)
    port = arg('--port', '587')
    sender = arg('--from', user)
    name = arg('--name', 'ERP')
    pw = getpass.getpass('SMTP password (app password for Gmail): ')
    if not pw:
        sys.exit('No password - nothing changed.')
    code, out = call('https://api.supabase.com/v1/projects/%s/config/auth' % REF, 'PATCH', {
        'smtp_host': host, 'smtp_port': str(port), 'smtp_user': user, 'smtp_pass': pw,
        'smtp_admin_email': sender, 'smtp_sender_name': name, 'rate_limit_email_sent': 200})
    print('mail settings', code, 'ok' if code < 300 else out[:400])
    if code >= 300:
        sys.exit(1)
    code, out = call('https://api.supabase.com/v1/projects/%s/secrets' % REF, 'POST',
                     [{'name': 'ERP_SMTP_NOTE', 'value': '%s as %s' % (host, sender)}])
    print('told the ERP', code, 'ok' if code < 300 else out[:300])
    print('Done. Redeploy the function (python deploy.py function) so Settings > Connections shows it.')


if __name__ == '__main__':
    main()
