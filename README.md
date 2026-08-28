# URA守札社

原用于社团制品统计

一个可共享的赛马娘角色清单：145 个角色（数据来自 `umamusume_characters.csv`）。
**查看无需登录，修改需要密码。**

## 功能

- 每个角色一条 todo，显示：简体中文名 + 英文名 + 日文名 + 繁体中文名
- 三态进度：点击卡片循环切换「未开始 → 制作中 → 已完成」
- 搜索过滤（支持中文 / 日文 / 英文）
- 多人共享同一份清单，2 秒自动同步
- 查看公开，修改需密码解锁
- 每天 0 点自动重新抓取数据源，更新清单

## 访问与密码

| 项目 | 值 |
| --- | --- |
| 端口 | `3000` |
| 查看 | 无需登录 |
| 修改密码 | 环境变量 `PASSWORD`（默认 `20120314`） |

修改密码会以请求头 `X-Password` 发送，服务端校验通过后才允许写入。

## 每日自动刷新

服务启动后，会每天 **0 点（服务器本地时间）** 自动重新抓取：

- https://umamusu.wiki/List_of_Characters#Umamusume
- https://wiki.biligame.com/umamusume/赛马娘一览

抓取成功后自动更新 `characters.json` 和 `umamusume_characters.csv`，
网页清单也会随之刷新（角色增删会同步，已有的状态会保留）。
若抓取失败，会保留旧数据并在日志中报错。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `PASSWORD` | `20120314` | 修改密码 |
| `REFRESH_HOUR` | `0` | 每天刷新的小时（0-23） |
| `REFRESH_MINUTE` | `0` | 每天刷新的分钟（0-59） |
| `CSV_PATH` | `umamusume_characters.csv` | CSV 输出文件名（相对于项目目录） |

手动触发刷新（需带密码）：

```bash
curl -X POST http://localhost:3000/api/refresh -H "X-Password: 你的密码"
```

## 目录结构

```
todo-app/
├── server.js            # Express 后端 + 每日定时刷新 + 密码校验
├── scraper.js           # 抓取逻辑（umamusu.wiki + biligame）
├── package.json
├── characters.json      # 角色数据（由抓取生成）
├── umamusume_characters.csv  # CSV（由抓取生成）
├── data/state.json      # 勾选状态（自动生成，持久化）
└── public/
    ├── index.html
    ├── style.css
    └── app.js
```

## 部署方式（任选其一）

### 方式 A：直接用 Node 运行

服务器需要安装 Node.js 18+。

```bash
cd todo-app
npm install
npm start          # 默认监听 3000 端口
```

生产环境建议用进程守护工具，例如 pm2：

```bash
npm install -g pm2
pm2 start server.js --name umamusume-todolist
pm2 save
pm2 startup
```

自定义端口或密码：

```bash
PORT=8080 PASSWORD=你的密码 npm start
```

### 方式 B：Docker（推荐，最省心）

服务器需要安装 Docker 和 Docker Compose。

```bash
cd todo-app
docker compose up -d --build
```

数据会持久化到宿主机 `./data/state.json`，重启容器不丢失。

### 方式 C：Nginx 反向代理（可选，绑定域名 + HTTPS）

把 3000 端口反代到你的域名：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

然后用 certbot 申请 HTTPS 即可。

## 如何共享给别人

部署完成后，把 `http://你的服务器IP:3000` 发给对方即可。

- 对方打开就能**查看**清单；
- 要**修改**，需要输入密码（默认 `20120314`）。

## 自定义角色数据

如需增删角色，编辑 `characters.json`（数组，每项字段：`id`、`english`、
`japanese`、`chineseTraditional`、`chineseSimplified`），重启服务即可。

如需手动重新抓取，调用 `POST /api/refresh`（见上文「每日自动刷新」）。
