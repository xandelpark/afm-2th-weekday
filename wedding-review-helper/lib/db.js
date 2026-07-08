// Supabase(PostgreSQL) — 연락처별 후기 작성 횟수 제한
// 스키마: wedding_review, 테이블: usage (phone+channel 조합당 1회)
const { Pool } = require("pg");

const SCHEMA = "wedding_review";

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Supabase pooler
      max: 3,
    });
  }
  return pool;
}

// 스키마/테이블 준비 (최초 1회)
async function ensure() {
  const p = getPool();
  await p.query(`create schema if not exists ${SCHEMA}`);
  await p.query(`create table if not exists ${SCHEMA}.usage (
    id bigserial primary key,
    phone text not null,
    name text,
    channel text not null,
    review_type text,
    created_at timestamptz default now(),
    unique (phone, channel)
  )`);
}

// 이 연락처가 해당 채널(카페/블로그) 후기를 이미 작성했는지
async function hasUsed(phone, channel) {
  const r = await getPool().query(
    `select 1 from ${SCHEMA}.usage where phone = $1 and channel = $2 limit 1`,
    [phone, channel]
  );
  return r.rowCount > 0;
}

// 작성 기록 남기기 (중복이면 무시)
async function record(phone, name, channel, reviewType) {
  await getPool().query(
    `insert into ${SCHEMA}.usage (phone, name, channel, review_type)
     values ($1, $2, $3, $4)
     on conflict (phone, channel) do nothing`,
    [phone, name || null, channel, reviewType || null]
  );
}

// 전체 등록 내역 (관리자용)
async function listUsage() {
  const r = await getPool().query(
    `select id, phone, name, channel, review_type, created_at
     from ${SCHEMA}.usage order by created_at desc`
  );
  return r.rows;
}

// 개별 삭제 (해당 연락처의 그 채널 슬롯이 다시 열림)
async function deleteById(id) {
  const r = await getPool().query(`delete from ${SCHEMA}.usage where id = $1`, [id]);
  return r.rowCount;
}

// 전체 초기화
async function resetAll() {
  const r = await getPool().query(`delete from ${SCHEMA}.usage`);
  return r.rowCount;
}

module.exports = {
  ensure, hasUsed, record, getPool, SCHEMA,
  listUsage, deleteById, resetAll,
};
