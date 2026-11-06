# Night build 6 Nov 2026 - what was run on the Mac mini (track TOOLS, branch wip/night-tools)

(Meant for G:/costareen-erp/.impeccable/shape/erp-2026-11-06/night-mac-log.md; the builder's worktree isolation did
not allow writing in the shared checkout, so it was written here - copy it over.)

Owner approval: D22 (`brand-api` internal Docker network) and D21, from 03-ANSWERS.md. DEV ONLY. Host `macmini-vps`
(normal ssh, host-key checking on). No container was restarted, recreated or stopped; no new public or host port; no
env values or keys printed. The production functions container `supabase-edge-functions` was NOT touched (waits for
the owner's "live koro").

## 1. Read first (read-only)
- `/opt/brand/PORTS.md`, `/opt/brand/{shlink,openshorts,opencut}/NOTES.md`
- `docker network ls`; `docker ps --format '{{.Names}}\t{{.Networks}}'` -> before: `erp-dev-edge` and
  `supabase-edge-functions` only on `supabase_default`; each app only on its own `brand-<app>_default`.
- OpenShorts API shape read from its own `/openapi.json` inside `brand-openshorts-backend` and `app.py`
  (`/api/process` JSON `{url, target_clips}` + header `X-Gemini-Key`, `/api/status/{job_id}`, `/health`).

## 2. The network (D22) - additive
```sh
docker network create --internal --driver bridge brand-api      # id 603e49df482a
docker network connect brand-api erp-dev-edge                    # the DEV edge only
docker network connect brand-api brand-shlink
docker network connect brand-api brand-openshorts-frontend       # nginx in front of the OpenShorts backend
docker network connect brand-api brand-opencut-web
```
`--internal`: the network has no gateway, so nothing on it gets a new way out to the internet; each container keeps
its own default network for that. After: `docker network inspect brand-api` -> Internal=true, members
brand-shlink, brand-openshorts-frontend, erp-dev-edge, brand-opencut-web. All four still "Up" (no restart).

Reachability check (from `brand-openshorts-frontend`, which has wget; the edge-runtime image has no curl/wget/deno CLI):
`http://brand-shlink:8080/rest/health` 200 (Shlink 5.1.8) · `http://brand-opencut-web:3000/` 200 ·
`http://brand-openshorts-frontend:80/health` 200 `{"status":"ok"}`.

NOT persistent across a container re-create: a `docker compose up -d` that re-creates a container drops the extra
network. To make it permanent, add `networks: [default, brand-api]` + `brand-api: {external: true}` to the three app
compose files and the dev edge compose (`/opt/erp-dev-migration`) - not done tonight (would need a re-create).

## 3. Shlink key for the DEV ERP (sealed, never shown)
Script (builder's scratchpad, not in git): `docker exec brand-shlink shlink api-key:generate --name=erp-dev`, the key
read into a shell variable (never echoed), written with `printf ... | docker exec -i supabase-db psql` into the DEV
database `dev_zukqxkcpmxcogbhkdpyw_native`, table `business_secrets`, key `TOOL_SHLINK_KEY`, for the two dev
businesses `Demo 3D Shop` (b5296754-...) and `Rahman Abidur` (brand, 5859a368-...). Proof without showing it: key
length 36; `GET /rest/v3/short-urls` with it -> HTTP 200.
Live database and the live `owner-initial` key: untouched. The new Shlink key is named `erp-dev` (Shlink's own list:
`docker exec brand-shlink shlink api-key:list`; revoke with `shlink api-key:disable <key>`).

Dev `business_config` rows written for the same two businesses (addresses only, no secrets):
| key | value |
|---|---|
| tool_url_shlink | http://brand-shlink:8080 |
| tool_open_shlink | https://links.costareen.com |
| tool_short_shlink | go.costareen.com |
| tool_url_openshorts | http://brand-openshorts-frontend:80 |
| tool_open_openshorts | https://shorts.costareen.com |
| tool_url_opencut | http://brand-opencut-web:3000 |
| tool_open_opencut | https://cut.costareen.com/projects |

## 4. Not done / for the owner
- OpenShorts needs a Gemini key for `/api/process` (the ERP sends the provider Gemini key, or one pasted under
  Settings > Connections > Tools). None was copied tonight.
- The dev ERP runs this code only after `wip/night-tools` is merged (devsync skips `wip/` branches).
- Production edge (`supabase-edge-functions`) joins `brand-api` only on the owner's "live koro":
  `docker network connect brand-api supabase-edge-functions`, then the live business's Tools settings.
- The "Only me" flag row `tooldoor` is not set in the dev database: the platform admin (owner) sees it anyway.
