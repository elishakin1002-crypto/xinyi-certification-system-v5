-- 批次1：线索 + 客户 CRM 建表
-- 来源：docs/migration/phase0-inventory.md §7.4
-- 命名遵循 core/rules_v1.md §7（小写下划线、*_id、created_at/updated_at、*_amount 存分、*_status）
-- 金额一律 BIGINT 存「分」。

CREATE TABLE IF NOT EXISTS leads (
  id                         TEXT PRIMARY KEY,
  name                       TEXT NOT NULL,
  company                    TEXT NOT NULL,
  lead_status                TEXT NOT NULL DEFAULT 'New',   -- New/Pending/Converted/Risk/Lost
  score                      INTEGER NOT NULL DEFAULT 0,
  potential_value_amount     BIGINT NOT NULL DEFAULT 0,     -- 分
  probability                INTEGER NOT NULL DEFAULT 0,
  intent                     TEXT,                          -- High/Medium/Low
  source                     TEXT,
  industry                   TEXT,
  mobile                     TEXT,
  wechat                     TEXT,
  position                   TEXT,
  target_certifications      TEXT,
  unified_social_credit_code TEXT,
  registered_address         TEXT,
  legal_representative       TEXT,
  registered_capital         TEXT,
  business_scope             TEXT,
  founding_date              DATE,
  operation_status           TEXT,
  company_type               TEXT,
  owner_user_id              TEXT,                          -- 数据范围用
  last_contact               DATE,
  contacts                   JSONB NOT NULL DEFAULT '[]'::jsonb,
  existing_certifications    JSONB NOT NULL DEFAULT '[]'::jsonb,
  follow_up_records          JSONB NOT NULL DEFAULT '[]'::jsonb,
  extra_fields               JSONB NOT NULL DEFAULT '{}'::jsonb,  -- 未提升为列的字段兜底，防迁移丢数据
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(lead_status);
CREATE INDEX IF NOT EXISTS idx_leads_owner  ON leads(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_leads_uscc   ON leads(unified_social_credit_code);

CREATE TABLE IF NOT EXISTS customers (
  id                         TEXT PRIMARY KEY,
  name                       TEXT NOT NULL,
  contact_person             TEXT,
  mobile                     TEXT,
  industry                   TEXT,
  customer_status            TEXT DEFAULT 'Active',
  risk_status                TEXT NOT NULL DEFAULT 'low',   -- low/medium/high
  level                      TEXT,                          -- A/B/C（系统自动评级）
  total_value_amount         BIGINT NOT NULL DEFAULT 0,     -- 分
  total_amount               BIGINT NOT NULL DEFAULT 0,     -- 历史累计消费（分）
  year_amount                BIGINT NOT NULL DEFAULT 0,     -- 当年累计（分）
  active_contracts           INTEGER NOT NULL DEFAULT 0,
  cooperation_count          INTEGER NOT NULL DEFAULT 0,
  service_count              INTEGER NOT NULL DEFAULT 0,
  first_service_date         DATE,
  last_service_date          DATE,
  last_project_at            DATE,
  last_project_type          TEXT,
  next_opportunity           TEXT,
  unified_social_credit_code TEXT,
  registered_address         TEXT,
  legal_representative       TEXT,
  registered_capital         TEXT,
  business_scope             TEXT,
  company_type               TEXT,
  customer_notes             TEXT,
  owner_user_id              TEXT,
  contacts                   JSONB NOT NULL DEFAULT '[]'::jsonb,
  certificates               JSONB NOT NULL DEFAULT '[]'::jsonb,
  existing_certifications    JSONB NOT NULL DEFAULT '[]'::jsonb,
  follow_up_records          JSONB NOT NULL DEFAULT '[]'::jsonb,
  pdca_paid_contract_ids     JSONB NOT NULL DEFAULT '[]'::jsonb,
  extra_fields               JSONB NOT NULL DEFAULT '{}'::jsonb,  -- 未提升为列的字段兜底，防迁移丢数据
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_level ON customers(level);
CREATE INDEX IF NOT EXISTS idx_customers_risk  ON customers(risk_status);
CREATE INDEX IF NOT EXISTS idx_customers_uscc  ON customers(unified_social_credit_code);
