(() => {
  const listEl = document.getElementById('list');
  const emptyEl = document.getElementById('empty');
  const searchEl = document.getElementById('search');
  const unlockBtn = document.getElementById('unlock');
  const modalEl = document.getElementById('modal');
  const modalPasswordEl = document.getElementById('modal-password');
  const modalOkBtn = document.getElementById('modal-ok');
  const modalCancelBtn = document.getElementById('modal-cancel');
  const modalErrorEl = document.getElementById('modal-error');
  const doneCountEl = document.getElementById('done-count');
  const doingCountEl = document.getElementById('doing-count');
  const totalEl = document.getElementById('total');
  const total2El = document.getElementById('total2');
  const progressBarEl = document.getElementById('progress-bar');
  const syncStatusEl = document.getElementById('sync-status');
  const statusFiltersEl = document.getElementById('status-filters');

  const state = { items: [], version: -1, search: '', filter: 'all' };
  let unlocked = false;
  let password = '';

  const NEXT = { none: 'doing', doing: 'done', done: 'none' };
  const LABEL = { none: '未开始', doing: '制作中', done: '已完成' };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function matches(item) {
    if (state.filter !== 'all' && item.status !== state.filter) return false;
    if (!state.search) return true;
    const q = state.search.toLowerCase();
    return [item.chineseSimplified, item.chineseTraditional, item.english, item.japanese]
      .some((v) => v && v.toLowerCase().includes(q));
  }

  function setFilter(filter) {
    state.filter = filter;
    for (const button of statusFiltersEl.querySelectorAll('.filter-btn')) {
      const selected = button.dataset.filter === filter;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    render();
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
        <div class="card" data-id="${escapeHtml(it.id)}" title="${unlocked ? '点击切换状态' : '需解锁后才能修改'}">
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
      syncStatusEl.textContent = unlocked ? '已同步 · 可修改' : '已同步';
      if (data.version !== state.version) {
        state.items = data.items;
        state.version = data.version;
        render();
      }
    } catch (e) {
      syncStatusEl.textContent = '连接中断，正在重试…';
    }
  }

  function setLockedUI() {
    if (unlocked) {
      unlockBtn.textContent = '🔓 锁定';
      unlockBtn.classList.add('unlocked');
    } else {
      unlockBtn.textContent = '🔒 解锁';
      unlockBtn.classList.remove('unlocked');
    }
  }

  function showModal() {
    modalErrorEl.hidden = true;
    modalPasswordEl.value = '';
    modalEl.hidden = false;
    modalPasswordEl.focus();
  }

  function hideModal() {
    modalEl.hidden = true;
  }

  async function doUnlock() {
    const pw = modalPasswordEl.value.trim();
    if (!pw) {
      modalErrorEl.textContent = '请输入密码';
      modalErrorEl.hidden = false;
      return;
    }
    try {
      const res = await fetch('/api/verify', { method: 'POST', headers: { 'X-Password': pw } });
      if (res.ok) {
        unlocked = true;
        password = pw;
        hideModal();
        setLockedUI();
        syncStatusEl.textContent = '已解锁，可修改';
      } else {
        modalErrorEl.textContent = '密码错误';
        modalErrorEl.hidden = false;
        modalPasswordEl.value = '';
        modalPasswordEl.focus();
      }
    } catch (e) {
      modalErrorEl.textContent = '验证失败，请重试';
      modalErrorEl.hidden = false;
    }
  }

  unlockBtn.addEventListener('click', () => {
    if (unlocked) {
      unlocked = false;
      password = '';
      setLockedUI();
      syncStatusEl.textContent = '已锁定';
    } else {
      showModal();
    }
  });

  modalOkBtn.addEventListener('click', doUnlock);
  modalCancelBtn.addEventListener('click', hideModal);
  modalPasswordEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doUnlock();
    if (e.key === 'Escape') hideModal();
  });

  function cycle(id) {
    if (!unlocked) {
      showModal();
      return;
    }
    const it = state.items.find((x) => x.id === id);
    if (!it) return;
    const next = NEXT[it.status] || 'doing';
    it.status = next;
    render();

    fetch(`/api/items/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Password': password },
      body: JSON.stringify({ status: next }),
    }).then((res) => {
      if (res.status === 401) {
        unlocked = false;
        password = '';
        setLockedUI();
        syncStatusEl.textContent = '密码已失效，请重新解锁';
        load();
        showModal();
      }
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

  statusFiltersEl.addEventListener('click', (e) => {
    const button = e.target.closest('.filter-btn');
    if (button) setFilter(button.dataset.filter);
  });

  setLockedUI();
  load();
  setInterval(poll, 2000);
})();
