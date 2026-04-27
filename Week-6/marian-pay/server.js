// 마리안 웨딩 결제 서버
// TossPayments 테스트 키 사용 — 실결제 발생하지 않음

require('dotenv').config({ path: '.env.local', quiet: true });

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 3010;

// TossPayments — 환경변수 우선, 없으면 공식 문서 테스트 키
const TOSS_CLIENT_KEY = process.env.TOSS_CLIENT_KEY || 'test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm';
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY || 'test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6';

// Resend — 결제 알림 이메일 발송
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL; // 알림 받을 사장님 메일
const FROM_EMAIL = process.env.FROM_EMAIL || 'MARIAN WEDDING <onboarding@resend.dev>';
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

async function sendPaymentNotification(order) {
  if (!resend || !NOTIFY_EMAIL) {
    console.warn('[이메일 미발송] RESEND_API_KEY 또는 NOTIFY_EMAIL 환경변수가 설정되지 않았습니다');
    return;
  }
  try {
    const html = `
      <div style="max-width:520px;margin:0 auto;padding:32px;font-family:'Noto Sans KR',sans-serif;background:#faf9f7;color:#2a2725;">
        <div style="text-align:center;padding:24px 0;border-bottom:1px solid #e8e4dc;">
          <p style="font-family:'Cormorant Garamond',serif;font-size:36px;font-weight:300;letter-spacing:0.3em;margin:0;">MARIAN</p>
          <p style="font-size:10px;letter-spacing:0.3em;color:#8b8580;margin:8px 0 0;">NEW PAYMENT RECEIVED</p>
        </div>

        <div style="padding:32px 0;text-align:center;">
          <p style="font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:300;margin:0;">
            ${order.groomName} <span style="color:#8b6f47;">&</span> ${order.brideName}
          </p>
          <p style="font-size:11px;letter-spacing:0.2em;color:#8b8580;margin:8px 0 0;">${order.weddingDate}</p>
          <p style="font-family:'Cormorant Garamond',serif;font-size:32px;font-weight:300;margin:24px 0 0;">
            ₩ ${order.amount.toLocaleString()}
          </p>
          <p style="font-size:10px;letter-spacing:0.3em;color:#8b6f47;margin:4px 0 0;">
            ${order.type === '예약금' ? 'DEPOSIT · 예약금' : 'BALANCE · 잔금'}
          </p>
        </div>

        <table style="width:100%;border-top:1px solid #e8e4dc;border-collapse:collapse;font-size:13px;">
          <tr><td style="padding:12px 0;color:#8b8580;width:40%;">신청자</td><td style="padding:12px 0;">${order.name}</td></tr>
          <tr><td style="padding:12px 0;color:#8b8580;border-top:1px solid #f4f1eb;">연락처</td><td style="padding:12px 0;border-top:1px solid #f4f1eb;"><a href="tel:${order.phone}" style="color:#2a2725;text-decoration:none;">${order.phone}</a></td></tr>
          <tr><td style="padding:12px 0;color:#8b8580;border-top:1px solid #f4f1eb;">결제 수단</td><td style="padding:12px 0;border-top:1px solid #f4f1eb;">${order.method || '-'}</td></tr>
          <tr><td style="padding:12px 0;color:#8b8580;border-top:1px solid #f4f1eb;">결제 일시</td><td style="padding:12px 0;border-top:1px solid #f4f1eb;">${new Date(order.paidAt).toLocaleString('ko-KR')}</td></tr>
          <tr><td style="padding:12px 0;color:#8b8580;border-top:1px solid #f4f1eb;">주문번호</td><td style="padding:12px 0;border-top:1px solid #f4f1eb;font-size:11px;color:#8b8580;">${order.orderId}</td></tr>
        </table>

        <p style="text-align:center;font-size:10px;letter-spacing:0.3em;color:#8b8580;margin-top:32px;">
          SECURED BY TOSSPAYMENTS
        </p>
      </div>
    `;

    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `[MARIAN] 신규 결제 — ${order.groomName} & ${order.brideName} · ₩${order.amount.toLocaleString()}`,
      html,
    });

    if (result.error) {
      console.error('[이메일 발송 실패]', result.error);
    } else {
      console.log(`[이메일 발송] ${NOTIFY_EMAIL} — ${order.orderId}`);
    }
  } catch (err) {
    console.error('[이메일 발송 예외]', err);
  }
}

app.use(express.json());

// 주문 메모리 저장소 (데모용 — 서버 재시작 시 초기화됨)
const orders = new Map();

// 클라이언트 키 노출 (서버에서 환경변수 관리, 클라이언트는 GET으로 받아감)
app.get('/api/config', (req, res) => {
  res.json({ clientKey: TOSS_CLIENT_KEY });
});

// 주문 생성 — 결제 위젯 띄우기 전에 호출
app.post('/api/orders', (req, res) => {
  const { type, name, phone, groomName, brideName, weddingDate, amount } = req.body;

  if (!type || !['예약금', '잔금'].includes(type)) {
    return res.status(400).json({ error: '결제 종류가 올바르지 않습니다' });
  }
  if (!name || !phone) {
    return res.status(400).json({ error: '신청자 이름과 연락처는 필수입니다' });
  }
  if (!groomName || !brideName) {
    return res.status(400).json({ error: '신랑·신부 이름은 필수입니다' });
  }
  if (!weddingDate || !/^\d{4}-\d{2}-\d{2}$/.test(weddingDate)) {
    return res.status(400).json({ error: '예식 날짜를 선택해주세요' });
  }

  // 예약금은 30만원 고정, 잔금은 만원 단위
  let finalAmount;
  if (type === '예약금') {
    finalAmount = 300000;
  } else {
    const num = Number(amount);
    if (!Number.isInteger(num) || num < 10000 || num % 10000 !== 0) {
      return res.status(400).json({ error: '잔금은 만원 단위로 입력해주세요 (최소 1만원)' });
    }
    finalAmount = num;
  }

  const orderId = `marian_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const orderName = type === '예약금'
    ? `마리안웨딩 예약금 (${groomName}♥${brideName})`
    : `마리안웨딩 잔금 (${groomName}♥${brideName})`;

  const order = {
    orderId,
    orderName,
    type,
    name,
    phone,
    groomName,
    brideName,
    weddingDate,
    amount: finalAmount,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  orders.set(orderId, order);

  console.log(`[주문 생성] ${orderId} — ${type} / 신청자:${name} / ${groomName}♥${brideName} / ${weddingDate} / ${finalAmount}원`);
  res.json({ orderId, orderName, amount: finalAmount });
});

// 결제 승인 — TossPayments에 시크릿 키로 승인 요청
app.post('/api/confirm', async (req, res) => {
  const { paymentKey, orderId, amount } = req.body;

  const order = orders.get(orderId);
  if (!order) {
    return res.status(404).json({ error: '주문을 찾을 수 없습니다' });
  }
  if (order.amount !== Number(amount)) {
    return res.status(400).json({ error: '주문 금액이 일치하지 않습니다' });
  }

  try {
    const auth = Buffer.from(`${TOSS_SECRET_KEY}:`).toString('base64');
    const response = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paymentKey, orderId, amount: Number(amount) }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[결제 승인 실패]', data);
      order.status = 'failed';
      order.failReason = data.message;
      return res.status(response.status).json({ error: data.message, code: data.code });
    }

    order.status = 'completed';
    order.paidAt = new Date().toISOString();
    order.method = data.method;
    order.paymentKey = paymentKey;

    console.log(`[결제 완료] ${orderId} — ${order.name} / ${order.amount}원 / ${data.method}`);

    // 사장님에게 이메일 알림 발송 (실패해도 결제 응답은 정상 반환)
    sendPaymentNotification(order).catch((e) => console.error('이메일 발송 비동기 오류', e));

    res.json({ order, payment: data });
  } catch (err) {
    console.error('[결제 승인 중 오류]', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
});

// 주문 조회 (성공 페이지에서 사용)
app.get('/api/orders/:orderId', (req, res) => {
  const order = orders.get(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: '주문을 찾을 수 없습니다' });
  }
  res.json(order);
});

// SPA 라우팅 — 모든 경로에서 index.html 서빙
app.use(express.static(path.join(__dirname)));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 로컬 실행 시에만 listen (Vercel serverless 환경에서는 export만 사용)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`마리안 웨딩 결제 → http://localhost:${PORT}`);
    console.log(TOSS_CLIENT_KEY.startsWith('test_') ? 'TossPayments 테스트 키 사용 중 (실결제 X)' : 'TossPayments 실키 사용 중');
    console.log(resend && NOTIFY_EMAIL ? `이메일 알림: ${NOTIFY_EMAIL}` : '이메일 알림: 비활성 (환경변수 필요)');
  });
}

module.exports = app;
