// v2 결과물 위에 둥근 마스크로 깔끔한 로고만 합성
// 사용법: node composite-logo.js
const sharp = require('sharp');
const path = require('path');

const BASE = path.join(__dirname, 'thumb-edit-220s-coach-v2.png');
const LOGO_SRC = path.join(__dirname, 'logo_only.png'); // 200x180 (로고+배경)
const OUT = path.join(__dirname, 'thumb-edit-220s-coach-v3.png');

// 결과물 위 overlay 위치 (우상단)
const OVERLAY_LEFT = 1356;
const OVERLAY_TOP = 24;

// logo_only.png 안에서 로고 노란 원의 추정 좌표/반지름
// 200x180 영역 안에서 노란 원 중심: 약 (100, 65), 반지름 ~55px
const CIRC_CX = 100;
const CIRC_CY = 65;
const CIRC_R = 60;

(async () => {
  // 둥근 마스크 SVG (소프트 페더 약간)
  const mask = Buffer.from(
    `<svg width="200" height="180" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="g" cx="${CIRC_CX}" cy="${CIRC_CY}" r="${CIRC_R}" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="white" stop-opacity="1"/>
          <stop offset="0.85" stop-color="white" stop-opacity="1"/>
          <stop offset="1" stop-color="white" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="200" height="180" fill="black"/>
      <circle cx="${CIRC_CX}" cy="${CIRC_CY}" r="${CIRC_R}" fill="url(#g)"/>
    </svg>`
  );

  // 로고 이미지에 마스크 적용 → 원 안만 보이고 나머지는 투명
  const logoCircular = await sharp(LOGO_SRC)
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // v2 결과물 위에 합성
  await sharp(BASE)
    .composite([{ input: logoCircular, left: OVERLAY_LEFT, top: OVERLAY_TOP }])
    .png()
    .toFile(OUT);

  console.log(`완료: ${OUT}`);
})();
