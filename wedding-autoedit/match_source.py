#!/usr/bin/env python3
"""
③ 역매칭 — 하이라이트의 각 컷이 원본 어느 클립·어느 시점에서 왔는지 복원한다.

이게 슬롯 템플릿의 근거이자, ④ 매칭기를 채점할 **정답지**가 된다.

왜 가벼운 방법으로 되는가:
  앞서 크롭(punch-in)을 안 쓴다는 걸 실측으로 확인했다
  (하이라이트 최대 얼굴높이비 0.200 < 스냅캠 원본 0.344).
  즉 하이라이트 프레임은 원본 프레임과 기하학적으로 동일하고,
  차이는 색보정뿐이다. 그래서 무거운 임베딩 모델 없이
  **z-정규화한 그레이스케일 상관계수**로 충분하다 — 밝기·대비 변화에 불변이다.

자체 검증:
  매칭이 옳다면 2.5초짜리 하이라이트 컷은 한 원본 클립의 **연속된 2~3초**에 대응해야 한다.
  결과가 클립을 넘나들며 튀면 틀린 것이다. 이 응집도를 점수로 출력한다.

사용:
    .venv/bin/python match_source.py 260425_서지민양수범
    .venv/bin/python match_source.py 260425_홍주영 --json out.json
"""
import argparse
import json
import os
import sqlite3
import sys

import numpy as np
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(BASE, "store")

DESC_W, DESC_H = 32, 18          # 디스크립터 해상도
DESC_D = DESC_W * DESC_H

# 세로 중앙 몇 %만 비교할지.
# 실측: 홍주영 하이라이트에 상하 11.9%씩 시네마 레터박스(2.39:1)가 들어가 있다.
# (서지민 하이라이트와 원본에는 없다 — 프로젝트마다 화면비 처리가 다르다)
# 검은 띠가 화면의 24%를 덮으면 같은 장면인데도 상관계수가 무너진다.
# 양쪽 다 중앙 70%만 보면 띠를 버리고 공통 영역만 비교하게 된다.
CENTER_CROP = 0.70


def descriptor(path, crop=CENTER_CROP):
    """z-정규화 그레이스케일. 색보정으로 밝기·대비가 바뀌어도 불변."""
    try:
        with Image.open(path) as im:
            im = im.convert("L")
            if crop < 1.0:
                w, h = im.size
                m = int(h * (1 - crop) / 2)
                im = im.crop((0, m, w, h - m))
            g = np.asarray(im.resize((DESC_W, DESC_H), Image.BILINEAR),
                           dtype=np.float32).ravel()
    except Exception:
        return None
    g -= g.mean()
    n = np.linalg.norm(g)
    return g / n if n > 1e-6 else None


def load_frames(conn, project, where, cache_tag):
    """(메타 리스트, 디스크립터 행렬). 디스크립터는 캐시한다."""
    rows = conn.execute(f"""
        SELECT f.id, f.t, f.thumb, s.id, s.path
        FROM frames f JOIN sources s ON s.id = f.source_id
        WHERE s.project = ? AND {where}
        ORDER BY s.path, f.t""", (project,)).fetchall()

    cache = os.path.join(BASE, f".desc_{project}_{cache_tag}.npz")
    if os.path.exists(cache):
        z = np.load(cache, allow_pickle=True)
        if len(z["meta"]) == len(rows):
            return list(z["meta"]), z["mat"]

    meta, vecs = [], []
    for i, (fid, t, thumb, sid, spath) in enumerate(rows):
        d = descriptor(os.path.join(STORE, thumb))
        if d is None:
            continue
        meta.append((fid, float(t), os.path.basename(spath), spath))
        vecs.append(d)
        if i % 2000 == 0 and i:
            print(f"    …{i:,}/{len(rows):,}장", flush=True)
    mat = np.stack(vecs) if vecs else np.zeros((0, DESC_D), np.float32)
    np.savez_compressed(cache, meta=np.array(meta, dtype=object), mat=mat)
    return meta, mat


def main():
    ap = argparse.ArgumentParser(description="하이라이트 → 원본 역매칭")
    ap.add_argument("project")
    ap.add_argument("--db", default=os.path.join(BASE, "features.db"))
    ap.add_argument("--min-score", type=float, default=0.80,
                    help="이 상관계수 미만은 '매칭 실패'로 본다")
    ap.add_argument("--local", type=int, default=3,
                    help="컷 단위 정렬 뒤 프레임별로 ±N초 국소 보정 (0=끄기)")
    ap.add_argument("--cuts", default=os.path.join(BASE, "highlights_cuts.json"),
                    help="shotdetect.py가 뽑은 컷 목록 (자체 검증에 사용)")
    ap.add_argument("--json")
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)

    print(f"[{args.project}] 원본 프레임 로딩…")
    raw_meta, R = load_frames(conn, args.project, "s.role='raw'", "raw")
    print(f"  원본 {len(raw_meta):,}장")

    print("하이라이트 프레임 로딩…")
    hl_meta, H = load_frames(conn, args.project,
                             "s.path LIKE '%하이라이트%'", "hl")
    print(f"  하이라이트 {len(hl_meta):,}장\n")

    if not len(H) or not len(R):
        sys.exit("프레임이 없습니다. 스캔이 끝났는지 확인하세요.")

    # 상관계수 행렬 (정규화된 벡터의 내적 = 상관계수)
    S = H @ R.T

    # ── 컷 단위 정렬 ────────────────────────────────────
    # 프레임을 하나씩 독립으로 고르면 인접 테이크끼리 헷갈린다(실측 28%가 다른 클립으로 튐).
    # 스냅캠 테이크가 5~10초씩이라 장면이 거의 같기 때문이다.
    # '하이라이트 컷 하나 = 원본 한 클립의 연속 구간'이라는 물리적 사실을 넣어,
    # 컷에 속한 프레임 전체를 한꺼번에 설명하는 (클립, 시작지점)을 고른다.
    #
    # 프로젝트명에서 신랑신부 이름 앞 3글자를 뽑아 경로로 대조한다
    #   260425_홍주영      → '홍주영'
    #   260425_서지민양수범 → '서지민'  (경로의 '서지민 양수범'과 매칭)
    cuts = []
    key = args.project.split("_", 1)[-1][:3]
    if os.path.exists(args.cuts):
        for r in json.load(open(args.cuts)):
            if key in r["path"]:
                cuts = r["cuts"]
                break

    def cut_idx(t):
        i = 0
        for cx in cuts:
            if t >= cx:
                i += 1
        return i

    # 원본 프레임이 클립 경계를 넘는 지점 표시 (연속 구간 판정용)
    raw_clip = np.array([m[3] for m in raw_meta])
    N = len(raw_meta)

    groups = {}
    for i, (_, t, _, _) in enumerate(hl_meta):
        groups.setdefault(cut_idx(t) if cuts else 0, []).append(i)

    # 배속 후보. 스냅캠은 60p인데 하이라이트는 24p라 슬로우모션을 쓰면
    # 하이라이트 1초가 원본 1초보다 짧은 구간에 대응한다.
    #   1.0 = 등속, 0.4 = 2.5배 슬로우(60p→24p), 0.5 = 2배 슬로우
    # 등속으로만 맞추면 첫 프레임만 맞고 뒤로 갈수록 어긋난다(실측 p10=0.29).
    SPEEDS = [1.0, 0.5, 0.4]

    # ── DP 정렬 ────────────────────────────────────────
    # 컷 경계를 믿고 프레임을 묶는 방식은 취약하다. 실측 사례:
    #   컷 그룹 [23s,24s,25s] 중 25s만 C6556과 1.000으로 일치하고 23·24s는 다른 소스였다
    #   → TransNetV2가 그 사이 컷을 놓쳤는데 셋을 억지로 한 클립에 묶어 전부 망가졌다.
    # 그래서 컷 목록에 의존하지 않고, '같은 클립에서 시간순으로 이어지면 보너스,
    # 클립을 갈아타면 벌점'만 주고 최적 경로를 찾는다. 놓친 컷이 있어도 알아서 갈라진다.
    def dp_align(S, raw_clip, jump_penalty=0.35, max_step=3):
        M, N = S.shape
        dp = S[0].copy()
        back = np.zeros((M, N), dtype=np.int32)
        for i in range(1, M):
            # (a) 같은 클립에서 0~max_step 전진
            cont = np.full(N, -1e9, dtype=np.float32)
            src = np.zeros(N, dtype=np.int32)
            for d in range(max_step + 1):
                if d == 0:
                    cand, idx = dp.copy(), np.arange(N)
                else:
                    cand = np.full(N, -1e9, dtype=np.float32)
                    cand[d:] = dp[:-d]
                    idx = np.arange(N) - d
                    same = np.zeros(N, dtype=bool)
                    same[d:] = raw_clip[d:] == raw_clip[:-d]
                    cand[~same] = -1e9
                better = cand > cont
                cont[better], src[better] = cand[better], idx[better]
            # (b) 어디서든 점프 (벌점)
            jb = int(dp.argmax())
            jump = dp[jb] - jump_penalty
            use_jump = jump > cont
            dp = np.where(use_jump, jump, cont) + S[i]
            back[i] = np.where(use_jump, jb, src)
        path = np.zeros(M, dtype=np.int32)
        path[-1] = int(dp.argmax())
        for i in range(M - 1, 0, -1):
            path[i - 1] = back[i][path[i]]
        return path

    path = dp_align(S, raw_clip)
    results = [None] * len(hl_meta)
    for i, j in enumerate(path):
        _, rt, rclip, rpath = raw_meta[int(j)]
        sc = float(S[i, int(j)])
        results[i] = {
            "hl_t": hl_meta[i][1], "score": round(sc, 4),
            "src_clip": rclip, "src_t": rt, "src_path": rpath,
            "matched": bool(sc >= args.min_score),
        }

    score = np.array([r["score"] for r in results])
    ok = sum(r["matched"] for r in results)
    print("=== 매칭 결과 (DP 정렬) ===")
    print(f"  성공 {ok}/{len(results)}장 ({ok/len(results)*100:.1f}%) "
          f"— 상관계수 {args.min_score} 이상")
    q = np.quantile(score, [0.1, 0.25, 0.5, 0.75, 0.9])
    print(f"  상관계수 분포  p10={q[0]:.3f} p25={q[1]:.3f} p50={q[2]:.3f} "
          f"p75={q[3]:.3f} p90={q[4]:.3f}")

    runs = same = 0
    for a, b in zip(results, results[1:]):
        if not (a["matched"] and b["matched"]):
            continue
        if b["hl_t"] - a["hl_t"] > 1.5:
            continue
        if cuts and cut_idx(a["hl_t"]) != cut_idx(b["hl_t"]):
            continue                      # 컷 경계를 넘음 → 검증 대상 아님
        runs += 1
        if a["src_clip"] == b["src_clip"] and -0.5 <= b["src_t"] - a["src_t"] <= 2.5:
            same += 1
    tag = f"컷 {len(cuts)}개 기준" if cuts else "컷 정보 없음 — 경계 미보정"
    print(f"\n  자체 검증 ({tag}) — 같은 컷 안의 인접 프레임이 "
          f"한 클립의 연속 구간에 붙는 비율: {same}/{runs} = {same/max(runs,1)*100:.1f}%")

    used = {}
    for r in results:
        if r["matched"]:
            used[r["src_clip"]] = used.get(r["src_clip"], 0) + 1
    print(f"\n  하이라이트가 사용한 원본 클립: {len(used)}개")
    for clip, n in sorted(used.items(), key=lambda x: -x[1])[:10]:
        print(f"    {clip:<16} {n:>3}초")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fp:
            json.dump(results, fp, ensure_ascii=False, indent=1)
        print(f"\n저장: {args.json}")


if __name__ == "__main__":
    main()
