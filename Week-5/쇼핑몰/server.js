// 쇼핑몰 API 서버
// [클라이언트] → [Express + JWT] → Supabase DB (shopping 스키마)

require("dotenv").config();
const path = require("path");
const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3006;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = "7d";

if (!JWT_SECRET) {
  console.error("❌ JWT_SECRET 환경변수가 설정되지 않았습니다.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 관리자 앱 명시적 fallback (한글 경로 + Vercel Serverless 환경 호환)
app.get(["/관리자", "/관리자/"], (req, res) => {
  res.sendFile(path.join(__dirname, "관리자", "index.html"));
});

// ── 미들웨어 ──────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const match = auth.match(/^Bearer (.+)$/);
  if (!match) return res.status(401).json({ error: "로그인이 필요합니다" });
  try {
    const payload = jwt.verify(match[1], JWT_SECRET);
    req.userId = payload.userId;
    req.username = payload.username;
    req.isAdmin = !!payload.isAdmin;
    next();
  } catch (e) {
    return res.status(401).json({ error: "유효하지 않거나 만료된 토큰" });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (!req.isAdmin) return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    next();
  });
}

function issueToken(userId, username, isAdmin = false) {
  return jwt.sign({ userId, username, isAdmin: !!isAdmin }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// ── 인증 엔드포인트 ────────────────────────────────────────────
app.post("/api/auth/signup", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "아이디와 비밀번호를 입력하세요" });
  if (typeof username !== "string" || username.length < 3 || username.length > 30) {
    return res.status(400).json({ error: "아이디는 3-30자로 입력하세요" });
  }
  if (typeof password !== "string" || password.length < 4) {
    return res.status(400).json({ error: "비밀번호는 4자 이상 입력하세요" });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO shopping.users (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username, is_admin, created_at`,
      [username, hash]
    );
    const user = rows[0];
    const token = issueToken(user.id, user.username, user.is_admin);
    res.status(201).json({ token, user: { id: user.id, username: user.username, is_admin: user.is_admin } });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "이미 사용 중인 아이디입니다" });
    console.error("signup 오류:", e.message);
    res.status(500).json({ error: "서버 오류" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "아이디와 비밀번호를 입력하세요" });
  try {
    const { rows } = await pool.query(
      `SELECT id, username, password_hash, is_admin FROM shopping.users WHERE username = $1`,
      [username]
    );
    if (rows.length === 0) return res.status(401).json({ error: "아이디 또는 비밀번호가 일치하지 않습니다" });
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "아이디 또는 비밀번호가 일치하지 않습니다" });
    const token = issueToken(user.id, user.username, user.is_admin);
    res.json({ token, user: { id: user.id, username: user.username, is_admin: user.is_admin } });
  } catch (e) {
    console.error("login 오류:", e.message);
    res.status(500).json({ error: "서버 오류" });
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: { id: req.userId, username: req.username, is_admin: req.isAdmin } });
});

// ── 장바구니 ──────────────────────────────────────────────────
app.get("/api/cart", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT product_id, quantity
       FROM shopping.cart_items
       WHERE user_id = $1
       ORDER BY created_at`,
      [req.userId]
    );
    res.json(rows.map((r) => ({ productId: r.product_id, quantity: r.quantity })));
  } catch (e) {
    console.error("cart GET 오류:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

// 담기 (upsert: 있으면 +quantity, 없으면 insert)
app.post("/api/cart", requireAuth, async (req, res) => {
  const { productId, quantity = 1 } = req.body || {};
  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: "productId 오류" });
  }
  const q = Math.max(1, Math.floor(Number(quantity) || 1));
  try {
    await pool.query(
      `INSERT INTO shopping.cart_items (user_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, product_id)
         DO UPDATE SET quantity = shopping.cart_items.quantity + EXCLUDED.quantity`,
      [req.userId, productId, q]
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    console.error("cart POST 오류:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

// 수량 절댓값 변경 (0 이하면 삭제)
app.patch("/api/cart/:productId", requireAuth, async (req, res) => {
  const productId = Number(req.params.productId);
  const q = Math.floor(Number(req.body?.quantity));
  if (!Number.isInteger(productId)) return res.status(400).json({ error: "productId 오류" });
  if (!Number.isFinite(q)) return res.status(400).json({ error: "quantity 오류" });
  try {
    if (q <= 0) {
      await pool.query(
        `DELETE FROM shopping.cart_items WHERE user_id = $1 AND product_id = $2`,
        [req.userId, productId]
      );
    } else {
      await pool.query(
        `UPDATE shopping.cart_items SET quantity = $3 WHERE user_id = $1 AND product_id = $2`,
        [req.userId, productId, q]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error("cart PATCH 오류:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

// 개별 삭제
app.delete("/api/cart/:productId", requireAuth, async (req, res) => {
  const productId = Number(req.params.productId);
  if (!Number.isInteger(productId)) return res.status(400).json({ error: "productId 오류" });
  try {
    await pool.query(
      `DELETE FROM shopping.cart_items WHERE user_id = $1 AND product_id = $2`,
      [req.userId, productId]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("cart DELETE 오류:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

// 전체 비우기
app.delete("/api/cart", requireAuth, async (req, res) => {
  try {
    await pool.query(`DELETE FROM shopping.cart_items WHERE user_id = $1`, [req.userId]);
    res.json({ ok: true });
  } catch (e) {
    console.error("cart CLEAR 오류:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

// ── 관리자 전용 엔드포인트 ─────────────────────────────────────
app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM shopping.users)                            AS total_users,
        (SELECT COUNT(*)::int FROM shopping.users WHERE is_admin)             AS admin_users,
        (SELECT COUNT(*)::int FROM shopping.cart_items)                       AS total_cart_rows,
        (SELECT COALESCE(SUM(quantity),0)::int FROM shopping.cart_items)      AS total_items_in_carts,
        (SELECT COUNT(DISTINCT user_id)::int FROM shopping.cart_items)        AS users_with_cart
    `);
    res.json(rows[0]);
  } catch (e) {
    console.error("admin/stats 오류:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id, u.username, u.is_admin, u.created_at,
        COALESCE(c.item_count, 0)::int AS cart_item_count,
        COALESCE(c.total_qty,  0)::int AS cart_total_qty
      FROM shopping.users u
      LEFT JOIN (
        SELECT user_id, COUNT(*) AS item_count, SUM(quantity) AS total_qty
        FROM shopping.cart_items GROUP BY user_id
      ) c ON c.user_id = u.id
      ORDER BY u.created_at DESC
    `);
    res.json(rows);
  } catch (e) {
    console.error("admin/users 오류:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

app.get("/api/admin/cart-items", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        ci.id, ci.user_id, u.username, ci.product_id, ci.quantity, ci.created_at
      FROM shopping.cart_items ci
      JOIN shopping.users u ON u.id = ci.user_id
      ORDER BY ci.created_at DESC
    `);
    res.json(rows);
  } catch (e) {
    console.error("admin/cart-items 오류:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId)) return res.status(400).json({ error: "id 오류" });
  if (targetId === req.userId) return res.status(400).json({ error: "본인 계정은 삭제할 수 없습니다" });
  try {
    const { rowCount } = await pool.query(`DELETE FROM shopping.users WHERE id = $1`, [targetId]);
    if (rowCount === 0) return res.status(404).json({ error: "대상 없음" });
    res.json({ ok: true });
  } catch (e) {
    console.error("admin user DELETE 오류:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🛍️  쇼핑몰 서버 실행: http://localhost:${PORT}`);
    console.log(`   관리자 앱: http://localhost:${PORT}/관리자/`);
  });
}

module.exports = app;
