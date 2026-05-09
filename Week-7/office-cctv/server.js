// 공유오피스 자리 감시용 CCTV 서버
// - 브라우저(getUserMedia)에서 웹캠을 받아 동작 감지 시 영상/스냅샷을 서버로 업로드
// - 서버는 STORAGE_DIR 아래 날짜별 폴더로 저장하고 보관기간 지난 폴더는 자동 삭제

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3030;

const CONFIG_FILE = path.join(__dirname, 'config.json');
const DEFAULT_STORAGE = path.join(os.homedir(), 'Movies', 'office-cctv');

let STORAGE_DIR = process.env.STORAGE_DIR || DEFAULT_STORAGE;
let RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '7', 10);
let TELEGRAM = { botToken: '', chatId: '' };
let SURVEILLANCE_ACTIVE = false; // 마스터 ON/OFF — 자리 비울 때만 ON

function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (cfg.storageDir) STORAGE_DIR = cfg.storageDir;
    if (cfg.retentionDays) RETENTION_DAYS = cfg.retentionDays;
    if (cfg.telegram) {
      TELEGRAM.botToken = cfg.telegram.botToken || '';
      TELEGRAM.chatId = cfg.telegram.chatId || '';
      // 구버전 호환: telegram.enabled가 true였으면 surveillanceActive로 승격
      if (cfg.telegram.enabled === true && cfg.surveillanceActive === undefined) {
        SURVEILLANCE_ACTIVE = true;
      }
    }
    if (typeof cfg.surveillanceActive === 'boolean') {
      SURVEILLANCE_ACTIVE = cfg.surveillanceActive;
    }
  } catch (e) {}
}
function saveConfig() {
  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify(
      {
        storageDir: STORAGE_DIR,
        retentionDays: RETENTION_DAYS,
        surveillanceActive: SURVEILLANCE_ACTIVE,
        telegram: TELEGRAM
      },
      null,
      2
    )
  );
}
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function safeName(s) {
  return /^[A-Za-z0-9_\-.]+$/.test(s);
}
function safeDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

loadConfig();
ensureDir(STORAGE_DIR);

// 미들웨어: 종류별로 raw body 받기
app.use(express.json({ limit: '5mb' }));
app.use('/api/clips', express.raw({ type: 'video/webm', limit: '500mb' }));
app.use('/api/snapshots', express.raw({ type: 'image/jpeg', limit: '20mb' }));

// 정적 파일 (index.html)
app.use(express.static(__dirname));

// 영상 클립 업로드 (동작 감지 발화 시)
app.post('/api/clips', (req, res) => {
  if (!SURVEILLANCE_ACTIVE) return res.json({ ok: false, ignored: 'surveillance off' });
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty' });
  const now = new Date();
  const dateStr = toLocalDate(now);
  const timeStr = toLocalTime(now).replace(/:/g, '-');
  const dir = path.join(STORAGE_DIR, dateStr, 'video');
  ensureDir(dir);
  const filename = `${timeStr}_motion.webm`;
  fs.writeFileSync(path.join(dir, filename), req.body);
  console.log(`[CLIP]  ${dateStr} ${timeStr}  ${(req.body.length / 1024 / 1024).toFixed(1)}MB`);
  res.json({ ok: true, file: `${dateStr}/video/${filename}` });
});

// 스냅샷 업로드 (5초 인터벌 모드 + 동작 감지 즉시 알림 + /snap 수동)
// ?urgent=1 : 동작 감지 (감시 ON일 때만 푸시)
// ?manual=1 : /snap 응답 (감시 ON일 때만, 단 manual은 큐에서 이미 게이트됨)
app.post('/api/snapshots', async (req, res) => {
  // 감시 OFF면 일체 저장/푸시 안 함 (manual은 예외 — 이미 /snap 명령 단계에서 게이트됨)
  if (!SURVEILLANCE_ACTIVE && req.query.manual !== '1') {
    return res.json({ ok: false, ignored: 'surveillance off' });
  }
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty' });
  const now = new Date();
  const dateStr = toLocalDate(now);
  const timeStr = toLocalTime(now).replace(/:/g, '-');
  const dir = path.join(STORAGE_DIR, dateStr, 'snapshots');
  ensureDir(dir);
  const tag = req.query.urgent === '1' ? '_alert' : (req.query.manual === '1' ? '_manual' : '');
  const filename = `${timeStr}${tag}.jpg`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, req.body);
  res.json({ ok: true, file: `${dateStr}/snapshots/${filename}` });

  if (req.query.manual === '1') {
    const caption = `📸 현재 화면\n${dateStr} ${toLocalTime(now)}`;
    sendTelegramPhoto(req.body, caption).catch(e =>
      console.error('[TELEGRAM] 푸시 실패:', e.message)
    );
  } else if (req.query.urgent === '1' && SURVEILLANCE_ACTIVE) {
    const caption = `🚨 동작 감지\n${dateStr} ${toLocalTime(now)}`;
    sendTelegramPhoto(req.body, caption).catch(e =>
      console.error('[TELEGRAM] 푸시 실패:', e.message)
    );
  }
});

// 텔레그램으로 사진 전송
async function sendTelegramPhoto(buffer, caption) {
  if (!TELEGRAM.botToken || !TELEGRAM.chatId) return false;
  const fd = new FormData();
  fd.append('chat_id', TELEGRAM.chatId);
  fd.append('caption', caption);
  fd.append('photo', new Blob([buffer], { type: 'image/jpeg' }), 'alert.jpg');
  const r = await fetch(`https://api.telegram.org/bot${TELEGRAM.botToken}/sendPhoto`, {
    method: 'POST',
    body: fd
  });
  if (r.ok) {
    console.log(`[TELEGRAM] 푸시 OK (${(buffer.length / 1024).toFixed(0)}KB)`);
  } else {
    const txt = await r.text();
    console.log(`[TELEGRAM] 푸시 실패: ${r.status} ${txt}`);
  }
  return r.ok;
}

// 텔레그램 연결 테스트
app.post('/api/telegram/test', async (req, res) => {
  const { botToken, chatId } = req.body || {};
  if (!botToken || !chatId) return res.status(400).json({ error: 'botToken/chatId 필요' });
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '✅ Office CCTV 연결 OK\n동작이 감지되면 여기로 사진이 옵니다.'
      })
    });
    const d = await r.json();
    if (!d.ok) return res.status(400).json({ error: d.description || '텔레그램 응답 오류' });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 텔레그램 봇 자격 저장 (토큰/Chat ID)
app.post('/api/telegram', (req, res) => {
  const { botToken, chatId } = req.body || {};
  if (typeof botToken === 'string') TELEGRAM.botToken = botToken.trim();
  if (typeof chatId === 'string') TELEGRAM.chatId = chatId.trim();
  saveConfig();
  res.json({
    ok: true,
    telegram: {
      hasToken: !!TELEGRAM.botToken,
      chatId: TELEGRAM.chatId
    }
  });
});

// 파일 목록 (UI 좌측 라이브러리)
app.get('/api/files', (req, res) => {
  ensureDir(STORAGE_DIR);
  const dates = fs
    .readdirSync(STORAGE_DIR)
    .filter(safeDate)
    .sort()
    .reverse();
  const result = dates.map(date => ({
    date,
    videos: listKind(date, 'video'),
    snapshots: listKind(date, 'snapshots')
  }));
  res.json({
    storageDir: STORAGE_DIR,
    retentionDays: RETENTION_DAYS,
    diskFree: tryDiskFree(STORAGE_DIR),
    surveillanceActive: SURVEILLANCE_ACTIVE,
    telegram: {
      hasToken: !!TELEGRAM.botToken,
      chatId: TELEGRAM.chatId
    },
    dates: result
  });
});

function listKind(date, kind) {
  const dir = path.join(STORAGE_DIR, date, kind);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(safeName)
    .map(name => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, mtime: st.mtime };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

// 파일 스트리밍 / 다운로드
app.get('/api/file/:date/:kind/:filename', (req, res) => {
  const { date, kind, filename } = req.params;
  if (!safeDate(date) || !['video', 'snapshots'].includes(kind) || !safeName(filename)) {
    return res.status(400).end();
  }
  const file = path.join(STORAGE_DIR, date, kind, filename);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

// 파일 삭제
app.delete('/api/file/:date/:kind/:filename', (req, res) => {
  const { date, kind, filename } = req.params;
  if (!safeDate(date) || !['video', 'snapshots'].includes(kind) || !safeName(filename)) {
    return res.status(400).end();
  }
  const file = path.join(STORAGE_DIR, date, kind, filename);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
});

// 설정 변경 (저장 경로 / 보관일)
app.post('/api/config', (req, res) => {
  const { storageDir, retentionDays } = req.body || {};
  if (typeof storageDir === 'string' && storageDir.trim()) {
    const next = storageDir.trim();
    try {
      ensureDir(next);
      fs.accessSync(next, fs.constants.W_OK);
      STORAGE_DIR = next;
    } catch (e) {
      return res.status(400).json({ error: '경로에 쓰기 권한이 없습니다: ' + next });
    }
  }
  if (typeof retentionDays === 'number' && retentionDays >= 1 && retentionDays <= 365) {
    RETENTION_DAYS = Math.floor(retentionDays);
  }
  saveConfig();
  console.log(`[CONFIG] storage=${STORAGE_DIR}  retention=${RETENTION_DAYS}일`);
  res.json({ ok: true, storageDir: STORAGE_DIR, retentionDays: RETENTION_DAYS });
});

// ====================== 텔레그램 명령어 ======================
// long polling으로 사용자가 봇에게 보낸 명령어 수신
// 카메라/영상은 브라우저에 있으니, 브라우저가 실행해야 하는 명령은 큐에 쌓아두고
// 브라우저가 /api/poll 로 가져가서 처리한다.

let telegramOffset = 0;
let lastBrowserPing = 0;
const browserCommandQueue = []; // [{ id, cmd }]

function fmtBytesShort(n) {
  if (n == null) return '?';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(0) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(1) + ' GB';
}

async function sendTelegramText(text, chatId) {
  const cid = chatId || TELEGRAM.chatId;
  if (!TELEGRAM.botToken || !cid) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cid, text })
    });
  } catch (e) {
    console.error('[TG] 텍스트 전송 실패:', e.message);
  }
}

async function handleCommand(text) {
  const cmd = text.toLowerCase().split(/[\s@]/)[0];
  console.log(`[TG] 명령 수신: "${text}" → ${cmd}`);
  switch (cmd) {
    case '/start':
    case '/help':
      await sendTelegramText(
        '🎥 Office CCTV 명령어\n\n' +
        '/on   — 감시 모드 ON (자리 비울 때)\n' +
        '/off  — 감시 모드 OFF (자리에 있을 때)\n' +
        '/status — 현재 상태 보기\n' +
        '/snap — 지금 화면 1장 가져오기 (감시 ON 필요)\n' +
        '/last — 마지막 감지 사진 다시 보기\n' +
        '/help — 이 메시지\n\n' +
        '💡 감시 OFF 상태에서는 카메라 자체가 꺼져있고, 동작 감지·녹화·푸시 모두 안 합니다.'
      );
      break;
    case '/on':
      if (SURVEILLANCE_ACTIVE) {
        await sendTelegramText('🔴 이미 감시 모드 ON 입니다.');
        break;
      }
      SURVEILLANCE_ACTIVE = true;
      saveConfig();
      await sendTelegramText(
        '🔴 감시 모드 ON\n\n' +
        '카메라가 곧 켜집니다 (~3초).\n' +
        '동작 감지되면 즉시 사진 푸시.\n' +
        '돌아오시면 /off 로 꺼주세요.'
      );
      break;
    case '/off':
      if (!SURVEILLANCE_ACTIVE) {
        await sendTelegramText('⚪ 이미 감시 모드 OFF 입니다.');
        break;
      }
      SURVEILLANCE_ACTIVE = false;
      saveConfig();
      await sendTelegramText('⚪ 감시 모드 OFF\n카메라·녹화·푸시 모두 정지했습니다.');
      break;
    case '/status':
      await sendStatus();
      break;
    case '/snap':
      if (!SURVEILLANCE_ACTIVE) {
        await sendTelegramText('⚪ 감시 모드가 OFF 입니다.\n/on 으로 먼저 켜주세요.');
        break;
      }
      if (Date.now() - lastBrowserPing > 15000) {
        await sendTelegramText(
          '⚠️ 노트북 브라우저 탭이 연결되어 있지 않아요.\n' +
          '노트북이 켜져 있는지, http://localhost:3030 탭이 열려있는지 확인해주세요.'
        );
        break;
      }
      browserCommandQueue.push({ id: Date.now(), cmd: 'snap' });
      await sendTelegramText('📸 화면 가져오는 중... (3초 안에 도착)');
      break;
    case '/last':
      await sendLastAlert();
      break;
    default:
      await sendTelegramText(`❓ 알 수 없는 명령어: ${cmd}\n/help 로 명령어 목록 보기`);
  }
}

async function sendStatus() {
  const today = toLocalDate(new Date());
  let todayVideos = 0, todaySnaps = 0;
  try {
    todayVideos = fs.readdirSync(path.join(STORAGE_DIR, today, 'video')).length;
  } catch (e) {}
  try {
    todaySnaps = fs.readdirSync(path.join(STORAGE_DIR, today, 'snapshots')).length;
  } catch (e) {}

  const browserConnected = Date.now() - lastBrowserPing < 15000;
  const text =
    '🎥 Office CCTV 상태\n\n' +
    `${SURVEILLANCE_ACTIVE ? '🔴' : '⚪'} 감시 모드: ${SURVEILLANCE_ACTIVE ? 'ON' : 'OFF'}\n` +
    `🖥  브라우저 탭: ${browserConnected ? '연결됨' : '⚠️ 연결 안됨'}\n` +
    `📁 오늘 (${today}): 영상 ${todayVideos} · 스냅샷 ${todaySnaps}\n` +
    `💾 디스크 여유: ${fmtBytesShort(tryDiskFree(STORAGE_DIR))}\n` +
    `📍 ${STORAGE_DIR}`;
  await sendTelegramText(text);
}

async function sendLastAlert() {
  if (!fs.existsSync(STORAGE_DIR)) {
    await sendTelegramText('아직 감지된 이벤트가 없습니다.');
    return;
  }
  const dates = fs.readdirSync(STORAGE_DIR).filter(safeDate).sort().reverse();
  for (const date of dates) {
    const dir = path.join(STORAGE_DIR, date, 'snapshots');
    if (!fs.existsSync(dir)) continue;
    const alerts = fs
      .readdirSync(dir)
      .filter(f => f.endsWith('_alert.jpg'))
      .sort()
      .reverse();
    if (alerts.length === 0) continue;
    const buf = fs.readFileSync(path.join(dir, alerts[0]));
    const time = alerts[0].replace('_alert.jpg', '').replace(/-/g, ':');
    await sendTelegramPhoto(buf, `🎬 마지막 감지\n${date} ${time}`);
    return;
  }
  await sendTelegramText('아직 감지된 이벤트가 없습니다.');
}

async function telegramLoop() {
  console.log('[TG] polling loop 시작');
  // 서버 시작 시 쌓여있던 메시지는 건너뛰기
  try {
    if (TELEGRAM.botToken) {
      const r = await fetch(
        `https://api.telegram.org/bot${TELEGRAM.botToken}/getUpdates?offset=-1&timeout=0`
      );
      const d = await r.json();
      if (d.ok && d.result.length > 0) {
        telegramOffset = d.result[d.result.length - 1].update_id + 1;
        console.log(`[TG] 기존 업데이트 ${d.result.length}개 건너뛰기 → offset=${telegramOffset}`);
      } else {
        console.log('[TG] 기존 업데이트 없음');
      }
    }
  } catch (e) {
    console.log('[TG] drain 실패:', e.message);
  }

  while (true) {
    if (!TELEGRAM.botToken || !TELEGRAM.chatId) {
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }
    try {
      const url =
        `https://api.telegram.org/bot${TELEGRAM.botToken}/getUpdates` +
        `?offset=${telegramOffset}&timeout=25&allowed_updates=${encodeURIComponent('["message"]')}`;
      const r = await fetch(url);
      const d = await r.json();
      if (d.ok && d.result.length > 0) {
        for (const u of d.result) {
          telegramOffset = u.update_id + 1;
          const msg = u.message;
          if (!msg || !msg.text) continue;
          const fromChat = String(msg.chat.id);
          if (fromChat !== String(TELEGRAM.chatId)) {
            await sendTelegramText('🚫 등록된 사용자만 사용할 수 있습니다.', fromChat);
            continue;
          }
          handleCommand(msg.text.trim()).catch(e =>
            console.error('[TG] 명령 처리 실패:', e.message)
          );
        }
      }
    } catch (e) {
      console.error('[TG] polling 오류:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// 브라우저가 폴링 — 명령어 가져가기 + 살아있다고 알림 + 마스터 모드 상태
app.get('/api/poll', (req, res) => {
  lastBrowserPing = Date.now();
  const cmds = browserCommandQueue.splice(0);
  res.json({
    commands: cmds,
    surveillanceActive: SURVEILLANCE_ACTIVE
  });
});

// 브라우저 UI에서 마스터 모드 토글
app.post('/api/surveillance', (req, res) => {
  const { active } = req.body || {};
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'active 필요' });
  const wasOn = SURVEILLANCE_ACTIVE;
  SURVEILLANCE_ACTIVE = active;
  saveConfig();
  if (wasOn !== active) {
    console.log(`[MODE] 감시 ${active ? 'ON' : 'OFF'} (브라우저 UI)`);
    // 텔레그램으로도 알림 (양방향 동기화)
    if (TELEGRAM.botToken && TELEGRAM.chatId) {
      sendTelegramText(active ? '🔴 감시 모드 ON (브라우저에서 변경)' : '⚪ 감시 모드 OFF (브라우저에서 변경)');
    }
  }
  res.json({ ok: true, active: SURVEILLANCE_ACTIVE });
});

// 텔레그램으로 임의의 사진 즉시 푸시 (수동 /snap 응답용)
// 클라이언트가 /api/snapshots?urgent=1&caption=... 로 보내면 caption 사용
// (기존 /api/snapshots 로직에서 query.caption 추가 처리)

// ====================== 보관기간 자동 정리 ======================

function cleanup() {
  if (!fs.existsSync(STORAGE_DIR)) return;
  const cutoff = Date.now() - RETENTION_DAYS * 86400 * 1000;
  const dates = fs.readdirSync(STORAGE_DIR).filter(safeDate);
  for (const d of dates) {
    const t = new Date(d + 'T00:00:00').getTime();
    if (t < cutoff) {
      const dir = path.join(STORAGE_DIR, d);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`[CLEAN] ${d} 삭제 (보관기간 ${RETENTION_DAYS}일 초과)`);
      } catch (e) {}
    }
  }
}
setInterval(cleanup, 60 * 60 * 1000);
cleanup();

function toLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function toLocalTime(d) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
function tryDiskFree(p) {
  try {
    const { execSync } = require('child_process');
    const out = execSync(`df -k "${p}" | tail -1`).toString().trim().split(/\s+/);
    const free = parseInt(out[3], 10) * 1024;
    return free;
  } catch (e) {
    return null;
  }
}

app.listen(PORT, () => {
  console.log('');
  console.log('  🎥  Office CCTV 서버 시작');
  console.log('  ────────────────────────────────────');
  console.log(`  접속 URL    : http://localhost:${PORT}`);
  console.log(`  저장 경로   : ${STORAGE_DIR}`);
  console.log(`  보관 기간   : ${RETENTION_DAYS}일 (이후 자동 삭제)`);
  console.log('');
  console.log('  ⚠️  처음 접속 시 브라우저가 카메라 권한을 요청합니다.');
  console.log('  ⚠️  탭을 닫지 마세요. 백그라운드 창은 OK, 닫으면 녹화 중단.');
  console.log('  ⚠️  노트북은 뚜껑을 열어두세요 (덮으면 카메라가 꺼집니다).');
  console.log('');
  if (TELEGRAM.botToken && TELEGRAM.chatId) {
    console.log('  📱  텔레그램 명령 수신 대기 중 — /help 로 명령어 보기');
    console.log('');
  }
  telegramLoop().catch(e => console.error('[TG] loop 종료:', e.message));
});
