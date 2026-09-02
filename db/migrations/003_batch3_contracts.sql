-- 批次3：合同 + 结算（财务）
-- 命名遵循 rules_v1.md §7；顶层金额列存「分」；receivables/attachments 嵌套结构用 JSONB（内部金额保持 API 原样=元）。

CREATE TABLE IF NOT EXISTS contracts (
  id               TEXT PRIMARY KEY,
  title            TEXT,
  owner            TEXT,
  customer_id      TEXT,
  customer_name    TEXT,
  amount           BIGINT NOT NULL DEFAULT 0,     -- 合同总额（分）
  sign_date        DATE,
  contract_status  TEXT NOT NULL DEFAULT 'Active',
  service_line     TEXT,
  risk_level       TEXT,                          -- Low/Medium/High
  archive_status   TEXT NOT NULL DEFAULT 'active',
  contract_no      TEXT,
  contact_person   TEXT,
  payment_method   TEXT,
  remarks          TEXT,
  owner_user_id    TEXT,
  receivables      JSONB NOT NULL DEFAULT '[]'::jsonb,
  attachments      JSONB NOT NULL DEFAULT '[]'::jsonb,
  service_items    JSONB NOT NULL DEFAULT '[]'::jsonb,
  extra_fields     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contracts_customer ON contracts(customer_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status   ON contracts(contract_status);
CREATE INDEX IF NOT EXISTS idx_contracts_no       ON contracts(contract_no);

CREATE TABLE IF NOT EXISTS settlements (
  id                TEXT PRIMARY KEY,
  settlement_type   TEXT,                         -- Internal/External
  beneficiary       TEXT,
  contract_ref      TEXT,
  month             TEXT,                          -- YYYY-MM
  amount            BIGINT NOT NULL DEFAULT 0,     -- 分
  settlement_status TEXT NOT NULL DEFAULT 'draft', -- paid/confirmed/draft
  notes             TEXT,
  extra_fields      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_settlements_contract ON settlements(contract_ref);
CREATE INDEX IF NOT EXISTS idx_settlements_month    ON settlements(month);
