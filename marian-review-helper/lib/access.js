// 회원가입 / 로그인 (photo-poster 방식) — 이름 + 예식일자 + 전화번호 뒷4자리
const crypto = require("crypto");
const db = require("./db");
const { sendApprovalRequest } = require("./mail");

class AccessError extends Error {
  constructor(message, status) { super(message); this.status = status || 400; }
}
const clean = (v) => String(v || "").trim();

function validate(payload) {
  const name = clean(payload.name);
  const weddingDate = clean(payload.weddingDate);
  const phone4 = clean(payload.phone4);
  if (!name || !weddingDate || !phone4) throw new AccessError("이름·예식일자·전화번호 뒷자리를 모두 입력해 주세요.", 400);
  if (!/^\d{4}$/.test(phone4)) throw new AccessError("전화번호 뒷자리 4자리(숫자)를 정확히 입력해 주세요.", 400);
  return { name, weddingDate, phone4 };
}

// 회원가입 신청
async function signup(payload, baseUrl) {
  const { name, weddingDate, phone4 } = validate(payload);

  // 이미 신청/승인된 건 안내
  const exact = await db.findSignup(name, weddingDate, phone4);
  if (exact) {
    if (exact.status === "approved") return { ok: false, type: "warn", message: '이미 승인 완료되었습니다. "로그인" 탭에서 같은 정보로 로그인해 주세요.' };
    if (exact.status === "rejected") return { ok: false, type: "warn", message: "이전 신청이 거절되었습니다. 마리안 웨딩에 문의해 주세요." };
    return { ok: false, type: "warn", message: "이미 신청하셨습니다 (승인 대기 중). 운영자 승인 후 로그인 가능합니다." };
  }
  // 같은 이름·예식일자, 다른 번호
  const samePerson = await db.findByNameDate(name, weddingDate);
  if (samePerson) {
    return { ok: false, type: "warn", message: "같은 이름·예식일자로 다른 전화번호가 등록되어 있어요. 본인 번호 뒷자리를 다시 확인하시거나 마리안 운영자에 문의해 주세요." };
  }

  const token = crypto.randomBytes(16).toString("hex");
  const row = await db.createSignup(name, weddingDate, phone4, token);
  const approveUrl = `${baseUrl}/api/approve?token=${row.token}`;
  await sendApprovalRequest({ name, weddingDate, approveUrl });
  return { ok: true, type: "ok", message: "신청 완료. 마리안 운영자 승인 후 로그인하실 수 있습니다." };
}

// 로그인
async function login(payload) {
  const { name, weddingDate, phone4 } = validate(payload);
  const exact = await db.findSignup(name, weddingDate, phone4);
  if (!exact) {
    const byND = await db.findByNameDate(name, weddingDate);
    if (byND) throw new AccessError("전화번호 뒷자리가 일치하지 않습니다. 승인받은 번호로 입력해 주세요.", 401);
    throw new AccessError("신청 내역이 없습니다. 회원가입을 먼저 진행해 주세요.", 404);
  }
  if (exact.status === "pending") throw new AccessError("아직 승인되지 않았습니다. 마리안 운영자 승인 대기 중이에요.", 403);
  if (exact.status === "rejected") throw new AccessError("신청이 거절되었습니다. 마리안 웨딩에 문의해 주세요.", 403);
  return { ok: true, name: exact.name, weddingDate: exact.wedding_date, userId: exact.id };
}

// 이메일 링크 승인
async function approveToken(token) {
  if (!token) throw new AccessError("잘못된 링크입니다.", 400);
  const row = await db.approveByToken(clean(token));
  if (!row) throw new AccessError("이미 처리되었거나 유효하지 않은 링크입니다.", 404);
  return row;
}

module.exports = { signup, login, approveToken, AccessError };
