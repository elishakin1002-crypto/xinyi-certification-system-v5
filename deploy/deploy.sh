#!/usr/bin/env bash
# 一键部署到生产服务器。
#
#   bash deploy/deploy.sh
#
# 为什么要有这个脚本，而不是把步骤写在 README 里让人照着敲：
# 因为其中一步（chmod o+x）**已经漏过两次**了。
# 第一次是首次部署，第二次是 rsync 把本地目录的 0700 权限同步过去，
# 又把修好的权限覆盖回去 —— 而症状是「前端全部 403、后端 API 却正常」，
# 每次都要重新查一遍。写进脚本就不会再漏。
set -euo pipefail

HOST="${DEPLOY_HOST:-124.223.209.102}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_xinyi}"
APP=/opt/xinyi
SSH="ssh -i $KEY -o StrictHostKeyChecking=no ubuntu@$HOST"

cd "$(dirname "$0")/.."

echo ">>> [1/4] 同步代码"
# --exclude .env.local 是**必须的**：同步过去会用开发配置覆盖生产配置，
# 而开发配置里 XINYI_SESSION_COOKIE_SECURE、DATABASE_URL 全都不一样，
# 结果是所有人突然登不进去，而且看不出和这次部署有关。
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude dist --exclude .runtime \
  --exclude '.env.local' --exclude '*.log' \
  --exclude .codex-work --exclude .claude --exclude outputs --exclude release \
  --exclude test-results --exclude playwright-report \
  -e "ssh -i $KEY -o StrictHostKeyChecking=no" ./ "ubuntu@$HOST:$APP/"

echo ">>> [2/4] 安装依赖 + 构建 + 迁移"
$SSH "cd $APP && npm ci --no-audit --no-fund >/dev/null 2>&1 && npm run build:metrics >/dev/null && npm run build 2>&1 | grep -E 'built in|error' && npm run migrate 2>&1 | tail -2"

echo ">>> [3/4] 修权限（rsync 会把本地的 0700 带过来，每次都要修）"
$SSH "sudo chmod o+x $APP && sudo chmod -R a+rX $APP/dist $APP/public && chmod 600 $APP/.env.local"

echo ">>> [4/4] 重启并自检"
$SSH "sudo systemctl restart xinyi && sudo nginx -t >/dev/null 2>&1 && sudo systemctl reload nginx && sleep 4
echo '  服务: '\$(systemctl is-active xinyi nginx postgresql | paste -sd' ' -)
printf '  首页 80    '; curl -sS -m 8 -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1/
printf '  首页 8080  '; curl -sS -m 8 -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:8080/
printf '  后端健康   '; curl -sS -m 8 http://127.0.0.1:3001/api/auth/health | head -c 120; echo
printf '  鉴权闸门   '; curl -sS -m 8 -o /dev/null -w '/api/state/batch 未登录 -> HTTP %{http_code}（应为 401）\n' http://127.0.0.1:3001/api/state/batch
EXT=\$(grep -oE 'https://[^\"'\'' )]+' $APP/dist/index.html | grep -vE 'aistudiocdn|esm.sh' | wc -l)
echo \"  外部 CDN 引用: \$EXT 处（应为 0，非 0 说明本地化被改回去了）\""

echo ">>> 完成  http://$HOST"
