// 每日抓取：umamusu.wiki（英/日/繁中）+ biligame（简中），产出角色数组与 CSV。
const cheerio = require('cheerio');

const BASE = 'https://umamusu.wiki';
const BILI_BASE = 'https://wiki.biligame.com/umamusume';
const LIST_URL = BASE + '/List_of_Characters';
const BILI_LIST_URL = 'https://wiki.biligame.com/umamusume/%E8%B5%9B%E9%A9%AC%E5%A8%98%E4%B8%80%E8%A7%88';

const UA = 'Mozilla/5.0 (UmamusumeTodoScraper/1.0; daily-refresh)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, { retries = 5 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      // biligame 会限流（429/514），5xx 也退避重试
      if (res.status === 429 || res.status === 514 || res.status >= 500) {
        await sleep(2000 + attempt * 2000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      await sleep(2000 + attempt * 2000);
    }
  }
  throw lastErr;
}

// 并发受限的 map
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------- umamusu.wiki ----------
function getUmamusumeLinks(html) {
  const $ = cheerio.load(html);
  const section = $('#Umamusume').parent().next();
  const links = [];
  section.find('.name-box a').each((_, el) => {
    const a = $(el);
    const name = a.attr('title') || a.text().trim();
    const href = a.attr('href');
    if (href) links.push({ name, href });
  });
  return links;
}

function parseCharacterPage(html) {
  const $ = cheerio.load(html);
  const result = { english: '', japanese: '', chinese: '' };
  $('tr').each((_, tr) => {
    const tds = $(tr).children('td');
    if (tds.length < 2) return;
    const label = $(tds[0]).text().replace(/\s+/g, ' ').trim();
    const value = $(tds[1]).text().replace(/\s+/g, ' ').trim();
    if (label === 'English' && !result.english) result.english = value;
    else if (label === 'Japanese' && !result.japanese) result.japanese = value;
    else if (label.includes('Chinese') && !result.chinese) result.chinese = value;
  });
  return result;
}

// ---------- biligame ----------
function getBiliBaseChars(html) {
  const $ = cheerio.load(html);
  const base = new Map();
  $('center').each((_, c) => {
    const a = $(c).find('a').first();
    if (!a.length) return;
    const title = a.attr('title');
    // 只取基础角色（无换装前缀 【】）
    if (title && !title.includes('【') && !title.includes('】')) {
      if (!base.has(title)) base.set(title, a.attr('href'));
    }
  });
  return base;
}

function parseBiliWikitext(wt) {
  const jp = wt.match(/^\|日文名=([^\n|]*)/m);
  const zh = wt.match(/^\|中文名=([^\n|]*)/m);
  return { jp: jp ? jp[1].trim() : '', zh: zh ? zh[1].trim() : '' };
}

function buildRawUrl(href) {
  const encoded = href.split('/umamusume/')[1];
  return BILI_BASE + '/index.php?title=' + encoded + '&action=raw';
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

async function buildBiliMapping() {
  const listHtml = await fetchText(BILI_LIST_URL);
  const base = getBiliBaseChars(listHtml);
  const entries = [...base.entries()];
  const mapping = new Map(); // japanese -> simplified chinese
  await mapLimit(entries, 3, async ([zhName, href]) => {
    await sleep(400); // 对 wiki 友好，避免限流
    const wt = await fetchText(buildRawUrl(href));
    const { jp, zh } = parseBiliWikitext(wt);
    if (jp && zh) mapping.set(jp, zh);
  });
  return mapping;
}

// ---------- 主流程 ----------
async function scrapeCharacters() {
  // 1. umamusu.wiki 基础数据（英/日/繁中）
  const listHtml = await fetchText(LIST_URL);
  const links = getUmamusumeLinks(listHtml);
  const scraped = await mapLimit(links, 4, async ({ name, href }) => {
    const url = href.startsWith('http') ? href : BASE + href;
    const data = parseCharacterPage(await fetchText(url));
    return {
      english: data.english || name,
      japanese: data.japanese,
      chineseTraditional: data.chinese,
    };
  });

  // 2. biligame 简中映射（失败则降级为「繁体标注」）
  let mapping = new Map();
  try {
    mapping = await buildBiliMapping();
  } catch (err) {
    console.error('⚠️  biligame 映射抓取失败，简中列将使用繁体标注：', err.message);
  }

  // 3. 排序 + 生成稳定 id + 合并简中
  scraped.sort((a, b) => a.english.toLowerCase().localeCompare(b.english.toLowerCase()));

  const seen = new Set();
  const chars = scraped.map((c) => {
    let id = slugify(c.english);
    const baseId = id;
    let n = 1;
    while (seen.has(id)) id = `${baseId}_${++n}`;
    seen.add(id);

    const simp = mapping.get(c.japanese)
      || (c.chineseTraditional ? c.chineseTraditional + '（繁）' : '');
    return {
      id,
      english: c.english,
      japanese: c.japanese,
      chineseTraditional: c.chineseTraditional,
      chineseSimplified: simp,
    };
  });

  return chars;
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function charactersToCsv(chars) {
  const header = ['English', 'Japanese', 'Chinese (Traditional)', 'Chinese (simplified)'];
  const lines = [header.join(',')];
  for (const c of chars) {
    lines.push([c.english, c.japanese, c.chineseTraditional, c.chineseSimplified].map(csvEscape).join(','));
  }
  return '\uFEFF' + lines.join('\n') + '\n';
}

module.exports = {
  scrapeCharacters,
  charactersToCsv,
  // 以下仅供测试/调试
  getUmamusumeLinks,
  parseCharacterPage,
  getBiliBaseChars,
  parseBiliWikitext,
};
