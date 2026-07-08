# -*- coding: utf-8 -*-
"""
데일리테니스(@hi.dailytennis) 브랜드 배색 랜덤 생성기.

목적: 캐러셀/릴스마다 배색을 '랜덤'으로 뽑되, 피드에서 튀지 않게
     **같은 계열(뮤트 플럼/라벤더 + 크림 + 골드)** 안에 가둬서 생성한다.

배경(2026-07-01 슬기 피드 픽셀 샘플):
  · 정상(부드러운) 플럼 배경 : H≈266~276°, S≈24~28%, L≈29~36%
  · 튀는 '브랜드별 파워라켓' 커버 : H=263°, S=27%, L=18.8%  ← 너무 어둡/채도 튐
  → 핵심 규칙: 메인 플럼 배경의 L(명도)을 ~29% 아래로 내리지 말 것.
    전면(full-bleed) 배경에 near-black 딥플럼(#2E1F3D 계열) 단독 사용 금지.

사용:
  python3 brand_palette.py               # 랜덤 :root CSS 블록 출력
  python3 brand_palette.py --seed 7      # 재현 가능한 팔레트
  python3 brand_palette.py --json        # JSON(dict)로 출력
  python3 brand_palette.py --swatch out.png [--n 4]   # 미리보기 스와치 PNG

코드에서:
  from brand_palette import random_palette, css_root
  pal = random_palette(seed=None)      # dict
  css = css_root(pal)                  # <style>에 그대로 붙일 :root{...}
"""
import colorsys
import json
import random
import sys


def _hex(h, s, l):
    """HLS(0~1) → #RRGGBB"""
    r, g, b = colorsys.hls_to_rgb(h / 360.0, l, s)
    return "#{:02X}{:02X}{:02X}".format(round(r * 255), round(g * 255), round(b * 255))


def random_palette(seed=None):
    """같은 계열(뮤트 플럼) 안에서 랜덤한 브랜드 팔레트 1세트를 만든다."""
    rng = random.Random(seed)

    # ── 메인 플럼(커버/플럼 슬라이드 배경의 기준색) ─────────────────
    # 피드 정상범위 안: H 266~276 / S 24~30% / L 30~37% (L 하한이 '튐' 방지의 핵심)
    H = rng.uniform(266, 276)
    S = rng.uniform(0.24, 0.30)
    L = rng.uniform(0.30, 0.37)

    plum = _hex(H, S, L)
    # 커버 라디얼 그라디언트용: 위(밝은 리프트) → 기준 → 아래(딥). 딥도 L 0.17 이상 유지.
    plum_lift = _hex(H, min(S * 0.96, 0.34), min(L + rng.uniform(0.05, 0.09), 0.46))
    plum_deep = _hex(H - rng.uniform(0, 3), min(S + 0.03, 0.34), max(L * 0.58, 0.17))

    # ── 미드 액센트(액센트 슬라이드 배경 = 시그니처 소프트 퍼플 #5A3978 계열) ──
    purple = _hex(H - rng.uniform(0, 2), S + rng.uniform(0.06, 0.10), L + rng.uniform(0.02, 0.05))

    # ── 라벤더(플럼 위 밝은 텍스트/틴트) ──────────────────────────
    lav = _hex(H + rng.uniform(2, 8), rng.uniform(0.22, 0.30), rng.uniform(0.92, 0.94))

    # ── 골드(포인트) : 따뜻한 골드 좁은 범위 ──────────────────────
    gh = rng.uniform(37, 43)
    gs = rng.uniform(0.48, 0.60)
    gl = rng.uniform(0.58, 0.65)
    gold = _hex(gh, gs, gl)
    gold_dim = _hex(gh, gs * 0.9, gl - 0.12)

    # ── 페이퍼/본/크림(따뜻한 크림 - 계열 앵커, 거의 고정 + 미세 랜덤) ──
    paper = _hex(rng.uniform(40, 44), rng.uniform(0.36, 0.44), rng.uniform(0.90, 0.93))
    bone = _hex(rng.uniform(38, 43), rng.uniform(0.28, 0.36), rng.uniform(0.84, 0.87))

    # ── 잉크/차콜(따뜻한 near-black 텍스트/다크 슬라이드) ──────────
    ink = _hex(rng.uniform(28, 38), rng.uniform(0.16, 0.24), rng.uniform(0.10, 0.13))
    charcoal = _hex(rng.uniform(28, 40), rng.uniform(0.12, 0.18), rng.uniform(0.08, 0.11))

    return {
        "seed": seed,
        "plum": plum,            # 메인 플럼(기준)
        "plum_lift": plum_lift,  # 커버 그라디언트 밝은 쪽
        "plum_deep": plum_deep,  # 커버 그라디언트 어두운 쪽(L≥0.17)
        "purple": purple,        # 미드 액센트 배경(시그니처 소프트 퍼플)
        "lav": lav,              # 플럼 위 밝은 텍스트
        "gold": gold,            # 포인트 골드
        "gold_dim": gold_dim,
        "paper": paper,          # 크림 페이퍼(밝은 슬라이드 배경)
        "bone": bone,
        "cream": paper,          # 별칭
        "ink": ink,              # 페이퍼 위 다크 텍스트
        "charcoal": charcoal,    # 다크 슬라이드 배경
        "line": "rgba(245,238,224,.20)",
    }


def css_root(pal):
    """:root{...} 블록 + 자주 쓰는 배경 유틸 클래스 문자열."""
    return (
        ":root{{\n"
        "  --plum:{plum}; --plum-lift:{plum_lift}; --plum-deep:{plum_deep};\n"
        "  --purple:{purple}; --lav:{lav};\n"
        "  --gold:{gold}; --gold-dim:{gold_dim};\n"
        "  --paper:{paper}; --bone:{bone}; --cream:{cream};\n"
        "  --ink:{ink}; --charcoal:{charcoal}; --line:{line};\n"
        "}}\n"
        "/* 커버/플럼 전면 배경: near-black 단독 금지 → 소프트 플럼 그라디언트 */\n"
        ".bg-plum{{background:radial-gradient(120% 90% at 50% -8%,"
        "var(--plum-lift) 0%,var(--plum) 48%,var(--plum-deep) 100%);color:var(--lav);}}\n"
        ".bg-accent{{background:var(--purple);color:var(--lav);}}\n"
        ".bg-paper{{background:var(--paper);color:var(--ink);}}\n"
        ".bg-bone{{background:var(--bone);color:var(--ink);}}\n"
    ).format(**pal)


def _swatch(paths_n, out):
    """랜덤 팔레트 n세트를 PNG 스와치로 렌더(육안 검증용)."""
    from PIL import Image, ImageDraw
    n = paths_n
    cellw, rowh, pad = 1080, 150, 0
    keys = ["plum", "plum_lift", "plum_deep", "purple", "lav", "gold", "paper", "bone", "ink"]
    img = Image.new("RGB", (cellw, rowh * n), "#111")
    d = ImageDraw.Draw(img)
    for i in range(n):
        pal = random_palette(seed=i * 13 + 3)
        x = 0
        w = cellw // len(keys)
        for k in keys:
            d.rectangle([x, i * rowh, x + w, i * rowh + rowh], fill=pal[k])
            d.text((x + 8, i * rowh + 8), k, fill="#00000088")
            d.text((x + 8, i * rowh + 22), pal[k], fill="#00000088")
            x += w
    img.save(out)
    print("swatch ->", out)


if __name__ == "__main__":
    args = sys.argv[1:]
    seed = None
    if "--seed" in args:
        seed = int(args[args.index("--seed") + 1])
    if "--swatch" in args:
        out = args[args.index("--swatch") + 1]
        n = int(args[args.index("--n") + 1]) if "--n" in args else 4
        _swatch(n, out)
    elif "--json" in args:
        print(json.dumps(random_palette(seed), ensure_ascii=False, indent=2))
    else:
        print(css_root(random_palette(seed)))
