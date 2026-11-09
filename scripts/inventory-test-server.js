// 在临时目录运行真实 Express 后端，测试写入不会触碰项目的清单状态。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function startTestServer({ port = 3000, password = 'inventory-local-test' } = {}) {
  const root = path.resolve(__dirname, '..');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'umamusume-inventory-'));
  for (const file of ['server.js', 'scraper.js', 'characters.json', 'inventory.js', 'taobao.js']) {
    fs.copyFileSync(path.join(root, file), path.join(directory, file));
  }
  fs.cpSync(path.join(root, 'public'), path.join(directory, 'public'), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
  const child = spawn(process.execPath, [path.join(directory, 'server.js')], {
    cwd: directory,
    env: { ...process.env, PORT: String(port), PASSWORD: password, TAOBAO_SYNC_ENABLED: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('测试后端启动超时'));
    }, 10000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('running at')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`测试后端已退出：${code}`));
    });
  });
  let stopped;
  function stop() {
    if (!stopped) {
      stopped = new Promise((resolve) => {
        const cleanup = () => {
          fs.rmSync(directory, { recursive: true, force: true });
          resolve();
        };
        if (child.exitCode !== null || child.signalCode !== null) cleanup();
        else {
          child.once('exit', cleanup);
          child.kill();
        }
      });
    }
    return stopped;
  }
  return { child, ready, stop, directory, url: `http://127.0.0.1:${port}`, password };
}

module.exports = { startTestServer };
