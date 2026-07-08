// 로컬 개발 서버 — index.html 서빙 + /api/generate (횟수제한 포함)
require("dotenv").config();
const express = require("express");
const path = require("path");
const { createReview } = require("./lib/service");
const { handleAdmin } = require("./lib/admin");
const db = require("./lib/db");

const app = express();
app.use(express.json({ limit: "1mb" }));

app.post("/api/generate", async (req, res) => {
  try {
    const result = await createReview(req.body || {});
    res.json(result);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("[generate] 오류:", e);
    res.status(status).json({ error: e.message, code: e.code });
  }
});

app.post("/api/admin", async (req, res) => {
  try {
    const out = await handleAdmin(req.body || {});
    res.json(out);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("[admin] 오류:", e);
    res.status(status).json({ error: e.message });
  }
});

app.use(express.static(__dirname));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

const PORT = process.env.PORT || 3210;

async function start() {
  if (process.env.SKIP_DB !== "1") {
    try {
      await db.ensure();
      console.log("✓ Supabase 연결·테이블 준비 완료 (wedding_review.usage)");
    } catch (e) {
      console.warn("⚠️  DB 준비 실패:", e.message, "(SKIP_DB=1 로 우회 가능)");
    }
  }
  app.listen(PORT, () => {
    console.log(`더화려한날엔 후기비서 dev 서버: http://localhost:${PORT}`);
    if (!process.env.GEMINI_API_KEY && !process.env.MOCK_REVIEW)
      console.warn("⚠️  GEMINI_API_KEY 미설정 — MOCK_REVIEW=1 로 UI 테스트 가능");
  });
}
start();
