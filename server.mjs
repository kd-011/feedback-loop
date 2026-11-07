import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const PORT = Number(process.env.FEEDBACK_LOOP_PORT || 8956);
const PIN = process.env.FEEDBACK_LOOP_PIN || '';
if (!PIN) { console.error('FEEDBACK_LOOP_PIN missing, refusing to start unauthenticated'); process.exit(1); }
const TOKEN = createHash('sha256').update(`feedback-loop:${PIN}`).digest('hex');

const CLAUDE = process.env.CLAUDE_PATH || 'claude';
const CLAUDE_TIMEOUT_S = Number(process.env.CLAUDE_TIMEOUT_S || 600);
const CLAUDE_SKIP = process.env.CLAUDE_SKIP_PERMISSIONS === 'true';

const PUBLIC = join(ROOT, 'public');
mkdirSync(join(ROOT, 'data'), { recursive: true });
const db = new DatabaseSync(join(ROOT, 'data', 'feedback-loop.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  session_id TEXT,
  result TEXT,
  error TEXT,
  source TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
const rates = new Map();

function authed(req) {
  const cookie = req.headers.cookie;
  if (!cookie) return false;
  for (const part of cookie.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === 'fl' && v === TOKEN) return true;
  }
  return false;
}

function body(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => data += c);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

function serveStatic(res, path) {
  const full = join(PUBLIC, path);
  if (!existsSync(full) || !full.startsWith(PUBLIC)) { res.writeHead(404); res.end('not found'); return; }
  const ext = extname(path);
  const type = MIME[ext] || 'application/octet-stream';
  const data = readFileSync(full);
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(data);
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function resolvePath(raw) {
  let p = raw.trim();
  if (p.startsWith('~')) p = join(process.env.HOME || '/home/kd', p.slice(1));
  if (!p.startsWith('/')) p = join(ROOT, p);
  return p;
}

function claudeArgs(prompt) {
  const args = ['-p', prompt, '--output-format', 'json', '--allowedTools', 'Read,Edit,Bash'];
  if (CLAUDE_SKIP) args.push('--dangerously-skip-permissions');
  return args;
}

let running = false;

function tick() {
  if (running) return;
  const row = db.prepare("SELECT * FROM items WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1").all();
  if (row.length === 0) return;
  const item = row[0];
  running = true;

  db.prepare("UPDATE items SET status = 'running', updated_at = datetime('now'), error = NULL WHERE id = ?").run(item.id);

  const repoPath = resolvePath(item.repo_path);
  if (!existsSync(repoPath)) {
    db.prepare("UPDATE items SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?")
      .run(`Repo path not found: ${repoPath}`, item.id);
    running = false;
    return;
  }

  const prompt = `A user reported this bug or feedback in the repo you are working in. Investigate and fix it:

Title: ${item.title}
Description: ${item.description}

${item.source ? `Reported via: ${item.source}` : ''}
Find the root cause in the codebase, implement the fix, and verify it works. Do not make unrelated changes.`;

  let stdout = '';
  let stderr = '';
  const proc = spawn(CLAUDE, claudeArgs(prompt), {
    cwd: repoPath,
    timeout: CLAUDE_TIMEOUT_S * 1000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout.on('data', (d) => stdout += String(d));
  proc.stderr.on('data', (d) => stderr += String(d));

  proc.on('close', (code) => {
    if (code !== 0) {
      const errMsg = stderr || `claude exited with code ${code}`;
      db.prepare("UPDATE items SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?")
        .run(errMsg.slice(0, 2000), item.id);
    } else {
      let sessionId = null;
      try {
        const out = JSON.parse(stdout);
        sessionId = out.session_id || null;
      } catch {}
      db.prepare("UPDATE items SET status = 'completed', session_id = ?, result = ?, updated_at = datetime('now') WHERE id = ?")
        .run(sessionId, stdout.slice(0, 8000), item.id);
    }
    running = false;
  });

  proc.on('error', (err) => {
    db.prepare("UPDATE items SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?")
      .run(`Failed to start ${CLAUDE}: ${err.message}. Is Claude Code installed?`, item.id);
    running = false;
  });
}

setInterval(tick, 5000);

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0e0f14">
<title>Feedback Loop</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%}
body{background:#0e0f14;color:#e4e4e7;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center}
form{display:flex;flex-direction:column;gap:16px;width:280px}
h1{font-size:20px;font-weight:600;text-align:center;color:#fff}
input{background:#1a1b23;border:1px solid #2a2b36;border-radius:10px;padding:12px 14px;color:#e4e4e7;font-size:15px;outline:none;font-family:inherit}
input:focus{border-color:#6366f1}
button{background:#6366f1;color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit}
button:hover{background:#5558e6}
button:active{transform:scale(.97)}
.err{color:#f87171;font-size:13px;text-align:center;min-height:20px}
</style>
</head>
<body>
<form id="f"><h1>Feedback Loop</h1>
<input type="password" id="p" placeholder="PIN" autofocus>
<button type="submit">Unlock</button>
<div class="err" id="e"></div>
</form>
<script>document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault()
try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:document.getElementById('p').value})})
if(r.ok)location.reload();else document.getElementById('e').textContent='Wrong PIN'}catch{}})</script>
</body>
</html>`;

function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  const isStatic = /\.(css|js|svg|png|ico|webmanifest)$/.test(path) || path === '/sw.js';
  if (!isStatic && !authed(req) && path !== '/api/login') {
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(LOGIN_HTML);
      return;
    }
    json(res, { error: 'not authed' }, 401);
    return;
  }

  if (path === '/api/login' && method === 'POST') {
    body(req).then((b) => {
      if (b.pin === PIN) {
        res.writeHead(200, {
          'Set-Cookie': `fl=${TOKEN}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure`,
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify({ ok: true }));
      } else {
        json(res, { error: 'wrong pin' }, 401);
      }
    });
    return;
  }

  if (path === '/api/items' && method === 'GET') {
    const items = db.prepare("SELECT * FROM items WHERE status != 'archived' ORDER BY created_at DESC LIMIT 50").all();
    json(res, items);
    return;
  }

  if (path === '/api/items' && method === 'POST') {
    body(req).then((b) => {
      if (!b.title || !b.description || !b.repo_path) {
        json(res, { error: 'title, description, and repo_path are required' }, 400);
        return;
      }
      const pending = db.prepare("SELECT COUNT(*) as n FROM items WHERE status IN ('pending','running')").get();
      if (pending.n >= 20) {
        json(res, { error: 'Queue full. Wait for items to clear before submitting more.' }, 429);
        return;
      }
      const info = db.prepare('INSERT INTO items (title, description, repo_path, source) VALUES (?, ?, ?, ?) RETURNING id, created_at')
        .run(b.title, b.description, b.repo_path.trim(), b.source || '');
      json(res, { id: info[0].id, created_at: info[0].created_at, status: 'pending' }, 201);
    });
    return;
  }

  const m = path.match(/^\/api\/items\/(\d+)(\/(?:run|archive))?$/);
  if (m) {
    const id = Number(m[1]);
    const action = m[2];

    if (method === 'GET') {
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
      if (!item) { json(res, { error: 'not found' }, 404); return; }
      json(res, item);
      return;
    }

    if (action === '/run' && method === 'POST') {
      db.prepare("UPDATE items SET status = 'pending', error = NULL, updated_at = datetime('now') WHERE id = ? AND status = 'failed'").run(id);
      json(res, { ok: true });
      return;
    }

    if (action === '/archive' && method === 'POST') {
      db.prepare("UPDATE items SET status = 'archived', updated_at = datetime('now') WHERE id = ?").run(id);
      json(res, { ok: true });
      return;
    }
  }

  if (path === '/api/webhook' && method === 'POST') {
    body(req).then((b) => {
      if (!b.title || !b.description || !b.repo_path) {
        json(res, { error: 'title, description, and repo_path are required' }, 400);
        return;
      }
      const pending = db.prepare("SELECT COUNT(*) as n FROM items WHERE status IN ('pending','running')").get();
      if (pending.n >= 20) {
        json(res, { error: 'Queue full' }, 429);
        return;
      }
      const info = db.prepare('INSERT INTO items (title, description, repo_path, source) VALUES (?, ?, ?, ?) RETURNING id, created_at')
        .run(b.title, b.description, b.repo_path.trim(), b.source || 'webhook');
      json(res, { id: info[0].id, created_at: info[0].created_at, status: 'pending' }, 201);
    });
    return;
  }

  if (method === 'GET') {
    const file = path === '/' ? '/index.html' : path;
    serveStatic(res, file);
    return;
  }

  res.writeHead(404);
  res.end('not found');
}

createServer(route).listen(PORT, '127.0.0.1', () => console.log(`feedback-loop on http://127.0.0.1:${PORT}`));