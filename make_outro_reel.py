# -*- coding: utf-8 -*-
# 릴스 끝에 "팔로우 & 좋아요" 엔드카드(2초)를 붙여 재조립
# usage: python3 make_outro_reel.py <build_dir> <reel_mp4_path> <n_slides>
import sys, os, asyncio, subprocess
from playwright.async_api import async_playwright

BUILD_DIR = sys.argv[1]
REEL_MP4  = sys.argv[2]
N         = int(sys.argv[3])
os.chdir(BUILD_DIR)

OUTRO_HTML = f"{BUILD_DIR}/outro.html"

HTML = """<!doctype html><html lang="ko"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Black+Han+Sans&family=Fraunces:ital,opsz,wght@1,9..144,400;1,9..144,600&family=Tenor+Sans&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css">
<style>
:root{--purple:#5A3978;--plum:#2E1F3D;--lav:#EFE6F2;--gold:#B89968;--paper:#EFE6D2;}
*{margin:0;padding:0;box-sizing:border-box;-webkit-font-smoothing:antialiased;}
body{margin:0;}
.slide{position:relative;width:1080px;height:1920px;overflow:hidden;
 background:radial-gradient(120% 80% at 50% 18%, #6e4a90 0%, var(--purple) 42%, var(--plum) 100%);
 color:var(--lav);font-family:'Pretendard',sans-serif;
 display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 90px;}
.eyebrow{font-family:'Tenor Sans';text-transform:uppercase;letter-spacing:.34em;font-size:30px;color:var(--gold);}
.fr{font-family:'Fraunces';font-style:italic;}
.kr{font-family:'Black Han Sans';line-height:1.06;}
.icons{font-size:120px;margin:6px 0 4px;letter-spacing:18px;}
.cta-kr{font-family:'Black Han Sans';font-size:108px;line-height:1.05;color:#fff;margin-top:6px;}
.cta-kr .g{color:var(--gold);}
.sub{font-size:40px;line-height:1.5;margin-top:40px;opacity:.95;}
.handle{margin-top:64px;display:inline-flex;align-items:center;gap:20px;
 background:rgba(255,255,255,.12);border:2px solid rgba(239,230,210,.45);border-radius:80px;
 padding:30px 56px;}
.handle .h{font-family:'Anton';font-size:62px;letter-spacing:.01em;color:#fff;}
.loc{font-family:'JetBrains Mono';font-size:30px;letter-spacing:.04em;margin-top:54px;opacity:.85;}
.pulse{position:absolute;border-radius:50%;border:2px solid rgba(239,230,210,.16);}
</style></head><body>
<section class="slide">
  <div class="pulse" style="width:1500px;height:1500px;"></div>
  <div class="pulse" style="width:1900px;height:1900px;"></div>
  <div style="position:relative;">
    <div class="eyebrow">Thank you for watching</div>
    <div class="fr" style="font-size:48px;margin-top:22px;opacity:.92;">Did this help?</div>
    <div class="icons">👍&nbsp;❤️</div>
    <div class="cta-kr">팔로우 &amp; <span class="g">좋아요</span></div>
    <div class="sub">도움이 됐다면 꾹! 눌러주세요<br>더 많은 라켓·스트링 꿀팁이 매주 올라와요</div>
    <div class="handle"><span style="font-size:46px;">📍</span><span class="h">@hi.dailytennis</span></div>
    <div class="loc">데일리테니스 · 수원 인계점</div>
  </div>
</section></body></html>"""

with open(OUTRO_HTML, "w", encoding="utf-8") as f:
    f.write(HTML)

async def render():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width":1080,"height":1920}, device_scale_factor=2)
        page = await ctx.new_page()
        await page.goto(f"file://{OUTRO_HTML}")
        await page.wait_for_load_state("networkidle")
        await page.evaluate("document.fonts.ready")
        await page.wait_for_timeout(3000)
        await (await page.query_selector(".slide")).screenshot(path=f"{BUILD_DIR}/r9_outro.png")
        await b.close()
        print("outro rendered")
asyncio.run(render())

# concat 리스트: 본문 슬라이드 3초 + 엔드카드 2초
lines = []
for i in range(1, N+1):
    lines.append(f"file 'r9_{i:02d}.png'")
    lines.append("duration 3")
lines.append("file 'r9_outro.png'")
lines.append("duration 2")
lines.append("file 'r9_outro.png'")  # concat demuxer: 마지막 duration 적용 위해 한 번 더
with open("reel_list.txt", "w") as f:
    f.write("\n".join(lines) + "\n")

cmd = [
 "ffmpeg","-y","-f","concat","-safe","0","-i","reel_list.txt",
 "-vf","scale=1080:1920,fps=30,setsar=1",
 "-c:v","libx264","-pix_fmt","yuv420p","-movflags","+faststart","-preset","medium","-crf","18",
 REEL_MP4
]
subprocess.run(cmd, check=True)
print("reel rebuilt:", REEL_MP4)
