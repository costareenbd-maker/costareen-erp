# Night build 6 Nov 2026 - track MAC housekeeping (wip/night-mac)

Owner decisions: D23 A (Twenty stopped, data kept), D26 B (Scriberr stopped, data kept), D27 yes (delete the old
Docker copies only after proving nothing uses them). Host: `ssh macmini-vps` (root, normal host-key checking).
No repo code changed. No secrets printed.

## Baseline (13:45 UTC)
- `df -h /`: 98G size, **86G used, 7.1G free, 93%**.
- Health script (status only): prod ERP function `POST 127.0.0.1:8000/functions/v1/erp {"name":"erpHello"}` ->
  `{"ok":true,"result":{"ok":false,"reason":"NO_CODE",...}}` (function up, no key used); dev ERP edge `127.0.0.1:9342/erp`
  same answer; `systemctl is-active erp-engine caddy docker` = active x3; Caddy `:8811` Host costareen.com -> 200;
  pg_cron `erp-inbox` (jobid 9, every minute) last 3 runs succeeded, 0 failures in 30 min; `supabase-edge-functions`
  running healthy, `erp-dev-edge` running.

## 1. Twenty - stopped
- `cd /opt/brand/twenty && docker compose stop` -> brand-twenty-worker-1, -server-1, -db-1, -redis-1 all Exited.
- Nothing removed (db volume and /data/brand/twenty kept). Compose uses `restart: unless-stopped`, so it stays stopped
  after a reboot. crm.costareen.com no longer answers.
- Appended "Stopped 2026-11-06 (owner decision D23 A)" section with start-again command to /opt/brand/twenty/NOTES.md.
- Health after: all checks same as baseline (OK).

## 2. Scriberr - stopped
- `cd /opt/brand/scriberr && docker compose stop` -> brand-scriberr Exited (0).
- Nothing removed (/data/brand/scriberr ~29 GB model envs kept, so it restarts without re-download).
  Note: this frees RAM/CPU only; the 29 GB on /data stays until the owner decides to delete it.
- Appended "Stopped 2026-11-06 (owner decision D26 B)" section to /opt/brand/scriberr/NOTES.md.
- Health after: all checks OK.

## 3. Old Docker copies on the root disk - proved unused, deleted
Paths: `/var/lib/docker.old-root` (du 1.5G) and `/var/lib/containerd.old-root` (du 48G) = ~49.5 GB real
(the "~85 GB" in the plan was an over-estimate; the whole root disk used 86G).
Proofs (all passed):
- P1 `docker info`: DockerRootDir=/var/lib/docker, Driver=overlayfs via containerd snapshotter. `findmnt`:
  /var/lib/docker = /dev/nvme0n1p3[/docker-root/docker], /var/lib/containerd = /dev/nvme0n1p3[/docker-root/containerd]
  (bind mounts from /data, set in /etc/fstab lines 7-9).
- P2 `docker inspect` of all 88 containers (running + stopped): Mounts, Binds, LogPath -> 0 mention `old-root`;
  all volume sources are /var/lib/docker/volumes/... (the /data bind).
- P3 all 14 volumes: Mountpoint/Options -> 0 mention `old-root`.
- P4 daemon config: no /etc/docker/daemon.json, no /etc/containerd, /etc/default/docker has no data-root; grep 0 hits.
- P5 systemd: dockerd `ExecStart=/usr/bin/dockerd -H fd:// --containerd=...` (no data-root), containerd plain;
  drop-ins only `RequiresMountsFor=/var/lib/docker /var/lib/containerd`; grep `old-root` in /etc/systemd,
  /lib/systemd, /usr/lib/systemd -> 0 hits.
- P6 fstab/cron/scripts: only hit is /root/docker-move.sh (the one-time move script that made the copies; not in
  any cron/timer/unit). /root/docker-move.log shows rsync done and docker restarted 5 Nov 15:50 UTC; Docker had run
  ~22 h from /data with every container healthy.
- P7 no mounts under old-root, no process cwd/root or open fd into old-root.
- Production + dev ERP + Inbox healthy right before the delete (health script OK).

Delete: guarded `test -d` on both dirs + `findmnt` source check, then
`rm -rf --one-file-system /var/lib/docker.old-root /var/lib/containerd.old-root`. Both gone.
- `df -h /` after: **37G used, 57G free, 40%** (was 86G used / 7.1G free / 93%).
- Health after (13:48 UTC): prod fn OK, dev fn OK, erp-engine/caddy/docker active, Caddy 200, erp-inbox runs
  13:46/13:47/13:48 succeeded, 0 failures; 77 containers up, 0 unhealthy. Exited ones are only the expected ones:
  Twenty x4, Scriberr, Chatwoot x4 (already stopped before tonight), erp-probe-* x2 (already exited before tonight).

## Left as-is / follow-ups
- /root/docker-move.sh is still on the box. It must never be re-run (it would `mv` the live /var/lib/docker away).
  Owner may delete it; not in scope tonight.
- /etc/fstab.before-docker-move backup kept.
- Tools page / Brand desk cards for Twenty and Scriberr will now show them down; card removal is page work for another track.
- Scriberr 29 GB on /data not freed (data kept by decision).
