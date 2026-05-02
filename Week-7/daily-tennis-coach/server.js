/**
 * 데일리테니스 자세분석 앱 — server.js (매장 PC 로컬 운영판)
 *
 * 운영 가정:
 *  - 매장 PC에서 `node server.js`로 직접 띄움 (포트 3000)
 *  - 손님 폰은 같은 LAN(매장 와이파이)에서 PC LAN IP로 접속
 *  - 영상 저장은 로컬 디스크(./uploads), 메타데이터는 메모리(Map)
 *  - PC 재시작 시 세션은 모두 사라지며, 그것이 의도된 동작
 *
 * 흐름:
 *   [PC 모니터]      ─ /api/store-token         ─→  지속형 QR (매장 토큰)
 *   [손님 폰]   QR → /upload?token=...
 *                    POST /api/sessions { token } → sessionId 발급
 *                    POST /api/sessions/:id/upload (multipart) → uploads/<id>.<ext>
 *   [PC]             GET /api/queue/next → uploaded → analyzing 전이
 *                    (브라우저에서 MediaPipe + Canvas + MediaRecorder로 합성 영상 생성)
 *                    POST /api/sessions/:id/result-video (multipart, webm)
 *                    → ffmpeg가 webm을 mp4 + mov로 변환 (60초 timeout)
 *                    POST /api/sessions/:id/complete
 *   [손님 폰]   /d/:id     → HTML 안내 페이지 (.mov 다운로드 + Files→Photos 가이드)
 *               /d/:id/raw → Content-Disposition attachment 강제 다운로드
 */

const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const app = express();
const PORT = parseInt((process.env.PORT || '3000').trim(), 10);

// ────────────────────────────────────────────────────────────────────────────
// 디렉토리 / 정적 자원 / 업로드 한도
// ────────────────────────────────────────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;        // 300MB (모바일 raw 영상)
const MAX_RESULT_VIDEO_BYTES = 100 * 1024 * 1024;  // 100MB (PC 합성 영상)

// ────────────────────────────────────────────────────────────────────────────
// In-memory 세션 저장
//   sessions: Map<sessionId, Session>
//   Session = {
//     id, status, storeToken,
//     videoFilename, videoMime,
//     resultVideoFilename, resultVideoMime, resultVideoExt,
//     failReason, downloadCount, pcId,
//     createdAt, expiresAt, uploadedAt, pickedUpAt, completedAt, failedAt,
//     resultVideoUploadedAt
//   }
// ────────────────────────────────────────────────────────────────────────────
const sessions = new Map();

function isExpired(session) {
  if (!session || !session.expiresAt) return false;
  return new Date(session.expiresAt).getTime() < Date.now();
}

// ────────────────────────────────────────────────────────────────────────────
// Store Token (in-memory)
//   - PC가 매장 모니터에 표시하는 지속형 QR의 토큰
//   - 만료 시 새 토큰 자동 발급 (rotate)
// ────────────────────────────────────────────────────────────────────────────
const STORE_TOKEN_TTL_DAYS = parseFloat((process.env.STORE_TOKEN_TTL_DAYS || '2').trim());
const STORE_TOKEN_TTL_MS = STORE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

let currentToken = null; // { value, issuedAt: Date, expiresAt: Date }

function ensureFreshToken() {
  const now = new Date();
  if (currentToken && currentToken.expiresAt.getTime() > now.getTime()) {
    return currentToken;
  }
  const value = crypto.randomBytes(8).toString('hex');
  const expiresAt = new Date(now.getTime() + STORE_TOKEN_TTL_MS);
  currentToken = { value, issuedAt: now, expiresAt };
  console.log(`[token] 새 store token 발급 → ${value} (만료: ${expiresAt.toISOString()})`);
  return currentToken;
}

// ────────────────────────────────────────────────────────────────────────────
// LAN IP 자동 탐지
// ────────────────────────────────────────────────────────────────────────────
function detectLanIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (
          iface.address.startsWith('192.168.') ||
          iface.address.startsWith('10.') ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(iface.address)
        ) {
          return iface.address;
        }
      }
    }
  }
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

const LAN_IP = detectLanIP();

// 호스트 결정 — 외부 host(예: Cloudflare Tunnel)는 그대로, localhost만 LAN IP 치환
function buildPublicHost(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString();
  const rawHost = (req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).toString();
  const [hostname, port] = rawHost.split(':');
  const isLocal =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1';
  const finalHost = isLocal ? `${LAN_IP}:${port || PORT}` : rawHost;
  return `${proto}://${finalHost}`;
}

// ────────────────────────────────────────────────────────────────────────────
// MIME ↔ 확장자 헬퍼
// ────────────────────────────────────────────────────────────────────────────
function mimetypeToExt(mimetype) {
  if (!mimetype) return null;
  const map = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/x-matroska': 'mkv',
    'video/webm': 'webm',
    'video/3gpp': '3gp',
  };
  return map[mimetype] || null;
}

// ────────────────────────────────────────────────────────────────────────────
// ffmpeg 가용성 체크 + webm → mp4 / mp4 → mov 변환
// ────────────────────────────────────────────────────────────────────────────
const FFMPEG_PATH = (process.env.FFMPEG_PATH || 'ffmpeg').trim();
const FFMPEG_TIMEOUT_MS = 60 * 1000;

let FFMPEG_AVAILABLE = false;
let FFMPEG_VERSION = null;

(function probeFfmpeg() {
  try {
    const proc = spawn(FFMPEG_PATH, ['-version']);
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('error', () => {
      FFMPEG_AVAILABLE = false;
    });
    proc.on('close', (code) => {
      if (code === 0) {
        FFMPEG_AVAILABLE = true;
        const m = out.match(/ffmpeg version ([^\s]+)/);
        FFMPEG_VERSION = m ? m[1] : 'unknown';
      } else {
        FFMPEG_AVAILABLE = false;
      }
    });
  } catch (_) {
    FFMPEG_AVAILABLE = false;
  }
})();

function runFfmpeg(args, label = 'ffmpeg') {
  return new Promise((resolve, reject) => {
    if (!FFMPEG_AVAILABLE) {
      return reject(new Error('ffmpeg unavailable'));
    }
    const proc = spawn(FFMPEG_PATH, args);
    let stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      reject(new Error(`${label} timeout (${FFMPEG_TIMEOUT_MS}ms)`));
    }, FFMPEG_TIMEOUT_MS);
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${label} exit code ${code}: ${stderr.slice(-500)}`));
    });
  });
}

// webm → mp4 (H.264 + AAC). 인스타/사진앱 호환을 위한 표준 mp4.
async function convertWebmToMp4(webmPath, mp4Path) {
  await runFfmpeg(
    [
      '-y',
      '-i', webmPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', '128k',
      mp4Path,
    ],
    'webm→mp4'
  );
}

// mp4 → mov (코덱 그대로 컨테이너만 변경 — iOS Photos 호환)
async function convertMp4ToMov(mp4Path, movPath) {
  await runFfmpeg(
    [
      '-y',
      '-i', mp4Path,
      '-c', 'copy',
      '-movflags', '+faststart',
      movPath,
    ],
    'mp4→mov'
  );
}

// ────────────────────────────────────────────────────────────────────────────
// multer — 디스크 저장
// ────────────────────────────────────────────────────────────────────────────
const uploadVideo = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = mimetypeToExt(file.mimetype) || 'mp4';
      cb(null, `${req.params.id}.${ext}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('video/')) {
      return cb(new Error('not_video'));
    }
    cb(null, true);
  },
});

const uploadResult = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = mimetypeToExt(file.mimetype) || 'webm';
      cb(null, `result-${req.params.id}.${ext}`);
    },
  }),
  limits: { fileSize: MAX_RESULT_VIDEO_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('video/')) {
      return cb(new Error('not_video'));
    }
    cb(null, true);
  },
});

// ────────────────────────────────────────────────────────────────────────────
// 미들웨어
// ────────────────────────────────────────────────────────────────────────────
app.use(express.json());

// 정적 파일: public/ + uploads/
app.use(express.static(PUBLIC_DIR, { index: false }));
app.use('/uploads', express.static(UPLOAD_DIR, {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store');
  },
}));

// ────────────────────────────────────────────────────────────────────────────
// API 라우트
// ────────────────────────────────────────────────────────────────────────────

// 0) Store token 조회 (PC가 QR 만들 때)
app.get('/api/store-token', (req, res) => {
  try {
    const token = ensureFreshToken();
    const base = buildPublicHost(req);
    const qrUrl = `${base}/upload?token=${token.value}`;
    res.json({
      token: token.value,
      issuedAt: token.issuedAt.toISOString(),
      expiresAt: token.expiresAt.toISOString(),
      qrUrl,
    });
  } catch (err) {
    console.error('[token] 조회 실패', err);
    res.status(500).json({ error: 'store_token_failed', detail: err.message });
  }
});

// 1) 세션 생성 — 토큰 검증
app.post('/api/sessions', (req, res) => {
  try {
    const bodyToken = req.body && req.body.token;
    const queryToken = req.query.token;
    const providedToken = bodyToken || queryToken;
    const fresh = ensureFreshToken();
    if (!providedToken || providedToken !== fresh.value) {
      return res.status(401).json({ error: 'invalid_or_expired_token' });
    }

    const id = uuidv4();
    const now = new Date();
    const SESSION_TTL_MS = 30 * 60 * 1000; // 30분
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const pcId = req.body && req.body.pcId ? String(req.body.pcId) : null;

    // 카메라 각도 — 모바일에서 대각선/정면 라디오로 지정. 채점 임계치에 직접 영향.
    // 'side'(측면)는 매장 시나리오에 없으므로 제거. 알 수 없는 값은 기본 'diagonal'.
    const rawAngle = req.body && req.body.cameraAngle;
    const cameraAngle = (rawAngle === 'front' || rawAngle === 'diagonal') ? rawAngle : 'diagonal';

    // 백핸드 스타일 — 모바일에서 자동/한손/양손 선택. 백핸드 영상에만 적용됨.
    const rawBhStyle = req.body && req.body.backhandStyle;
    const backhandStyle = (rawBhStyle === 'one-handed' || rawBhStyle === 'two-handed') ? rawBhStyle : 'auto';

    sessions.set(id, {
      id,
      status: 'waiting',
      storeToken: fresh.value,
      cameraAngle,
      backhandStyle,
      videoFilename: null,
      videoMime: null,
      resultVideoFilename: null,
      resultVideoMime: null,
      resultVideoExt: null,
      failReason: null,
      downloadCount: 0,
      pcId,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      uploadedAt: null,
      pickedUpAt: null,
      completedAt: null,
      failedAt: null,
      resultVideoUploadedAt: null,
    });

    const base = buildPublicHost(req);
    const uploadUrl = `${base}/upload?session=${id}`;

    console.log(`[session] 새 세션 ${id} (각도: ${cameraAngle}, 백핸드: ${backhandStyle})`);
    res.status(201).json({
      sessionId: id,
      uploadUrl,
      qrUrl: uploadUrl,
      cameraAngle,
      backhandStyle,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error('[session] 생성 실패', err);
    res.status(500).json({ error: '세션 생성에 실패했습니다', detail: err.message });
  }
});

// 2) 모바일 영상 업로드 (multipart) — uploads/<id>.<ext>
app.post(
  '/api/sessions/:id/upload',
  (req, res, next) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
    if (isExpired(session)) return res.status(410).json({ error: '세션이 만료되었습니다' });
    if (session.status !== 'waiting') {
      return res.status(409).json({ error: `이미 업로드된 세션입니다 (status=${session.status})` });
    }
    next();
  },
  (req, res) => {
    uploadVideo.single('video')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: '파일 크기 초과 (300MB)' });
        }
        if (err.message === 'not_video') {
          return res.status(400).json({ error: '비디오 파일만 업로드 가능합니다' });
        }
        console.error('[upload] multer 오류', err);
        return res.status(500).json({ error: '업로드 처리 실패', detail: err.message });
      }
      if (!req.file) return res.status(400).json({ error: '비디오 파일이 첨부되지 않았습니다' });

      const session = sessions.get(req.params.id);
      if (!session) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(404).json({ error: '세션이 사라졌습니다' });
      }
      session.videoFilename = req.file.filename;
      session.videoMime = req.file.mimetype;
      session.status = 'uploaded';
      session.uploadedAt = new Date().toISOString();

      console.log(`[upload] 세션 ${req.params.id} ← ${req.file.filename} (${req.file.size} bytes)`);
      res.json({
        ok: true,
        sessionId: req.params.id,
        videoUrl: `/uploads/${req.file.filename}`,
      });
    });
  }
);

// 3) 세션 상태 조회
app.get('/api/sessions/:id/status', (req, res) => {
  const { id } = req.params;
  const session = sessions.get(id);
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다' });

  if (isExpired(session) && session.status === 'waiting') {
    return res.json({
      sessionId: id,
      status: 'expired',
      videoUrl: null,
      resultVideoUrl: null,
      downloadUrl: null,
      expiresAt: session.expiresAt,
    });
  }

  const videoUrl = session.videoFilename ? `/uploads/${session.videoFilename}` : null;
  const resultVideoUrl = session.resultVideoFilename ? `/uploads/${session.resultVideoFilename}` : null;
  const downloadUrl = session.resultVideoFilename ? `/d/${id}` : null;

  res.json({
    sessionId: id,
    status: session.status,
    videoUrl,
    resultVideoUrl,
    downloadUrl,
    expiresAt: session.expiresAt,
    uploadedAt: session.uploadedAt,
    completedAt: session.completedAt,
  });
});

// 4) PC 큐 폴링 — 가장 오래된 'uploaded' → 'analyzing'으로 전이
app.get('/api/queue/next', (req, res) => {
  let oldest = null;
  for (const session of sessions.values()) {
    if (session.status !== 'uploaded') continue;
    if (!oldest || (session.uploadedAt || '') < (oldest.uploadedAt || '')) {
      oldest = session;
    }
  }
  if (!oldest) return res.status(204).end();

  oldest.status = 'analyzing';
  oldest.pickedUpAt = new Date().toISOString();

  // 상대 경로로 반환 — PC 브라우저가 어떤 호스트로 접근하든(localhost / LAN IP)
  // 동일 origin으로 해석되므로 CORS / canvas tainting 문제가 없다.
  const videoUrl = oldest.videoFilename ? `/uploads/${oldest.videoFilename}` : null;

  console.log(`[queue] 픽업 ${oldest.id} → analyzing (각도: ${oldest.cameraAngle || 'side'})`);
  res.json({
    sessionId: oldest.id,
    videoUrl,
    cameraAngle: oldest.cameraAngle || 'diagonal',
    backhandStyle: oldest.backhandStyle || 'auto',
    status: oldest.status,
    uploadedAt: oldest.uploadedAt,
  });
});

// 5) PC가 분석 완료 보고
app.post('/api/sessions/:id/complete', (req, res) => {
  const { id } = req.params;
  const session = sessions.get(id);
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
  session.status = 'completed';
  session.completedAt = new Date().toISOString();
  console.log(`[session] ${id} → completed`);
  res.json({ ok: true });
});

// 6) PC가 분석 실패 보고
app.post('/api/sessions/:id/skip', (req, res) => {
  const { id } = req.params;
  const reason = (req.body && req.body.reason) || 'pc_skipped';
  const session = sessions.get(id);
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
  session.status = 'failed';
  session.failedAt = new Date().toISOString();
  session.failReason = reason;
  console.log(`[session] ${id} → failed (${reason})`);
  res.json({ ok: true });
});

// 7) PC가 합성 결과 영상 업로드 (multipart, webm/mp4)
//    저장 후 ffmpeg로 webm → mp4 + mov 변환. 변환 실패해도 graceful fallback.
app.post(
  '/api/sessions/:id/result-video',
  (req, res, next) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
    if (!['analyzing', 'completed'].includes(session.status)) {
      return res.status(409).json({ error: `결과 영상을 업로드할 수 없는 상태입니다 (status=${session.status})` });
    }
    next();
  },
  (req, res) => {
    uploadResult.single('video')(req, res, async (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: `파일 크기 초과 (${MAX_RESULT_VIDEO_BYTES / 1024 / 1024}MB)` });
        }
        if (err.message === 'not_video') {
          return res.status(400).json({ error: '비디오 파일만 업로드 가능합니다' });
        }
        console.error('[result-video] multer 오류', err);
        return res.status(500).json({ error: '결과 영상 업로드 실패', detail: err.message });
      }
      if (!req.file) return res.status(400).json({ error: '비디오 파일이 첨부되지 않았습니다' });

      const { id } = req.params;
      const session = sessions.get(id);
      if (!session) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(404).json({ error: '세션이 사라졌습니다' });
      }

      const uploadedFilename = req.file.filename; // result-<id>.<ext>
      const uploadedExt = mimetypeToExt(req.file.mimetype) || 'webm';
      const baseName = `result-${id}`;

      let finalFilename = uploadedFilename;
      let finalMime = req.file.mimetype;
      let finalExt = uploadedExt;

      // webm 업로드 시 mp4 + mov 변환 시도
      if (uploadedExt === 'webm' && FFMPEG_AVAILABLE) {
        const webmPath = path.join(UPLOAD_DIR, `${baseName}.webm`);
        const mp4Path = path.join(UPLOAD_DIR, `${baseName}.mp4`);
        const movPath = path.join(UPLOAD_DIR, `${baseName}.mov`);
        try {
          console.log(`[result-video] ffmpeg 변환 시작: ${baseName} (webm → mp4 → mov)`);
          const t0 = Date.now();
          await convertWebmToMp4(webmPath, mp4Path);
          await convertMp4ToMov(mp4Path, movPath);
          const elapsed = Date.now() - t0;
          console.log(`[result-video] ffmpeg 변환 완료 in ${elapsed}ms`);

          // webm 삭제, mp4 + mov 보관
          try { fs.unlinkSync(webmPath); } catch (_) {}
          finalFilename = `${baseName}.mov`;
          finalMime = 'video/quicktime';
          finalExt = 'mov';
        } catch (convErr) {
          console.warn('[result-video] ffmpeg 변환 실패 — webm 그대로 유지', convErr.message);
          // 변환 실패 시 webm 원본 유지
        }
      } else if (uploadedExt === 'webm' && !FFMPEG_AVAILABLE) {
        console.warn('[result-video] ffmpeg 비가용 — webm 원본 유지');
      }

      session.resultVideoFilename = finalFilename;
      session.resultVideoMime = finalMime;
      session.resultVideoExt = finalExt;
      session.resultVideoUploadedAt = new Date().toISOString();

      const base = buildPublicHost(req);
      const downloadUrl = `/d/${id}`;
      const publicDownloadUrl = `${base}${downloadUrl}`;

      console.log(`[result-video] 세션 ${id} ← ${finalFilename}`);
      res.json({
        ok: true,
        sessionId: id,
        resultVideoUrl: `/uploads/${finalFilename}`,
        downloadUrl,
        publicDownloadUrl,
      });
    });
  }
);

// 8) 다운로드 안내 페이지 (HTML) — 영상 미리보기 + .mov 다운로드 버튼
app.get('/d/:id', (req, res) => {
  const { id } = req.params;
  const session = sessions.get(id);
  if (!session || !session.resultVideoFilename) {
    return res.status(404).send('결과 영상을 찾을 수 없습니다');
  }

  // mov 우선, 없으면 mp4, 없으면 webm
  const baseName = `result-${id}`;
  const movPath = path.join(UPLOAD_DIR, `${baseName}.mov`);
  const mp4Path = path.join(UPLOAD_DIR, `${baseName}.mp4`);

  let downloadFilename;
  let downloadExt;
  if (fs.existsSync(movPath)) {
    downloadFilename = `${baseName}.mov`;
    downloadExt = 'mov';
  } else if (fs.existsSync(mp4Path)) {
    downloadFilename = `${baseName}.mp4`;
    downloadExt = 'mp4';
  } else {
    downloadFilename = session.resultVideoFilename;
    downloadExt = session.resultVideoExt || 'webm';
  }

  // 미리보기는 mp4가 있으면 mp4 (Safari가 mov보다 mp4를 더 안정적으로 인라인 재생)
  const previewFilename = fs.existsSync(mp4Path) ? `${baseName}.mp4` : downloadFilename;

  const shortId = id.slice(0, 8);
  const previewSrc = `/uploads/${previewFilename}`;
  const downloadSrc = `/d/${id}/raw`;
  const downloadName = `daily-tennis-${shortId}.${downloadExt}`;

  session.downloadCount += 1;

  console.log(`[download-page] 세션 ${id} → ${downloadFilename}`);

  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>DAILY TENNIS — 분석 영상 저장</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro", "Apple SD Gothic Neo", sans-serif;
    background: linear-gradient(180deg,#020617 0%,#0c1a14 100%);
    color: #fff; min-height: 100vh; padding: 24px 18px 40px;
    max-width: 480px; margin: 0 auto; -webkit-font-smoothing: antialiased;
  }
  .header { text-align: center; margin-bottom: 4px; }
  .brand { color: #a3e635; letter-spacing: 0.15em; font-weight: 800; font-size: 20px; }
  .subtitle { color: #94a3b8; font-size: 13px; margin-top: 4px; letter-spacing: 0.04em; }
  .video-frame {
    width: 100%; max-width: 320px; aspect-ratio: 9/16;
    margin: 20px auto 8px; border-radius: 16px; overflow: hidden;
    background: #000; box-shadow: 0 8px 32px rgba(0,0,0,0.4); position: relative;
  }
  .preview-video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .btn-primary {
    display: flex; align-items: center; justify-content: center; gap: 12px;
    width: 100%;
    background: linear-gradient(135deg, #a3e635, #84cc16);
    color: #0f172a; border: none; padding: 20px 24px; border-radius: 18px;
    font-size: 18px; font-weight: 800;
    box-shadow: 0 8px 24px rgba(163,230,53,0.3);
    cursor: pointer; margin: 16px 0 8px;
    font-family: inherit; text-decoration: none;
    transition: transform 0.1s, background 0.15s;
  }
  .btn-primary:active { transform: scale(0.98); background: #84cc16; }
  .btn-primary .icon { font-size: 24px; line-height: 1; }
  .files-guide {
    background: linear-gradient(135deg, rgba(163,230,53,0.08), rgba(132,204,22,0.04));
    border: 1px solid rgba(163,230,53,0.3); border-radius: 16px;
    padding: 18px 20px; margin: 24px 0 16px;
  }
  .files-guide h3 {
    color: #a3e635; font-size: 15px; font-weight: 700;
    margin-bottom: 12px; display: flex; align-items: center; gap: 8px;
  }
  .files-guide ol { padding-left: 20px; color: #cbd5e1; font-size: 14px; line-height: 1.8; }
  .files-guide ol li { margin: 4px 0; padding-left: 4px; }
  .files-guide ol li b { color: #a3e635; font-weight: 700; }
  .files-tip {
    margin-top: 12px; padding-top: 12px;
    border-top: 1px solid rgba(255,255,255,0.1);
    color: #94a3b8; font-size: 13px; line-height: 1.5;
  }
  .files-tip b { color: #fbbf24; font-weight: 700; }
  .footer {
    margin-top: 28px; text-align: center;
    color: #64748b; font-size: 10.5px; letter-spacing: 0.05em;
  }
  .footer .dot { color: #a3e635; }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">DAILY TENNIS</div>
    <div class="subtitle">분석 영상 · Files → Photos 저장</div>
  </div>

  <div class="video-frame">
    <video class="preview-video" src="${previewSrc}" autoplay loop muted playsinline preload="auto"></video>
  </div>

  <a href="${downloadSrc}" download="${downloadName}" class="btn-primary">
    <span class="icon">📁</span>
    <span>파일로 다운로드 (.${downloadExt})</span>
  </a>

  <div class="files-guide">
    <h3>📲 다운로드 후 사진앱으로 옮기기</h3>
    <ol>
      <li>위 <b>"파일로 다운로드"</b> 버튼 누르기</li>
      <li>iPhone <b>Files 앱(파일)</b> 열기 → <b>"다운로드"</b> 폴더로 이동</li>
      <li>다운로드된 영상 <b>꾹 눌러서 "공유"</b> → <b>"비디오 저장"</b> 선택</li>
      <li>사진앱에서 인스타 릴스로 바로 업로드 가능</li>
    </ol>
    <p class="files-tip">
      💡 <b>Android:</b> "내 파일" → "Downloads" 폴더에서 바로 갤러리 인식됩니다.
    </p>
  </div>

  <div class="footer">DAILY TENNIS <span class="dot">·</span> 데일리테니스 본점 <span class="dot">·</span> ${shortId}</div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  res.send(html);
});

// 8-1) 직접 다운로드 — Content-Disposition: attachment로 강제
app.get('/d/:id/raw', (req, res) => {
  const { id } = req.params;
  const session = sessions.get(id);
  if (!session || !session.resultVideoFilename) {
    return res.status(404).send('결과 영상을 찾을 수 없습니다');
  }

  // mov 우선, 없으면 mp4, 없으면 webm
  const baseName = `result-${id}`;
  const candidates = [
    { ext: 'mov', mime: 'video/quicktime' },
    { ext: 'mp4', mime: 'video/mp4' },
    { ext: 'webm', mime: 'video/webm' },
  ];
  let chosen = null;
  for (const c of candidates) {
    const p = path.join(UPLOAD_DIR, `${baseName}.${c.ext}`);
    if (fs.existsSync(p)) {
      chosen = { ...c, filePath: p };
      break;
    }
  }
  if (!chosen) {
    // 어떤 조합도 없으면 sessions에 기록된 파일 그대로
    const p = path.join(UPLOAD_DIR, session.resultVideoFilename);
    if (!fs.existsSync(p)) return res.status(404).send('결과 영상 파일이 없습니다');
    chosen = {
      ext: session.resultVideoExt || 'webm',
      mime: session.resultVideoMime || 'video/webm',
      filePath: p,
    };
  }

  const shortId = id.slice(0, 8);
  const downloadName = `daily-tennis-${shortId}.${chosen.ext}`;
  res.setHeader('Content-Type', chosen.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(chosen.filePath);
});

// ────────────────────────────────────────────────────────────────────────────
// HTML 라우트
// ────────────────────────────────────────────────────────────────────────────
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');

app.get('/upload', (_req, res) => {
  res.sendFile(INDEX_HTML);
});

app.get('/', (_req, res) => {
  res.sendFile(INDEX_HTML);
});

// ────────────────────────────────────────────────────────────────────────────
// 에러 핸들링
// ────────────────────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: err.message || '서버 오류' });
});

// ────────────────────────────────────────────────────────────────────────────
// 정기 정리 — 1분마다
//   - 만료된 waiting 세션 제거
//   - completed/failed 세션 1시간 경과 시 파일 + 메모리 정리
//   - store token 만료 체크 (다음 요청 시 ensureFreshToken이 새로 발급)
// ────────────────────────────────────────────────────────────────────────────
const CLEANUP_INTERVAL_MS = 60 * 1000;
const COMPLETED_KEEP_MS = 60 * 60 * 1000;

function unlinkIfExists(filePath) {
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
}

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    let shouldDrop = false;

    if (session.status === 'waiting' && session.expiresAt && new Date(session.expiresAt).getTime() < now) {
      shouldDrop = true;
    }
    if (['completed', 'failed'].includes(session.status)) {
      const ts = session.completedAt || session.failedAt;
      if (ts && now - new Date(ts).getTime() > COMPLETED_KEEP_MS) {
        shouldDrop = true;
      }
    }

    if (shouldDrop) {
      // 결과 영상 파일들 (.mov, .mp4, .webm) 정리
      const baseName = `result-${id}`;
      ['mov', 'mp4', 'webm'].forEach((ext) => {
        unlinkIfExists(path.join(UPLOAD_DIR, `${baseName}.${ext}`));
      });
      // 원본 영상 정리
      if (session.videoFilename) {
        unlinkIfExists(path.join(UPLOAD_DIR, session.videoFilename));
      }
      sessions.delete(id);
      console.log(`[cleanup] 세션 ${id} 정리 (status=${session.status})`);
    }
  }
}, CLEANUP_INTERVAL_MS);

// ────────────────────────────────────────────────────────────────────────────
// 서버 시작
// ────────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const token = ensureFreshToken();
  const expiresKST = token.expiresAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const qrUrl = `http://${LAN_IP}:${PORT}/upload?token=${token.value}`;

  app.listen(PORT, () => {
    console.log('');
    console.log('📡 데일리테니스 서버 시작');
    console.log(`   로컬:    http://localhost:${PORT}`);
    console.log(`   매장 LAN: http://${LAN_IP}:${PORT}  (모바일은 이 주소)`);
    console.log(`   업로드 디렉토리: ${UPLOAD_DIR}`);
    console.log('');
    // ffmpeg probe는 비동기이므로 약간 늦게 출력
    setTimeout(() => {
      if (FFMPEG_AVAILABLE) {
        console.log(`🎬 ffmpeg 사용 가능 (${FFMPEG_VERSION || 'unknown'}) — webm→mp4→mov 자동 변환 활성`);
      } else {
        console.log('⚠️  ffmpeg 비활성 — 결과 영상은 webm 원본 그대로 저장됩니다');
        console.log('    macOS:   brew install ffmpeg');
        console.log('    Windows: https://www.gyan.dev/ffmpeg/builds/');
      }
      console.log('');
      console.log(`🎟️  Store Token: ${token.value}`);
      console.log(`   만료: ${expiresKST} (${STORE_TOKEN_TTL_DAYS}일 후)`);
      console.log(`   QR URL: ${qrUrl}`);
      console.log('');
    }, 200);
  });
}

module.exports = app;
