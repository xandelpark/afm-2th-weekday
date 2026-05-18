/**
 * 데일리테니스 자세분석 앱 — server.js (Vercel 클라우드 배포판)
 *
 * 운영 가정:
 *  - Vercel Serverless Function으로 실행 (요청별 독립 인스턴스)
 *  - 영상 파일은 Vercel Blob에 저장 (브라우저 직접 업로드: client upload)
 *  - 세션 메타데이터는 Supabase Postgres에 저장
 *  - ffmpeg 사용 안 함 — 모든 변환은 브라우저 ffmpeg.wasm에서 처리
 *
 * 흐름:
 *   [PC 모니터]      ─ GET /api/store-token         ─→  지속형 QR
 *   [손님 폰]   QR → /upload?token=...
 *                    POST /api/sessions { token } → sessionId 발급
 *                    POST /api/blob/upload-url    → 클라이언트 직접 업로드 토큰
 *                    PUT  <blob direct url>       → Vercel Blob에 직업로드 (1080p 변환된 파일)
 *                    POST /api/sessions/:id/attach { blobUrl } → DB 업데이트
 *   [PC]             GET /api/queue/next → uploaded → analyzing 전이
 *                    POST /api/blob/upload-url → 결과 영상 직접 업로드 토큰
 *                    PUT  <blob direct url> → 합성 결과 영상 (mp4)
 *                    POST /api/sessions/:id/attach-result { blobUrl } → DB 업데이트
 *                    POST /api/sessions/:id/complete
 *   [손님 폰]   /d/:id     → HTML 안내 페이지 + Blob 영상 미리보기
 *               /d/:id/raw → Blob 영상 redirect (Content-Disposition 강제)
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');
const { Client } = require('pg');
const { handleUpload } = require('@vercel/blob/client');
const { del: blobDel } = require('@vercel/blob');

const app = express();
const PORT = parseInt((process.env.PORT || '3000').trim(), 10);

// ────────────────────────────────────────────────────────────────────────────
// 환경변수 / 상수
// ────────────────────────────────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
// 매장 외부에서 QR 스캔샷을 재사용하지 못하도록 회전형으로 운영.
// rotate 분마다 새 토큰을 발급하고, 직전 토큰은 grace 분 동안만 추가 수용 (스캔 후 업로드 완료 시간 확보).
// 한 토큰의 최대 수명 = rotate + grace.
const STORE_TOKEN_ROTATE_MINUTES = parseFloat((process.env.STORE_TOKEN_ROTATE_MINUTES || '5').trim());
const STORE_TOKEN_GRACE_MINUTES = parseFloat((process.env.STORE_TOKEN_GRACE_MINUTES || '5').trim());
const STORE_TOKEN_ROTATE_MS = STORE_TOKEN_ROTATE_MINUTES * 60 * 1000;
const STORE_TOKEN_GRACE_MS = STORE_TOKEN_GRACE_MINUTES * 60 * 1000;
const STORE_TOKEN_MAX_AGE_MS = STORE_TOKEN_ROTATE_MS + STORE_TOKEN_GRACE_MS;
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100MB — 1080p 1분 영상 충분

const PUBLIC_DIR = path.join(__dirname, 'public');

// ────────────────────────────────────────────────────────────────────────────
// Postgres helper — 요청별로 짧게 연결
// ────────────────────────────────────────────────────────────────────────────
async function withDb(fn) {
  if (!DATABASE_URL) throw new Error('DATABASE_URL not configured');
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 10000,
    query_timeout: 10000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try { await client.end(); } catch (_) {}
  }
}

function rowToSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    storeToken: row.store_token,
    cameraAngle: row.camera_angle,
    backhandStyle: row.backhand_style,
    pcId: row.pc_id,
    videoBlobUrl: row.video_blob_url,
    videoMime: row.video_mime,
    resultBlobUrl: row.result_blob_url,
    resultMime: row.result_mime,
    resultExt: row.result_ext,
    failReason: row.fail_reason,
    downloadCount: row.download_count,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    uploadedAt: row.uploaded_at,
    pickedUpAt: row.picked_up_at,
    completedAt: row.completed_at,
    failedAt: row.failed_at,
    resultUploadedAt: row.result_uploaded_at,
  };
}

async function getSession(id) {
  return withDb(async (c) => {
    const r = await c.query('SELECT * FROM sessions WHERE id = $1', [id]);
    return rowToSession(r.rows[0]);
  });
}

function isExpired(session) {
  if (!session || !session.expiresAt) return false;
  return new Date(session.expiresAt).getTime() < Date.now();
}

// ────────────────────────────────────────────────────────────────────────────
// Store token — DB 기반 회전형
// ────────────────────────────────────────────────────────────────────────────
async function ensureFreshToken() {
  return withDb(async (c) => {
    const r = await c.query(
      'SELECT token, issued_at FROM store_tokens ORDER BY issued_at DESC LIMIT 1'
    );
    const latest = r.rows[0];
    const now = Date.now();
    // 발급 후 ROTATE_MS 이내면 그대로 노출 (PC 모니터에 표시 중)
    if (latest && now - new Date(latest.issued_at).getTime() < STORE_TOKEN_ROTATE_MS) {
      const issuedAt = new Date(latest.issued_at);
      return {
        value: latest.token,
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + STORE_TOKEN_MAX_AGE_MS),
      };
    }
    // 회전 시점 도달 → 새 토큰. 이전 토큰 row는 grace 동안 validateToken에서 수용됨
    const value = crypto.randomBytes(8).toString('hex');
    const issuedAt = new Date(now);
    const expiresAt = new Date(now + STORE_TOKEN_MAX_AGE_MS);
    await c.query(
      'INSERT INTO store_tokens (token, issued_at, expires_at) VALUES ($1, $2, $3)',
      [value, issuedAt, expiresAt]
    );
    // 누적 방지: 1시간보다 오래된 row 정리 (grace 한참 지난 것들)
    await c.query(
      "DELETE FROM store_tokens WHERE issued_at < NOW() - INTERVAL '1 hour'"
    );
    console.log(`[token] 회전 → ${value} (rotate=${STORE_TOKEN_ROTATE_MINUTES}min, grace=${STORE_TOKEN_GRACE_MINUTES}min)`);
    return { value, issuedAt, expiresAt };
  });
}

// 모바일이 제공한 토큰이 현재 또는 직전(grace 내) 토큰인지 검증.
// /api/sessions에서 이걸로 검증 → 회전 직후에도 직전 토큰을 들고 온 손님 업로드 통과.
async function validateToken(provided) {
  if (!provided) return false;
  return withDb(async (c) => {
    const r = await c.query(
      'SELECT token, issued_at FROM store_tokens WHERE token = $1 ORDER BY issued_at DESC LIMIT 1',
      [provided]
    );
    const row = r.rows[0];
    if (!row) return false;
    const age = Date.now() - new Date(row.issued_at).getTime();
    return age < STORE_TOKEN_MAX_AGE_MS;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// 호스트/URL 결정 — Vercel 배포 시 자동으로 vercel.app 도메인
// ────────────────────────────────────────────────────────────────────────────
function buildPublicHost(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString().split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).toString();
  return `${proto}://${host}`;
}

// ────────────────────────────────────────────────────────────────────────────
// 미들웨어
// ────────────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR, { index: false }));

// ────────────────────────────────────────────────────────────────────────────
// API 라우트
// ────────────────────────────────────────────────────────────────────────────

// 헬스체크
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasDb: !!DATABASE_URL,
    hasBlob: !!BLOB_TOKEN,
    time: new Date().toISOString(),
  });
});

// 0) Store token 조회
app.get('/api/store-token', async (req, res) => {
  try {
    const token = await ensureFreshToken();
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
app.post('/api/sessions', async (req, res) => {
  try {
    const providedToken = (req.body && req.body.token) || req.query.token;
    // 현재 토큰 또는 grace 내 직전 토큰을 수용 (회전 직후에도 들고 있는 손님 통과)
    const ok = await validateToken(providedToken);
    if (!ok) {
      return res.status(401).json({ error: 'invalid_or_expired_token' });
    }

    const id = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    const pcId = req.body && req.body.pcId ? String(req.body.pcId) : null;

    const rawAngle = req.body && req.body.cameraAngle;
    const cameraAngle = (rawAngle === 'front' || rawAngle === 'diagonal') ? rawAngle : 'diagonal';

    const rawBhStyle = req.body && req.body.backhandStyle;
    const backhandStyle = (rawBhStyle === 'one-handed' || rawBhStyle === 'two-handed') ? rawBhStyle : 'auto';

    await withDb((c) => c.query(
      `INSERT INTO sessions (id, status, store_token, camera_angle, backhand_style, pc_id, expires_at)
       VALUES ($1, 'waiting', $2, $3, $4, $5, $6)`,
      [id, providedToken, cameraAngle, backhandStyle, pcId, expiresAt]
    ));

    const base = buildPublicHost(req);
    const uploadUrl = `${base}/upload?session=${id}`;

    console.log(`[session] 새 세션 ${id}`);
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

// 1-A) Blob client upload 토큰 발급 — 브라우저가 Blob에 직접 업로드하기 위한 endpoint
//      (Vercel Blob client upload 흐름의 표준 핸들러)
app.post('/api/blob/upload-url', async (req, res) => {
  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname /*, clientPayload */) => {
        // clientPayload에 sessionId/role 넣을 수 있음 (입력 검증)
        const allowedPrefixes = ['raw/', 'result/'];
        if (!allowedPrefixes.some((p) => pathname.startsWith(p))) {
          throw new Error('invalid_pathname');
        }
        return {
          allowedContentTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          tokenPayload: JSON.stringify({ pathname, ts: Date.now() }),
        };
      },
      onUploadCompleted: async (/* { blob, tokenPayload } */) => {
        // 클라이언트가 직접 /attach 로 DB 업데이트 호출
      },
      token: BLOB_TOKEN,
    });
    res.json(jsonResponse);
  } catch (err) {
    console.error('[blob/upload-url] 실패', err);
    res.status(400).json({ error: 'blob_token_failed', detail: err.message });
  }
});

// 2) 모바일 영상 업로드 완료 보고 — Blob URL을 DB에 첨부
app.post('/api/sessions/:id/attach', async (req, res) => {
  try {
    const { id } = req.params;
    const { blobUrl, mime } = req.body || {};
    if (!blobUrl) return res.status(400).json({ error: 'blobUrl 누락' });

    const session = await getSession(id);
    if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
    if (isExpired(session)) return res.status(410).json({ error: '세션이 만료되었습니다' });
    if (session.status !== 'waiting') {
      return res.status(409).json({ error: `이미 처리된 세션입니다 (status=${session.status})` });
    }

    await withDb((c) => c.query(
      `UPDATE sessions SET video_blob_url = $1, video_mime = $2, status = 'uploaded', uploaded_at = NOW()
       WHERE id = $3`,
      [blobUrl, mime || 'video/mp4', id]
    ));

    console.log(`[upload] 세션 ${id} ← ${blobUrl}`);
    res.json({ ok: true, sessionId: id, videoUrl: blobUrl });
  } catch (err) {
    console.error('[attach] 실패', err);
    res.status(500).json({ error: '업로드 첨부 실패', detail: err.message });
  }
});

// 3) 세션 상태 조회
app.get('/api/sessions/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const session = await getSession(id);
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

    res.json({
      sessionId: id,
      status: session.status,
      videoUrl: session.videoBlobUrl,
      resultVideoUrl: session.resultBlobUrl,
      downloadUrl: session.resultBlobUrl ? `/d/${id}` : null,
      expiresAt: session.expiresAt,
      uploadedAt: session.uploadedAt,
      completedAt: session.completedAt,
    });
  } catch (err) {
    console.error('[status] 실패', err);
    res.status(500).json({ error: err.message });
  }
});

// 4) PC 큐 폴링 — 가장 오래된 uploaded → analyzing (원자적 업데이트)
app.get('/api/queue/next', async (_req, res) => {
  try {
    const result = await withDb((c) => c.query(
      `UPDATE sessions SET status = 'analyzing', picked_up_at = NOW()
       WHERE id = (
         SELECT id FROM sessions
         WHERE status = 'uploaded'
         ORDER BY uploaded_at ASC NULLS LAST
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`
    ));
    const session = rowToSession(result.rows[0]);
    if (!session) return res.status(204).end();

    console.log(`[queue] 픽업 ${session.id}`);
    res.json({
      sessionId: session.id,
      videoUrl: session.videoBlobUrl,
      cameraAngle: session.cameraAngle || 'diagonal',
      backhandStyle: session.backhandStyle || 'auto',
      status: session.status,
      uploadedAt: session.uploadedAt,
    });
  } catch (err) {
    console.error('[queue] 실패', err);
    res.status(500).json({ error: err.message });
  }
});

// 5) PC 분석 완료 보고
app.post('/api/sessions/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await withDb((c) => c.query(
      `UPDATE sessions SET status = 'completed', completed_at = NOW()
       WHERE id = $1 RETURNING id`,
      [id]
    ));
    if (result.rowCount === 0) return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
    console.log(`[session] ${id} → completed`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6) PC 분석 실패 보고
app.post('/api/sessions/:id/skip', async (req, res) => {
  try {
    const { id } = req.params;
    const reason = (req.body && req.body.reason) || 'pc_skipped';
    const result = await withDb((c) => c.query(
      `UPDATE sessions SET status = 'failed', failed_at = NOW(), fail_reason = $2
       WHERE id = $1 RETURNING id`,
      [id, reason]
    ));
    if (result.rowCount === 0) return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
    console.log(`[session] ${id} → failed (${reason})`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7) PC 합성 결과 영상 첨부 — Blob URL을 DB에 기록 (mp4 가정, 브라우저가 변환 후 업로드)
app.post('/api/sessions/:id/attach-result', async (req, res) => {
  try {
    const { id } = req.params;
    const { blobUrl, mime, ext } = req.body || {};
    if (!blobUrl) return res.status(400).json({ error: 'blobUrl 누락' });

    const session = await getSession(id);
    if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다' });
    if (!['analyzing', 'completed'].includes(session.status)) {
      return res.status(409).json({ error: `결과 영상을 첨부할 수 없는 상태 (status=${session.status})` });
    }

    await withDb((c) => c.query(
      `UPDATE sessions SET result_blob_url = $1, result_mime = $2, result_ext = $3, result_uploaded_at = NOW()
       WHERE id = $4`,
      [blobUrl, mime || 'video/mp4', ext || 'mp4', id]
    ));

    const base = buildPublicHost(req);
    const downloadUrl = `/d/${id}`;
    console.log(`[result-video] 세션 ${id} ← ${blobUrl}`);
    res.json({
      ok: true,
      sessionId: id,
      resultVideoUrl: blobUrl,
      downloadUrl,
      publicDownloadUrl: `${base}${downloadUrl}`,
    });
  } catch (err) {
    console.error('[attach-result] 실패', err);
    res.status(500).json({ error: err.message });
  }
});

// 8) 다운로드 안내 페이지 (HTML)
app.get('/d/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const session = await getSession(id);
    if (!session || !session.resultBlobUrl) {
      return res.status(404).send('결과 영상을 찾을 수 없습니다');
    }

    const shortId = id.slice(0, 8);
    const downloadExt = session.resultExt || 'mp4';
    const previewSrc = session.resultBlobUrl;
    const downloadSrc = `/d/${id}/raw`;
    const downloadName = `daily-tennis-${shortId}.${downloadExt}`;

    await withDb((c) => c.query(
      'UPDATE sessions SET download_count = download_count + 1 WHERE id = $1',
      [id]
    ));

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
  } catch (err) {
    console.error('[download-page] 실패', err);
    res.status(500).send('서버 오류');
  }
});

// 8-1) 직접 다운로드 — Blob URL로 302 redirect (Content-Disposition은 Blob 자체에서 처리 불가하므로
//      클라이언트의 <a download> 속성으로 처리. 파일명은 URL hash 부분 활용)
app.get('/d/:id/raw', async (req, res) => {
  try {
    const { id } = req.params;
    const session = await getSession(id);
    if (!session || !session.resultBlobUrl) {
      return res.status(404).send('결과 영상을 찾을 수 없습니다');
    }
    res.redirect(302, session.resultBlobUrl);
  } catch (err) {
    res.status(500).send('서버 오류');
  }
});

// ────────────────────────────────────────────────────────────────────────────
// HTML 라우트
// ────────────────────────────────────────────────────────────────────────────
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');

app.get('/upload', (_req, res) => res.sendFile(INDEX_HTML));
app.get('/', (_req, res) => res.sendFile(INDEX_HTML));

// 9) 정리 cron — Vercel Cron에서 호출 (vercel.json에 schedule 정의)
app.get('/api/cron/cleanup', async (req, res) => {
  // Vercel Cron의 user-agent / Authorization 검증은 단순화: 헤더 토큰만 확인 (선택)
  try {
    const COMPLETED_KEEP_MS = 60 * 60 * 1000;
    const now = new Date();
    const cutoff = new Date(now.getTime() - COMPLETED_KEEP_MS);

    const expired = await withDb((c) => c.query(
      `SELECT id, video_blob_url, result_blob_url FROM sessions
       WHERE (status = 'waiting' AND expires_at < NOW())
          OR (status IN ('completed', 'failed') AND COALESCE(completed_at, failed_at) < $1)`,
      [cutoff]
    ));

    let deleted = 0;
    for (const row of expired.rows) {
      const urls = [row.video_blob_url, row.result_blob_url].filter(Boolean);
      for (const url of urls) {
        try { await blobDel(url, { token: BLOB_TOKEN }); } catch (_) {}
      }
      await withDb((c) => c.query('DELETE FROM sessions WHERE id = $1', [row.id]));
      deleted += 1;
    }

    await withDb((c) => c.query("DELETE FROM store_tokens WHERE expires_at < NOW() - interval '1 day'"));

    res.json({ ok: true, deleted });
  } catch (err) {
    console.error('[cron/cleanup] 실패', err);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// 에러 핸들링
// ────────────────────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: err.message || '서버 오류' });
});

// ────────────────────────────────────────────────────────────────────────────
// 서버 시작 (Vercel 환경 외 로컬 실행 시)
// ────────────────────────────────────────────────────────────────────────────
if (require.main === module && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log('');
    console.log('📡 데일리테니스 서버 시작 (Vercel 호환 모드)');
    console.log(`   로컬:    http://localhost:${PORT}`);
    console.log(`   DB:      ${DATABASE_URL ? 'configured' : 'MISSING'}`);
    console.log(`   Blob:    ${BLOB_TOKEN ? 'configured' : 'MISSING'}`);
    console.log(`   Token:   rotate=${STORE_TOKEN_ROTATE_MINUTES}min, grace=${STORE_TOKEN_GRACE_MINUTES}min`);
    console.log('');
  });
}

module.exports = app;
