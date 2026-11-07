# Feedback Loop

Webhook-to-Claude-Code bridge. Your apps POST bugs and errors to a local
endpoint. A worker picks them up one at a time and spawns `claude -p` in the
target repo. Claude Code investigates the codebase, finds the root cause,
implements the fix, verifies it, and commits.

No dashboard, no chat UI, no PWA. The Claude Code session is the conversation.

## How it works

```
your app → POST /api/job → SQLite queue → spawn claude -p → fix + commit
```

1. Your app catches a bug or error and POSTs to `http://localhost:8956/api/job`
   with a shared secret
2. Feedback Loop stores the job and picks it up within 5 seconds
3. Claude Code opens the target repo, investigates, fixes, and commits

## Install

```bash
git clone https://github.com/kyledeboo-ctrl/feedback-loop.git
cd feedback-loop
cp .env.example .env
# edit .env: set FEEDBACK_LOOP_SECRET to a random string
npm install -g @anthropic-ai/claude-code  # if not already installed
claude                     # auth and set up permissions once
node server.mjs
```

Requirements: Node 22.5+, Claude Code CLI installed and authenticated.

## Configure

`.env`:

```
FEEDBACK_LOOP_PORT=8956
FEEDBACK_LOOP_SECRET=your-random-secret-here
# CLAUDE_PATH=claude
# CLAUDE_TIMEOUT_S=600
# CLAUDE_SKIP_PERMISSIONS=true
```

- `FEEDBACK_LOOP_SECRET` (required): shared secret your apps include in requests
- `CLAUDE_SKIP_PERMISSIONS`: set to `true` for fully unattended runs
- `CLAUDE_TIMEOUT_S`: seconds before killing a stuck Claude Code run (default 600)

## Integrate from your app

POST to `http://localhost:8956/api/job`:

```json
{
  "title": "Payment page crashes on submit",
  "description": "TypeError: Cannot read properties of null\n    at processPayment (src/payments.ts:42)\n    at POST /api/checkout (routes.ts:156)",
  "repo": "~/projects/my-app",
  "kind": "error",
  "secret": "your-random-secret-here",
  "source": "my-app-web"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `title` | yes | Short description |
| `description` | yes | Stack trace, repro steps, expected behaviour |
| `repo` | yes | Path to the repo Claude Code should work in |
| `kind` | no | `bug` (default) or `error` (focuses Claude Code on the stack trace) |
| `secret` | yes | Must match `FEEDBACK_LOOP_SECRET` |
| `source` | no | Label for where the report came from |

A `kind` of `error` adds a prompt telling Claude Code to focus on the stack trace
and fix the root cause, not the symptom.

## Run as a service

Example systemd unit (`~/.config/systemd/user/feedback-loop.service`):

```ini
[Unit]
Description=Feedback Loop
After=network-online.target

[Service]
Type=simple
Environment=FEEDBACK_LOOP_PORT=8956
ExecStart=/home/you/.local/bin/node /home/you/projects/feedback-loop/server.mjs
WorkingDirectory=/home/you/projects/feedback-loop
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now feedback-loop
```

## Status page

`http://localhost:8956/` shows the last 30 jobs with status, errors, and
expandable Claude Code output.

## Stack

Single file, zero dependencies. `node:http` + `node:sqlite`. No npm packages,
no build step, no framework.