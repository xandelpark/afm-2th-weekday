// 승인 요청 알림 메일 (Resend 사용). RESEND_API_KEY 없으면 조용히 생략.
const OWNER_EMAIL = process.env.OWNER_EMAIL || "xandelpark@naver.com";
const MAIL_FROM = process.env.MAIL_FROM || "마리안웨딩 후기 <onboarding@resend.dev>";

async function sendApprovalRequest({ name, weddingDate, approveUrl }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("[mail] RESEND_API_KEY 미설정 — 승인요청 메일 생략 (관리자 페이지에서 승인 가능)");
    return { sent: false, reason: "no_key" };
  }
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1a1815">
      <p style="letter-spacing:.2em;color:#8b8680;font-size:12px">MARIAN WEDDING · 후기 도구 새 가입</p>
      <h2 style="font-weight:600">새로운 분이 가입했어요</h2>
      <table style="font-size:15px;line-height:2">
        <tr><td style="color:#8b8680;padding-right:16px">이름</td><td><b>${escapeHtml(name)}</b></td></tr>
        <tr><td style="color:#8b8680;padding-right:16px">예식일자</td><td><b>${escapeHtml(weddingDate)}</b></td></tr>
      </table>
      <p style="color:#8b8680;font-size:13px;margin-top:20px">자동 가입되어 바로 이용 중입니다. 가입 내역은 관리자 페이지에서 확인·관리할 수 있어요.</p>
    </div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [OWNER_EMAIL],
        subject: `[마리안웨딩] 새 가입 — ${name} (${weddingDate})`,
        html,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("[mail] 발송 실패:", res.status, t.slice(0, 200));
      return { sent: false, reason: "send_failed" };
    }
    return { sent: true };
  } catch (e) {
    console.error("[mail] 오류:", e.message);
    return { sent: false, reason: "error" };
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

module.exports = { sendApprovalRequest };
