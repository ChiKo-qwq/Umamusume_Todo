# URA守札社社团制品统计

一个可共享的赛马娘角色清单：145 个角色（数据来自 `umamusume_characters.csv`）。
**查看无需登录，修改需要密码。**

## 功能

- 每个角色一条 todo，显示：简体中文名 + 英文名 + 日文名 + 繁体中文名
- 三态进度：点击卡片循环切换「未开始 → 制作中 → 已完成」
- 搜索过滤（支持中文 / 日文 / 英文）
- 多人共享同一份清单，2 秒自动同步
- 查看公开，修改需密码解锁
- 每天 0 点自动重新抓取数据源，更新清单
- 顶部「查看库存」：按角色查看、编辑可售御守数量，支持 − / ＋ 每次调整 1 枚，停止操作 700ms 后自动保存到服务器
- 库存与制作进度独立保存，多人编辑有版本冲突检查；可绑定每个角色对应的独立淘宝商品
- 配置商家授权后，每天 **北京时间 00:00** 将已录入、已绑定商品的数量同步到淘宝

## 访问与密码

| 项目 | 值 |
| --- | --- |
| 端口 | `3000` |
| 查看 | 无需登录 |
| 修改密码 | 环境变量 `PASSWORD`（默认 `12345678`） |

修改密码会以请求头 `X-Password` 发送，服务端校验通过后才允许写入。

### 如何在服务器上修改密码

密码通过环境变量 `PASSWORD` 设置，默认 `12345678`。

**Docker 部署**：在项目根目录 `.env` 文件中设置（可从 `.env.example` 复制）：

```dotenv
PASSWORD=你的新密码
```

然后：

```bash
docker compose up -d
```

**Node / pm2 部署**：

```bash
pm2 delete umamusume-todolist
PASSWORD=你的新密码 pm2 start server.js --name umamusume-todolist
pm2 save
```

**直接运行**：

```bash
PASSWORD=你的新密码 npm start
```

修改后刷新页面重新解锁即可生效。

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
| `PASSWORD` | `12345678` | 修改密码 |
| `REFRESH_HOUR` | `0` | 每天刷新的小时（0-23） |
| `REFRESH_MINUTE` | `0` | 每天刷新的分钟（0-59） |
| `CSV_PATH` | `umamusume_characters.csv` | CSV 输出文件名（相对于项目目录） |
| `TAOBAO_SYNC_ENABLED` | `false` | 填 `true` 开启淘宝同步（定时和手动） |
| `TAOBAO_APP_KEY` | 无 | 淘宝开放平台应用 App Key |
| `TAOBAO_APP_SECRET` | 无 | 应用 App Secret，仅配置在服务器 |
| `TAOBAO_SESSION` | 无 | 对应店铺的有效商家授权 Session / access_token |

手动触发刷新（需带密码）：

```bash
curl -X POST http://localhost:3000/api/refresh -H "X-Password: 你的密码"
```

## 目录结构

```
todo-app/
├── server.js            # Express 后端 + 每日定时刷新 + 密码校验
├── inventory.js         # 库存校验、版本冲突检查和原子文件保存
├── taobao.js            # 淘宝签名请求及北京时间零点调度
├── scraper.js           # 抓取逻辑（umamusu.wiki + biligame）
├── package.json
├── characters.json      # 角色数据（由抓取生成）
├── umamusume_characters.csv  # CSV（由抓取生成）
├── data/state.json      # 勾选状态（自动生成，持久化）
├── data/inventory.json  # 可售库存、商品绑定、最近同步结果（自动生成）
└── public/
    ├── index.html
    ├── inventory.html
    ├── inventory.js
    ├── style.css
    └── app.js
```

## 御守库存与淘宝配置

1. 在清单顶部点击「查看库存」，使用同一个修改密码解锁。
2. 默认显示已完成制作或已录入库存的角色，也可切换「全部角色」录入。数字是**当前可售现货**，不是累计制作量。制作状态变化和重置清单不会清空库存。
3. 点击数量两侧的「−」「＋」每次减/加 1 枚，也可直接输入；未录入时点击「＋」从 1 枚开始，0 枚不能再减。连续点击会累积数量，停止操作 700ms 后保存；成功后显示「已保存到服务器」。保存期间按钮暂时禁用。断网或密码失效会保留当前页面的草稿并提供重试，离开页面前请确认保存成功。多人修改同一角色时，需要载入最新库存再编辑。
4. 展开角色下的「淘宝商品绑定」，填写该角色独立商品链接中的数字 `id`，点击「保存绑定」。同一个商品不能重复绑定不同角色。绑定编辑与数量编辑同时进行时，点击「保存绑定」一起保存。
5. 尚未录入的数量显示「未录入」，不会向淘宝发送；明确输入 `0` 才会同步零库存。未绑定商品的库存只保存在本站。

### 尚未申请淘宝开放平台授权时

先在 [淘宝开放平台](https://open.taobao.com/) 创建适合自己店铺的应用，并按平台要求申请商品库存修改接口权限。平台是否允许申请、需要的资质及审核结果以应用控制台为准。

本项目调用官方 [taobao.item.quantity.update](https://developer.alibaba.com/docs/api.htm?apiId=10591)，使用 `num_iid` 定位独立商品，`type=1` 全量设置可售数量。该接口需要有效商家授权及接口调用权限。绑定后端库存或分销库存的特殊商品不适用此普通商品接口，详见 [官方商品接口说明](https://developer.alibaba.com/docs/doc.htm?articleId=108956&docType=1&treeId=796)。

在应用控制台取得 App Key 和 App Secret，依照 [官方商家授权流程](https://developer.alibaba.com/docs/doc.htm?articleId=102635&docType=1&treeId=154) 为目标店铺取得 Session / access_token：配置应用回调地址，引导店铺账号授权，再由服务端用授权 code 换取令牌。淘宝账号登录密码不能替代这些值。本项目不提供 OAuth 回调及自动续期；授权过期后需重新授权，并更新服务器环境变量、重启服务。凭据只配置在服务器，不填写到库存页，也不要提交到 Git。

**Docker Compose 配置**：复制 `.env.example` 为 `.env`，填写修改密码及三项淘宝凭据。核对角色与商品的绑定和现货数量后，将 `TAOBAO_SYNC_ENABLED` 改为 `true`，运行：

```bash
docker compose up -d --build
```

**Node / pm2 配置**：将同名变量配置到进程环境并重启（pm2 更新环境需 `--update-env`）。本项目不会自动读取 `.env`；该文件由 Docker Compose 读取，直接 Node 运行需通过进程管理器或服务环境注入变量。

启用后页面显示下次同步时间，也可解锁后点击「立即同步淘宝」检查配置。首次部署不会立即批量修改淘宝，自动任务等待下一个北京时间 00:00，与容器/主机时区无关。服务器必须持续运行；停机期间错过的任务不会补跑，恢复后等待下次零点，也可核对后手动同步。单次任务中的失败会按角色记录，其他角色继续；不自动重试可能已成功的请求，避免再次覆盖期间产生的销售扣减。同步中服务器重启会显示「上次同步被中断」。

**库存口径**：淘宝销售和预留数量不会自动回写本站。同步前必须确保本站数字已扣除售出/预留数量，否则每日全量同步会把淘宝库存增加回旧数字。当前按「本站可售现货为准」单向同步，不包含订单扣库存或多渠道库存管理。

库存和最近同步结果存储在 `data/inventory.json`，Docker 的 `./data:/app/data` 挂载会持久保存；请备份整个 `data/` 目录。当前 JSON 存储与定时任务适用于**单进程、单实例**，不要用 pm2 cluster 或多个容器同时写入同一数据目录。

库存接口：`GET /api/inventory`；`POST /api/inventory/:id` 接收 `{ "revision": 0, "quantity": 12 }` 或 `{ "revision": 0, "numIid": "商品ID" }`，需要 `X-Password`，版本冲突返回 409；`POST /api/taobao/sync` 需密码和启用配置。密钥不会通过接口返回。

运行 `npm run test:inventory` 验证库存、权限、冲突、持久化、淘宝签名、错误处理与零点调度。测试使用临时目录及模拟淘宝响应，不会修改真实店铺。

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
- 要**修改**，需要输入密码（默认 `12345678`）。

## 自定义角色数据

如需增删角色，编辑 `characters.json`（数组，每项字段：`id`、`english`、
`japanese`、`chineseTraditional`、`chineseSimplified`），重启服务即可。

如需手动重新抓取，调用 `POST /api/refresh`（见上文「每日自动刷新」）。
