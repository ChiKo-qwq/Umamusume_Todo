(() => {
  const listEl = document.getElementById('list');
  const emptyEl = document.getElementById('empty');
  const searchEl = document.getElementById('search');
  const resetBtn = document.getElementById('reset');
  const doneCountEl = document.getElementById('done-count');
  const totalEl = document.getElementById('total');
  const total2El = document.getElementById('total2');
  const progressBarEl = document.getElementById('progress-bar');
  const syncStatusEl = document.getElementById('sync-status');

  const state = { items: [], version: -1, search: '' };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function matches(item) {
    if (!state.search) return true;
    const q = state.search.toLowerCase();
    return [item.chineseSimplified, item.chineseTraditional, item.english, item.japanese]
      .some((v) => v && v.toLowerCase().includes(q));
  }

  function updateStats() {
    const total = state.items.length;
    const done = state.items.filter((it) => it.done).length;
    totalEl.textContent = total;
    total2El.textContent = total;
    doneCountEl.textContent = done;
    const pct = total ? Math.round((done / total) * 100) : 0;
    progressBarEl.style.width = pct + '%';
  }

  function render() {
    const filtered = state.items.filter(matches);
    listEl.innerHTML = filtered.map((it) => `
      <li class="item${it.done ? ' done' : ''}" data-id="${escapeHtml(it.id)}">
        <label class="card">
          <input type="checkbox" class="check" data-id="${escapeHtml(it.id)}" ${it.done ? 'checked' : ''} />
          <span class="names">
            <span class="primary">${escapeHtml(it.chineseSimplified)}</span>
            <span class="secondary">${escapeHtml(it.english)} · ${escapeHtml(it.japanese)} · ${escapeHtml(it.chineseTraditional)}</span>
          </span>
        </label>
      </li>`).join('');
    emptyEl.hidden = filtered.length !== 0;
    updateStats();
  }

  // 只更新已渲染的 checkbox，避免整页重建导致交互中断
  function updateChecks() {
    for (const it of state.items) {
      const li = listEl.querySelector(`li[data-id="${CSS.escape(it.id)}"]`);
      if (!li) continue;
      li.classList.toggle('done', it.done);
      const cb = li.querySelector('.check');
      if (cb) cb.checked = it.done;
    }
    updateStats();
  }

  async function load() {
    const res = await fetch('/api/items');
    const data = await res.json();
    state.items = data.items;
    state.version = data.version;
    render();
  }

  async function poll() {
    try {
      const res = await fetch('/api/items');
      const data = await res.json();
      syncStatusEl.textContent = '已同步';
      if (data.version !== state.version) {
        state.items = data.items;
        state.version = data.version;
        updateChecks();
      }
    } catch (e) {
      syncStatusEl.textContent = '连接中断，正在重试…';
    }
  }

  listEl.addEventListener('change', (e) => {
    const cb = e.target.closest('.check');
    if (!cb) return;
    const id = cb.dataset.id;
    const done = cb.checked;
    // 乐观更新
    const it = state.items.find((x) => x.id === id);
    if (it) it.done = done;
    const li = cb.closest('.item');
    if (li) li.classList.toggle('done', done);
    updateStats();
    // 持久化
    fetch(`/api/items/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done }),
    }).catch(() => { syncStatusEl.textContent = '保存失败，稍后自动重试'; });
  });

  searchEl.addEventListener('input', () => {
    state.search = searchEl.value.trim();
    render();
  });

  resetBtn.addEventListener('click', async () => {
    if (!confirm('确定要清除所有勾选状态吗？')) return;
    try {
      await fetch('/api/reset', { method: 'POST' });
      await load();
    } catch (e) {
      syncStatusEl.textContent = '重置失败，请重试';
    }
  });

  load();
  setInterval(poll, 2000);
})();
