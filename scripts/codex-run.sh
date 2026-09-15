#!/usr/bin/env bash
# 把一段活派给 Codex，跑完把报告路径打出来。
#
# ── 为什么要有这个（2026-09-15）────────────────────────────────
#
# 金恩来：「有没有可能，把你和 codex 拉到一个群里，一起工作，
#           这样你们可以彼此对峙，不用我在中间张贴来去！」
#
# 在这之前的流程是：我写提示词 → 他复制粘贴给 Codex → Codex 写报告
# → 他把报告复制回来 → 我复验。**每一轮他都要当两次快递员**，
# 而且中间还出过错（贴了旧报告、贴错文件）。
#
# Codex 有 `codex exec` 非交互模式，装在这台机器上，
# 所以这一段完全可以自动化：我直接调它，它写文件，我读文件。
# 人只在「要不要按这个结论改」的时候才需要出现。
#
# 用法：
#   bash scripts/codex-run.sh docs/codex-逐页清点提示词.md
#   bash scripts/codex-run.sh docs/codex-逐页清点提示词.md "接着上次的进度继续"
#
# 输出：.runtime/codex-logs/<时间戳>.log（完整过程）
#       Codex 自己写的报告在 docs/ 下，路径见提示词
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROMPT_FILE="${1:?用法: bash scripts/codex-run.sh <提示词文件> [追加的一句话]}"
EXTRA="${2:-}"

[ -f "$ROOT/$PROMPT_FILE" ] || [ -f "$PROMPT_FILE" ] || { echo "❌ 找不到提示词文件：$PROMPT_FILE"; exit 1; }
[ -f "$PROMPT_FILE" ] || PROMPT_FILE="$ROOT/$PROMPT_FILE"

command -v codex >/dev/null || { echo "❌ 没装 codex CLI"; exit 1; }

LOGDIR="$ROOT/.runtime/codex-logs"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/$(date +%Y%m%dT%H%M%S).log"

# 每次都先让它对齐到当前提交 —— 已经吃过一次亏：
# Codex 拿着旧副本，把我已经修掉的七条又报了一遍。
HEAD_SHA="$(git -C "$ROOT" rev-parse --short HEAD)"

{
  echo "你在 $ROOT 工作。当前提交是 $HEAD_SHA，开始前先 git log --oneline -5 确认你在这个提交上。"
  echo
  [ -n "$EXTRA" ] && { echo "$EXTRA"; echo; }
  cat "$PROMPT_FILE"
} > "$LOGDIR/prompt.txt"

echo "→ 派给 Codex：$(basename "$PROMPT_FILE")（HEAD $HEAD_SHA）"
echo "→ 过程日志：$LOG"

# --full-auto：沙箱内自动执行，不弹确认。提示词里已经写死了「不许改业务代码」
# 和「不许跑破坏性命令」，真正的防线在那里，不在这个开关。
codex exec --full-auto -C "$ROOT" "$(cat "$LOGDIR/prompt.txt")" 2>&1 | tee "$LOG"

echo
echo "✅ 跑完了。报告看 docs/ 下对应的那份，过程看 $LOG"
