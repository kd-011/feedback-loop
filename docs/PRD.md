---
slug: feedback-loop-prd
name: Feedback Loop PRD
repo: .
status: active
last_verified: 2026-11-22
---

# Feedback Loop: product requirements

## Purpose

A local webhook that turns a bug report or error from an app into a Claude Code run. The app POSTs the report, the server queues it, and a worker runs `claude -p` in the named repo, which investigates, fixes and commits. The Claude Code session is the conversation, so there is no chat UI.

## Audience

Built for a friend's apps, running on the same machine: they POST to `http://localhost:8956/api/job` with a shared secret. The operator watches jobs on the status page at `/`, reachable only from that machine. The repo is public on GitHub for anyone to self-host.

## Features

- **[shipped]** `POST /api/job` takes `title`, `description`, `repo`, `secret`, and optional `kind` (`bug` by default, or `error`) and `source`; returns 201 with the job id. <!-- src: server.mjs:265-281, README.md:51-76 -->
- **[shipped]** Shared-secret check in constant time; a wrong or missing secret gets 401. <!-- src: server.mjs:243-248, server.mjs:267 -->
- **[shipped]** Queue cap: 429 once 30 jobs are pending or running. <!-- src: server.mjs:273-274 -->
- **[shipped]** Worker checks the queue every 5 s and runs one job at a time, oldest first, as `claude -p --output-format json --allowedTools Read,Edit,Bash,Grep,Glob` in the job's repo, with a timeout from `CLAUDE_TIMEOUT_S` (600 s default). <!-- src: server.mjs:23, server.mjs:62-66, server.mjs:68-129 -->
- **[shipped]** The prompt asks Claude Code to investigate, fix the root cause, verify and commit without unrelated changes; an `error` job adds a line to work from the stack trace. <!-- src: server.mjs:85-93 -->
- **[shipped]** Records the Claude Code `session_id`, result or error per job. <!-- src: server.mjs:108-118 -->
- **[shipped]** Optional unattended mode: `CLAUDE_SKIP_PERMISSIONS=true` adds `--dangerously-skip-permissions`. <!-- src: server.mjs:24, server.mjs:64 -->
- **[shipped]** Startup check warns when the Claude Code CLI is missing; jobs fail until it is installed. <!-- src: server.mjs:26-33 -->
- **[partial]** Status page: `GET /api/jobs` renders the last 30 jobs with counts, status badges, errors and an expandable result, but `GET /` drops the job list and the 5 s polling script, so the page shows only its header. <!-- src: server.mjs:146-170, server.mjs:193-241, server.mjs:255-262 -->
- **[shipped]** `setup.sh` installs and enables the systemd user unit. <!-- src: setup.sh, feedback-loop.service -->

## Non-goals

- No chat UI, no PWA, no frontend build: the app that reports the bug already has the chat.
- No public exposure: it listens on 127.0.0.1 only.
- No npm dependencies.

## Unverified

- Which of the friend's apps POST to it today.
