#!/usr/bin/env bash
# Read-only release gate. Any failed check makes deployment fail.
set -euo pipefail
BASE="${DEPLOY_VERIFY_BASE:-http://127.0.0.1}"
for service in xinyi nginx postgresql; do
  systemctl is-active --quiet "$service" || { echo "FAIL: $service 未运行"; exit 1; }
done
expect_status() {
  local resource="$1" expected="$2" actual
  actual=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "$BASE$resource" || true)
  if [ "$actual" != "$expected" ]; then
    echo "FAIL: $resource 返回 ${actual}，预期 $expected"; exit 1
  fi
}
expect_status / 200
expect_status /vendor/tailwind.min.js 200
expect_status /api/state/sync 401
expect_status /.env 000
curl -fsS -m 10 "$BASE/api/auth/health" | node -e '
let body=""; process.stdin.on("data", part => body += part);
process.stdin.on("end", () => {
  const raw=JSON.parse(body); const data=raw.data || raw;
  if (data.mode !== "postgres" || data.ready !== true) {
    console.error("FAIL: 员工认证未使用就绪的 PostgreSQL"); process.exit(1);
  }
});'
echo 'PASS: 服务、首页、静态资源、未登录拦截、配置文件防护、账号数据库均正常'
