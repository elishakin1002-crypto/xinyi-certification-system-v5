#!/usr/bin/env bash
# 把一段活派给 Codex —— 过程你看得见，结论我复验。
#
# ── 为什么要有这个（2026-09-15）────────────────────────────────
#
# 金恩来：「有没有可能，把你和 codex 拉到一个群里，一起工作……
#           我要如何看到你们的对话，否则我怎么知道这个模式是否可行？」
#
# 在这之前每一轮他都要当两次快递员：把提示词贴给 Codex，
# 再把报告贴回来。中间还出过错（贴了旧报告、贴错文件）。
#
# Codex 的 `codex exec` 能非交互跑，所以这一段可以自动化。
# 但**自动化不能等于看不见** —— 所以这个脚本产出两样东西：
#
#   1. .runtime/codex-logs/latest.log
#      Codex 干活的**实时过程**：它跑了哪条命令、看到什么、怎么想的。
#      开一个终端 `tail -f` 就能像看直播一样看着它干。
#
#   2. docs/协作日志.md
#      我和它**各自记一行**的流水账，中文，人读的。
#      派了什么活、它报了什么、我复验的结论是通过还是驳回、为什么。
#      这就是那个"群聊记录" —— 他打开一个文件能看完全程。
#
# 用法：
#   bash scripts/codex-run.sh docs/codex-逐页清点提示词.md
#   bash scripts/codex-run.sh docs/codex-逐页清点提示词.md "接着上次进度继续"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROMPT_FILE="${1:?用法: bash scripts/codex-run.sh <提示词文件> [追加的一句话]}"
EXTRA="${2:-}"

[ -f "$PROMPT_FILE" ] || PROMPT_FILE="$ROOT/$PROMPT_FILE"
[ -f "$PROMPT_FILE" ] || { echo "❌ 找不到提示词文件：$1"; exit 1; }
command -v codex >/dev/null || { echo "❌ 没装 codex CLI"; exit 1; }

LOGDIR="$ROOT/.runtime/codex-logs"; mkdir -p "$LOGDIR"
STAMP="$(date +%Y%m%dT%H%M%S)"
LOG="$LOGDIR/$STAMP.log"
JOURNAL="$ROOT/docs/协作日志.md"
HEAD_SHA="$(git -C "$ROOT" rev-parse --short HEAD)"

# 固定路径，方便他一条命令看直播，不用每次找文件名
ln -sfn "$LOG" "$LOGDIR/latest.log"

PROMPT_TXT="$LOGDIR/$STAMP.prompt.txt"
{
  # 对齐提交 —— 已经吃过一次亏：Codex 拿着旧副本，
  # 把我修掉的七条又报了一遍，白跑一轮。
  echo "你在 $ROOT 工作。当前提交 $HEAD_SHA，开始前先 git log --oneline -5 确认你在这个提交上。"
  echo
  echo "【记流水账】每完成一段（或遇到卡点、或得出一条结论）就往 docs/协作日志.md 追加一行，格式："
  echo "    - HH:MM Codex：<一句话说清你做了什么、结论是什么>"
  echo "  这是给老板看的，用中文、说人话、不要贴代码。追加，不要改别人写的行。"
  echo
  [ -n "$EXTRA" ] && { echo "$EXTRA"; echo; }
  cat "$PROMPT_FILE"
} > "$PROMPT_TXT"

NOW="$(date +%H:%M)"
mkdir -p "$(dirname "$JOURNAL")"
[ -f "$JOURNAL" ] || printf '# 协作日志\n\n> Claude 和 Codex 各自记一行。实时过程看 `.runtime/codex-logs/latest.log`。\n\n' > "$JOURNAL"
printf -- '- %s Claude：派活给 Codex —— %s（基于提交 %s）\n' "$NOW" "$(basename "$PROMPT_FILE")" "$HEAD_SHA" >> "$JOURNAL"

echo "→ 派给 Codex：$(basename "$PROMPT_FILE")（HEAD $HEAD_SHA）"
echo "→ 看直播：    tail -f .runtime/codex-logs/latest.log"
echo "→ 看流水账：  docs/协作日志.md"
echo

# -s workspace-write：只能改工作区，不联网装东西、不碰系统。
# 「不许改业务代码」「不许跑破坏性命令」写在提示词里，那才是主防线。
set +e
# < /dev/null：见 codex-ask.sh 里的说明，不加会停在等 stdin
codex exec -s workspace-write -C "$ROOT" "$(cat "$PROMPT_TXT")" < /dev/null 2>&1 | tee "$LOG"
CODE=${PIPESTATUS[0]}
set -e

printf -- '- %s Codex：这一段跑完（退出码 %s），过程见 .runtime/codex-logs/%s.log\n' "$(date +%H:%M)" "$CODE" "$STAMP" >> "$JOURNAL"
echo
echo "✅ 跑完（退出码 $CODE）。报告在 docs/ 下，流水账在 docs/协作日志.md"
exit "$CODE"
