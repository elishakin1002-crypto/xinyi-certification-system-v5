#!/usr/bin/env bash
# 向 Codex 当面提一个问题，把它**原话**记进对质记录。
#
# ── 为什么要有这个（2026-09-15）────────────────────────────────
#
# 金恩来：「『它报的四条诊断里三条是反的』这是你的说法，
#           我想看到的是他直接回复你的说法，
#           这也是为什么我想拉群聊的原因。」
#
# 他是对的。我转述对方的观点，哪怕我自认为公允，他也**没法判断**——
# 因为他只看到我这一边。一个只有一方发言的"对质"不是对质。
#
# 所以这个脚本做一件事：把我的主张 + 我的证据原样交给 Codex，
# 请它直接回应（同意 / 反驳 / 部分成立），然后把**它的原话**
# 贴进 docs/对质记录.md。我不许改写、不许只摘对我有利的部分。
#
# 用法：
#   bash scripts/codex-ask.sh docs/对质-某某问题.md
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
Q="${1:?用法: bash scripts/codex-ask.sh <问题文件>}"
[ -f "$Q" ] || Q="$ROOT/$Q"
[ -f "$Q" ] || { echo "❌ 找不到问题文件：$1"; exit 1; }

LOGDIR="$ROOT/.runtime/codex-logs"; mkdir -p "$LOGDIR"
STAMP="$(date +%Y%m%dT%H%M%S)"
LOG="$LOGDIR/ask-$STAMP.log"
ANSWER="$LOGDIR/ask-$STAMP.answer.txt"
RECORD="$ROOT/docs/对质记录.md"
ln -sfn "$LOG" "$LOGDIR/latest.log"

[ -f "$RECORD" ] || printf '# 对质记录\n\n> Claude 提主张并给证据，Codex 直接回应。\n> **Codex 的回应是原话贴进来的，没有经过 Claude 转述或删节。**\n> 实时过程看 `.runtime/codex-logs/latest.log`。\n\n' > "$RECORD"

PROMPT="$LOGDIR/ask-$STAMP.prompt.txt"
{
  echo "你在 $ROOT。这不是派活，是一次**当面对质**。"
  echo
  echo "Claude（另一个 AI 同事）对你之前的几条结论提出了异议，并给了它的证据。"
  echo "请你**直接回应**，不要客气也不要迁就："
  echo "  · 它说得对的，明确承认，并说清你当时是怎么判断错的；"
  echo "  · 它说错了的，**直接反驳**，并给出你自己的证据（命令 + 输出）；"
  echo "  · 拿不准的，说拿不准，别猜。"
  echo
  echo "你可以运行只读命令去核实（curl、git、cat、ps 都行），但不要改任何文件。"
  echo "最后按下面格式输出，逐条回应，中文，说人话："
  echo "    ## 第 N 条：<结论一句话>"
  echo "    我的回应：□承认 □反驳 □部分成立"
  echo "    理由和证据："
  echo
  echo "———————— 以下是 Claude 的主张 ————————"
  cat "$Q"
} > "$PROMPT"

echo "→ 向 Codex 提出对质：$(basename "$Q")"
echo "→ 看直播：tail -f .runtime/codex-logs/latest.log"
echo

set +e
# < /dev/null：不给它标准输入。不加的话 codex exec 会停在
# "Reading additional input from stdin..." 一直等，无人值守时就是死等。
# 给联网和读进程的权限：上一次用 read-only，它连不上 3001 也读不了 ps，
# 等于让它空手来辩 —— 对质双方必须都能取证。
codex exec -s workspace-write -C "$ROOT" --output-last-message "$ANSWER" "$(cat "$PROMPT")" < /dev/null 2>&1 | tee "$LOG"
CODE=${PIPESTATUS[0]}
set -e

{
  printf '\n---\n\n## %s · %s\n\n' "$(date '+%Y-%m-%d %H:%M')" "$(basename "$Q" .md)"
  printf '### Claude 的主张\n\n'
  sed 's/^/> /' "$Q"
  printf '\n### Codex 的原话回应\n\n'
  if [ -s "$ANSWER" ]; then cat "$ANSWER"; else echo '（没拿到回应，退出码 '"$CODE"'，看日志 '"$LOG"'）'; fi
  printf '\n'
} >> "$RECORD"

echo
echo "✅ 记进 docs/对质记录.md 了（Codex 的回应是原话，我没有改写）"
