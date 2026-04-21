// 가계부 API 서버
// [클라이언트 입력] → [Server] → Supabase DB 저장/조회 → 응답

require("dotenv").config();
const path = require("path");
const express = require("express");
const { Pool } = require("pg");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3005;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const genai = GEMINI_KEY ? new GoogleGenAI({ apiKey: GEMINI_KEY }) : null;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

app.use(express.json());
app.use(express.static(__dirname));

// 루트 경로는 명시적으로 index.html을 서빙 (Serverless 환경 호환)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const EXPENSE_CATEGORIES = ["식비", "교통", "주거", "구독료", "경조사", "쇼핑", "문화/여가", "의료", "기타지출"];
const INCOME_CATEGORIES  = ["급여", "용돈", "부수입", "이자", "기타수입"];

function validateEntry(body) {
  const { type, date, amount, category, memo } = body || {};
  if (!["income", "expense"].includes(type)) return "type은 income 또는 expense";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return "date 형식이 올바르지 않음 (YYYY-MM-DD)";
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "amount는 0보다 큰 숫자";
  const pool_ = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  if (!pool_.includes(category)) return `category가 유효하지 않음: ${category}`;
  if (memo && String(memo).length > 500) return "memo가 너무 김 (최대 500자)";
  return null;
}

// 카테고리 목록
app.get("/api/categories", (req, res) => {
  res.json({ income: INCOME_CATEGORIES, expense: EXPENSE_CATEGORIES });
});

// 내역 등록
app.post("/api/entries", async (req, res) => {
  const err = validateEntry(req.body);
  if (err) return res.status(400).json({ error: err });

  const { type, date, amount, category, memo } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO ledger.entries (type, entry_date, amount, category, memo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, type, TO_CHAR(entry_date, 'YYYY-MM-DD') AS date, amount, category, memo, created_at`,
      [type, date, Math.floor(amount), category, memo || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error("POST /api/entries 실패:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

// 내역 목록
app.get("/api/entries", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, TO_CHAR(entry_date, 'YYYY-MM-DD') AS date, amount, category, memo, created_at
       FROM ledger.entries
       ORDER BY entry_date DESC, id DESC`
    );
    res.json(rows.map((r) => ({ ...r, amount: Number(r.amount) })));
  } catch (e) {
    console.error("GET /api/entries 실패:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

// 내역 삭제
app.delete("/api/entries/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "id 오류" });
  try {
    const { rowCount } = await pool.query("DELETE FROM ledger.entries WHERE id = $1", [id]);
    if (rowCount === 0) return res.status(404).json({ error: "대상 없음" });
    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/entries 실패:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

// 카테고리별 합계 + 전체 요약
app.get("/api/stats", async (req, res) => {
  try {
    const [summary, byCategory] = await Promise.all([
      pool.query(`
        SELECT type, SUM(amount)::bigint AS total
        FROM ledger.entries GROUP BY type
      `),
      pool.query(`
        SELECT type, category, SUM(amount)::bigint AS total, COUNT(*)::int AS count
        FROM ledger.entries
        GROUP BY type, category
        ORDER BY total DESC
      `),
    ]);

    const totals = { income: 0, expense: 0 };
    summary.rows.forEach((r) => { totals[r.type] = Number(r.total); });

    const categoryStats = { income: [], expense: [] };
    byCategory.rows.forEach((r) => {
      categoryStats[r.type].push({
        category: r.category,
        total: Number(r.total),
        count: r.count,
      });
    });

    res.json({
      totals: {
        income:  totals.income,
        expense: totals.expense,
        balance: totals.income - totals.expense,
      },
      categoryStats,
    });
  } catch (e) {
    console.error("GET /api/stats 실패:", e.message);
    res.status(500).json({ error: "DB 오류" });
  }
});

// ────────────────────────────────────────────────────────────────────────
// AI 자연어 Q&A 엔드포인트 (Google Gemini + function calling)
// [질문] → Gemini가 SQL 생성 → ledger.entries 조회 → AI가 답변 합성
// ────────────────────────────────────────────────────────────────────────

const LEDGER_FUNCTION = {
  name: "query_ledger",
  description:
    "가계부 DB(ledger.entries)에 SELECT 쿼리를 실행합니다. " +
    "SELECT 문만 허용되며 ledger.entries 테이블만 접근 가능합니다. " +
    "세미콜론은 사용할 수 없습니다. 여러 쿼리가 필요하면 순차적으로 호출하세요.",
  parameters: {
    type: "object",
    properties: {
      sql: {
        type: "string",
        description:
          "실행할 SELECT 문. 예: SELECT category, SUM(amount) AS total FROM ledger.entries WHERE type='expense' GROUP BY category ORDER BY total DESC",
      },
    },
    required: ["sql"],
  },
};

const SYSTEM_PROMPT = `당신은 사용자의 가계부 데이터를 분석하는 친절한 AI 재정 어드바이저입니다.

## 데이터베이스 스키마
테이블: ledger.entries
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | BIGSERIAL | PK |
| type | VARCHAR | 'income' 또는 'expense' |
| entry_date | DATE | 거래 날짜 (YYYY-MM-DD) |
| amount | BIGINT | 금액 (원 단위, 양수) |
| category | VARCHAR | 카테고리명 |
| memo | TEXT | 메모 (NULL 가능) |
| created_at | TIMESTAMPTZ | 생성 시각 |

## 카테고리
- 지출(type='expense'): 식비, 교통, 주거, 구독료, 경조사, 쇼핑, 문화/여가, 의료, 기타지출
- 수입(type='income'): 급여, 용돈, 부수입, 이자, 기타수입

## 쿼리 규칙
- 항상 query_ledger 도구를 호출해 SELECT 문으로 실제 데이터를 조회하세요
- 테이블 경로는 반드시 ledger.entries (스키마 접두사 포함)
- 세미콜론 금지. 한 번에 한 문장만
- 날짜 포맷팅이 필요하면 TO_CHAR(entry_date, 'YYYY-MM-DD') 사용
- 필요하면 여러 쿼리를 순차 실행해 종합 분석

## 답변 스타일
- 한국어로 친근하고 간결하게 (2~4 문단)
- 금액은 한국어 쉼표 포맷: 예) 1,234,567원
- 추측 금지: DB에 없는 사실은 단정하지 말 것
- 인사이트나 절약 팁을 1~2가지 덧붙이면 좋음
- 불필요한 서론("알겠습니다", "좋은 질문입니다") 생략`;

function validateSQL(sql) {
  const s = (sql || "").trim();
  if (!s) return "빈 쿼리";
  if (s.includes(";")) return "세미콜론은 사용할 수 없습니다";
  if (!/^select\b/i.test(s)) return "SELECT 문만 허용됩니다";
  if (!/\bledger\.entries\b/i.test(s)) return "ledger.entries 테이블만 접근 가능합니다";
  if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/i.test(s)) {
    return "읽기 전용 쿼리만 허용됩니다";
  }
  return null;
}

app.post("/api/ask", async (req, res) => {
  if (!genai) {
    return res.status(500).json({
      error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다. https://aistudio.google.com/apikey 에서 발급 후 설정하세요.",
    });
  }

  const { question } = req.body || {};
  if (!question || typeof question !== "string") {
    return res.status(400).json({ error: "질문을 입력하세요" });
  }
  if (question.length > 500) {
    return res.status(400).json({ error: "질문이 너무 깁니다 (최대 500자)" });
  }

  const today = new Date().toISOString().slice(0, 10);
  const systemWithDate = `${SYSTEM_PROMPT}\n\n## 오늘 날짜\n${today}`;

  // Gemini contents 배열: role = "user" | "model", parts = [{text}|{functionCall}|{functionResponse}]
  const contents = [{ role: "user", parts: [{ text: question }] }];
  const queriesExecuted = [];
  const MAX_TURNS = 6;

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await genai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: {
          systemInstruction: systemWithDate,
          tools: [{ functionDeclarations: [LEDGER_FUNCTION] }],
          temperature: 0.3,
        },
      });

      const candidate = response.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);

      if (functionCalls.length === 0) {
        const answer = (response.text || parts.map((p) => p.text || "").join("")).trim();
        return res.json({
          answer: answer || "답변을 생성하지 못했습니다.",
          queries: queriesExecuted,
          usage: response.usageMetadata,
        });
      }

      // 모델의 function call turn을 히스토리에 추가
      contents.push({ role: "model", parts });

      // 각 function call 실행 → functionResponse parts 생성
      const responseParts = [];
      for (const call of functionCalls) {
        if (call.name !== "query_ledger") {
          responseParts.push({
            functionResponse: {
              name: call.name,
              response: { error: `알 수 없는 함수: ${call.name}` },
            },
          });
          continue;
        }
        const sql = call.args?.sql || "";
        const validationErr = validateSQL(sql);
        if (validationErr) {
          responseParts.push({
            functionResponse: {
              name: "query_ledger",
              response: { error: validationErr },
            },
          });
          continue;
        }
        try {
          const { rows } = await pool.query(sql);
          const safeRows = rows.slice(0, 200).map((r) =>
            Object.fromEntries(
              Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])
            )
          );
          queriesExecuted.push({ sql, rowCount: rows.length });
          responseParts.push({
            functionResponse: {
              name: "query_ledger",
              response: { rows: safeRows, rowCount: rows.length },
            },
          });
        } catch (e) {
          console.error("AI SQL 실행 오류:", e.message, "| SQL:", sql);
          responseParts.push({
            functionResponse: {
              name: "query_ledger",
              response: { error: `SQL 실행 오류: ${e.message}` },
            },
          });
        }
      }
      contents.push({ role: "user", parts: responseParts });
    }

    res.status(500).json({
      error: `답변 루프 한도(${MAX_TURNS}회) 초과 — 질문을 더 구체적으로 해주세요`,
      queries: queriesExecuted,
    });
  } catch (e) {
    console.error("/api/ask 실패:", e);
    const msg = e?.message || String(e);
    if (/api[_ ]?key/i.test(msg) || /unauthor/i.test(msg) || /401/.test(msg)) {
      return res.status(500).json({ error: "Gemini API 키 인증 실패" });
    }
    if (/quota|rate|429/i.test(msg)) {
      return res.status(429).json({ error: "Gemini 무료 한도 초과. 잠시 후 다시 시도해주세요." });
    }
    res.status(500).json({ error: `AI 분석 실패: ${msg}` });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ 가계부 서버 실행: http://localhost:${PORT}`);
    console.log(`   AI Q&A: ${genai ? `활성화 (${GEMINI_MODEL})` : "비활성화 (GEMINI_API_KEY 미설정)"}`);
  });
}

module.exports = app;
