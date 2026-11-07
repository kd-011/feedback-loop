import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
const SECRET = process.env.FEEDBACK_LOOP_SECRET || '';
if (!SECRET) { console.error('FEEDBACK_LOOP_SECRET missing, refusing to start'); process.exit(1); }

const CLAUDE = process.env.CLAUDE_PATH || 'claude';
const CLAUDE_TIMEOUT_S = Number(process.env.CLAUDE_TIMEOUT_S || 600);
const CLAUDE_SKIP = process.env.CLAUDE_SKIP_PERMISSIONS === 'true';

mkdirSync(join(ROOT, 'data'), { recursive: true });
const db = new DatabaseSync(join(ROOT, 'data', 'feedback-loop.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'bug',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  source TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  session_id TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

let running = false;

function resolvePath(raw) {
  let p = raw.trim();
  if (p.startsWith('~')) p = join(process.env.HOME || '/home/kd', p.slice(1));
  if (!p.startsWith('/')) p = join(ROOT, p);
  return p;
}

function claudeArgs(prompt) {
  const args = ['-p', prompt, '--output-format', 'json', '--allowedTools', 'Read,Edit,Bash,Grep,Glob'];
  if (CLAUDE_SKIP) args.push('--dangerously-skip-permissions');
  return args;
}

function tick() {
  if (running) return;
  const row = db.prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1").all();
  if (row.length === 0) return;
  const job = row[0];
  running = true;

  db.prepare("UPDATE jobs SET status = 'running', updated_at = datetime('now'), error = NULL WHERE id = ?").run(job.id);

  const repoPath = resolvePath(job.repo_path);
  if (!existsSync(repoPath)) {
    db.prepare("UPDATE jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?")
      .run(`Repo path not found: ${repoPath}`, job.id);
    running = false;
    return;
  }

  const kindLabel = job.kind === 'error' ? 'an error' : 'a bug';
  const stackNote = job.kind === 'error'
    ? '\nFocus on the stack trace to find the root cause. Fix the actual bug, not the symptom.'
    : '';

  const prompt = `${kindLabel} was reported in this repo:

Title: ${job.title}
Description: ${job.description}${stackNote}

Investigate the codebase. Find the root cause. Implement the fix. Verify it works. Commit the fix with a clear commit message. Do not make unrelated changes.`;

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
      db.prepare("UPDATE jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?")
        .run(errMsg.slice(0, 2000), job.id);
    } else {
      let sessionId = null;
      try { sessionId = JSON.parse(stdout).session_id || null; } catch {}
      db.prepare("UPDATE jobs SET status = 'completed', session_id = ?, result = ?, updated_at = datetime('now') WHERE id = ?")
        .run(sessionId, stdout.slice(0, 8000), job.id);
    }
    running = false;
  });

  proc.on('error', (err) => {
    db.prepare("UPDATE jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?")
      .run(`Failed to start ${CLAUDE}: ${err.message}`, job.id);
    running = false;
  });
}

setInterval(tick, 5000);

function body(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => data += c);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function renderJobs() {
  const items = db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 30").all();
  if (items.length === 0) return '<p>No jobs yet.</p>';
  const counts = { pending: 0, running: 0, completed: 0, failed: 0 };
  for (const j of items) counts[j.status] = (counts[j.status] || 0) + 1;

  let html = `<div class="counts">
    <span class="dot pending"></span>${counts.pending} pending
    <span class="dot running"></span>${counts.running} running
    <span class="dot completed"></span>${counts.completed} done
    <span class="dot failed"></span>${counts.failed} failed
  </div>`;

  for (const j of items) {
    html += `<div class="job ${j.status}">
      <div class="job-top"><span class="job-title">${esc(j.title)}</span><span class="badge ${j.status}">${j.status}</span></div>
      <div class="job-meta">${esc(j.repo_path)} · ${j.kind}${j.source ? ' · ' + esc(j.source) : ''} · ${ago(j.created_at)}</div>
      <div class="job-desc">${esc(j.description.slice(0, 300))}${j.description.length > 300 ? '…' : ''}</div>
      ${j.error ? '<div class="job-error">' + esc(j.error) + '</div>' : ''}
      ${j.session_id ? '<div class="job-session">session ' + esc(j.session_id) + '</div>' : ''}
      ${j.result ? '<details><summary>Result</summary><pre>' + esc(parseResult(j.result)) + '</pre></details>' : ''}
    </div>`;
  }
  return html;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function ago(d) {
  const s = Math.floor((Date.now() - new Date(d + 'Z').getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

function parseResult(raw) {
  if (!raw) return '';
  try {
    const j = JSON.parse(raw);
    return j.result || raw;
  } catch { return raw; }
}

const STATUS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Feedback Loop</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0e0f14;color:#e4e4e7;font-family:system-ui,-apple-system,sans-serif;padding:20px;max-width:640px;margin:0 auto;line-height:1.5}
h1{font-size:18px;color:#fff;margin-bottom:4px}
h2{font-size:12px;color:#6b6b7e;text-transform:uppercase;letter-spacing:.6px;margin-bottom:16px}
.counts{display:flex;gap:16px;margin-bottom:20px;font-size:13px;color:#a1a1a9}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:4px;vertical-align:middle}
.dot.pending{background:#a1a1aa}
.dot.running{background:#818cf8}
.dot.completed{background:#34d399}
.dot.failed{background:#f87171}
.job{background:#1a1b23;border-radius:10px;padding:14px;margin-bottom:10px;border-left:3px solid #2a2b36}
.job.pending{border-left-color:#a1a1aa}
.job.running{border-left-color:#818cf8}
.job.completed{border-left-color:#34d399}
.job.failed{border-left-color:#f87171}
.job-title{font-weight:600;font-size:14px;color:#fff}
.job-meta{font-size:11px;color:#6b6b7e;margin-top:4px}
.job-desc{font-size:12px;color:#a1a1a9;margin-top:6px;line-height:1.5;word-break:break-word}
.job-error{font-size:11px;color:#f87171;margin-top:6px;white-space:pre-wrap;word-break:break-word}
.job-session{font-size:10px;color:#6b6b7e;margin-top:4px}
.badge{font-size:10px;font-weight:600;padding:1px 7px;border-radius:6px;text-transform:uppercase;float:right}
.badge.pending{background:#a1a1aa18;color:#a1a1aa}
.badge.running{background:#818cf818;color:#818cf8}
.badge.completed{background:#34d39918;color:#34d399}
.badge.failed{background:#f8717118;color:#f87171}
.job-top{display:flex;justify-content:space-between;align-items:flex-start}
details{margin-top:8px}
summary{font-size:12px;color:#818cf8;cursor:pointer}
pre{font-size:11px;color:#a1a1a9;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto;margin-top:6px;background:#111218;padding:8px;border-radius:6px}
@media(max-width:480px){body{padding:12px}}
</style>
</head>
<body>
<h1>Feedback Loop</h1>
<h2>Claude Code bridge: app bugs and errors → fix + commit</h2>
<div id="jobs">
  ${renderJobs()}
</div>
<script>
setInterval(()=>fetch('/api/jobs').then(r=>r.text()).then(h=>{document.getElementById('jobs').innerHTML=h}),5000)
</script>
</body>
</html>`;

function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  if (path === '/' && method === 'GET') {
    const html = STATUS_HTML.replace(
      '<div id="jobs">',
      `<div id="jobs">${renderJobs()}</div>\n<div id="jobs">`
    ).replace(/\n<div id="jobs">[^]*$/, '');
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
    res.end(html);
    return;
  }

  if (path === '/api/job' && method === 'POST') {
    body(req).then((b) => {
      if (b.secret !== SECRET) { json(res, { error: 'bad secret' }, 401); return; }
      if (!b.title || !b.description || !b.repo) {
        json(res, { error: 'title, description, and repo are required' }, 400);
        return;
      }
      const kind = b.kind === 'error' ? 'error' : 'bug';
      const pending = db.prepare("SELECT COUNT(*) as n FROM jobs WHERE status IN ('pending','running')").get();
      if (pending.n >= 30) { json(res, { error: 'Queue full' }, 429); return; }
      const info = db.prepare('INSERT INTO jobs (kind, title, description, repo_path, source) VALUES (?, ?, ?, ?, ?)')
        .run(kind, b.title, b.description, b.repo.trim(), b.source || '');
      const row = db.prepare('SELECT id, created_at FROM jobs WHERE id = ?').get(Number(info.lastInsertRowid));
      json(res, { id: row.id, created_at: row.created_at, status: 'pending' }, 201);
    });
    return;
  }

  if (path === '/api/jobs' && method === 'GET') {
    const html = renderJobs();
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  res.writeHead(404);
  res.end('not found');
}

createServer(route).listen(PORT, '127.0.0.1', () => console.log(`feedback-loop on http://127.0.0.1:${PORT}`));