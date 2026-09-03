#!/usr/bin/env bash
# 数据库恢复演练 / 真实恢复。
#
#   bash deploy/restore-drill.sh              # 演练：恢复到一个临时库，不碰生产
#   bash deploy/restore-drill.sh --restore    # 真恢复：覆盖生产库（要打字确认）
#
# ── 为什么必须演练 ────────────────────────────────────────────
# 没演练过的备份只能算「大概能恢复」。
# 真出事的那天才第一次执行恢复流程，是最坏的组合：
# 你在压力下、按着一份从没验证过的步骤、操作正在损坏的数据。
#
# 演练版把备份恢复到一个**临时数据库**，逐表核对行数，然后删掉。
# 生产库全程不受影响 —— 所以随时可以跑，跑得越多越放心。
#
# ── 演练要回答的三个问题 ──────────────────────────────────────
#   1. 备份文件真的能读出来吗？（不是「文件存在」，是「能还原」）
#   2. 还原出来的数据完整吗？（逐表比行数）
#   3. 整个过程要多久？（这个数字决定真出事那天你怎么跟同事交代）
set -euo pipefail

HOST="${DEPLOY_HOST:-124.223.209.102}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_xinyi}"
SSH="ssh -i $KEY -o StrictHostKeyChecking=no ubuntu@$HOST"
MODE="${1:-drill}"

echo ">>> [1/5] 找最新的备份"
BACKUP=$($SSH "ls -1t /opt/xinyi/backups/*.dump 2>/dev/null | head -1")
if [ -z "$BACKUP" ]; then
  echo "!!! 没有找到任何备份文件（/opt/xinyi/backups/*.dump）"
  echo "!!! 先跑一次 npm run backup 再来演练"
  exit 1
fi
$SSH "ls -lh $BACKUP | awk '{print \"    \"\$9\"  \"\$5\"  \"\$6\" \"\$7\" \"\$8}'"

if [ "$MODE" = "--restore" ]; then
  echo
  echo "⚠️  这会**覆盖生产数据库**。当前数据将被备份文件替换。"
  echo "⚠️  备份时间之后录入的一切都会消失。"
  printf "确认请完整输入 RESTORE：> "
  read -r ok
  [ "$ok" = "RESTORE" ] || { echo "已取消。"; exit 1; }
fi

echo ">>> [2/5] 恢复"
START=$(date +%s)
if [ "$MODE" = "--restore" ]; then
  $SSH "set -e
    cd /opt/xinyi
    URL=\$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-)
    # 恢复前再备份一次当前状态。
    # 「恢复之后发现恢复错了」如果没有退路，是比原故障更糟的处境。
    pg_dump -d \"\$URL\" -Fc -f /opt/xinyi/backups/pre-restore-\$(date +%Y%m%d-%H%M%S).dump
    sudo systemctl stop xinyi
    sudo -u postgres psql -q -d postgres -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='xinyi' AND pid<>pg_backend_pid();\" >/dev/null 2>&1 || true
    sudo -u postgres dropdb --if-exists xinyi
    sudo -u postgres createdb -O xinyi xinyi
    pg_restore -d \"\$URL\" --no-owner --no-acl $BACKUP 2>&1 | tail -3 || true
    sudo systemctl start xinyi
    echo '    生产库已恢复，服务已重启'"
  TARGET_DB="xinyi"
else
  $SSH "set -e
    cd /opt/xinyi
    URL=\$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-)
    sudo -u postgres dropdb --if-exists xinyi_drill
    sudo -u postgres createdb -O xinyi xinyi_drill
    DRILL=\$(echo \"\$URL\" | sed 's|/xinyi\$|/xinyi_drill|')
    pg_restore -d \"\$DRILL\" --no-owner --no-acl $BACKUP 2>&1 | tail -3 || true
    echo '    已恢复到临时库 xinyi_drill（生产库未受影响）'"
  TARGET_DB="xinyi_drill"
fi
ELAPSED=$(( $(date +%s) - START ))

echo ">>> [3/5] 逐表核对行数"
cat > /tmp/drill-count.sql <<'SQL'
SELECT format('%s|%s', table_name,
  (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I', table_name), false, true, '')))[1]::text::int)
FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;
SQL
scp -q -i "$KEY" -o StrictHostKeyChecking=no /tmp/drill-count.sql "ubuntu@$HOST:/tmp/"
$SSH "cd /opt/xinyi
URL=\$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-)
T=\$(echo \"\$URL\" | sed 's|/xinyi\$|/$TARGET_DB|')
paste -d'|' <(psql \"\$URL\" -qtAX -f /tmp/drill-count.sql) <(psql \"\$T\" -qtAX -f /tmp/drill-count.sql) \
 | awk -F'|' '{
     if (\$2 == \$4) printf \"    %-24s 生产 %6s  恢复 %6s  一致\\n\", \$1, \$2, \$4;
     else           printf \"    %-24s 生产 %6s  恢复 %6s  !!! 不一致\\n\", \$1, \$2, \$4;
   }'"

echo ">>> [4/5] 抽查一条真实数据能不能读出来"
# 行数对得上不代表内容是好的：一张全是空值的表行数也对
$SSH "cd /opt/xinyi
URL=\$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-)
T=\$(echo \"\$URL\" | sed 's|/xinyi\$|/$TARGET_DB|')
psql \"\$T\" -qtAX -c \"SELECT '    账号样本: ' || name || ' / ' || username FROM auth_users ORDER BY name LIMIT 3;\"
psql \"\$T\" -qtAX -c \"SELECT '    合同样本: ' || COALESCE(customer_name,'?') || ' 金额 ' || COALESCE((amount/100)::text,'?') FROM contracts LIMIT 2;\" 2>/dev/null || echo '    （合同表结构不同，跳过）'"

echo ">>> [5/5] 收尾"
if [ "$MODE" = "--restore" ]; then
  $SSH "sleep 3; printf '    首页 '; curl -sS -m 8 -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1/"
  echo "    真实恢复完成，耗时 ${ELAPSED} 秒"
else
  $SSH "sudo -u postgres dropdb --if-exists xinyi_drill && echo '    临时库已删除'"
  echo
  echo "════════════════════════════════════════════"
  echo "  演练完成，耗时 ${ELAPSED} 秒"
  echo "  真出事时，从执行命令到数据回来大约就是这个时间。"
  echo "  （真实恢复还要加上停服务和重启，约再多 15 秒）"
  echo "════════════════════════════════════════════"
fi
