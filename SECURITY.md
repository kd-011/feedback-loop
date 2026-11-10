# Security

Feedback Loop runs a coding agent against your own repositories on a request from your own apps. Read this before you point anything at it.

## What it does at run time

- Listens on `127.0.0.1` only. Putting it behind a reverse proxy on a public address is your decision, and the shared secret is then the only gate.
- `POST /api/job` is accepted only when `secret` in the body matches `FEEDBACK_LOOP_SECRET`. Set that to a long random string, the example value is refused by nothing but you.
- Each job spawns `claude -p` in the repository path the request named, with `Read,Edit,Bash,Grep,Glob` allowed. Anyone who holds the secret can therefore have the agent edit and run commands in any directory the service user can reach. Treat the secret like a shell credential.
- `CLAUDE_SKIP_PERMISSIONS=true` adds `--dangerously-skip-permissions`. Leave it off unless the host is disposable.
- State lives in `data/feedback-loop.db` next to the server. The job description is passed to the agent as text, so what your apps send becomes part of the prompt. Do not forward untrusted user input into it unprompted.
- It makes no network requests of its own. Claude Code does.

## Reporting a problem

If you find a way past the secret, a way to escape the named repository, or a crash on crafted input, use GitHub's private vulnerability reporting on this repository (the Security tab), not a public issue.
