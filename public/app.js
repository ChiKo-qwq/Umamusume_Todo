(() => {
  const listEl = document.getElementById('list');
  const emptyEl = document.getElementById('empty');
  const searchEl = document.getElementById('search');
  const resetBtn = document.getElementById('reset');
  const doneCountEl = document.getElementById('done-count');
  const doingCountEl = document.getElementById('doing-count');
  const totalEl = document.getElementById('total');
  const total2El = document.getElementById('total2');
  const progressBarEl = document.getElementById('progress-bar');
  const syncStatusEl = document.getElementById('sync-status');

  const state = { items: [], version: -1, search: '' };

  const NEXT = { none: 'doing', doing: 'done', done: 'none' };
  const LABEL = { none: '未开始', doing: '制作中', done: '已完成' };

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
    const done = state.items.filter((it) => it.status === 'done').length;
    const doing = state.items.filter((it) => it.status === 'doing').length;
    totalEl.textContent = total;
    total2El.textContent = total;
    doneCountEl.textContent = done;
    doingCountEl.textContent = doing;
    const pct = total ? Math.round((done / total) * 100) : 0;
    progressBarEl.style.width = pct + '%';
  }

  function render() {
    const filtered = state.items.filter(matches);
    listEl.innerHTML = filtered.map((it) => `
      <li class="item st-${it.status}" data-id="${escapeHtml(it.id)}">
        <div class="card" data-id="${escapeHtml(it.id)}" title="点击切换状态">
          <span class="status st-${it.status}">${LABEL[it.status]}</span>
          <span class="names">
            <span class="primary">${escapeHtml(it.chineseSimplified)}</span>
            <span class="secondary">${escapeHtml(it.english)} · ${escapeHtml(it.japanese)} · ${escapeHtml(it.chineseTraditional)}</span>
          </span>
        </div>
      </li>`).join('');
    emptyEl.hidden = filtered.length !== 0;
    updateStats();
  }

  // 只更新已渲染的状态标签，避免整页重建导致交互中断
  function updateChecks() {
    for (const it of state.items) {
      const li = listEl.querySelector(`li[data-id="${CSS.escape(it.id)}"]`);
      if (!li) continue;
      li.className = `item st-${it.status}`;
      const badge = li.querySelector('.status');
      if (badge) {
        badge.className = `status st-${it.status}`;
        badge.textContent = LABEL[it.status];
      }
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

  function cycle(id) {
    const it = state.items.find((x) => x.id === id);
    if (!it) return;
    const next = NEXT[it.status] || 'doing';
    it.status = next;

    const li = listEl.querySelector(`li[data-id="${CSS.escape(id)}"]`);
    if (li) {
      li.className = `item st-${next}`;
      const badge = li.querySelector('.status');
      if (badge) {
        badge.className = `status st-${next}`;
        badge.textContent = LABEL[next];
      }
    }
    updateStats();

    fetch(`/api/items/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    }).catch(() => { syncStatusEl.textContent = '保存失败，稍后自动重试'; });
  }

  listEl.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) cycle(card.dataset.id);
  });

  searchEl.addEventListener('input', () => {
    state.search = searchEl.value.trim();
    render();
  });

  resetBtn.addEventListener('click', async () => {
    if (!confirm('确定要清除所有状态吗？')) return;
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
