# Backend Migration Runbook (PostgreSQL + Dual-write)

## Goal

Migrate from browser-only persistence to backend persistence without interrupting daily usage.

## Strategy

1. Keep existing localStorage writes (safety net).
2. Enable frontend snapshot sync to backend (`/api/state/sync`).
3. Start with canary users only.
4. Compare dataset counts/hashes between local and backend.
5. Switch reads to backend only after stable canary window.

## Current persistence map

- Browser localStorage:
  - `leads_v8`, `customers_v8`, `contracts_v8`, `projects_v8`
  - `settlements_v8`, `reminders_v8`, `auditIssues_v1`
  - `knowledgeDocs_v8`, `marketSignals_v1`, `taskTemplates_v1`
  - `strategicInsight_v1`, `strategicTasks_v1`
  - `user_profiles_v1`, `current_user_id`, `current_role`
  - `chat_history`, `intel_last_notice`, `importRecords_v1`, `wechat_bindings_v1`
- Backend file store:
  - `server/intel_store.json`
  - `server/state_store.json` (fallback when no PostgreSQL)
- Backend PostgreSQL (new):
  - `app_state_latest`
  - `app_state_history`

## Rollout phases

## Operational baseline (local trial)

- Use `npm run dev` (backend auto-restart enabled).
- Use `npm run health:stack` before demo:
  - `backend /api/ai/health` must be OK
  - `frontend proxy /api/ai/health` must be OK

### Phase A: Infrastructure ready

- Configure `DATABASE_URL`.
- Verify `GET /api/state/health` returns `mode=postgres`.
- Keep all reads from localStorage.

### Phase B: Canary dual-write (3-5 days)

- Enable:
  - `VITE_STATE_SYNC_ENABLED=1`
  - `VITE_STATE_SYNC_CANARY_USERS=<boss,consultant,finance>`
- Monitor:
  - API error rate for `/api/state/sync`
  - `app_state_history` write volume
  - data freshness (`latestUpdateAt`)

### Phase C: Verification gates

- For canary users, verify per-key parity:
  - record count parity for leads/customers/contracts/projects/tasks
  - timestamp freshness parity
- Verify permission behavior remains unchanged.

### Phase D: Read cutover

- Introduce backend-first reads for canary users.
- Keep local fallback for rollback.
- Enable:
  - `VITE_STATE_SYNC_READ_ENABLED=1`
  - keep `VITE_STATE_SYNC_CANARY_USERS` limited to trial users
- Validation checklist:
  - reload app: canary user data remains complete
  - stop backend temporarily: app still opens with local data (fallback)
  - restart backend: write path continues to sync snapshots

### Phase E: Full rollout

- Remove canary restriction.
- Keep dual-write for one release window.
- After stability window, remove local business persistence (keep only UI preference cache).

## Rollback plan

If backend sync fails:

1. Set `VITE_STATE_SYNC_ENABLED=0`.
2. Continue localStorage-only mode.
3. Investigate backend using `/api/state/health` and server logs.
4. Re-enable canary after fix.
