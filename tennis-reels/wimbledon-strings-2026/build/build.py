# -*- coding: utf-8 -*-
"""
데일리테니스(@hi.dailytennis) — 2026 윔블던 남자단식 4강 라켓/스트링 릴스.
매거진 에디토리얼 표준: 크림/본/라벤더/코트퍼플 컬러 사이클, 중앙 흑백(세피아) 포트레이트
+ 골드 1px 테두리, 거대 넘버, 안전영역 285~1635.
6장: ①표지 ②신네르 ③즈베레프 ④조코비치 ⑤페리 ⑥마무리.
"""
import sys, os
sys.path.insert(0, "/Users/craw/afm-2th-weekday/tennis-reels")
sys.path.insert(0, os.path.dirname(__file__))

from PIL import Image, ImageDraw, ImageOps, ImageFilter
from fonts import Di, DiIt, DiBd, Be, Mj, Sd
from face_crop import face_crop
from brand_palette import random_palette

W, H = 1080, 1920
SAFE_TOP, SAFE_BOT = 285, 1635
SEED = 42
PAL = random_palette(seed=SEED)

SRC = os.path.join(os.path.dirname(__file__), "..", "src")
OUT = os.path.join(os.path.dirname(__file__), "..", "frames")
os.makedirs(OUT, exist_ok=True)


# ---------------------------------------------------------------- helpers --
def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def center_text(d, cy, text, font, fill, cx=W // 2, tracking=0):
    if tracking:
        text = (" " * 1).join(list(text)) if tracking == "char" else text
    bbox = d.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = cx - tw / 2 - bbox[0]
    y = cy - th / 2 - bbox[1]
    d.text((x, y), text, font=font, fill=fill)
    return tw, th


def wrap_lines(d, text, font, max_w):
    words = text.split(" ")
    lines, cur = [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if d.textlength(trial, font=font) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def duotone(img, shadow_hex, highlight_hex):
    gray = img.convert("L")
    gray = ImageOps.autocontrast(gray, cutoff=1)
    colorized = ImageOps.colorize(gray, black=shadow_hex, white=highlight_hex)
    return colorized.convert("RGB")


def masthead(d, ink, gold, vol_label="Vol. I"):
    d.text((90, 288), "DAILY TENNIS", font=Be(24), fill=ink)
    handle = "@hi.dailytennis"
    tw = d.textlength(handle, font=DiIt(24))
    d.text((990 - tw, 288), handle, font=DiIt(24), fill=ink)
    d.line([(90, 334), (990, 334)], fill=gold, width=2)


def kicker(d, text, gold, y=372):
    center_text(d, y, text, Be(25), gold)


def photo_frame(base, box, photo_img, gold, shadow_alpha=70):
    """액자형 사진 패널: 소프트 섀도우 + 골드 하이라인 테두리."""
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    # soft shadow
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rectangle([x0 + 10, y0 + 18, x1 + 10, y1 + 18], fill=(20, 14, 10, shadow_alpha))
    shadow = shadow.filter(ImageFilter.GaussianBlur(24))
    base.paste(Image.alpha_composite(base.convert("RGBA"), shadow).convert("RGB"), (0, 0))
    # photo
    ph = photo_img.resize((bw, bh), Image.LANCZOS)
    base.paste(ph, (x0, y0))
    d = ImageDraw.Draw(base)
    d.rectangle([x0, y0, x1 - 1, y1 - 1], outline=gold, width=3)
    # inner hairline
    d.rectangle([x0 + 8, y0 + 8, x1 - 9, y1 - 9], outline=gold, width=1)


def new_canvas(bg_hex):
    return Image.new("RGB", (W, H), hexrgb(bg_hex))


def save(img, name):
    path = os.path.join(OUT, name)
    img.save(path)
    print("saved", path)
    return path


# ------------------------------------------------------------- card data --
GOLD = PAL["gold"]
GOLD_DIM = PAL["gold_dim"]
INK = PAL["ink"]
LAV = PAL["lav"]
PLUM = PAL["plum"]
PAPER = PAL["paper"]
BONE = PAL["bone"]

PLAYERS = [
    dict(
        num="01", src="sinner.jpg",
        kr="얀닉 신네르", en="Jannik Sinner",
        tag="DEFENDING CHAMPION · ITALY",
        racquet="HEAD 스피드 MP 오세틱(페인트) · 실제는 프로스톡 TGT 301.4",
        string="HEAD Hawk Touch 1.30mm · 풀베드(하이브리드 아님)",
        tension="약 28kg(61lbs) — 투어 평균보다 확연히 높음",
        tip="포인트 — 텐션 높여 파워를 컨트롤로 눌러주는 세팅. 그대로 따라하면 팔 부담 커질 수 있음",
        bg="paper",
    ),
    dict(
        num="02", src="zverev.jpg",
        kr="알렉산더 즈베레프", en="Alexander Zverev",
        tag="1995 베커 이후 獨 첫 결승 진출",
        racquet="HEAD 그래비티 프로 (18×20 패턴)",
        string="메인 Hawk Touch 1.25mm@24kg · 크로스 천연거트 1.30mm@25kg",
        tension="23~25kg · 컨디션 따라 ±0.5kg 조정",
        tip="포인트 — 낮은 텐션 하이브리드로 편안함·파워 확보. 동호인도 텐션 낮추면 팔 부담과 파워 두 마리 토끼",
        bg="bone",
    ),
    dict(
        num="03", src="djokovic.jpg",
        kr="노박 조코비치", en="Novak Djokovic",
        tag="4강 탈락 · 24회 그랜드슬램 챔피언",
        racquet="HEAD PT113B 프로스톡(시판 스피드 라인 페인트잡)",
        string="메인 천연거트@27~28kg · 크로스 ALU Power Rough 16L@26~27kg",
        tension="메인이 크로스보다 약 1kg 높게",
        tip="포인트 — 거트+폴리로 부드러움과 스핀感을 동시에. 1kg 차이로 미세조정하는 디테일",
        bg="lav",
    ),
    dict(
        num="04", src="fery.jpg",
        kr="아서 페리", en="Arthur Fery",
        tag="와일드카드 · 英 언더독 돌풍",
        racquet="윌슨 미출시 신형 스핀 라켓('Python') 16×20 프로스톡 추정",
        string="Luxilon ALU Power 계열 추정 — 공식 미확인",
        tension="비공개 — 시판 전 라켓이라 미공개",
        tip="포인트 — 아직 매장에 없는 라켓. 출시되면 스핀형 동호인이 주목할 모델",
        bg="plum",
    ),
]

BG_HEX = {"paper": PAPER, "bone": BONE, "lav": LAV, "plum": PLUM}


# --------------------------------------------------------------- COVER 1 --
def build_cover():
    img = new_canvas(PLUM)
    d = ImageDraw.Draw(img)
    ink, gold = LAV, GOLD

    masthead(d, ink, gold)
    kicker(d, "—  WIMBLEDON 2026 · MEN'S SEMIFINALS  —", gold)

    center_text(d, 470, "String Report.", DiIt(58), gold)

    hook1 = "이 스펙 모르고"
    hook2 = "4강전 보면 손해"
    center_text(d, 600, hook1, Sd(78, "semibold"), ink)
    center_text(d, 690, hook2, Sd(78, "semibold"), ink)

    d.line([(440, 760), (640, 760)], fill=gold, width=2)

    sub = "남자단식 4강 4인의 라켓 · 스트링 완전분석"
    center_text(d, 810, sub, Mj(32), ink)

    # 4-player index list
    rows_y = [960, 1090, 1220, 1350]
    names = [("01", "얀닉 신네르", "Jannik Sinner"),
             ("02", "알렉산더 즈베레프", "Alexander Zverev"),
             ("03", "노박 조코비치", "Novak Djokovic"),
             ("04", "아서 페리", "Arthur Fery")]
    for y, (n, kr, en) in zip(rows_y, names):
        d.line([(150, y - 45), (930, y - 45)], fill=GOLD_DIM, width=1)
        d.text((150, y - 20), n, font=DiBd(44), fill=gold)
        d.text((260, y - 14), kr, font=Mj(38), fill=ink)
        tw = d.textlength(en, font=DiIt(28))
        d.text((930 - tw, y - 8), en, font=DiIt(28), fill=GOLD_DIM)
    d.line([(150, rows_y[-1] + 45), (930, rows_y[-1] + 45)], fill=GOLD_DIM, width=1)

    center_text(d, 1560, "라켓 · 스트링 · 텐션 · 게이지까지", Mj(30), ink)
    center_text(d, 1605, "— EPISODE 01–04 —", Be(24), gold)

    save(img, "01_cover.png")


# ------------------------------------------------------------ PLAYER n --
def build_player(p, idx):
    bg_hex = BG_HEX[p["bg"]]
    dark_bg = p["bg"] == "plum"
    ink = LAV if dark_bg else INK
    gold = GOLD
    sub_ink = GOLD_DIM if dark_bg else GOLD_DIM

    img = new_canvas(bg_hex)
    d = ImageDraw.Draw(img)

    masthead(d, ink, gold)
    kicker(d, "—  WIMBLEDON 2026 · SEMIFINALS  —", gold)

    # number + tag row
    d.text((110, 395), p["num"], font=DiBd(130), fill=gold)
    tagx = 320
    d.text((tagx, 425), "SEMIFINALIST", font=Be(24), fill=sub_ink)
    for i, line in enumerate(wrap_lines(d, p["tag"], Mj(26), 640)):
        d.text((tagx, 462 + i * 34), line, font=Mj(26), fill=ink)

    # portrait (컴팩트하게 줄여 스펙 블록에 세로 여유 확보)
    box = (290, 560, 790, 1060)
    shadow_hex, hi_hex = ((PAL["plum_deep"], LAV) if dark_bg else ("#3A2E22", PAPER))
    photo_path = os.path.join(SRC, p["src"])
    face_img, detected, cropbox = face_crop(photo_path, box[2] - box[0], box[3] - box[1])
    print(f"  [{p['en']}] face detected={detected} box={cropbox}")
    toned = duotone(face_img, shadow_hex, hi_hex)
    photo_frame(img, box, toned, gold)
    d = ImageDraw.Draw(img)  # redraw handle after paste

    # name block
    center_text(d, 1108, p["kr"], Sd(52, "semibold"), ink)
    center_text(d, 1160, p["en"], DiIt(28), gold)

    # spec block (라벨은 자기 줄, 값은 그 아래 인덴트 — 겹침 방지 위해 커서 하나로 순차 진행)
    LX, VX = 150, 150
    LINE_H = 33
    y = 1210
    label_font = Sd(25, "semibold")
    val_font = Mj(25)

    def draw_block(label, val, y):
        d.text((LX, y), label, font=label_font, fill=gold)
        y += LINE_H
        for line in wrap_lines(d, val, val_font, 780):
            d.text((VX, y), line, font=val_font, fill=ink)
            y += LINE_H
        return y + 8

    specs = [("라켓", p["racquet"]), ("스트링", p["string"]), ("텐션 · 게이지", p["tension"])]
    for label, val in specs:
        y = draw_block(label, val, y)

    y += 4
    d.line([(LX, y), (930, y)], fill=GOLD_DIM, width=1)
    y += 20
    for line in wrap_lines(d, p["tip"], Mj(23), 780):
        d.text((VX, y), line, font=Mj(23), fill=sub_ink)
        y += 30

    print(f"  [{p['en']}] spec block bottom y={y} (safe<=1635)")
    save(img, f"{idx:02d}_{p['src'].split('.')[0]}.png")


# --------------------------------------------------------------- CLOSING --
def build_closing():
    img = new_canvas(PAPER)
    d = ImageDraw.Draw(img)
    ink, gold = INK, GOLD

    masthead(d, ink, gold)
    kicker(d, "—  PRO SETUP NOTE  —", gold)

    center_text(d, 470, "One more thing.", DiIt(54), gold)

    center_text(d, 590, "프로 셋업 ≠ 시판 완제품", Sd(62, "semibold"), ink)

    note = ("투어 선수들의 라켓은 대부분 프로스톡·페인트잡이라 매장 판매용과 사양이 다를 수 있어요. "
            "텐션도 코트 상태·컨디션에 따라 매치마다 조금씩 바뀝니다.")
    y = 700
    for line in wrap_lines(d, note, Mj(30), 820):
        center_text(d, y, line, Mj(30), ink)
        y += 46

    d.line([(440, y + 30), (640, y + 30)], fill=gold, width=2)

    center_text(d, y + 130, "Follow for more.", DiIt(62), gold)
    center_text(d, y + 210, "라켓 · 스트링 정보 더 보려면", Sd(38, "semibold"), ink)
    center_text(d, y + 260, "팔로우 해주세요", Sd(38, "semibold"), ink)

    center_text(d, y + 340, "—  FOLLOW  &  LIKE  —", Be(26), gold)
    center_text(d, y + 410, "@hi.dailytennis", DiIt(46), ink)

    save(img, "06_closing.png")


if __name__ == "__main__":
    print("palette seed", SEED, PAL)
    build_cover()
    for i, p in enumerate(PLAYERS, start=2):
        build_player(p, i)
    build_closing()
