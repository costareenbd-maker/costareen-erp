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
    pw = pw.replace(' ', '') if 'gmail' in host else pw   # Google shows app passwords as 4 groups of 4
    # try the login here first: a wrong password saved silently makes every e-mail fail later
    import smtplib, ssl
    try:
        with smtplib.SMTP(host, int(port), timeout=20) as m:
            m.starttls(context=ssl.create_default_context()); m.login(user, pw)
        print('login to %s: OK' % host)
    except smtplib.SMTPAuthenticationError:
        sys.exit('
%s REFUSED that password - nothing changed.
'
                 'For Gmail it must be an APP PASSWORD (16 letters), not the normal password:
'
                 '  1. Sign in to %s, open https://myaccount.google.com/apppasswords
'
                 '     (2-Step Verification must be on first).
'
                 '  2. Make one named "Costareen ERP", copy the 16 letters, run this again and paste them.' % (host, user))
    except Exception as e:
        sys.exit('Could not reach %s:%s (%s) - nothing changed.' % (host, port, e))
    code, out = call('https://api.supabase.com/v1/projects/%s/config/auth' % REF, 'PATCH', {
        'smtp_host': host, 'smtp_port': str(port), 'smtp_user': user, 'smtp_pass': pw,
        'smtp_admin_email': sender, 'smtp_sender_name': name, 'rate_limit_email_sent': 200})
    print('mail settings', code, 'ok' if code < 300 else out[:400])
    if code >= 300:
        sys.exit(1)
    # with its own mail service, Supabase lets the owner-approval e-mail say what it is
    code2, out2 = call('https://api.supabase.com/v1/projects/%s/config/auth' % REF, 'PATCH', {
        'mailer_subjects_magic_link': 'Confirm a change in your ERP',
        'mailer_templates_magic_link_content': '<h2>Confirm a change in your ERP</h2><p>An owner wants to change who may use your ERP. Open this link to see the change and agree or refuse:</p><p><a href="{{ .ConfirmationURL }}">Review the change</a></p><p>If you did not expect this, do not agree - and tell the other owner.</p>'})
    print('owner-approval e-mail text', code2, 'ok' if code2 < 300 else str(out2)[:200])
    code, out = call('https://api.supabase.com/v1/projects/%s/secrets' % REF, 'POST',
                     [{'name': 'ERP_SMTP_NOTE', 'value': '%s as %s' % (host, sender)}])
    print('told the ERP', code, 'ok' if code < 300 else out[:300])
    print('Done. Redeploy the function (python deploy.py function) so Settings > Connections shows it.')


if __name__ == '__main__':
    main()
