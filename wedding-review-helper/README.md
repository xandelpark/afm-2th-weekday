# 더화려한날엔 · 후기 작성 도우미

본식스냅 업체 **더화려한날엔**(thewonderfulday.co.kr) 고객이 후기 이벤트에 참여할 때,
객관식 설문에 **체크만** 하면 웨딩카페·개인블로그에 바로 올릴 후기 초안을 **AI(Gemini)** 가 대신 써주는 무설치 웹.

- **후기 종류**: 계약후기(왜 계약했는지) / 사진후기(예식 당일 + 맛보기 보정본)
- **말투**: 친근한 말투 / 정중한 말투 (둘 다 존댓말)
- **채널**: 카페 후기(500자+) / 블로그 후기(1000자+)
- **글 말미**: 홈페이지·카카오채널 링크 자동 첨부
- **횟수 제한**: 연락처당 **카페 1회 + 블로그 1회 (총 2회)** — 자동 승인, 승인 단계 없음

## 스택

- 생성: **Google Gemini 2.5 Flash** (무료 티어, thinking 비활성) — REST 호출
  - (`gemini-2.0-flash`는 무료 토큰 쿼터 소진 이슈가 있어 2.5-flash 사용)
- 저장: **Supabase(PostgreSQL)** — `wedding_review.usage` 테이블 (연락처×채널 1회 제한)
- 프론트: React(CDN) 단일 `index.html`
- 배포: Vercel (정적 + `api/` 서버리스)

## 구조

```
index.html        # 설문 UI + 입력폼(말투·채널·이름·연락처) + 결과 편집/복사
api/generate.js   # Vercel 서버리스 (횟수확인 → 생성 → 기록)
single.js         # 로컬 개발 서버
lib/service.js    # 횟수제한 + 생성 + 기록 오케스트레이션
lib/generate.js   # Gemini 호출 + 프롬프트 + 링크 푸터
lib/db.js         # Supabase 연결 / 스키마·테이블 / 횟수 조회·기록
```

## 환경변수 (`.env`, git 제외됨)

| 변수 | 설명 |
|---|---|
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey 에서 무료 발급 |
| `DATABASE_URL` | Supabase pooler 연결 URL (Week-5 공유, `wedding_review` 스키마) |
| `MOCK_REVIEW=1` | (개발) Gemini 대신 샘플 문구 |
| `SKIP_DB=1` | (개발) DB 없이 횟수제한 무시 |

## 로컬 실행

```bash
npm install
# .env 에 GEMINI_API_KEY 채우기
npm run dev        # http://localhost:3210
```

키 없이 UI만 볼 때: `MOCK_REVIEW=1 npm run dev`

## 배포 (Vercel)

```bash
vercel deploy --prod --yes
```

Vercel → Environment Variables 에 `GEMINI_API_KEY`, `DATABASE_URL` 등록.
테이블은 서버 첫 요청 시 자동 생성(`db.ensure()`).

## 커스터마이즈

- **링크**: `lib/generate.js`의 `LINKS` (홈페이지·카카오채널)
- **분량/말투/AI 티 제거 규칙**: `lib/generate.js`의 `lengthLine`/`toneLine`/`SYSTEM`
- **설문 문항**: `index.html`의 `SURVEYS`
- **횟수 제한 정책**: `lib/db.js` 테이블의 `unique (phone, channel)` + `lib/service.js`
- **모델 교체**: `GEMINI_MODEL` 환경변수 (기본 `gemini-2.5-flash`)

## 데이터

`wedding_review.usage(phone, name, channel, review_type, created_at)` — 업체가 누가·언제·어떤 채널로 썼는지 조회 가능. 연락처는 개인정보이므로 `.env`/DB 접근을 안전하게 관리하세요.
