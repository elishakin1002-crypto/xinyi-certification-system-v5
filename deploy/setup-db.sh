#!/usr/bin/env bash
# 在服务器上建库建角色，并拼出 /opt/xinyi/.env.local。
# 首次部署时在服务器上执行一次；之后重复执行不会重置密码。
#
#   node deploy/make-prod-env.mjs /tmp/env.partial   # 本地生成，scp 到服务器
#   bash deploy/setup-db.sh                          # 服务器上执行
#
# 数据库密码在**这台机器上**生成，只写进 chmod 600 的 .env.local，
# 不回显、不进 shell history、不经过部署方的机器。
set -euo pipefail

APP_DIR=/opt/xinyi
DB_NAME=xinyi
DB_USER=xinyi

sudo mkdir -p "$APP_DIR"
sudo chown ubuntu:ubuntu "$APP_DIR"

# 已有 DATABASE_URL 就沿用，不重置密码 ——
# 重复部署时重置会让正在跑的服务连不上库。
if [ -f "$APP_DIR/.env.local" ] && grep -q '^DATABASE_URL=' "$APP_DIR/.env.local"; then
  echo ">>> 沿用已有 DATABASE_URL（未重置密码）"
  URL=$(grep '^DATABASE_URL=' "$APP_DIR/.env.local" | cut -d= -f2-)
else
  PW=$(openssl rand -hex 24)
  sudo -u postgres psql -qtAX -c "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 \
    && sudo -u postgres psql -q -c "ALTER ROLE $DB_USER LOGIN PASSWORD '$PW';" \
    || sudo -u postgres psql -q -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$PW';"

  sudo -u postgres psql -qtAX -c "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
    || sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"

  URL="postgres://$DB_USER:$PW@127.0.0.1:5432/$DB_NAME"
  unset PW
fi

{
  echo "DATABASE_URL=$URL"
  # ⚠️ 必须写完整值，**不能**写 XINYI_DB_URL=${DATABASE_URL}。
  # dotenv 不做变量展开，会被当成字面量，报 getaddrinfo EAI_AGAIN base。
  #
  # 也不能省略这一行：server/db/pool.js 只读 XINYI_DB_URL，
  # 故意不回落到 DATABASE_URL（渐进迁移期的设计）。缺了它，
  # 线索/客户/项目/合同/结算会静默落回旧逻辑 —— 服务照常起、接口照常 200，
  # 只是数据来源整个换了一套。现在 app.js 启动时会拦住这种情况。
  echo "XINYI_DB_URL=$URL"
  echo ""
  cat /tmp/env.partial
} > "$APP_DIR/.env.local"
chmod 600 "$APP_DIR/.env.local"

shred -u /tmp/env.partial 2>/dev/null || rm -f /tmp/env.partial

echo ">>> 连接测试"
psql "$URL" -qtAX -c "SELECT 'PG 连接成功 · ' || version();" | head -1
echo ">>> .env.local 权限: $(stat -c '%a %U:%G' "$APP_DIR/.env.local")，$(wc -l < "$APP_DIR/.env.local") 行"
echo ">>> 下一步: cd $APP_DIR && npm ci && npm run build:metrics && npm run build && npm run migrate"
