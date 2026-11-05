# Native ERP development and migration support

Production and development backends now run on the owner's Ubuntu Mac mini. The public ERP and development Pages addresses stay unchanged. Existing source, data, user password hashes and access keys are retained. Both rented VPS subscriptions remain unchanged as manual fallbacks.

`deploy.py` deliberately refuses both legacy Cloud targets. Push a branch to the existing GitHub repository: the copied development sync runs on the Mac every two minutes and deploys development changes there. Production is a separate, deliberate operator action; the development driver never deploys it.

## Native paths
- Development runtime/config: `/opt/erp-dev-migration`, three uniquely named services `erp-dev-auth`, `erp-dev-storage`, `erp-dev-edge`.
- Isolated development database: `dev_zukqxkcpmxcogbhkdpyw_native` in the existing native Supabase cluster.
- Development checkout: `/opt/costareen-erp-devsync`.
- Copied sync driver and adapters: `/opt/erp-dev-migration/devsync`; state/logs `/var/lib/erp-devsync`.
- Timer: `erp-devsync-native.timer`, with the Windows task retained but disabled after migration.

These scripts read root-only runtime configuration. Never add that configuration, credential JSON, exported data, original handoffs or private backup archives to Git.

`dev_deploy.py` imports the original repository deploy steps and adapts only the target: SQL uses the development DB role, functions copy to the development mount with a smoke check/previous-code rollback, and Pages builds use the native development URL and public anon key. Non-native Supabase API calls are refused. The original branch merge and preview workflow is retained through `devsync_runner.py`.

The deployment adapters are installed as `deploy.py`, `native-devsync-runner.py` and `native-dev-github-helper.py` under the private driver directory. Copy the repository's original `deploy/devsync.py` there as the workflow driver. `configure_stack.py` is the existing stack factory; it needs the private generated configuration and existing native image templates. The service/timer files show the operating paths. Keep wrappers compatible when changing the original deploy interface; a mismatch must fail rather than fall back to Cloud.

## Important network constraint
Development shares the internal Supabase Docker network. Its Compose service keys and aliases MUST be `dev-auth`, `dev-storage` and `dev-edge`, never the production aliases `auth`, `storage`, `db` or `functions`. Duplicate service aliases can route production requests to the wrong stack. All host ports are loopback-only; ingress is through the existing tunnel and Caddy gateway. Do not expose database ports publicly.

## Operator checks
```sh
sudo systemctl status erp-devsync-native.timer
sudo tail -n 30 /var/lib/erp-devsync/sync.log
sudo python3 /opt/erp-dev-migration/devsync/deploy.py check
```
Manual development-only steps on the Mac:
```sh
sudo python3 /opt/erp-dev-migration/devsync/deploy.py db
sudo python3 /opt/erp-dev-migration/devsync/deploy.py function
sudo python3 /opt/erp-dev-migration/devsync/deploy.py web
```
The checkout is managed by the sync driver; commit and push work before deployment. Do not edit a managed checkout while its sync service is running.

Private verification, credential locations, source file recovery and the tested manual fallback procedure are recorded in the owner's current AI handoff and recovery runbook outside this repository. Historical source Storage files are copied only when original bytes match their recorded checksum; never fabricate old financial documents.
