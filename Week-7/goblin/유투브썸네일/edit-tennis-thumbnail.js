// gpt-image-1 edits API로 실제 영상 프레임 위에 썸네일 텍스트/효과 합성
// input_fidelity=high 로 원본 인물 보존
// 사용법: OPENAI_API_KEY=sk-... node edit-tennis-thumbnail.js

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error('OPENAI_API_KEY 환경변수가 필요합니다.');
  process.exit(1);
}

const OUT_DIR = __dirname;
const FRAMES_DIR = path.join(OUT_DIR, 'tennis-frames');

const tasks = [
  {
    name: 'thumb-edit-220s-coach-v2',
    image: path.join(FRAMES_DIR, 'base_220s_1536x1024.jpg'),
    prompt: `Transform this real tennis lesson photo into a punchy Korean YouTube thumbnail.

PRESERVE the two real Korean men, their faces, glasses, clothing, the purple tennis court, and the indoor court setting EXACTLY as they appear. Do NOT change the people or the background scene.

ADD on top of the existing image:
1. Bold massive Korean text in the upper area, two stacked lines: "백핸드가 고민인" (top, smaller, white with black outline) and "테린이" (bottom, much bigger, bright YELLOW with thick black outline). Energetic punchy Korean YouTube thumbnail font style.
2. A bright red curved arrow pointing from the text toward the student's hands/grip.
3. A small "EP.1" badge in the bottom-right corner with a bright color.
4. At the very BOTTOM of the image, a thin horizontal strip with very SMALL fine-print Korean text styled like a legal disclaimer or fine-print warning notice: "※ 원포인트 레슨 받을 출연자 항시 구함" — small white text on dark semi-transparent strip, like a TV broadcast disclaimer / terms-and-conditions footer.
5. Slightly boost the saturation of the purple court and increase contrast for that punchy Korean YouTube look. Add a subtle vignette around edges.

Keep the existing DAILY TENNIS yellow circular logo in the top-right corner intact. The composition should feel energetic and click-worthy while keeping the photographic realism of the original scene.`,
  },
  {
    name: 'thumb-edit-175s-solo-v2',
    image: path.join(FRAMES_DIR, 'base_175s_1536x1024.jpg'),
    prompt: `Transform this real tennis lesson photo into a punchy Korean YouTube thumbnail.

PRESERVE the real Korean man with glasses and his ready stance, his clothing, the racket, the purple tennis court, and the indoor court setting EXACTLY as they appear. Do NOT change the person or the background scene.

ADD on top of the existing image:
1. Bold massive Korean text on the LEFT side (where there is empty court space), two stacked lines: "백핸드가 고민인" (top line, white with black thick outline, medium size) and "테린이" (bottom line, MUCH bigger, bright YELLOW with thick black outline, slightly tilted for energy). Korean YouTube thumbnail style.
2. A bright red circle highlight around the racket head to draw attention.
3. A small "EP.1" badge in the top-left corner.
4. At the very BOTTOM edge of the image, a thin horizontal dark strip with VERY SMALL fine-print Korean text styled like a legal disclaimer / TV broadcast footer notice: "※ 원포인트 레슨 받을 출연자 항시 구함" — small white text on a dark semi-transparent bar, looks like terms-and-conditions fine print.
5. Slightly boost saturation on the purple court, add subtle vignette and contrast for the Korean YouTube thumbnail look.

Keep the existing DAILY TENNIS yellow circular logo in the top-right corner intact. Photographic realism preserved, only graphics/text added on top.`,
  },
];

async function edit(task) {
  console.log(`\n[edit 시작] ${task.name}`);
  const start = Date.now();

  const form = new FormData();
  const imgBuf = fs.readFileSync(task.image);
  const blob = new Blob([imgBuf], { type: 'image/jpeg' });
  form.append('model', 'gpt-image-1');
  form.append('image', blob, path.basename(task.image));
  form.append('prompt', task.prompt);
  form.append('size', '1536x1024');
  form.append('quality', 'high');
  form.append('input_fidelity', 'high');
  form.append('n', '1');

  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const b64 = data.data[0].b64_json;
  const buf = Buffer.from(b64, 'base64');
  const outPath = path.join(OUT_DIR, `${task.name}.png`);
  fs.writeFileSync(outPath, buf);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[완료] ${outPath} (${(buf.length / 1024).toFixed(0)}KB, ${elapsed}s)`);
  if (data.usage) {
    console.log(`  토큰: input=${data.usage.input_tokens}, output=${data.usage.output_tokens}`);
  }
}

(async () => {
  for (const t of tasks) {
    try {
      await edit(t);
    } catch (e) {
      console.error(`[실패] ${t.name}:`, e.message);
    }
  }
  console.log('\n완료.');
})();
