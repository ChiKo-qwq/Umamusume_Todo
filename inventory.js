const fs = require('node:fs');
const path = require('node:path');

const MAX_QUANTITY = 999999;
const blank = () => ({ quantity: null, numIid: '', revision: 0, updatedAt: null });
function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function createInventoryStore(file) {
  let state = { version: 0, records: {}, sync: null };
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Number.isSafeInteger(state.version) || state.version < 0 || !state.records || typeof state.records !== 'object' || Array.isArray(state.records)) {
      throw new Error('库存文件格式错误');
    }
    for (const record of Object.values(state.records)) {
      if (!record || !Number.isSafeInteger(record.revision) || record.revision < 0 ||
          (record.quantity !== null && (!Number.isInteger(record.quantity) || record.quantity < 0 || record.quantity > MAX_QUANTITY)) ||
          typeof record.numIid !== 'string' || (record.numIid && !/^[1-9]\d{0,19}$/.test(record.numIid))) {
        throw new Error('库存记录格式错误，请从备份恢复后启动');
      }
    }
  } catch (error) {
    // 损坏的库存不能当作零库存继续同步。
    if (error.code !== 'ENOENT') throw error;
  }
  function commit(next) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
    state = next;
  }
  return {
    snapshot() { return structuredClone(state); },
    get(id) { return structuredClone(Object.hasOwn(state.records, id) ? state.records[id] : blank()); },
    update(id, body) {
      const current = this.get(id);
      if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0) fail(400, '缺少有效的库存版本，请刷新后重试');
      if (body.revision !== current.revision) fail(409, '库存已被其他人修改，请核对最新库存后重试');
      const fields = ['quantity', 'numIid'];
      if (!fields.some((key) => Object.hasOwn(body, key))) fail(400, '没有需要保存的内容');
      const next = { ...current };
      if (Object.hasOwn(body, 'quantity')) {
        if (!Number.isInteger(body.quantity) || body.quantity < 0 || body.quantity > MAX_QUANTITY) {
          fail(400, `库存必须是 0–${MAX_QUANTITY} 的整数`);
        }
        next.quantity = body.quantity;
      }
      for (const key of ['numIid']) {
        if (!Object.hasOwn(body, key)) continue;
        if (typeof body[key] !== 'string' || (body[key] !== '' && !/^[1-9]\d{0,19}$/.test(body[key]))) {
          fail(400, '商品 ID 必须是数字字符串，或留空');
        }
        next[key] = body[key];
      }
      if (next.numIid) {
        const duplicate = Object.entries(state.records).some(([otherId, other]) => otherId !== id &&
          other.numIid === next.numIid);
        if (duplicate) fail(400, '该商品已绑定其他角色，不能重复绑定');
      }
      if (fields.every((key) => next[key] === current[key])) return current;
      next.revision += 1;
      next.updatedAt = new Date().toISOString();
      commit({ ...state, version: state.version + 1, records: { ...state.records, [id]: next } });
      return structuredClone(next);
    },
    setSync(sync) { commit({ ...state, sync: structuredClone(sync) }); },
  };
}

module.exports = { createInventoryStore, MAX_QUANTITY };
