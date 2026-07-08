// 관리자 기능 — 인증(아이디/비번) 후 조회·삭제·리셋
// 비밀번호는 코드에 두지 않고 환경변수(ADMIN_PASS)로만 관리 (레포 공개)
const db = require("./db");

const USER = process.env.ADMIN_USER || "admin";
const PASS = process.env.ADMIN_PASS || "";

class AdminError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 400;
  }
}

async function handleAdmin(payload) {
  const { user, pass, action, id } = payload || {};

  if (!PASS) throw new AdminError("관리자 비밀번호가 서버에 설정되지 않았어요.", 503);
  if (user !== USER || pass !== PASS)
    throw new AdminError("아이디 또는 비밀번호가 올바르지 않아요.", 401);

  if (action === "list") {
    return { rows: await db.listUsage() };
  }
  if (action === "delete") {
    if (!id) throw new AdminError("삭제할 항목 id가 필요해요.", 400);
    const n = await db.deleteById(id);
    return { ok: true, deleted: n };
  }
  if (action === "reset") {
    const n = await db.resetAll();
    return { ok: true, deleted: n };
  }
  // 승인 요청 관리
  if (action === "access_list") {
    return { rows: await db.listAccessRequests() };
  }
  if (action === "access_approve") {
    if (!id) throw new AdminError("승인할 항목 id가 필요해요.", 400);
    await db.setAccessStatus(id, "approved");
    return { ok: true };
  }
  if (action === "access_reject") {
    if (!id) throw new AdminError("거절할 항목 id가 필요해요.", 400);
    await db.setAccessStatus(id, "rejected");
    return { ok: true };
  }
  if (action === "access_delete") {
    if (!id) throw new AdminError("삭제할 항목 id가 필요해요.", 400);
    await db.deleteAccessById(id);
    return { ok: true };
  }
  throw new AdminError("알 수 없는 동작이에요.", 400);
}

module.exports = { handleAdmin, AdminError };
