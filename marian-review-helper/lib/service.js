// 후기 생성 서비스 — 횟수제한 확인 → 생성 → 기록
const { generateReview } = require("./generate");
const db = require("./db");

const skipDb = () => process.env.SKIP_DB === "1";
const PER_CHANNEL = Number(process.env.MARIAN_QUOTA || 3); // 채널(카페/블로그)당 작성 가능 횟수
const ADMIN_PASS = process.env.ADMIN_PASS || "";

// 커스텀 오류 (핸들러가 status로 응답 코드 결정)
class ReviewError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status || 400;
    this.code = code;
  }
}

async function createReview(payload) {
  // 관리자면 무제한(테스트용) — 횟수제한·기록 건너뜀
  const isAdmin = ADMIN_PASS && payload.adminPass === ADMIN_PASS;

  // 로그인 계정 기준 (회원가입 승인된 사용자 id). 재입력 없이 세션에서 넘어옴.
  const userId = String(payload.userId || "").trim();
  const name = (payload.name || "").trim();
  const channel = payload.channel === "블로그" ? "블로그" : "카페";

  if (!isAdmin && !userId) throw new ReviewError("로그인 정보가 없습니다. 다시 로그인해 주세요.", 401);

  // 1) 횟수 제한 확인 (계정당 채널별 PER_CHANNEL회) — 관리자는 무제한
  if (!skipDb() && !isAdmin) {
    const cnt = await db.countUsage(userId, channel);
    if (cnt >= PER_CHANNEL) {
      throw new ReviewError(
        `${channel} 후기는 계정당 ${PER_CHANNEL}회까지 작성할 수 있어요. (이미 ${cnt}회 작성)`,
        409,
        "LIMIT"
      );
    }
  }

  // 2) 생성 — 채널이 곧 길이 (카페=중간/500자+, 블로그=장문/1000자+)
  const gen = await generateReview({
    type: payload.type,
    tone: payload.tone,
    channel, // 카페 | 블로그 (SEO 최적화 분기)
    length: channel === "블로그" ? "장문" : "중간",
    items: payload.items,
  });

  // 3) 기록 (usage.phone 컬럼을 계정 id 저장용으로 사용) — 관리자 테스트는 기록 안 함
  if (!skipDb() && !isAdmin) {
    await db.record(userId, name, channel, payload.type);
  }

  return gen; // { title, review }
}

module.exports = { createReview, ReviewError };
