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
      <p style="letter-spacing:.2em;color:#8b8680;font-size:12px">MARIAN WEDDING · 후기 이용 승인 요청</p>
      <h2 style="font-weight:600">새 이용 신청이 도착했어요</h2>
      <table style="font-size:15px;line-height:2">
        <tr><td style="color:#8b8680;padding-right:16px">이름</td><td><b>${escapeHtml(name)}</b></td></tr>
        <tr><td style="color:#8b8680;padding-right:16px">예식일자</td><td><b>${escapeHtml(weddingDate)}</b></td></tr>
      </table>
      <p style="margin-top:24px">
        <a href="${approveUrl}" style="display:inline-block;background:#091940;color:#fff;text-decoration:none;padding:12px 28px;letter-spacing:.1em">승인하기</a>
      </p>
      <p style="color:#8b8680;font-size:13px;margin-top:16px">경쟁업체 방지용 확인 절차입니다. 예약 고객이 맞으면 위 버튼으로 승인해 주세요.</p>
    </div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [OWNER_EMAIL],
        subject: `[마리안웨딩] 후기 이용 승인 요청 — ${name} (${weddingDate})`,
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
