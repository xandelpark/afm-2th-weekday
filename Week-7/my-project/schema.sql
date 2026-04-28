-- Day 2-2: baby_cartoon 스키마 + jobs 테이블
-- Supabase SQL Editor 또는 psql "$DATABASE_URL" -f schema.sql 로 실행

CREATE SCHEMA IF NOT EXISTS baby_cartoon;

CREATE TABLE IF NOT EXISTS baby_cartoon.jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_filename TEXT NOT NULL,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'uploaded',
  segments        JSONB,
  role_mapping    JSONB,
  character_mapping JSONB,
  upload_path     TEXT,
  output_path     TEXT,
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_expires_at ON baby_cartoon.jobs(expires_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status     ON baby_cartoon.jobs(status);
