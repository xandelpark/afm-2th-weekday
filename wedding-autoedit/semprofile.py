#!/usr/bin/env python3
"""
의미 지문(semantic profile) — 이미지 임베딩을 텍스트 프롬프트 공간에 투영한다.

왜
    CLIP 이미지 임베딩을 그대로 비교하면 자기 촬영본에선 75%가 나오지만
    다른 예식으로는 기저 대비 1.2~1.3배에 그친다. 임베딩이 '무슨 장면인가'뿐 아니라
    '이 예식장의 조명·벽지·인물'까지 담기 때문이다.

    프롬프트 N개에 대한 유사도 분포로 바꾸면 예식장 고유 색채가 대부분 제거되고
    의미만 남는다. 좌표계를 이미지 공간에서 언어 공간으로 옮기는 것이다.

    또한 범주 하나로 딱 자르지 않고 분포를 쓰므로,
    '신부 얼굴 클로즈업이면서 약간 눈물'같은 중간 상태도 표현된다.
"""
import os

import numpy as np
import torch

import open_clip

BASE = os.path.dirname(os.path.abspath(__file__))
BANK = os.path.join(BASE, "text_bank.npz")
MODEL, PRETRAINED = "ViT-B-32", "laion2b_s34b_b79k"

# 본식스냅에 실제로 나오는 것들을 넓게 깐다. 많을수록 지문이 세밀해진다.
PROMPTS = [
    # 인물 · 프레이밍
    "a close-up of a bride's face",
    "a close-up of a groom's face",
    "a close-up of a smiling face",
    "a close-up of a crying or emotional face",
    "a bride and groom facing each other",
    "a bride and groom holding hands",
    "a couple kissing at a wedding",
    "a bride alone in a white dress",
    "a groom alone in a dark suit",
    "two people standing side by side at an altar",
    # 신체 · 디테일
    "a close-up of hands exchanging wedding rings",
    "a close-up of hands holding each other",
    "a close-up of a bridal bouquet of flowers",
    "a close-up of a wedding dress train and shoes",
    "a close-up of a veil",
    "a detail shot of a wedding invitation or name card",
    "a close-up of candles",
    # 동작 · 상황
    "a person walking down a wedding aisle",
    "a father walking his daughter down the aisle",
    "a couple bowing to their parents",
    "an officiant giving a speech at a wedding",
    "a person reading wedding vows from paper",
    "a singer performing with a microphone",
    "people clapping and applauding",
    "guests throwing petals or confetti",
    "a couple walking out of the ceremony hall together",
    "people taking photos with smartphones",
    "a group of family posing for a formal photograph",
    "people bowing formally in traditional korean dress",
    "a couple cutting a wedding cake",
    # 사람 무리
    "a large crowd of seated wedding guests",
    "a few guests sitting in chairs",
    "elderly people in traditional korean hanbok",
    "a mother in hanbok wiping tears",
    "children at a wedding",
    "a bridesmaid or friend group",
    # 공간 · 배경
    "an empty elegant wedding hall with chairs",
    "a wide view of a wedding ceremony from the back",
    "a bright white bridal waiting room",
    "a stage decorated with white flowers",
    "a chandelier hanging from a ceiling",
    "a long aisle with flower arrangements on both sides",
    "a dark ceremony hall with spotlights",
    "an outdoor garden wedding setting",
    "a hotel banquet hall with round tables",
    "a photo booth or reception entrance sign",
    # 조명 · 분위기
    "a dimly lit romantic scene with warm lights",
    "a brightly lit white and clean scene",
    "a backlit silhouette of people",
    "a scene with strong window daylight",
    # 카메라 · 화면
    "an extreme close-up of a small detail",
    "a very wide establishing shot of a room",
    "a blurry out of focus frame",
    "a black or nearly empty frame",
    "a shot looking down from above",
    "a shot taken from behind a person's shoulder",
    # 소품
    "flower decorations without people",
    "a microphone stand on a stage",
    "a red carpet or white runway floor",
    "a table with a guest book and pen",
]


def text_bank(device="cpu"):
    """프롬프트 임베딩 행렬. 한 번 만들면 캐시한다."""
    if os.path.exists(BANK):
        z = np.load(BANK)
        if len(z["prompts"]) == len(PROMPTS):
            return z["mat"].astype(np.float32)
    model, _, _ = open_clip.create_model_and_transforms(MODEL, pretrained=PRETRAINED)
    model = model.eval().to(device)
    tok = open_clip.get_tokenizer(MODEL)
    with torch.no_grad():
        t = tok(PROMPTS).to(device)
        v = model.encode_text(t)
        v = v / v.norm(dim=-1, keepdim=True)
    M = v.cpu().numpy().astype(np.float32)
    np.savez_compressed(BANK, prompts=np.array(PROMPTS), mat=M)
    return M


def profiles(img_emb, T=None, temp=0.04):
    """이미지 임베딩 → 의미 지문 (프롬프트 확률분포, L2 정규화).

    temp를 낮추면 뾰족해지고(범주 분류에 가까움) 높이면 부드러워진다.
    분포로 두는 이유는 '어느 하나'로 자르면 중간 상태를 잃기 때문이다.
    """
    if T is None:
        T = text_bank()
    S = img_emb @ T.T / temp
    S -= S.max(axis=1, keepdims=True)
    P = np.exp(S)
    P /= P.sum(axis=1, keepdims=True)
    P /= np.linalg.norm(P, axis=1, keepdims=True) + 1e-8
    return P.astype(np.float32)
