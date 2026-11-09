const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { createInventoryStore } = require('../inventory');
const { createTaobaoClient, createTaobaoSync, nextMidnight, timestamp, sign } = require('../taobao');
const { startTestServer } = require('../scripts/inventory-test-server');

let server;
let ids;
before(async () => {
  const probe = net.createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  server = startTestServer({ port });
  await server.ready;
  ids = (await (await fetch(server.url + '/api/items')).json()).items.map((item) => item.id);
});
after(async () => { if (server) await server.stop(); });

async function post(route, body, password = server.password) {
  const response = await fetch(server.url + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Password': password },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
function temporaryStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omamori-inventory-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'inventory.json');
  return { file, store: createInventoryStore(file) };
}

test('公开读取、密码保护、严格数量校验和缺失角色', async () => {
  const response = await fetch(server.url + '/api/inventory');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.equal(data.items.length, ids.length);
  assert.equal(data.items[0].quantity, null);
  assert.equal(data.taobao.enabled, false);
  assert.equal((await post('/api/inventory/' + ids[0], { revision: 0, quantity: 3 }, 'wrong')).status, 401);
  for (const quantity of [-1, 0.5, '12', null, 1000000]) {
    assert.equal((await post('/api/inventory/' + ids[0], { revision: 0, quantity })).status, 400);
  }
  assert.equal((await post('/api/inventory/unknown', { revision: 0, quantity: 1 })).status, 404);
  assert.equal((await post('/api/inventory/' + ids[0], { quantity: 1 })).status, 400);
});

test('库存保存到磁盘、并发编辑冲突和清单重置互不影响', async () => {
  const route = '/api/inventory/' + ids[0];
  const a = post(route, { revision: 0, quantity: 12 });
  const b = post(route, { revision: 0, quantity: 24 });
  const results = await Promise.all([a, b]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const saved = results.find((result) => result.status === 200).data;
  assert.equal(results.find((result) => result.status === 409).data.current.quantity, saved.quantity);
  assert.equal(createInventoryStore(path.join(server.directory, 'data/inventory.json')).get(ids[0]).quantity, saved.quantity);
  await post('/api/items/' + ids[0], { status: 'done' });
  await post('/api/reset', {});
  const data = await (await fetch(server.url + '/api/inventory')).json();
  assert.equal(data.items[0].status, 'none');
  assert.equal(data.items[0].quantity, saved.quantity);
  assert.equal((await post(route, { revision: saved.revision, quantity: 0 })).data.quantity, 0);
});

test('商品 ID 保持精度、不能重复绑定，零库存仍可绑定和解除', async () => {
  const numIid = '9007199254740993123';
  const a = await post('/api/inventory/' + ids[1], { revision: 0, numIid, quantity: 0 });
  assert.equal(a.status, 200);
  assert.equal(a.data.numIid, numIid);
  assert.equal((await post('/api/inventory/' + ids[2], { revision: 0, numIid })).status, 400);
  assert.equal((await post('/api/inventory/' + ids[2], { revision: 0, numIid: 'https://item.taobao.com' })).status, 400);
  assert.equal((await post('/api/inventory/' + ids[1], { revision: a.data.revision, numIid: '' })).data.numIid, '');
  assert.equal((await post('/api/taobao/sync', {}, 'wrong')).status, 401);
  assert.equal((await post('/api/taobao/sync', {})).status, 503);
});

test('磁盘写入失败不更新内存；损坏文件不能被默认为空库存', (t) => {
  const { store, file } = temporaryStore(t);
  store.update('a', { revision: 0, quantity: 5 });
  fs.mkdirSync(file + '.tmp');
  assert.throws(() => store.update('a', { revision: 1, quantity: 10 }));
  assert.equal(store.get('a').quantity, 5);
  fs.writeFileSync(file, 'broken-json');
  assert.throws(() => createInventoryStore(file));
});

const credentials = { TAOBAO_SYNC_ENABLED: 'true', TAOBAO_APP_KEY: 'test-app', TAOBAO_APP_SECRET: 'test-secret', TAOBAO_SESSION: 'private-session' };
test('淘宝请求使用 HTTPS、带签名和商家授权，明确发送 0 库存和全量模式', async () => {
  let captured;
  const client = createTaobaoClient(credentials, async (url, options) => {
    captured = { url, options, params: Object.fromEntries(options.body) };
    return { ok: true, json: async () => ({ item_quantity_update_response: { item: { num: 0 } } }) };
  });
  await client.update({ numIid: '9007199254740993123', quantity: 0 });
  assert.equal(captured.url, 'https://eco.taobao.com/router/rest');
  assert.equal(captured.params.method, 'taobao.item.quantity.update');
  assert.equal(captured.params.quantity, '0');
  assert.equal(captured.params.type, '1');
  assert.equal(captured.params.num_iid, '9007199254740993123');
  assert.equal(captured.params.session, 'private-session');
  assert.equal(captured.params.sign, sign(captured.params, 'test-secret'));
  assert.equal(captured.options.redirect, 'error');
  // 固定签名向量：MD5("secret" + "a1b2" + "secret")。
  assert.equal(sign({ b: '2', a: '1', sign: 'ignored' }, 'secret'), 'EF16F26C937CF52AE6F85DF2FD08B24A');
});

test('淘宝业务错误、HTTP 错误、超时和畸形响应不得视为成功或泄露凭据', async () => {
  const responses = [
    async () => ({ ok: true, json: async () => ({ error_response: { code: 27, sub_msg: 'private-session test-secret' } }) }),
    async () => ({ ok: false, status: 503 }),
    async () => { throw new Error('private-session'); },
    async () => ({ ok: true, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => { throw new Error('bad-json'); } }),
  ];
  for (const response of responses) {
    await assert.rejects(createTaobaoClient(credentials, response).update({ numIid: '1', quantity: 3 }), (error) => {
      assert.doesNotMatch(error.message, /private-session|test-secret/);
      return true;
    });
  }
});

test('零点计算独立于服务器时区，覆盖月末/年末/恰好零点', () => {
  const cases = [
    ['2026-11-09T15:59:59.999Z', '2026-11-09T16:00:00.000Z'],
    ['2026-11-09T16:00:00.000Z', '2026-11-10T16:00:00.000Z'],
    ['2026-12-31T15:00:00.000Z', '2026-12-31T16:00:00.000Z'],
    ['2026-12-31T16:00:00.000Z', '2027-01-01T16:00:00.000Z'],
  ];
  for (const [input, expected] of cases) assert.equal(new Date(nextMidnight(Date.parse(input))).toISOString(), expected);
  assert.equal(timestamp(Date.parse('2026-11-09T16:00:00Z')), '2026-11-10 00:00:00');
});

test('同步跳过未录入、未绑定和已移除角色；零库存参与，部分失败继续并持久化', async (t) => {
  const { store, file } = temporaryStore(t);
  store.update('zero', { revision: 0, quantity: 0, numIid: '1' });
  store.update('fail', { revision: 0, quantity: 8, numIid: '2' });
  store.update('success', { revision: 0, quantity: 12, numIid: '3' });
  store.update('unset', { revision: 0, numIid: '4' });
  store.update('unbound', { revision: 0, quantity: 8 });
  store.update('removed', { revision: 0, quantity: 8, numIid: '5' });
  const calls = [];
  const sync = createTaobaoSync({ store, getCharacters: () => ['zero', 'fail', 'success', 'unset', 'unbound'].map((id) => ({ id })), client: {
    enabled: true, configured: true, async update(record) { calls.push(record.quantity); if (record.numIid === '2') throw new Error('授权失效'); },
  } });
  const result = await sync.run();
  assert.deepEqual(calls, [0, 8, 12]);
  assert.equal(result.status, 'failed');
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 1);
  assert.equal(createInventoryStore(file).snapshot().sync.errors[0].id, 'fail');
});

test('任务不能重叠；同步快照不会覆盖途中新增库存；调度每天重新计算', async (t) => {
  const { store } = temporaryStore(t);
  store.update('a', { revision: 0, quantity: 5, numIid: '1' });
  store.update('b', { revision: 0, quantity: 6, numIid: '2' });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  let now = Date.parse('2026-11-09T15:59:59Z');
  const timers = [];
  const sync = createTaobaoSync({ store, getCharacters: () => [{ id: 'a' }, { id: 'b' }], now: () => now,
    setTimer(callback, delay) { timers.push({ callback, delay }); return { unref() {} }; }, clearTimer() {},
    client: { enabled: true, configured: true, async update(record) { calls.push(record.quantity); await gate; } },
  });
  sync.start();
  assert.equal(timers[0].delay, 1000);
  now += 1000;
  const running = timers[0].callback();
  assert.deepEqual(await sync.run(), { busy: true });
  store.update('a', { revision: 1, quantity: 9 });
  store.update('b', { revision: 1, quantity: 10 });
  release();
  await running;
  assert.deepEqual(calls, [5]);
  assert.equal(store.get('a').quantity, 9);
  assert.equal(store.snapshot().sync.skipped, 1);
  assert.equal(store.snapshot().sync.status, 'partial');
  assert.equal(timers[1].delay, 86400000);
  assert.equal(store.snapshot().sync.scheduledDate, '2026-11-10');
  sync.stop();
});

test('重启保留上次结果，中断任务有明确状态；无授权不设定计时器', (t) => {
  const { store } = temporaryStore(t);
  store.setSync({ status: 'running', startedAt: new Date().toISOString() });
  const sync = createTaobaoSync({ store, client: { enabled: true, configured: false }, getCharacters: () => [],
    setTimer() { assert.fail('未授权不应调度'); },
  });
  sync.start();
  assert.equal(store.snapshot().sync.status, 'interrupted');
  assert.equal(sync.status().nextRunAt, null);
});
