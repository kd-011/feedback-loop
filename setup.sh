#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SVC="$ROOT/feedback-loop.service"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

echo "Feedback Loop setup"
echo "==================="
echo ""

if [ ! -f "$ROOT/.env" ]; then
  if [ -f "$ROOT/.env.example" ]; then
    cp "$ROOT/.env.example" "$ROOT/.env"
    echo "Created .env from .env.example"
  else
    echo "FEEDBACK_LOOP_PORT=8956" > "$ROOT/.env"
    echo "FEEDBACK_LOOP_SECRET=change-me" >> "$ROOT/.env"
    echo "Created .env with defaults"
  fi
  echo ""
  echo "IMPORTANT: edit $ROOT/.env and set FEEDBACK_LOOP_SECRET to a random string"
  echo ""
fi

if ! command -v claude &>/dev/null; then
  echo "Claude Code CLI not found in PATH."
  echo "  npm install -g @anthropic-ai/claude-code"
  echo "  claude    (run once to auth and set up permissions)"
  echo ""
fi

if ! node --version 2>/dev/null | grep -q 'v2[2-9]'; then
  echo "Node 22.5+ is required. Current: $(node --version 2>/dev/null || echo 'not found')"
  echo "  install via fnm/nvm or from nodejs.org"
  exit 1
fi

if systemctl --user is-enabled feedback-loop &>/dev/null 2>&1; then
  echo "Feedback Loop service already installed. Restarting..."
  systemctl --user restart feedback-loop
else
  echo "Installing systemd unit..."
  mkdir -p "$UNIT_DIR"
  cp "$SVC" "$UNIT_DIR/feedback-loop.service"
  systemctl --user daemon-reload
  systemctl --user enable --now feedback-loop
fi

echo ""
echo "Feedback Loop is running on http://localhost:8956/"
echo "Status page: http://localhost:8956/"
echo "Job endpoint: http://localhost:8956/api/job"
echo ""
echo "From your app, POST to http://localhost:8956/api/job with:"
echo '  {"title":"...","description":"...","repo":"~/projects/my-app","secret":"your-secret","kind":"bug"}'