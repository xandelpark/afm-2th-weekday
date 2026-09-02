-- 코워크(worktime) 스키마
-- 프리랜서 타임시트
create schema if not exists worktime;

-- 프리랜서
create table if not exists worktime.workers (
  id           bigserial primary key,
  name         text        not null,
  code_hash    text        not null,          -- 접속 코드는 bcrypt 해시로만 저장
  code_hint    text        not null default '',-- 대표 화면 표시용 마스킹 (예: 4•••9)
  active       boolean     not null default true,
  created_at   timestamptz not null default now()
);

-- 작업 세션: 작업 시작 ~ 작업 종료
create table if not exists worktime.sessions (
  id            bigserial primary key,
  worker_id     bigint      not null references worktime.workers(id) on delete cascade,
  work_date     date        not null,          -- KST 기준 근무일
  started_at    timestamptz not null,
  ended_at      timestamptz,                   -- null이면 진행 중
  end_reason    text,                          -- checkout(정상) | no_checkout(작업 종료 안 누름)
  created_at    timestamptz not null default now()
);

create index if not exists sessions_worker_date_idx on worktime.sessions (worker_id, work_date);
create index if not exists sessions_open_idx        on worktime.sessions (worker_id) where ended_at is null;

-- 설정 (코어타임, 근무시간대, 유휴 판정 등)
create table if not exists worktime.settings (
  key   text primary key,
  value jsonb not null
);

insert into worktime.settings (key, value) values
  ('policy', '{
     "work_start":  "08:00",
     "work_end":    "20:00",
     "core_start":  "10:00",
     "core_end":    "15:00",
     "idle_minutes": 10,
     "beat_seconds": 30,
     "confirm_minutes": 60
   }'::jsonb)
on conflict (key) do nothing;
