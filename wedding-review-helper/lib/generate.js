// 후기 초안 생성 로직 (Vercel 서버리스 함수 + 로컬 Express 서버가 공유)
// Google Gemini 2.0 Flash 사용 (무료 티어). GEMINI_API_KEY 환경변수 필요.

// Gemini REST 호출
async function callGemini(system, userText) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: {
        maxOutputTokens: 3000,
        temperature: 1.0,
        thinkingConfig: { thinkingBudget: 0 }, // 후기 작성엔 thinking 불필요 (분량·속도 확보)
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  return parts.map((p) => p.text || "").join("").trim();
}

const BUSINESS = "더화려한날엔"; // 본식스냅 업체명 (thewonderfulday.co.kr)

// 글 말미에 자동으로 붙는 업체 링크 (여기 한 곳만 수정하면 됨)
const LINKS = {
  homepage: "http://thewonderfulday.co.kr",
  kakao: "https://pf.kakao.com/_xnwcxkn", // 카카오톡 채널
};

// 후기 본문 뒤에 붙일 링크 푸터
function buildFooter() {
  const lines = ["", "", "─────────────", `📸 ${BUSINESS}`, `홈페이지 · ${LINKS.homepage}`];
  if (LINKS.kakao) lines.push(`카카오톡 상담 · ${LINKS.kakao}`);
  return "\n" + lines.join("\n");
}

// 시스템 프롬프트 — "AI 티"를 최대한 지우는 게 핵심
const SYSTEM = `너는 실제 신부가 직접 쓴 것처럼 자연스러운 웨딩 후기 글을 대신 써주는 도우미다.
업체는 본식스냅(예식 당일 스냅) 전문 "${BUSINESS}"(thewonderfulday.co.kr)이다.
사용자는 웨딩카페와 개인블로그에 이 후기를 올릴 예정이다.

[가장 중요 — AI가 쓴 티가 나지 않게]
- 광고·홍보 문구처럼 쓰지 마라. 실제 신부가 카페/블로그에 편하게 남기는 톤으로 써라.
- 문장 길이를 일부러 들쭉날쭉하게 섞어라. 짧은 문장과 긴 문장을 번갈아 써라.
- "정말 만족스러운 선택이었습니다", "강력 추천합니다" 같은 뻔한 후기 클리셰를 남발하지 마라.
- 개조식/불릿/소제목/이모지 나열을 쓰지 마라. 자연스러운 문단(2~3개)으로만 써라.
- 사용자가 체크한 내용에 담긴 구체적인 사실만 활용하고, 주어지지 않은 사실(가격 숫자, 특정 이름, 없던 에피소드)을 지어내지 마라.
- 신부(1인칭, "저희"/"제가") 시점으로 써라.
- 업체명 "${BUSINESS}"은 글 안에서 1~2번만 자연스럽게 언급하고, 매 문장 반복하지 마라.
- 항상 존댓말로 써라. 반말은 절대 쓰지 마라.

[출력]
- 후기 본문 텍스트만 출력해라. 제목, 머리말, "아래는 후기입니다" 같은 안내 문구, 마크다운 기호를 넣지 마라.
- 링크·URL·전화번호·카카오채널 같은 연락처는 네가 쓰지 마라. (본문 뒤에 시스템이 자동으로 붙인다)`;

// 톤/길이 지침 — 두 톤 모두 존댓말
function toneLine(tone) {
  if (tone === "정중")
    return "말투: 단정하고 정중한 존댓말체. '~했습니다/~였습니다' 위주로 격식 있게. 그래도 광고 같지 않고 실제 신부가 직접 쓴 느낌으로.";
  return "말투: 친근하고 다정한 존댓말체. '~했어요/~더라고요/~같아요' 위주로 편안하게. (반말은 쓰지 말 것 — 항상 존댓말)";
}

function lengthLine(length) {
  if (length === "장문")
    return "분량: 개인블로그용 장문. 반드시 1000자 이상으로 충분히 길게, 문단 3~4개. 예식 준비 과정과 그날의 감정을 구체적으로 풀어서 써라.";
  return "분량: 웨딩카페용. 반드시 500자 이상으로, 문단 2~3개.";
}

// 프론트에서 온 설문 답변을 프롬프트용 텍스트로 정리
function buildUserPrompt(payload) {
  const { type, tone, length, items } = payload;
  const lines = (items || [])
    .filter((it) => it && it.a && String(it.a).trim())
    .map((it) => `- ${it.q}: ${it.a}`)
    .join("\n");

  const kind =
    type === "사진후기"
      ? "예식 당일 경험과 맛보기 보정본 사진에 대한 '사진후기'"
      : "왜 이 업체와 계약하게 되었는지에 대한 '계약후기'";

  return `${kind}를 써줘.

${toneLine(tone)}
${lengthLine(length)}

아래는 신부가 설문에서 체크·입력한 내용이야. 이 내용을 자연스럽게 녹여서 후기를 완성해줘:
${lines || "- (특별히 입력한 내용 없음 — 일반적인 만족 후기로)"}
`;
}

// 크레딧/네트워크 없이 UI 플로우를 테스트하기 위한 로컬 샘플 생성기.
// MOCK_REVIEW 환경변수가 설정된 경우에만 사용된다. (실제 배포에선 미설정)
function mockReview(payload) {
  const { type, items = [] } = payload;
  const get = (kw) => {
    const hit = items.find((it) => it.q.includes(kw));
    return hit ? hit.a : "";
  };
  if (type === "사진후기") {
    const venue = get("예식장");
    const loved = get("마음에 든 점") || get("첫 느낌");
    return `${venue ? venue + "에서 예식을 올렸어요. " : ""}당일에 정신없이 지나갈 줄 알았는데, 작가님이 분위기를 편하게 만들어주셔서 저희도 하객들도 어색함 없이 웃을 수 있었어요. 눈에 안 띄게 담아주시는데 나중에 보니 놓친 순간이 하나도 없더라고요.

며칠 뒤에 맛보기 보정본 5장을 받았는데 첫 컷 열어보고 남편이랑 같이 감탄했어요. ${loved ? loved + " 부분이 특히 좋았고, " : ""}인위적으로 만진 티가 안 나서 더 마음에 들었어요. 원본 받아보기 전인데도 벌써 앨범 어떻게 나올지 기대돼요. ${BUSINESS} 고민하시는 분들께 조심스럽게 추천드려요.`;
  }
  const route = get("알게");
  const reasons = get("이유");
  return `본식스냅 알아보면서 ${get("비교") || "몇 군데"}를 봤는데, ${route ? route + " " + BUSINESS + "을 처음 알게 됐어요. " : "여기로 마음이 기울었어요. "}포트폴리오부터 저희 취향이랑 결이 맞았어요.

${reasons ? reasons + " 이런 점들이 결정적이었어요. " : ""}상담 때 부담을 하나도 안 주셔서 편하게 궁금한 걸 다 여쭤볼 수 있었고, 그게 신뢰로 이어졌던 것 같아요. 예식이 벌써 기대되네요. 같은 고민 하시는 분들께 도움이 됐으면 해요.`;
}

async function generateReview(payload) {
  let text;
  if (process.env.MOCK_REVIEW) {
    text = mockReview(payload);
  } else {
    text = await callGemini(SYSTEM, buildUserPrompt(payload));
  }
  return text + buildFooter(); // 글 말미에 업체 링크 자동 첨부
}

module.exports = { generateReview, BUSINESS };
