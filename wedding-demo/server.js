// 웨딩 커뮤니티 플랫폼 — 데모 서버
// 슬로건: "플래너가 있는 결혼준비, 거품이없을까요?"
// 단계: 데모 (In-memory 저장소, 프로덕션은 Supabase PostgreSQL 예정)

const path = require("path");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 3030;
const JWT_SECRET = "wedding-demo-secret-change-in-production";
const JWT_EXPIRES = "7d";

// ─── 슈퍼 관리자 계정 (데모용 임의 생성) ───────────────────────
const SUPER_ADMIN_EMAIL = "admin@wedding-demo.kr";
const SUPER_ADMIN_PASSWORD = "Wedding!Admin2026";

// ─── In-Memory 데이터베이스 ────────────────────────────────────
const db = {
  users: [],
  estimates: [], // 견적서 업로드
  posts: [], // 커뮤니티 게시글
  checklistItems: [], // 유저별 체크리스트 진행도
  nextUserId: 1,
  nextEstimateId: 1,
  nextPostId: 1,
};

// ─── 웨딩홀 시드 데이터 (서울·경기 15곳) ───────────────────────
const weddingHalls = [
  { id: 1, name: "그랜드하얏트 서울", region: "서울 용산구", hallFee: 1800, mealFee: 105000, minGuests: 250, tier: "프리미엄" },
  { id: 2, name: "신라호텔 다이너스티홀", region: "서울 중구", hallFee: 2200, mealFee: 128000, minGuests: 300, tier: "프리미엄" },
  { id: 3, name: "롯데호텔 크리스탈볼룸", region: "서울 중구", hallFee: 2000, mealFee: 118000, minGuests: 280, tier: "프리미엄" },
  { id: 4, name: "웨스틴조선 그랜드볼룸", region: "서울 중구", hallFee: 1900, mealFee: 115000, minGuests: 250, tier: "프리미엄" },
  { id: 5, name: "더 채플 강남", region: "서울 강남구", hallFee: 800, mealFee: 72000, minGuests: 200, tier: "일반" },
  { id: 6, name: "루비스퀘어", region: "서울 강남구", hallFee: 650, mealFee: 68000, minGuests: 180, tier: "일반" },
  { id: 7, name: "아모르하우스 청담", region: "서울 강남구", hallFee: 900, mealFee: 85000, minGuests: 200, tier: "일반" },
  { id: 8, name: "더파티움 한남", region: "서울 용산구", hallFee: 750, mealFee: 78000, minGuests: 200, tier: "일반" },
  { id: 9, name: "노블발렌티 대치", region: "서울 강남구", hallFee: 700, mealFee: 75000, minGuests: 200, tier: "일반" },
  { id: 10, name: "라비드올", region: "경기 성남시", hallFee: 500, mealFee: 62000, minGuests: 180, tier: "일반" },
  { id: 11, name: "갤러리 하우스", region: "서울 마포구", hallFee: 550, mealFee: 65000, minGuests: 150, tier: "스몰웨딩" },
  { id: 12, name: "더 라움", region: "서울 강남구", hallFee: 1200, mealFee: 92000, minGuests: 220, tier: "프리미엄" },
  { id: 13, name: "빌라드파티 분당", region: "경기 성남시", hallFee: 450, mealFee: 58000, minGuests: 150, tier: "일반" },
  { id: 14, name: "아펠가모 선릉", region: "서울 강남구", hallFee: 850, mealFee: 82000, minGuests: 200, tier: "일반" },
  { id: 15, name: "더 컨벤션 수원", region: "경기 수원시", hallFee: 400, mealFee: 55000, minGuests: 150, tier: "일반" },
];

// ─── 초록 마크 동맹 업체 시드 데이터 ───────────────────────────
const partners = [
  // 본식스냅 5곳
  { id: 101, category: "snap", name: "화이트 스튜디오", basePrice: 450, region: "서울", greenMark: true, description: "본식 당일 감성 스냅 전문. 원본 제공.", pkgDetails: "촬영 2인 / 원본 전체 / 편집 200컷", isOwner: true },
  { id: 102, category: "snap", name: "모먼트 필름", basePrice: 380, region: "서울", greenMark: true, description: "다큐멘터리형 본식 스냅.", pkgDetails: "촬영 1인 / 원본 전체 / 편집 150컷" },
  { id: 103, category: "snap", name: "뉴트럴 웨딩", basePrice: 420, region: "서울", greenMark: true, description: "내추럴 톤 컬러그레이딩.", pkgDetails: "촬영 2인 / 원본 전체 / 편집 180컷" },
  { id: 104, category: "snap", name: "스튜디오 수어", basePrice: 350, region: "경기", greenMark: true, description: "합리적 가격, 빠른 납품.", pkgDetails: "촬영 1인 / 원본 전체 / 편집 150컷" },
  { id: 105, category: "snap", name: "라이트하우스 웨딩", basePrice: 490, region: "서울", greenMark: true, description: "영상 + 스냅 패키지 가능.", pkgDetails: "촬영 2인 / 원본 전체 / 편집 220컷" },

  // 헤어메이크업 5곳
  { id: 201, category: "makeup", name: "뷰티샵 루나", basePrice: 280, region: "서울 강남", greenMark: true, description: "본식+리허설 패키지. 혼주 메이크업 포함.", pkgDetails: "본식 / 리허설 / 혼주 2인" },
  { id: 202, category: "makeup", name: "메이크업 에떼", basePrice: 320, region: "서울 압구정", greenMark: true, description: "원장 디렉터 직접 시술.", pkgDetails: "본식 원장 / 리허설 포함 / 혼주 1인" },
  { id: 203, category: "makeup", name: "스튜디오 마리", basePrice: 250, region: "서울 성수", greenMark: true, description: "자연스러운 신부 스타일 전문.", pkgDetails: "본식 / 리허설 / 혼주 미포함" },
  { id: 204, category: "makeup", name: "헤어메이크업 노블", basePrice: 290, region: "경기 분당", greenMark: true, description: "이동 메이크업 가능.", pkgDetails: "본식 / 리허설 / 혼주 2인" },
  { id: 205, category: "makeup", name: "뷰티 아뜰리에", basePrice: 300, region: "서울 청담", greenMark: true, description: "오리지널 스타일 제안.", pkgDetails: "본식 / 리허설 / 혼주 2인" },
];

// ─── 체크리스트 템플릿 (마스터) ───────────────────────────────
const checklistTemplate = [
  { id: "c1", dDay: 365, title: "예산 설정", category: "기획" },
  { id: "c2", dDay: 300, title: "웨딩홀 방문 & 계약", category: "예식장" },
  { id: "c3", dDay: 270, title: "스튜디오 계약 (본식스냅)", category: "스드메" },
  { id: "c4", dDay: 240, title: "드레스샵 투어 & 계약", category: "스드메" },
  { id: "c5", dDay: 220, title: "헤어메이크업 계약", category: "스드메" },
  { id: "c6", dDay: 180, title: "예물 반지 구매", category: "예물" },
  { id: "c7", dDay: 150, title: "청첩장 디자인 확정", category: "기타" },
  { id: "c8", dDay: 120, title: "리허설 촬영", category: "스드메" },
  { id: "c9", dDay: 90, title: "하객 리스트 정리 & 청첩장 발송", category: "기타" },
  { id: "c10", dDay: 60, title: "신혼여행 예약", category: "기타" },
  { id: "c11", dDay: 30, title: "최종 견적 확인 & 잔금 일정", category: "정산" },
  { id: "c12", dDay: 7, title: "본식 리허설 & 혼주 준비", category: "본식주간" },
];

// ─── 시드 (게시글 모의 데이터) ─────────────────────────────────
const seedPosts = [
  { id: "sp1", title: "그랜드하얏트 본식 후기 (보증 250명)", author: "신부A", content: "실 견적 대관료 1800 식대 10.5만, 총 4500 나왔어요. 플래너 없이 직접 갔더니 협상 가능했습니다.", createdAt: "2026-04-20", category: "후기", likes: 23 },
  { id: "sp2", title: "초록 마크 본식스냅 업체 실제로 어떤가요?", author: "예비신부", content: "거품없는결혼 등록된 스냅 5곳 중 추천해주실 곳 있으신가요? 화이트 스튜디오랑 모먼트 필름 고민 중입니다.", createdAt: "2026-04-21", category: "질문", likes: 8 },
  { id: "sp3", title: "드레스샵 샘플 등급 꼼수 주의!", author: "졸업신부", content: "드레스 3벌 패키지라고 해서 계약했는데 실제론 본식 1벌 + 리허설 1벌 + 촬영용 1벌이었어요. 계약서 꼭 확인하세요.", createdAt: "2026-04-18", category: "정보", likes: 45 },
];

// ─── 유령 계정 풀 (커뮤니티 활성화용) ─────────────────────────
const ghostNames = [
  "예비신부_봄날", "10월신부", "가을브라이드", "하얀드레스꿈",
  "1229결혼해요", "새내기신부27", "웨딩준비중_수지", "봄꽃신부",
  "본식D100", "반지골랐어요", "청첩장준비중", "스드메완료", "신혼집꾸미기",
  "서울신부_지은", "경기신부_하린", "드레스결정완료", "예물고민중",
  "허니문프리뷰", "결혼준비일기", "예비신랑_민호", "11월_bride",
  "플래너없이갈래요", "셀프웨딩꿈꾸는", "혼주메이크업고민", "브라이드라이프",
  "계약서꼼꼼이", "하우스웨딩준비", "작은결혼식_예진", "스몰웨딩선배", "결혼정보모아요",
];

// 가입 인사 템플릿
const greetingTemplates = [
  (m) => ({ title: `가입 인사드려요! ${m}월 결혼 예정입니다`, content: `안녕하세요, ${m}월에 결혼 예정인 예비신부입니다. 정보 많이 얻고 가겠습니다. 여기 광고비 없이 운영된다고 해서 찾아왔어요!` }),
  (m) => ({ title: `${m}월 신부입니다, 잘 부탁드려요`, content: "플래너 없이 준비 중이라 정말 막막했는데 여기 좋은 정보가 많네요. 천천히 둘러볼게요!" }),
  (m) => ({ title: "처음 인사드립니다", content: `${m}월 결혼 예정이고 지금 스드메 알아보는 중이에요. 선배님들 조언 부탁드려요 🙏` }),
  (m) => ({ title: "다들 반갑습니다", content: "다이렉트 카페만 보다가 여기 왔는데 진짜 가격이 공개되어 있어서 놀랐어요. 이런 커뮤니티 기다렸습니다!" }),
  (m) => ({ title: "드디어 가입했어요", content: `${m}월 본식 앞두고 있어요. 앞으로 많이 배우고, 저도 나중에 견적서 올려서 후배 신부들 도와드릴게요` }),
  (m) => ({ title: "초록 마크 믿고 왔습니다", content: "업체 대표님이 직접 만드신 커뮤니티라고 듣고 왔어요. 투명한 업체만 있다는 게 정말 매력적이네요." }),
  (m) => ({ title: "가입 인사", content: "반지 먼저 사고 이제 스드메 단계 들어갑니다. 견적서 족보 너무 유용해요!" }),
  (m) => ({ title: `D-${Math.floor(Math.random()*180+30)} 신부입니다`, content: "체크리스트 기능 보고 감탄했어요. 플래너 없이도 놓치는 거 없이 갈 수 있을 것 같아요." }),
  (m) => ({ title: "스몰웨딩 준비 중이에요", content: "하객 100명 내외로 생각하는데 여기 작은 결혼식 정보도 있어서 좋아요. 잘 부탁드립니다!" }),
  (m) => ({ title: "플래너 없이 가기로 결정", content: "플래너비 200만원이 아까워서 직접 해보려고 해요. 여기 체크리스트랑 견적족보만 있으면 충분할 것 같아요." }),
  (m) => ({ title: "안녕하세요 :)", content: `${m}월 ${Math.floor(Math.random()*28+1)}일 결혼합니다. 요즘 견적서 비교하느라 머리 터지는 중ㅜㅜ` }),
  (m) => ({ title: "반가워요", content: "친구가 추천해줘서 왔어요. 견적서 1장 올리고 3장 볼 수 있는 구조 정말 공정하다고 느꼈습니다." }),
];

// 업체 긍정 후기 템플릿 (동맹 업체명 사용)
const partnerReviewTemplates = [
  { vendor: "화이트 스튜디오", amount: 450, title: "화이트 스튜디오 본식스냅 후기 (대만족)", content: "본식 당일 자연스러운 컷 너무 잘 뽑아주셨어요. 원본 전체 주시고 편집 200컷. 가격 명세서 투명하게 다 보여주셔서 신뢰 갔어요." },
  { vendor: "화이트 스튜디오", amount: 450, title: "화이트스튜디오 추천합니다", content: "운영자님 업체라 더 신경 쓰셨나 싶을 정도로 꼼꼼하셨어요. 감성이 정말 좋아서 앨범 받고 계속 보고 있어요." },
  { vendor: "모먼트 필름", amount: 380, title: "모먼트필름 다큐형 스냅 후기", content: "포즈 안 잡고 자연스럽게 찍는 스타일이에요. 어색한 거 싫어하는 분들께 강추! 컷 수도 150컷으로 충분했습니다." },
  { vendor: "모먼트 필름", amount: 380, title: "모먼트필름 본식 맡겼는데 대박", content: "양가 부모님도 너무 만족하셨어요. 가격도 합리적이고 소통도 친절하셨습니다." },
  { vendor: "뉴트럴 웨딩", amount: 420, title: "뉴트럴웨딩 컬러톤 최고", content: "내추럴한 톤 좋아해서 선택했는데 결과물 보고 감동했어요. 편집 180컷인데 버릴 게 없어요." },
  { vendor: "뉴트럴 웨딩", amount: 420, title: "뉴트럴 웨딩 후기입니다", content: "두 분 작가님 호흡 너무 좋으셔서 본식 내내 편했어요. 추천드립니다!" },
  { vendor: "스튜디오 수어", amount: 350, title: "스튜디오 수어 가성비 최고", content: "가격이 합리적이라 걱정했는데 결과물 완전 만족이에요. 납품도 빠르고, 다시 선택하라 해도 여기 할 듯." },
  { vendor: "스튜디오 수어", amount: 350, title: "스튜디오수어 후기", content: "경기권인데 이동도 문제없이 와주셨고 분위기 잘 맞춰주셨어요. 합리적 가격에 만족합니다." },
  { vendor: "라이트하우스 웨딩", amount: 490, title: "라이트하우스 스냅+영상 패키지", content: "영상까지 같이 받을 수 있어서 좋았어요. 하이라이트 영상 보고 울었습니다ㅠㅠ" },
  { vendor: "라이트하우스 웨딩", amount: 490, title: "영상 품질 추천", content: "본식 스냅 220컷 편집 퀄 좋고 영상도 감성 있어요. 조금 비싼 편이지만 그만한 값어치." },
  { vendor: "뷰티샵 루나", amount: 280, title: "뷰티샵 루나 본식 메이크업 후기", content: "리허설부터 본식까지 일관된 스타일 유지해주셨고 혼주 메이크업도 포함이라 가성비 최고였어요." },
  { vendor: "뷰티샵 루나", amount: 280, title: "루나에서 메이크업 받았어요", content: "강남에서 본식 장소까지 이동해주셨고, 수정도 친절하게 해주셨어요. 추천합니다." },
  { vendor: "메이크업 에떼", amount: 320, title: "에떼 원장님 직접 시술 후기", content: "원장님이 본식 담당해주시니 안심이 되더라고요. 내추럴한데 뚜렷한 느낌 너무 좋았어요." },
  { vendor: "메이크업 에떼", amount: 320, title: "에떼 메이크업 대만족", content: "압구정까지 갈 가치 있었어요. 리허설 때부터 스타일 상담 잘 해주셔서 본식 때 실패가 없었습니다." },
  { vendor: "스튜디오 마리", amount: 250, title: "스튜디오 마리 자연스러워요", content: "과하지 않고 신부 본연의 느낌 살려주시는 스타일이에요. 평소 내추럴 메이크업 선호하시면 추천!" },
  { vendor: "스튜디오 마리", amount: 250, title: "마리 메이크업 후기", content: "성수에 있어서 접근성 좋고 가격도 합리적이에요. 본식/리허설 포함이고 만족도 높았습니다." },
  { vendor: "헤어메이크업 노블", amount: 290, title: "노블 이동 메이크업 최고", content: "경기도 웨딩홀인데 이동해주셔서 편했어요. 혼주분들도 같이 시술 받으셔서 동선이 깔끔했어요." },
  { vendor: "헤어메이크업 노블", amount: 290, title: "노블 헤어메이크업 추천", content: "분당 쪽인데 퀄리티 좋고 친절해요. 혼주 2인까지 포함이라 경제적이에요." },
  { vendor: "뷰티 아뜰리에", amount: 300, title: "뷰티아뜰리에 스타일 제안 좋았어요", content: "제가 원하는 분위기 정확히 캐치해주셨고, 청담까지 갔는데 가치 있었어요." },
  { vendor: "뷰티 아뜰리에", amount: 300, title: "아뜰리에 후기", content: "처음엔 가격이 걱정됐는데 퀄리티 보니 납득이 되네요. 혼주 포함 합리적인 선택이었어요." },
];

// 웨딩홀 긍정 후기 템플릿
const hallReviewTemplates = [
  { vendor: "그랜드하얏트 서울", title: "그랜드하얏트 본식 후기 (보증 250명)", content: "대관료 1800, 식대 10.5만원. 플래너 없이 직접 계약했어요. 협상 여지 있습니다!" },
  { vendor: "신라호텔 다이너스티홀", title: "신라호텔 다이너스티 후기", content: "보증 300명이지만 양가 하객 많아서 문제 없었어요. 서비스 최고급입니다." },
  { vendor: "롯데호텔 크리스탈볼룸", title: "롯데호텔 크리스탈볼룸 추천", content: "보증 280명에 식대 11.8만원. 부모님이 너무 만족하셨어요." },
  { vendor: "웨스틴조선 그랜드볼룸", title: "웨스틴조선 웨딩 후기", content: "클래식한 분위기 좋아하시면 여기가 답이에요. 접근성도 좋습니다." },
  { vendor: "더 채플 강남", title: "더 채플 강남 후기", content: "보증 200명 식대 7.2만으로 합리적이었어요. 일반홀 중에선 가장 만족!" },
  { vendor: "루비스퀘어", title: "루비스퀘어 보증 180명 후기", content: "가격 대비 퀄리티 좋아요. 식대 6.8만원인데 하객들이 맛있다고 하셨어요." },
  { vendor: "아모르하우스 청담", title: "아모르하우스 청담 웨딩 후기", content: "하우스웨딩 분위기 원했는데 딱이었어요. 공간도 예쁘고 스태프도 친절." },
  { vendor: "더파티움 한남", title: "더파티움 한남 후기", content: "한남 뷰 너무 좋았어요. 보증 200명에 식대 7.8만원. 합리적인 프리미엄." },
  { vendor: "노블발렌티 대치", title: "노블발렌티 추천드려요", content: "대치동 접근성 좋고 식대도 괜찮아요. 일반홀이지만 퀄리티는 프리미엄급이에요." },
  { vendor: "라비드올", title: "라비드올 성남 웨딩 후기", content: "경기권인데 퀄리티 좋고 가격 합리적이에요. 주차도 편하고." },
  { vendor: "갤러리 하우스", title: "갤러리하우스 스몰웨딩 후기", content: "하객 150명 스몰웨딩으로 진행했어요. 분위기 특별하고 가격도 합리적!" },
  { vendor: "더 라움", title: "더 라움 강남 웨딩 후기", content: "프리미엄급인데 식대 9.2만원이라 합리적이에요. 홀도 넓고 서비스 좋아요." },
  { vendor: "빌라드파티 분당", title: "빌라드파티 분당 후기", content: "분당권에서 이 가격대면 최고예요. 식대 5.8만원에 퀄리티 좋았어요." },
  { vendor: "아펠가모 선릉", title: "아펠가모 선릉 웨딩 후기", content: "강남구 접근성 좋고 식대 8.2만원. 모던한 분위기 좋아요." },
  { vendor: "더 컨벤션 수원", title: "더컨벤션 수원 후기", content: "수원권 예비신부님께 추천드려요. 가격 대비 너무 만족했습니다." },
];

// 일반 긍정 커뮤니티 포스트 템플릿
const generalTemplates = [
  { title: "초록 마크 업체만 믿고 가기로 했어요", content: "다이렉트에서 받은 견적이랑 비교해봤는데 여기 업체들이 오히려 저렴하거나 같더라고요. 광고비 안 얹어서 그런가 봐요." },
  { title: "플래너 없이 가도 충분할 것 같아요", content: "처음엔 불안했는데 체크리스트 보면서 하니까 하나도 안 놓치네요. 플래너비 200만원 세이브!" },
  { title: "견적서 족보 진짜 유용해요", content: "같은 스튜디오인데 사람마다 견적이 30만원 차이 나더라고요. 이런 정보 없었으면 몰랐을 듯." },
  { title: "가격 공개 업체가 역시 답이다", content: "안 숨기니까 오히려 신뢰 가요. 계약도 빨리 진행됐어요." },
  { title: "1장 올리면 3장 본다는 룰 공정해요", content: "사람들이 기여 안 하면 정보 안 쌓이는 건데, 이런 구조가 건강하다고 생각해요." },
  { title: "결혼 준비 너무 재밌어졌어요", content: "여기서 정보 찾으면서 준비하니까 스트레스 확 줄었어요. 다들 감사해요!" },
];

// 월 배열 (현실성용)
const months = ["3", "4", "5", "6", "9", "10", "11", "12"];

// 유령 유저 생성
async function createGhostAccounts() {
  const placeholderHash = await bcrypt.hash("ghost-no-login-" + Math.random(), 10);
  for (const name of ghostNames) {
    const ageDays = Math.floor(Math.random() * 90) + 1;
    db.users.push({
      id: db.nextUserId++,
      email: `ghost_${db.nextUserId}@wedding-demo.kr`,
      passwordHash: placeholderHash,
      name,
      role: "user",
      credits: Math.floor(Math.random() * 800) + 50,
      level: "bronze",
      isGhost: true,
      createdAt: new Date(Date.now() - ageDays * 86400000).toISOString(),
    });
  }
  console.log(`👻 유령 계정 ${ghostNames.length}개 생성`);
}

// 랜덤 유령 포스트 1건 생성 (createdAt 인자 없으면 현재 시각)
function generateGhostPost(createdAtDate) {
  const ghosts = db.users.filter((u) => u.isGhost);
  const author = ghosts[Math.floor(Math.random() * ghosts.length)];
  const type = Math.random();
  let title, content, category;

  if (type < 0.25) {
    // 가입 인사 (25%)
    const tpl = greetingTemplates[Math.floor(Math.random() * greetingTemplates.length)];
    const m = months[Math.floor(Math.random() * months.length)];
    const rendered = tpl(m);
    title = rendered.title;
    content = rendered.content;
    category = "자유";
  } else if (type < 0.75) {
    // 업체(동맹) 긍정 후기 (50%)
    const tpl = partnerReviewTemplates[Math.floor(Math.random() * partnerReviewTemplates.length)];
    title = tpl.title;
    content = tpl.content;
    category = "후기";
  } else if (type < 0.90) {
    // 웨딩홀 후기 (15%)
    const tpl = hallReviewTemplates[Math.floor(Math.random() * hallReviewTemplates.length)];
    title = tpl.title;
    content = tpl.content;
    category = "후기";
  } else {
    // 일반 커뮤니티 (10%)
    const tpl = generalTemplates[Math.floor(Math.random() * generalTemplates.length)];
    title = tpl.title;
    content = tpl.content;
    category = "정보";
  }

  const createdAt = createdAtDate || new Date();
  const post = {
    id: db.nextPostId++,
    title,
    content,
    category,
    author: author.name,
    authorId: author.id,
    likes: Math.floor(Math.random() * 40),
    isGhost: true, // 관리자 식별용
    createdAt: createdAt.toISOString().slice(0, 10),
    createdAtFull: createdAt.toISOString(),
  };
  db.posts.push(post);
  return post;
}

// 과거 24시간 백필
function backfillGhostPosts() {
  const count = 100 + Math.floor(Math.random() * 51); // 100-150
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const randomMsAgo = Math.floor(Math.random() * 86400000); // 0~24h
    const date = new Date(now - randomMsAgo);
    generateGhostPost(date);
  }
  // 최신순 정렬 (createdAtFull 기준)
  db.posts.sort((a, b) => new Date(a.createdAtFull || a.createdAt) - new Date(b.createdAtFull || b.createdAt));
  console.log(`📝 과거 24h 유령 게시글 ${count}건 백필 완료`);
}

// 향후 24시간 분산 스케줄링
function scheduleNext24hGhostPosts() {
  const count = 100 + Math.floor(Math.random() * 51); // 100-150
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const delayMs = Math.floor(Math.random() * 86400000); // 0~24h ms
    setTimeout(() => {
      generateGhostPost();
    }, delayMs);
  }
  console.log(`⏱  향후 24h 유령 게시글 ${count}건 스케줄링 완료`);
  // 24시간 후 자동 재스케줄 (연속 운영)
  setTimeout(scheduleNext24hGhostPosts, 86400000);
}

// ─── 초기화: 슈퍼 관리자 + 시드 게시글 ─────────────────────────
async function initialize() {
  const adminPasswordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10);
  db.users.push({
    id: db.nextUserId++,
    email: SUPER_ADMIN_EMAIL,
    passwordHash: adminPasswordHash,
    name: "슈퍼관리자",
    role: "admin",
    credits: 999999,
    level: "admin",
    createdAt: new Date().toISOString(),
  });
  console.log("✅ 슈퍼 관리자 계정 생성됨");
  console.log(`   📧 이메일: ${SUPER_ADMIN_EMAIL}`);
  console.log(`   🔑 비밀번호: ${SUPER_ADMIN_PASSWORD}`);

  // 시드 게시글은 관리자가 작성한 것으로 (id=1)
  seedPosts.forEach((p) => {
    db.posts.push({
      id: db.nextPostId++,
      title: p.title,
      content: p.content,
      category: p.category,
      author: p.author,
      authorId: 1,
      likes: p.likes,
      createdAt: p.createdAt,
    });
  });

  // 유령 계정 + 커뮤니티 활성화 시뮬레이션
  await createGhostAccounts();
  backfillGhostPosts();
  scheduleNext24hGhostPosts();
}

// ─── 미들웨어 ─────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.static(__dirname));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ─── 유틸 ─────────────────────────────────────────────────────
function issueToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function sanitizeUser(u) {
  if (!u) return null;
  const { passwordHash, ...safe } = u;
  return safe;
}

function calculateLevel(credits) {
  if (credits >= 2000) return "gold";
  if (credits >= 500) return "silver";
  return "bronze";
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "로그인이 필요합니다." });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.users.find((u) => u.id === decoded.sub);
    if (!user) return res.status(401).json({ error: "사용자 없음" });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: "토큰이 유효하지 않습니다." });
  }
}

function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "관리자만 접근 가능합니다." });
  }
  next();
}

// ─── 인증 API ────────────────────────────────────────────────
app.post("/api/signup", async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) {
    return res.status(400).json({ error: "이메일, 비밀번호, 이름을 모두 입력해주세요." });
  }
  if (db.users.find((u) => u.email === email)) {
    return res.status(400).json({ error: "이미 가입된 이메일입니다." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "비밀번호는 6자 이상이어야 합니다." });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = {
    id: db.nextUserId++,
    email,
    passwordHash,
    name,
    role: "user",
    credits: 100, // 가입 보너스
    level: "bronze",
    createdAt: new Date().toISOString(),
  };
  db.users.push(newUser);
  const token = issueToken(newUser);
  res.json({ token, user: sanitizeUser(newUser) });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = db.users.find((u) => u.email === email);
  if (!user) return res.status(400).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(400).json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
  const token = issueToken(user);
  res.json({ token, user: sanitizeUser(user) });
});

app.get("/api/me", authRequired, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

// ─── 웨딩홀 API ──────────────────────────────────────────────
app.get("/api/halls", (req, res) => {
  const { region, tier } = req.query;
  let results = weddingHalls;
  if (region) results = results.filter((h) => h.region.includes(region));
  if (tier) results = results.filter((h) => h.tier === tier);
  res.json({ halls: results });
});

// ─── 동맹 업체 API (초록 마크) ───────────────────────────────
app.get("/api/partners", (req, res) => {
  const { category } = req.query;
  let results = partners;
  if (category) results = results.filter((p) => p.category === category);
  res.json({ partners: results });
});

// ─── 견적서 업로드 API (모의 AI 파싱) ────────────────────────
app.post("/api/estimates", authRequired, (req, res) => {
  const { vendorName, category, amount, note } = req.body || {};
  if (!vendorName || !category || !amount) {
    return res.status(400).json({ error: "업체명·카테고리·금액은 필수입니다." });
  }
  const user = req.user;

  // 크레딧 지급: 카테고리 첫 업로드 300p, 그 외 100p
  const hasCategoryUpload = db.estimates.some((e) => e.userId === user.id && e.category === category);
  const gained = hasCategoryUpload ? 100 : 300;

  const estimate = {
    id: db.nextEstimateId++,
    userId: user.id,
    userName: user.name,
    vendorName,
    category,
    amount: Number(amount),
    note: note || "",
    createdAt: new Date().toISOString(),
  };
  db.estimates.push(estimate);

  user.credits += gained;
  user.level = calculateLevel(user.credits);

  res.json({
    estimate,
    creditsGained: gained,
    newBalance: user.credits,
    newLevel: user.level,
    message: hasCategoryUpload
      ? `견적서 업로드 완료! +${gained}p 적립`
      : `${category} 카테고리 첫 업로드! +${gained}p 적립 🎉`,
  });
});

app.get("/api/estimates", authRequired, (req, res) => {
  const { category } = req.query;
  let results = db.estimates;
  if (category) results = results.filter((e) => e.category === category);

  // 유저 레벨에 따라 열람 제한
  const level = req.user.level;
  let maxView = 3;
  if (level === "silver") maxView = 10;
  if (level === "gold" || level === "admin") maxView = 9999;

  const limited = results.slice(0, maxView).map((e) => ({
    ...e,
    vendorName: level === "bronze" ? maskVendor(e.vendorName) : e.vendorName,
  }));

  // 업체별 평균 단가 집계 (누구나 볼 수 있음)
  const byVendor = {};
  results.forEach((e) => {
    if (!byVendor[e.vendorName]) byVendor[e.vendorName] = [];
    byVendor[e.vendorName].push(e.amount);
  });
  const stats = Object.keys(byVendor).map((v) => ({
    vendorName: level === "bronze" ? maskVendor(v) : v,
    count: byVendor[v].length,
    avg: Math.round(byVendor[v].reduce((a, b) => a + b, 0) / byVendor[v].length),
    min: Math.min(...byVendor[v]),
    max: Math.max(...byVendor[v]),
  }));

  res.json({
    estimates: limited,
    stats,
    totalCount: results.length,
    userLevel: level,
    maxView,
  });
});

function maskVendor(name) {
  if (!name || name.length <= 2) return name;
  return name.slice(0, 1) + "○".repeat(name.length - 2) + name.slice(-1);
}

// ─── 커뮤니티 API ───────────────────────────────────────────
app.get("/api/posts", (req, res) => {
  const posts = db.posts.slice().sort((a, b) => {
    const at = new Date(a.createdAtFull || a.createdAt).getTime();
    const bt = new Date(b.createdAtFull || b.createdAt).getTime();
    return bt - at; // 최신순
  });
  // 유령 플래그는 외부에 노출하지 않음
  const sanitized = posts.map(({ isGhost, createdAtFull, ...rest }) => ({
    ...rest,
    createdAt: createdAtFull || rest.createdAt,
  }));
  res.json({ posts: sanitized });
});

app.post("/api/posts", authRequired, (req, res) => {
  const { title, content, category } = req.body || {};
  if (!title || !content) {
    return res.status(400).json({ error: "제목과 내용을 입력해주세요." });
  }
  const post = {
    id: db.nextPostId++,
    title,
    content,
    category: category || "자유",
    author: req.user.name,
    authorId: req.user.id,
    likes: 0,
    createdAt: new Date().toISOString().slice(0, 10),
  };
  db.posts.push(post);

  // 게시글 작성 시 30p 지급
  req.user.credits += 30;
  req.user.level = calculateLevel(req.user.credits);

  res.json({ post, creditsGained: 30, newBalance: req.user.credits });
});

// ─── 체크리스트 API ──────────────────────────────────────────
app.get("/api/checklist", authRequired, (req, res) => {
  const userItems = db.checklistItems.filter((c) => c.userId === req.user.id);
  const withStatus = checklistTemplate.map((t) => ({
    ...t,
    completed: userItems.some((u) => u.itemId === t.id),
  }));
  res.json({ items: withStatus });
});

app.post("/api/checklist/:itemId", authRequired, (req, res) => {
  const { itemId } = req.params;
  const template = checklistTemplate.find((t) => t.id === itemId);
  if (!template) return res.status(404).json({ error: "체크리스트 항목 없음" });

  const existing = db.checklistItems.find((c) => c.userId === req.user.id && c.itemId === itemId);

  if (existing) {
    // 이미 체크된 항목 해제
    db.checklistItems = db.checklistItems.filter((c) => !(c.userId === req.user.id && c.itemId === itemId));
    return res.json({ completed: false });
  }

  db.checklistItems.push({ userId: req.user.id, itemId, completedAt: new Date().toISOString() });
  // 체크리스트 완료 시 10p 지급
  req.user.credits += 10;
  req.user.level = calculateLevel(req.user.credits);

  res.json({ completed: true, creditsGained: 10, newBalance: req.user.credits });
});

// ─── 관리자 API ─────────────────────────────────────────────
app.get("/api/admin/stats", authRequired, adminRequired, (req, res) => {
  const ghostUserCount = db.users.filter((u) => u.isGhost).length;
  const ghostPostCount = db.posts.filter((p) => p.isGhost).length;
  res.json({
    userCount: db.users.filter((u) => u.role !== "admin").length,
    realUserCount: db.users.filter((u) => u.role !== "admin" && !u.isGhost).length,
    ghostUserCount,
    estimateCount: db.estimates.length,
    postCount: db.posts.length,
    realPostCount: db.posts.length - ghostPostCount,
    ghostPostCount,
    hallCount: weddingHalls.length,
    partnerCount: partners.length,
    greenMarkCount: partners.filter((p) => p.greenMark).length,
    byLevel: {
      bronze: db.users.filter((u) => u.level === "bronze").length,
      silver: db.users.filter((u) => u.level === "silver").length,
      gold: db.users.filter((u) => u.level === "gold").length,
    },
  });
});

app.get("/api/admin/users", authRequired, adminRequired, (req, res) => {
  res.json({ users: db.users.map(sanitizeUser) });
});

app.post("/api/admin/users/:id/credits", authRequired, adminRequired, (req, res) => {
  const userId = parseInt(req.params.id);
  const { delta } = req.body || {};
  const user = db.users.find((u) => u.id === userId);
  if (!user) return res.status(404).json({ error: "사용자 없음" });
  user.credits = Math.max(0, user.credits + Number(delta));
  user.level = user.role === "admin" ? "admin" : calculateLevel(user.credits);
  res.json({ user: sanitizeUser(user) });
});

app.get("/api/admin/estimates", authRequired, adminRequired, (req, res) => {
  res.json({ estimates: db.estimates });
});

// ─── 서버 시작 ───────────────────────────────────────────────
initialize().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🎉 웨딩 데모 서버 실행 중: http://localhost:${PORT}`);
    console.log(`📜 슬로건: "플래너가 있는 결혼준비, 거품이없을까요?"\n`);
    console.log(`📊 시드 데이터:`);
    console.log(`   · 웨딩홀 ${weddingHalls.length}곳 (서울·경기)`);
    console.log(`   · 초록 마크 동맹 업체 ${partners.length}곳 (본식스냅 5 + 헤메 5)`);
    console.log(`   · 커뮤니티 시드 글 ${seedPosts.length}건\n`);
  });
});
