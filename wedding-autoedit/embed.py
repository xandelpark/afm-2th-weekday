#!/usr/bin/env python3
"""
CLIP 의미 임베딩 — 모든 썸네일을 '무슨 상황인지' 벡터로 바꿔 DB 옆에 저장한다.

왜 필요한가
    시간 축(촬영 당일 진행률)으로 슬롯을 채우니 교차 검증에서 기저 대비 1.2배에 그쳤다.
    예식마다 일정이 다르고, 카메라를 껐다 켰다 하므로 시계로는 같은 상황을 못 찾는다.
    "신부 입장 와이드"는 예식장이 달라도 비슷하게 생겼다 — 그걸 잡으려면 의미 임베딩이 필요하다.

    참고: ③ 역매칭에 쓴 그레이스케일 상관은 '같은 촬영본'을 찾는 데는 88~97%로 훌륭하지만
    다른 예식의 비슷한 장면을 찾는 데는 전혀 쓸 수 없다. 용도가 다르다.

사용:
    .venv/bin/python embed.py            # 전체 임베딩 (캐시 있으면 건너뜀)
    .venv/bin/python embed.py --force
"""
import argparse
import os
import sqlite3

import numpy as np
import torch
from PIL import Image

import open_clip

BASE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(BASE, "store")
DB = os.path.join(BASE, "features.db")
OUT = os.path.join(BASE, "clip_embeds.npz")

MODEL, PRETRAINED = "ViT-B-32", "laion2b_s34b_b79k"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--db", default=DB)
    ap.add_argument("--store", default=STORE)
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    rows = conn.execute("SELECT id, thumb FROM frames ORDER BY id").fetchall()
    print(f"대상 프레임 {len(rows):,}장")

    if os.path.exists(args.out) and not args.force:
        z = np.load(args.out)
        if len(z["ids"]) == len(rows):
            print("이미 완료됨 (--force로 재생성)")
            return

    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    model, _, preprocess = open_clip.create_model_and_transforms(
        MODEL, pretrained=PRETRAINED)
    model = model.eval().to(dev)
    print(f"모델 {MODEL}/{PRETRAINED} on {dev}")

    ids, vecs, buf, bids = [], [], [], []

    def flush():
        if not buf:
            return
        with torch.no_grad():
            x = torch.stack(buf).to(dev)
            v = model.encode_image(x)
            v = v / v.norm(dim=-1, keepdim=True)
        vecs.append(v.cpu().numpy().astype(np.float16))
        ids.extend(bids)
        buf.clear()
        bids.clear()

    for n, (fid, thumb) in enumerate(rows):
        p = os.path.join(args.store, thumb)
        try:
            with Image.open(p) as im:
                buf.append(preprocess(im.convert("RGB")))
            bids.append(fid)
        except Exception:
            pass
        if len(buf) >= args.batch:
            flush()
        if n % 2000 == 0 and n:
            print(f"  …{n:,}/{len(rows):,}", flush=True)
    flush()

    M = np.concatenate(vecs) if vecs else np.zeros((0, 512), np.float16)
    np.savez_compressed(args.out, ids=np.array(ids, dtype=np.int64), mat=M)
    print(f"완료 — {M.shape[0]:,}장 × {M.shape[1]}차원 → {args.out}")


if __name__ == "__main__":
    main()
