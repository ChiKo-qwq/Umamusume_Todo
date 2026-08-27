# 赛马娘 共享清单（Umamusume Shared Todo List）
原用于社团制品统计
一个可共享的赛马娘角色清单：145 个角色（数据来自 `umamusume_characters.csv`），
任何打开网页的人都能查看并更新同一份清单，进度实时同步，无需登录。

## 功能

- 每个角色一条 todo，显示：简体中文名 + 英文名 + 日文名 + 繁体中文名
- 三态进度：点击卡片循环切换「未开始 → 制作中 → 已完成」
- 搜索过滤（支持中文 / 日文 / 英文）
- 多人共享同一份清单，2 秒自动同步
- 「重置」按钮清除所有状态
- 每天 0 点自动重新抓取数据源，更新清单
- 双端口：**可写界面**（能勾选）+ **只读界面**（只能看）

## 双端口说明

| 端口 | 类型 | 说明 |
| --- | --- | --- |
| `xxxx` | 可写 | 可以切换状态、重置 |
| `3000` | 只读 | 只能查看，无法修改（适合投屏/分享给只看的人） |

两个端口共享同一份数据和勾选状态，只读页会自动实时刷新。

## 每日自动刷新

服务启动后，会每天 **0 点（服务器本地时间）** 自动重新抓取：

- https://umamusu.wiki/List_of_Characters#Umamusume
- https://wiki.biligame.com/umamusume/赛马娘一览

抓取成功后自动更新 `characters.json` 和 `umamusume_characters.csv`，
网页清单也会随之刷新（角色增删会同步，已有的勾选状态会保留）。
若抓取失败，会保留旧数据并在日志中报错。

可通过环境变量调整：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `xxxx` | 可写界面端口 |
| `READONLY_PORT` | `3000` | 只读界面端口 |
| `REFRESH_HOUR` | `0` | 每天刷新的小时（0-23） |
| `REFRESH_MINUTE` | `0` | 每天刷新的分钟（0-59） |
| `REFRESH_TOKEN` | 空 | 设置后，手动刷新接口需要携带此 token |
| `CSV_PATH` | `umamusume_characters.csv` | CSV 输出文件名（相对于项目目录） |

手动触发刷新（可选，`REFRESH_TOKEN` 设置了则需带上）：

```bash
curl -X POST http://localhost:2012/api/refresh
# 带 token：
curl -X POST http://localhost:2012/api/refresh -H "Authorization: Bearer 你的token"
```

## 目录结构

```
todo-app/
├── server.js            # Express 后端 + 每日定时刷新 + 双端口
├── scraper.js           # 抓取逻辑（umamusu.wiki + biligame）
├── package.json
├── characters.json      # 角色数据（由抓取生成）
├── umamusume_characters.csv  # CSV（由抓取生成）
├── data/state.json      # 勾选状态（自动生成，持久化）
└── public/
    ├── index.html       # 可写界面
    ├── readonly.html    # 只读界面
    ├── app.js
    ├── readonly.js
    └── style.css
```

## 部署方式（任选其一）

### 方式 A：直接用 Node 运行

服务器需要安装 Node.js 18+。

```bash
cd todo-app
npm install
npm start          # 可写界面 2012，只读界面 3000
```

生产环境建议用进程守护工具，例如 pm2：

```bash
npm install -g pm2
pm2 start server.js --name umamusume-todolist
pm2 save
pm2 startup
```

自定义端口：

```bash
PORT=8080 READONLY_PORT=8081 npm start
```

### 方式 B：Docker（推荐，最省心）

服务器需要安装 Docker 和 Docker Compose。

```bash
cd todo-app
docker compose up -d --build
```

数据会持久化到宿主机 `./data/state.json`，重启容器不丢失。

### 方式 C：Nginx 反向代理（可选，绑定域名 + HTTPS）

把 xxxx（可写）端口反代到你的域名：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:xxxx;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

然后用 certbot 申请 HTTPS 即可。

## 如何共享给别人

部署完成后有两个地址：

- 可写界面（能勾选）：`http://你的服务器IP:xxxx`
- 只读界面（只能看）：`http://你的服务器IP:3000`

把可写地址发给需要操作的人，只读地址发给只需要查看的人。

## 自定义角色数据

如需增删角色，编辑 `characters.json`（数组，每项字段：`id`、`english`、
`japanese`、`chineseTraditional`、`chineseSimplified`），重启服务即可。

如需手动重新抓取，调用 `POST /api/refresh`（见上文「每日自动刷新」）。
