const crypto = require('node:crypto');

const DAY = 86400000;
const OFFSET = 8 * 3600000;
const shanghaiDate = (now = Date.now()) => new Date(Number(now) + OFFSET).toISOString().slice(0, 10);
const nextMidnight = (now = Date.now()) => (Math.floor((Number(now) + OFFSET) / DAY) + 1) * DAY - OFFSET;
const timestamp = (now = Date.now()) => new Date(Number(now) + OFFSET).toISOString().slice(0, 19).replace('T', ' ');

function sign(params, secret) {
  const content = Object.keys(params).filter((key) => key !== 'sign' && params[key] !== '')
    .sort().map((key) => key + params[key]).join('');
  return crypto.createHash('md5').update(secret + content + secret, 'utf8').digest('hex').toUpperCase();
}

function createTaobaoClient(env = process.env, fetchImpl = fetch) {
  const enabled = env.TAOBAO_SYNC_ENABLED === 'true';
  const configured = Boolean(env.TAOBAO_APP_KEY && env.TAOBAO_APP_SECRET && env.TAOBAO_SESSION);
  return {
    enabled, configured,
    async update(record) {
      if (!enabled || !configured) throw new Error('淘宝同步尚未启用或缺少授权');
      const params = {
        method: 'taobao.item.quantity.update', app_key: env.TAOBAO_APP_KEY,
        session: env.TAOBAO_SESSION, sign_method: 'md5', timestamp: timestamp(),
        format: 'json', v: '2.0', num_iid: record.numIid,
        quantity: String(record.quantity), type: '1',
      };
      params.sign = sign(params, env.TAOBAO_APP_SECRET);
      let response;
      try {
        response = await fetchImpl('https://eco.taobao.com/router/rest', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
          body: new URLSearchParams(params), signal: AbortSignal.timeout(15000), redirect: 'error',
        });
      } catch {
        throw new Error('淘宝请求超时或网络异常，请核对淘宝后台后重试');
      }
      if (!response.ok) throw new Error(`淘宝 HTTP 请求失败（${response.status}）`);
      let data;
      try { data = await response.json(); } catch { throw new Error('淘宝返回了无效响应'); }
      if (data.error_response) {
        // 不返回远端的原始 msg/sub_msg，避免错误内容带出 session 等凭据。
        const code = String(data.error_response.code || '').replace(/[^0-9]/g, '').slice(0, 8);
        throw new Error(`淘宝拒绝同步（错误码 ${code || '未知'}），请检查商家授权、接口权限及商品绑定`);
      }
      if (!data.item_quantity_update_response?.item) throw new Error('淘宝未返回库存更新结果');
    },
  };
}

function createTaobaoSync({ store, client, getCharacters, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let running = false;
  let timer;
  let stopped = false;
  function status() {
    return {
      enabled: client.enabled, configured: client.configured, running,
      nextRunAt: client.enabled && client.configured ? new Date(nextMidnight(now())).toISOString() : null,
      lastRun: store.snapshot().sync,
    };
  }
  async function run(trigger = 'manual') {
    if (running) return { busy: true };
    if (!client.enabled || !client.configured) return { unavailable: true };
    running = true;
    try {
      const snapshot = store.snapshot();
      const ids = new Set(getCharacters().map((item) => item.id));
      const records = Object.entries(snapshot.records).filter(([id, record]) => ids.has(id) && record.quantity !== null && record.numIid);
      const result = {
        status: 'running', trigger, startedAt: new Date(now()).toISOString(), finishedAt: null,
        scheduledDate: trigger === 'scheduled' ? shanghaiDate(now()) : snapshot.sync?.scheduledDate || null,
        total: records.length, succeeded: 0, failed: 0, skipped: 0, errors: [],
      };
      store.setSync(result);
      for (const [id, record] of records) {
        // 排队过程中被修改的库存留待下次同步，避免发送过期快照。
        if (store.get(id).revision !== record.revision) {
          result.skipped += 1;
          continue;
        }
        try {
          await client.update(record);
          result.succeeded += 1;
        } catch (error) {
          result.failed += 1;
          result.errors.push({ id, message: error.message });
        }
        store.setSync(result);
      }
      result.status = result.failed ? 'failed' : result.skipped ? 'partial' : records.length ? 'success' : 'empty';
      result.finishedAt = new Date(now()).toISOString();
      store.setSync(result);
      return result;
    } finally {
      running = false;
    }
  }
  async function scheduled() {
    try { await run('scheduled'); } catch { console.error('淘宝同步记录保存失败，请检查数据目录'); }
  }
  function arm() {
    if (stopped || !client.enabled || !client.configured) return;
    timer = setTimer(async () => {
      await scheduled();
      arm();
    }, Math.max(1, nextMidnight(now()) - now()));
    timer.unref?.();
  }
  function start() {
    stopped = false;
    const previous = store.snapshot().sync;
    // 中断的任务不宣称成功；避免重启时自动重放可能已生效的淘宝写入。
    if (previous?.status === 'running') store.setSync({ ...previous, status: 'interrupted', finishedAt: new Date(now()).toISOString() });
    arm();
  }
  return { status, run, start, stop() { stopped = true; clearTimer(timer); } };
}

module.exports = { createTaobaoClient, createTaobaoSync, nextMidnight, shanghaiDate, timestamp, sign };
