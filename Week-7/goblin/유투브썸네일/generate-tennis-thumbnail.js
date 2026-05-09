// gpt-image-1로 DAILY TENNIS 레슨 영상용 유튜브 썸네일 생성
// 사용법: OPENAI_API_KEY=sk-... node generate-tennis-thumbnail.js

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error('OPENAI_API_KEY 환경변수가 필요합니다.');
  process.exit(1);
}

const OUT_DIR = __dirname;

const concepts = [
  {
    name: 'tennis-thumbnail-v1-with-text',
    prompt: `Korean YouTube thumbnail, 16:9 landscape, vibrant high-contrast style for a tennis lesson channel "DAILY TENNIS".

Scene: Indoor tennis court with a vivid PURPLE playing surface and white lines, bright lighting. A 20-something Korean man with black hair and round glasses, wearing a black hooded zip-up jacket and black athletic shorts, holding a tennis racket with both hands ready to swing forehand, focused intense expression, sweat on forehead. Bright neon yellow tennis ball mid-air close to the racket, slight motion blur on the ball.

Composition: Subject on the LEFT side taking 50% of frame from waist up, rule-of-thirds. Background: blurred purple tennis court, white wall with mesh netting.

Bold large Korean text overlay on the RIGHT side, two stacked lines:
Line 1 (top): "테린이 첫 레슨" in massive bold yellow Korean letters with thick black outline
Line 2 (bottom): "이게 된다고?" in white with red accent, slightly smaller

Small circular badge top-right corner: yellow smiley logo with text "DAILY TENNIS".

Style: punchy Korean YouTube thumbnail aesthetic — saturated colors, strong contrast, slight vignette, sharp focus on subject, dynamic energy. Photorealistic, NOT illustration.`,
  },
  {
    name: 'tennis-thumbnail-v2-clean-base',
    prompt: `Korean YouTube thumbnail base image, 16:9 landscape, no text, photorealistic.

Indoor tennis court with vivid PURPLE playing surface, white court lines, white tile walls with black mesh netting visible in background, bright overhead lighting. A 20-something Korean man with black hair and round eyeglasses, wearing a black hooded zip-up jacket and black athletic shorts, white socks and dark sneakers. He is in an athletic ready stance, holding a tennis racket with both hands at chest level (continental grip), looking forward with a focused determined expression.

A bright neon yellow tennis ball is mid-air to his left, slight motion blur. Two more tennis balls scattered on the court surface for context.

Composition: subject centered slightly left, full body visible from knees up, rule-of-thirds. Empty negative space on the upper right area suitable for text overlay later. Cinematic shallow depth of field with court receding into soft blur.

Style: clean modern Korean tennis lesson channel aesthetic, saturated but natural colors (purple court pops), strong contrast, sharp subject focus. NO TEXT, NO LOGO, NO WATERMARK anywhere.`,
  },
];

async function generate(concept) {
  console.log(`\n[생성 시작] ${concept.name}`);
  const start = Date.now();

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: concept.prompt,
      size: '1536x1024',
      quality: 'high',
      n: 1,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const b64 = data.data[0].b64_json;
  const buf = Buffer.from(b64, 'base64');
  const outPath = path.join(OUT_DIR, `${concept.name}.png`);
  fs.writeFileSync(outPath, buf);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[완료] ${outPath} (${(buf.length / 1024).toFixed(0)}KB, ${elapsed}s)`);
  if (data.usage) {
    console.log(`  토큰: input=${data.usage.input_tokens}, output=${data.usage.output_tokens}`);
  }
}

(async () => {
  for (const c of concepts) {
    try {
      await generate(c);
    } catch (e) {
      console.error(`[실패] ${c.name}:`, e.message);
    }
  }
  console.log('\n모든 작업 종료.');
})();
