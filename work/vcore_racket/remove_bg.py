"""
VCORE 라켓 이미지 배경 제거 (rembg)
- vcore98_front.jpg  → vcore98_nokki.png  (커버/인트로용 메인)
- vcore98_angle.jpg  → vcore98_angle_nokki.png (서브용)
"""
import os
from rembg import remove
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))

def process(src_name, dst_name):
    src = os.path.join(BASE, src_name)
    dst = os.path.join(BASE, dst_name)
    with open(src, "rb") as f:
        img_bytes = f.read()
    result = remove(img_bytes)
    with open(dst, "wb") as f:
        f.write(result)
    img = Image.open(dst)
    # 자동 크롭: 알파 마스크 기준 bounding box
    bbox = img.split()[-1].getbbox()
    if bbox:
        cropped = img.crop(bbox)
        cropped.save(dst)
        print(f"  {dst_name}: {img.size} → cropped {cropped.size}")
    else:
        print(f"  {dst_name}: {img.size} (크롭 불필요)")

process("vcore98_front.jpg", "vcore98_nokki.png")
process("vcore98_angle.jpg", "vcore98_angle_nokki.png")
print("누끼 완료")
