# aos-sessions
Read-only overview of all active sessions.
Usage: `node ./out/aos-sessions.mjs [--json] [--section needs|working|idle|acp] [--no-hub] [--help]`
Sources: trail hub `GET 127.0.0.1:5350/v1/model` (down = `hub: not running`), `~/.aos/sessions/*.json` (alive via `kill(pid,0)`), `~/.aos/acp/*.jsonl` (last 64 KB, last 6 h).
Sections: NEEDS YOU (waiting/GO), WORKING, IDLE, ACP WORKERS (running/stalled/done/GO needed).
Env: `AOS_HOME` overrides `~/.aos`; `AGENTTRAIL_URL` (or `AGENTTRAIL_PORT`) overrides hub URL.
Display only: never writes, grants, or sends anything. Exit 0 (2 = usage error).
