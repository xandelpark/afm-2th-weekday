// 후기 생성 서비스 — 횟수제한 확인 → 생성 → 기록
const { generateReview } = require("./generate");
const db = require("./db");

const skipDb = () => process.env.SKIP_DB === "1";

function normalizePhone(v) {
  return String(v || "").replace(/[^0-9]/g, "");
}

// 커스텀 오류 (핸들러가 status로 응답 코드 결정)
class ReviewError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status || 400;
    this.code = code;
  }
}

async function createReview(payload) {
  const phone = normalizePhone(payload.phone);
  const name = (payload.name || "").trim();
  const channel = payload.channel === "블로그" ? "블로그" : "카페";

  if (!name) throw new ReviewError("성함을 입력해 주세요.", 400);
  if (phone.length < 10) throw new ReviewError("연락처를 정확히 입력해 주세요.", 400);

  // 1) 횟수 제한 확인 (연락처당 카페 1회 + 블로그 1회)
  if (!skipDb()) {
    const used = await db.hasUsed(phone, channel);
    if (used) {
      throw new ReviewError(
        `이미 ${channel} 후기를 작성하셨어요. (연락처당 카페·블로그 각 1회만 가능해요)`,
        409,
        "LIMIT"
      );
    }
  }

  // 2) 생성 — 채널이 곧 길이 (카페=중간/500자+, 블로그=장문/1000자+)
  const review = await generateReview({
    type: payload.type,
    tone: payload.tone,
    length: channel === "블로그" ? "장문" : "중간",
    items: payload.items,
  });

  // 3) 기록
  if (!skipDb()) {
    await db.record(phone, name, channel, payload.type);
  }

  return { review };
}

module.exports = { createReview, ReviewError };
