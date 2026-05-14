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
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);

// =====================================================================
// 1) 설정
// =====================================================================
const PORT = parseInt(process.env.PORT || '3007', 10);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).trim();
const ASSEMBLYAI_API_KEY = (process.env.ASSEMBLYAI_API_KEY || '').trim();
// AssemblyAI 모델 — 우선순위 배열로 전달 (앞이 우선)
//   universal-3-pro는 한국어 미지원이므로 universal-2로 자동 폴백 필요.
//   AssemblyAI 권장: ["universal-3-pro", "universal-2"]
const ASSEMBLYAI_SPEECH_MODELS = (process.env.ASSEMBLYAI_SPEECH_MODELS || 'universal-3-pro,universal-2')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();

const ROOT_DIR = __dirname;
const UPLOAD_DIR = path.join(ROOT_DIR, 'uploads');
const OUTPUT_DIR = path.join(ROOT_DIR, 'outputs');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const CHARACTERS_DIR = path.join(PUBLIC_DIR, 'characters');

// 업로드 제한
const MAX_FILE_SIZE_BYTES = 300 * 1024 * 1024; // 300MB — 동영상 첨부 여유 확보 (음성만 추출해서 분석)
const ALLOWED_MIMES = new Set([
  'audio/mp4',
  'audio/mpeg',
  'audio/m4a',
  'audio/x-m4a',
  'audio/mp3',
  'video/mp4',
  'video/quicktime', // iPhone 기본 포맷 (.mov)
]);
const ALLOWED_EXTS = new Set(['.mp3', '.m4a', '.mp4', '.mov']);

// AssemblyAI 폴링 설정
const ASSEMBLY_POLL_INTERVAL_MS = 3000;   // 3초마다
const ASSEMBLY_POLL_TIMEOUT_MS = 5 * 60 * 1000; // 최대 5분

// 입력 영상/음성 제약 (MISSION.md: 5분 이내)
const MAX_DURATION_SEC = 5 * 60 + 5; // 약간의 여유 5초

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

// ffprobe로 오디오 스트림 + duration 검증
//   반환: { ok: true, durationSec, channels, sampleRate } | { ok: false, code, message }
async function probeMedia(filePath) {
  try {
    const { stdout } = await execFileP('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-show_entries', 'stream=codec_type,codec_name,channels,sample_rate',
      '-of', 'json',
      filePath,
    ]);
    const data = JSON.parse(stdout);
    const streams = Array.isArray(data.streams) ? data.streams : [];
    const audio = streams.find((s) => s.codec_type === 'audio');
    if (!audio) {
      return {
        ok: false,
        code: 'NO_AUDIO',
        message: '오디오 트랙이 없는 영상입니다. 음성이 녹음된 mp4 / mov / m4a / mp3 파일을 업로드해주세요.',
      };
    }
    const durationSec = Number(data.format?.duration || 0);
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      return { ok: false, code: 'INVALID_DURATION', message: '재생 시간을 확인할 수 없는 파일입니다.' };
    }
    if (durationSec > MAX_DURATION_SEC) {
      const m = Math.floor(durationSec / 60);
      const s = Math.round(durationSec - m * 60);
      return {
        ok: false,
        code: 'TOO_LONG',
        message: `영상이 너무 깁니다 (${m}분 ${s}초). 5분 이하의 영상만 가능합니다.`,
      };
    }
    return {
      ok: true,
      durationSec,
      channels: audio.channels || null,
      sampleRate: audio.sample_rate ? Number(audio.sample_rate) : null,
      audioCodec: audio.codec_name || null,
    };
  } catch (err) {
    // 상세 stderr는 서버 로그에만 남기고, 사용자에게는 짧은 메시지
    console.error('[probeMedia] ffprobe 실패 — file=%s\n%s', filePath, (err.stderr || err.message || '').toString().slice(0, 500));
    return {
      ok: false,
      code: 'PROBE_FAILED',
      message: '파일을 분석할 수 없습니다. 손상되었거나 지원하지 않는 형식일 수 있어요. mp4 / mov / m4a / mp3 파일로 다시 시도해주세요.',
    };
  }
}

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  if (ALLOWED_MIMES.has(mime) || ALLOWED_EXTS.has(ext)) {
    return cb(null, true);
  }
  cb(new Error(`지원하지 않는 파일 형식입니다. mp3 / m4a / mp4 / mov 만 허용됩니다. (받은 형식: ${mime || ext || '알 수 없음'})`));
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

    // 1) ffprobe 사전 검증 — 오디오 스트림 / duration
    const probe = await probeMedia(tmpPath);
    if (!probe.ok) {
      try { fs.unlinkSync(tmpPath); } catch (_e) { /* ignore */ }
      console.warn(`[업로드 거부] file=${originalFilename} code=${probe.code} reason=${probe.message}`);
      return res.status(400).json({
        success: false,
        code: probe.code,
        message: probe.message,
      });
    }

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

      console.log(`[업로드] jobId=${jobId} file=${originalFilename} → ${finalPath} (${probe.durationSec.toFixed(1)}s, ${probe.audioCodec}/${probe.channels}ch/${probe.sampleRate}Hz)`);
      res.status(201).json({
        success: true,
        data: {
          jobId,
          expiresAt,
          durationSec: probe.durationSec,
          audio: { codec: probe.audioCodec, channels: probe.channels, sampleRate: probe.sampleRate },
        },
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
// AssemblyAI 응답에서 사람이 읽을 수 있는 에러 메시지 추출
function describeAssemblyError(err, stage) {
  if (err.response) {
    const status = err.response.status;
    const data = err.response.data;
    const detail = (data && (data.error || data.message)) || JSON.stringify(data || {}).slice(0, 200);
    return `AssemblyAI ${stage} 실패 (HTTP ${status}): ${detail}`;
  }
  return `AssemblyAI ${stage} 실패: ${err.message}`;
}

async function uploadToAssemblyAI(filePath) {
  const stream = fs.createReadStream(filePath);
  let resp;
  try {
    resp = await axios.post('https://api.assemblyai.com/v2/upload', stream, {
      headers: {
        authorization: ASSEMBLYAI_API_KEY,
        'transfer-encoding': 'chunked',
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
  } catch (err) {
    throw new Error(describeAssemblyError(err, '오디오 업로드'));
  }
  if (!resp.data || !resp.data.upload_url) {
    throw new Error('AssemblyAI 업로드 응답에 upload_url이 없습니다.');
  }
  return resp.data.upload_url;
}

async function requestTranscript(audioUrl, opts = {}) {
  // speakers_expected: 정확히 알 때만 지정. 기본은 미지정 (자동 감지)
  // → 1~2명만 등장하는 영상에서 강제 3분할되는 문제 방지
  const body = {
    audio_url: audioUrl,
    speaker_labels: true,
    language_code: 'ko',
    speech_models: ASSEMBLYAI_SPEECH_MODELS,
  };
  if (Number.isInteger(opts.speakersExpected) && opts.speakersExpected >= 1 && opts.speakersExpected <= 10) {
    body.speakers_expected = opts.speakersExpected;
  }
  let resp;
  try {
    resp = await axios.post(
      'https://api.assemblyai.com/v2/transcript',
      body,
      { headers: { authorization: ASSEMBLYAI_API_KEY } }
    );
  } catch (err) {
    throw new Error(describeAssemblyError(err, 'transcript 요청'));
  }
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
    let resp;
    try {
      resp = await axios.get(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        { headers: { authorization: ASSEMBLYAI_API_KEY } }
      );
    } catch (err) {
      throw new Error(describeAssemblyError(err, '처리 상태 조회'));
    }
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

// AssemblyAI 전체 흐름 묶음 — upload → request → poll
//   opts.speakersExpected — 예상 화자 수 (정확하면 다이어라이제이션 정확도 큰 폭 ↑)
//   opts.preProcessAudio  — true면 ffmpeg로 denoise/EQ/normalize 한 임시 mp3를 만들어 업로드
//                            (작은 소리/짧은 발화 화자 검출에 도움)
async function runAssemblyAI(filePath, opts = {}) {
  if (!ASSEMBLYAI_API_KEY) return null;
  let analysisPath = filePath;
  let cleanup = null;
  try {
    if (opts.preProcessAudio !== false) {
      // 전처리 — 다이어라이제이션 정확도 향상용. 약하게(noise만 감쇠 + 약한 정규화).
      // 너무 강하게 처리하면 voice fingerprint가 손상돼 오히려 손해.
      const tmpDir = path.join(__dirname, 'tmp');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const tmpOut = path.join(tmpDir, `pre-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);
      try {
        await execFileP('ffmpeg', [
          '-y',
          '-i', filePath,
          '-vn',
          '-af', [
            'highpass=f=70',           // 럼블만 제거 (음성 fundamental은 유지)
            'afftdn=nr=8:nf=-25',      // 약한 denoise (음색 손상 최소화)
            'dynaudnorm=f=500:g=11',   // 작은 발화자 들리도록 적당히 정규화
          ].join(','),
          '-ac', '1',                  // 모노 (AssemblyAI는 모노 권장)
          '-ar', '16000',              // 16kHz (음성 인식엔 충분)
          '-codec:a', 'libmp3lame',
          '-b:a', '64k',
          tmpOut,
        ], { timeout: 5 * 60 * 1000 });
        analysisPath = tmpOut;
        cleanup = tmpOut;
        console.log(`[AssemblyAI 전처리] ${(fs.statSync(tmpOut).size / 1024).toFixed(0)}KB`);
      } catch (e) {
        console.warn('[AssemblyAI 전처리 실패, 원본으로 진행]:', e.message);
      }
    }
    const uploadUrl = await uploadToAssemblyAI(analysisPath);
    const transcriptId = await requestTranscript(uploadUrl, opts);
    return await pollTranscript(transcriptId);
  } finally {
    if (cleanup && fs.existsSync(cleanup)) {
      try { fs.unlinkSync(cleanup); } catch (_) {}
    }
  }
}

// 동영상/오디오 → Whisper용 압축 mp3 추출
// - 모노 16kHz 32kbps mp3 (음성 인식엔 충분)
// - 1분당 약 240KB → 25MB 한도 내에서 ~100분 가능
async function extractAudioForWhisper(inputPath) {
  const tmpDir = path.join(__dirname, 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const outPath = path.join(tmpDir, `whisper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`);

  await execFileP('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-vn',                    // 비디오 스트림 제거
    '-ac', '1',               // mono
    '-ar', '16000',           // 16kHz
    '-codec:a', 'libmp3lame',
    '-b:a', '32k',            // 32kbps (음성용 충분)
    outPath,
  ], { timeout: 5 * 60 * 1000 });

  return outPath;
}

// OpenAI Whisper API 호출 — 한국어 텍스트 정확도 + 문장 분할 + 단어 타임스탬프
async function runWhisper(filePath) {
  const key = (process.env.OPENAI_API_KEY || '').trim();
  if (!key) return null;

  // 1) 항상 ffmpeg로 mp3 추출 (동영상이든 오디오든) — 사이즈 작아지고 일관됨
  let audioPath = filePath;
  let cleanup = null;
  try {
    audioPath = await extractAudioForWhisper(filePath);
    cleanup = audioPath;
    const sz = fs.statSync(audioPath).size;
    console.log(`[Whisper] 오디오 추출 완료 — ${(sz / 1024).toFixed(0)}KB`);
  } catch (e) {
    console.warn('[Whisper] ffmpeg 추출 실패, 원본 그대로 사용:', e.message);
    audioPath = filePath;
  }

  try {
    // 2) 25MB 한도 (1시간짜리 모노 mp3 32kbps도 약 14MB라 거의 안 걸림)
    const stat = fs.statSync(audioPath);
    if (stat.size > 25 * 1024 * 1024) {
      console.warn(`[Whisper] 추출 후에도 25MB 초과 (${(stat.size / 1024 / 1024).toFixed(1)}MB) — Whisper 건너뜀`);
      return null;
    }

    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(audioPath)]), path.basename(audioPath));
    fd.append('model', 'whisper-1');
    fd.append('language', 'ko');
    fd.append('response_format', 'verbose_json');
    fd.append('timestamp_granularities[]', 'segment');
    fd.append('timestamp_granularities[]', 'word');

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`Whisper HTTP ${r.status}: ${txt.slice(0, 200)}`);
    }
    const json = await r.json();
    console.log(`[Whisper] 완료 — duration=${json.duration}s segments=${json.segments?.length || 0} words=${json.words?.length || 0}`);
    return json;
  } finally {
    // 임시파일 정리
    if (cleanup && fs.existsSync(cleanup)) {
      try { fs.unlinkSync(cleanup); } catch (e) {}
    }
  }
}

// 두 결과를 합치기:
// - 우선: Whisper segments(문장 단위) + 텍스트 + 단어 타임스탬프
// - 발화자: 같은 시간대 AssemblyAI 단어들의 다수결로 결정
// - Whisper만 있으면 모든 발화자를 'A'로 (사용자가 프리뷰에서 per-segment override)
// - AssemblyAI만 있으면 기존 동작과 동일
function mergeTranscripts(assemblyResult, whisperResult) {
  // 1) Whisper 데이터 없으면 → AssemblyAI fallback
  if (!whisperResult || !Array.isArray(whisperResult.segments) || whisperResult.segments.length === 0) {
    return normalizeUtterances(assemblyResult?.utterances || []);
  }

  // 2) AssemblyAI 단어들 펼치기 → 화자 라벨 매핑용
  const aaWords = [];
  if (assemblyResult && Array.isArray(assemblyResult.utterances)) {
    for (const u of assemblyResult.utterances) {
      const speaker = u.speaker || 'A';
      const ws = Array.isArray(u.words) ? u.words : [];
      for (const w of ws) {
        aaWords.push({
          start: (w.start ?? 0) / 1000,
          end: (w.end ?? 0) / 1000,
          speaker,
        });
      }
    }
  }

  // 3) Whisper segments → 우리 포맷으로 매핑
  return whisperResult.segments.map((seg, idx) => {
    const start = Number(seg.start ?? 0);
    const end = Number(seg.end ?? 0);
    // 이 segment 시간대에 들어간 AssemblyAI 단어들의 발화자 다수결
    const counts = {};
    for (const w of aaWords) {
      if (w.end >= start - 0.15 && w.start <= end + 0.15) {
        counts[w.speaker] = (counts[w.speaker] || 0) + 1;
      }
    }
    const speaker = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'A';

    // segment 안의 Whisper 단어들 (verbose_json의 .words는 전체 → 시간 범위로 필터)
    const segWords = (whisperResult.words || [])
      .filter((w) => Number(w.start) >= start - 0.05 && Number(w.end) <= end + 0.05)
      .map((w) => ({
        text: w.word || w.text || '',
        start: Number((w.start ?? 0).toFixed(3)),
        end: Number((w.end ?? 0).toFixed(3)),
      }));

    return {
      id: idx,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      text: (seg.text || '').trim(),
      speaker,
      words: segWords,
    };
  });
}

function normalizeUtterances(utterances) {
  if (!Array.isArray(utterances)) return [];
  return utterances.map((u, idx) => ({
    id: idx,
    start: Number(((u.start ?? 0) / 1000).toFixed(3)), // ms → sec
    end: Number(((u.end ?? 0) / 1000).toFixed(3)),
    text: u.text || '',
    speaker: u.speaker || 'A',
    // 단어별 타임스탬프 — 청크 분할 시 정확한 동기화용
    words: Array.isArray(u.words)
      ? u.words.map((w) => ({
          text: w.text || '',
          start: Number(((w.start ?? 0) / 1000).toFixed(3)),
          end: Number(((w.end ?? 0) / 1000).toFixed(3)),
        }))
      : [],
  }));
}

// POST /api/transcribe
//   body: { jobId, speakersExpected? (1~10), preProcessAudio? (default true) }
//   응답: { jobId, segments }
app.post('/api/transcribe', async (req, res) => {
  const { jobId, speakersExpected, preProcessAudio } = req.body || {};
  if (!jobId) {
    return res.status(400).json({ success: false, message: 'jobId가 필요합니다.' });
  }
  const opts = {};
  if (Number.isInteger(speakersExpected) && speakersExpected >= 1 && speakersExpected <= 10) {
    opts.speakersExpected = speakersExpected;
  }
  if (preProcessAudio === false) opts.preProcessAudio = false;
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

    // 3) AssemblyAI(발화자 라벨) + Whisper(텍스트·문장 분할) 병렬 실행
    console.log(`[전사] jobId=${jobId} speakersExpected=${opts.speakersExpected || 'auto'} preProcess=${opts.preProcessAudio !== false}`);
    const [assemblyResult, whisperResult] = await Promise.all([
      runAssemblyAI(job.upload_path, opts).catch((e) => {
        console.warn('[전사] AssemblyAI 실패:', e.message);
        return null;
      }),
      runWhisper(job.upload_path).catch((e) => {
        console.warn('[전사] Whisper 실패:', e.message);
        return null;
      }),
    ]);

    if (!assemblyResult && !whisperResult) {
      throw new Error('AssemblyAI / Whisper 둘 다 실패했습니다.');
    }

    // 4) 하이브리드 머지 — 가능하면 Whisper 텍스트·세그먼트 + AssemblyAI 발화자
    const segments = mergeTranscripts(assemblyResult, whisperResult);
    if (segments.length === 0) {
      console.warn(`[전사] jobId=${jobId} 결과 segments가 비어있습니다.`);
    }
    const speakerSet = new Set(segments.map((s) => s.speaker));
    const speakerCount = speakerSet.size;
    const audioDuration = Number(assemblyResult?.audio_duration) || (whisperResult?.duration ?? null);
    const confidence = Number(assemblyResult?.confidence) || null;

    // 4) DB 저장
    await pool.query(
      `UPDATE baby_cartoon.jobs SET segments = $1::jsonb, status = 'transcribed' WHERE id = $2`,
      [JSON.stringify(segments), jobId]
    );

    console.log(`[전사] jobId=${jobId} 완료 — segments=${segments.length}개 / 화자=${speakerCount}명 / duration=${audioDuration}s / confidence=${confidence}`);
    res.json({
      success: true,
      data: {
        jobId,
        segments,
        speakerCount,
        speakers: [...speakerSet].sort(),
        audioDurationSec: audioDuration,
        confidence,
      },
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
// 7-1) 업로드 오디오 스트리밍 — 브라우저 미리보기용
//   GET /api/jobs/:id/audio
//   - Range 요청 지원 (Express static과 동일하게 res.sendFile이 처리)
//   - 만료된 job은 410, 없으면 404
// =====================================================================
const AUDIO_MIME_BY_EXT = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

app.get('/api/jobs/:id/audio', async (req, res) => {
  const { id } = req.params;
  // UUID 형식만 허용 (간단 검사)
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ success: false, message: '잘못된 jobId 형식입니다.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, upload_path, expires_at FROM baby_cartoon.jobs WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '작업을 찾을 수 없습니다.' });
    }
    const job = rows[0];
    if (new Date(job.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ success: false, message: '작업이 만료되었습니다.' });
    }
    if (!job.upload_path || !fs.existsSync(job.upload_path)) {
      return res.status(404).json({ success: false, message: '파일이 삭제되었거나 찾을 수 없습니다.' });
    }
    // upload_path가 UPLOAD_DIR 바깥을 가리키는 일이 없도록 검사 (방어)
    const resolved = path.resolve(job.upload_path);
    if (!resolved.startsWith(path.resolve(UPLOAD_DIR))) {
      return res.status(400).json({ success: false, message: '경로가 올바르지 않습니다.' });
    }
    const ext = path.extname(resolved).toLowerCase();
    const mime = AUDIO_MIME_BY_EXT[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.sendFile(resolved);
  } catch (err) {
    console.error('[오디오 스트리밍 오류]', err.message);
    res.status(500).json({ success: false, message: '오디오를 불러올 수 없습니다.' });
  }
});

// =====================================================================
// 7-1.5) 튠된 오디오 — 화자별 음량 정규화 + 명료화 + 라우드니스 -14 LUFS
//   GET /api/jobs/:id/audio-tuned
//
//   파이프라인 (segments 있을 때):
//     0) 화자별 RMS 측정 (volumedetect로 발화자 ranges만 분석)
//     1) 화자별 makeup gain — 작게 들리는 화자는 +N dB, 크게 들리는 화자는 -N dB → 모든 사람 동일 데시벨
//     2) highpass 80Hz   — 저주파 럼블 제거
//     3) afftdn          — 정상상태 노이즈 감쇠
//     4) compand         — 음성 다이내믹 압축
//     5) equalizer 2.5kHz +3dB / 200Hz -2dB — 자음 명료/저음 정리
//     6) dynaudnorm      — 동적 정규화 (남은 음량 편차 보정)
//     7) loudnorm I=-14  — YouTube/Reels 표준 최종 라우드니스
//
//   캐시: outputs/tuned-{jobId}-{segHash}.mp3 — segments 바뀌면 새 파일
// =====================================================================
const crypto = require('crypto');

function hashSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return 'nosegs';
  const compact = segments.map((s) => [
    Number((s.start || 0).toFixed(2)),
    Number((s.end || 0).toFixed(2)),
    s.speaker || '?',
  ]);
  return crypto.createHash('md5').update(JSON.stringify(compact)).digest('hex').slice(0, 10);
}

// 화자별 발화 구간 합치기 — 너무 짧은 segment는 제외
function groupRangesBySpeaker(segments) {
  const map = {};
  for (const s of segments || []) {
    if (!s || !s.speaker) continue;
    const dur = (s.end ?? 0) - (s.start ?? 0);
    if (dur < 0.2) continue; // 0.2초 미만은 측정 신뢰도 낮아 제외
    if (!map[s.speaker]) map[s.speaker] = [];
    map[s.speaker].push([s.start, s.end]);
  }
  return map;
}

// 특정 시간 범위들의 mean_volume(dB) 측정 — ffmpeg volumedetect
async function measureMeanVolume(srcPath, ranges) {
  if (!ranges || ranges.length === 0) return null;
  // aselect로 해당 범위만 골라낸 뒤 volumedetect
  const selectExpr = ranges.map(([s, e]) => `between(t,${s.toFixed(3)},${e.toFixed(3)})`).join('+');
  try {
    const { stderr } = await execFileP('ffmpeg', [
      '-i', srcPath,
      '-vn',
      '-af', `aselect='${selectExpr}',asetpts=N/SR/TB,volumedetect`,
      '-f', 'null',
      '-',
    ], { timeout: 60 * 1000, maxBuffer: 10 * 1024 * 1024 });
    const m = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
    return m ? parseFloat(m[1]) : null;
  } catch (e) {
    console.warn('[volumedetect 실패]', e.message);
    return null;
  }
}

// 한 segment 가 너무 길게 이어지면 enable 식이 거대해져 ffmpeg 오류 → 합치기로 압축
function mergeAdjacentRanges(ranges, gap = 0.3) {
  if (!ranges || ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out = [sorted[0].slice()];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i][0] - last[1] <= gap) {
      last[1] = Math.max(last[1], sorted[i][1]);
    } else {
      out.push(sorted[i].slice());
    }
  }
  return out;
}

// 침묵 구간 자르기 계획 — segments 기반으로 keep ranges 생성 + 새 타임스탬프 매핑
//   maxGap: 발화 사이 최대 허용 침묵 (초). 그 이상은 잘라냄.
//   padding: 각 segment 앞뒤로 살릴 여유 시간 (초) — 자른 자리에서 첫음·끝음이 잘리지 않게.
//   leadTrim: 첫 발화 전 침묵도 maxGap까지만 허용.
function buildTrimPlan(segments, options = {}) {
  const maxGap = options.maxGap ?? 0.3;
  const padding = options.padding ?? 0.08;
  const leadTrim = options.leadTrim ?? true;

  if (!Array.isArray(segments) || segments.length === 0) return null;
  const sorted = [...segments].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

  // 1) padding 입힌 발화 범위들 — 인접/중첩 합치기
  const speechRanges = [];
  for (const seg of sorted) {
    const start = Math.max(0, (seg.start ?? 0) - padding);
    const end = (seg.end ?? 0) + padding;
    if (speechRanges.length && start <= speechRanges[speechRanges.length - 1].end) {
      const last = speechRanges[speechRanges.length - 1];
      last.end = Math.max(last.end, end);
    } else {
      speechRanges.push({ start, end });
    }
  }

  // 2) keep ranges — 발화 + 잘라낸 짧은 갭
  const keepRanges = [];
  // 앞부분 침묵 처리
  if (leadTrim && speechRanges[0].start > maxGap) {
    keepRanges.push({ from: speechRanges[0].start - maxGap, to: speechRanges[0].start });
  } else if (speechRanges[0].start > 0) {
    keepRanges.push({ from: 0, to: speechRanges[0].start });
  }
  // 발화 + 갭 반복
  for (let i = 0; i < speechRanges.length; i++) {
    keepRanges.push({ from: speechRanges[i].start, to: speechRanges[i].end });
    if (i < speechRanges.length - 1) {
      const gap = speechRanges[i + 1].start - speechRanges[i].end;
      const truncated = Math.min(gap, maxGap);
      if (truncated > 0.001) {
        keepRanges.push({ from: speechRanges[i].end, to: speechRanges[i].end + truncated });
      }
    }
  }

  // 3) 각 keep range의 누적 offset 계산 (그 이전에 잘려나간 시간 합)
  let cumOffset = 0;
  let prevOrigEnd = 0;
  const krWithOffset = [];
  for (const kr of keepRanges) {
    if (kr.from > prevOrigEnd) cumOffset += kr.from - prevOrigEnd;
    krWithOffset.push({ ...kr, offset: cumOffset });
    prevOrigEnd = kr.to;
  }
  const totalNewDuration = prevOrigEnd - cumOffset;
  const totalOrigDuration = prevOrigEnd; // approx
  const savedSec = cumOffset;

  // 4) 시간 매핑 함수 — 원본 t → 새 timeline t
  const mapTime = (t) => {
    for (const kr of krWithOffset) {
      if (t >= kr.from && t <= kr.to) {
        return Math.max(0, t - kr.offset);
      }
    }
    // 잘려나간 갭에 들어간 t — 인접한 keep range로 스냅
    let nearest = krWithOffset[0];
    let minDist = Math.min(Math.abs(t - nearest.from), Math.abs(t - nearest.to));
    for (const kr of krWithOffset) {
      const d = Math.min(Math.abs(t - kr.from), Math.abs(t - kr.to));
      if (d < minDist) { minDist = d; nearest = kr; }
    }
    if (t < nearest.from) return Math.max(0, nearest.from - nearest.offset);
    return Math.max(0, nearest.to - nearest.offset);
  };

  // 5) 새 segments 생성
  const newSegments = sorted.map((seg, idx) => ({
    ...seg,
    id: idx,
    start: Number(mapTime(seg.start ?? 0).toFixed(3)),
    end:   Number(mapTime(seg.end ?? 0).toFixed(3)),
    words: Array.isArray(seg.words)
      ? seg.words.map((w) => ({
          text: w.text || '',
          start: Number(mapTime(w.start ?? 0).toFixed(3)),
          end:   Number(mapTime(w.end ?? 0).toFixed(3)),
        }))
      : [],
  }));

  // 6) ffmpeg aselect 표현식 — 너무 길면 ffmpeg 한도 초과. CHUNK 단위로 처리
  const exprs = keepRanges.map((kr) => `between(t,${kr.from.toFixed(3)},${kr.to.toFixed(3)})`);
  const selectExpr = exprs.join('+');

  return {
    keepRanges,
    krWithOffset,
    selectExpr,
    newSegments,
    totalNewDuration: Number(totalNewDuration.toFixed(3)),
    totalOrigDuration: Number(totalOrigDuration.toFixed(3)),
    savedSec: Number(savedSec.toFixed(3)),
  };
}

async function ensureTunedAudio(jobId, srcPath, segments, options = {}) {
  const compact = !!options.compact;
  const maxGap = options.maxGap ?? 0.3;
  const segHash = hashSegments(segments);
  const compactSuffix = compact ? `-c${(maxGap * 100).toFixed(0)}` : '';
  const outPath = path.join(OUTPUT_DIR, `tuned-${jobId}-${segHash}${compactSuffix}.mp3`);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
    return outPath;
  }

  // 1) 화자별 RMS 측정 → 게인 계산 (원본 타임라인 기준)
  const TARGET_DB = -22;
  const speakerGainStages = [];
  if (Array.isArray(segments) && segments.length > 0) {
    const grouped = groupRangesBySpeaker(segments);
    for (const [speaker, ranges] of Object.entries(grouped)) {
      const merged = mergeAdjacentRanges(ranges);
      const meanDb = await measureMeanVolume(srcPath, merged);
      if (meanDb == null) continue;
      const rawGain = TARGET_DB - meanDb;
      const gain = Math.max(-15, Math.min(15, rawGain));
      const CHUNK = 120;
      for (let i = 0; i < merged.length; i += CHUNK) {
        const chunk = merged.slice(i, i + CHUNK);
        const exp = chunk.map(([s, e]) => `between(t,${s.toFixed(3)},${e.toFixed(3)})`).join('+');
        speakerGainStages.push(`volume=enable='${exp}':volume=${gain.toFixed(2)}dB`);
      }
      console.log(`[튠] 화자 ${speaker} mean=${meanDb.toFixed(1)}dB → gain=${gain.toFixed(2)}dB (ranges=${merged.length})`);
    }
  } else {
    console.log('[튠] segments 없음 → 단순 정규화만 적용');
  }

  // 2) 침묵 자르기 — 화자 게인 다음에 aselect (게인은 원본 타임라인에서 적용되어야 함)
  let trimStages = [];
  if (compact) {
    const plan = buildTrimPlan(segments, { maxGap });
    if (plan && plan.selectExpr) {
      trimStages.push(`aselect='${plan.selectExpr}'`);
      trimStages.push('asetpts=N/SR/TB'); // PTS 재정렬 — 잘라낸 자리의 시간 연속성
      console.log(`[튠 compact] 원본 ${plan.totalOrigDuration}s → ${plan.totalNewDuration}s (${plan.savedSec.toFixed(1)}s 단축)`);
    }
  }

  // 2-pass loudnorm — 정확히 -14 LUFS에 맞추려면 측정(1차) 후 보정(2차) 필요.
  //   1차: print_format=json 으로 stderr에 측정값 출력 (input_i, input_tp, input_lra, input_thresh, target_offset)
  //   2차: 측정값을 measured_* 파라미터로 넘기고 linear=true 모드로 정확한 게인 적용
  //   처리 시간 약 1.7~2배 늘지만 결과 LUFS가 ±0.1 이내로 정밀
  const baseFilters = [
    ...speakerGainStages,
    ...trimStages,
    'highpass=f=80',
    'lowpass=f=12000',
    'afftdn=nr=12:nf=-25',
    'compand=attacks=0.05:decays=0.4:points=-80/-80|-50/-15|-30/-9|-10/-5|0/-3',
    'equalizer=f=2500:t=q:w=1.2:g=3',
    'equalizer=f=200:t=q:w=1.0:g=-2',
    'dynaudnorm=f=300:g=15:p=0.95',
  ];
  const TARGET_I = -14, TARGET_TP = -1.5, TARGET_LRA = 11;

  // 1차 측정 — null output으로 빠르게 (오디오는 분석만)
  let measured = null;
  try {
    const pass1AfChain = [
      ...baseFilters,
      `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}:print_format=json`,
    ].join(',');
    const { stderr } = await execFileP('ffmpeg', [
      '-i', srcPath,
      '-vn',
      '-af', pass1AfChain,
      '-f', 'null',
      '-',
    ], { timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 });
    // loudnorm은 stderr 끝에 JSON 블록을 찍어줌
    const match = stderr.match(/\{\s*"input_i"[\s\S]*?\}/);
    if (match) {
      const m = JSON.parse(match[0]);
      // 측정값이 -70 LUFS 같은 비정상이면 무시 (무음/너무 짧음)
      if (m.input_i && parseFloat(m.input_i) > -70) {
        measured = m;
        console.log(`[튠] 1차 측정: I=${m.input_i} TP=${m.input_tp} LRA=${m.input_lra} thresh=${m.input_thresh} offset=${m.target_offset}`);
      }
    }
    if (!measured) console.warn('[튠] 1차 측정 결과 파싱 실패 → 단일 패스로 fallback');
  } catch (e) {
    console.warn('[튠] 1차 측정 실패, 단일 패스로 fallback:', e.message);
  }

  // 2차 — 측정값 있으면 linear=true 정밀 모드, 없으면 fallback 단일 패스
  const finalLoudnorm = measured
    ? `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset || 0}:linear=true:print_format=summary`
    : `loudnorm=I=${TARGET_I}:TP=${TARGET_TP}:LRA=${TARGET_LRA}`;

  const filterChain = [...baseFilters, finalLoudnorm].join(',');

  await execFileP('ffmpeg', [
    '-y',
    '-i', srcPath,
    '-vn',
    '-af', filterChain,
    '-ac', '2',
    '-ar', '44100',
    '-codec:a', 'libmp3lame',
    '-b:a', '192k',
    outPath,
  ], { timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 });

  return outPath;
}

// 오래된 튠 파일 정리 — 새 segments로 다시 튠하면 옛 파일 잔존
function cleanupOldTunedFiles(jobId, exceptPath) {
  try {
    const files = fs.readdirSync(OUTPUT_DIR).filter((f) => f.startsWith(`tuned-${jobId}-`) && f.endsWith('.mp3'));
    for (const f of files) {
      const p = path.join(OUTPUT_DIR, f);
      if (p !== exceptPath) {
        try { fs.unlinkSync(p); } catch (_) {}
      }
    }
  } catch (_) {}
}

app.get('/api/jobs/:id/audio-tuned', async (req, res) => {
  const { id } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ success: false, message: '잘못된 jobId 형식입니다.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, upload_path, expires_at, segments FROM baby_cartoon.jobs WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '작업을 찾을 수 없습니다.' });
    }
    const job = rows[0];
    if (new Date(job.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ success: false, message: '작업이 만료되었습니다.' });
    }
    if (!job.upload_path || !fs.existsSync(job.upload_path)) {
      return res.status(404).json({ success: false, message: '원본 파일이 없습니다.' });
    }
    const resolved = path.resolve(job.upload_path);
    if (!resolved.startsWith(path.resolve(UPLOAD_DIR))) {
      return res.status(400).json({ success: false, message: '경로가 올바르지 않습니다.' });
    }

    const segments = Array.isArray(job.segments) ? job.segments : null;
    const compact = req.query.compact === '1';
    const maxGap = Math.max(0.05, Math.min(2, parseFloat(req.query.maxGap) || 0.3));
    const tunedPath = await ensureTunedAudio(id, resolved, segments, { compact, maxGap });
    cleanupOldTunedFiles(id, tunedPath);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (req.query.download === '1') {
      const tag = compact ? `-compact-${maxGap.toFixed(2)}` : '';
      res.setHeader('Content-Disposition', `attachment; filename="tuned-${id.slice(0, 8)}${tag}.mp3"`);
    }
    return res.sendFile(tunedPath);
  } catch (err) {
    console.error('[튠 오디오 오류]', err.message);
    res.status(500).json({ success: false, message: `오디오 튜닝에 실패했습니다: ${err.message}` });
  }
});

// =====================================================================
// 7-1.6) 침묵 자르기 정보 — segments 기반 trim plan 미리 계산해서 반환
//   GET /api/jobs/:id/compact-info?maxGap=0.3
//   → { ok: true, segments: [...새 타임스탬프...], totalNewDuration, totalOrigDuration, savedSec }
//   클라이언트는 이걸 받아서 자막용 segments를 갈아끼우고, 영상 src도 ?compact=1로 변경.
// =====================================================================
app.get('/api/jobs/:id/compact-info', async (req, res) => {
  const { id } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ success: false, message: '잘못된 jobId 형식입니다.' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT segments FROM baby_cartoon.jobs WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '작업을 찾을 수 없습니다.' });
    }
    const segments = Array.isArray(rows[0].segments) ? rows[0].segments : [];
    if (segments.length === 0) {
      return res.json({ ok: false, message: '아직 자막이 분석되지 않았습니다.' });
    }
    const maxGap = Math.max(0.05, Math.min(2, parseFloat(req.query.maxGap) || 0.3));
    const plan = buildTrimPlan(segments, { maxGap });
    if (!plan) {
      return res.json({ ok: false, message: '잘라낼 침묵 구간이 없습니다.' });
    }
    return res.json({
      ok: true,
      segments: plan.newSegments,
      totalNewDuration: plan.totalNewDuration,
      totalOrigDuration: plan.totalOrigDuration,
      savedSec: plan.savedSec,
      maxGap,
    });
  } catch (err) {
    console.error('[compact-info 오류]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// =====================================================================
// 7-2) 매핑 저장 (Day 3)
//   PATCH /api/jobs/:id
//   body: { roleMapping?: {A,B,C → dad/mom/baby}, characterMapping?: {dad/mom/baby → "dad-1" 등} }
// =====================================================================
const ROLE_KEYS = new Set(['dad', 'mom', 'baby']);
const SPEAKER_KEYS = new Set(['A', 'B', 'C']);
const CHARACTER_ID_RE = /^(dad|mom|baby)-[1-5]$/;

function validateRoleMapping(rm) {
  if (rm === undefined) return null;
  if (!rm || typeof rm !== 'object' || Array.isArray(rm)) {
    return 'roleMapping은 객체여야 합니다.';
  }
  const used = [];
  for (const [k, v] of Object.entries(rm)) {
    if (!SPEAKER_KEYS.has(k)) return `roleMapping의 화자 키는 A/B/C 중 하나여야 합니다. (받은 값: ${k})`;
    if (v == null) continue;
    if (!ROLE_KEYS.has(v)) return `roleMapping의 역할은 dad/mom/baby 중 하나여야 합니다. (받은 값: ${v})`;
    used.push(v);
  }
  if (used.length !== new Set(used).size) {
    return '같은 역할(dad/mom/baby)을 두 명 이상에게 매길 수 없습니다.';
  }
  return null;
}

function validateCharacterMapping(cm) {
  if (cm === undefined) return null;
  if (!cm || typeof cm !== 'object' || Array.isArray(cm)) {
    return 'characterMapping은 객체여야 합니다.';
  }
  for (const [k, v] of Object.entries(cm)) {
    if (!ROLE_KEYS.has(k)) return `characterMapping의 역할 키는 dad/mom/baby 중 하나여야 합니다. (받은 값: ${k})`;
    if (v == null) continue;
    if (typeof v !== 'string' || !CHARACTER_ID_RE.test(v)) {
      return `characterMapping의 캐릭터 id 형식이 올바르지 않습니다. 예: "dad-1". (받은 값: ${v})`;
    }
    const expectedRole = v.split('-')[0];
    if (expectedRole !== k) {
      return `characterMapping에서 역할 "${k}"에 "${v}" 캐릭터를 지정할 수 없습니다.`;
    }
  }
  return null;
}

const VALID_STYLES = new Set(['current', 'stickman', 'disney', 'webtoon', 'chimchak']);

app.patch('/api/jobs/:id', async (req, res) => {
  const { id } = req.params;
  const { roleMapping, characterMapping, characterStyle } = req.body || {};

  if (roleMapping === undefined && characterMapping === undefined && characterStyle === undefined) {
    return res.status(400).json({ success: false, message: 'roleMapping, characterMapping, characterStyle 중 최소 하나는 필요합니다.' });
  }

  const rmErr = validateRoleMapping(roleMapping);
  if (rmErr) return res.status(400).json({ success: false, message: rmErr });
  const cmErr = validateCharacterMapping(characterMapping);
  if (cmErr) return res.status(400).json({ success: false, message: cmErr });
  if (characterStyle !== undefined && !VALID_STYLES.has(characterStyle)) {
    return res.status(400).json({ success: false, message: `characterStyle은 ${[...VALID_STYLES].join('/')} 중 하나여야 합니다.` });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, expires_at FROM baby_cartoon.jobs WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: '해당 jobId의 작업을 찾을 수 없습니다.' });
    }
    if (new Date(rows[0].expires_at).getTime() < Date.now()) {
      return res.status(410).json({ success: false, message: '작업이 만료되었습니다. 다시 업로드해주세요.' });
    }

    const sets = [];
    const params = [];
    let i = 1;
    if (roleMapping !== undefined) {
      sets.push(`role_mapping = $${i++}::jsonb`);
      params.push(JSON.stringify(roleMapping));
    }
    if (characterMapping !== undefined) {
      sets.push(`character_mapping = $${i++}::jsonb`);
      params.push(JSON.stringify(characterMapping));
    }
    // characterStyle을 character_mapping JSONB 안에 { style: '...' } 형태로 저장
    if (characterStyle !== undefined) {
      sets.push(`character_mapping = $${i++}::jsonb`);
      params.push(JSON.stringify({ style: characterStyle }));
    }
    params.push(id);

    const updateSql = `
      UPDATE baby_cartoon.jobs
      SET ${sets.join(', ')}
      WHERE id = $${i}
      RETURNING id, role_mapping, character_mapping, status
    `;
    const result = await pool.query(updateSql, params);
    const job = result.rows[0];

    console.log(`[매핑] jobId=${id} roleMapping=${roleMapping ? '저장' : '-'} characterStyle=${characterStyle || (characterMapping ? '(legacy)' : '-')}`);
    res.json({
      success: true,
      data: {
        jobId: job.id,
        roleMapping: job.role_mapping,
        characterMapping: job.character_mapping,
        status: job.status,
      },
    });
  } catch (err) {
    console.error(`[매핑 실패] jobId=${id}`, err.message);
    res.status(500).json({ success: false, message: '매핑 정보를 저장하는 중 오류가 발생했습니다.' });
  }
});

// =====================================================================
// 7.5) 자막 번역 — 한글 → 영문 (Anthropic Claude haiku, 한 번에 일괄 번역)
// =====================================================================
app.post('/api/translate', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) {
      return res.json({ success: true, translations: {} });
    }

    const anthKey = (process.env.ANTHROPIC_API_KEY || '').trim();
    const openaiKey = (process.env.OPENAI_API_KEY || '').trim();
    if (!anthKey && !openaiKey) {
      return res.status(500).json({ success: false, message: '번역 API 키가 설정되지 않았습니다. .env에 ANTHROPIC_API_KEY 또는 OPENAI_API_KEY를 추가하세요.' });
    }

    // 부모-아기 대화 자막 톤 — SNS 자막 스타일로 자연스럽게
    // 입력 JSON: [{ n, text, speaker, role, prev, next }]
    //   role = 'dad' | 'mom' | 'baby' | null
    //   prev/next = 시간상 인접 발화 (동음이의어 분별용)
    const userPayload = JSON.stringify(items.map((it, i) => ({
      n: i + 1,
      text: (it.text || '').trim(),
      role: it.role || null,
      prev: (it.prev || '').trim() || null,
      next: (it.next || '').trim() || null,
    })));

    const sys = [
      'You are a professional Korean→English subtitle translator for parent-baby dialogue videos on social media.',
      '',
      'INPUT: JSON array. Each item has: n (line number), text (Korean), role ("dad"|"mom"|"baby"|null), prev (previous line for context), next (next line for context).',
      '',
      'CRITICAL — Korean homonym traps to actively disambiguate using role/prev/next:',
      '- "탈 수 있다" (can ride) vs "탈수" (dehydration) — sound identical without spaces. Use surrounding context (vehicle/transport vs medical).',
      '- "다운" (feeling down) vs "다운" (download) — use speaker role and tone.',
      '- "기분" can be feeling/mood. "기분다운" likely means "in a down mood" from a baby/child sulking, NOT a question.',
      '- "어" / "응" / "으응" from BABY role is usually a sulky/affirmative sound, NOT a question — translate as the baby vocalizing, not the parent asking.',
      '- Particle endings (-요/-네/-지) and ambiguous syllable boundaries: always reconstruct meaning from prev/next.',
      '',
      'SPEAKER ATTRIBUTION:',
      '- A line spoken by BABY must read like a baby speaking (babble, simple words, sulky sounds), NOT like a parent asking the baby a question.',
      '- A line spoken by DAD or MOM addressing the baby reads like adult speech.',
      '- If role is "baby" and text looks like a question, it is almost certainly an EXCLAMATION or sulky vocalization — translate accordingly.',
      '',
      'STYLE:',
      '- One short English subtitle per item. Punchy, conversational, NOT prose.',
      '- For baby babbling/onomatopoeia (응애 / 옹알옹알 / 꺄르륵 / 으응): use natural English (Waaah / Goo-goo ga-ga / Giggle giggle / Hmph).',
      '- Preserve warm/playful family tone.',
      '',
      'PROCESS (do this internally, do NOT output it):',
      '1. For each item, identify the speaker role and check prev/next.',
      '2. Re-check any homonym candidates (especially "탈수", "다운", short syllable runs).',
      '3. Verify the translation matches who is speaking — baby cannot ask an adult-style question.',
      '4. Self-review: does the English line make sense given prev → this → next as a single conversation flow?',
      '',
      `OUTPUT: Exactly ${items.length} lines of plain English, one per input, in the same n-order. No numbering, no quotes, no JSON, no commentary. Just the ${items.length} subtitle lines separated by newlines.`,
    ].join('\n');

    let raw = '';
    if (anthKey) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          system: sys,
          messages: [{ role: 'user', content: userPayload }],
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        console.warn(`[translate] Anthropic ${resp.status}: ${txt.slice(0, 200)}`);
        return res.status(502).json({ success: false, message: '번역 API 호출 실패 (Claude)' });
      }
      const data = await resp.json();
      raw = Array.isArray(data?.content) ? data.content.map(c => c.text || '').join('') : '';
    } else {
      // OpenAI fallback — 동음이의어 분별 위해 gpt-4o + temp 0.2 (보수적)
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          temperature: 0.2,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: userPayload },
          ],
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        console.warn(`[translate] OpenAI ${resp.status}: ${txt.slice(0, 200)}`);
        return res.status(502).json({ success: false, message: '번역 API 호출 실패 (OpenAI)' });
      }
      const data = await resp.json();
      raw = data?.choices?.[0]?.message?.content || '';
    }

    const lines = raw
      .split('\n')
      .map(l => l.replace(/^\s*\d+[\.\)]\s*/, '').trim())
      .filter(Boolean);

    const translations = {};
    for (let i = 0; i < items.length; i++) {
      const en = lines[i] || '';
      if (en) translations[items[i].id] = en;
    }
    res.json({ success: true, translations });
  } catch (err) {
    console.error('[translate] 오류:', err.message);
    res.status(500).json({ success: false, message: '번역 중 오류가 발생했습니다.' });
  }
});

// 단일 텍스트 번역 — 제목/부제목 1줄 번역 전용
app.post('/api/translate-one', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.json({ success: true, translation: '' });
    const anthKey = (process.env.ANTHROPIC_API_KEY || '').trim();
    const openaiKey = (process.env.OPENAI_API_KEY || '').trim();
    if (!anthKey && !openaiKey) {
      return res.status(500).json({ success: false, message: '번역 API 키가 설정되지 않았습니다.' });
    }
    const sys = 'Translate the Korean line into ONE short, punchy English line suitable for a SNS video caption. Output ONLY the English line, no quotes, no commentary.';
    let raw = '';
    if (anthKey) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 120,
          system: sys,
          messages: [{ role: 'user', content: text }],
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        console.warn(`[translate-one] Anthropic ${resp.status}: ${txt.slice(0, 200)}`);
        return res.status(502).json({ success: false, message: '번역 API 호출 실패 (Claude)' });
      }
      const data = await resp.json();
      raw = Array.isArray(data?.content) ? data.content.map(c => c.text || '').join('') : '';
    } else {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          temperature: 0.2,
          messages: [{ role: 'system', content: sys }, { role: 'user', content: text }],
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        console.warn(`[translate-one] OpenAI ${resp.status}: ${txt.slice(0, 200)}`);
        return res.status(502).json({ success: false, message: '번역 API 호출 실패 (OpenAI)' });
      }
      const data = await resp.json();
      raw = data?.choices?.[0]?.message?.content || '';
    }
    const translation = raw.split('\n').map(l => l.trim()).find(Boolean) || '';
    res.json({ success: true, translation });
  } catch (err) {
    console.error('[translate-one] 오류:', err.message);
    res.status(500).json({ success: false, message: '번역 중 오류가 발생했습니다.' });
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
  // Railway/Render 등 컨테이너 호스트는 0.0.0.0 바인딩 필요 (localhost만 listen하면 헬스체크 실패)
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Soft Studio — server up on port ${PORT} (BASE_URL=${BASE_URL})`);
    console.log(`  uploads/  → ${UPLOAD_DIR}`);
    console.log(`  outputs/  → ${OUTPUT_DIR}`);
    console.log(`  public/   → ${PUBLIC_DIR}`);
  });
})();

module.exports = app;
