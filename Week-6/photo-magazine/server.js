// 잡지 컨셉 사진/마케팅 블로그 — 유료/무료 콘텐츠 + TossPayments
require("dotenv").config();
const path = require("path");
const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3030;
const JWT_SECRET = (process.env.JWT_SECRET || "").trim();
const JWT_EXPIRES = "7d";

const TOSS_CLIENT_KEY = (process.env.TOSS_CLIENT_KEY || "").trim();
const TOSS_SECRET_KEY = (process.env.TOSS_SECRET_KEY || "").trim();
const TOSS_API_BASE = "https://api.tosspayments.com/v1/payments";

if (!JWT_SECRET) {
  console.error("❌ JWT_SECRET 환경변수가 비어있습니다.");
  process.exit(1);
}
if (!TOSS_CLIENT_KEY || !TOSS_SECRET_KEY) {
  console.warn("⚠️  TOSS_CLIENT_KEY / TOSS_SECRET_KEY 환경변수가 비어있습니다.");
}

const pool = new Pool({ connectionString: (process.env.DATABASE_URL || "").trim() });

app.use(express.json());
app.use(express.static(__dirname));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));

// ── 유틸 ─────────────────────────────────────────────
function issueToken(u) {
  return jwt.sign(
    { sub: u.id, email: u.email, name: u.name, role: u.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}
function isValidEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function sanitizeUser(row) {
  if (!row) return null;
  const { password_hash, ...safe } = row;
  return safe;
}

// 인증 미들웨어 (필수)
function requireAuth(req, res, next) {
  const m = (req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (!m) return res.status(401).json({ error: "로그인이 필요합니다" });
  try {
    const p = jwt.verify(m[1], JWT_SECRET);
    req.user = { id: Number(p.sub), email: p.email, name: p.name, role: p.role };
    next();
  } catch (_e) {
    res.status(401).json({ error: "유효하지 않거나 만료된 토큰입니다" });
  }
}
// 인증 옵셔널 (있으면 req.user 설정, 없어도 통과)
function optionalAuth(req, _res, next) {
  const m = (req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (m) {
    try {
      const p = jwt.verify(m[1], JWT_SECRET);
      req.user = { id: Number(p.sub), email: p.email, name: p.name, role: p.role };
    } catch (_e) {
      // 무시
    }
  }
  next();
}

// ══════════════════════════════════════════════════════
// 인증
// ══════════════════════════════════════════════════════
app.post("/api/auth/register", async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!isValidEmail(email)) return res.status(400).json({ error: "유효한 이메일을 입력하세요" });
  if (typeof password !== "string" || password.length < 4)
    return res.status(400).json({ error: "비밀번호는 4자 이상" });
  if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "이름을 입력하세요" });

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO photo_magazine.users (email, password_hash, name, role)
       VALUES ($1, $2, $3, 'reader')
       RETURNING id, email, name, role, created_at`,
      [email.toLowerCase(), hash, name.trim()]
    );
    const user = rows[0];
    res.status(201).json({ token: issueToken(user), user });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "이미 가입된 이메일입니다" });
    console.error("register:", e.message);
    res.status(500).json({ error: "서버 오류" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "이메일/비밀번호를 입력하세요" });
  try {
    const { rows } = await pool.query(
      `SELECT id, email, password_hash, name, role, created_at
         FROM photo_magazine.users WHERE email = $1`,
      [String(email).toLowerCase()]
    );
    if (rows.length === 0)
      return res.status(401).json({ error: "이메일 또는 비밀번호가 일치하지 않습니다" });
    const u = rows[0];
    const ok = await bcrypt.compare(String(password), u.password_hash);
    if (!ok) return res.status(401).json({ error: "이메일 또는 비밀번호가 일치하지 않습니다" });
    res.json({ token: issueToken(u), user: sanitizeUser(u) });
  } catch (e) {
    console.error("login:", e.message);
    res.status(500).json({ error: "서버 오류" });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, name, role, created_at FROM photo_magazine.users WHERE id = $1`,
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "사용자 없음" });
    res.json({ user: rows[0] });
  } catch (e) {
    console.error("me:", e.message);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ══════════════════════════════════════════════════════
// 콘텐츠
// ══════════════════════════════════════════════════════
// 목록 — 본문은 빠지고 excerpt 까지만. 로그인했으면 has_access 포함
app.get("/api/contents", optionalAuth, async (req, res) => {
  const { category } = req.query || {};
  try {
    const params = [];
    let where = "";
    if (category === "lecture" || category === "marketing") {
      params.push(category);
      where = `WHERE category = $${params.length}`;
    }

    const { rows: contents } = await pool.query(
      `SELECT id, slug, category, issue_no, title, subtitle, cover_image, author,
              read_minutes, tags, excerpt, is_premium, price, published_at
         FROM photo_magazine.contents
         ${where}
         ORDER BY issue_no DESC, published_at DESC, id DESC`,
      params
    );

    let owned = new Set();
    if (req.user) {
      const { rows: pur } = await pool.query(
        `SELECT content_id FROM photo_magazine.purchases
          WHERE user_id = $1 AND status = 'paid'`,
        [req.user.id]
      );
      owned = new Set(pur.map((r) => Number(r.content_id)));
    }

    res.json(
      contents.map((c) => ({
        ...c,
        price: Number(c.price),
        has_access: !c.is_premium || owned.has(Number(c.id)),
      }))
    );
  } catch (e) {
    console.error("contents LIST:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

// 상세 — 무료이거나 구매했으면 body 포함, 아니면 잠금 (excerpt만)
app.get("/api/contents/:slug", optionalAuth, async (req, res) => {
  const slug = String(req.params.slug || "").toLowerCase();
  try {
    const { rows } = await pool.query(
      `SELECT id, slug, category, issue_no, title, subtitle, cover_image, author,
              read_minutes, tags, excerpt, body, is_premium, price, published_at
         FROM photo_magazine.contents WHERE slug = $1`,
      [slug]
    );
    if (rows.length === 0) return res.status(404).json({ error: "콘텐츠를 찾을 수 없습니다" });
    const c = rows[0];
    c.price = Number(c.price);

    let hasAccess = !c.is_premium;
    if (!hasAccess && req.user) {
      const { rows: pur } = await pool.query(
        `SELECT 1 FROM photo_magazine.purchases
          WHERE user_id = $1 AND content_id = $2 AND status = 'paid' LIMIT 1`,
        [req.user.id, c.id]
      );
      hasAccess = pur.length > 0;
    }

    if (hasAccess) {
      res.json({ ...c, has_access: true });
    } else {
      const { body, ...locked } = c;
      res.json({ ...locked, has_access: false });
    }
  } catch (e) {
    console.error("content GET:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

// ══════════════════════════════════════════════════════
// 결제 (TossPayments)
// ══════════════════════════════════════════════════════
app.get("/api/payment/config", (_req, res) => {
  res.json({ clientKey: TOSS_CLIENT_KEY });
});

// 결제 사전 등록 — 콘텐츠에 대한 pending purchase 생성, toss orderId 발급
app.post("/api/payment/prepare", requireAuth, async (req, res) => {
  const contentId = Number(req.body?.content_id);
  if (!Number.isInteger(contentId) || contentId <= 0)
    return res.status(400).json({ error: "content_id 가 필요합니다" });

  try {
    const { rows: contentRows } = await pool.query(
      `SELECT id, title, price, is_premium FROM photo_magazine.contents WHERE id = $1`,
      [contentId]
    );
    if (contentRows.length === 0) return res.status(404).json({ error: "콘텐츠 없음" });
    const c = contentRows[0];
    if (!c.is_premium) return res.status(400).json({ error: "무료 콘텐츠입니다" });

    const { rows: existing } = await pool.query(
      `SELECT 1 FROM photo_magazine.purchases
        WHERE user_id = $1 AND content_id = $2 AND status = 'paid' LIMIT 1`,
      [req.user.id, c.id]
    );
    if (existing.length > 0) return res.status(409).json({ error: "이미 구매한 콘텐츠입니다" });

    const rand = Math.random().toString(36).slice(2, 8);
    const orderId = `MAG-${c.id}-${req.user.id}-${Date.now()}-${rand}`;
    const amount = Number(c.price);

    await pool.query(
      `INSERT INTO photo_magazine.purchases
         (user_id, content_id, toss_order_id, amount, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [req.user.id, c.id, orderId, amount]
    );

    res.json({
      orderId,
      orderName: c.title.length > 60 ? c.title.slice(0, 57) + "..." : c.title,
      amount,
      customerEmail: req.user.email,
      customerName: req.user.name,
    });
  } catch (e) {
    console.error("payment/prepare:", e.message);
    res.status(500).json({ error: "서버 오류" });
  }
});

// 결제 승인
app.post("/api/payment/confirm", requireAuth, async (req, res) => {
  const { paymentKey, orderId, amount } = req.body || {};
  if (!paymentKey || !orderId || amount == null)
    return res.status(400).json({ error: "paymentKey / orderId / amount 필수" });
  if (!TOSS_SECRET_KEY) return res.status(500).json({ error: "TOSS_SECRET_KEY 미설정" });

  try {
    const { rows } = await pool.query(
      `SELECT id, user_id, content_id, amount, status, toss_order_id
         FROM photo_magazine.purchases
        WHERE toss_order_id = $1 AND user_id = $2`,
      [orderId, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "주문을 찾을 수 없습니다" });
    const purchase = rows[0];
    if (purchase.status !== "pending")
      return res.status(409).json({ error: "이미 처리된 주문입니다" });
    if (Number(amount) !== Number(purchase.amount))
      return res.status(400).json({ error: "결제 금액이 일치하지 않습니다" });

    const auth = Buffer.from(TOSS_SECRET_KEY + ":").toString("base64");
    const tossRes = await fetch(`${TOSS_API_BASE}/confirm`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) }),
    });
    const tossData = await tossRes.json().catch(() => ({}));

    if (tossRes.ok) {
      const { rows: upd } = await pool.query(
        `UPDATE photo_magazine.purchases
            SET status = 'paid', payment_key = $1, paid_at = NOW()
          WHERE id = $2
          RETURNING id, content_id, amount, status, paid_at`,
        [paymentKey, purchase.id]
      );
      return res.json({ ok: true, purchase: upd[0] });
    }

    console.error("토스 승인 실패:", tossData);
    await pool.query(
      `UPDATE photo_magazine.purchases SET status = 'cancelled' WHERE id = $1`,
      [purchase.id]
    );
    return res.status(tossRes.status || 400).json({
      error: tossData?.message || "결제 승인에 실패했습니다",
      code: tossData?.code,
    });
  } catch (e) {
    console.error("payment/confirm:", e.message);
    res.status(500).json({ error: "서버 오류" });
  }
});

// 결제 취소(사용자가 위젯 닫음) — pending 정리
app.post("/api/payment/cancel-pending", requireAuth, async (req, res) => {
  const { orderId } = req.body || {};
  if (!orderId) return res.status(400).json({ error: "orderId 필수" });
  try {
    await pool.query(
      `UPDATE photo_magazine.purchases
          SET status = 'cancelled'
        WHERE toss_order_id = $1 AND user_id = $2 AND status = 'pending'`,
      [orderId, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("cancel-pending:", e.message);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ══════════════════════════════════════════════════════
// 구매 이력
// ══════════════════════════════════════════════════════
app.get("/api/purchases", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.content_id, p.amount, p.paid_at, p.toss_order_id,
              c.slug, c.title, c.subtitle, c.category, c.cover_image,
              c.author, c.read_minutes
         FROM photo_magazine.purchases p
         JOIN photo_magazine.contents  c ON c.id = p.content_id
        WHERE p.user_id = $1 AND p.status = 'paid'
        ORDER BY p.paid_at DESC`,
      [req.user.id]
    );
    res.json(rows.map((r) => ({ ...r, amount: Number(r.amount) })));
  } catch (e) {
    console.error("purchases LIST:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

// ══════════════════════════════════════════════════════
// 시작
// ══════════════════════════════════════════════════════
app.use((err, _req, res, _next) => {
  console.error("Unhandled:", err);
  res.status(500).json({ error: "서버 오류" });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`📰 PHOTO MAGAZINE 서버 실행: http://localhost:${PORT}`);
    console.log(`   스키마: photo_magazine`);
  });
}

module.exports = app;
