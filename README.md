<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1wY8bdE-e2b7sontNgOHzUsWNcMG4ed3a

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set AI keys in [.env.local](.env.local):
   - `KIMI_API_KEY` (primary)
   - `GEMINI_API_KEY` (fallback, auto-switch when Kimi quota/balance insufficient)
3. Start backend (Kimi server proxy):
   `npm start`
4. Run the frontend:
   `npm run dev`

## Stable Dev Startup (Auto-Restart Backend)

- Start full stack (backend auto-restart + frontend):
  - `npm run dev`
- Start only backend with auto-restart:
  - `npm run start:guard`
- Quick health check:
  - `npm run health:stack`

## Intel Radar Timeout Guard

To avoid "抓取今日情报" long blocking:

```bash
# backend timeout for /api/intel/fetch
INTEL_FETCH_TIMEOUT_MS=45000
# frontend timeout for fetch request
VITE_INTEL_FETCH_TIMEOUT_MS=45000
```

When timeout happens, backend will return cached intel signals if available.

## Intel Radar Category Quota (结构稳定防偏科)

可选后端环境变量（默认值见下）：

```bash
# 每次抓取的最低类别配额（总和超过 limit 时会按顺序截断）
INTEL_QUOTA_POLICY=2
INTEL_QUOTA_INDUSTRY=3
INTEL_QUOTA_COMPANY=3
INTEL_QUOTA_TENDER=2
```

说明：后端会优先保证 `政策/行业/企业/招采` 的结构覆盖，再用其余高分情报补齐到 `limit`。

## Intel Radar Freshness (时效过滤)

可选后端环境变量（默认值）：

```bash
# 政策/招采/标准：近90天
INTEL_RECENCY_POLICY_DAYS=90
INTEL_RECENCY_TENDER_DAYS=90
INTEL_RECENCY_STANDARD_DAYS=90

# 行业/企业/活动：近45天
INTEL_RECENCY_INDUSTRY_DAYS=45
INTEL_RECENCY_COMPANY_DAYS=45
INTEL_RECENCY_EVENT_DAYS=45

# 无发布日期情报补位的最大允许时效（天）
INTEL_UNDATED_MAX_AGE_DAYS=45
```

说明：超出时效或无法识别发布日期的情报会被过滤，不再进入主列表。

## State Persistence (PostgreSQL + Dual-write)

The app now supports a dual-write state sync path:
- Frontend still writes `localStorage` (existing behavior)
- Frontend can also sync snapshots to backend (`/api/state/sync`)
- Backend stores snapshots in PostgreSQL when `DATABASE_URL` is configured
- Backend falls back to `server/state_store.json` if PostgreSQL is unavailable

### Backend env

Set in `.env.local`:

```bash
# Required for Kimi
KIMI_API_KEY=your_key
# Optional: Kimi endpoint/model
KIMI_BASE_URL=https://api.moonshot.cn/v1
KIMI_MODEL=kimi-k2.5

# Optional but recommended: Gemini fallback
GEMINI_API_KEY=your_gemini_key
# Preferred fallback (can be adjusted to available model in your account)
GEMINI_MODEL=gemini-3-flash
# Secondary fallback inside Gemini chain
GEMINI_FALLBACK_MODEL=gemini-2.5-flash

# Optional: enable PostgreSQL state store
DATABASE_URL=postgres://user:password@host:5432/dbname
# Optional when your provider requires SSL
PGSSLMODE=require
```

### Frontend env (gray rollout)

Set in `.env.local`:

```bash
# Optional: frontend direct fallback endpoint/model
VITE_KIMI_BASE_URL=https://api.moonshot.cn/v1
VITE_KIMI_MODEL=kimi-k2.5
# Optional: AI backend request timeouts (ms)
VITE_AI_CHAT_TIMEOUT_MS=30000
VITE_AI_GENERATE_TIMEOUT_MS=45000
VITE_AI_DEFAULT_TIMEOUT_MS=20000
# default true in current implementation
VITE_STATE_SYNC_ENABLED=1
# canary users read backend first, fallback to localStorage on failure
VITE_STATE_SYNC_READ_ENABLED=0
# optional debounce (ms)
VITE_STATE_SYNC_DEBOUNCE_MS=1200
# optional canary users: only these user IDs will sync
VITE_STATE_SYNC_CANARY_USERS=U-BOSS,U-CONSULTANT-1,U-FINANCE-1
```

Read cutover note:
- `VITE_STATE_SYNC_READ_ENABLED=1` + canary users configured:
  - app boot reads backend snapshot first
  - if backend read fails/empty, app keeps localStorage state (fallback)
- non-canary users remain local-first.

### Health checks

- AI health: `GET /api/ai/health`
- State store health: `GET /api/state/health`
- Read synced datasets: `GET /api/state/sync?keys=leads_v8,customers_v8`
