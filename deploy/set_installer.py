"""Switch on the installer's extras on the provider's ERP. Run it when you are ready:

    cd G:/costareen-erp/deploy && source secrets.env && python set_installer.py

It sets, as private settings of the `erp` server function:
  ERP_PUBLIC_URL / ERP_PUBLIC_PROJECT / ERP_CF_ACCOUNT  - the neutral address customers see (no company name)
  ERP_CF_TOKEN                     - (optional) lets a customer's own web address switch on by itself.
                                     Make a Cloudflare token with ONLY "Cloudflare Pages: Edit" for your account.
  SUPABASE_OAUTH_CLIENT_ID/SECRET  - (optional) the one-click "Connect Supabase" button.
      Make it once: supabase.com -> your organisation -> Settings -> OAuth Apps -> Add application
        name: ERP installer   website: https://office-erp.pages.dev
        callback URL: https://oqzcuuytytqadqjlwdsh.supabase.co/functions/v1/erp?install=oauth_back
        scopes/permissions: everything it offers for projects, database, edge functions, secrets, organizations
      Copy its client id and client secret when asked below.
Secrets are typed hidden here and never written anywhere else. Press Enter to skip one.
"""
import getpass, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import deploy

pairs = []
code, proj = deploy.api('https://api.cloudflare.com/client/v4/accounts/%s/pages/projects/%s' % (deploy.need('CLOUDFLARE_ACCOUNT_ID'), deploy.PUBLIC_PROJECT),
                        token=deploy.need('CLOUDFLARE_API_TOKEN'))
if code >= 300:
    sys.exit('The neutral Pages project is not made yet: run "python deploy.py web" first.')
sub = proj['result']['subdomain']
pairs += ['ERP_PUBLIC_URL=https://%s/' % sub, 'ERP_PUBLIC_PROJECT=' + deploy.PUBLIC_PROJECT, 'ERP_CF_ACCOUNT=' + os.environ['CLOUDFLARE_ACCOUNT_ID']]
print('neutral address: https://%s/' % sub)
cf = getpass.getpass('Cloudflare token with only "Pages: Edit" (Enter to skip): ').strip()
if cf:
    pairs.append('ERP_CF_TOKEN=' + cf)
cid = input('Supabase OAuth client id (Enter to skip): ').strip()
if cid:
    sec = getpass.getpass('Supabase OAuth client secret: ').strip()
    if not sec:
        sys.exit('Both the client id and the secret are needed.')
    pairs += ['SUPABASE_OAUTH_CLIENT_ID=' + cid, 'SUPABASE_OAUTH_CLIENT_SECRET=' + sec]
deploy.step_secrets(pairs)
print('Done. Set:', ', '.join(p.split('=')[0] for p in pairs))
