#!/usr/bin/env python3
"""
④ 의미 기반 슬롯 매칭.

시간 축을 버린 이유
    "촬영 당일 진행률"로 후보를 좁히니 교차 검증에서 기저 대비 1.21배에 그쳤다.
    예식마다 일정이 다르고 카메라를 껐다 켰다 하므로, 시계로는 같은 상황을 못 찾는다.

대신 쓰는 것
    1) CLIP 의미 임베딩 — "신부 입장 와이드"는 예식장이 달라도 비슷하게 생겼다.
    2) 순서 단조성 — 하이라이트는 촬영 시간 순서를 따른다(스피어만 +0.94/+0.88).
       슬롯을 순서대로 채우되 원본에서도 시간이 되돌아가지 않게 DP로 강제한다.
       이러면 '행진' 자리에 '신부입장' 클립이 들어가는 일이 구조적으로 막힌다.
    3) 화면 속성·품질 — 샷사이즈, 인원, 선명도로 보정.

사용:
    .venv/bin/python plan_semantic.py build 260425_홍주영 -o t.json
    .venv/bin/python plan_semantic.py apply t.json 260425_서지민양수범 -o p.json
    .venv/bin/python plan_semantic.py eval p.json
"""
import argparse
import json
import os
import sqlite3
from datetime import datetime

import numpy as np

from semprofile import text_bank, profiles

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "features.db")
EMB = os.path.join(BASE, "clip_embeds.npz")

HANDHELD_HINTS = ("스냅캠", "메인캠")   # 하이라이트는 100% 핸드헬드에서 나온다(실측)
SIZE_ORDER = ["wide", "full", "medium", "medium_closeup", "closeup",
              "extreme_closeup"]


def load_emb():
    z = np.load(EMB)
    idx = {int(i): k for k, i in enumerate(z["ids"])}
    return idx, z["mat"].astype(np.float32)


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def target_frames(conn, project, handheld_only=True):
    """대상 원본 프레임을 촬영 실시각 순으로 정렬해 돌려준다."""
    rows = conn.execute("""
        SELECT f.id, f.t, f.shot_size, f.face_pct, f.people_count, f.sharpness,
               s.path, s.created_at, f.moment, f.shake
        FROM frames f JOIN sources s ON s.id=f.source_id
        WHERE s.project=? AND s.role='raw' AND s.created_at IS NOT NULL""",
        (project,)).fetchall()
    out = []
    for fid, t, ss, fp, pc, sh, path, ca, mom, shk in rows:
        if handheld_only and not any(h in path for h in HANDHELD_HINTS):
            continue
        out.append({"fid": fid, "t": t, "moment": mom, "shot_size": ss, "face_pct": fp,
                    "people_count": pc, "sharpness": sh or 0.0,
                    "shake": shk,
                    "path": path, "clip": os.path.basename(path),
                    "abs": ts(ca) + t})
    out.sort(key=lambda r: r["abs"])
    return out


# ─── build ───────────────────────────────────────────────

def cmd_build(args):
    conn = sqlite3.connect(DB)
    idx, M = load_emb()
    if args.profile:
        M = profiles(M, temp=args.temp)   # 이미지 공간 → 언어 공간(의미 지문)
    gt = json.load(open(args.match))

    hl = {r[1]: r for r in conn.execute("""
        SELECT f.id, f.t, f.shot_size, f.face_pct, f.people_count, f.moment
        FROM frames f JOIN sources s ON s.id=f.source_id
        WHERE s.project=? AND s.path LIKE '%하이라이트%'""", (args.project,))}

    # 같은 원본 클립에 연속 대응하는 구간 = 슬롯
    slots, cur = [], None
    for r in gt:
        if not r["matched"]:
            cur = None
            continue
        if cur and r["src_clip"] == cur["src_clip"] and r["hl_t"] - cur["end"] <= 1.5:
            cur["end"] = r["hl_t"]
            cur["ts"].append(r["hl_t"])
        else:
            if cur:
                slots.append(cur)
            cur = {"src_clip": r["src_clip"], "start": r["hl_t"],
                   "end": r["hl_t"], "ts": [r["hl_t"]], "src_t": r["src_t"]}
    if cur:
        slots.append(cur)

    out = []
    for i, s in enumerate(slots):
        vecs = [M[idx[hl[t][0]]] for t in s["ts"] if t in hl and hl[t][0] in idx]
        if not vecs:
            continue
        v = np.mean(vecs, axis=0)
        v /= np.linalg.norm(v) + 1e-8
        sizes = [hl[t][2] for t in s["ts"] if t in hl and hl[t][2]]
        pcs = [hl[t][4] for t in s["ts"] if t in hl and hl[t][4]]
        moms = [hl[t][5] for t in s["ts"] if t in hl and hl[t][5]]
        out.append({
            "slot": i,
            "hl_start": s["start"],
            "duration": round(s["end"] - s["start"] + 1.0, 2),
            # 동점 시 set 순회 순서에 의존하면 실행마다 템플릿이 바뀐다
            # (파이썬은 프로세스별로 문자열 해시를 무작위화한다). 정렬로 고정한다.
            "shot_size": (max(sorted(set(sizes)), key=sizes.count) if sizes else None),
            "people_count": int(np.median(pcs)) if pcs else None,
            "moment": (max(sorted(set(moms)), key=moms.count) if moms else None),
            "embed": [round(float(x), 5) for x in v],
            "src_clip": s["src_clip"], "src_t": s["src_t"],
        })

    # 사용/미사용 클립의 평균 지문 차이 = '이 편집자가 쓸 만하다고 본 방향'
    used = {x["src_clip"] for x in gt if x["matched"]}
    rows = conn.execute("""SELECT f.id, s.path FROM frames f JOIN sources s ON s.id=f.source_id
        WHERE s.project=? AND s.role='raw'""", (args.project,)).fetchall()
    pos, neg = [], []
    for fid, path in rows:
        if fid not in idx or not any(h in path for h in ("스냅캠", "메인캠")):
            continue
        (pos if os.path.basename(path) in used else neg).append(M[idx[fid]])
    use_dir = None
    if pos and neg:
        d = np.mean(pos, 0) - np.mean(neg, 0)
        use_dir = [round(float(x), 6) for x in d / (np.linalg.norm(d) + 1e-8)]
        print(f"  사용성 방향 학습: 사용 {len(pos):,}장 vs 버림 {len(neg):,}장")

    json.dump({"source_project": args.project, "use_dir": use_dir, "slots": out},
              open(args.out, "w"), ensure_ascii=False)
    d = [s["duration"] for s in out]
    print(f"슬롯 {len(out)}개 / 컷길이 중앙 {np.median(d):.2f}s → {args.out}")


# ─── apply ───────────────────────────────────────────────

def cmd_apply(args):
    conn = sqlite3.connect(DB)
    idx, M = load_emb()
    if args.profile:
        M = profiles(M, temp=args.temp)
    tpl = json.load(open(args.template))
    slots = tpl["slots"]

    F = [f for f in target_frames(conn, args.project) if f["fid"] in idx]
    if not F:
        raise SystemExit("후보 프레임 없음")
    E = np.stack([M[idx[f["fid"]]] for f in F])          # N × D
    if args.smooth > 0:
        # 시간 평활: 1fps 프레임 하나는 노이즈가 크다(오차가 전역 밀림이 아니라
        # 국소 산포로 나타났다 — 표준편차 0.11~0.14). 같은 클립 안에서만 ±smooth초
        # 평균을 내 지문을 안정시킨다. 클립을 넘으면 다른 장면이라 섞으면 안 된다.
        clip_ids = np.array([f["clip"] for f in F])
        Es = np.empty_like(E)
        for k in range(len(F)):
            lo, hi = k, k
            while lo > 0 and clip_ids[lo - 1] == clip_ids[k] and k - lo < args.smooth:
                lo -= 1
            while hi < len(F) - 1 and clip_ids[hi + 1] == clip_ids[k] and hi - k < args.smooth:
                hi += 1
            Es[k] = E[lo:hi + 1].mean(0)
        E = Es / (np.linalg.norm(Es, axis=1, keepdims=True) + 1e-8)
    T = np.stack([np.array(s["embed"], np.float32) for s in slots])  # M × 512

    # ── 사용성 필터 ───────────────────────────────────
    # 원본 클립 중 편집자가 실제로 쓴 것 vs 버린 것을 템플릿 프로젝트에서 배워
    # 대상 후보를 걸러낸다. 지금까지 안 쓰고 있던 유일한 신호가 '버려진 클립'이었다.
    if args.usability > 0 and tpl.get("use_dir"):
        w = np.array(tpl["use_dir"], np.float32)
        u = E @ w
        keep = u >= np.quantile(u, args.usability)
        if keep.sum() > len(slots) * 3:          # 너무 많이 버리지 않도록
            F = [f for f, k in zip(F, keep) if k]
            E = E[keep]
    sim = T @ E.T                                        # 의미 유사도

    # 화면 속성·품질 보정
    sk = np.array([f.get("shake") if f.get("shake") is not None else -1.0 for f in F])
    shake_pct = None
    if (sk >= 0).any():
        # 절대 기준으로 비용화한다. 백분위는 못 쓴다 — 프레임의 75%가 흔들림 0이라
        # 순위를 매기면 멀쩡한 것들끼리 0~0.75로 임의로 벌어진다.
        # 실측: 3px 넘으면 선명도가 눈에 띄게 떨어지고 10px에서 65.6→5.9로 붕괴한다.
        v = np.where(sk < 0, 0.0, sk)
        shake_pct = np.minimum(1.0, v / 5.0).astype(np.float32)
    sharp = np.array([f["sharpness"] for f in F])
    sh_pct = sharp.argsort().argsort() / max(len(sharp) - 1, 1)
    bonus = np.zeros_like(sim)
    mom_of = np.array([f["moment"] or "" for f in F])
    for i, s in enumerate(slots):
        b = args.w_sharp * sh_pct
        if s.get("moment"):
            # 상황 범주가 맞는 프레임에 큰 가산점.
            # 예식장이 달라도 '축가'는 '축가'처럼 생겼다 — 전이되는 유일한 축이다.
            b = b + args.w_moment * (mom_of == s["moment"]).astype(np.float32)
        if s["shot_size"]:
            gaps = np.array([
                abs(SIZE_ORDER.index(f["shot_size"]) - SIZE_ORDER.index(s["shot_size"]))
                if f["shot_size"] in SIZE_ORDER else 3 for f in F], np.float32)
            b = b + args.w_size * np.maximum(0, 1 - gaps / 2)
        if s["people_count"]:
            pc = np.array([abs((f["people_count"] or 0) - s["people_count"])
                           for f in F], np.float32)
            b = b + args.w_people * np.maximum(0, 1 - pc / 3)
        if args.w_pos > 0:
            # 상대 진행률 사전확률: 슬롯 i/M 은 촬영본의 대략 i/M 지점에서 온다.
            # 절대 시각(당일 몇 분)은 예식마다 달라 실패했지만, 상대 위치는 전이된다.
            # 하이라이트가 촬영 순서를 따르기 때문(스피어만 +0.94/+0.88).
            rel = np.abs(np.arange(len(F)) / max(len(F) - 1, 1)
                         - i / max(len(slots) - 1, 1))
            b = b - args.w_pos * rel
        if args.w_shake > 0 and shake_pct is not None:
            b = b - args.w_shake * shake_pct
        bonus[i] = b
    score = sim + bonus

    # ── 단조 DP (같은 클립 재사용에 벌점) ──────────────
    # 슬롯 순서대로 채우되 원본에서도 시간이 되돌아가지 않게 강제한다.
    #
    # 반복 문제: 벌점이 없으면 연속 슬롯이 한 클립의 0s,2s,3s,5s처럼 붙어
    # 화면상 같은 컷이 네 번 반복된다(실제로 발생했다).
    # 앞서 '무조건 다른 클립' 하드 제약도 시험했으나 지표가 80.2%→68.6%로 떨어졌다.
    # 그래서 금지가 아니라 벌점으로 두고, 필요하면 같은 클립도 쓰되 대가를 치르게 한다.
    Ms, N = score.shape
    NEG = -1e9
    clip_arr = [f["clip"] for f in F]
    start_of = np.zeros(N, np.int32)
    s0 = 0
    for j in range(1, N):
        if clip_arr[j] != clip_arr[j - 1]:
            s0 = j
        start_of[j] = s0

    dp = score[0].copy()
    back = np.zeros((Ms, N), np.int32)
    for i in range(1, Ms):
        pre_max = np.full(N + 1, NEG, np.float32)   # pre_max[k] = max(dp[:k])
        pre_arg = np.zeros(N + 1, np.int32)
        for j in range(N):
            if dp[j] > pre_max[j]:
                pre_max[j + 1], pre_arg[j + 1] = dp[j], j
            else:
                pre_max[j + 1], pre_arg[j + 1] = pre_max[j], pre_arg[j]
        # (a) 다른 클립에서 오기 — 벌점 없음
        outv = pre_max[start_of]
        outa = pre_arg[start_of]
        # (b) 같은 클립 안에서 오기 — 슬롯 길이만큼 전진했을 때만 허용
        # 문제였던 사례: 슬롯 1~4가 한 클립의 0·2·3·5초에서 왔다.
        # 타임라인은 3·2·2초 흐르는데 소재는 2·1·2초만 전진해 거의 제자리를 반복했다.
        # 완전 금지는 과했다(지표가 70.5%→50.8%로 붕괴). 이어보기는 허용하되
        # 되감기처럼 보이는 것만 막는다 = 최소 전진량을 슬롯 길이로 둔다.
        adv = max(1, int(round(float(slots[i - 1].get("duration", 1)))))
        run = np.full(N, NEG, np.float32)
        arg = np.zeros(N, np.int32)
        for j in range(N):
            src = j - adv
            ok = src >= 0 and start_of[src] == start_of[j]
            run[j], arg[j] = (dp[src], src) if ok else (NEG, 0)
        inv = run - args.repeat_penalty
        use_in = inv > outv
        dp = np.where(use_in, inv, outv) + score[i]
        back[i] = np.where(use_in, arg, outa)
    path = np.zeros(Ms, np.int32)
    path[-1] = int(dp.argmax())
    for i in range(Ms - 1, 0, -1):
        path[i - 1] = back[i][path[i]]

    plan = []
    for i, s in enumerate(slots):
        j = int(path[i])
        f = F[j]
        sc = float(score[i, j])
        plan.append({
            "slot": s["slot"], "hl_start": s["hl_start"],
            "duration": s["duration"], "shot_size": s["shot_size"],
            "filled": bool(sc >= args.min_score),
            "score": round(sc, 3), "sim": round(float(sim[i, j]), 3),
            "pick_clip": f["clip"], "pick_path": f["path"], "pick_t": f["t"],
            "gt_clip": s.get("src_clip"), "gt_t": s.get("src_t"),
        })
    n = sum(p["filled"] for p in plan)
    json.dump({"template": args.template, "target": args.project, "plan": plan},
              open(args.out, "w"), ensure_ascii=False, indent=1)
    print(f"슬롯 {len(plan)}개 중 {n}개 채움 ({n/len(plan)*100:.1f}%) → {args.out}")


# ─── eval ────────────────────────────────────────────────

def cmd_eval(args):
    d = json.load(open(args.plan))
    plan = [p for p in d["plan"] if p["filled"]]
    target = d["target"]
    tpl_proj = json.load(open(d["template"]))["source_project"]
    conn = sqlite3.connect(DB)

    gtf = os.path.join(BASE, f"match_{target}.json")
    gt_clips = {x["src_clip"] for x in json.load(open(gtf)) if x["matched"]}
    pool = {os.path.basename(p) for (p,) in conn.execute(
        "SELECT path FROM sources WHERE project=? AND role='raw'", (target,))
        if any(h in p for h in HANDHELD_HINTS)}
    picks = [p["pick_clip"] for p in plan]
    uniq = set(picks)
    hit = uniq & gt_clips
    base = len(gt_clips) / len(pool) * 100

    same = tpl_proj == target
    print(f"=== {tpl_proj} 템플릿 → {target} 원본 "
          f"({'자기적용' if same else '교차'}) ===")
    print(f"  채운 슬롯 {len(plan)}개, 서로 다른 클립 {len(uniq)}개")
    print(f"  후보 {len(pool)}개 중 편집자 실사용 {len(gt_clips)}개 (기저 {base:.1f}%)")
    print(f"  정밀도 {len(hit)}/{len(uniq)} = {len(hit)/len(uniq)*100:.1f}%  "
          f"(기저 대비 {len(hit)/len(uniq)*100/base:.2f}배)")
    print(f"  재현율 {len(hit)}/{len(gt_clips)} = {len(hit)/len(gt_clips)*100:.1f}%")
    if same:
        ex = sum(p["pick_clip"] == p["gt_clip"] for p in plan)
        print(f"  슬롯별 정답 클립 일치 {ex}/{len(plan)} = {ex/len(plan)*100:.1f}%")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build"); b.add_argument("project")
    b.add_argument("--profile", action="store_true", default=True, help="의미 지문 사용")
    b.add_argument("--temp", type=float, default=0.04)
    b.add_argument("--match"); b.add_argument("-o", "--out", default="tpl.json")
    b.set_defaults(func=cmd_build)
    a = sub.add_parser("apply"); a.add_argument("template"); a.add_argument("project")
    a.add_argument("-o", "--out", default="plan.json")
    a.add_argument("--profile", action="store_true", default=True, help="의미 지문 사용")
    a.add_argument("--temp", type=float, default=0.04)
    a.add_argument("--smooth", type=int, default=0, help="클립 내 ±N초 지문 평활")
    a.add_argument("--usability", type=float, default=0.0,
                   help="사용성 하위 q 비율을 후보에서 제외 (0=끄기)")
    a.add_argument("--min-score", type=float, default=-1e9)
    a.add_argument("--w-moment", type=float, default=0.08)
    a.add_argument("--w-pos", type=float, default=0.0)
    a.add_argument("--w-size", type=float, default=0.10)
    a.add_argument("--w-people", type=float, default=0.05)
    a.add_argument("--w-sharp", type=float, default=0.0)
    a.add_argument("--repeat-penalty", type=float, default=0.0,
                   help="같은 클립에서 연속으로 가져올 때의 벌점")
    a.add_argument("--w-shake", type=float, default=0.3,
                   help="흔들림 벌점 가중치")
    a.set_defaults(func=cmd_apply)
    e = sub.add_parser("eval"); e.add_argument("plan"); e.set_defaults(func=cmd_eval)
    args = ap.parse_args()
    if args.cmd == "build" and not args.match:
        args.match = os.path.join(BASE, f"match_{args.project}.json")
    args.func(args)


if __name__ == "__main__":
    main()
