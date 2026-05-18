-- ================================================================
-- photo-poster signups 중복 신청 정리 + UNIQUE 제약
-- ================================================================
-- 사용법: Supabase Dashboard → SQL Editor 에서 한 블록씩 실행.
--   1) 먼저 [STEP 0] 으로 현재 중복 상태 확인
--   2) [STEP 1] 로 백업 테이블 만들기 (롤백 대비)
--   3) [STEP 2] 로 중복 정리 (approved 우선 유지)
--   4) [STEP 3] 로 UNIQUE 제약 추가 (앞으로 race condition 방지)
--   5) [STEP 4] 로 백업 테이블 정리 (선택)
-- ================================================================


-- ─── [STEP 0] 현재 중복 신청 그룹 확인 ───
-- 같은 (name, wedding_date, phone4) 조합으로 행이 2개 이상인 것만.
-- 결과를 보고 정말 정리할지 판단.
SELECT
  name, wedding_date, phone4,
  COUNT(*)                                  AS cnt,
  array_agg(id ORDER BY applied_at)         AS ids,
  array_agg(status ORDER BY applied_at)     AS statuses,
  array_agg(applied_at ORDER BY applied_at) AS applied_times
FROM signups
GROUP BY name, wedding_date, phone4
HAVING COUNT(*) > 1
ORDER BY cnt DESC, name;


-- ─── [STEP 1] 백업 (롤백용) ───
-- 원본 그대로 떠둠. STEP 4 에서 안 쓸 거 확인 후 DROP.
CREATE TABLE IF NOT EXISTS signups_backup_20260518 AS
  SELECT * FROM signups;


-- ─── [STEP 2] 중복 정리 ───
-- 같은 (name, wedding_date, phone4) 그룹에서 한 행만 살림.
-- 우선순위: status = 'approved' > 'pending' > 'rejected', 동률이면 가장 오래된 applied_at.
-- (approved 행을 살려야 사용자의 photo_count, approved_at 등 메타가 보존됨)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY name, wedding_date, phone4
      ORDER BY
        CASE status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 WHEN 'rejected' THEN 2 ELSE 9 END,
        applied_at ASC
    ) AS rn
  FROM signups
)
DELETE FROM signups
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);


-- ─── [STEP 2.5] (선택) name + wedding_date 만 같고 phone4 다른 그룹 확인 ───
-- 본인이 phone4 다르게 두 번 신청한 케이스. 관리자가 어느 phone4 가 맞는지 확인 필요.
-- 자동 정리는 위험하니 수동 확인 후 처리.
SELECT
  name, wedding_date,
  COUNT(*)                                  AS cnt,
  array_agg(id ORDER BY applied_at)         AS ids,
  array_agg(phone4 ORDER BY applied_at)     AS phones,
  array_agg(status ORDER BY applied_at)     AS statuses
FROM signups
GROUP BY name, wedding_date
HAVING COUNT(*) > 1
ORDER BY name;


-- ─── [STEP 3] UNIQUE 제약 추가 ───
-- 동시 신청 race condition 으로 같은 사람이 동시에 두 번 insert 되는 것을 DB 레벨에서 차단.
-- 앞으로는 app 코드에서 .insert() 시 unique violation 으로 reject 됨 → 앱이 alert.
CREATE UNIQUE INDEX IF NOT EXISTS signups_dedup_unique
  ON signups (name, wedding_date, phone4);


-- ─── [STEP 4] 백업 정리 (선택) ───
-- STEP 2 결과 확인 후 며칠 두었다가 문제 없으면 실행.
-- DROP TABLE signups_backup_20260518;


-- ─── 롤백 (STEP 2 결과가 마음에 안 들 경우) ───
-- TRUNCATE signups;
-- INSERT INTO signups SELECT * FROM signups_backup_20260518;
