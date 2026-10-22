# The Engine (engine-1, 22 Oct 2026)

The ERP is the screen; the Engine does the work (docs/ENGINE-PLAN.md). It runs on the office VPS as
`erp-engine.service` (root, because the owner's Claude plan login lives in /root/.claude).

| File | What |
|---|---|
| `runner.mjs` | every 20 s asks the ERP for a job (`erpEngineClaim`), runs Claude Code on it, sends steps and the answer back |
| `erp-mcp.mjs` | the ERP's functions for one job, as an MCP server Claude starts (reads; writes become proposals) |
| `erp-engine.service` | systemd unit |

Install / update:

    scp runner.mjs erp-mcp.mjs root@62.171.167.199:/opt/erp-engine/
    scp erp-engine.service root@62.171.167.199:/etc/systemd/system/
    ssh root@62.171.167.199 'systemctl daemon-reload && systemctl enable --now erp-engine && systemctl restart erp-engine'

`/etc/erp-engine.env` (root only, 600):

    ERP_URL=https://oqzcuuytytqadqjlwdsh.supabase.co/functions/v1/erp
    ERP_ENGINE_KEY=<an access link key whose label starts with "Engine"> (deploy/new_access_link.py "Engine (office VPS)")
    MAX_PARALLEL=2
    MODELS=opus,sonnet

What a job gets: the agent's instructions, the switched-on skills written as `.claude/skills/<slug>/` in a fresh
folder (Claude loads them with its Skill tool; `--setting-sources project`), WebSearch / WebFetch, Read / Glob / Grep
(inside the job folder), and the ERP tools. No shell and no file writing: code inside a skill is never run.
Which skills were used = the `Skill` tool calls (and reads of a skill's files) in Claude's stream.
When the plan's limit is hit, the next model is tried, then the job goes back to the queue and the Engine rests 10 minutes.

Logs: `journalctl -u erp-engine -f`. Stop: `systemctl stop erp-engine` (jobs wait in the ERP).
