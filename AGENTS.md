---
slug: feedback-loop-agents
name: Feedback Loop agent guide
repo: .
status: active
last_verified: 2026-11-22
---

# Feedback Loop: guide for coding agents

The doc index is docs/README.md. Read docs/ARCHITECTURE.md before changing structure.

## Commands

- No install step: zero npm dependencies, no package.json, no build. Needs Node 22.5+ for `node:sqlite` and the Claude Code CLI on PATH. <!-- src: README.md:21-33, server.mjs:1-7 -->
- Run: `node server.mjs`. It refuses to start without `FEEDBACK_LOOP_SECRET`, read from the environment or `.env` beside the script (environment wins). <!-- src: server.mjs:9-20 -->
- Local copy beside the live one: copy `server.mjs` to a temp folder (it writes `data/` next to itself) and run `FEEDBACK_LOOP_SECRET=s FEEDBACK_LOOP_PORT=18956 CLAUDE_PATH=/bin/true node server.mjs`. `CLAUDE_PATH` stops real Claude Code runs. <!-- src: server.mjs:9, server.mjs:18-22, server.mjs:35-36 -->
- Check, as CI runs it: `node --check server.mjs`, `bash -n setup.sh`, then a smoke run that expects 401 for a bad secret and 201 for a good one, on Node 22 and 24. There are no tests and no lint or format config. <!-- src: .github/workflows/ci.yml:10-37 -->
- Install as a user service: `bash setup.sh` creates `.env` from `.env.example` if missing, copies `feedback-loop.service` into the systemd user dir and enables it, or restarts it when already enabled. <!-- src: setup.sh:11-48 -->
- Restart after a code change: `systemctl --user restart feedback-loop`. Logs: `journalctl --user -u feedback-loop`. <!-- src: feedback-loop.service:9-12 -->

## Conventions

- The whole service is `server.mjs`: Node built-ins only (`node:http`, `node:sqlite`, `node:child_process`, `node:crypto`). Keep it one file with no dependencies. <!-- src: server.mjs:1-7, README.md:111-113 -->
- The status page HTML and CSS are inlined in a template string, not a frontend folder. <!-- src: server.mjs:193-241 -->
- Config is env vars only: `FEEDBACK_LOOP_PORT`, `FEEDBACK_LOOP_SECRET`, `CLAUDE_PATH`, `CLAUDE_TIMEOUT_S`, `CLAUDE_SKIP_PERMISSIONS`. New ones go in `.env.example` and the README's Configure block. <!-- src: server.mjs:18-24, .env.example -->
- Spawn Claude Code with `spawn`, never `exec` or `execFile`, so long output streams instead of buffering. <!-- src: server.mjs:98-102 -->

## Traps

- `GET /` serves only the header: the `replace` chain at the route cuts the HTML from the first `\n<div id="jobs">` to the end, which drops the job list and the polling script. `GET /api/jobs` returns the job list correctly. Confirmed with a local run on 2026-11-22. <!-- src: server.mjs:255-262 -->
- A job left `running` when the process stops stays `running` for good: nothing resets it at startup, the worker only picks `pending` rows, and it still counts toward the queue cap of 30. <!-- src: server.mjs:53, server.mjs:68-75, server.mjs:273-274 -->
- A relative `repo` resolves against the feedback-loop folder, not the caller's. `~` falls back to `/home/kd` when `HOME` is unset. <!-- src: server.mjs:55-60 -->
- Bad or missing JSON in a POST body parses to `{}` and returns 401, not 400. There is no body size limit. <!-- src: server.mjs:131-139, server.mjs:265-271 -->
- A failed run keeps the first 2000 chars of stderr; a completed run keeps the first 8000 chars of stdout, so a long JSON result is stored truncated and the page then shows it raw. <!-- src: server.mjs:110-118, server.mjs:185-191 -->
- A timeout kills the run and records it as failed with `claude exited with code null` when stderr is empty. <!-- src: server.mjs:99-112 -->
- The repo's unit runs bare `node`, which systemd resolves only from its own fixed path list, not `~/.local/bin` or an fnm or nvm shim. `setup.sh` installs the unit as is. <!-- src: feedback-loop.service:7, setup.sh:44-46 -->
- `setup.sh`'s Node check accepts any 22.x, below the 22.5 that `node:sqlite` needs, and always prints port 8956 whatever `.env` sets. <!-- src: setup.sh:33-36, setup.sh:51-55 -->
- Anyone with the secret can make Claude Code edit and run commands in any path the service user can reach, and `CLAUDE_SKIP_PERMISSIONS=true` adds `--dangerously-skip-permissions`. Keep it on 127.0.0.1. <!-- src: SECURITY.md:7-10, server.mjs:62-66, server.mjs:294 -->

## Unverified

- The dossier says the installed unit runs `/home/kd/.local/bin/node`, unlike the repo copy. That is live machine state, not in the repo.
- The dossier says `.env` on the PC sets `CLAUDE_SKIP_PERMISSIONS=true` optionally. Not checked: `.env` is not committed.
