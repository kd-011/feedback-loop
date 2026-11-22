# Feedback Loop: decisions

Why the project is the way it is, newest first. One entry per decision: the date it was made, what was decided, and why. Entries are records: when a decision stops being true, leave it and add `Superseded YYYY-MM-DD: <what replaced it>.` to its end, then add the new decision above.

- 2026-11-10: Compare the shared secret in constant time, and run a CI smoke test. Why: a plain string compare leaks the secret by timing, and the secret is effectively a shell credential.
- 2026-11-07: Public repo on GitHub (kd-011/feedback-loop) with README install steps, `.env.example` and an MIT licence. Why: so others can self-host it.
- 2026-11-07: Removed the cloudflared tunnel and public DNS; it listens on localhost only. Why: the apps that call it run on the same machine, and the secret is the only other gate.
- 2026-11-07: Stripped all frontend code (chat UI, PWA, static assets). Why: the chat UI was the wrong layer; the friend's apps already have chat. This is a bridge: app to Claude Code to commit, and the Claude Code session is the conversation.
- 2026-11-07: `node:sqlite`, not Drizzle. Why: zero dependencies.
- 2026-11-07: `spawn` over `execFile`. Why: long Claude Code runs would buffer stdout in `execFile`.
