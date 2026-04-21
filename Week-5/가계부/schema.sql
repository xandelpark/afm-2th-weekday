-- 가계부 앱 스키마 (ledger)
-- Supabase PostgreSQL 실행용

CREATE SCHEMA IF NOT EXISTS ledger;

CREATE TABLE IF NOT EXISTS ledger.entries (
  id          BIGSERIAL PRIMARY KEY,
  type        VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
  entry_date  DATE        NOT NULL,
  amount      BIGINT      NOT NULL CHECK (amount > 0),
  category    VARCHAR(50) NOT NULL,
  memo        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entries_date
  ON ledger.entries (entry_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_entries_type_category
  ON ledger.entries (type, category);
