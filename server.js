const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// fal.ai API 설정
const FAL_API_KEY = (process.env.FAL_KEY || '5f64e3fc-dd8b-4f71-ab1d-a8fb349cb88a:ebfb4a1b8d33f315777f8dc842cf58fe').trim();
const FAL_BASE_URL = 'https://fal.run';

// 생성된 이미지 히스토리 (인메모리)
let imageHistory = [];
let nextId = 1;

// 미들웨어
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// POST /api/generate - 이미지 생성
app.post('/api/generate', async (req, res) => {
  try {
    const {
      prompt,
      model = 'fal-ai/flux/dev',
      image_size = 'landscape_4_3',
      num_inference_steps = 28,
      guidance_scale = 3.5,
      num_images = 1,
      seed
    } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ success: false, message: '프롬프트를 입력해주세요.' });
    }

    const body = {
      prompt: prompt.trim(),
      image_size,
      num_inference_steps,
      guidance_scale,
      num_images,
      output_format: 'jpeg',
      enable_safety_checker: true
    };
    if (seed !== undefined && seed !== null && seed !== '') {
      body.seed = Number(seed);
    }

    const response = await fetch(`${FAL_BASE_URL}/${model}`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        success: false,
        message: `fal.ai API 오류: ${response.status}`,
        detail: errorText
      });
    }

    const data = await response.json();

    // 히스토리에 저장
    const record = {
      id: nextId++,
      prompt: prompt.trim(),
      model,
      image_size,
      images: data.images || [],
      seed: data.seed,
      createdAt: new Date().toISOString()
    };
    imageHistory.unshift(record);
    if (imageHistory.length > 50) imageHistory = imageHistory.slice(0, 50);

    res.json({ success: true, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: '이미지 생성 중 오류가 발생했습니다.', detail: err.message });
  }
});

// GET /api/history - 히스토리 조회
app.get('/api/history', (_req, res) => {
  res.json({ success: true, data: imageHistory });
});

// DELETE /api/history/:id - 히스토리 삭제
app.delete('/api/history/:id', (req, res) => {
  const id = Number(req.params.id);
  const idx = imageHistory.findIndex(item => item.id === id);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: '항목을 찾을 수 없습니다.' });
  }
  imageHistory.splice(idx, 1);
  res.json({ success: true, message: '삭제되었습니다.' });
});

// DELETE /api/history - 전체 히스토리 삭제
app.delete('/api/history', (_req, res) => {
  imageHistory = [];
  nextId = 1;
  res.json({ success: true, message: '모든 히스토리가 삭제되었습니다.' });
});

// SPA fallback
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Local / Vercel dual-mode
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}
module.exports = app;
