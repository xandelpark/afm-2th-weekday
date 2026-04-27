// 필름카메라 셀렉트샵 API 서버
// [클라이언트] → [Express + JWT] → Supabase PostgreSQL (filmcamera_shop 스키마)

require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// ImageKit (관리자 상품 이미지 업로드용)
const IMAGEKIT_URL_ENDPOINT = (process.env.IMAGEKIT_URL_ENDPOINT || "").trim();
const IMAGEKIT_PUBLIC_KEY = (process.env.IMAGEKIT_PUBLIC_KEY || "").trim();
const IMAGEKIT_PRIVATE_KEY = (process.env.IMAGEKIT_PRIVATE_KEY || "").trim();

const app = express();
const PORT = process.env.PORT || 3020;
const JWT_SECRET = (process.env.JWT_SECRET || "").trim();
const JWT_EXPIRES = "7d";

// 토스페이먼츠 키 (client key 는 /api/payment/config 로 프론트에 전달, secret key 는 서버 내부 전용)
const TOSS_CLIENT_KEY = (process.env.TOSS_CLIENT_KEY || "").trim();
const TOSS_SECRET_KEY = (process.env.TOSS_SECRET_KEY || "").trim();
const TOSS_API_BASE = "https://api.tosspayments.com/v1/payments";

if (!JWT_SECRET) {
  console.error("❌ JWT_SECRET 환경변수가 설정되지 않았습니다.");
  process.exit(1);
}
if (!TOSS_CLIENT_KEY || !TOSS_SECRET_KEY) {
  console.warn(
    "⚠️  TOSS_CLIENT_KEY / TOSS_SECRET_KEY 환경변수가 비어있습니다. 결제 기능을 사용하려면 .env 를 확인하세요."
  );
}

const pool = new Pool({
  connectionString: (process.env.DATABASE_URL || "").trim(),
});

// ── DB 마이그레이션: orders 테이블에 토스 결제 관련 컬럼 추가 (idempotent) ──
async function initDB() {
  try {
    await pool.query(`
      ALTER TABLE filmcamera_shop.orders
        ADD COLUMN IF NOT EXISTS toss_order_id VARCHAR(100) UNIQUE,
        ADD COLUMN IF NOT EXISTS payment_key   VARCHAR(200),
        ADD COLUMN IF NOT EXISTS paid_at       TIMESTAMPTZ
    `);
    console.log("✅ orders 테이블 마이그레이션 완료 (toss_order_id / payment_key / paid_at)");
  } catch (e) {
    console.error("❌ initDB 오류:", e.message);
  }
}

// 모듈 로드 시 1회 실행 (listen 이전 / Serverless 환경에서도 즉시)
const initPromise = initDB();

app.use(express.json());
app.use(express.static(__dirname));

// 루트는 명시적으로 index.html 서빙 (Serverless 환경 호환)
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ── 유틸 ─────────────────────────────────────────────────────
function issueToken(user) {
  // user: { id, email, role, name }
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function sanitizeUser(row) {
  // password_hash 는 응답에서 제외
  if (!row) return null;
  const { password_hash, ...safe } = row;
  return safe;
}

function isValidEmail(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// ── 인증 미들웨어 ─────────────────────────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const match = auth.match(/^Bearer (.+)$/);
  if (!match) return res.status(401).json({ error: "로그인이 필요합니다" });
  try {
    const payload = jwt.verify(match[1], JWT_SECRET);
    req.user = {
      id: Number(payload.sub),
      email: payload.email,
      role: payload.role,
      name: payload.name,
    };
    next();
  } catch (_e) {
    return res.status(401).json({ error: "유효하지 않거나 만료된 토큰입니다" });
  }
}

function requireAdmin() {
  return (req, res, next) => {
    requireAuth(req, res, (err) => {
      if (err) return next(err);
      if (req.user.role !== "admin" && req.user.role !== "superadmin") {
        return res.status(403).json({ error: "관리자 권한이 필요합니다" });
      }
      next();
    });
  };
}

function requireSuperAdmin() {
  return (req, res, next) => {
    requireAuth(req, res, (err) => {
      if (err) return next(err);
      if (req.user.role !== "superadmin") {
        return res.status(403).json({ error: "슈퍼관리자 권한이 필요합니다" });
      }
      next();
    });
  };
}

// ══════════════════════════════════════════════════════════════
// 인증 엔드포인트
// ══════════════════════════════════════════════════════════════
app.post("/api/auth/register", async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!isValidEmail(email))
    return res.status(400).json({ error: "유효한 이메일을 입력하세요" });
  if (typeof password !== "string" || password.length < 4)
    return res.status(400).json({ error: "비밀번호는 4자 이상 입력하세요" });
  if (typeof name !== "string" || name.trim().length < 1 || name.length > 100)
    return res.status(400).json({ error: "이름은 1-100자로 입력하세요" });

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO filmcamera_shop.users (email, password_hash, name, role)
       VALUES ($1, $2, $3, 'customer')
       RETURNING id, email, name, role, created_at`,
      [email.toLowerCase(), hash, name.trim()]
    );
    const user = rows[0];
    const token = issueToken(user);
    res.status(201).json({ token, user });
  } catch (e) {
    if (e.code === "23505")
      return res.status(409).json({ error: "이미 가입된 이메일입니다" });
    console.error("register 오류:", e.message);
    res.status(500).json({ error: "서버 오류" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return res.status(400).json({ error: "이메일과 비밀번호를 입력하세요" });
  try {
    const { rows } = await pool.query(
      `SELECT id, email, password_hash, name, role, created_at
       FROM filmcamera_shop.users
       WHERE email = $1`,
      [String(email).toLowerCase()]
    );
    if (rows.length === 0)
      return res
        .status(401)
        .json({ error: "이메일 또는 비밀번호가 일치하지 않습니다" });

    const user = rows[0];
    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok)
      return res
        .status(401)
        .json({ error: "이메일 또는 비밀번호가 일치하지 않습니다" });

    const token = issueToken(user);
    res.json({ token, user: sanitizeUser(user) });
  } catch (e) {
    console.error("login 오류:", e.message);
    res.status(500).json({ error: "서버 오류" });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, name, role, created_at
       FROM filmcamera_shop.users WHERE id = $1`,
      [req.user.id]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
    res.json({ user: rows[0] });
  } catch (e) {
    console.error("me 오류:", e.message);
    res.status(500).json({ error: "서버 오류" });
  }
});

// ══════════════════════════════════════════════════════════════
// 상품 엔드포인트
// ══════════════════════════════════════════════════════════════
app.get("/api/products", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, brand, name, year, format, condition, stock, price,
              badge, image, description, specs, created_at
       FROM filmcamera_shop.products
       ORDER BY id ASC`
    );
    res.json(rows.map((r) => ({ ...r, price: Number(r.price) })));
  } catch (e) {
    console.error("products LIST 오류:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

app.get("/api/products/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0)
    return res.status(400).json({ error: "id 오류" });
  try {
    const { rows } = await pool.query(
      `SELECT id, brand, name, year, format, condition, stock, price,
              badge, image, description, specs, created_at
       FROM filmcamera_shop.products
       WHERE id = $1`,
      [id]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "상품을 찾을 수 없습니다" });
    const p = rows[0];
    res.json({ ...p, price: Number(p.price) });
  } catch (e) {
    console.error("products GET 오류:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

function validateProductBody(body, { partial = false } = {}) {
  const required = ["brand", "name", "stock", "price"];
  if (!partial) {
    for (const k of required) {
      if (body[k] === undefined || body[k] === null || body[k] === "") {
        return `${k} 은(는) 필수입니다`;
      }
    }
  }
  if (body.badge != null && !["BEST", "NEW", "RARE"].includes(body.badge))
    return "badge 는 BEST/NEW/RARE 중 하나여야 합니다";
  if (body.stock !== undefined && (!Number.isFinite(+body.stock) || +body.stock < 0))
    return "stock 은 0 이상의 숫자여야 합니다";
  if (body.price !== undefined && (!Number.isFinite(+body.price) || +body.price < 0))
    return "price 는 0 이상의 숫자여야 합니다";
  if (body.year !== undefined && body.year !== null && !Number.isFinite(+body.year))
    return "year 는 숫자여야 합니다";
  return null;
}

// 관리자 전용 상품 등록
app.post("/api/products", requireAdmin(), async (req, res) => {
  const err = validateProductBody(req.body || {});
  if (err) return res.status(400).json({ error: err });
  const {
    brand, name, year, format, condition,
    stock, price, badge, image, description, specs,
  } = req.body;

  try {
    const { rows } = await pool.query(
      `INSERT INTO filmcamera_shop.products
         (brand, name, year, format, condition, stock, price, badge, image, description, specs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, brand, name, year, format, condition, stock, price,
                 badge, image, description, specs, created_at`,
      [
        brand,
        name,
        year ?? null,
        format ?? null,
        condition ?? null,
        Math.floor(+stock),
        Math.floor(+price),
        badge ?? null,
        image ?? null,
        description ?? null,
        specs ? JSON.stringify(specs) : null,
      ]
    );
    const p = rows[0];
    res.status(201).json({ ...p, price: Number(p.price) });
  } catch (e) {
    console.error("products POST 오류:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

// 관리자 전용 상품 수정 (부분 업데이트)
app.put("/api/products/:id", requireAdmin(), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0)
    return res.status(400).json({ error: "id 오류" });
  const err = validateProductBody(req.body || {}, { partial: true });
  if (err) return res.status(400).json({ error: err });

  const fields = [
    "brand", "name", "year", "format", "condition",
    "stock", "price", "badge", "image", "description", "specs",
  ];
  const sets = [];
  const values = [];
  let i = 1;
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      sets.push(`${f} = $${i++}`);
      if (f === "specs") {
        values.push(req.body[f] ? JSON.stringify(req.body[f]) : null);
      } else if (f === "stock" || f === "price") {
        values.push(Math.floor(+req.body[f]));
      } else if (f === "year") {
        values.push(req.body[f] == null ? null : +req.body[f]);
      } else {
        values.push(req.body[f]);
      }
    }
  }
  if (sets.length === 0)
    return res.status(400).json({ error: "수정할 내용이 없습니다" });
  values.push(id);

  try {
    const { rows } = await pool.query(
      `UPDATE filmcamera_shop.products
         SET ${sets.join(", ")}
       WHERE id = $${i}
       RETURNING id, brand, name, year, format, condition, stock, price,
                 badge, image, description, specs, created_at`,
      values
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "상품을 찾을 수 없습니다" });
    const p = rows[0];
    res.json({ ...p, price: Number(p.price) });
  } catch (e) {
    console.error("products PUT 오류:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

app.delete("/api/products/:id", requireAdmin(), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0)
    return res.status(400).json({ error: "id 오류" });
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM filmcamera_shop.products WHERE id = $1`,
      [id]
    );
    if (rowCount === 0)
      return res.status(404).json({ error: "상품을 찾을 수 없습니다" });
    res.json({ ok: true });
  } catch (e) {
    console.error("products DELETE 오류:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

// ══════════════════════════════════════════════════════════════
// 주문 엔드포인트
// ══════════════════════════════════════════════════════════════
// 주문 생성 (인증 필수) — 트랜잭션으로 재고 차감 + 총가격 계산
app.post("/api/orders", requireAuth, async (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: "items 배열이 비어있습니다" });

  // 입력 검증
  const normalized = [];
  for (const it of items) {
    const product_id = Number(it?.product_id);
    const qty = Math.floor(Number(it?.qty));
    if (!Number.isInteger(product_id) || product_id <= 0)
      return res.status(400).json({ error: "items.product_id 오류" });
    if (!Number.isInteger(qty) || qty <= 0)
      return res.status(400).json({ error: "items.qty 는 1 이상의 정수여야 합니다" });
    normalized.push({ product_id, qty });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 상품 lock + 재고/가격 조회
    const ids = normalized.map((n) => n.product_id);
    const { rows: prodRows } = await client.query(
      `SELECT id, name, price, stock
         FROM filmcamera_shop.products
        WHERE id = ANY($1::bigint[])
        FOR UPDATE`,
      [ids]
    );
    const byId = new Map(prodRows.map((p) => [Number(p.id), p]));

    let total = 0n;
    const orderItems = [];
    for (const n of normalized) {
      const p = byId.get(n.product_id);
      if (!p) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ error: `존재하지 않는 상품입니다 (id=${n.product_id})` });
      }
      if (p.stock < n.qty) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: `재고 부족: ${p.name} (재고 ${p.stock}, 요청 ${n.qty})`,
        });
      }
      const price = BigInt(p.price);
      total += price * BigInt(n.qty);
      orderItems.push({
        product_id: n.product_id,
        qty: n.qty,
        price: Number(price),
        name: p.name,
      });
    }

    // 재고 차감
    for (const n of normalized) {
      await client.query(
        `UPDATE filmcamera_shop.products SET stock = stock - $1 WHERE id = $2`,
        [n.qty, n.product_id]
      );
    }

    // 주문 INSERT
    const { rows: orderRows } = await client.query(
      `INSERT INTO filmcamera_shop.orders (user_id, items, total_price, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id, user_id, items, total_price, status, created_at`,
      [req.user.id, JSON.stringify(orderItems), total.toString()]
    );
    const created = orderRows[0];

    // 토스 결제용 orderId 생성 (6-64자, [A-Za-z0-9_-])
    // 예: FILMLAB-12-1729500000000-a7k2
    const rand = Math.random().toString(36).slice(2, 8);
    const tossOrderId = `FILMLAB-${created.id}-${Date.now()}-${rand}`;
    const { rows: updatedRows } = await client.query(
      `UPDATE filmcamera_shop.orders
          SET toss_order_id = $1
        WHERE id = $2
        RETURNING id, user_id, items, total_price, status, created_at,
                  toss_order_id, payment_key, paid_at`,
      [tossOrderId, created.id]
    );

    await client.query("COMMIT");
    const o = updatedRows[0];
    res.status(201).json({ ...o, total_price: Number(o.total_price) });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    console.error("orders POST 오류:", e.message);
    res.status(500).json({ error: "DB 오류" });
  } finally {
    client.release();
  }
});

// 주문 목록 (본인 — admin/superadmin 은 전체)
app.get("/api/orders", requireAuth, async (req, res) => {
  try {
    const isAdmin =
      req.user.role === "admin" || req.user.role === "superadmin";
    const sql = isAdmin
      ? `SELECT o.id, o.user_id, u.email AS user_email, u.name AS user_name,
                o.items, o.total_price, o.status, o.created_at,
                o.toss_order_id, o.payment_key, o.paid_at
           FROM filmcamera_shop.orders o
           JOIN filmcamera_shop.users  u ON u.id = o.user_id
          ORDER BY o.created_at DESC`
      : `SELECT id, user_id, items, total_price, status, created_at,
                toss_order_id, payment_key, paid_at
           FROM filmcamera_shop.orders
          WHERE user_id = $1
          ORDER BY created_at DESC`;
    const params = isAdmin ? [] : [req.user.id];
    const { rows } = await pool.query(sql, params);
    res.json(
      rows.map((r) => ({ ...r, total_price: Number(r.total_price) }))
    );
  } catch (e) {
    console.error("orders LIST 오류:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

// ══════════════════════════════════════════════════════════════
// 결제 (토스페이먼츠) 엔드포인트
// ══════════════════════════════════════════════════════════════
// 프론트가 clientKey 만 조회 — secret key 는 절대 노출하지 않음
app.get("/api/payment/config", (_req, res) => {
  res.json({ clientKey: TOSS_CLIENT_KEY });
});

// 결제 승인 (클라이언트가 successUrl 로 리디렉션된 뒤 호출)
// body: { paymentKey, orderId, amount }  (orderId = toss_order_id)
app.post("/api/payment/confirm", requireAuth, async (req, res) => {
  const { paymentKey, orderId, amount } = req.body || {};
  if (!paymentKey || !orderId || amount == null) {
    return res.status(400).json({ error: "paymentKey / orderId / amount 는 필수입니다" });
  }
  if (!TOSS_SECRET_KEY) {
    return res.status(500).json({ error: "서버에 TOSS_SECRET_KEY 가 설정되지 않았습니다" });
  }

  try {
    // 1) 주문 조회 + 소유권 확인
    const { rows } = await pool.query(
      `SELECT id, user_id, items, total_price, status, toss_order_id
         FROM filmcamera_shop.orders
        WHERE toss_order_id = $1 AND user_id = $2`,
      [orderId, req.user.id]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "주문을 찾을 수 없습니다" });

    const order = rows[0];

    // 2) 이미 처리된 주문 체크
    if (order.status !== "pending") {
      return res.status(409).json({ error: "이미 처리된 주문입니다" });
    }

    // 3) 금액 검증 (중요: 서버 DB 의 total_price 와 URL 파라미터 amount 비교)
    if (Number(amount) !== Number(order.total_price)) {
      return res.status(400).json({ error: "결제 금액이 일치하지 않습니다" });
    }

    // 4) 토스 결제 승인 API 호출
    const encodedKey = Buffer.from(TOSS_SECRET_KEY + ":").toString("base64");
    const tossRes = await fetch(`${TOSS_API_BASE}/confirm`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${encodedKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) }),
    });
    const tossData = await tossRes.json().catch(() => ({}));

    if (tossRes.ok) {
      // 5) 성공 — 주문 상태 paid 로 업데이트
      const { rows: upd } = await pool.query(
        `UPDATE filmcamera_shop.orders
            SET status = 'paid', payment_key = $1, paid_at = NOW()
          WHERE id = $2
          RETURNING id, user_id, items, total_price, status, created_at,
                    toss_order_id, payment_key, paid_at`,
        [paymentKey, order.id]
      );
      const o = upd[0];
      return res.json({
        ok: true,
        order: { ...o, total_price: Number(o.total_price) },
      });
    }

    // 6) 실패 — 재고 복구 + 주문 취소 처리 (트랜잭션)
    console.error("❌ 토스 결제 승인 실패:", tossData);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const items = Array.isArray(order.items) ? order.items : [];
      for (const it of items) {
        if (it && it.product_id && it.qty) {
          await client.query(
            `UPDATE filmcamera_shop.products SET stock = stock + $1 WHERE id = $2`,
            [Number(it.qty), Number(it.product_id)]
          );
        }
      }
      await client.query(
        `UPDATE filmcamera_shop.orders SET status = 'cancelled' WHERE id = $1`,
        [order.id]
      );
      await client.query("COMMIT");
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("결제 실패 롤백 오류:", e.message);
    } finally {
      client.release();
    }

    // 토스 에러 페이로드를 그대로 전달 (프론트에서 사용자에게 보여주기 위함)
    return res.status(tossRes.status || 400).json({
      error: tossData?.message || "결제 승인에 실패했습니다",
      code: tossData?.code,
      tossPayload: tossData,
    });
  } catch (e) {
    console.error("payment/confirm 오류:", e.message);
    res.status(500).json({ error: "서버 오류" });
  }
});

// 결제 모달을 닫고 결제 없이 주문을 취소할 때 사용 (재고 복구 + status=cancelled)
app.post("/api/payment/cancel-pending/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0)
    return res.status(400).json({ error: "id 오류" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT id, user_id, items, status
         FROM filmcamera_shop.orders
        WHERE id = $1 AND user_id = $2
        FOR UPDATE`,
      [id, req.user.id]
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "주문을 찾을 수 없습니다" });
    }
    const order = rows[0];
    if (order.status !== "pending") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "이미 처리된 주문입니다" });
    }

    // 재고 복구
    const items = Array.isArray(order.items) ? order.items : [];
    for (const it of items) {
      if (it && it.product_id && it.qty) {
        await client.query(
          `UPDATE filmcamera_shop.products SET stock = stock + $1 WHERE id = $2`,
          [Number(it.qty), Number(it.product_id)]
        );
      }
    }
    await client.query(
      `UPDATE filmcamera_shop.orders SET status = 'cancelled' WHERE id = $1`,
      [id]
    );

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("payment/cancel-pending 오류:", e.message);
    res.status(500).json({ error: "서버 오류" });
  } finally {
    client.release();
  }
});

// ══════════════════════════════════════════════════════════════
// 사용자 관리 (슈퍼관리자 only)
// ══════════════════════════════════════════════════════════════
app.get("/api/users", requireSuperAdmin(), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, name, role, created_at
         FROM filmcamera_shop.users
        ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error("users LIST 오류:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

app.patch("/api/users/:id/role", requireSuperAdmin(), async (req, res) => {
  const id = Number(req.params.id);
  const { role } = req.body || {};
  if (!Number.isInteger(id) || id <= 0)
    return res.status(400).json({ error: "id 오류" });
  if (!["customer", "admin", "superadmin"].includes(role))
    return res.status(400).json({
      error: "role 은 customer / admin / superadmin 중 하나여야 합니다",
    });
  if (id === req.user.id)
    return res
      .status(400)
      .json({ error: "본인의 role 은 변경할 수 없습니다" });

  try {
    const { rows } = await pool.query(
      `UPDATE filmcamera_shop.users
          SET role = $1
        WHERE id = $2
        RETURNING id, email, name, role, created_at`,
      [role, id]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "사용자를 찾을 수 없습니다" });
    res.json({ user: rows[0] });
  } catch (e) {
    console.error("users PATCH role 오류:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

// ══════════════════════════════════════════════════════════════
// 에러 핸들러 (fallback)
// ══════════════════════════════════════════════════════════════
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "서버 오류" });
});

// ══════════════════════════════════════════════════════════════
// ImageKit 클라이언트 업로드 인증 (관리자 전용)
//   - private key 는 서버에만 보관하고, HMAC-SHA1 서명만 발급
//   - admin / superadmin 로그인 필요
// ══════════════════════════════════════════════════════════════
app.get("/api/imagekit-auth", requireAdmin(), (req, res) => {
  if (!IMAGEKIT_PRIVATE_KEY || !IMAGEKIT_PUBLIC_KEY) {
    return res.status(500).json({ error: "ImageKit 환경변수가 설정되지 않았습니다" });
  }
  try {
    const token = crypto.randomUUID();
    const expire = Math.floor(Date.now() / 1000) + 60 * 30; // 30분
    const signature = crypto
      .createHmac("sha1", IMAGEKIT_PRIVATE_KEY)
      .update(token + expire)
      .digest("hex");
    res.json({
      token,
      expire,
      signature,
      publicKey: IMAGEKIT_PUBLIC_KEY,
      urlEndpoint: IMAGEKIT_URL_ENDPOINT,
    });
  } catch (e) {
    console.error("ImageKit 인증 파라미터 생성 실패:", e);
    res.status(500).json({ error: "인증 파라미터 생성 실패" });
  }
});

// ══════════════════════════════════════════════════════════════
// 서버 시작
// ══════════════════════════════════════════════════════════════
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🎞️  FILM LAB 서버 실행: http://localhost:${PORT}`);
    console.log(`   스키마: filmcamera_shop`);
    console.log(`   ImageKit: ${IMAGEKIT_URL_ENDPOINT ? "활성" : "미설정"}`);
  });
}

module.exports = app;
