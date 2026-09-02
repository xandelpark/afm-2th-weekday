#!/usr/bin/env python3
"""
상황 분류 — 프레임마다 '예식의 어느 장면인지'를 CLIP 제로샷으로 붙인다.

왜 이게 필요한가
    임베딩끼리 직접 최근접 매칭하면 자기 촬영본에서는 75%가 나오지만(사실상 같은 프레임 찾기)
    다른 예식으로는 기저 대비 1.3배에 그친다. 예식장·조명·인물이 다르면 임베딩이 멀어진다.
    "신부 입장"이라는 **범주**로 올려야 예식을 건너 전이된다.

사용:
    .venv/bin/python moments.py --report      # 분류 결과 분포 확인
    .venv/bin/python moments.py --save        # DB에 moment 컬럼으로 저장
"""
import argparse
import os
import sqlite3

import numpy as np
import torch

import open_clip

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "features.db")
EMB = os.path.join(BASE, "clip_embeds.npz")
MODEL, PRETRAINED = "ViT-B-32", "laion2b_s34b_b79k"

# 한국 예식 본식스냅의 장면 범주.
# 프롬프트는 영어로 쓴다 — CLIP이 영어에 훨씬 강하다.
MOMENTS = {
    "신부대기실": [
        "a bride sitting in a bright white bridal waiting room",
        "a bride in a white wedding dress posing indoors before the ceremony",
    ],
    "입장": [
        "a bride walking down the aisle at a wedding ceremony",
        "a person walking down a wedding aisle between guests",
    ],
    "예식단상": [
        "a bride and groom standing together at the wedding altar",
        "an officiant speaking to a couple at a wedding ceremony",
    ],
    "축가": [
        "a singer performing on stage at a wedding",
        "a person singing with a microphone at a wedding reception",
    ],
    "하객": [
        "wedding guests sitting and watching the ceremony",
        "a crowd of seated guests applauding at a wedding",
    ],
    "부모님": [
        "elderly korean parents in traditional hanbok at a wedding",
        "a mother and father of the bride watching emotionally",
    ],
    "행진": [
        "a newlywed couple walking out together after the ceremony",
        "a bride and groom recessional walking with guests clapping",
    ],
    "단체사진": [
        "a large group photo of family at a wedding",
        "many people posing together for a photograph at a wedding",
    ],
    "인서트": [
        "a close-up of wedding rings or a bouquet of flowers",
        "decorative flowers and candles at a wedding venue, no people",
    ],
    "홀전경": [
        "a wide view of an empty elegant wedding hall",
        "a wide establishing shot of a wedding venue interior",
    ],
}


def build_text_bank(device):
    model, _, _ = open_clip.create_model_and_transforms(MODEL, pretrained=PRETRAINED)
    model = model.eval().to(device)
    tok = open_clip.get_tokenizer(MODEL)
    names, vecs = [], []
    with torch.no_grad():
        for name, prompts in MOMENTS.items():
            t = tok(prompts).to(device)
            v = model.encode_text(t)
            v = v / v.norm(dim=-1, keepdim=True)
            v = v.mean(0)
            v = v / v.norm()
            names.append(name)
            vecs.append(v.cpu().numpy())
    return names, np.stack(vecs).astype(np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--save", action="store_true")
    ap.add_argument("--db", default=DB)
    ap.add_argument("--emb", default=EMB)
    args = ap.parse_args()

    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    names, T = build_text_bank(dev)

    z = np.load(args.emb)
    ids, M = z["ids"], z["mat"].astype(np.float32)
    S = M @ T.T                      # 프레임 × 범주
    lab = S.argmax(1)
    conf = S.max(1)

    conn = sqlite3.connect(args.db)
    if args.save:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(frames)")}
        if "moment" not in cols:
            conn.execute("ALTER TABLE frames ADD COLUMN moment TEXT")
            conn.execute("ALTER TABLE frames ADD COLUMN moment_conf REAL")
        conn.executemany("UPDATE frames SET moment=?, moment_conf=? WHERE id=?",
                         [(names[l], float(c), int(i))
                          for i, l, c in zip(ids, lab, conf)])
        conn.commit()
        print(f"저장 완료 — {len(ids):,}장")

    if args.report or not args.save:
        print(f"{'범주':<12}{'프레임':>8}{'비율':>8}{'평균확신':>10}")
        print("-" * 40)
        for k, n in enumerate(names):
            sel = lab == k
            if sel.sum():
                print(f"{n:<12}{sel.sum():>8,}{sel.mean()*100:>7.1f}%"
                      f"{conf[sel].mean():>10.3f}")


if __name__ == "__main__":
    main()
