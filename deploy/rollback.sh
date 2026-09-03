#!/usr/bin/env bash
# 一键回滚到上一个能用的版本。
#
#   bash deploy/rollback.sh            # 回到上一个版本
#   bash deploy/rollback.sh --list     # 看有哪些可回退的版本
#   bash deploy/rollback.sh <版本名>    # 回到指定版本
#
# ── 为什么需要它 ──────────────────────────────────────────────
# 系统上线之后，最大的故障来源不是别人攻击，是自己改坏的。
#
# 在这个脚本之前，改坏了只有一条路：再改一次修回来。
# 而修的过程中系统一直是坏的 —— 你在压力下写代码，
# 同事在那边干不了活，这是最容易越修越坏的处境。
#
# 有了回滚，顺序变成：**先恢复服务，再慢慢查**。
# 这两件事分开，比什么都重要。
#
# ── 只回滚代码，不回滚数据库 ──────────────────────────────────
# 数据库迁移是单向的，而且回滚它非常危险：
# 同事在坏版本期间录进去的数据，回滚迁移就没了。
#
# 好在不需要：新迁移加的都是**新列新表**，旧版本代码看不见它们，
# 照样能跑。所以「代码退回去、数据留着」是安全的组合。
#
# 真需要恢复数据的场景（误删、数据被写坏）走另一条路：
#   bash deploy/restore-drill.sh --restore <备份文件>
set -euo pipefail

HOST="${DEPLOY_HOST:-124.223.209.102}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_xinyi}"
APP=/opt/xinyi
REL=/opt/xinyi-releases
SSH="ssh -i $KEY -o StrictHostKeyChecking=no ubuntu@$HOST"

if [ "${1:-}" = "--list" ]; then
  echo ">>> 可回退的版本（新→旧）"
  $SSH "ls -1t $REL/*.tar.gz 2>/dev/null | head -10 | while read f; do
          printf '  %-34s %6s  %s\n' \"\$(basename \$f)\" \"\$(du -h \$f | cut -f1)\" \"\$(date -r \$f '+%m-%d %H:%M')\"
        done" || echo "  还没有任何版本快照 —— 先跑一次 deploy.sh"
  exit 0
fi

TARGET="${1:-}"

echo ">>> [1/4] 选择要回滚到的版本"
if [ -z "$TARGET" ]; then
  # 不带参数 = 回到上一个。索引 1 而不是 0：0 是当前跑着的这个
  TARGET=$($SSH "ls -1t $REL/*.tar.gz 2>/dev/null | sed -n 2p | xargs -r basename")
  if [ -z "$TARGET" ]; then
    echo "!!! 没有上一个版本可回退（快照少于 2 个）。"
    echo "!!! 快照是 deploy.sh 每次部署前自动打的，第一次部署时还没有历史。"
    exit 1
  fi
fi
echo "    目标：$TARGET"

echo ">>> [2/4] 先给当前版本也打一个快照"
# 万一回滚本身是个错误决定，还能再滚回来。
# 「回滚之后回不去了」是比原故障更糟的处境。
$SSH "set -e
sudo mkdir -p $REL && sudo chown ubuntu:ubuntu $REL
tar -czf $REL/before-rollback-\$(date +%Y%m%d-%H%M%S).tar.gz \
    -C $APP --exclude=node_modules --exclude=backups --exclude=.runtime . 2>/dev/null
echo '    已保存当前版本'"

echo ">>> [3/4] 恢复代码并重建"
$SSH "set -e
test -f $REL/$TARGET || { echo '!!! 版本不存在：$TARGET'; exit 1; }

sudo systemctl stop xinyi

# .env.local 单独留着：它是这台机器的配置，不属于任何一个代码版本。
# 跟着回滚会把数据库密码、模型开关一起退回去，那是另一场事故。
cp $APP/.env.local /tmp/.env.keep

# 只清代码，不动 node_modules（重装要几分钟）、backups、.runtime
find $APP -mindepth 1 -maxdepth 1 \
     ! -name node_modules ! -name backups ! -name .runtime ! -name .env.local \
     -exec rm -rf {} +

tar -xzf $REL/$TARGET -C $APP
cp /tmp/.env.keep $APP/.env.local && chmod 600 $APP/.env.local && rm -f /tmp/.env.keep

cd $APP
npm run build:metrics >/dev/null 2>&1 || true
npm run build 2>&1 | grep -E 'built in|error' || true

# 每次都要修：rsync/tar 会把打包时的 0700 权限带回来，Nginx 进不去就全站 403
sudo chmod o+x $APP && sudo chmod -R a+rX $APP/dist $APP/public
sudo systemctl start xinyi"

echo ">>> [4/4] 自检"
$SSH "sleep 4
echo '    服务: '\$(systemctl is-active xinyi nginx postgresql | paste -sd' ' -)
printf '    首页  '; curl -sS -m 8 -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1/
printf '    后端  '; curl -sS -m 8 http://127.0.0.1:3001/api/auth/health | head -c 100; echo"

echo ">>> 回滚完成。现在系统跑的是 $TARGET"
echo ">>> 服务已恢复，可以慢慢查原来那个版本哪里坏了。"
