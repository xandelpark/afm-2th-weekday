require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3007;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@aperture.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ApertureAdmin2026!';
const TOSS_CLIENT_KEY = process.env.TOSS_CLIENT_KEY || 'test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm';
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY || 'test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6';

app.use(express.json());
app.use(express.static(__dirname));

const DB_PATH = path.join(__dirname, 'db.json');
const loadDB = () => {
  if (!fs.existsSync(DB_PATH)) return { users: [] };
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')); }
  catch { return { users: [] }; }
};
const saveDB = (db) => fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

(async () => {
  const db = loadDB();
  if (!db.users.some((u) => u.email === ADMIN_EMAIL)) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    db.users.push({
      id: 'u-admin-' + Date.now(),
      email: ADMIN_EMAIL,
      passwordHash: hash,
      role: 'admin',
      createdAt: new Date().toISOString(),
      unlocked: [],
      unlockedHistory: [],
    });
    saveDB(db);
    console.log('[seed] 어드민 계정 생성:', ADMIN_EMAIL);
  }
})();

const auth = (required = true) => (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    if (required) return res.status(401).json({ error: '로그인이 필요합니다' });
    req.user = null;
    return next();
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: '유효하지 않은 토큰' });
  }
};

const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '관리자 권한이 필요합니다' });
  }
  next();
};

const sanitize = (u) => ({
  id: u.id, email: u.email, role: u.role,
  unlocked: u.unlocked || [], createdAt: u.createdAt,
});

app.post('/api/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: '이메일과 비밀번호를 입력하세요' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: '이메일 형식이 올바르지 않습니다' });
  if (password.length < 6) return res.status(400).json({ error: '비밀번호는 최소 6자 이상' });
  const db = loadDB();
  if (db.users.some((u) => u.email === email)) return res.status(409).json({ error: '이미 가입된 이메일입니다' });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: 'u-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    email, passwordHash, role: 'user',
    createdAt: new Date().toISOString(),
    unlocked: [], unlockedHistory: [],
  };
  db.users.push(user);
  saveDB(db);
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: sanitize(user) });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: '이메일과 비밀번호를 입력하세요' });
  const db = loadDB();
  const user = db.users.find((u) => u.email === email);
  if (!user) return res.status(401).json({ error: '이메일 또는 비밀번호가 잘못되었습니다' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: '이메일 또는 비밀번호가 잘못되었습니다' });
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: sanitize(user) });
});

app.get('/api/me', auth(true), (req, res) => {
  const db = loadDB();
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
  res.json(sanitize(user));
});

app.get('/api/config', (req, res) => {
  res.json({ clientKey: TOSS_CLIENT_KEY });
});

app.post('/api/orders', auth(true), (req, res) => {
  const { contentId, amount } = req.body || {};
  if (!contentId || !amount) return res.status(400).json({ error: 'contentId, amount 필수' });
  const db = loadDB();
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
  if (user.unlocked.includes(contentId)) return res.status(409).json({ error: '이미 결제된 콘텐츠입니다' });
  const orderId = 'order_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  if (!user.orders) user.orders = [];
  user.orders.push({
    orderId, contentId, amount: Number(amount),
    status: 'pending', createdAt: new Date().toISOString(),
  });
  saveDB(db);
  console.log(`[주문] ${orderId} | ${user.email} | ${contentId} | ${amount}원`);
  res.json({ orderId, amount: Number(amount), customerKey: user.id });
});

app.post('/api/payments/confirm', auth(true), async (req, res) => {
  const { paymentKey, orderId, amount } = req.body || {};
  if (!paymentKey || !orderId || !amount) {
    return res.status(400).json({ error: 'paymentKey, orderId, amount 필수' });
  }
  const db = loadDB();
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
  const order = (user.orders || []).find((o) => o.orderId === orderId);
  if (!order) return res.status(404).json({ error: '주문을 찾을 수 없습니다' });
  if (order.amount !== Number(amount)) {
    return res.status(400).json({ error: '주문 금액이 일치하지 않습니다' });
  }
  try {
    const basicAuth = Buffer.from(`${TOSS_SECRET_KEY}:`).toString('base64');
    const response = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('[승인 실패]', data);
      order.status = 'failed';
      order.failReason = data.message;
      saveDB(db);
      return res.status(response.status).json({ error: data.message, code: data.code });
    }
    order.status = 'completed';
    order.paidAt = new Date().toISOString();
    order.paymentKey = paymentKey;
    order.method = data.method;
    if (!user.unlocked.includes(order.contentId)) user.unlocked.push(order.contentId);
    if (!user.unlockedHistory) user.unlockedHistory = [];
    user.unlockedHistory.push({
      contentId: order.contentId, price: order.amount,
      paymentKey, orderId, method: data.method,
      at: order.paidAt,
    });
    saveDB(db);
    console.log(`[승인 성공] ${orderId} | ${user.email} | ${order.contentId}`);
    res.json({ ok: true, contentId: order.contentId, unlocked: user.unlocked });
  } catch (e) {
    console.error('[결제 승인 에러]', e);
    res.status(500).json({ error: '결제 승인 중 서버 오류가 발생했습니다' });
  }
});

app.get('/api/me/orders', auth(true), (req, res) => {
  const db = loadDB();
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
  res.json(user.orders || []);
});

app.get('/api/admin/users', auth(true), adminOnly, (req, res) => {
  const db = loadDB();
  res.json(db.users.map((u) => ({
    id: u.id, email: u.email, role: u.role, createdAt: u.createdAt,
    unlockedCount: (u.unlocked || []).length,
    revenue: (u.unlockedHistory || []).reduce((s, h) => s + (h.price || 0), 0),
    history: u.unlockedHistory || [],
  })));
});

app.get('/api/admin/stats', auth(true), adminOnly, (req, res) => {
  const db = loadDB();
  const totalRevenue = db.users.reduce(
    (sum, u) => sum + (u.unlockedHistory || []).reduce((s, h) => s + (h.price || 0), 0), 0
  );
  res.json({
    userCount: db.users.length,
    adminCount: db.users.filter((u) => u.role === 'admin').length,
    totalUnlocks: db.users.reduce((s, u) => s + (u.unlocked || []).length, 0),
    totalRevenue,
  });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`[server] http://localhost:${PORT}`));
