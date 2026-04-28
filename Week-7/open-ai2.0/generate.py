"""
기리고(Wish Your Death) 영화 포스터 생성기
OpenAI Images API (gpt-image-1) 사용

실행:
  OPENAI_API_KEY="sk-..." python3 generate.py [output_filename.png]

기본 출력: kirigo-poster-{timestamp}.png
크기: 1024x1536 (A4 포트레이트 비율과 가까움)
"""
import os
import sys
import json
import base64
import time
import urllib.request
import urllib.error

API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
if not API_KEY:
    print("ERROR: OPENAI_API_KEY 환경변수를 설정하세요", file=sys.stderr)
    sys.exit(1)

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
filename = sys.argv[1] if len(sys.argv) > 1 else f"kirigo-poster-{int(time.time())}.png"
output_path = os.path.join(OUT_DIR, filename)

PROMPT = """A cinematic Korean horror Netflix series movie poster for "기리고 (Wish Your Death)".
Vertical A4 portrait composition.

Foreground subject: A young Korean female high school student in a dark navy school uniform, mid-shot composition, holding a smartphone close to her face. The smartphone screen emits an eerie crimson red glow that illuminates only her terrified eyes and partial face, leaving the rest in deep shadow. Her hair partially covers one side of her face. Subtle horror — no blood, no gore, just dread.

Background: Pitch black darkness with faint ghostly silhouettes of other Korean students barely visible behind her, blurred and dissolving into the shadows. A traditional Korean shamanic talisman (부적, hanji paper with red ink calligraphy) floats subtly in the upper background, partially transparent like a phantom.

Top of poster: The Hangul title "기리고" in massive bold serif typography, distressed with subtle RGB chromatic aberration glitch effect (red and cyan offset). Below the title, smaller Latin subtitle "WISH YOUR DEATH" in wide-spaced uppercase serif.

Bottom of poster: A horizontal divider with a small ✦ ornament. Below it, the tagline "소원을 빌면, 죽음이 응답한다." in italic serif. At the very bottom, a Netflix-style minimalist credit block area.

Atmosphere & finishing:
- Cinematic film noir lighting, deep shadows
- Heavy 35mm film grain texture
- Subtle horizontal scanlines overlay
- Vignette darkening at all four corners
- Professional Netflix horror series poster aesthetic
- Color palette: deep black (#050505), blood red (#7c1d1d, #c9302c), ghostly white for text
- High contrast, photorealistic with stylized post-processing
- Mood: psychological horror, dread, supernatural curse

Style references: Korean horror cinema (장화홍련, 곡성), Netflix horror series posters (지금 우리 학교는, 살인자ㅇ난감), modern minimalist horror movie key art.

Do NOT include: violent imagery, blood, gore, weapons, demons, monsters. Keep horror restrained and psychological.
"""


def generate():
    body = {
        "model": "gpt-image-1",
        "prompt": PROMPT,
        "size": "1024x1536",
        "quality": "high",
        "n": 1,
    }

    print(f"[OpenAI] gpt-image-1 호출 중... (1024x1536, high quality)")
    print(f"[OpenAI] 출력: {output_path}")

    req = urllib.request.Request(
        "https://api.openai.com/v1/images/generations",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=240) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"ERROR {e.code}: {err_body}", file=sys.stderr)
        sys.exit(1)

    item = data["data"][0]
    if "b64_json" in item:
        img_bytes = base64.b64decode(item["b64_json"])
        with open(output_path, "wb") as f:
            f.write(img_bytes)
    elif "url" in item:
        with urllib.request.urlopen(item["url"], timeout=120) as r2:
            with open(output_path, "wb") as f:
                f.write(r2.read())
    else:
        print(f"ERROR: 응답에 이미지 데이터 없음: {item}", file=sys.stderr)
        sys.exit(1)

    size = os.path.getsize(output_path)
    print(f"[저장 완료] {output_path} ({size:,} bytes)")
    if "usage" in data:
        print(f"[토큰 사용량] {data['usage']}")


if __name__ == "__main__":
    generate()
