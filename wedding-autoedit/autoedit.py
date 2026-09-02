#!/usr/bin/env python3
"""
④ 슬롯 템플릿 생성 + 새 원본에 적용 + 채점.

축을 무엇으로 잡는가
    원래는 식순(STT)을 축으로 쓰려 했으나, 실측 결과 하이라이트가 촬영 시간 순서를
    거의 그대로 따랐다 — 하이라이트 시각 vs 원본 클립 순서의 스피어만 상관이
    홍주영 +0.942 / 서지민 +0.884.
    그래서 **촬영 당일 실시각 진행률(0~1)**을 축으로 쓴다. STT 없이 지금 돌아간다.
    (식순이 붙으면 더 정밀해지지만, 그 전에 파이프라인 전체를 검증할 수 있다)

슬롯 정의
    ③ 역매칭 결과에서 '같은 원본 클립에 연속으로 대응하는 하이라이트 프레임 구간'을
    슬롯 하나로 본다. TransNetV2 컷 목록보다 이쪽이 안전하다 —
    실측에서 TransNetV2가 컷을 놓치는 사례를 확인했기 때문이다.

사용:
    .venv/bin/python autoedit.py build 260425_홍주영 -o tpl_hong.json
    .venv/bin/python autoedit.py apply tpl_hong.json 260425_서지민양수범 -o plan.json
    .venv/bin/python autoedit.py eval plan.json 260425_서지민양수범
"""
import argparse
import json
import os
import re
import sqlite3
from datetime import datetime

import numpy as np

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "features.db")

# 하이라이트에 실제로 쓰이는 카메라만 후보로 본다.
# 실측: 하이라이트 매칭 결과가 100% 핸드헬드였고 거치캠·서브캠은 한 컷도 안 쓰였다.
HANDHELD_HINTS = ("스냅캠", "메인캠")


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def load_timeline(conn, project):
    """원본 클립을 촬영 실시각 순으로 정렬하고, 프레임별 '당일 진행률'을 매긴다."""
    rows = conn.execute(
        """SELECT id, path, created_at, duration FROM sources
           WHERE project=? AND role='raw' AND created_at IS NOT NULL""",
        (project,)).fetchall()
    if not rows:
        return {}, (0, 1)
    t0 = min(ts(r[2]) for r in rows)
    t1 = max(ts(r[2]) + r[3] for r in rows)
    span = max(t1 - t0, 1)
    info = {}
    for sid, path, ca, dur in rows:
        info[sid] = {"path": path, "start": ts(ca) - t0, "dur": dur,
                     "handheld": any(h in path for h in HANDHELD_HINTS)}
    return info, (0, span)


def frames_of(conn, project, role_where):
    return conn.execute(f"""
        SELECT f.source_id, f.t, f.shot_size, f.face_pct, f.people_count,
               f.sharpness, f.motion, s.path
        FROM frames f JOIN sources s ON s.id=f.source_id
        WHERE s.project=? AND {role_where}
        ORDER BY s.path, f.t""", (project,)).fetchall()


# ─── build ───────────────────────────────────────────────

def cmd_build(args):
    conn = sqlite3.connect(DB)
    gt = json.load(open(args.match))
    info, (_, span) = load_timeline(conn, args.project)

    # 하이라이트 프레임의 화면 속성
    hl = {}
    for sid, t, ss, fp, pc, sh, mo, path in frames_of(
            conn, args.project, "s.path LIKE '%하이라이트%'"):
        hl[t] = {"shot_size": ss, "face_pct": fp, "people_count": pc,
                 "sharpness": sh}

    # 원본 클립 경로 → source_id
    p2s = {v["path"]: k for k, v in info.items()}

    # 같은 클립에 연속 대응하는 구간 = 슬롯
    slots, cur = [], None
    for r in gt:
        if not r["matched"]:
            cur = None
            continue
        if cur and r["src_clip"] == cur["src_clip"] and r["hl_t"] - cur["hl_end"] <= 1.5:
            cur["hl_end"] = r["hl_t"]
            cur["frames"].append(r)
        else:
            if cur:
                slots.append(cur)
            cur = {"src_clip": r["src_clip"], "src_path": r["src_path"],
                   "hl_start": r["hl_t"], "hl_end": r["hl_t"], "frames": [r]}
    if cur:
        slots.append(cur)

    total = max(s["hl_end"] for s in slots) if slots else 1
    out = []
    for i, s in enumerate(slots):
        sid = p2s.get(s["src_path"])
        if sid is None:
            continue
        src_abs = info[sid]["start"] + s["frames"][0]["src_t"]
        attrs = [hl.get(f["hl_t"]) for f in s["frames"]]
        attrs = [a for a in attrs if a]
        def med(k):
            v = [a[k] for a in attrs if a[k] is not None]
            return float(np.median(v)) if v else None
        sizes = [a["shot_size"] for a in attrs if a["shot_size"]]
        out.append({
            "slot": i,
            "hl_start": s["hl_start"],
            "duration": round(s["hl_end"] - s["hl_start"] + 1.0, 2),
            "hl_progress": round(s["hl_start"] / total, 4),
            "day_progress": round(src_abs / span, 4),
            "shot_size": max(set(sizes), key=sizes.count) if sizes else None,
            "face_pct": round(med("face_pct"), 1) if med("face_pct") else None,
            "people_count": int(med("people_count")) if med("people_count") else None,
            "src_clip": s["src_clip"],          # 채점용 정답
            "src_t": s["frames"][0]["src_t"],
        })

    tpl = {"source_project": args.project, "n_slots": len(out),
           "total_duration": round(total, 1), "slots": out}
    json.dump(tpl, open(args.out, "w"), ensure_ascii=False, indent=1)
    d = [s["duration"] for s in out]
    print(f"슬롯 {len(out)}개 / 전체 {total:.0f}초")
    print(f"  컷길이 중앙 {np.median(d):.2f}s  평균 {np.mean(d):.2f}s")
    print(f"  저장: {args.out}")


# ─── apply ───────────────────────────────────────────────

SIZE_ORDER = ["wide", "full", "medium", "medium_closeup", "closeup",
              "extreme_closeup"]


def cmd_apply(args):
    conn = sqlite3.connect(DB)
    tpl = json.load(open(args.template))
    info, (_, span) = load_timeline(conn, args.project)

    rows = frames_of(conn, args.project, "s.role='raw'")
    F = []
    for sid, t, ss, fp, pc, sh, mo, path in rows:
        if sid not in info or not info[sid]["handheld"]:
            continue
        F.append({"sid": sid, "t": t, "shot_size": ss, "face_pct": fp,
                  "people_count": pc, "sharpness": sh, "motion": mo,
                  "path": path, "clip": os.path.basename(path),
                  "day": (info[sid]["start"] + t) / span})
    if not F:
        raise SystemExit("후보 프레임이 없습니다 (핸드헬드 카메라 인식 실패?)")

    sharp = np.array([f["sharpness"] or 0 for f in F])
    sh_rank = sharp.argsort().argsort() / len(sharp) * 100
    for f, r in zip(F, sh_rank):
        f["sharp_pct"] = r

    plan, used = [], set()
    for s in tpl["slots"]:
        best, bscore = None, -1e9
        for k, f in enumerate(F):
            if k in used:
                continue
            dday = abs(f["day"] - s["day_progress"])
            if dday > args.window:
                continue
            score = 1.0 - dday / args.window          # 시간 근접
            if s["shot_size"] and f["shot_size"]:
                try:
                    gap = abs(SIZE_ORDER.index(f["shot_size"])
                              - SIZE_ORDER.index(s["shot_size"]))
                except ValueError:
                    gap = 3
                score += 0.8 * max(0, 1 - gap / 2)
            if s["face_pct"] is not None and f["face_pct"] is not None:
                score += 0.5 * max(0, 1 - abs(f["face_pct"] - s["face_pct"]) / 40)
            if s["people_count"] and f["people_count"]:
                score += 0.3 * max(0, 1 - abs(f["people_count"] - s["people_count"]) / 3)
            score += 0.4 * (f["sharp_pct"] / 100)       # 선명한 컷 선호
            if score > bscore:
                bscore, best = score, k
        if best is None or bscore < args.min_score:
            plan.append({**{k: s[k] for k in ("slot", "hl_start", "duration",
                                              "shot_size", "day_progress")},
                         "filled": False, "score": round(bscore, 3)})
            continue
        f = F[best]
        for k in range(max(0, best - 2), min(len(F), best + 3)):
            used.add(k)                                # 같은 구간 재사용 방지
        plan.append({**{k: s[k] for k in ("slot", "hl_start", "duration",
                                          "shot_size", "day_progress")},
                     "filled": True, "score": round(bscore, 3),
                     "pick_clip": f["clip"], "pick_path": f["path"],
                     "pick_t": f["t"],
                     "gt_clip": s.get("src_clip"), "gt_t": s.get("src_t")})

    n = sum(p["filled"] for p in plan)
    json.dump({"template": args.template, "target": args.project,
               "plan": plan}, open(args.out, "w"), ensure_ascii=False, indent=1)
    print(f"슬롯 {len(plan)}개 중 {n}개 채움 ({n/len(plan)*100:.1f}%), "
          f"빈칸 {len(plan)-n}개")
    print(f"  저장: {args.out}")


# ─── eval ────────────────────────────────────────────────

def cmd_eval(args):
    d = json.load(open(args.plan))
    plan = [p for p in d["plan"] if p.get("filled")]
    if not plan:
        raise SystemExit("채워진 슬롯이 없습니다.")
    have_gt = [p for p in plan if p.get("gt_clip")]
    if not have_gt:
        print("정답 정보가 없는 계획입니다 (교차 적용). 채움률만 보고합니다.")
        return
    exact = sum(p["pick_clip"] == p["gt_clip"] for p in have_gt)
    near = sum(p["pick_clip"] == p["gt_clip"] and abs(p["pick_t"] - p["gt_t"]) <= 2
               for p in have_gt)
    print(f"=== 채점 (정답 있는 슬롯 {len(have_gt)}개) ===")
    print(f"  같은 원본 클립 선택   {exact}/{len(have_gt)} = {exact/len(have_gt)*100:.1f}%")
    print(f"  ±2초 이내까지 일치    {near}/{len(have_gt)} = {near/len(have_gt)*100:.1f}%")
    def num(s):
        m = re.search(r"(\d+)", s or "")
        return int(m.group(1)) if m else 0
    dif = [abs(num(p["pick_clip"]) - num(p["gt_clip"])) for p in have_gt]
    print(f"  클립 번호 차이 중앙값 {np.median(dif):.0f} "
          f"(0이면 정확, 작을수록 비슷한 시점)")


def main():
    ap = argparse.ArgumentParser(description="슬롯 템플릿 생성·적용·채점")
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="역매칭 결과 → 슬롯 템플릿")
    b.add_argument("project")
    b.add_argument("--match", help="match_*.json (기본: match_<project>.json)")
    b.add_argument("-o", "--out", default="template.json")
    b.set_defaults(func=cmd_build)

    a = sub.add_parser("apply", help="템플릿을 다른 원본에 적용")
    a.add_argument("template")
    a.add_argument("project")
    a.add_argument("--window", type=float, default=0.06,
                   help="당일 진행률 탐색 폭 (0.06 = 하루의 6%%)")
    a.add_argument("--min-score", type=float, default=1.2,
                   help="이 점수 못 넘으면 빈칸으로 남긴다")
    a.add_argument("-o", "--out", default="plan.json")
    a.set_defaults(func=cmd_apply)

    e = sub.add_parser("eval", help="계획을 정답과 대조")
    e.add_argument("plan")
    e.add_argument("project", nargs="?")
    e.set_defaults(func=cmd_eval)

    args = ap.parse_args()
    if args.cmd == "build" and not args.match:
        args.match = os.path.join(BASE, f"match_{args.project}.json")
    args.func(args)


if __name__ == "__main__":
    main()
