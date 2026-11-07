const q = document.getElementById('queue');
const counts = { pct: 0, rct: 0, fct: 0, qct: 0 };

function ago(d) {
  const s = Math.floor((Date.now() - new Date(d + 'Z').getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m`;
  if (s < 86400) return `${Math.floor(s/3600)}h`;
  return `${Math.floor(s/86400)}d`;
}

function card(item) {
  const expanded = item.expanded ? ' item-expanded' : '';
  const detailEl = item.expanded
    ? `<div class="item-detail">${esc(item.description)}</div>
       ${item.result ? `<div style="margin-top:8px;color:#8b8b9e;font-size:11px">Session: <code>${esc(item.session_id || '-')}</code></div>` : ''}
       ${item.error ? `<div style="margin-top:8px;color:#f87171;font-size:12px;white-space:pre-wrap">${esc(item.error)}</div>` : ''}`
    : `<span class="item-expand" onclick="toggleItem(${item.id})">Show details</span>`;

  let actions = '';
  if (item.status === 'failed') {
    actions = `<div class="item-actions"><button class="run" onclick="rerun(${item.id})">Re-run</button><button class="archive" onclick="archive(${item.id})">Archive</button></div>`;
  } else if (item.status === 'completed') {
    actions = `<div class="item-actions"><button class="archive" onclick="archive(${item.id})">Archive</button></div>`;
  }

  return `<div class="item ${item.status}${expanded}" id="item-${item.id}">
    <div class="item-top">
      <span class="item-title">${esc(item.title)}</span>
      <span class="item-badge ${item.status}">${item.status}</span>
    </div>
    <div class="item-meta">
      <span>${esc(item.repo_path)}</span>
      <span>${ago(item.created_at)}</span>
      ${item.source ? `<span>via ${esc(item.source)}</span>` : ''}
    </div>
    ${item.expanded ? detailEl : ''}
    ${!item.expanded ? detailEl : ''}
    ${actions}
  </div>`;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function loadQueue() {
  try {
    const r = await fetch('/api/items');
    const items = await r.json();
    counts.pct = items.filter(i => i.status === 'pending').length;
    counts.rct = items.filter(i => i.status === 'running').length;
    counts.fct = items.filter(i => i.status === 'failed').length;
    counts.qct = items.length;
    document.getElementById('pct').textContent = counts.pct;
    document.getElementById('rct').textContent = counts.rct;
    document.getElementById('fct').textContent = counts.fct;
    document.getElementById('queue-count').textContent = counts.qct ? `(${counts.qct})` : '';
    q.innerHTML = items.length
      ? items.map(card).join('')
      : '<div class="empty-state"><p>---</p><p>Nothing in the queue. File a bug above.</p></div>';
  } catch {}
}

function toggleItem(id) {
  const el = document.getElementById(`item-${id}`);
  el.classList.toggle('item-expanded');
  loadQueue();
}

async function rerun(id) {
  await fetch(`/api/items/${id}/run`, { method: 'POST' });
  loadQueue();
}

async function archive(id) {
  await fetch(`/api/items/${id}/archive`, { method: 'POST' });
  loadQueue();
}

document.getElementById('bug-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  const errEl = document.getElementById('form-err');
  btn.disabled = true;
  errEl.textContent = '';
  try {
    const r = await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: document.getElementById('title').value,
        description: document.getElementById('description').value,
        repo_path: document.getElementById('repo-path').value,
      }),
    });
    if (r.ok) {
      document.getElementById('title').value = '';
      document.getElementById('description').value = '';
      document.getElementById('repo-path').value = '';
      loadQueue();
    } else {
      const b = await r.json();
      errEl.textContent = b.error || 'Failed to submit';
    }
  } catch (err) {
    errEl.textContent = 'Network error';
  }
  btn.disabled = false;
});

loadQueue();
setInterval(loadQueue, 3000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
}