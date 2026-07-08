// Vercel 서버리스 함수 — 설문 답변 + 이름/연락처/채널을 받아 후기 생성 (횟수제한 포함)
const { createReview } = require("../lib/service");
const db = require("../lib/db");

let ensured = false;
async function ensureOnce() {
  if (ensured || process.env.SKIP_DB === "1") return;
  await db.ensure();
  ensured = true;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST만 허용됩니다." });
    return;
  }
  try {
    await ensureOnce();
    const payload =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const result = await createReview(payload);
    res.status(200).json(result);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("[generate] 오류:", e);
    res.status(status).json({ error: e.message, code: e.code });
  }
};
