-- 필름카메라 셀렉트샵 스키마 (filmcamera_shop)
-- Supabase PostgreSQL 실행용

CREATE SCHEMA IF NOT EXISTS filmcamera_shop;

-- 사용자 (고객 / 관리자 / 슈퍼관리자)
CREATE TABLE IF NOT EXISTS filmcamera_shop.users (
  id             BIGSERIAL PRIMARY KEY,
  email          VARCHAR(255) UNIQUE NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  name           VARCHAR(100) NOT NULL,
  role           VARCHAR(20)  NOT NULL DEFAULT 'customer',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT users_role_check CHECK (role IN ('customer', 'admin', 'superadmin'))
);

-- 상품 (필름 카메라)
CREATE TABLE IF NOT EXISTS filmcamera_shop.products (
  id           BIGSERIAL PRIMARY KEY,
  brand        VARCHAR(100) NOT NULL,
  name         VARCHAR(200) NOT NULL,
  year         INTEGER,
  format       VARCHAR(100),
  condition    VARCHAR(50),
  stock        INTEGER NOT NULL DEFAULT 0,
  price        BIGINT  NOT NULL,
  badge        VARCHAR(20),
  image        VARCHAR(500),
  description  TEXT,
  specs        JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT products_stock_check CHECK (stock >= 0),
  CONSTRAINT products_badge_check CHECK (badge IS NULL OR badge IN ('BEST', 'NEW', 'RARE'))
);

-- 주문
CREATE TABLE IF NOT EXISTS filmcamera_shop.orders (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES filmcamera_shop.users(id) ON DELETE CASCADE,
  items        JSONB  NOT NULL,
  total_price  BIGINT NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT orders_status_check CHECK (status IN ('pending', 'paid', 'shipped', 'delivered', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_orders_user      ON filmcamera_shop.orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created   ON filmcamera_shop.orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_brand   ON filmcamera_shop.products (brand);
