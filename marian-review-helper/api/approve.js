// Vercel 서버리스 — 이메일 승인 링크 (GET ?token=...)
const { approveToken } = require("../lib/access");
const db = require("../lib/db");

let ensured = false;

function page(title, msg, ok) {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500&display=swap" rel="stylesheet"/>
  <style>body{font-family:-apple-system,sans-serif;background:#fff;color:#1a1815;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  .box{text-align:center;padding:40px}.mk{font-family:'Cormorant Garamond',serif;letter-spacing:.3em;font-size:26px}
  .dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-bottom:16px;background:${ok ? "#091940" : "#c0392b"}}
  h1{font-weight:600;font-size:20px}p{color:#8b8680}</style></head>
  <body><div class="box"><div class="mk">MARIAN</div><div style="height:20px"></div>
  <div class="dot"></div><h1>${title}</h1><p>${msg}</p></div></body></html>`;
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  try {
    if (!ensured && process.env.SKIP_DB !== "1") { await db.ensure(); ensured = true; }
    const token = (req.query && req.query.token) || "";
    const row = await approveToken(token);
    res.status(200).send(page("승인 완료", `${row.name}님(${row.wedding_date})의 이용을 승인했습니다.`, true));
  } catch (e) {
    res.status(e.status || 500).send(page("승인 실패", e.message || "오류가 발생했어요.", false));
  }
};
