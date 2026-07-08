// Vercel 서버리스 — 예약 고객 이용 신청/승인확인
const { signup, login } = require("../lib/access");
const db = require("../lib/db");

let ensured = false;

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST만 허용됩니다." }); return; }
  try {
    if (!ensured && process.env.SKIP_DB !== "1") { await db.ensure(); ensured = true; }
    const payload = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const baseUrl = `https://${req.headers.host}`;
    const out = payload.action === "login"
      ? await login(payload)
      : await signup(payload, baseUrl);
    res.status(200).json(out);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("[access] 오류:", e);
    res.status(status).json({ error: e.message });
  }
};
