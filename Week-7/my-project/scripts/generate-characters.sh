#!/bin/bash
# 디즈니/웹툰/침착맨 스타일 캐릭터 9장 생성
# 사용: FAL_KEY 충전 후 ./scripts/generate-characters.sh
#
# 1) https://fal.ai/dashboard/billing 에서 잔액 충전 (최소 1$ ≈ 약 140장)
# 2) FAL_KEY 환경변수 설정 또는 아래 변수 직접 지정
# 3) 이 스크립트 실행
set -e
cd "$(dirname "$0")/.."

if [ -z "$FAL_KEY" ]; then
  # 루트 server.js의 키 재사용 (없으면 직접 설정)
  export FAL_KEY="5f64e3fc-dd8b-4f71-ab1d-a8fb349cb88a:ebfb4a1b8d33f315777f8dc842cf58fe"
fi

SCRIPT="$HOME/afm-2th-weekday/.claude/skills/fal-image-gen/scripts/generate.py"
DEST="$(pwd)/public/characters"
mkdir -p "$DEST/disney" "$DEST/webtoon" "$DEST/chimchak"

# 디즈니
python3 "$SCRIPT" -p "Korean dad early 30s, Disney Pixar 3D style cartoon character, full body standing portrait facing forward, friendly warm smile, casual beige sweater khaki pants, simple clean design, isolated on plain white background, no shadow, centered" -o "$DEST/disney/dad.png" -W 1024 -H 1024 &
python3 "$SCRIPT" -p "Korean mom early 30s, Disney Pixar 3D style cartoon character, full body standing portrait facing forward, kind gentle smile, soft pink blouse and beige skirt, simple clean design, isolated on plain white background, no shadow, centered" -o "$DEST/disney/mom.png" -W 1024 -H 1024 &
python3 "$SCRIPT" -p "Korean toddler baby 1 year old, Disney Pixar 3D style cartoon character, full body standing portrait facing forward, big sparkling eyes cute smile, white onesie pajama, simple clean design, isolated on plain white background, no shadow, centered" -o "$DEST/disney/baby.png" -W 1024 -H 1024 &

# 웹툰
python3 "$SCRIPT" -p "Korean dad early 30s, Korean webtoon manhwa illustration style, soft cel-shaded line art, full body standing portrait facing forward, friendly smile, modern casual outfit, isolated on plain white background, centered, clean line work" -o "$DEST/webtoon/dad.png" -W 1024 -H 1024 &
python3 "$SCRIPT" -p "Korean mom early 30s, Korean webtoon manhwa illustration style, soft cel-shaded line art, full body standing portrait facing forward, warm gentle smile, soft pastel cardigan and skirt, isolated on plain white background, centered, clean line work" -o "$DEST/webtoon/mom.png" -W 1024 -H 1024 &
python3 "$SCRIPT" -p "Korean toddler baby 1 year old, Korean webtoon manhwa illustration style, soft cel-shaded line art, full body standing portrait facing forward, cute big eyes, white pajamas, isolated on plain white background, centered, clean line work" -o "$DEST/webtoon/baby.png" -W 1024 -H 1024 &

# 침착맨 (코믹)
python3 "$SCRIPT" -p "Korean dad cartoon character, simple thick black outlined drawing, comedic exaggerated cute expression, flat color fill, minimalistic indie cartoon style, full body standing facing forward, isolated on plain white background, centered" -o "$DEST/chimchak/dad.png" -W 1024 -H 1024 &
python3 "$SCRIPT" -p "Korean mom cartoon character, simple thick black outlined drawing, comedic exaggerated cute expression, flat color fill, minimalistic indie cartoon style, full body standing facing forward, isolated on plain white background, centered" -o "$DEST/chimchak/mom.png" -W 1024 -H 1024 &
python3 "$SCRIPT" -p "Korean baby toddler cartoon character, simple thick black outlined drawing, comedic cute big head expression, flat color fill, minimalistic indie cartoon style, full body, isolated on plain white background, centered" -o "$DEST/chimchak/baby.png" -W 1024 -H 1024 &

wait
echo ""
echo "✅ 생성 완료"
ls -la "$DEST/disney/" "$DEST/webtoon/" "$DEST/chimchak/"
