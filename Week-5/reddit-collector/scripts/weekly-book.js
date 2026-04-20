/**
 * 매주 월요일 자동 실행: Notion "읽을 책" DB에 추천도서 1권 추가
 *
 * 환경변수:
 *   NOTION_API_KEY - Notion Integration Token
 *   NOTION_BOOK_DB_ID - 읽을 책 데이터베이스 ID
 */

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_BOOK_DB_ID = process.env.NOTION_BOOK_DB_ID || "9fff50ce6c4f4205a7d9f8cb0fcf257e";

// 추천 도서 풀 (주기적으로 추가 가능)
const BOOK_POOL = [
  {
    title: "클린 코드",
    author: "로버트 C. 마틴",
    genre: ["기술"],
    recommend: "강추",
    memo: "읽기 좋은 코드란 무엇인가. 변수명, 함수, 클래스 설계까지 실무 코드 품질의 바이블. 모든 개발자 필독서.",
  },
  {
    title: "소프트웨어 장인",
    author: "산드로 만쿠소",
    genre: ["기술", "자기계발"],
    recommend: "강추",
    memo: "장인정신으로 소프트웨어를 대하는 태도. TDD, 클린코드를 넘어 프로페셔널 개발자의 마인드셋을 다룸.",
  },
  {
    title: "실용주의 프로그래머",
    author: "데이비드 토머스, 앤드류 헌트",
    genre: ["기술"],
    recommend: "강추",
    memo: "20년 넘게 사랑받는 개발자 필독서. 실용적 사고방식, DRY 원칙, 자동화 등 시대를 초월한 조언 가득.",
  },
  {
    title: "함께 자라기",
    author: "김창준",
    genre: ["자기계발", "경영"],
    recommend: "강추",
    memo: "애자일을 넘어 '함께' 성장하는 조직과 개인에 대한 통찰. 한국 개발 문화에 맞는 실천적 조언.",
  },
  {
    title: "디자인 패턴의 아름다움",
    author: "왕정",
    genre: ["기술"],
    recommend: "추천",
    memo: "GoF 패턴을 현대적 시각으로 재해석. 실무 코드 예제로 패턴의 '왜'를 설명. 주니어->미드 전환기에 최적.",
  },
  {
    title: "이펙티브 타입스크립트",
    author: "댄 밴더캄",
    genre: ["기술"],
    recommend: "강추",
    memo: "TS를 제대로 활용하는 62가지 방법. 타입 시스템의 구조적 이해부터 실전 패턴까지. 프론트엔드 개발자 필수.",
  },
  {
    title: "시스템 디자인 인터뷰",
    author: "알렉스 쉬",
    genre: ["기술"],
    recommend: "추천",
    memo: "대규모 시스템 설계의 기초. URL 단축기, 채팅 시스템, 검색엔진 등 실제 사례로 아키텍처 감각을 키움.",
  },
  {
    title: "아토믹 해빗",
    author: "제임스 클리어",
    genre: ["자기계발"],
    recommend: "강추",
    memo: "습관의 과학. 1%씩 나아지는 시스템 구축법. 개발 루틴, 학습 습관 만들기에 바로 적용 가능한 프레임워크.",
  },
  {
    title: "나는 4시간만 일한다",
    author: "팀 페리스",
    genre: ["자기계발", "경영"],
    recommend: "추천",
    memo: "자동화와 아웃소싱으로 시간 자유를 얻는 법. 사이드 프로젝트 수익화, 원격 근무 최적화에 영감을 줌.",
  },
  {
    title: "제로 투 원",
    author: "피터 틸",
    genre: ["경영"],
    recommend: "추천",
    memo: "독점적 가치를 만드는 스타트업 사고법. 개발자가 창업을 꿈꿀 때 첫 번째로 읽어야 할 책.",
  },
  {
    title: "HTTP 완벽 가이드",
    author: "데이빗 고울리 외",
    genre: ["기술"],
    recommend: "추천",
    memo: "웹 개발자의 기본기. HTTP 프로토콜 동작 원리부터 캐싱, 보안, 프록시까지. 레퍼런스로도 활용 가능.",
  },
  {
    title: "오브젝트",
    author: "조영호",
    genre: ["기술"],
    recommend: "강추",
    memo: "객체지향의 본질을 파헤치는 국내 최고의 OOP 서적. 역할, 책임, 협력 관점으로 설계를 다시 생각하게 함.",
  },
  {
    title: "도메인 주도 설계 핵심",
    author: "반 버논",
    genre: ["기술"],
    recommend: "추천",
    memo: "DDD의 핵심만 빠르게 정리. 바운디드 컨텍스트, 유비쿼터스 언어 등 복잡한 도메인을 다루는 개발자에게 필수.",
  },
  {
    title: "사피엔스",
    author: "유발 하라리",
    genre: ["과학"],
    recommend: "추천",
    memo: "인류 역사를 관통하는 빅 픽처. 기술과 사회의 관계를 이해하는 넓은 시야를 제공. 개발 외 교양으로 최고.",
  },
  {
    title: "딥 워크",
    author: "칼 뉴포트",
    genre: ["자기계발"],
    recommend: "강추",
    memo: "깊은 집중력으로 최고의 성과를 내는 법. 산만한 환경에서 코딩에 몰입하는 구체적 전략 제시.",
  },
  {
    title: "운영체제 아주 쉬운 세 가지 이야기",
    author: "레미 아르파치-뒤소",
    genre: ["기술", "과학"],
    recommend: "추천",
    memo: "OS 개념을 재미있게 풀어낸 명저. 프로세스, 메모리, 파일시스템을 이야기로 이해. CS 기초 다지기에 최적.",
  },
  {
    title: "그릿",
    author: "앤절라 더크워스",
    genre: ["자기계발", "과학"],
    recommend: "추천",
    memo: "재능보다 끈기가 성공을 결정한다는 과학적 증거. 장기적으로 개발 실력을 쌓아가려는 이에게 동기부여.",
  },
  {
    title: "데이터 중심 애플리케이션 설계",
    author: "마틴 클레프만",
    genre: ["기술"],
    recommend: "강추",
    memo: "분산 시스템의 바이블. 복제, 파티셔닝, 트랜잭션, 스트림 처리까지. 백엔드 시니어로 가려면 반드시 읽어야.",
  },
  {
    title: "스틸 라이프",
    author: "사라 윈먼",
    genre: ["소설"],
    recommend: "추천",
    memo: "코딩에 지친 뇌를 쉬게 해주는 따뜻한 소설. 평범한 사람들의 연결과 우정. 번아웃 회복에 좋은 처방전.",
  },
  {
    title: "타이탄의 도구들",
    author: "팀 페리스",
    genre: ["자기계발"],
    recommend: "추천",
    memo: "각 분야 최고 200명의 루틴과 사고방식 모음. 원하는 챕터만 골라 읽기 좋음. 아침 루틴 만들기에 영감.",
  },
];

async function getExistingBooks() {
  const res = await fetch(
    `https://api.notion.com/v1/databases/${NOTION_BOOK_DB_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page_size: 100 }),
    }
  );
  const data = await res.json();
  return (data.results || []).map(
    (page) => page.properties?.["제목"]?.title?.[0]?.plain_text || ""
  );
}

async function addBook(book) {
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { database_id: NOTION_BOOK_DB_ID },
      icon: { type: "emoji", emoji: "\uD83D\uDCD6" },
      properties: {
        제목: { title: [{ text: { content: book.title } }] },
        저자: { rich_text: [{ text: { content: book.author } }] },
        상태: { select: { name: "읽고싶음" } },
        장르: { multi_select: book.genre.map((g) => ({ name: g })) },
        추천도: { select: { name: book.recommend } },
        메모: { rich_text: [{ text: { content: book.memo } }] },
      },
    }),
  });
  return res.json();
}

async function main() {
  if (!NOTION_API_KEY) {
    console.error("NOTION_API_KEY 환경변수가 필요합니다.");
    process.exit(1);
  }

  // 이미 추가된 책 목록 가져오기
  const existing = await getExistingBooks();
  console.log(`기존 등록 도서: ${existing.length}권`);
  console.log(existing.map((t) => `  - ${t}`).join("\n"));

  // 중복 제거 후 랜덤 선택
  const available = BOOK_POOL.filter((b) => !existing.includes(b.title));

  if (available.length === 0) {
    console.log("추천 가능한 새 도서가 없습니다. BOOK_POOL을 업데이트하세요.");
    return;
  }

  // 이번 주의 책 (주차 기반 시드로 일관성 유지)
  const weekNumber = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const index = weekNumber % available.length;
  const pick = available[index];

  console.log(`\n이번 주 추천: "${pick.title}" - ${pick.author}`);

  const result = await addBook(pick);

  if (result.id) {
    console.log(`Notion에 추가 완료! Page ID: ${result.id}`);
    console.log(`URL: ${result.url}`);
  } else {
    console.error("추가 실패:", JSON.stringify(result, null, 2));
    process.exit(1);
  }
}

main();
