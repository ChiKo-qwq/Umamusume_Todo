(() => {
  const listEl = document.getElementById('list');
  const emptyEl = document.getElementById('empty');
  const searchEl = document.getElementById('search');
  const doneCountEl = document.getElementById('done-count');
  const doingCountEl = document.getElementById('doing-count');
  const totalEl = document.getElementById('total');
  const total2El = document.getElementById('total2');
  const progressBarEl = document.getElementById('progress-bar');
  const syncStatusEl = document.getElementById('sync-status');

  const state = { items: [], version: -1, search: '' };

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
        <div class="card readonly">
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

  searchEl.addEventListener('input', () => {
    state.search = searchEl.value.trim();
    render();
  });

  load();
  setInterval(poll, 2000);
})();
