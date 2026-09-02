#!/usr/bin/env python3
"""
스캔 완료 후 DB 정리. **배치 스캔이 끝난 뒤에 실행할 것** (DB 동시 쓰기 방지).

1) 경로를 NFC로 정규화
   macOS는 파일명을 NFD(분해형) 유니코드로 저장한다. 파이썬 문자열 리터럴은 NFC라
   `WHERE path LIKE '%하이라이트%'` 같은 한글 조회가 조용히 0건을 반환한다.
   실제로 겪음: '거치캠'(내가 셸에서 넘긴 경로 = NFC)은 맞고
   '하이라이트.mp4'(파일시스템에서 읽은 이름 = NFD)는 안 맞았다.
   macOS는 NFC 경로로도 파일을 열 수 있으므로 NFC 저장이 안전하다.

2) shot_size 재계산
   샷사이즈 경계값(SHOT_SIZE_BINS)을 실촬영본 분포로 바꿨다.
   face_ratio 원시값을 저장해뒀으므로 **재스캔 없이** 다시 분류만 하면 된다.
   (100GB를 다시 훑지 않으려고 원시값을 남겨둔 설계가 여기서 값을 한다)

3) face_pct — 카메라별 백분위 추가
   절대 경계값은 예식장을 건너면 흔들린다. 실측:
     핸드헬드끼리 비교(A 스냅캠 vs B 메인캠)
       p50  0.103 → 0.106  (+2%,  사실상 동일)
       p90  0.169 → 0.213  (+25%, 크게 벌어짐)
   "평소 찍는 거리"는 습관이라 안정적이지만 "얼마나 바짝 붙는가"는 예식마다 다르다.
   그래서 `closeup ≥ 0.19` 같은 절대 기준은 A에서 상위 5%, B에서 상위 15%를 집는다.
   → 매칭은 **카메라 안에서의 백분위**로 한다. "이 촬영본에서 상위 5% 타이트한 샷"은
     예식장이 바뀌어도 의도가 그대로 전달된다.
   shot_size(절대 분류)는 사람이 읽는 용도로 그대로 남긴다.

사용:
    .venv/bin/python migrate.py            # 미리보기
    .venv/bin/python migrate.py --apply     # 실제 반영
"""
import argparse
import os
import sqlite3
import unicodedata as u
from collections import defaultdict

from vision_attrs import SHOT_SIZE_BINS, BODY_SIZE_BINS


def classify(ratio, basis):
    if ratio is None or basis is None:
        return None
    bins = SHOT_SIZE_BINS if basis == "face" else BODY_SIZE_BINS
    for thr, name in bins:
        if ratio >= thr:
            return name
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="features.db")
    ap.add_argument("--apply", action="store_true", help="실제로 반영 (없으면 미리보기)")
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)

    # ── 1) 경로 NFC 정규화 ──────────────────────────────
    rows = conn.execute("SELECT id, path FROM sources").fetchall()
    nfd = [(i, p) for i, p in rows if p != u.normalize("NFC", p)]
    print(f"[경로] NFD로 저장된 소스: {len(nfd)}/{len(rows)}개")
    for i, p in nfd[:3]:
        print(f"       예: {p.split('/')[-1]!r} → {u.normalize('NFC', p.split('/')[-1])!r}")

    # ── 2) shot_size 재계산 ─────────────────────────────
    frames = conn.execute(
        "SELECT id, shot_size, shot_basis, face_ratio FROM frames"
    ).fetchall()
    changes = []
    for fid, old, basis, ratio in frames:
        new = classify(ratio, basis)
        if new != old:
            changes.append((new, fid))

    print(f"[샷사이즈] 전체 {len(frames):,}장 중 재분류 대상 {len(changes):,}장 "
          f"({len(changes)/max(len(frames),1)*100:.1f}%)")

    if changes:
        from collections import Counter
        before = Counter(r[1] for r in frames)
        after = Counter(classify(r[3], r[2]) for r in frames)
        keys = sorted(set(before) | set(after), key=lambda x: (x is None, str(x)))
        print(f"       {'분류':<18}{'이전':>8}{'이후':>8}")
        for k in keys:
            print(f"       {str(k):<18}{before.get(k,0):>8,}{after.get(k,0):>8,}")

    # ── 3) face_pct: 카메라 × 판정근거 안에서의 백분위 ──
    #    그룹 단위를 '카메라 폴더'로 잡는다. 프레이밍 습관이 일정한 단위가 그것이고,
    #    새 촬영본이 들어와도 같은 방식으로 자기 안에서 백분위를 매길 수 있다.
    rows = conn.execute(
        """SELECT f.id, f.face_ratio, f.shot_basis, s.project, s.path
           FROM frames f JOIN sources s ON s.id = f.source_id
           WHERE f.face_ratio IS NOT NULL AND f.shot_basis IS NOT NULL"""
    ).fetchall()

    groups = defaultdict(list)
    for fid, ratio, basis, project, path in rows:
        cam = os.path.basename(os.path.dirname(u.normalize("NFC", path)))
        groups[(project, cam, basis)].append((ratio, fid))

    pcts = []
    for key, items in groups.items():
        items.sort()
        n = len(items)
        for rank, (_, fid) in enumerate(items):
            pcts.append((round((rank + 0.5) / n * 100, 2), fid))

    print(f"[백분위] {len(rows):,}장을 {len(groups)}개 그룹(프로젝트×카메라×근거)으로 계산")
    for key in sorted(groups, key=lambda k: -len(groups[k]))[:6]:
        print(f"       {key[0]:<18} {key[1]:<14} {key[2]:<5} {len(groups[key]):>5,}장")

    if not args.apply:
        print("\n미리보기입니다. 반영하려면 --apply 를 붙이세요.")
        return

    cols = {r[1] for r in conn.execute("PRAGMA table_info(frames)")}
    if "face_pct" not in cols:
        conn.execute("ALTER TABLE frames ADD COLUMN face_pct REAL")

    with conn:
        for i, p in nfd:
            conn.execute("UPDATE sources SET path=? WHERE id=?",
                         (u.normalize("NFC", p), i))
        conn.executemany("UPDATE frames SET shot_size=? WHERE id=?", changes)
        conn.executemany("UPDATE frames SET face_pct=? WHERE id=?", pcts)
    print(f"\n✅ 반영 완료 — 경로 {len(nfd)}건, 샷사이즈 {len(changes):,}건, "
          f"백분위 {len(pcts):,}건")
    conn.close()


if __name__ == "__main__":
    main()
