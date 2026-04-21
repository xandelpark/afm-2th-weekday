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

// Gemini 503 UNAVAILABLE(일시 과부하)에 대비해 지수 백오프로 재시도
async function callGeminiWithRetry(args, { maxAttempts = 4 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await genai.models.generateContent(args);
    } catch (e) {
      lastErr = e;
      const msg = e?.message || String(e);
      const isOverloaded = /503|UNAVAILABLE|overload/i.test(msg);
      if (!isOverloaded || attempt === maxAttempts) throw e;
      // 800ms, 1600ms, 3200ms (+ 지터)
      const delay = 800 * 2 ** (attempt - 1) + Math.floor(Math.random() * 300);
      console.warn(`Gemini 503 재시도 ${attempt}/${maxAttempts - 1} (${delay}ms 후)`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

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

const SCHEMA_DOC = `## 데이터베이스 스키마
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
- 필요하면 여러 쿼리를 순차 실행해 종합 분석`;

const SYSTEM_PROMPT = `당신은 사용자의 가계부 데이터를 분석하는 친절한 AI 재정 어드바이저입니다.

${SCHEMA_DOC}

## 답변 스타일
- 한국어로 친근하고 간결하게 (2~4 문단)
- 금액은 한국어 쉼표 포맷: 예) 1,234,567원
- 추측 금지: DB에 없는 사실은 단정하지 말 것
- 인사이트나 절약 팁을 1~2가지 덧붙이면 좋음
- 불필요한 서론("알겠습니다", "좋은 질문입니다") 생략`;

const COACH_SYSTEM_PROMPT = `당신은 사용자의 **개인 소비습관 코치**입니다. 가계부 DB(ledger.entries)를 분석해서 잔소리 없는 현실적인 조언을 제공합니다.

${SCHEMA_DOC}

## 코치 원칙
- **잔소리 금지**: "너무 많이 쓰셨네요" 같은 비난조 X. 사용자 라이프스타일 존중 (필라테스·문화생활 등 의미있는 소비는 격려)
- **구체적 숫자 인용**: 일반론("외식을 줄이세요") X → 구체적 대안("이자카야 5만 + 오마카세 10만을 월 1회로 줄이면 ○만원 절감") O
- **특수 지출 분리**: 경조사(어버이날·결혼식)·의료·보증금 같은 비정기 지출은 따로 언급. 생활비 평균에 희석시키지 말 것
- **잘하는 점 먼저**: 구독료·교통비 등 잘 관리하는 카테고리를 먼저 칭찬한 후 개선점 제시
- **대안과 효과 쌍**: "A를 B로 바꾸면 월 ○원 절감" 형태로 제시
- **4만원 이상 외식**이나 **10만원 이상 쇼핑**처럼 "이벤트성 고액 지출"을 패턴으로 파악

## 반드시 실행할 조회 (분석 전 데이터 수집)
최소한 아래 쿼리들을 실행해 데이터를 수집하세요. 추가 조회도 자유롭게 하세요.
1. 대상 월 수입/지출 합계: \`SELECT type, SUM(amount)::bigint total, COUNT(*)::int cnt FROM ledger.entries WHERE entry_date BETWEEN '<월초>' AND '<월말>' GROUP BY type\`
2. 대상 월 카테고리별 지출: \`SELECT category, SUM(amount)::bigint total, COUNT(*)::int cnt FROM ledger.entries WHERE type='expense' AND entry_date BETWEEN '<월초>' AND '<월말>' GROUP BY category ORDER BY total DESC\`
3. 대상 월 고액 지출 TOP: \`SELECT TO_CHAR(entry_date,'YYYY-MM-DD') d, category, amount, memo FROM ledger.entries WHERE type='expense' AND entry_date BETWEEN '<월초>' AND '<월말>' ORDER BY amount DESC LIMIT 10\`
4. (선택) 식비/쇼핑 등 관심 카테고리의 상세 내역

## 응답 형식 (반드시 이 4개 섹션으로, 이 순서대로, 정확히 이 헤더로)

## 📊 현황
- 수입 / 지출 / 수지(적자·흑자)를 숫자로 명확히
- 카테고리 TOP 3~5을 표 또는 리스트로
- 특수 지출(경조사·보증금 등)이 있으면 별도로 표시

## 💡 인사이트
- 2~4개의 패턴 발견 사항 (불릿)
- "잘하고 있는 것"도 1개 이상 반드시 포함
- 경조사 등 비정기 지출은 특수 케이스로 해석

## ✂️ 절약 포인트
- 2~4개의 구체적 제안 (강제 아님, 선택지로 제시)
- 각 제안마다 **구체적 금액 효과** 포함 ("월 ○원 절감")
- 가장 효과 큰 것부터 순서대로

## 📈 시뮬레이션
- 현재 패턴 유지 시 월/연간 저축 가능액
- 개선안 적용 시 월/연간 저축 가능액
- 필요시 부수입 증대 시나리오 추가

## 중요
- 서론 없이 바로 "## 📊 현황"으로 시작
- 금액은 쉼표 포맷 (예: 1,234,567원)
- 추측 금지 — DB에 없는 사실 단정 X
- 잘 모르는 부분은 "데이터가 부족해요"라고 솔직히`;

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

// Gemini function-calling 루프: 첫 user turn → 모델이 SQL 호출 → 결과 반환 → 최종 답변
// 성공 시 { answer, queries, usage }, 실패 시 throw
async function runGeminiLoop({ systemInstruction, userText, maxTurns = 6 }) {
  const contents = [{ role: "user", parts: [{ text: userText }] }];
  const queriesExecuted = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await callGeminiWithRetry({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: [LEDGER_FUNCTION] }],
        temperature: 0.3,
      },
    });

    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);

    if (functionCalls.length === 0) {
      const answer = (response.text || parts.map((p) => p.text || "").join("")).trim();
      return {
        answer: answer || "답변을 생성하지 못했습니다.",
        queries: queriesExecuted,
        usage: response.usageMetadata,
      };
    }

    contents.push({ role: "model", parts });

    const responseParts = [];
    for (const call of functionCalls) {
      if (call.name !== "query_ledger") {
        responseParts.push({
          functionResponse: { name: call.name, response: { error: `알 수 없는 함수: ${call.name}` } },
        });
        continue;
      }
      const sql = call.args?.sql || "";
      const validationErr = validateSQL(sql);
      if (validationErr) {
        responseParts.push({
          functionResponse: { name: "query_ledger", response: { error: validationErr } },
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
          functionResponse: { name: "query_ledger", response: { rows: safeRows, rowCount: rows.length } },
        });
      } catch (e) {
        console.error("AI SQL 실행 오류:", e.message, "| SQL:", sql);
        responseParts.push({
          functionResponse: { name: "query_ledger", response: { error: `SQL 실행 오류: ${e.message}` } },
        });
      }
    }
    contents.push({ role: "user", parts: responseParts });
  }

  const err = new Error(`답변 루프 한도(${maxTurns}회) 초과`);
  err.queries = queriesExecuted;
  throw err;
}

// Gemini 호출 관련 에러를 사용자 친화적 HTTP 응답으로 변환
function handleGeminiError(e, res) {
  console.error("Gemini 호출 실패:", e);
  const msg = e?.message || String(e);
  if (/답변 루프 한도/i.test(msg)) {
    return res.status(500).json({ error: `${msg} — 데이터가 많거나 질문이 복잡해요`, queries: e.queries || [] });
  }
  if (/api[_ ]?key/i.test(msg) || /unauthor/i.test(msg) || /401/.test(msg)) {
    return res.status(500).json({ error: "Gemini API 키 인증 실패" });
  }
  if (/quota|rate|429/i.test(msg)) {
    return res.status(429).json({ error: "Gemini 무료 한도 초과. 잠시 후 다시 시도해주세요." });
  }
  if (/503|UNAVAILABLE|overload/i.test(msg)) {
    return res.status(503).json({ error: "Gemini 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해주세요." });
  }
  res.status(500).json({ error: `AI 분석 실패: ${msg}` });
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
  const systemInstruction = `${SYSTEM_PROMPT}\n\n## 오늘 날짜\n${today}`;

  try {
    const result = await runGeminiLoop({ systemInstruction, userText: question });
    res.json(result);
  } catch (e) {
    handleGeminiError(e, res);
  }
});

// 소비습관 분석 — 월 단위 구조화된 피드백 (spending-coach 페르소나)
// 요청: { month?: "YYYY-MM" }  생략 시 가장 최근 데이터 있는 월
app.post("/api/analyze", async (req, res) => {
  if (!genai) {
    return res.status(500).json({
      error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다.",
    });
  }

  let { month } = req.body || {};
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "month 형식은 YYYY-MM 이어야 합니다" });
  }

  try {
    // month 지정 없으면 최근 데이터가 있는 달을 DB에서 찾음
    if (!month) {
      const { rows } = await pool.query(
        "SELECT TO_CHAR(MAX(entry_date), 'YYYY-MM') AS ym FROM ledger.entries"
      );
      month = rows[0]?.ym;
      if (!month) {
        return res.status(400).json({ error: "분석할 데이터가 없습니다. 내역을 먼저 등록해주세요." });
      }
    }

    // 해당 월의 시작/끝 날짜 계산 (UTC 기준 단순 문자열)
    const [y, m] = month.split("-").map(Number);
    const monthStart = `${month}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // 다음달 0일 = 이번달 마지막일
    const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;

    const today = new Date().toISOString().slice(0, 10);
    const userText = `사용자의 ${month} 소비습관을 분석해주세요.
- 분석 대상 기간: ${monthStart} ~ ${monthEnd}
- 반드시 4개 섹션(## 📊 현황, ## 💡 인사이트, ## ✂️ 절약 포인트, ## 📈 시뮬레이션) 형식으로 답변
- query_ledger 함수로 실제 데이터 먼저 조회 후 분석`;

    const systemInstruction = `${COACH_SYSTEM_PROMPT}\n\n## 오늘 날짜\n${today}\n## 분석 대상 월\n${month} (${monthStart} ~ ${monthEnd})`;

    const result = await runGeminiLoop({ systemInstruction, userText, maxTurns: 8 });
    res.json({ ...result, month, range: { start: monthStart, end: monthEnd } });
  } catch (e) {
    handleGeminiError(e, res);
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ 가계부 서버 실행: http://localhost:${PORT}`);
    console.log(`   AI Q&A: ${genai ? `활성화 (${GEMINI_MODEL})` : "비활성화 (GEMINI_API_KEY 미설정)"}`);
  });
}

module.exports = app;
