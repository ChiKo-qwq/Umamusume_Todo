const express = require('express');
const fs = require('fs');
const path = require('path');
const { scrapeCharacters, charactersToCsv } = require('./scraper');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.PASSWORD || '20120314';

const CHARACTERS_FILE = path.join(__dirname, 'characters.json');
const CSV_FILE = path.join(__dirname, process.env.CSV_PATH || 'umamusume_characters.csv');
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const STATUSES = ['none', 'doing', 'done'];

function loadCharacters() {
  try {
    return JSON.parse(fs.readFileSync(CHARACTERS_FILE, 'utf8'));
  } catch (err) {
    console.error('无法读取 characters.json，使用空列表：', err.message);
    return [];
  }
}
let characters = loadCharacters();
let charIds = new Set(characters.map((c) => c.id));

// 状态：status[id] = 'doing' | 'done'（'none' 不存储）
let state = { version: 0, status: {} };
try {
  const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (raw && typeof raw === 'object') {
    state.version = Number(raw.version) || 0;
    if (raw.status && typeof raw.status === 'object') {
      state.status = raw.status;
    } else if (raw.done && typeof raw.done === 'object') {
      state.status = {};
      for (const [id, v] of Object.entries(raw.done)) {
        if (v) state.status[id] = 'done';
      }
    }
  }
} catch (err) {
  // 首次启动
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ version: state.version, status: state.status }, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

function itemsPayload() {
  const items = characters.map((c) => ({ ...c, status: state.status[c.id] || 'none' }));
  return { version: state.version, total: characters.length, items };
}

function checkPassword(req) {
  const provided = req.headers['x-password'];
  return provided != null && String(provided) === PASSWORD;
}

// ---------- 每日刷新 ----------
let refreshing = false;

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  console.log('🔄 开始刷新角色数据…');
  try {
    const chars = await scrapeCharacters();
    fs.writeFileSync(CHARACTERS_FILE, JSON.stringify(chars, null, 2));
    fs.writeFileSync(CSV_FILE, charactersToCsv(chars));

    characters = chars;
    charIds = new Set(chars.map((c) => c.id));

    for (const id of Object.keys(state.status)) {
      if (!charIds.has(id)) delete state.status[id];
    }
    save();

    console.log(`✅ 刷新完成：${chars.length} 个角色，已更新 characters.json 与 ${path.basename(CSV_FILE)}`);
  } catch (err) {
    console.error('❌ 刷新失败，沿用旧数据：', err.message);
  } finally {
    refreshing = false;
  }
}

function scheduleDailyRefresh() {
  const hour = Number(process.env.REFRESH_HOUR ?? 0);
  const minute = Number(process.env.REFRESH_MINUTE ?? 0);

  const tick = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const ms = next - now;
    const when = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    console.log(`⏰ 计划下次刷新：${next.toLocaleString()}（每天 ${when}，服务器本地时间）`);
    setTimeout(async () => {
      await refresh();
      tick();
    }, ms);
  };
  tick();
}

// ---------- 应用（单端口，读取公开，写入需密码） ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/items', (req, res) => res.json(itemsPayload()));

app.post('/api/verify', (req, res) => {
  if (checkPassword(req)) res.json({ ok: true });
  else res.status(401).json({ ok: false, error: '密码错误' });
});

app.post('/api/items/:id', (req, res) => {
  if (!checkPassword(req)) return res.status(401).json({ error: '密码错误' });
  const id = req.params.id;
  if (!charIds.has(id)) return res.status(404).json({ error: 'Unknown item' });
  const status = req.body && req.body.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  if (status === 'none') delete state.status[id];
  else state.status[id] = status;
  state.version += 1;
  save();
  res.json({ id, status, version: state.version });
});

app.post('/api/reset', (req, res) => {
  if (!checkPassword(req)) return res.status(401).json({ error: '密码错误' });
  state.status = {};
  state.version += 1;
  save();
  res.json({ version: state.version });
});

app.post('/api/refresh', async (req, res) => {
  if (!checkPassword(req)) return res.status(401).json({ error: '密码错误' });
  if (refreshing) return res.json({ status: 'already-running' });
  res.json({ status: 'started' });
  refresh().catch((err) => console.error('❌ 手动刷新失败：', err.message));
});

app.listen(PORT, () => {
  console.log(`✅ URA守札社 running at http://localhost:${PORT}`);
  scheduleDailyRefresh();
});
