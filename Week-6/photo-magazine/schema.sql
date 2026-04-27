-- 잡지 컨셉 사진/마케팅 블로그 (유료/무료 콘텐츠)
-- 스키마: photo_magazine

CREATE SCHEMA IF NOT EXISTS photo_magazine;

-- ── 사용자 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS photo_magazine.users (
  id            BIGSERIAL PRIMARY KEY,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(100) NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'reader',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── 콘텐츠 (사진강의 + 마케팅글) ──────────────────────
CREATE TABLE IF NOT EXISTS photo_magazine.contents (
  id            BIGSERIAL PRIMARY KEY,
  slug          VARCHAR(120) UNIQUE NOT NULL,
  category      VARCHAR(20)  NOT NULL,            -- 'lecture' | 'marketing'
  issue_no      INTEGER      NOT NULL DEFAULT 1,  -- 잡지 호수
  title         VARCHAR(200) NOT NULL,
  subtitle      VARCHAR(300),
  cover_image   TEXT,
  author        VARCHAR(100),
  read_minutes  INTEGER      NOT NULL DEFAULT 5,
  tags          TEXT[]       NOT NULL DEFAULT '{}',
  excerpt       TEXT         NOT NULL,            -- 잠금 시 보이는 앞 3-4줄
  body          TEXT         NOT NULL,            -- 전체 본문 (markdown)
  is_premium    BOOLEAN      NOT NULL DEFAULT FALSE,
  price         INTEGER      NOT NULL DEFAULT 0,  -- 원
  published_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contents_category ON photo_magazine.contents(category);
CREATE INDEX IF NOT EXISTS idx_contents_published ON photo_magazine.contents(published_at DESC);

-- ── 구매 이력 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS photo_magazine.purchases (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES photo_magazine.users(id) ON DELETE CASCADE,
  content_id    BIGINT NOT NULL REFERENCES photo_magazine.contents(id) ON DELETE CASCADE,
  toss_order_id VARCHAR(100) UNIQUE NOT NULL,
  payment_key   VARCHAR(200),
  amount        INTEGER NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | paid | cancelled
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at       TIMESTAMPTZ
);

-- 동일 콘텐츠 결제 완료 건은 한 명당 1개만
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchases_paid_user_content
  ON photo_magazine.purchases(user_id, content_id)
  WHERE status = 'paid';

CREATE INDEX IF NOT EXISTS idx_purchases_user ON photo_magazine.purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_content ON photo_magazine.purchases(content_id);
