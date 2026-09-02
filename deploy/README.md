# 生产部署

腾讯云轻量应用服务器 · 上海 · Ubuntu 24.04 · 2核4G50G
访问地址：`http://124.223.209.102`（备案通过后切 `xinyi-iso.com`）

## 这里有什么

| 文件 | 装到哪 | 作用 |
|---|---|---|
| `xinyi.service` | `/etc/systemd/system/` | 后端进程守护，崩了自动拉起 |
| `nginx-xinyi.conf` | `/etc/nginx/sites-available/xinyi` | 静态文件 + `/api` 反向代理 |
| `make-prod-env.mjs` | 本地跑 | 从本地 `.env.local` 生成服务器配置 |

## 架构

```
浏览器 ──80──> Nginx ┬─ /            → /opt/xinyi/dist  静态文件
                     └─ /api/*       → 127.0.0.1:3001   Node 后端
                                                          ↓
                                                     PostgreSQL 16
```

**3001 端口不对外开放**。外网只能通过 Nginx 进来，后端不直接暴露。

## 首次部署

```bash
# 1. 装环境
sudo apt-get update && sudo apt-get install -y nginx postgresql postgresql-contrib git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs

# 2. 建库（密码在服务器上生成，不要在别处生成再传过来）
PW=$(openssl rand -hex 24)
sudo -u postgres psql -c "CREATE ROLE xinyi LOGIN PASSWORD '$PW';"
sudo -u postgres createdb -O xinyi xinyi

# 3. 配置：本地生成后传上去，写进 /opt/xinyi/.env.local，chmod 600
node deploy/make-prod-env.mjs /tmp/env.partial

# 4. 代码 + 构建 + 迁移
rsync -az --exclude node_modules --exclude .git --exclude .env.local ./ ubuntu@<IP>:/opt/xinyi/
ssh ubuntu@<IP> 'cd /opt/xinyi && npm ci && npm run build:metrics && npm run build && npm run migrate'

# 5. 服务
sudo systemctl enable --now xinyi
sudo ln -sf /etc/nginx/sites-available/xinyi /etc/nginx/sites-enabled/xinyi
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 踩过的坑

**`/opt/xinyi` 权限必须有 `o+x`。**
目录默认 `0700`，Nginx 以 `www-data` 跑，进不去 → 前端全部 403，
而后端 API 却是好的。表现成「接口通但页面打不开」，很容易往前端代码上找。

```bash
sudo chmod o+x /opt/xinyi && sudo chmod -R a+rX /opt/xinyi/dist
```

`.env.local` 保持 `600`，`o+x` 只让 www-data 穿过目录，读不到里面的文件。

**`.env.local` 里不能写 `${VAR}` 引用。**
dotenv 不做变量展开，`XINYI_DB_URL=${DATABASE_URL}` 会被当成字面量，
连接时报 `getaddrinfo EAI_AGAIN base`，看不出和配置有关。每个值写全。

**`XINYI_SESSION_COOKIE_SECURE` 在 HTTP 阶段必须是 `false`。**
Secure cookie 只在 HTTPS 下发送。用 IP 访问没有证书，设成 `true` 谁都登不进来，
而且**不报错**——登录接口返回成功，下一个请求又变成未登录。
备案通过、上了 HTTPS 再改成 `true`。

## 重新部署

```bash
rsync -az --exclude node_modules --exclude .git --exclude .env.local --exclude dist ./ ubuntu@<IP>:/opt/xinyi/
ssh ubuntu@<IP> 'cd /opt/xinyi && npm ci && npm run build:metrics && npm run build && npm run migrate && sudo systemctl restart xinyi'
```

`.env.local` 一定要排除，否则会用本地开发配置覆盖生产配置。

## 排查

```bash
sudo journalctl -u xinyi -f          # 后端日志
sudo journalctl -u xinyi -n 100      # 最近 100 行
systemctl is-active xinyi nginx postgresql
curl -s localhost:3001/api/auth/health   # 应返回 mode:postgres, ready:true
```
