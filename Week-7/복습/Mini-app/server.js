// ========================================
// Members Mini-app — Backend (Express + JWT + bcrypt + TossPayments)
// 데이터: ./db.json (JSON 파일 storage)
// ========================================
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'mini-app-dev-secret-change-me-in-prod';

// TossPayments 테스트 키 (필요 시 .env로 교체)
const TOSS_CLIENT_KEY = process.env.TOSS_CLIENT_KEY || 'test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm';
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY || 'test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6';

const DB_PATH = path.join(__dirname, 'db.json');

app.use(express.json());

// ========================================
// JSON 파일 storage
// ========================================
function loadDB() {
  if (!fs.existsSync(DB_PATH)) return { users: [], intents: [], orders: [] };
  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    db.users = db.users || [];
    db.intents = db.intents || [];
    db.orders = db.orders || [];
    return db;
  } catch {
    return { users: [], intents: [], orders: [] };
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function authRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const db = loadDB();
    const user = db.users.find(u => u.id === payload.sub);
    if (!user) return res.status(401).json({ error: '유효하지 않은 토큰입니다.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: '토큰이 만료되었거나 유효하지 않습니다.' });
  }
}

function safeUser(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}

const PLANS = {
  monthly: { name: '월간 멤버십', price: 9900 },
  yearly:  { name: '연간 멤버십', price: 99000 },
};

// ========================================
// 공개 설정 (클라이언트에서 가져감)
// ========================================
app.get('/api/config', (req, res) => {
  res.json({ tossClientKey: TOSS_CLIENT_KEY });
});

// ========================================
// 회원가입
// ========================================
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: '올바른 이메일을 입력해주세요.' });
    }
    if (!password || password.length < 4) {
      return res.status(400).json({ error: '비밀번호는 4자 이상이어야 합니다.' });
    }

    const db = loadDB();
    const exists = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (exists) {
      return res.status(409).json({ error: '이미 가입된 이메일이에요.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      email: email.toLowerCase(),
      name: name?.trim() || email.split('@')[0],
      passwordHash,
      member: false,
      plan: null,
      paidAt: null,
      createdAt: new Date().toISOString(),
    };
    db.users.push(user);
    saveDB(db);

    res.json({ token: issueToken(user), user: safeUser(user) });
  } catch (e) {
    console.error('[signup]', e);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ========================================
// 로그인
// ========================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });
    }

    const db = loadDB();
    const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 일치하지 않아요.' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 일치하지 않아요.' });
    }

    res.json({ token: issueToken(user), user: safeUser(user) });
  } catch (e) {
    console.error('[login]', e);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ========================================
// 내 정보
// ========================================
app.get('/api/me', authRequired, (req, res) => {
  res.json({ user: safeUser(req.user) });
});

// ========================================
// 결제 인텐트 — 토스 위젯 호출 직전에 서버에 주문 등록
// (서버가 amount를 보관해서 confirm 단계에서 검증)
// ========================================
app.post('/api/payment/intent', authRequired, (req, res) => {
  try {
    const { plan } = req.body || {};
    if (!PLANS[plan]) return res.status(400).json({ error: '플랜을 선택해주세요.' });

    const orderId = `mini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const intent = {
      orderId,
      userId: req.user.id,
      plan,
      orderName: PLANS[plan].name,
      amount: PLANS[plan].price,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    const db = loadDB();
    db.intents.push(intent);
    saveDB(db);

    res.json({
      orderId: intent.orderId,
      orderName: intent.orderName,
      amount: intent.amount,
      customerEmail: req.user.email,
      customerName: req.user.name,
    });
  } catch (e) {
    console.error('[intent]', e);
    res.status(500).json({ error: '주문 생성에 실패했습니다.' });
  }
});

// ========================================
// 결제 승인 — 토스 successUrl이 호출된 후 클라이언트가 호출
// 1) 서버에 등록된 amount와 일치하는지 검증
// 2) 토스 승인 API 호출
// 3) 주문 저장 + user 멤버 업그레이드
// ========================================
app.post('/api/payment/confirm', authRequired, async (req, res) => {
  try {
    const { paymentKey, orderId, amount } = req.body || {};
    if (!paymentKey || !orderId || amount == null) {
      return res.status(400).json({ error: '결제 정보가 누락되었습니다.' });
    }

    const db = loadDB();
    const intent = db.intents.find(i => i.orderId === orderId);
    if (!intent) return res.status(404).json({ error: '주문을 찾을 수 없습니다.' });
    if (intent.userId !== req.user.id) {
      return res.status(403).json({ error: '주문 소유자가 아닙니다.' });
    }
    if (Number(amount) !== Number(intent.amount)) {
      return res.status(400).json({ error: '결제 금액이 일치하지 않습니다.' });
    }
    // 이미 처리된 주문 체크 (idempotent — 멱등성)
    const already = db.orders.find(o => o.orderId === orderId);
    if (already) return res.json({ user: safeUser(req.user), order: already });

    // 토스페이먼츠 승인 API
    const encodedKey = Buffer.from(`${TOSS_SECRET_KEY}:`).toString('base64');
    const tossRes = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${encodedKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) }),
    });
    const tossData = await tossRes.json();
    if (!tossRes.ok) {
      console.error('[toss confirm fail]', tossData);
      return res.status(400).json({
        error: tossData.message || '토스 결제 승인에 실패했습니다.',
        code: tossData.code,
      });
    }

    // 인텐트 상태 업데이트
    intent.status = 'paid';
    intent.paidAt = new Date().toISOString();

    // 주문 저장
    const order = {
      orderId,
      userId: req.user.id,
      plan: intent.plan,
      orderName: intent.orderName,
      amount: Number(amount),
      paymentKey,
      method: tossData.method || 'card',
      approvedAt: tossData.approvedAt || new Date().toISOString(),
      receiptUrl: tossData.receipt?.url || null,
      raw: { card: tossData.card || null, easyPay: tossData.easyPay || null },
    };
    db.orders.push(order);

    // 유저 멤버 업그레이드
    const idx = db.users.findIndex(u => u.id === req.user.id);
    db.users[idx] = {
      ...db.users[idx],
      member: true,
      plan: intent.plan,
      paidAt: order.approvedAt,
    };
    saveDB(db);

    res.json({ user: safeUser(db.users[idx]), order });
  } catch (e) {
    console.error('[confirm]', e);
    res.status(500).json({ error: '결제 승인 중 서버 오류가 발생했습니다.' });
  }
});

// ========================================
// 결제 내역 (내 주문 목록)
// ========================================
app.get('/api/orders', authRequired, (req, res) => {
  const db = loadDB();
  const myOrders = db.orders
    .filter(o => o.userId === req.user.id)
    .sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt));
  res.json({ orders: myOrders });
});

// ========================================
// 멤버십 해지 (구독 중단 — 결제 내역은 그대로 유지)
// ========================================
app.post('/api/membership/cancel', authRequired, (req, res) => {
  try {
    const db = loadDB();
    const idx = db.users.findIndex(u => u.id === req.user.id);
    if (idx === -1) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });

    db.users[idx] = { ...db.users[idx], member: false, plan: null, paidAt: null };
    saveDB(db);
    res.json({ user: safeUser(db.users[idx]) });
  } catch (e) {
    console.error('[cancel]', e);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ========================================
// 정적 파일 서빙 + SPA fallback
// ========================================
app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
  console.log(`✅ Members Mini-app server running at http://localhost:${PORT}`);
  console.log(`   TossPayments client key: ${TOSS_CLIENT_KEY.slice(0, 24)}…`);
});
