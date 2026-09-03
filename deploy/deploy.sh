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
REL=/opt/xinyi-releases
SSH="ssh -i $KEY -o StrictHostKeyChecking=no ubuntu@$HOST"

cd "$(dirname "$0")/.."

# ── 部署前先给现在这个版本打快照 ──────────────────────────────
# 没有快照就没有回滚，而「改坏了只能再改一次修回来」是最容易
# 越修越坏的处境 —— 你在压力下写代码，同事在那边干不了活。
# 有了快照，顺序才能变成「先恢复服务，再慢慢查」。
#
# 只留最近 8 个：每个约 15MB，够回退到一周前，也不会把磁盘吃掉。
echo ">>> [0/5] 快照当前版本（供回滚）"
$SSH "set -e
if [ -d $APP/dist ]; then
  sudo mkdir -p $REL && sudo chown ubuntu:ubuntu $REL
  SHA=\$(cat $APP/VERSION 2>/dev/null || echo nover)
  tar -czf $REL/\$(date +%Y%m%d-%H%M%S)-\$SHA.tar.gz \
      -C $APP --exclude=node_modules --exclude=backups --exclude=.runtime . 2>/dev/null
  ls -1t $REL/*.tar.gz 2>/dev/null | tail -n +9 | xargs -r rm -f
  echo '    已快照 '\$(ls -1 $REL/*.tar.gz 2>/dev/null | wc -l)' 个版本可回退'
else
  echo '    首次部署，无可快照的版本'
fi"

echo "$(git rev-parse --short HEAD 2>/dev/null || echo nogit)" > VERSION
echo ">>> [1/5] 同步代码"
# --exclude .env.local 是**必须的**：同步过去会用开发配置覆盖生产配置，
# 而开发配置里 XINYI_SESSION_COOKIE_SECURE、DATABASE_URL 全都不一样，
# 结果是所有人突然登不进去，而且看不出和这次部署有关。
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude dist --exclude .runtime \
  --exclude '.env.local' --exclude '*.log' \
  `# backups 必须排除：rsync --delete 会把服务器上「本地没有」的东西删掉，` \
  `# 而备份天生只存在于服务器。2026-09-03 演练时发现每次部署都在删备份，` \
  `# 账号拆分前那个 29.7MB 的备份就是这么没的 —— 而且全程没有任何提示。` \
  --exclude backups \
  --exclude .codex-work --exclude .claude --exclude outputs --exclude release \
  --exclude test-results --exclude playwright-report \
  -e "ssh -i $KEY -o StrictHostKeyChecking=no" ./ "ubuntu@$HOST:$APP/"

echo ">>> [2/4] 安装依赖 + 构建 + 迁移"
$SSH "cd $APP && npm ci --no-audit --no-fund >/dev/null 2>&1 && npm run build:metrics >/dev/null && npm run build 2>&1 | grep -E 'built in|error' && npm run migrate 2>&1 | tail -2"

echo ">>> [3/5] 修权限（rsync 会把本地的 0700 带过来，每次都要修）"
$SSH "sudo chmod o+x $APP && sudo chmod -R a+rX $APP/dist $APP/public && chmod 600 $APP/.env.local"

# ── Nginx / systemd 配置也要跟着代码走 ─────────────────────────
# 2026-09-02 发现：deploy.sh 只同步应用代码，**不部署这两份配置**。
# 于是仓库里的 nginx-xinyi.conf 和服务器上跑的那份各走各的 ——
# 我在仓库里删掉了 8080，部署完发现端口还开着，
# 因为服务器上那份根本没被替换过，而且没有任何提示。
#
# 配置和代码脱节的坏处不是「这次没生效」，
# 是**下次有人照着仓库里的配置排查线上问题，看到的是一份假的**。
echo ">>> [4/5] 部署 Nginx / systemd 配置"
scp -q -i "$KEY" -o StrictHostKeyChecking=no deploy/nginx-xinyi.conf "ubuntu@$HOST:/tmp/nginx-xinyi.conf"
scp -q -i "$KEY" -o StrictHostKeyChecking=no deploy/xinyi.service      "ubuntu@$HOST:/tmp/xinyi.service"
$SSH "set -e
sudo mv /tmp/nginx-xinyi.conf /etc/nginx/sites-available/xinyi
sudo ln -sf /etc/nginx/sites-available/xinyi /etc/nginx/sites-enabled/xinyi
sudo rm -f /etc/nginx/sites-enabled/default
sudo mv /tmp/xinyi.service /etc/systemd/system/xinyi.service
sudo systemctl daemon-reload
sudo nginx -t 2>&1 | tail -1"

echo ">>> [5/5] 重启并自检"
# Nginx 用 restart 不用 reload：reload 不会释放已经监听的端口，
# 配置里删掉一个 listen 之后 reload 完那个端口还开着 —— 又是一个「改了没生效」。
$SSH "sudo systemctl restart xinyi && sudo systemctl restart nginx && sleep 4
echo '  服务: '\$(systemctl is-active xinyi nginx postgresql | paste -sd' ' -)
printf '  首页 80    '; curl -sS -m 8 -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1/
printf '  后端健康   '; curl -sS -m 8 http://127.0.0.1:3001/api/auth/health | head -c 120; echo
printf '  鉴权闸门   '; curl -sS -m 8 -o /dev/null -w '/api/state/batch 未登录 -> HTTP %{http_code}（应为 401）\n' http://127.0.0.1:3001/api/state/batch
EXT=\$(grep -oE 'https://[^\"'\'' )]+' $APP/dist/index.html | grep -vE 'aistudiocdn|esm.sh' | wc -l)
echo \"  外部 CDN 引用: \$EXT 处（应为 0，非 0 说明本地化被改回去了）\"
# 通知通道丢了不会报任何错，只是从此再也收不到错误摘要。
# 这种「静默失效」正是可观测性设施最常见的死法 ——
# 它不出声，而你以为它在工作。所以每次部署都点一次名。
if grep -q '^NOTIFY_WEBHOOK_URL=http' $APP/.env.local; then
  echo '  通知通道   已配置'
else
  echo '  通知通道   !!! 未配置 —— 错误摘要生成了也发不出去'
fi"

echo ">>> 完成  http://$HOST"
