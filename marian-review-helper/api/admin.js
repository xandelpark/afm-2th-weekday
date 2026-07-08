// Vercel 서버리스 함수 — 관리자 조회/삭제/리셋
const { handleAdmin } = require("../lib/admin");
const db = require("../lib/db");

let ensured = false;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST만 허용됩니다." });
    return;
  }
  try {
    if (!ensured && process.env.SKIP_DB !== "1") {
      await db.ensure();
      ensured = true;
    }
    const payload =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const out = await handleAdmin(payload);
    res.status(200).json(out);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error("[admin] 오류:", e);
    res.status(status).json({ error: e.message });
  }
};
