-- 批次4：情报 + 审计 + 战略
-- 命名遵循 rules_v1.md §7；嵌套结构 JSONB；extra_fields 兜底。

CREATE TABLE IF NOT EXISTS market_signals (
  id                    TEXT PRIMARY KEY,
  title                 TEXT,
  source_name           TEXT,
  source_url            TEXT,
  published_at          DATE,
  summary               TEXT,
  content               TEXT,
  kind                  TEXT,                       -- policy/industry/company/tender/standard/event
  regions               JSONB NOT NULL DEFAULT '[]'::jsonb,
  industries            JSONB NOT NULL DEFAULT '[]'::jsonb,
  departments           JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  deadline              DATE,
  service_category      TEXT,
  service_item_code     TEXT,
  opportunity_hypothesis JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_actions   JSONB NOT NULL DEFAULT '[]'::jsonb,
  score                 INTEGER NOT NULL DEFAULT 0,
  urgency               TEXT,                       -- high/medium/low
  signal_status         TEXT NOT NULL DEFAULT 'new',-- new/triaged/converted/ignored/expired
  owner_user_id         TEXT,
  converted_to          JSONB,
  extra_fields          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_signals_status  ON market_signals(signal_status);
CREATE INDEX IF NOT EXISTS idx_signals_kind    ON market_signals(kind);
CREATE INDEX IF NOT EXISTS idx_signals_urgency ON market_signals(urgency);

CREATE TABLE IF NOT EXISTS audit_issues (
  id                    TEXT PRIMARY KEY,
  customer_name         TEXT,
  customer_id           TEXT,
  project_id            TEXT,
  contract_id           TEXT,
  findings              TEXT,
  severity              TEXT,                       -- Minor/Major/Observation
  issue_status          TEXT NOT NULL DEFAULT 'Open', -- Open/Rectifying/Verifying/Closed
  auditor               TEXT,
  rectification_plan    TEXT,
  audit_type            TEXT,
  create_date           DATE,
  deadline              DATE,
  contract_ref          TEXT,
  rectification_task_id TEXT,
  knowledge_doc_id      TEXT,
  evidences             JSONB NOT NULL DEFAULT '[]'::jsonb,
  verification          JSONB,
  extra_fields          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_status   ON audit_issues(issue_status);
CREATE INDEX IF NOT EXISTS idx_audit_customer ON audit_issues(customer_id);

CREATE TABLE IF NOT EXISTS strategic_tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT,
  task_status   TEXT,
  priority      TEXT,                               -- High/Medium/Low
  owner         TEXT,
  deadline      DATE,
  impact        TEXT,
  task_type     TEXT,
  extra_fields  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
