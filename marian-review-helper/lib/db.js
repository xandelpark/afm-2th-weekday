// Supabase(PostgreSQL) — 연락처별 후기 작성 횟수 제한
// 스키마: marian_review, 테이블: usage (phone+channel 조합당 1회)
const { Pool } = require("pg");

const SCHEMA = "marian_review";

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
    created_at timestamptz default now()
  )`);
  // 기존 unique(phone,channel) 제약이 있으면 제거 (채널당 여러 번 허용)
  await p.query(`alter table ${SCHEMA}.usage drop constraint if exists usage_phone_channel_key`);
  // 회원가입 신청 (이름 + 예식일자 + 전화번호 뒷4자리)
  await p.query(`create table if not exists ${SCHEMA}.access_request (
    id bigserial primary key,
    name text not null,
    wedding_date text not null,
    phone4 text not null default '',
    token text not null,
    status text not null default 'pending',
    created_at timestamptz default now(),
    approved_at timestamptz,
    unique (name, wedding_date, phone4)
  )`);
}

// 이 계정이 해당 채널(카페/블로그) 후기를 몇 번 작성했는지
async function countUsage(phone, channel) {
  const r = await getPool().query(
    `select count(*)::int c from ${SCHEMA}.usage where phone = $1 and channel = $2`,
    [phone, channel]
  );
  return r.rows[0].c;
}

// 작성 기록 남기기
async function record(phone, name, channel, reviewType) {
  await getPool().query(
    `insert into ${SCHEMA}.usage (phone, name, channel, review_type) values ($1, $2, $3, $4)`,
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

// ── 회원가입 / 로그인 ──
// (이름, 예식일자, 전화뒷4) 정확 일치 행
async function findSignup(name, weddingDate, phone4) {
  const r = await getPool().query(
    `select * from ${SCHEMA}.access_request where name = $1 and wedding_date = $2 and phone4 = $3 limit 1`,
    [name, weddingDate, phone4]
  );
  return r.rowCount ? r.rows[0] : null;
}
// (이름, 예식일자)만 일치 — 안내 메시지용. approved > pending > rejected 우선.
async function findByNameDate(name, weddingDate) {
  const r = await getPool().query(
    `select * from ${SCHEMA}.access_request where name = $1 and wedding_date = $2
     order by case status when 'approved' then 0 when 'pending' then 1 else 2 end limit 1`,
    [name, weddingDate]
  );
  return r.rowCount ? r.rows[0] : null;
}
// 가입 신청 생성 (중복이면 기존 행 반환)
async function createSignup(name, weddingDate, phone4, token) {
  const r = await getPool().query(
    `insert into ${SCHEMA}.access_request (name, wedding_date, phone4, token)
     values ($1, $2, $3, $4)
     on conflict (name, wedding_date, phone4) do update set name = excluded.name
     returning *`,
    [name, weddingDate, phone4, token]
  );
  return r.rows[0];
}
async function approveByToken(token) {
  const r = await getPool().query(
    `update ${SCHEMA}.access_request set status = 'approved', approved_at = now()
     where token = $1 returning name, wedding_date`,
    [token]
  );
  return r.rowCount ? r.rows[0] : null;
}
async function listAccessRequests() {
  const r = await getPool().query(
    `select id, name, wedding_date, phone4, status, created_at from ${SCHEMA}.access_request order by created_at desc`
  );
  return r.rows;
}
async function setAccessStatus(id, status) {
  const r = await getPool().query(
    `update ${SCHEMA}.access_request set status = $2, approved_at = case when $2='approved' then now() else approved_at end where id = $1`,
    [id, status]
  );
  return r.rowCount;
}
async function deleteAccessById(id) {
  const r = await getPool().query(`delete from ${SCHEMA}.access_request where id = $1`, [id]);
  return r.rowCount;
}

module.exports = {
  ensure, countUsage, record, getPool, SCHEMA,
  listUsage, deleteById, resetAll,
  findSignup, findByNameDate, createSignup, approveByToken,
  listAccessRequests, setAccessStatus, deleteAccessById,
};
