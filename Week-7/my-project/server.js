// Soft Studio — 아기-부모 카툰 쇼츠 메이커
// Day 2: 정적 서빙 + 헬스체크 + 파일 업로드 + AssemblyAI 발화자 구분
// 단일 파일 구조 (server.js 한 파일에 모든 백엔드 로직)

require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Pool } = require('pg');
const axios = require('axios');

// =====================================================================
// 1) 설정
// =====================================================================
const PORT = parseInt(process.env.PORT || '3007', 10);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).trim();
const ASSEMBLYAI_API_KEY = (process.env.ASSEMBLYAI_API_KEY || '').trim();
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();

const ROOT_DIR = __dirname;
const UPLOAD_DIR = path.join(ROOT_DIR, 'uploads');
const OUTPUT_DIR = path.join(ROOT_DIR, 'outputs');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const CHARACTERS_DIR = path.join(PUBLIC_DIR, 'characters');

// 업로드 제한
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
const ALLOWED_MIMES = new Set([
  'audio/mp4',
  'audio/mpeg',
  'audio/m4a',
  'audio/x-m4a',
  'audio/mp3',
  'video/mp4',
]);
const ALLOWED_EXTS = new Set(['.mp3', '.m4a', '.mp4']);

// AssemblyAI 폴링 설정
const ASSEMBLY_POLL_INTERVAL_MS = 3000;   // 3초마다
const ASSEMBLY_POLL_TIMEOUT_MS = 5 * 60 * 1000; // 최대 5분

// =====================================================================
// 2) 시작 시 디렉토리 보장
// =====================================================================
for (const dir of [UPLOAD_DIR, OUTPUT_DIR, PUBLIC_DIR, CHARACTERS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// =====================================================================
// 3) DB 풀
// =====================================================================
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 5,
  ssl: { rejectUnauthorized: false },
});

async function verifyDbConnection() {
  if (!DATABASE_URL) {
    console.warn('[경고] DATABASE_URL 환경변수가 비어있습니다. .env 파일을 확인하세요.');
    return false;
  }
  try {
    const { rows } = await pool.query('SELECT 1 AS ok');
    if (rows[0]?.ok === 1) {
      console.log('[DB] Supabase Postgres 연결 OK');
      return true;
    }
    return false;
  } catch (err) {
    console.error('[DB] 연결 실패 — DATABASE_URL과 Supabase 상태를 확인하세요.');
    console.error('     세부 메시지:', err.message);
    return false;
  }
}

// =====================================================================
// 4) Express 앱
// =====================================================================
const app = express();

app.use(express.json({ limit: '2mb' }));

// 정적 파일: /public/* (캐릭터 이미지)
app.use('/public', express.static(PUBLIC_DIR));

// 출력 MP4 다운로드 (Day 5에서 사용 예정 — 미리 노출만)
app.use('/outputs', express.static(OUTPUT_DIR));

// 루트 경로: index.html → prototype-v1.html → 스텁
app.get('/', (_req, res) => {
  const indexPath = path.join(ROOT_DIR, 'index.html');
  const prototypePath = path.join(ROOT_DIR, 'prototype-v1.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  if (fs.existsSync(prototypePath)) {
    return res.sendFile(prototypePath);
  }
  res
    .status(200)
    .type('html')
    .send('<h1>Soft Studio — server up</h1><p>index.html / prototype-v1.html 둘 다 없음. Day 2-3에서 index.html 생성 예정.</p>');
});

// =====================================================================
// 5) /api/health
// =====================================================================
app.get('/api/health', async (_req, res) => {
  const ts = new Date().toISOString();
  let dbStatus = 'error';
  try {
    await pool.query('SELECT 1');
    dbStatus = 'ok';
  } catch (_e) {
    dbStatus = 'error';
  }
  const assemblyaiStatus = ASSEMBLYAI_API_KEY ? 'configured' : 'missing';
  res.json({
    ok: dbStatus === 'ok' && assemblyaiStatus === 'configured',
    ts,
    db: dbStatus,
    assemblyai: assemblyaiStatus,
  });
});

// =====================================================================
// 6) 파일 업로드 (multer)
// =====================================================================
// 파일을 업로드 받기 전에는 jobId(=DB UUID)를 알 수 없으므로
// 임시 파일명으로 받은 뒤 DB에서 jobId 발급되면 rename 한다.
const tmpStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const tmpName = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, tmpName);
  },
});

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  if (ALLOWED_MIMES.has(mime) || ALLOWED_EXTS.has(ext)) {
    return cb(null, true);
  }
  cb(new Error(`지원하지 않는 파일 형식입니다. mp3 / m4a / mp4 만 허용됩니다. (받은 형식: ${mime || ext || '알 수 없음'})`));
}

const upload = multer({
  storage: tmpStorage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

// POST /api/upload
//   form-data field name: "file"
//   응답: { jobId, expiresAt }
app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            success: false,
            message: `파일 크기가 너무 큽니다. ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB 이하로 업로드해주세요.`,
          });
        }
        return res.status(400).json({ success: false, message: `업로드 오류: ${err.message}` });
      }
      return res.status(400).json({ success: false, message: err.message || '업로드에 실패했습니다.' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: '파일이 첨부되지 않았습니다. (field name: "file")' });
    }

    const tmpPath = req.file.path;
    const originalFilename = req.file.originalname || 'unknown';
    const ext = path.extname(originalFilename).toLowerCase();

    try {
      // DB INSERT — id는 DB가 gen_random_uuid()로 발급
      const insertSql = `
        INSERT INTO baby_cartoon.jobs
          (original_filename, expires_at, status, upload_path)
        VALUES
          ($1, NOW() + INTERVAL '1 hour', 'uploaded', $2)
        RETURNING id, expires_at
      `;
      // upload_path는 일단 tmp 경로로 INSERT한 뒤, rename 후 UPDATE
      const insertResult = await pool.query(insertSql, [originalFilename, tmpPath]);
      const jobId = insertResult.rows[0].id;
      const expiresAt = insertResult.rows[0].expires_at;

      // 임시 파일을 jobId 기반 이름으로 rename
      const finalName = `${jobId}${ext}`;
      const finalPath = path.join(UPLOAD_DIR, finalName);
      fs.renameSync(tmpPath, finalPath);

      await pool.query(
        `UPDATE baby_cartoon.jobs SET upload_path = $1 WHERE id = $2`,
        [finalPath, jobId]
      );

      console.log(`[업로드] jobId=${jobId} file=${originalFilename} → ${finalPath}`);
      res.status(201).json({
        success: true,
        data: { jobId, expiresAt },
        message: '업로드 완료. 1시간 후 자동 삭제됩니다.',
      });
    } catch (dbErr) {
      // DB 실패 시 임시 파일 정리
      try { fs.unlinkSync(tmpPath); } catch (_e) { /* ignore */ }
      console.error('[업로드 DB 오류]', dbErr.message);
      res.status(500).json({
        success: false,
        message: '업로드 정보를 저장하는 중 오류가 발생했습니다. 다시 시도해주세요.',
      });
    }
  });
});

// =====================================================================
// 7) AssemblyAI 발화자 구분
// =====================================================================
async function uploadToAssemblyAI(filePath) {
  const stream = fs.createReadStream(filePath);
  const resp = await axios.post('https://api.assemblyai.com/v2/upload', stream, {
    headers: {
      authorization: ASSEMBLYAI_API_KEY,
      'transfer-encoding': 'chunked',
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  if (!resp.data || !resp.data.upload_url) {
    throw new Error('AssemblyAI 업로드 응답에 upload_url이 없습니다.');
  }
  return resp.data.upload_url;
}

async function requestTranscript(audioUrl) {
  const resp = await axios.post(
    'https://api.assemblyai.com/v2/transcript',
    {
      audio_url: audioUrl,
      speaker_labels: true,
      language_code: 'ko',
      speakers_expected: 3,
    },
    { headers: { authorization: ASSEMBLYAI_API_KEY } }
  );
  if (!resp.data || !resp.data.id) {
    throw new Error('AssemblyAI transcript 요청 응답에 id가 없습니다.');
  }
  return resp.data.id;
}

async function pollTranscript(transcriptId) {
  const startedAt = Date.now();
  while (true) {
    if (Date.now() - startedAt > ASSEMBLY_POLL_TIMEOUT_MS) {
      throw new Error('AssemblyAI 처리 시간이 5분을 초과했습니다. (timeout)');
    }
    const resp = await axios.get(
      `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
      { headers: { authorization: ASSEMBLYAI_API_KEY } }
    );
    const status = resp.data?.status;
    if (status === 'completed') {
      return resp.data;
    }
    if (status === 'error') {
      throw new Error(`AssemblyAI 처리 실패: ${resp.data?.error || '원인 미상'}`);
    }
    // queued | processing → 다시 폴링
    await new Promise((r) => setTimeout(r, ASSEMBLY_POLL_INTERVAL_MS));
  }
}

function normalizeUtterances(utterances) {
  if (!Array.isArray(utterances)) return [];
  return utterances.map((u, idx) => ({
    id: idx,
    start: Number(((u.start ?? 0) / 1000).toFixed(3)), // ms → sec
    end: Number(((u.end ?? 0) / 1000).toFixed(3)),
    text: u.text || '',
    speaker: u.speaker || 'A',
  }));
}

// POST /api/transcribe
//   body: { jobId }
//   응답: { jobId, segments }
app.post('/api/transcribe', async (req, res) => {
  const { jobId } = req.body || {};
  if (!jobId) {
    return res.status(400).json({ success: false, message: 'jobId가 필요합니다.' });
  }
  if (!ASSEMBLYAI_API_KEY) {
    return res.status(500).json({
      success: false,
      message: 'AssemblyAI API 키가 설정되어 있지 않습니다. .env의 ASSEMBLYAI_API_KEY를 확인하세요.',
    });
  }

  try {
    // 1) job 조회
    const { rows } = await pool.query(
      `SELECT id, upload_path, status, expires_at FROM baby_cartoon.jobs WHERE id = $1`,
      [jobId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '해당 jobId의 작업을 찾을 수 없습니다.' });
    }
    const job = rows[0];
    if (!job.upload_path || !fs.existsSync(job.upload_path)) {
      return res.status(404).json({
        success: false,
        message: '업로드된 파일을 찾을 수 없습니다. 1시간이 지나 자동 삭제되었을 수 있습니다.',
      });
    }
    if (new Date(job.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ success: false, message: '작업이 만료되었습니다. 다시 업로드해주세요.' });
    }

    // 2) 상태를 transcribing 으로 업데이트
    await pool.query(
      `UPDATE baby_cartoon.jobs SET status = 'transcribing' WHERE id = $1`,
      [jobId]
    );

    // 3) AssemblyAI 호출
    console.log(`[전사] jobId=${jobId} AssemblyAI 업로드 시작`);
    const uploadUrl = await uploadToAssemblyAI(job.upload_path);
    console.log(`[전사] jobId=${jobId} 업로드 완료 → transcript 요청`);
    const transcriptId = await requestTranscript(uploadUrl);
    console.log(`[전사] jobId=${jobId} transcriptId=${transcriptId} 폴링 시작`);
    const result = await pollTranscript(transcriptId);

    const segments = normalizeUtterances(result.utterances);
    if (segments.length === 0) {
      // 일부 짧은 음성은 utterances가 비어있을 수 있음 — 경고만 하고 빈 배열 저장
      console.warn(`[전사] jobId=${jobId} utterances가 비어있습니다.`);
    }

    // 4) DB 저장
    await pool.query(
      `UPDATE baby_cartoon.jobs SET segments = $1::jsonb, status = 'transcribed' WHERE id = $2`,
      [JSON.stringify(segments), jobId]
    );

    console.log(`[전사] jobId=${jobId} 완료 — segments=${segments.length}개`);
    res.json({
      success: true,
      data: { jobId, segments },
      message: '발화자 구분이 완료되었습니다.',
    });
  } catch (err) {
    console.error(`[전사 실패] jobId=${jobId}`, err.message);
    // 실패 상태 기록 (best effort)
    try {
      await pool.query(
        `UPDATE baby_cartoon.jobs SET status = 'failed', error_message = $1 WHERE id = $2`,
        [err.message, jobId]
      );
    } catch (_e) { /* ignore */ }
    res.status(500).json({
      success: false,
      message: `발화자 구분에 실패했습니다: ${err.message}`,
    });
  }
});

// =====================================================================
// 8) 글로벌 에러 핸들러 (multer 외 안전망)
// =====================================================================
app.use((err, _req, res, _next) => {
  console.error('[미처리 오류]', err);
  res.status(500).json({
    success: false,
    message: '서버 내부 오류가 발생했습니다.',
  });
});

// =====================================================================
// 9) 시작
// =====================================================================
(async () => {
  await verifyDbConnection();
  if (!ASSEMBLYAI_API_KEY) {
    console.warn('[경고] ASSEMBLYAI_API_KEY가 비어있습니다. /api/transcribe 호출 시 실패합니다.');
  }
  app.listen(PORT, () => {
    console.log(`Soft Studio — server up on ${BASE_URL}`);
    console.log(`  uploads/  → ${UPLOAD_DIR}`);
    console.log(`  outputs/  → ${OUTPUT_DIR}`);
    console.log(`  public/   → ${PUBLIC_DIR}`);
  });
})();

module.exports = app;
