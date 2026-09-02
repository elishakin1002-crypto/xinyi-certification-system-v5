-- 批次2：项目交付 + 提醒 + 知识库 + 工作日志 + 任务模板
-- 命名遵循 core/rules_v1.md §7；金额 BIGINT 存「分」；嵌套结构用 JSONB；extra_fields 兜底。

CREATE TABLE IF NOT EXISTS projects (
  id                 TEXT PRIMARY KEY,
  customer_id        TEXT,
  name               TEXT NOT NULL,
  contract_ref       TEXT,
  source_type        TEXT,
  source_ref         TEXT,
  project_mode       TEXT,
  cost_status        TEXT,                          -- 待补全/已确认
  project_amount     BIGINT NOT NULL DEFAULT 0,     -- 分
  project_category   TEXT,                          -- Delivery/FollowUp
  manager            TEXT,
  progress           INTEGER NOT NULL DEFAULT 0,
  project_status     TEXT NOT NULL DEFAULT 'Active',
  payment_status     TEXT,                          -- paid/partial/unpaid/overdue
  deadline           DATE,
  duration           INTEGER,
  project_type       TEXT,                          -- Self-Operated/Outsourced/Joint
  vendor_id          TEXT,
  vendor_name        TEXT,
  purchasing_cost    BIGINT DEFAULT 0,              -- 分
  owner_user_id      TEXT,
  tasks              JSONB NOT NULL DEFAULT '[]'::jsonb,
  service_items      JSONB NOT NULL DEFAULT '[]'::jsonb,
  settlement_config  JSONB,
  ai_insight         JSONB,
  completion_record  JSONB,
  extra_fields       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_status   ON projects(project_status);
CREATE INDEX IF NOT EXISTS idx_projects_customer ON projects(customer_id);
CREATE INDEX IF NOT EXISTS idx_projects_manager  ON projects(manager);

CREATE TABLE IF NOT EXISTS reminders (
  id                 TEXT PRIMARY KEY,
  title              TEXT,
  content            TEXT,
  reminder_date      DATE,
  reminder_type      TEXT,                          -- task/payment/expire/risk/opportunity
  is_read            BOOLEAN NOT NULL DEFAULT FALSE,
  link_id            TEXT,
  link_type          TEXT,
  for_role           JSONB NOT NULL DEFAULT '[]'::jsonb,
  for_user_ids       JSONB NOT NULL DEFAULT '[]'::jsonb,
  channels           JSONB NOT NULL DEFAULT '[]'::jsonb,
  pushed_to_wechat   BOOLEAN NOT NULL DEFAULT FALSE,
  extra_fields       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reminders_link ON reminders(link_type, link_id);
CREATE INDEX IF NOT EXISTS idx_reminders_read ON reminders(is_read);

CREATE TABLE IF NOT EXISTS knowledge_docs (
  id                 TEXT PRIMARY KEY,
  title              TEXT,
  category           TEXT,
  format             TEXT,
  size               TEXT,
  doc_updated_at     TEXT,                          -- 业务字段 updatedAt（非 DB 元数据）
  content            TEXT,
  summary            TEXT,
  ai_visible         BOOLEAN NOT NULL DEFAULT FALSE,
  source_url         TEXT,
  link_type          TEXT,
  link_id            TEXT,
  link_title         TEXT,
  tags               JSONB NOT NULL DEFAULT '[]'::jsonb,
  source             TEXT,
  auto_generated     BOOLEAN NOT NULL DEFAULT FALSE,
  access_roles       JSONB NOT NULL DEFAULT '[]'::jsonb,
  access_user_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  dedupe_hash        TEXT,
  original_file_name TEXT,
  extra_fields       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_link ON knowledge_docs(link_type, link_id);

CREATE TABLE IF NOT EXISTS project_work_logs (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT,
  service_item_id    TEXT,
  task_id            TEXT,
  log_date           DATE,
  work_content       TEXT,
  actual_hours       NUMERIC DEFAULT 0,
  issue_note         TEXT,
  next_plan          TEXT,
  source             TEXT,
  operator_user_id   TEXT,
  operator_name      TEXT,
  extra_fields       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_worklogs_project ON project_work_logs(project_id);

CREATE TABLE IF NOT EXISTS task_templates (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  tasks              JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_built_in        BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id TEXT,
  created_by_name    TEXT,
  archived           BOOLEAN NOT NULL DEFAULT FALSE,
  usage_count        INTEGER NOT NULL DEFAULT 0,
  last_used_at       TEXT,
  extra_fields       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
