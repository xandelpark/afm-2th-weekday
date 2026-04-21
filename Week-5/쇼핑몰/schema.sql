-- 쇼핑몰 스키마 (shopping)
-- Supabase PostgreSQL 실행용

CREATE SCHEMA IF NOT EXISTS shopping;

CREATE TABLE IF NOT EXISTS shopping.users (
  id            BIGSERIAL PRIMARY KEY,
  username      VARCHAR(30) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shopping.cart_items (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES shopping.users(id) ON DELETE CASCADE,
  product_id  INTEGER     NOT NULL,
  quantity    INTEGER     NOT NULL CHECK (quantity > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_cart_user ON shopping.cart_items (user_id);
