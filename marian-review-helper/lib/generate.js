// 후기 초안 생성 로직 (Vercel 서버리스 함수 + 로컬 Express 서버가 공유)
// Anthropic Claude(Opus 4.8) 공식 SDK 사용. ANTHROPIC_API_KEY 환경변수 필요.

const Anthropic = require("@anthropic-ai/sdk");
const client = new Anthropic(); // ANTHROPIC_API_KEY 를 환경변수에서 읽음

// Claude 호출
async function callClaude(system, userText) {
  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
    max_tokens: 3000, // 블로그 장문(1000자+) 여유
    system,
    messages: [{ role: "user", content: userText }],
  });
  return (msg.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

const BUSINESS = "마리안웨딩"; // 본식스냅 업체명 (marianwedding.co.kr / (주)아트콜렉티브)

// 글 말미에 자동으로 붙는 업체 링크 (여기 한 곳만 수정하면 됨)
const LINKS = {
  homepage: "https://marianwedding.co.kr",
  kakao: "https://pf.kakao.com/_Xzmwn", // 카카오톡 채널
  instagram: "https://instagram.com/marian.wedding", // 인스타그램
};

// 크레딧(함께한 업체) 블록 — 프론트에서 입력한 것만, 입력 순서대로
// 예) ♥Snap.마리안웨딩 / ♥Dress.제이미브라이드 / ♥Hair&Makeup.에이바이봄
const CREDIT_ORDER = ["Dress", "Hair&Makeup", "Tuxedo", "Wedding venue"];

function buildCreditBlock(credits, snapLabel) {
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const list = (Array.isArray(credits) ? credits : [])
    .map((c) => ({ label: clean(c && c.label), value: clean(c && c.value) }))
    .filter((c) => CREDIT_ORDER.includes(c.label) && c.value)
    .sort((a, b) => CREDIT_ORDER.indexOf(a.label) - CREDIT_ORDER.indexOf(b.label));
  if (!list.length) return ""; // 입력한 게 없으면 블록 자체를 안 붙임
  const lines = [`♥${snapLabel}.${BUSINESS}`, ...list.map((c) => `♥${c.label}.${c.value}`)];
  return "\n\n" + lines.join("\n");
}

// 후기 본문 뒤에 붙일 링크 푸터
function buildFooter() {
  const lines = ["", "", "─────────────", `📸 ${BUSINESS}`, `홈페이지 · ${LINKS.homepage}`];
  if (LINKS.kakao) lines.push(`카카오톡 채널 · ${LINKS.kakao}`);
  if (LINKS.instagram) lines.push(`인스타그램 · ${LINKS.instagram}`);
  return "\n" + lines.join("\n");
}

// 시스템 프롬프트 — "AI 티"를 최대한 지우는 게 핵심
const SYSTEM = `너는 실제 신부가 직접 쓴 것처럼 자연스러운 웨딩 후기 글을 대신 써주는 도우미다.
업체는 본식스냅(예식 당일 스냅) 전문 "${BUSINESS}"(marianwedding.co.kr)이다.
사용자는 웨딩카페와 개인블로그에 이 후기를 올릴 예정이다.

[가장 중요 — AI가 쓴 티가 나지 않게]
- 광고·홍보 문구처럼 쓰지 마라. 실제 신부가 카페/블로그에 편하게 남기는 톤으로 써라.
- 문장 길이를 일부러 들쭉날쭉하게 섞어라. 짧은 문장과 긴 문장을 번갈아 써라.
- "정말 만족스러운 선택이었습니다", "강력 추천합니다" 같은 뻔한 후기 클리셰를 남발하지 마라.
- 소제목·이모지 나열은 쓰지 마라. 본문은 자연스러운 문단으로 써라. (1. 2. 3. 번호 목록은 아래 사용자 메시지의 '이번 글 구성'이 번호형을 지시할 때만 쓰고, 그 외엔 쓰지 마라.)
- 사용자가 체크한 내용에 담긴 구체적인 사실만 활용하고, 주어지지 않은 사실(가격 숫자, 특정 이름, 없던 에피소드)을 지어내지 마라.
- '비교했던 다른 업체' 항목은 반드시 후기에 반영해라(한 문장):
  · 업체 이름이 있으면: "○○, ○○ 등 몇 곳과 비교했는데 마리안웨딩이 저희와 가장 잘 맞았어요"처럼 비교했다는 사실만 아주 간단히. 다른 업체를 절대 깎아내리거나 단점을 쓰지 마라(비하·부정 금지 — 타 업체 피해 방지).
  · '없음/없다/안 함' 같은 답이면: 다른 곳과 비교하지 않고 처음부터 마리안웨딩만 보고 확신해서 선택했다는 뉘앙스로 자연스럽게 녹여라.
- 신부(1인칭, "저희"/"제가") 시점으로 써라.
- 업체명 "${BUSINESS}"은 글 안에서 1~2번만 자연스럽게 언급하고, 매 문장 반복하지 마라.
- 항상 존댓말로 써라. 반말은 절대 쓰지 마라.
- 예식장(웨딩홀) 처리 규칙을 반드시 지켜라:
  · '제휴 웨딩홀'이면 → 주어진 예식장 이름을 자연스럽게 언급해도 된다.
  · '비제휴'이거나 제휴 여부가 없으면 → 예식장 실제 이름을 본문·해시태그 어디에도 절대 쓰지 마라(이름을 추측·창작하지도 마라). 대신 주어진 '예식홀 분위기' 값 그대로 "어두운 홀" 또는 "밝은 홀"로만 뭉뚱그려 표현해라(예: "조명이 어두운 홀에서 예식을 올렸는데"). (비제휴 웨딩홀 이름을 적으면 카페·블로그 글이 삭제될 수 있음.)

[강점은 근거 기반으로 — 모든 구성 공통]
- 예비신부(예비고객)에게 가장 먹힐 마리안웨딩의 강점을, 반드시 신부가 설문에서 체크한 내용에 근거해 녹여라(없는 장점 창작 금지).
- 광고 문구가 아니라 실제 후기처럼 구체적으로. (예: "억지 연출 없이 자연스러운 사진 — 포즈 잡는 티가 안 나서…")
- 강점을 몇 개로, 어떤 방식(번호/서사/문단)으로 배치할지는 아래 사용자 메시지의 '이번 글 구성'을 그대로 따라라. (매번 같은 골격으로 쓰지 마라.)

[상품 키워드 — '마리안웨딩에서 한 것'에 따라 제목·본문·해시태그에 정확히 반영]
- '본식스냅만' → 핵심 키워드 "본식스냅"
- '본식스냅 + 본식DVD' → 핵심 키워드 "본식스냅DVD" (본문·해시태그엔 본식스냅, 본식DVD도 함께)
- '본식DVD만' → 핵심 키워드 "본식DVD" (사진 대신 영상 위주로 내용 작성)
- 본문 내용도 그 상품에 맞게 써라(예: DVD만 했으면 후기용 선보정본 사진 얘기 대신 영상 얘기로).

[제목 작성 규칙 — 반드시 이 형식으로]
제목은 정확히 아래 세 칸을 " | "(공백-막대-공백)로 이어 만들어라:
   《지역(또는 제휴 예식장명) + 상품키워드 + "후기"》 | 마리안웨딩 | 《끝 훅》

1) 첫 칸(검색용) — (지역 또는 제휴 예식장명) + 상품키워드(본식스냅 / 본식스냅DVD / 본식DVD) + "후기".
   예) "서울 엘리에나호텔 본식스냅DVD 후기", "인천 본식스냅 후기".
   ※ 비제휴라 예식장 이름을 못 쓰면 지역만(예식장명 금지).
2) 둘째 칸 — 반드시 "마리안웨딩" 이 네 글자 그대로. (브랜드 검색 노출용, 항상 가운데)
3) 셋째 칸(끝 훅) — 짧고 담백한 한 마디. 과장·낚시 금지. 아래 두 결의 훅을 매번 다르게 골라 써라(제목마다 똑같지 않게):
   · 은은한 결(감정·결과): "선보정본 받은 날", "사진 받고 마음에 든 후기", "솔직히 만족했어요", "남편이랑 감탄한 사진"
   · 적당한 결(정보격차·결정): "비교 안 하길 잘했어요", "여기로 정한 이유", "고민 끝에 선택한 후기"
   ✗ 절대 쓰지 마라(과한 클릭베이트): "반신반의했는데 놀란", "…할 뻔", "이거 모르고 계약할 뻔", "예신 필독", "주목", "안 봤으면 후회", 물음표 남발.
4) 끝 훅은 12자 이내로 짧게. 전체적으로 이모지·허위·과장광고 금지. 대부분의 신부가 부담 없이 그대로 복붙해 쓸 만한, 실제 후기 제목 톤.

[출력 형식 — 반드시 이 형식]
제목: <위 규칙대로: 지역+상품키워드 후기 | 마리안웨딩 | 끝 훅>

<후기 본문>

- 제목 줄은 반드시 '제목:'으로 시작. 그 다음 한 줄 띄우고 본문.
- 본문엔 머리말·소제목·마크다운 기호를 넣지 마라. 자연스러운 문단. (맨 끝 해시태그 줄은 허용)
- 링크·URL·전화번호·카카오채널 같은 연락처는 네가 쓰지 마라. (본문 뒤에 시스템이 자동으로 붙인다)
- 드레스·헤어메이크업·턱시도·웨딩홀 같은 '함께한 업체' 크레딧 목록(♥Dress.○○ 형식)도 네가 쓰지 마라. 신부가 입력한 것만 시스템이 본문 뒤에 자동으로 붙인다. 업체 이름을 추측해서 지어내지도 마라.`;

// 톤/길이 지침 — 두 톤 모두 존댓말
function toneLine(tone) {
  if (tone === "정중")
    return "말투: 단정하고 정중한 존댓말체. '~했습니다/~였습니다' 위주로 격식 있게. 그래도 광고 같지 않고 실제 신부가 직접 쓴 느낌으로.";
  return "말투: 친근하고 다정한 존댓말체. '~했어요/~더라고요/~같아요' 위주로 편안하게. (반말은 쓰지 말 것 — 항상 존댓말)";
}

function lengthLine(length) {
  if (length === "장문")
    return "분량: 개인블로그용 장문. 반드시 1200자 이상으로 충분히 길게, 문단 4개 이상. 예식 준비 과정·선택 기준·그날의 감정을 구체적으로 풀어서 체류시간이 늘어나게 정보성 있게 써라.";
  return "분량: 웨딩카페용. 반드시 700자 이상으로, 문단 3개 정도. 너무 짧지 않게 경험을 구체적으로.";
}

// 채널별 SEO/GEO 최적화 지침 (네이버 최신 로직 기준)
function seoLine(channel) {
  if (channel === "블로그") {
    return `[네이버 블로그 상위노출(SEO + GEO) — 최신 로직 기준]
- 네이버 블로그는 '경험 기반 원문성(D.I.A) + 정보 충실도 + 키워드 적합도'를 본다. 아래를 반영해라.
- 핵심 키워드를 제목·첫 문단·본문·해시태그에 자연스럽게 배치: (지역명 + 상품키워드[본식스냅/본식스냅DVD/본식DVD] + "후기/추천"). 롱테일 키워드도 섞어라 — 예) "○○(지역) 본식스냅 추천", "○○ 본식스냅 후기", "본식스냅 가격 고민", "○○ 웨딩홀 스냅".
- GEO(지역 최적화): 지역명(과 제휴 시 예식장명)을 본문에 명확히 여러 번 언급해서 지역 검색에 잡히게. 첫 문단에 지역+상품키워드를 꼭 넣어라.
- 경험 원문성: 실제 겪은 구체적 디테일(그날의 상황·시간·감정, 업체 고르던 과정과 선택 기준)을 풍부하게. 예비신부에게 도움 되는 팁·정보도 자연스럽게 녹여 체류시간을 높여라.
- 단, 키워드를 부자연스럽게 나열/반복(스터핑)하지 마라. 어디까지나 실제 신부가 쓴 후기처럼.
- ※ 해시태그 나열은 지금 네이버 로직에서 랭킹 기여가 거의 없다. 랭킹은 제목·본문 안에 키워드가 자연스럽게 녹아 있는지(C-Rank·D.I.A)가 좌우한다. 그러니 키워드를 태그로 몰지 말고 본문에 녹이는 데 집중해라.
- 글 맨 끝에 핵심 해시태그는 3~5개만 한 줄로 붙여라(그 이상 나열 금지 — 저품질/올드하게 보인다). 가장 중요한 것만: (지역+상품키워드+후기), 예식장명(제휴 시), "${BUSINESS}" 정도.`;
  }
  return `[웨딩카페 검색 최적화 + GEO]
- 이 글은 네이버 웨딩카페에 올릴 후기다. 카페 검색은 제목·본문 키워드 매칭 위주라 해시태그는 검색에 거의 기여하지 않는다.
- 따라서 해시태그는 붙이지 마라. 대신 핵심 키워드(지역명 + "본식스냅"/상품키워드 + "후기", 예식장명[제휴 시], "${BUSINESS}")를 제목과 본문 안에 자연스럽게 3~4회 녹여라. 지역명을 꼭 포함(GEO). 부자연스러운 반복은 금지.
- 실제 경험을 구체적으로 담아 700자 이상 충실하게.`;
}

// 문단 구성 프리셋 — 매번 다른 골격으로 쓰이도록 생성 시 하나를 무작위로 고른다.
// 4가지 모두 SEO/GEO(첫 문단 지역+상품키워드)와 근거 기반 강점은 공통으로 지킨다.
const STRUCTURES = [
  `[이번 글 구성 — '강점 3가지' 번호형]
- 도입 1~2문단(첫 문단에 지역+상품키워드): 예식/업체 고른 계기를 자연스럽게.
- 그 뒤 "제가 느낀 장점 3가지만 꼽자면요," 같은 짧은 도입 한 줄 + 1. 2. 3. 번호 목록. 각 항목 한두 줄, 체크한 내용 근거.
- 번호 목록 뒤 마무리 문단으로 자연스럽게 이어 예비신부에게 권하듯 끝맺어라.`,

  `[이번 글 구성 — 시간 순 서사형 (번호 목록 쓰지 말 것)]
- 번호 목록 없이 시간 흐름대로 문단을 나눠라: ① 업체 찾던 계기·고민 → ② 상담/계약하며 든 느낌 → ③ 예식 당일 현장 → ④ 선보정본(또는 영상) 받은 순간.
- 첫 문단에 지역+상품키워드를 자연스럽게. 각 단계가 한두 문단씩.
- 마지막은 지금 돌아본 소감으로 담백하게 마무리.`,

  `[이번 글 구성 — 예비신부 고민 공감형 (번호 목록 쓰지 말 것)]
- 번호 목록 없이 "이런 게 걱정이었는데 실제로는 어땠다"는 결로 풀어라.
- 도입(지역+상품키워드 포함)에 계약 전 걱정거리(어색한 표정, 홀 조명, 비교 고민 등)를 솔직히.
- 이어지는 문단들에서 그 걱정이 어떻게 풀렸는지 체크한 내용 근거로 하나씩.
- 같은 고민 하는 예비신부에게 건네는 말로 마무리.`,

  `[이번 글 구성 — 소주제별 문단형 (소제목·번호 달지 말 것)]
- 소제목·번호는 달지 말고 문단 자체를 주제별로 나눠라: 작가님/촬영 → 사진 스타일·보정 톤 → 당일 분위기 → (해당되면) 영상. 주제당 한 문단.
- 첫 문단에 지역+상품키워드. 각 문단은 하나의 포인트에 집중해 구체적으로.
- 마지막 문단에서 종합 소감 + 예비신부 권유.`,
];

function pickStructure() {
  return STRUCTURES[Math.floor(Math.random() * STRUCTURES.length)];
}

// 프론트에서 온 설문 답변을 프롬프트용 텍스트로 정리
function buildUserPrompt(payload) {
  const { type, tone, length, channel, items } = payload;
  const lines = (items || [])
    .filter((it) => it && it.a && String(it.a).trim())
    .map((it) => `- ${it.q}: ${it.a}`)
    .join("\n");

  const kind =
    type === "사진후기"
      ? "예식 당일 경험과 후기용 선보정본 사진에 대한 '사진후기'"
      : "왜 이 업체와 계약하게 되었는지에 대한 '계약후기'";

  return `${kind}를 써줘.

${toneLine(tone)}
${lengthLine(length)}

${seoLine(channel)}

${pickStructure()}

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

며칠 뒤에 후기용 선보정본 5장을 받았는데 첫 컷 열어보고 남편이랑 같이 감탄했어요. ${loved ? loved + " 부분이 특히 좋았고, " : ""}인위적으로 만진 티가 안 나서 더 마음에 들었어요. 원본 받아보기 전인데도 벌써 앨범 어떻게 나올지 기대돼요. ${BUSINESS} 고민하시는 분들께 조심스럽게 추천드려요.`;
  }
  const route = get("알게");
  const reasons = get("이유");
  return `본식스냅 알아보면서 ${get("비교") || "몇 군데"}를 봤는데, ${route ? route + " " + BUSINESS + "을 처음 알게 됐어요. " : "여기로 마음이 기울었어요. "}포트폴리오부터 저희 취향이랑 결이 맞았어요.

${reasons ? reasons + " 이런 점들이 결정적이었어요. " : ""}상담 때 부담을 하나도 안 주셔서 편하게 궁금한 걸 다 여쭤볼 수 있었고, 그게 신뢰로 이어졌던 것 같아요. 예식이 벌써 기대되네요. 같은 고민 하시는 분들께 도움이 됐으면 해요.`;
}

// 모델 출력에서 '제목:' 줄과 본문 분리
function parseTitleBody(text) {
  const lines = text.split("\n");
  let title = "";
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const m = lines[i].match(/^\s*제목\s*[:：]\s*(.+)$/);
    if (m) { title = m[1].trim(); bodyStart = i + 1; }
    break; // 첫 비어있지 않은 줄만 검사
  }
  const body = lines.slice(bodyStart).join("\n").trim();
  return { title, body: body || text.trim() };
}

// 상품별 제목 키워드 (MOCK용)
function productKeyword(payload) {
  const p = (payload.items || []).find((it) => it.q.includes("무엇을")) || {};
  const a = p.a || "";
  if (a.includes("DVD") && a.includes("스냅")) return "본식스냅DVD";
  if (a.includes("DVD")) return "본식DVD";
  return "본식스냅";
}

// 상품에 맞춘 크레딧 첫 줄 라벨
function snapLabel(payload) {
  const kw = productKeyword(payload);
  if (kw === "본식스냅DVD") return "Snap&Video";
  if (kw === "본식DVD") return "Video";
  return "Snap";
}

async function generateReview(payload) {
  // 크레딧 + 링크 푸터는 모델이 아니라 시스템이 확정해서 붙인다
  const tail = buildCreditBlock(payload.credits, snapLabel(payload)) + buildFooter();
  if (process.env.MOCK_REVIEW) {
    const kw = productKeyword(payload);
    return { title: `${kw} 후기 | 마리안웨딩 (샘플 제목)`, review: mockReview(payload) + tail };
  }
  const text = await callClaude(SYSTEM, buildUserPrompt(payload));
  const { title, body } = parseTitleBody(text);
  return { title, review: body + tail };
}

module.exports = { generateReview, BUSINESS };
