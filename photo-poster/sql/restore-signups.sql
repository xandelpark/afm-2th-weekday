-- ================================================================
-- photo-poster signups 테이블 복구 스크립트
-- ================================================================
-- 상황: 기존 Supabase 프로젝트(bgczrwripgsqtayrsgak)가 사라져(NXDOMAIN)
--       신청/승인 API가 전부 "Failed to fetch"가 됨.
-- 사용법: (복구/신규) Supabase 프로젝트 → SQL Editor 에 전체 붙여넣고 실행.
--         그 후 index.html 의 SUPABASE_URL / SUPABASE_KEY 를 해당 프로젝트 값으로 교체하고 재배포.
-- ================================================================

-- 1) 테이블 (index.html 의 toDB/fromDB 매핑과 정확히 일치)
create table if not exists public.signups (
  id           uuid        primary key default gen_random_uuid(),
  name         text        not null,
  wedding_date text        not null,          -- 앱에서 문자열로 저장 (weddingDate)
  phone4       text        not null,
  status       text        not null default 'pending',   -- pending | approved | rejected
  photo_count  int         not null default 0,
  applied_at   timestamptz not null default now(),
  approved_at  timestamptz
);

-- 2) 중복 신청 방지 (동시 신청 race condition 차단 — dedup-signups.sql STEP 3 과 동일)
create unique index if not exists signups_dedup_unique
  on public.signups (name, wedding_date, phone4);

-- 조회 정렬용
create index if not exists signups_applied_at_idx
  on public.signups (applied_at desc);

-- 3) 접근 정책
-- 앱은 브라우저에서 publishable(anon) 키로 직접 CRUD 한다. 기존 프로젝트도 그렇게 동작했다.
-- RLS 를 켜고 anon 에 전체 허용 정책을 준다(원래 동작 재현). 관리 UI 는 앱단 비밀번호로 통제.
alter table public.signups enable row level security;

drop policy if exists signups_anon_all on public.signups;
create policy signups_anon_all
  on public.signups
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- ── 참고: 예전에 승인했던 데이터를 CSV/JSON 으로 어딘가 받아두셨다면,
--    같은 컬럼으로 여기에 insert 하면 됩니다. (백업이 없으면 빈 상태로 시작)
