(() => {
  const $ = (id) => document.getElementById(id);
  const list = $('inventory-list');
  const rows = new Map();
  const drafts = new Map();
  let items = [];
  let password = '';
  let filter = 'made';
  let search = '';
  let loading = false;
  let epoch = 0;
  let taobao;
  let syncing = false;
  let verifying = false;
  let previousFocus;
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = (value) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000), cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || (response.status === 409 ? '已有同步正在进行' : '请求失败，请稍后重试'));
      error.status = response.status;
      error.current = data.current;
      throw error;
    }
    return data;
  }
  const auth = () => ({ 'Content-Type': 'application/json', 'X-Password': password });
  function showModal() {
    previousFocus = document.activeElement;
    $('modal-error').hidden = true;
    $('modal-password').value = '';
    $('modal').hidden = false;
    $('modal-password').focus();
  }
  function hideModal() {
    $('modal').hidden = true;
    previousFocus?.focus();
  }
  function lock() {
    password = '';
    for (const draft of drafts.values()) {
      clearTimeout(draft.timer);
      if (!draft.saving && !draft.conflict) {
        draft.error = true;
        draft.message = '修改尚未保存，请解锁后重试保存';
      }
    }
    render();
  }
  function renderSync() {
    if (!taobao) return;
    const ready = taobao.enabled && taobao.configured;
    $('taobao-badge').textContent = !taobao.configured ? '未配置' : !taobao.enabled ? '未启用' : taobao.running ? '同步中' : '已启用';
    const bound = items.filter((item) => item.quantity !== null && item.numIid).length;
    $('taobao-status').textContent = !taobao.configured
      ? '库存会正常保存到服务器。配置淘宝应用和商家授权后，可开启每天 00:00 自动同步。'
      : !taobao.enabled ? '服务器已配置淘宝授权，尚未开启定时同步。'
      : `下次同步：${date(taobao.nextRunAt)}（北京时间） · 已录入并绑定商品 ${bound} 位`;
    const result = taobao.lastRun;
    $('taobao-last').hidden = !result;
    if (result) {
      const labels = { running: '同步中', success: '同步成功', failed: '存在同步失败', partial: '部分库存变动，留待下次同步', empty: '没有可同步的库存，请录入数量并绑定商品', interrupted: '上次同步被中断，请核对淘宝库存' };
      $('taobao-last').textContent = `最近一次：${date(result.startedAt)} · ${labels[result.status] || result.status} · 成功 ${result.succeeded} / 失败 ${result.failed} / 跳过 ${result.skipped}`;
    }
    $('taobao-errors').hidden = !result?.errors?.length;
    $('taobao-errors').querySelector('ul').innerHTML = (result?.errors || []).map((error) => `<li>${escape(items.find((item) => item.id === error.id)?.chineseSimplified || error.id)}：${escape(error.message)}</li>`).join('');
    $('sync-now').disabled = !ready || !password || syncing || taobao.running || drafts.size > 0 || !bound;
    $('sync-now').textContent = syncing || taobao.running ? '同步中…' : '立即同步淘宝';
  }
  function render() {
    $('unlock').textContent = password ? '🔓 锁定编辑' : '🔒 解锁编辑';
    $('unlock').classList.toggle('unlocked', Boolean(password));
    $('stock-total').textContent = items.reduce((total, item) => total + (item.quantity || 0), 0);
    $('stock-characters').textContent = items.filter((item) => item.quantity > 0).length;
    $('stock-unset').textContent = items.filter((item) => item.status === 'done' && item.quantity === null).length;
    let visible = 0;
    for (const item of items) {
      let row = rows.get(item.id);
      if (!row) {
        row = document.createElement('li');
        row.className = 'inventory-card';
        row.dataset.id = item.id;
        row.innerHTML = `<div class="inventory-card-heading"><div class="names"><span class="primary"></span><span class="secondary"></span></div><span class="stock-tag"></span></div>
          <div class="quantity-line"><label for="stock-${escape(item.id)}">可售库存</label><div class="quantity-stepper"><button type="button" class="quantity-step" data-action="decrease" aria-label="${escape(item.chineseSimplified)}库存减1">−</button><input id="stock-${escape(item.id)}" class="quantity-input" type="number" min="0" max="999999" step="1" inputmode="numeric" placeholder="未录入" /><button type="button" class="quantity-step" data-action="increase" aria-label="${escape(item.chineseSimplified)}库存加1">＋</button></div><span>枚</span></div>
          <p class="row-message" role="status" aria-live="polite"></p>
          <div class="draft-actions" hidden><button type="button" data-action="retry">重试保存</button><button type="button" data-action="discard">放弃修改</button></div>
          <details class="product-binding"><summary>淘宝商品绑定</summary><label>商品 ID <input class="product-input" type="text" inputmode="numeric" pattern="[1-9][0-9]{0,19}" placeholder="商品链接中的 id" autocomplete="off" /></label><p>每个角色绑定一个独立商品；留空并保存可解除绑定。</p><button type="button" data-action="binding">保存绑定</button></details>`;
        rows.set(item.id, row);
        list.append(row);
      }
      const draft = drafts.get(item.id);
      row.querySelector('.primary').textContent = item.chineseSimplified;
      row.querySelector('.secondary').textContent = `${item.english} · ${item.japanese}`;
      row.querySelector('.stock-tag').textContent = item.quantity === null ? '未录入' : item.quantity === 0 ? '暂无现货' : '有现货';
      row.querySelector('.stock-tag').classList.toggle('in-stock', item.quantity > 0);
      const quantity = row.querySelector('.quantity-input');
      const product = row.querySelector('.product-input');
      // 轮询不替换输入节点，不覆盖尚未保存的草稿和焦点。
      if (!draft || !Object.hasOwn(draft.patch, 'quantity')) quantity.value = item.quantity ?? '';
      if (!draft || !Object.hasOwn(draft.patch, 'numIid')) product.value = item.numIid;
      quantity.disabled = product.disabled = !password || Boolean(draft?.saving);
      const rawQuantity = draft && Object.hasOwn(draft.patch, 'quantity') ? draft.patch.quantity : item.quantity;
      const currentQuantity = rawQuantity === null ? 0 : /^\d+$/.test(String(rawQuantity)) ? Number(rawQuantity) : NaN;
      const stepDisabled = !password || Boolean(draft?.saving || draft?.conflict) || !Number.isInteger(currentQuantity) || currentQuantity < 0 || currentQuantity > 999999;
      row.querySelector('[data-action="decrease"]').disabled = stepDisabled || currentQuantity <= 0;
      row.querySelector('[data-action="increase"]').disabled = stepDisabled || currentQuantity >= 999999;
      row.querySelector('[data-action="binding"]').disabled = !password || Boolean(draft?.saving);
      row.querySelector('.row-message').textContent = draft?.message || (item.updatedAt ? `已保存到服务器 · ${date(item.updatedAt)}` : '解锁后可录入数量');
      row.querySelector('.row-message').classList.toggle('save-error', Boolean(draft?.error));
      row.querySelector('.draft-actions').hidden = !draft?.error;
      row.querySelector('[data-action="retry"]').disabled = !password || Boolean(draft?.conflict);
      row.querySelector('[data-action="discard"]').textContent = draft?.conflict ? '载入最新库存' : '放弃修改';
      const made = item.status === 'done' || item.quantity !== null || item.numIid;
      const match = [item.chineseSimplified, item.chineseTraditional, item.english, item.japanese].some((name) => name?.toLowerCase().includes(search));
      row.hidden = !match || (filter === 'made' && !made) || (filter === 'stock' && !(item.quantity > 0));
      if (!row.hidden) visible += 1;
    }
    for (const [id, row] of rows) {
      if (!items.some((item) => item.id === id) && !drafts.has(id)) { row.remove(); rows.delete(id); }
    }
    $('inventory-empty').hidden = visible > 0;
    renderSync();
  }
  async function load() {
    if (loading) return;
    loading = true;
    const started = epoch;
    try {
      const data = await request('/api/inventory');
      if (started !== epoch) return;
      items = data.items;
      taobao = data.taobao;
      $('inventory-connection').textContent = drafts.size ? '有修改尚未保存，请查看对应角色的提示' : '已连接服务器 · 每 2 秒更新库存';
      render();
    } catch {
      $('inventory-connection').textContent = '连接中断，正在重试。未保存的修改会保留在当前页面。';
    } finally { loading = false; }
  }
  function edit(id, key, value) {
    if (!password) return;
    const item = items.find((entry) => entry.id === id);
    const draft = drafts.get(id) || { revision: item.revision, patch: {} };
    clearTimeout(draft.timer);
    draft.patch[key] = value;
    if (!draft.conflict) { draft.error = false; draft.message = key === 'numIid' ? '商品绑定尚未保存，请点击「保存绑定」' : '等待自动保存…'; }
    drafts.set(id, draft);
    // 商品绑定需要显式保存，避免输入尚未完成的数字 ID 被自动绑定。
    if (key === 'quantity' && !Object.hasOwn(draft.patch, 'numIid') && !draft.conflict) draft.timer = setTimeout(() => save(id), 700);
    render();
  }
  async function save(id) {
    const draft = drafts.get(id);
    if (!draft || draft.saving || draft.conflict || !password) return;
    clearTimeout(draft.timer);
    if (Object.hasOwn(draft.patch, 'quantity') && !/^\d+$/.test(draft.patch.quantity)) {
      draft.error = true; draft.message = '请输入 0–999999 的整数，留空不会清零'; render(); return;
    }
    const patch = { ...draft.patch };
    if (Object.hasOwn(patch, 'quantity')) patch.quantity = Number(patch.quantity);
    draft.saving = true; draft.message = '正在保存到服务器…'; draft.error = false;
    epoch += 1;
    render();
    try {
      const updated = await request(`/api/inventory/${encodeURIComponent(id)}`, { method: 'POST', headers: auth(), body: JSON.stringify({ ...patch, revision: draft.revision }) });
      const item = items.find((entry) => entry.id === id);
      Object.assign(item, updated);
      drafts.delete(id);
    } catch (error) {
      draft.error = true;
      draft.message = error.message;
      if (error.status === 409) {
        draft.conflict = true;
        draft.message = `其他人已修改（最新库存：${error.current.quantity ?? '未录入'}）。请载入最新库存后重新编辑。`;
      }
      if (error.status === 401) { lock(); showModal(); }
    } finally {
      draft.saving = false;
      epoch += 1;
      render();
      load();
    }
  }
  list.addEventListener('input', (event) => {
    const id = event.target.closest('.inventory-card')?.dataset.id;
    if (event.target.matches('.quantity-input')) edit(id, 'quantity', event.target.value);
    if (event.target.matches('.product-input')) edit(id, 'numIid', event.target.value.trim());
  });
  list.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('input')) { event.preventDefault(); save(event.target.closest('.inventory-card').dataset.id); }
  });
  list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    const id = button.closest('.inventory-card')?.dataset.id;
    if (action === 'decrease' || action === 'increase') {
      const item = items.find((entry) => entry.id === id);
      const draft = drafts.get(id);
      if (!item || !password || draft?.saving || draft?.conflict) return;
      const rawQuantity = draft && Object.hasOwn(draft.patch, 'quantity') ? draft.patch.quantity : item.quantity;
      const currentQuantity = rawQuantity === null ? 0 : /^\d+$/.test(String(rawQuantity)) ? Number(rawQuantity) : NaN;
      const next = currentQuantity + (action === 'increase' ? 1 : -1);
      if (!Number.isInteger(next) || next < 0 || next > 999999) return;
      rows.get(id).querySelector('.quantity-input').value = String(next);
      edit(id, 'quantity', String(next));
    }
    if (action === 'binding' || action === 'retry') save(id);
    if (action === 'discard') {
      clearTimeout(drafts.get(id)?.timer);
      drafts.delete(id); render(); load();
    }
  });
  $('unlock').addEventListener('click', () => password ? lock() : showModal());
  $('modal-cancel').addEventListener('click', hideModal);
  $('modal').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideModal();
    if (event.key === 'Tab') {
      const controls = [...$('unlock-form').querySelectorAll('input, button')].filter((node) => !node.disabled);
      const next = controls[(controls.indexOf(document.activeElement) + (event.shiftKey ? controls.length - 1 : 1)) % controls.length];
      event.preventDefault(); next.focus();
    }
  });
  $('unlock-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (verifying) return;
    verifying = true;
    const candidate = $('modal-password').value;
    try {
      await request('/api/verify', { method: 'POST', headers: { 'X-Password': candidate } });
      password = candidate; hideModal(); render();
    } catch (error) { $('modal-error').textContent = error.message; $('modal-error').hidden = false; }
    finally { verifying = false; }
  });
  $('inventory-search').addEventListener('input', (event) => { search = event.target.value.trim().toLowerCase(); render(); });
  $('inventory-filters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    filter = button.dataset.filter;
    for (const node of $('inventory-filters').querySelectorAll('button')) {
      node.classList.toggle('active', node === button); node.setAttribute('aria-pressed', String(node === button));
    }
    render();
  });
  $('sync-now').addEventListener('click', async () => {
    if (!password || syncing || drafts.size) return;
    if (!window.confirm('将已录入且已绑定商品的可售数量覆盖到淘宝库存。确认数量已扣除售出和预留的御守？')) return;
    syncing = true; renderSync();
    try {
      // 同步可能超过单次页面请求超时；后端仍执行，轮询显示最终结果。
      await request('/api/taobao/sync', { method: 'POST', headers: auth() });
    } catch (error) {
      $('inventory-connection').textContent = `同步请求未确认：${error.message}。请查看最近一次同步结果。`;
      if (error.status === 401) { lock(); showModal(); }
    } finally { syncing = false; load(); renderSync(); }
  });
  window.addEventListener('beforeunload', (event) => {
    if (drafts.size) { event.preventDefault(); event.returnValue = ''; }
  });
  load();
  setInterval(() => { if (!document.hidden) load(); }, 2000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
