// 데이터베이스 초기 스키마 생성 — 1회 실행용
// 사용: node db-init.js
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '.env.production');
  if (!fs.existsSync(envPath)) throw new Error('.env.production not found');
  const content = fs.readFileSync(envPath, 'utf8');
  const line = content.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL not in env');
  return line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '');
}

// V2: V1 운영 테이블과 격리하기 위해 _v2 접미사 사용
const SQL = `
CREATE TABLE IF NOT EXISTS sessions_v2 (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  store_token TEXT,
  camera_angle TEXT,
  backhand_style TEXT,
  pc_id TEXT,
  video_blob_url TEXT,
  video_mime TEXT,
  result_blob_url TEXT,
  result_mime TEXT,
  result_ext TEXT,
  fail_reason TEXT,
  download_count INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  result_uploaded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sessions_v2_queue_idx
  ON sessions_v2 (status, uploaded_at)
  WHERE status = 'uploaded';

CREATE INDEX IF NOT EXISTS sessions_v2_expires_idx
  ON sessions_v2 (expires_at)
  WHERE status = 'waiting';

CREATE TABLE IF NOT EXISTS store_tokens_v2 (
  token TEXT PRIMARY KEY,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
`;

(async () => {
  const url = loadEnv();
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to', url.match(/@([^:/]+)/)[1]);
  await client.query(SQL);
  console.log('Schema applied.');
  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  console.log('Tables:', tables.rows.map((r) => r.tablename));
  await client.end();
})();
