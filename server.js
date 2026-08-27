const express = require('express');
const fs = require('fs');
const path = require('path');
const { scrapeCharacters, charactersToCsv } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

const CHARACTERS_FILE = path.join(__dirname, 'characters.json');
const CSV_FILE = path.join(__dirname, process.env.CSV_PATH || 'umamusume_characters.csv');
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// 角色数据：启动时从文件加载，每天刷新后替换
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

// 勾选状态
let state = { version: 0, done: {} };
try {
  const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (raw && typeof raw === 'object') {
    state.version = Number(raw.version) || 0;
    state.done = raw.done && typeof raw.done === 'object' ? raw.done : {};
  }
} catch (err) {
  // 首次启动
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ version: state.version, done: state.done }, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/items', (req, res) => {
  const items = characters.map((c) => ({ ...c, done: !!state.done[c.id] }));
  res.json({ version: state.version, total: characters.length, items });
});

app.post('/api/items/:id', (req, res) => {
  const id = req.params.id;
  if (!charIds.has(id)) return res.status(404).json({ error: 'Unknown item' });
  const done = !!req.body.done;
  state.done[id] = done;
  state.version += 1;
  save();
  res.json({ id, done, version: state.version });
});

app.post('/api/reset', (req, res) => {
  state.done = {};
  state.version += 1;
  save();
  res.json({ version: state.version });
});

// 手动触发刷新（可选 REFRESH_TOKEN 保护）
app.post('/api/refresh', async (req, res) => {
  const token = process.env.REFRESH_TOKEN;
  if (token) {
    const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.token;
    if (provided !== token) return res.status(403).json({ error: 'Forbidden' });
  }
  if (refreshing) return res.json({ status: 'already-running' });
  res.json({ status: 'started' });
  refresh().catch((err) => console.error('❌ 手动刷新失败：', err.message));
});

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

    // 清理已移除角色的勾选状态
    for (const id of Object.keys(state.done)) {
      if (!charIds.has(id)) delete state.done[id];
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

app.listen(PORT, () => {
  console.log(`✅ Umamusume shared todo list running at http://localhost:${PORT}`);
  scheduleDailyRefresh();
});
