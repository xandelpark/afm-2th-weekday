#!/usr/bin/env python3
"""
흔들림 수치화 — '보는 데 방해되는 정도'를 재서 DB에 넣는다.

무엇을 재는가
    단순 움직임 크기가 아니다. 부드러운 팬·틸트는 의도된 연출이라 방해가 안 되고,
    고주파로 덜덜 떨리는 성분만 눈에 거슬린다. 그래서
      1) 위상상관으로 프레임 간 전역 이동(dx, dy)을 구하고
      2) 이동 신호에서 저주파(=의도된 움직임)를 빼고
      3) 남은 고주파 잔차의 크기를 흔들림 점수로 쓴다.

    1fps 썸네일로는 고주파를 볼 수 없어(나이퀴스트) 원본을 10fps로 다시 읽는다.
    다만 160×90 그레이스케일이라 클립당 1초도 안 걸린다.

사용:
    .venv/bin/python shake.py 260425_홍주영 --save
"""
import argparse
import os
import sqlite3
import subprocess

import numpy as np

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "features.db")

FPS = 10          # 흔들림을 보려면 이 정도는 필요하다
W, H = 160, 90
SMOOTH = 5        # 저주파(의도된 움직임) 추정용 이동평균 창 — 0.5초


def read_gray(path):
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-i", path,
           "-vf", f"fps={FPS},scale={W}:{H},format=gray",
           "-f", "rawvideo", "-"]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        return None
    buf = np.frombuffer(r.stdout, np.uint8)
    n = len(buf) // (W * H)
    if n < 3:
        return None
    return buf[: n * W * H].reshape(n, H, W).astype(np.float32)


def global_shift(a, b):
    """위상상관으로 두 프레임 사이 전역 이동량 (dx, dy)."""
    fa, fb = np.fft.rfft2(a), np.fft.rfft2(b)
    R = fa * np.conj(fb)
    R /= np.abs(R) + 1e-8
    r = np.fft.irfft2(R, s=a.shape)
    j = np.unravel_index(np.argmax(r), r.shape)
    dy, dx = j[0], j[1]
    if dy > H // 2:
        dy -= H
    if dx > W // 2:
        dx -= W
    return float(dx), float(dy)


def shake_series(frames):
    """프레임별 흔들림(고주파 잔차 크기). 길이는 frames와 같다."""
    n = len(frames)
    d = np.zeros((n, 2), np.float32)
    for i in range(1, n):
        d[i] = global_shift(frames[i - 1], frames[i])
    # 저주파 = 의도된 팬/틸트. 이동평균으로 추정해 뺀다.
    k = np.ones(SMOOTH, np.float32) / SMOOTH
    low = np.stack([np.convolve(d[:, c], k, mode="same") for c in range(2)], 1)
    hi = d - low
    return np.linalg.norm(hi, axis=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project")
    ap.add_argument("--save", action="store_true")
    ap.add_argument("--db", default=DB)
    ap.add_argument("--handheld-only", action="store_true", default=True)
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    rows = conn.execute(
        "SELECT id, path FROM sources WHERE project=? AND role='raw'",
        (args.project,)).fetchall()
    if args.handheld_only:
        rows = [r for r in rows if any(h in r[1] for h in ("스냅캠", "메인캠"))]
    print(f"대상 클립 {len(rows)}개")

    if args.save:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(frames)")}
        if "shake" not in cols:
            conn.execute("ALTER TABLE frames ADD COLUMN shake REAL")

    allv, upd = [], []
    for n, (sid, path) in enumerate(rows, 1):
        f = read_gray(path)
        if f is None:
            continue
        s = shake_series(f)
        # 1fps 썸네일에 맞춰 초 단위로 집약 (그 1초 구간의 90퍼센타일)
        for t, in conn.execute(
                "SELECT t FROM frames WHERE source_id=? ORDER BY t", (sid,)):
            lo, hi = int(t * FPS), int((t + 1) * FPS)
            seg = s[lo:hi]
            v = float(np.percentile(seg, 90)) if len(seg) else 0.0
            allv.append(v)
            upd.append((v, sid, t))
        if n % 25 == 0:
            print(f"  …{n}/{len(rows)}", flush=True)

    a = np.array(allv)
    print(f"\n흔들림 분포 (n={len(a):,})")
    for p in [10, 25, 50, 75, 90, 95, 99]:
        print(f"  p{p:<3} {np.percentile(a, p):6.2f}px")
    print(f"  최대 {a.max():.2f}px")

    if args.save:
        conn.executemany(
            "UPDATE frames SET shake=? WHERE source_id=? AND t=?", upd)
        conn.commit()
        print(f"\n저장 완료 — {len(upd):,}개 프레임")


if __name__ == "__main__":
    main()
