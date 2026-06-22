# DEV.md - 개발 가이드

> **Marian Wedding — Thank You Card** (운영 슬기 · 마리안 웨딩 단일 스튜디오)
> 결혼식 후 마리안 부부에게 ID/PW 발급 → 본식 스냅 1장 업로드 → 3가지 톤(미니멀·격식·감성) 땡큐카드 자동 생성 → PNG 다운로드.
> Architecture: **Option 2 — Supabase JS** (Supabase Auth + Postgres + Storage 기반)

---

## Requirements

> MISSION.md의 Core Features를 개발 체크리스트로 옮긴 것. 각 항목은 v1 출시 기준 "동작" 정의를 포함.

- [ ] **관리자 승인형 회원가입**
  - [ ] 일반 사용자의 자유 가입 차단 (Supabase Auth signUp을 클라이언트에서 막고, 관리자 전용 invite 경로만 허용)
  - [ ] 관리자 페이지에서 ID(=이메일) + 임시 비밀번호 발급
  - [ ] `accounts` 테이블에 `status('active'|'disabled')`, `expires_at`, `quota_total`, `quota_used` 컬럼 운용
  - [ ] 만료/비활성/할당량 초과 시 로그인 후 업로드 막힘 (RLS로 강제)
- [ ] **본식 스냅 업로드 + 부부 슬롯 입력**
  - [ ] JPEG/PNG/HEIC 입력, 클라이언트에서 EXIF 자동 회전 보정
  - [ ] 사진 1장 + 부부 슬롯(신부 이름 / 신랑 이름 / 식 일자 / 식장 / 감사 메시지)
  - [ ] 카테고리 선택 없음 (v1 = 땡큐카드 단일)
  - [ ] Supabase Storage `originals` 버킷에 업로드 (private, owner=user_id)
  - [ ] 한 장당 20MB 이하, 최소 짧은 변 1080px 이상 권장 안내
- [ ] **자동 땡큐카드 합성 (3 변형 동시 생성)** — 본식 스냅 1장 + 부부 슬롯으로 3가지 톤 카드를 동시 출력:
  - [ ] *미니멀 땡큐* (러블리 미니멀, 인스타 피드용): 사진 72% + 누드 핑크 캡션 띠 28% + 손글씨 `thank you`(Allura) + 부부·날짜 한 줄
  - [ ] *격식형 땡큐* (청첩장 톤의 정중한 감사장): 풀블리드 사진 + 모노그램 + 큰 손글씨 `Thank you` + 한국어 감사 + 일자/장소/이름
  - [ ] *감성 땡큐* (한국어 종서 감성): 풀블리드 사진 + 우측 한국어 종서 + 좌하 `Starring · 부부명 · — Fin —`
  - [ ] 디폴트 카피는 사전 정의(LLM 호출 없음). 부부가 카드 안에서 직접 텍스트 수정 가능.
  - [ ] 청첩장과 명확히 구분(시점/메시지/톤 모두 다름)
- [ ] **부분 수정 에디터 (캔바 라이트)**
  - [ ] 텍스트 블록 드래그 이동 (스냅 가이드 포함)
  - [ ] 텍스트 색 변경 (프리셋 6색 + 컬러피커)
  - [ ] 텍스트 불투명도 슬라이더 (0~100%)
  - [ ] **그 외 요소(폰트 종류, 사진 크기, 새 요소 추가 등)는 잠금**
  - [ ] "원본 결과로 복원" 버튼
- [ ] **결과물 다운로드**
  - [ ] PNG 1080×1350 / 1080×1080 두 사이즈
  - [ ] 워터마크 토글 (관리자 설정에 따름)
- [ ] **관리자 페이지**
  - [ ] 계정 발급/비활성/만료일 수정/할당량 리셋
  - [ ] 최근 생성 결과물 목록 (썸네일 + 사용자 + 카테고리 + 스타일)
- [ ] **인증/세션**
  - [ ] Supabase Auth 이메일+비번 로그인 (자유 가입 OFF)
  - [ ] 첫 로그인 시 비밀번호 재설정 강제

## Non-goals

- AI 이미지 생성·변형 (사진은 원본 그대로)
- **본식 스냅(땡큐카드) 외 다른 카테고리** (야외/제품/풍경 — v1 제외)
- 결제·구독·플랜
- 자유 가입·소셜 로그인 (마리안 운영자가 부부 단위로 발급)
- 캔바급 자유 편집(요소 추가, 도형, 그리드, 필터 등) — 텍스트 위치/크기/문구 수정만
- 다중 스튜디오/멀티 테넌시 — v1은 마리안 웨딩 단일 스튜디오 전용
- 협업·댓글·공유 권한 관리
- 모바일 네이티브 앱

## Style

- **앱 UI 셸 톤** = AFM 디자인 시스템 **Marian Editorial** 팔레트 (shadcn 토큰 기반). Deep midnight navy primary(`#091940`, hsl 224 75% 14%) + 흰 배경 + sharp(0px) radius + Helvetica display + `eyebrow` 0.32em letterspacing uppercase. 색은 토큰만 사용(`bg-primary`, `text-foreground`, `border-border`), variant는 shadcn 표준(`default | outline | ghost | secondary | destructive | link`).
- **포스터 결과물 톤** (셸과 분리, 카테고리별 자체 정책):
  - 본식(땡큐카드) = **러블리** — 누드 핑크/크림 `#fbf2eb` ~ `#fdf3ee`, 와인/모브 액센트 `#7d4f47`/`#9b6b5e`, 손글씨 컬리그래피(Allura), 작은 잎·하트 라인 장식, 사진 모서리 살짝 라운드.
  - 야외 / 제품 / 풍경 = 카테고리 *용도* 확정 시 정의.
- **폰트**: Pretendard(국문 기본) · Noto Serif KR(국문 세리프) · Cormorant Garamond(라틴 세리프 italic) · Playfair Display(디스플레이) · **Allura(손글씨, 땡큐카드 hero "thank you")**. 모두 OFL/SIL.
- **반응형**: 모바일 우선. 데스크톱은 max-width 480~720px(사용자 화면) / 1280px(갤러리·관리자)로 가운데 띄움.
- **로딩**: 합성 중 3 스타일 카드 스켈레톤 동시 표시 → 결과 도착 순 페이드인.
- **에러 톤**: 실패는 inline 토스트(상단 4초). 회원·만료·할당량 같은 영구 차단은 모달 1단.

## Key Concepts

- **Account (계정)**: 관리자가 발급한 사용자 단위. `expires_at`이 지나면 자동 비활성. `quota_total - quota_used`가 0이면 업로드 차단.
- **Asset (원본 사진)**: 사용자가 올린 원본 1장. Storage `originals` 버킷에 저장. 메타에 카테고리·EXIF 회전·크기 보존.
- **Poster (결과물)**: 한 Asset에 대해 생성된 한 스타일 결과. 1 Asset ↔ 3 Poster(미니멀/청첩장/감성).
- **Style Template**: 카테고리×스타일 조합별 레이아웃 사양(JSON). 텍스트 슬롯 좌표, 폰트, 색, 카피 풀을 포함.
- **Edit (부분 수정)**: Poster의 텍스트 블록에 대한 위치/색/투명도 변경 패치. 원본 템플릿은 보존하고 사용자 패치만 별도 저장.

## Open Questions

- **본식 = 땡큐카드 슬롯**(신랑/신부/일자/장소/감사 메시지): 업로드 시 입력 vs 결과 화면 인라인 편집. → **v1 디폴트: 업로드 시 입력**, Phase 3에서 검증.
- **야외 / 제품 / 풍경 카테고리의 용도** 도 명확히 잡아야 함 — 후보(미정): 야외=데이트 추억카드, 제품=신상 출시카드, 풍경=여행 일지카드. 본식 폴리싱 잠금 후 차례로 정의.
- 감성문구 카피 소스: (a) 사전 정의 풀 ← v1 디폴트, (b) LLM, (c) 직접 입력 토글.
- 폰트 라이센스: Pretendard / Noto Serif KR / Cormorant Garamond / Playfair Display / Allura 모두 OFL·SIL — v1 OK.
- 만료일·할당량 디폴트: **30일 / 50장**, 관리자가 변경 가능.
- 워터마크: v1 디폴트 OFF, 관리자 토글 ON 시 우하단 8% 자기 로고 PNG 자동 합성.

---

## 선택된 개발 구조

**Option 2 — Supabase JS** 구조를 베이스로 하되, "관리자 발급형 회원가입"이라는 우리 모델 특성상 **server.js를 가벼운 admin API 게이트웨이로 1개 둠**.

```
사용자 브라우저
   │
   ├── (인증·읽기·쓰기) ─────────► Supabase
   │       Auth · Postgres · Storage  (RLS로 보안)
   │
   └── (관리자 invite·계정만료) ──► server.js (Express, service-role 보유)
                                          └─► Supabase Admin API
```

**왜 server.js 한 개를 추가했나?**
Supabase의 `auth.signUp`을 클라이언트에서 막더라도, "관리자가 임의 비번으로 사용자를 만든다"는 동작은 **service role key**가 필요합니다. 이 키는 절대 브라우저에 노출하면 안 되므로, 관리자 전용 엔드포인트(`POST /api/admin/accounts`, `PATCH /api/admin/accounts/:id` 등)를 작은 Express 서버에 둡니다. 일반 사용자 흐름은 모두 supabase-js로 직결합니다.

**포스터 합성은 어디서?**
- 텍스트 합성·다운로드는 전부 **브라우저 캔버스(html2canvas + canvas API)** 에서 처리.
- 원본 사진과 최종 PNG는 Supabase Storage에 저장.
- 서버 GPU·렌더 파이프라인 불필요 → 비용 ↓, 응답 < 8초 목표 달성 쉬움.

## 개발 에이전트

이 저장소(`afm-2th-weekday`)에 정의된 에이전트를 그대로 활용:
- **`single-react-dev`** — `index.html`(React 18 CDN + Tailwind CDN + supabase-js CDN) 전담. 파일 분리 없이 하나에 모두 작성.
- **`single-server-specialist`** — `server.js` 전담. 단, 이 프로젝트에서는 **관리자 admin API 라우트만** 담당 (사용자 데이터 CRUD는 클라이언트에서 supabase-js로 직접).
- (옵션) **`vercel-deploy-optimizer`** — Phase 4 배포 시.

## 프로젝트 구조

```
photo-poster/
├── MISSION.md                # 제품 미션 (Done)
├── DEV.md                    # 개발 가이드 (이 파일)
├── prototype-v1.html         # Phase 1 산출물 (서버 없이 브라우저에서 직접 열기)
├── index.html                # Phase 2부터: React + Tailwind + supabase-js (CDN)
├── server.js                 # 관리자 admin API 게이트웨이 (Express)
├── package.json
├── .env                      # 로컬 비밀키 (커밋 금지)
├── .env.example              # 키 이름 예시 (커밋 OK)
├── supabase/
│   ├── schema.sql            # accounts / assets / posters / edits 테이블 + RLS
│   ├── policies.sql          # RLS 정책 (사용자는 자기 것만, admin role은 전체)
│   └── seed.sql              # 카테고리 × 스타일 템플릿·카피 풀 시드 데이터
├── assets/
│   ├── fonts/                # Pretendard, Noto Serif KR, Playfair Display (woff2)
│   └── samples/              # 더미 사진 (Phase 1 프로토타입용)
└── README.md
```

> ⚠️ Option 2 구조에서 Supabase 외에 server.js를 추가한 이유는 위 "선택된 개발 구조"에 설명. 일반 사용자 흐름은 server.js를 거치지 않음.

---

## 📋 TODO List

### Phase 1: 디자인 & 프로토타이핑
- [ ] 🟢 `prototype-v1.html` 작성 — 더미 데이터로 전체 화면(로그인 → 업로드/카테고리 → 3 스타일 결과 → 부분 편집 → 다운로드 → 관리자 화면)을 한 파일에 구성. 서버·DB 불필요, 브라우저에서 직접 열어 확인.
- [ ] 🟢 3 스타일 시각 디자인 시안 — 러블리 미니멀 / 청첩장 / 한국어 종서 감성 무드를 더미 사진 위에 직접 그려보고 폰트·여백·색 결정.
- [ ] 🟢 카피 풀 초안 — 카테고리 × 스타일별로 한국어 카피 5~8개씩 (총 60~96개) 마크다운에 정리.
- [ ] 🟢 EXIF 회전 처리·`<canvas>` 텍스트 렌더 동작을 prototype에서 1회 검증.
- 📌 git commit
- 📌 체크포인트: **더미 데이터로 모든 화면이 보이고**, 더미 사진 1장으로 3 스타일 결과가 한 화면에 동시에 나타나는 상태 (브라우저에서 prototype-v1.html을 그냥 열어서 확인).

### Phase 2: 기본 기능 (쉬운 것부터)
- [ ] 🟢 프로젝트 초기화 — `package.json`, Express + supabase-js 의존성 설치, `.env.example` 작성.
- [ ] 🟢 `prototype-v1.html` → `index.html` 전환 — 더미 데이터 자리를 supabase 호출로 교체할 준비 (config 분리, 인증 컨텍스트, 라우팅 골격).
- [ ] 🟢 Supabase 프로젝트 생성 + `supabase/schema.sql` 적용 (`accounts`, `assets`, `posters`, `edits` 테이블).
- [ ] 🟢 Supabase Auth 이메일+비번 로그인 화면 (`AuthGate` 컴포넌트). 자유 가입 UI 제거.
- [ ] 🟡 사진 업로드 + Storage `originals` 버킷 적재. 업로드 카드 컴포넌트 (`UploadCard`).
- [ ] 🟡 합성 엔진 v0 — 카테고리 + 스타일 템플릿 JSON을 받아 캔버스에 렌더하는 `PosterRenderer` 함수. (LLM·외부 API 없이 순수 캔버스)
- [ ] 🟡 결과 카드 3종 (`PosterCard × 3`) + PNG 다운로드 버튼.
- 📌 git commit
- 📌 체크포인트: **로컬 dev 환경에서 로그인 → 사진 업로드 → 3 스타일 결과 → 다운로드까지 실제 동작**.

### Phase 2.5: 플랫폼 연동 검증 (Supabase·server.js 연결 확인)
- [ ] 🟡 RLS 정책 적용 (`supabase/policies.sql`) — 사용자는 본인 데이터만 select/insert, 관리자 role만 accounts 테이블 쓰기.
- [ ] 🟡 `server.js` 관리자 admin API — `POST /api/admin/accounts`(invite), `PATCH /api/admin/accounts/:id`, `POST /api/admin/accounts/:id/reset-quota`. service-role-key는 서버에만 보관.
- [ ] 🟡 관리자 화면(`AdminPanel` 컴포넌트)에서 admin API 호출. 관리자 식별은 Supabase Auth user의 `role='admin'` claim 또는 환경 변수 ALLOWLIST 이메일.
- [ ] 🟡 만료·할당량·비활성 체크가 일반 사용자 업로드를 실제로 차단하는지 검증 (계정 1개를 만료시켜서 업로드 시 거절되는 것 확인).
- 📌 git commit
- 📌 체크포인트: **다른 브라우저(시크릿창)에서 두 계정으로 동시에 로그인해도 서로의 데이터가 절대 보이지 않음** + 관리자만 `accounts` 변경 가능.

### Phase 3: 핵심 & 어려운 기능 (불확실한 것부터)
- [ ] 🔴 **감성 카드 자동 카피 위치잡기** — 사진의 어두운/밝은 영역을 분석해 텍스트 위치·색을 자동 결정. ⚠️ 실패 시 우회: 카테고리별 사전 정의 위치 6종 중 무작위 선택.
- [ ] 🔴 **부분 수정 에디터** — 드래그 이동(스냅), 색 프리셋, 불투명도 슬라이더. 변경은 Poster의 `edits` row로 저장하고, 다음 로드 때 원본 템플릿 + edits 패치로 복원.
- [ ] 🟡 **청첩장 슬롯 입력 폼** — 업로드 시 신랑/신부/날짜/장소 입력. 빈 칸이면 placeholder 그대로.
- [ ] 🟡 **EXIF 회전 정확성** — 안드로이드/아이폰에서 찍은 세로/가로/180° 사진 모두 정상 표시되는지 5장 테스트.
- [ ] 🟡 **결과물 두 사이즈 다운로드** (1080×1350 / 1080×1080).
- [ ] 🟢 워터마크 토글 (관리자 설정 → poster 합성 시 우하단 자동 합성).
- 📌 git commit
- 📌 체크포인트: **카테고리 4종 × 스타일 3종 매트릭스 12조합을 더미 사진 12장으로 다 돌렸을 때, 70% 이상이 "수정 없이 다운로드"하고 싶은 완성도**.

### Phase 4: 마무리 & 배포
- [ ] 🟡 빈 상태/에러 상태/로딩 스켈레톤 UI 폴리싱.
- [ ] 🟡 카피 풀 보강 (카테고리당 10개 이상으로 확대).
- [ ] 🟡 사진 용량 제한·HEIC 변환·EXIF 보정 엣지 케이스.
- [ ] 🟡 Vercel/Render 배포 — `server.js`는 Node 런타임, 정적 파일은 같은 도메인 서빙. 환경 변수 등록.
- [ ] 🟡 관리자 첫 계정 생성 스크립트 (`scripts/create-first-admin.js`).
- [ ] 🟢 README 작성 (스튜디오 운영자 관점의 운영 매뉴얼).
- 📌 git commit
- 📌 체크포인트: **공개 URL에서 관리자가 계정을 발급 → 신규 사용자가 로그인해 첫 결과물 받기까지 막힘 없음**.

---

## 🔧 외부 설정 필요 항목

### 필수 (Must Have)

| 항목 | 설명 | 획득 방법 |
|---|---|---|
| `SUPABASE_URL` | Supabase 프로젝트 URL | supabase.com → 프로젝트 생성 → Settings → API → `Project URL` |
| `SUPABASE_ANON_KEY` | 클라이언트용 공개 키 | 같은 화면 `anon public` |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 비밀 키 (admin API에서만 사용) | 같은 화면 `service_role` (절대 클라이언트 노출 금지) |
| `ADMIN_EMAILS` | 관리자 권한 이메일 화이트리스트 (콤마 구분) | 운영자가 직접 정의 (예: `psk1397@gmail.com`) |
| `JWT_AUDIENCE` | 토큰 검증용 (Supabase 기본 `authenticated`) | Supabase 기본값 사용 |

### Storage 버킷 (Supabase 콘솔에서 생성)

| 버킷명 | 공개 여부 | 설명 |
|---|---|---|
| `originals` | private | 사용자가 올린 원본 사진 |
| `posters` | private | 합성된 PNG (다운로드 시에만 signed URL) |
| `assets-public` | public | 폰트·로고·워터마크 이미지 |

### DB 스키마 (Phase 2에서 `supabase/schema.sql`로 적용)

```sql
-- accounts: 관리자가 발급한 사용자 메타
create table accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','disabled')),
  expires_at timestamptz,
  quota_total int not null default 50,
  quota_used int not null default 0,
  created_at timestamptz not null default now()
);

-- assets: 업로드된 본식 스냅 + 부부 슬롯 (v1은 카테고리 단일 = wedding)
create table assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  category text not null default 'wedding' check (category = 'wedding'),
  -- 부부 슬롯
  bride_name text, groom_name text,
  ceremony_date date, venue text, thanks_message text,
  width int, height int, exif_orientation int,
  created_at timestamptz not null default now()
);

-- posters: 합성된 결과 (한 asset당 3 row: minimal/invitation/emotive)
create table posters (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  style text not null check (style in ('minimal','invitation','emotive')),
  size text not null check (size in ('1080x1350','1080x1080')),
  storage_path text,
  template_version text not null,
  created_at timestamptz not null default now()
);

-- edits: 사용자 부분 수정 패치 (텍스트 위치·색·투명도)
create table edits (
  poster_id uuid primary key references posters(id) on delete cascade,
  patch jsonb not null,
  updated_at timestamptz not null default now()
);
```

### 선택 (Nice to Have)

| 항목 | 설명 |
|---|---|
| `SENTRY_DSN` | 운영 중 에러 수집 |
| `POSTHOG_KEY` | 사용 패턴 분석 (수정률·다운로드율 추적 → 성공 지표 측정) |
| `RESEND_API_KEY` 또는 SMTP | 관리자가 계정 발급할 때 임시 비번을 이메일로 자동 발송 |
| `S3_*` | Supabase Storage 한도 초과 시 외부 스토리지 |

---

## 시작하기

```bash
# 1) 프로젝트 폴더로 이동
cd afm-2th-weekday/photo-poster

# 2) Phase 1: 서버 없이 프로토타입 열기
open prototype-v1.html       # 또는 브라우저로 파일 직접 열기

# 3) Phase 2 진입 시점에 실행할 명령
npm init -y
npm i express @supabase/supabase-js dotenv cors
npm i -D nodemon

# 4) .env 작성 후 dev 서버 기동
cp .env.example .env         # 키 채우기
node server.js               # http://localhost:3010
```

`.env.example`:
```
PORT=3010
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_EMAILS=psk1397@gmail.com
```

> 포트는 다른 AFM 프로젝트(todo_app_01=3003 등)와 겹치지 않도록 **3010**으로 잡음. 변경 자유.

---

## 개발 시 유의 사항

1. **service_role_key는 절대 `index.html`에 노출하지 말 것.** 클라이언트는 `SUPABASE_ANON_KEY`만 사용.
2. **자유 가입 UI를 만들지 말 것.** "회원가입" 버튼 자체가 등장해서는 안 된다. 비밀번호 분실 시에도 관리자 경로로만 재설정.
3. **합성 결과를 Storage에 저장하기 전에**, 클라이언트가 만든 PNG의 해시를 보내 서버에서 멱등성 체크 (같은 asset+style+size+template_version+edits이면 재업로드 생략).
4. **할당량 차감은 클라이언트 신뢰 X.** poster insert가 RLS 트리거에서 `accounts.quota_used += 1`을 안전하게 처리하도록 함.
5. **Phase 1의 prototype-v1.html은 서버 없이 열어 확인.** Phase 2에서 index.html로 전환하기 전엔 supabase-js·.env 도입 금물 (바이브 코딩 실패 방지).
