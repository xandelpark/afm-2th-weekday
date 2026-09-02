// 코워크(worktime) — 프리랜서 타임시트 서버
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const webpush = require('web-push');

const PORT = process.env.PORT || 3011;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const VAPID_PUBLIC = process.env.VAPID_PUBLIC;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails('mailto:admin@worktime.local', VAPID_PUBLIC, VAPID_PRIVATE);
}

if (!process.env.DATABASE_URL || !JWT_SECRET || !ADMIN_PASSWORD) {
  console.error('[치명] .env에 DATABASE_URL / JWT_SECRET / ADMIN_PASSWORD 가 모두 필요합니다.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 8,
});

// ── 시간 유틸: 모든 근무일 계산은 KST(UTC+9) 기준 ──
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 기준 근무일(YYYY-MM-DD) */
function workDate(d = new Date()) {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}
/** 'HH:MM' + KST 근무일 → UTC Date */
function kstTime(dateStr, hhmm) {
  return new Date(`${dateStr}T${hhmm}:00+09:00`);
}

// ── 정책 (캐시) ──
let policyCache = null;
let policyAt = 0;
async function getPolicy() {
  if (policyCache && Date.now() - policyAt < 30000) return policyCache;
  const r = await pool.query(`select value from worktime.settings where key='policy'`);
  policyCache = r.rows[0]?.value || {
    work_start: '08:00', work_end: '20:00',
    core_start: '10:00', core_end: '15:00',
    alert_core_end: true, alert_no_checkout: true,
  };
  policyAt = Date.now();
  return policyCache;
}

/**
 * 작업 종료를 누르지 않은 채 날이 바뀐 기록을 정리한다.
 * 시각을 임의로 지어내지 않고 열린 채로 마감해서, 작가 화면에 '종료 기록 없음'으로 드러나게 한다.
 * 조회 시점마다 호출해 별도 크론 없이 일관성을 유지한다.
 */
async function sweep(client = pool) {
  await client.query(
    `update worktime.sessions
        set end_reason = 'no_checkout'
      where ended_at is null
        and end_reason is null
        and work_date < $1::date`,
    [workDate()]
  );
}

// ── 웹 푸시 ──
/** 한 프리랜서의 모든 구독 기기로 알림을 보낸다. 만료된 구독은 정리. */
async function pushTo(workerId, payload) {
  if (!VAPID_PUBLIC) return 0;
  const subs = await pool.query(
    `select id, endpoint, p256dh, auth from worktime.push_subs where worker_id=$1`, [workerId]
  );
  let sent = 0;
  for (const s of subs.rows) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
      sent++;
    } catch (e) {
      // 410 Gone / 404 = 구독 만료 → 삭제
      if (e.statusCode === 410 || e.statusCode === 404) {
        await pool.query(`delete from worktime.push_subs where id=$1`, [s.id]);
      } else {
        console.warn('[푸시 실패]', e.statusCode || e.message);
      }
    }
  }
  return sent;
}

/** 하루 한 번만 보내도록 예약 (중복 방지) */
async function claimAlert(workerId, kind) {
  const r = await pool.query(
    `insert into worktime.alerts (worker_id, work_date, kind) values ($1,$2,$3)
     on conflict (worker_id, work_date, kind) do nothing returning id`,
    [workerId, workDate(), kind]
  );
  return r.rowCount > 0;
}

/**
 * 알림 스케줄러 — 30초마다 확인.
 *  1) 코어타임 종료(기본 15:00) → 작업 중인 사람에게 "코어타임 끝났습니다" 알림
 *  2) 작업 가능 종료(기본 20:00)가 지나도 종료를 안 누른 사람에게 리마인더
 * 웹 푸시라 브라우저를 닫아도 OS 알림으로 뜬다.
 */
async function runAlerts() {
  try {
    const p = await getPolicy();
    const today = workDate();
    const now = new Date();

    if (p.alert_core_end !== false) {
      const coreEnd = kstTime(today, p.core_end);
      // 코어타임 종료 후 10분 이내에만 발송 (서버 재시작 시 과거분 폭주 방지)
      if (now >= coreEnd && now - coreEnd < 10 * 60 * 1000) {
        const act = await pool.query(
          `select distinct worker_id from worktime.sessions
            where work_date=$1 and ended_at is null and end_reason is null`, [today]
        );
        for (const row of act.rows) {
          if (await claimAlert(row.worker_id, 'core_end')) {
            await pushTo(row.worker_id, {
              title: '코어타임이 끝났습니다',
              body: `${p.core_start}~${p.core_end} 코어타임을 채우셨어요. 계속 작업 중이면 그대로 두시면 됩니다.`,
              tag: 'core_end',
            });
          }
        }
      }
    }

    // 작업 가능 시간이 지나도 종료를 안 눌렀으면 알려준다 (기록이 비는 걸 막는다)
    if (p.alert_no_checkout !== false) {
      const workEnd = kstTime(today, p.work_end);
      if (now >= workEnd && now - workEnd < 60 * 60 * 1000) {
        const open = await pool.query(
          `select distinct worker_id from worktime.sessions
            where work_date=$1 and ended_at is null and end_reason is null`, [today]
        );
        for (const row of open.rows) {
          if (await claimAlert(row.worker_id, 'no_checkout')) {
            await pushTo(row.worker_id, {
              title: '작업 종료를 눌러주세요',
              body: '아직 작업 중으로 남아 있어요. 누르지 않으면 오늘 작업시간이 기록되지 않아요.',
              tag: 'no_checkout',
              requireInteraction: true,
            });
          }
        }
      }
    }
  } catch (e) {
    console.warn('[알림 스케줄러]', e.message);
  }
}

// ── HTTP 유틸 ──
function send(res, code, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
      if (b.length > 1e6) { reject(new Error('본문이 너무 큽니다')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error('JSON 형식이 아닙니다')); } });
    req.on('error', reject);
  });
}
function auth(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!t) return null;
  try { return jwt.verify(t, JWT_SECRET); } catch { return null; }
}
function maskCode(code) {
  if (code.length <= 2) return '••';
  return code[0] + '•'.repeat(code.length - 2) + code[code.length - 1];
}

// ── 집계: 세션 목록 → 근무시간·코어타임 ──
function overlapMs(aStart, aEnd, bStart, bEnd) {
  const s = Math.max(aStart.getTime(), bStart.getTime());
  const e = Math.min(aEnd.getTime(), bEnd.getTime());
  return Math.max(0, e - s);
}
function summarize(sessions, dateStr, policy, now = new Date()) {
  const coreS = kstTime(dateStr, policy.core_start);
  const coreE = kstTime(dateStr, policy.core_end);
  let workMs = 0, coreMs = 0, first = null, last = null;
  let working = false, noCheckout = false;
  const segments = [];

  for (const s of sessions) {
    const st = new Date(s.started_at);
    if (s.end_reason === 'no_checkout') {
      // 작업 종료을 안 눌러 끝을 모르는 기록. 근무시간에 넣으면 숫자를 지어내는 셈이라 제외한다.
      noCheckout = true;
      if (!first || st < first) first = st;
      segments.push({ in: st.toISOString(), out: null, reason: 'no_checkout', ms: 0 });
      continue;
    }
    const en = s.ended_at ? new Date(s.ended_at) : now;
    if (!s.ended_at) working = true;
    workMs += Math.max(0, en - st);
    coreMs += overlapMs(st, en, coreS, coreE);
    if (!first || st < first) first = st;
    if (!last || en > last) last = en;
    segments.push({
      in: st.toISOString(),
      out: s.ended_at ? en.toISOString() : null,
      reason: s.end_reason || (s.ended_at ? 'checkout' : 'working'),
      ms: Math.max(0, en - st),
    });
  }
  segments.sort((a, b) => a.in.localeCompare(b.in));
  const coreTotalMs = coreE - coreS;
  return {
    work_ms: workMs,
    core_ms: coreMs,
    core_total_ms: coreTotalMs,
    core_rate: coreTotalMs > 0 ? Math.min(1, coreMs / coreTotalMs) : 0,
    core_met: coreMs >= coreTotalMs - 60 * 1000, // 1분 오차 허용
    first_in: first ? first.toISOString() : null,
    last_out: last ? last.toISOString() : null,
    working,
    no_checkout: noCheckout,
    checked_in: sessions.length > 0,
    session_count: sessions.length,
    segments,
  };
}

// ── 라우트 ──
const routes = {
  // 프리랜서: 접속 코드 로그인 (작업 시작은 별도 버튼)
  'POST /api/login': async (req, res) => {
    const { code } = await readBody(req);
    if (!code || typeof code !== 'string') return send(res, 400, { error: '접속 코드를 입력해주세요' });

    const r = await pool.query(`select id, name, code_hash from worktime.workers where active = true`);
    let hit = null;
    for (const w of r.rows) {
      if (await bcrypt.compare(code.trim(), w.code_hash)) { hit = w; break; }
    }
    if (!hit) return send(res, 401, { error: '접속 코드가 올바르지 않습니다' });

    await sweep();
    // 로그인만으로 시작 처리하지 않는다 — 작업 시작을 눌렀는지가 확인 대상이므로.
    const token = jwt.sign({ role: 'worker', wid: hit.id, name: hit.name }, JWT_SECRET, { expiresIn: '14h' });
    send(res, 200, { token, name: hit.name, role: 'worker' });
  },

  // 작가 로그인
  'POST /api/admin/login': async (req, res) => {
    const { password } = await readBody(req);
    if (!password || password !== ADMIN_PASSWORD) {
      await new Promise((r) => setTimeout(r, 400)); // 무차별 대입 완화
      return send(res, 401, { error: '비밀번호가 올바르지 않습니다' });
    }
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
    send(res, 200, { token, role: 'admin' });
  },

  // 작업 시작
  'POST /api/checkin': async (req, res) => {
    const u = auth(req);
    if (!u || u.role !== 'worker') return send(res, 401, { error: '인증이 필요합니다' });
    await sweep();
    const today = workDate();
    const open = await pool.query(
      `select id from worktime.sessions
        where worker_id=$1 and ended_at is null and end_reason is null`, [u.wid]
    );
    if (open.rowCount > 0) return send(res, 409, { error: '이미 작업 중입니다' });

    await pool.query(
      `insert into worktime.sessions (worker_id, work_date, started_at)
       values ($1, $2, now())`,
      [u.wid, today]
    );
    send(res, 200, { ok: true, at: new Date().toISOString() });
  },

  // 작업 종료
  'POST /api/checkout': async (req, res) => {
    const u = auth(req);
    if (!u || u.role !== 'worker') return send(res, 401, { error: '인증이 필요합니다' });
    const r = await pool.query(
      `update worktime.sessions set ended_at = now(), end_reason='checkout'
        where worker_id=$1 and ended_at is null and end_reason is null
        returning started_at, ended_at`,
      [u.wid]
    );
    if (!r.rowCount) return send(res, 409, { error: '시작 기록이 없습니다' });
    send(res, 200, { ok: true, at: new Date().toISOString() });
  },

  // 프리랜서 본인 오늘 기록
  'GET /api/me': async (req, res, url) => {
    const u = auth(req);
    if (!u || u.role !== 'worker') return send(res, 401, { error: '인증이 필요합니다' });
    await sweep();
    const p = await getPolicy();
    const date = url.searchParams.get('date') || workDate();
    const r = await pool.query(
      `select started_at, ended_at, end_reason from worktime.sessions
        where worker_id=$1 and work_date=$2 order by started_at`,
      [u.wid, date]
    );
    send(res, 200, {
      name: u.name, date, policy: p,
      sessions: r.rows,
      summary: summarize(r.rows, date, p),
      server_time: new Date().toISOString(),
    });
  },

  // 작가: 팀 현황 (특정 날짜)
  'GET /api/admin/overview': async (req, res, url) => {
    const u = auth(req);
    if (!u || u.role !== 'admin') return send(res, 401, { error: '인증이 필요합니다' });
    await sweep();
    const p = await getPolicy();
    const date = url.searchParams.get('date') || workDate();

    const ws = await pool.query(
      `select id, name, code_hint, active from worktime.workers order by active desc, name`
    );
    const ss = await pool.query(
      `select worker_id, started_at, ended_at, end_reason from worktime.sessions
        where work_date=$1 order by started_at`,
      [date]
    );
    const byWorker = new Map();
    for (const s of ss.rows) {
      if (!byWorker.has(s.worker_id)) byWorker.set(s.worker_id, []);
      byWorker.get(s.worker_id).push(s);
    }
    const workers = ws.rows.map((w) => ({
      ...w,
      sessions: byWorker.get(w.id) || [],
      summary: summarize(byWorker.get(w.id) || [], date, p),
    }));
    send(res, 200, { date, policy: p, workers, server_time: new Date().toISOString() });
  },

  // 작가: 월별 집계
  'GET /api/admin/month': async (req, res, url) => {
    const u = auth(req);
    if (!u || u.role !== 'admin') return send(res, 401, { error: '인증이 필요합니다' });
    await sweep();
    const p = await getPolicy();
    const month = url.searchParams.get('month') || workDate().slice(0, 7); // YYYY-MM

    const ws = await pool.query(`select id, name from worktime.workers where active = true order by name`);
    const ss = await pool.query(
      `select worker_id, work_date, started_at, ended_at, end_reason from worktime.sessions
        where to_char(work_date,'YYYY-MM') = $1 order by work_date, started_at`,
      [month]
    );
    const key = (w, d) => `${w}|${d}`;
    const grouped = new Map();
    for (const s of ss.rows) {
      const d = workDate(new Date(s.work_date));
      const k = key(s.worker_id, d);
      if (!grouped.has(k)) grouped.set(k, []);
      grouped.get(k).push(s);
    }
    const rows = [];
    for (const w of ws.rows) {
      const days = [];
      for (const [k, list] of grouped) {
        const [wid, d] = k.split('|');
        // pg는 bigint를 문자열로 돌려준다. 숫자와 직접 비교하면 항상 어긋나므로 문자열로 맞춘다.
        if (String(wid) !== String(w.id)) continue;
        days.push({ date: d, ...summarize(list, d, p) });
      }
      days.sort((a, b) => a.date.localeCompare(b.date));
      rows.push({
        worker_id: w.id, name: w.name, days,
        total_ms: days.reduce((a, b) => a + b.work_ms, 0),
        core_met_days: days.filter((d) => d.core_met).length,
        no_checkout_days: days.filter((d) => d.no_checkout).length,
        worked_days: days.length,
      });
    }
    send(res, 200, { month, policy: p, rows });
  },

  // 작가: 프리랜서 등록
  'POST /api/admin/workers': async (req, res) => {
    const u = auth(req);
    if (!u || u.role !== 'admin') return send(res, 401, { error: '인증이 필요합니다' });
    const { name } = await readBody(req);
    if (!name || !name.trim()) return send(res, 400, { error: '이름을 입력해주세요' });

    // 접속 코드는 서버가 생성해 1회만 보여준다 (이후 해시만 보관)
    const code = String(crypto.randomInt(100000, 1000000));
    const hash = await bcrypt.hash(code, 10);
    const r = await pool.query(
      `insert into worktime.workers (name, code_hash, code_hint) values ($1,$2,$3) returning id, name`,
      [name.trim(), hash, maskCode(code)]
    );
    send(res, 200, { worker: r.rows[0], code, notice: '이 코드는 다시 볼 수 없습니다. 지금 전달해주세요.' });
  },

  // 작가: 코드 재발급 / 활성 토글 / 삭제
  'POST /api/admin/workers/reset': async (req, res) => {
    const u = auth(req);
    if (!u || u.role !== 'admin') return send(res, 401, { error: '인증이 필요합니다' });
    const { id } = await readBody(req);
    const code = String(crypto.randomInt(100000, 1000000));
    const hash = await bcrypt.hash(code, 10);
    const r = await pool.query(
      `update worktime.workers set code_hash=$1, code_hint=$2 where id=$3 returning id, name`,
      [hash, maskCode(code), id]
    );
    if (!r.rowCount) return send(res, 404, { error: '없는 리터쳐입니다' });
    send(res, 200, { worker: r.rows[0], code });
  },
  'POST /api/admin/workers/toggle': async (req, res) => {
    const u = auth(req);
    if (!u || u.role !== 'admin') return send(res, 401, { error: '인증이 필요합니다' });
    const { id } = await readBody(req);
    const r = await pool.query(
      `update worktime.workers set active = not active where id=$1 returning id, name, active`, [id]
    );
    if (!r.rowCount) return send(res, 404, { error: '없는 리터쳐입니다' });
    send(res, 200, { worker: r.rows[0] });
  },

  // 푸시 구독 등록 (프리랜서)
  'POST /api/push/subscribe': async (req, res) => {
    const u = auth(req);
    if (!u || u.role !== 'worker') return send(res, 401, { error: '인증이 필요합니다' });
    const sub = await readBody(req);
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return send(res, 400, { error: '구독 정보가 올바르지 않습니다' });
    }
    await pool.query(
      `insert into worktime.push_subs (worker_id, endpoint, p256dh, auth) values ($1,$2,$3,$4)
       on conflict (endpoint) do update set worker_id = excluded.worker_id`,
      [u.wid, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
    );
    send(res, 200, { ok: true });
  },

  // 푸시 공개키 (구독에 필요)
  'GET /api/push/key': async (req, res) => {
    send(res, 200, { key: VAPID_PUBLIC || null });
  },

  // 서비스워커가 푸시를 받았는지 되알림 (진단용)
  // 알림이 안 뜰 때 "브라우저까지 안 왔다" vs "왔는데 OS가 안 보여줬다"를 구분한다.
  'POST /api/push/ack': async (req, res) => {
    const b = await readBody(req).catch(() => ({}));
    console.log(`[푸시 도달] stage=${b.stage} id=${b.id || '-'} ${b.detail || ''}`);
    send(res, 200, { ok: true });
  },

  // 알림 테스트 (프리랜서 본인)
  'POST /api/push/test': async (req, res) => {
    const u = auth(req);
    if (!u || u.role !== 'worker') return send(res, 401, { error: '인증이 필요합니다' });
    const id = crypto.randomBytes(4).toString('hex');
    console.log(`[푸시 테스트] 발송 id=${id} worker=${u.wid}`);
    const n = await pushTo(u.wid, {
      title: '알림 테스트',
      body: '이 알림이 보이면 정상입니다. 창을 내려도 알림이 옵니다.',
      tag: 'test',
      ack: id,
    });
    send(res, 200, { sent: n, id });
  },

  // 작가: 정책 수정
  'POST /api/admin/policy': async (req, res) => {
    const u = auth(req);
    if (!u || u.role !== 'admin') return send(res, 401, { error: '인증이 필요합니다' });
    const body = await readBody(req);
    const cur = await getPolicy();
    const next = { ...cur, ...body };
    await pool.query(
      `insert into worktime.settings (key,value) values ('policy',$1)
       on conflict (key) do update set value = excluded.value`,
      [JSON.stringify(next)]
    );
    policyCache = null;
    send(res, 200, { policy: next });
  },
};

// ── 서버 ──
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = `${req.method} ${url.pathname}`;

  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (routes[key]) {
    try {
      return await routes[key](req, res, url);
    } catch (e) {
      console.error('[오류]', key, e.message);
      return send(res, 500, { error: '서버 오류가 발생했습니다' });
    }
  }

  // 정적 파일
  if (req.method === 'GET') {
    const file = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const safe = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
    const full = path.join(__dirname, safe);
    if (full.startsWith(__dirname) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      const ext = path.extname(full);
      const type = ext === '.html' ? 'text/html; charset=utf-8'
                 : ext === '.js' ? 'text/javascript; charset=utf-8'
                 : ext === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
      // 앱 코드를 고쳐도 브라우저가 옛 파일을 붙들고 있으면 새로고침이 소용없다.
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache, must-revalidate' });
      return res.end(fs.readFileSync(full));
    }
  }
  send(res, 404, { error: '없는 경로입니다' });
});

server.listen(PORT, () => {
  console.log(`코워크 서버 실행 → http://localhost:${PORT}`);
  console.log(VAPID_PUBLIC ? '웹 푸시 활성' : '웹 푸시 비활성 (VAPID 키 없음)');
});

// 알림 스케줄러 · 유휴 정리 (30초 주기)
setInterval(runAlerts, 30 * 1000);
setInterval(() => sweep().catch(() => {}), 60 * 1000);
