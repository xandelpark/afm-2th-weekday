# DEV.md - 개발 가이드

> 부모-아기 대화 음성/영상을 발화자별 카툰 캐릭터 + 자막이 입혀진 MP4로 변환해 SNS에 공유하는 도구.
> Architecture: **Single-File (단일 파일 구조)** — 레포 표준 패턴(index.html + server.js)

---

## Requirements

- [ ] 음성/영상 파일 업로드 (mp4 / m4a / mp3, 최대 5분)
- [ ] AssemblyAI로 발화자 자동 구분 (사람1/2/3) + 한국어 transcription
- [ ] 사용자가 사람1/2/3을 아빠/엄마/아기로 라벨링
- [ ] 역할별 캐릭터 선택 UI (아빠 5종 / 엄마 5종 / 아기 5종)
- [ ] 아기 segment 자막 자동 의성어 배치 ("응애!", "꺄르륵", "옹알옹알" 등) + 사용자 편집 가능
- [ ] 부모 segment는 transcription 그대로 자막 표시 + 사용자 편집 가능
- [ ] 미리보기 (브라우저 내 렌더링)
- [ ] fluent-ffmpeg로 캐릭터 PNG + 자막 + 원본 음성을 합성한 MP4 출력
- [ ] MP4 다운로드 (기본)
- [ ] Web Share API로 인스타 공유 (모바일 브라우저)
- [ ] [Stretch] YouTube Data API v3 OAuth 다이렉트 업로드
- [ ] 업로드 후 1시간 자동 삭제 (cron job)
- [ ] 화면에 "1시간 후 자동 삭제" 명시
- [ ] AssemblyAI 클라우드 전송 동의 체크박스
- [ ] DB는 메타데이터만 저장 (`baby_cartoon` 스키마)
- [ ] 본인 영상 1개로 end-to-end 1회 성공
- [ ] 음성·자막 동기화 오차 ±1초 이내
- [ ] 발화자 구분 정확도 ≥ 80%
- [ ] 처리 시간 ≤ 입력 영상 길이 × 3

## Non-goals

- LLM 옹알이 창작 번역 (v2)
- 인스타그램 Graph API 다이렉트 업로드 (Meta 심사 필요 — Web Share API로 우회)
- 가족 사진 → AI 캐리커처
- 입 모양 lip sync 자동화
- 사용자 계정/로그인 (익명 사용)
- 5분 초과 영상
- 한국어 외 언어
- 사용자 직접 캐릭터 업로드, 동물/시즌 캐릭터 (v2)

## Style

- 한국어 UI / 한국어 시스템 메시지
- Tailwind CDN, 단일 페이지 단계 진행 (Wizard 패턴: Upload → Label → Customize → Preview → Export)
- 모바일 우선 레이아웃 (1차 사용 환경이 핸드폰)
- 따뜻하고 부드러운 톤 — 아기/가족 도메인. pastel 컬러 팔레트
- 로딩 단계 명시 ("음성 분석 중... 30초 정도 걸려요" 같은 친절한 안내)

## Key Concepts

- **Segment**: AssemblyAI가 반환하는 발화 단위. `{ start, end, text, speaker: "A" | "B" | "C" }`
- **Speaker Label (사람1/2/3)**: AssemblyAI가 부여하는 익명 라벨 — UI에선 "사람1/2/3"으로 표시
- **Role (아빠/엄마/아기)**: 사용자가 사람1/2/3에 매핑하는 역할
- **Character**: 역할별 5장 PNG 중 사용자가 선택한 1장
- **Onomatopoeia Pool (의성어 풀)**: 아기 segment에 자동 배치되는 단어 셋
- **Render Job**: ffmpeg 합성 작업 단위 (input 음성, segment 배열, character mapping → output MP4)

## Open Questions

- AssemblyAI 한국어 발화자 구분 실측 정확도? Day 2에 본인 샘플 영상으로 검증 필요
- 캐릭터 5종 큐레이션 라이센스 — unDraw(MIT) / Storyset(free with attribution) 중 어느 쪽? Day 6에 결정
- Vercel 배포 시 ffmpeg 바이너리 사이즈 제약 — 로컬 시연으로 충분한지, 아니면 Render/Railway 같은 호스팅 필요한지

---

## 선택된 개발 구조

**Single-File Architecture (Option 1)** — 레포 표준 패턴

레포의 Week-1~6 프로젝트 모두가 이 구조. 빌드 도구 없이 React 18 + Tailwind를 CDN으로 로드. 이 미션의 모든 기능(multipart 업로드, AssemblyAI 호출, ffmpeg 합성, 정적 파일 서빙, Web Share API)이 단일 `server.js` + 단일 `index.html`로 충분히 구현 가능.

**Option 2 (Supabase JS) 부적합**: ffmpeg 합성과 AssemblyAI API 키는 서버 사이드 필수. 클라이언트 직접 호출 불가.

**Option 3 (Next.js) 오버스펙**: 익명 사용 + 1시간 자동 삭제 → SSR/SEO 가치 0. 빌드 도구 도입 시 레포 표준 위배. Vercel serverless ffmpeg는 용량/타임아웃 제약 큼.

## 개발 에이전트

- **`single-react-dev`** — `index.html` 전담. 모든 프론트엔드 코드(컴포넌트, 스타일, 로직)가 이 파일 하나에 포함됨. 별도 JS/CSS 파일 분리 불가. React 18 + Tailwind CDN + Babel standalone 사용.
- **`single-server-specialist`** — `server.js` 전담. Express 기반 단일 파일. multer(업로드), AssemblyAI 호출, fluent-ffmpeg 합성, 정적 파일 서빙, 1시간 cron, OAuth 콜백 모두 이 파일에서 처리.

### `index.html` 내부 구조 (`<script type="text/babel">` 블록)
1. React Hooks Destructuring (`const { useState, useEffect, useMemo } = React;`)
2. Design System Components (Button, Card, ProgressBar, ConsentCheckbox)
3. Common/Layout Components (Header, StepNav, LoadingOverlay)
4. Page Components (UploadStep, LabelStep, CharacterStep, PreviewStep, ExportStep)
5. App Component (루트, 단계 상태 관리, segment 데이터 hold)
6. Rendering (`ReactDOM.createRoot`)

## 프로젝트 구조

```
Week-7/my-project/
├── index.html                  # 프론트엔드 전체 (React + Tailwind CDN)
├── server.js                   # Express 서버 (업로드/AssemblyAI/ffmpeg/cron)
├── package.json
├── .env                        # gitignore됨
├── .env.example
├── .gitignore
├── public/
│   └── characters/
│       ├── dad-1.png ... dad-5.png
│       ├── mom-1.png ... mom-5.png
│       └── baby-1.png ... baby-5.png
├── uploads/                    # 업로드 원본 (1시간 자동 삭제) — gitignore
├── outputs/                    # 합성된 MP4 (1시간 자동 삭제) — gitignore
├── MISSION.md
├── DEV.md
└── README.md
```

---

## TODO List (1주일 MVP — Day 1~7)

각 Day는 명확한 완료 판정 가능한 단위. Day 끝마다 `git commit` 필수 (세이브 포인트).

### Phase 1: 디자인 & 프로토타이핑

- [ ] 🟢 **Day 1 — UI 프로토타입** — `prototype-v1.html` 단일 파일. 더미 segment 데이터 + 더미 character placeholder로 5단계 Wizard 흐름 모두 보이게. 서버 코드 없이 브라우저로 직접 열어 확인.
  - UploadStep / LabelStep / CharacterStep / PreviewStep / ExportStep 컴포넌트
  - 단계 간 네비게이션 (다음/이전 버튼)
  - 더미 segment 배열로 LabelStep, PreviewStep 그려보기
  - 모바일 레이아웃 검증
- 📌 **체크포인트 (Day 1 끝)**: 더미 데이터로 5단계 흐름 모두 화면에 보이고 네비게이션 동작. `git commit -m "day1: ui prototype"`

### Phase 2: 기본 기능 (쉬운 것부터)

- [ ] 🟢 **Day 2-1 — 프로젝트 초기화** — `package.json` (express, pg, multer, dotenv, node-cron, fluent-ffmpeg, axios, googleapis), `server.js` 스켈레톤(정적 서빙 + `/api/health`), `.env.example`, `.gitignore`(uploads/, outputs/, .env, node_modules/)
- [ ] 🟢 **Day 2-2 — Supabase 스키마 SQL** — `baby_cartoon.jobs` 테이블 작성·실행 (id, original_filename, uploaded_at, expires_at, status, segments JSONB, role_mapping JSONB, character_mapping JSONB, output_path)
- [ ] 🟢 **Day 2-3 — `prototype-v1.html` → `index.html` 전환** — Wizard 상태를 React에서 진짜 API와 연결할 수 있는 형태로 정리
- [ ] 🟡 **Day 2-4 — 파일 업로드 엔드포인트** — `POST /api/upload` (multer, mp4/m4a/mp3 검증, 5분 길이 검증, `./uploads/{job_id}.ext`로 저장, jobs 테이블 INSERT, expires_at = now + 1h)
- [ ] 🟡 **Day 2-5 — AssemblyAI 호출 엔드포인트** — `POST /api/transcribe` (uploads 파일을 AssemblyAI에 업로드 → transcript 요청 (`speaker_labels:true`, `language_code:"ko"`) → polling → segments 정리해 jobs.segments에 저장)
- [ ] 🟡 **Day 2-6 — UploadStep + LabelStep 실데이터 연동** — index.html에서 업로드 → transcribe 호출 → 결과 segment 표시 (사람1/2/3 색상별 timeline)
- 📌 **체크포인트 (Day 2 끝)**: 본인 영상 1개를 실제로 업로드하고 사람1/2/3 segment가 timeline에 표시됨. AssemblyAI 한국어 정확도 실측. `git commit -m "day2: upload + assemblyai integration"`

- [ ] 🟢 **Day 3-1 — LabelStep UI 확정** — 사람1/2/3 → 아빠/엄마/아기 드롭다운 + jobs.role_mapping 저장
- [ ] 🟡 **Day 3-2 — placeholder 캐릭터 3장 준비** — `public/characters/dad-1.png`, `mom-1.png`, `baby-1.png` (역할당 1장. 5종 확장은 Day 6)
- [ ] 🟡 **Day 3-3 — CharacterStep UI** — 역할별 5종 그리드 (현재는 1장만 활성, 나머지 4장은 placeholder/lock) + 선택 결과를 jobs.character_mapping 저장
- 📌 **체크포인트 (Day 3 끝)**: 라벨링 + 캐릭터 선택까지 DB에 저장됨. `git commit -m "day3: labeling + character selection"`

- [ ] 🟢 **Day 4-1 — 의성어 풀 정의** — `server.js` 또는 `index.html`에 `BABY_ONOMATOPOEIA = ["응애!", "꺄르륵", "옹알옹알", "꺅", "헤헤", ...]` 상수
- [ ] 🟡 **Day 4-2 — 자막 자동 배치 로직** — 아기 segment는 의성어 풀에서 랜덤(or duration 기반) 선택. 부모 segment는 transcription 그대로
- [ ] 🟡 **Day 4-3 — 자막 편집 UI** — PreviewStep에서 segment 클릭 시 자막 텍스트 인라인 편집
- [ ] 🟡 **Day 4-4 — 브라우저 내 미리보기** — `<audio>` 재생 + 현재 시간에 맞는 segment의 캐릭터·자막 오버레이 (Canvas 또는 absolute div)
- 📌 **체크포인트 (Day 4 끝)**: 브라우저에서 음성 + 카툰 캐릭터 + 자막이 동기화돼 재생됨 (서버 합성 전). `git commit -m "day4: subtitle editor + browser preview"`

### Phase 3: 핵심 & 어려운 기능 (불확실한 것부터)

- [ ] 🔴 **Day 5-1 — ffmpeg 합성 엔드포인트** — `POST /api/render` (jobs 데이터 읽기 → fluent-ffmpeg 명령 빌드 → 캐릭터 PNG overlay (segment.start ~ segment.end 동안 enable) + drawtext 자막 + 원본 오디오 → `./outputs/{job_id}.mp4`)
  - ⚠️ 실패 시 우회: `drawtext` 한글 폰트 경로 명시 (`/System/Library/Fonts/Supplemental/AppleGothic.ttf` 또는 `NotoSansKR.otf` 번들). 그래도 안 되면 자막을 PNG로 사전 렌더링해서 overlay로 합성
  - ⚠️ 더 큰 실패 시 우회: 클라이언트 사이드 Canvas 녹화 (`MediaRecorder`)로 폴백 — 미션 위험·폴백에 명시됨
- [ ] 🔴 **Day 5-2 — Render 진행률** — long-running 작업 → SSE(`/api/render/:id/stream`) 또는 polling으로 진행률 표시
- [ ] 🟡 **Day 5-3 — ExportStep 다운로드** — render 완료 후 `<a href="/outputs/{id}.mp4" download>` 버튼
- 📌 **체크포인트 (Day 5 끝)**: 본인 영상으로 end-to-end MP4 다운로드 1회 성공. 음성·자막 동기화 ±1초 검증. `git commit -m "day5: ffmpeg render + download"`

- [ ] 🟡 **Day 6-1 — 1시간 자동 삭제 cron** — `node-cron` 5분마다 실행: `SELECT * FROM baby_cartoon.jobs WHERE expires_at < NOW()` → uploads/, outputs/ 파일 삭제 + DB 행 status='expired' 업데이트
- [ ] 🟡 **Day 6-2 — 캐릭터 5종으로 확장** — unDraw 또는 Storyset에서 라이센스 확인 후 dad-2~5, mom-2~5, baby-2~5 추가. CharacterStep의 lock 해제
- [ ] 🟡 **Day 6-3 — Web Share API** — ExportStep에 "공유하기" 버튼 → `navigator.share({ files: [mp4File] })`. 미지원 브라우저는 안내 메시지
- [ ] 🔴 **Day 6-4 — [Stretch] YouTube OAuth** — Google Cloud 콘솔에서 프로젝트 + OAuth 동의(테스트 모드, 본인 계정만) + YouTube Data API v3 enable. `googleapis`로 `/api/youtube/auth`, `/api/youtube/callback`, `/api/youtube/upload` 구현. 토큰은 메모리 또는 jobs 테이블 컬럼에 임시 저장
  - ⚠️ 미완성 시: v2 이월. MVP는 MP4 다운로드 + Web Share만으로도 통과
- 📌 **체크포인트 (Day 6 끝)**: 자동 삭제 cron 동작, 캐릭터 5×3=15장, Web Share 동작, (선택) 유튜브 업로드. `git commit -m "day6: cron + 15 characters + share"`

### Phase 4: 마무리 & 배포

- [ ] 🟡 **Day 7-1 — End-to-end 본인 테스트** — 본인이 본인 아기 영상으로 처음부터 끝까지 1회 성공 (MVP 성공 정의)
- [ ] 🟡 **Day 7-2 — 동의 체크박스 + "1시간 후 삭제" 안내 표기** — UploadStep에 명시
- [ ] 🟡 **Day 7-3 — 에러 처리** — AssemblyAI 실패, ffmpeg 실패, 5분 초과 영상, 지원 안 되는 포맷 등
- [ ] 🟡 **Day 7-4 — README** — 실행 방법, 환경 변수, 캐릭터 출처/라이센스 명시
- [ ] 🟡 **Day 7-5 — 배포** — 1차: 로컬 시연. 2차(시간 남으면): Vercel 또는 Render. ffmpeg 바이너리 제약 확인 필요
- [ ] 🟡 **Day 7-6 — PWA 화** — `public/manifest.json` (name="Soft Studio", short_name, icons 192/512, display: standalone, theme_color, background_color), `public/sw.js` (간단한 cache-first), `index.html`에 `<link rel="manifest">`, `<meta name="apple-mobile-web-app-capable" content="yes">`, `<meta name="apple-mobile-web-app-status-bar-style" content="default">`, `<link rel="apple-touch-icon" href="/public/icons/apple-touch-icon.png">`. iPhone Safari에서 "홈 화면에 추가" → 앱처럼 풀스크린 실행 검증.
- [ ] 🟡 **Day 7-7 — 가족 단톡방·SNS에 결과물 1회 공유** — MVP 성공 정의의 마지막 항목
- 📌 **체크포인트 (Day 7 끝)**: MVP 성공 정의 6개 항목 모두 충족 + iPhone에서 PWA 설치 후 앱처럼 사용 가능. `git commit -m "day7: e2e + pwa + readme + deploy"`

---

## 외부 설정 필요 항목

### 필수 (Must Have)

| 항목 | 설명 | 획득 방법 |
|------|------|----------|
| `ASSEMBLYAI_API_KEY` | 발화자 구분 + 한국어 transcription | https://www.assemblyai.com/ 가입 → Dashboard → API Keys → 무료 크레딧 $50 자동 지급. 카드 등록 없이 시작 가능 |
| `DATABASE_URL` | Supabase Postgres (Week-5 공유) | 메모리의 connection string 재사용. password URL-encoding 주의: `++bvni!/3giQ3?!` → `%2B%2Bbvni%21%2F3giQ3%3F%21`. 사용 전 한 번 `psql`로 연결 검증 권장 |
| `baby_cartoon` 스키마 + `jobs` 테이블 | DB 메타데이터 저장소 | Day 2-2 SQL 실행 (아래 참조) |
| ffmpeg 로컬 설치 | 비디오 합성 바이너리 | `brew install ffmpeg` (macOS). `ffmpeg -version`으로 확인 |
| 한글 폰트 경로 | drawtext 자막용 | `/System/Library/Fonts/Supplemental/AppleGothic.ttf` 사용 또는 NotoSansKR.otf를 `public/fonts/`에 번들 |
| `PORT` | 개발 서버 포트 | 3007 권장 (Week-7 첫 프로젝트) |
| `BASE_URL` | OAuth 콜백, 다운로드 링크 | 로컬: `http://localhost:3007` |
| placeholder 캐릭터 3장 | Day 3-2 시작 자산 | unDraw / Storyset / Flaticon 무료에서 수집 → `public/characters/{dad,mom,baby}-1.png` |

### 선택 (Stretch — Day 6-4)

| 항목 | 설명 | 획득 방법 |
|------|------|----------|
| `GOOGLE_CLIENT_ID` | YouTube OAuth | https://console.cloud.google.com/ → 새 프로젝트 → APIs & Services → OAuth consent screen (External, Testing 모드, 본인 계정만 추가) → Credentials → OAuth 2.0 Client ID (Web application, redirect: `http://localhost:3007/api/youtube/callback`) |
| `GOOGLE_CLIENT_SECRET` | 위 동일 | OAuth Client ID 생성 시 함께 발급 |
| YouTube Data API v3 enable | 업로드 권한 | Google Cloud Console → APIs & Services → Library → YouTube Data API v3 → Enable |
| 캐릭터 12장 추가 (Day 6-2) | dad-2~5, mom-2~5, baby-2~5 | unDraw(MIT, attribution 불필요) 또는 Storyset(free with attribution) — 라이센스 README에 명시 |

### .env.example

```bash
# Supabase Postgres (Week-5 공유 DB, baby_cartoon 스키마)
DATABASE_URL=postgresql://postgres.scukjshdtiuegnrrsdna:%2B%2Bbvni%21%2F3giQ3%3F%21@aws-1-us-east-1.pooler.supabase.com:6543/postgres

# AssemblyAI (필수)
ASSEMBLYAI_API_KEY=

# 서버
PORT=3007
BASE_URL=http://localhost:3007

# YouTube OAuth (Stretch — Day 6-4. 없어도 MVP 동작)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3007/api/youtube/callback
```

### Day 2-2 SQL (baby_cartoon 스키마)

```sql
CREATE SCHEMA IF NOT EXISTS baby_cartoon;

CREATE TABLE IF NOT EXISTS baby_cartoon.jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_filename TEXT NOT NULL,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,         -- uploaded_at + 1 hour
  status          TEXT NOT NULL DEFAULT 'uploaded',  -- uploaded | transcribing | labeled | rendering | done | expired | failed
  segments        JSONB,                         -- AssemblyAI 결과 [{ start, end, text, speaker }]
  role_mapping    JSONB,                         -- { "A": "dad", "B": "baby", "C": "mom" }
  character_mapping JSONB,                       -- { "dad": "dad-3", "mom": "mom-2", "baby": "baby-1" }
  upload_path     TEXT,                          -- ./uploads/{id}.ext
  output_path     TEXT,                          -- ./outputs/{id}.mp4
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_expires_at ON baby_cartoon.jobs(expires_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status     ON baby_cartoon.jobs(status);
```

---

## 시작하기

```bash
# 0. 디렉토리 이동
cd /Users/craw/afm-2th-weekday/Week-7/my-project

# 1. ffmpeg 설치 확인
ffmpeg -version || brew install ffmpeg

# 2. (Day 1) prototype-v1.html 만들기 — 서버 없이 브라우저에서 더블클릭으로 열기
#    → single-react-dev 에이전트 호출

# 3. (Day 2-1) 프로젝트 초기화
npm init -y
npm install express pg multer dotenv node-cron fluent-ffmpeg axios googleapis
cp .env.example .env
# → .env 채우기 (ASSEMBLYAI_API_KEY, DATABASE_URL)

# 4. (Day 2-2) DB 스키마 생성
psql "$DATABASE_URL" -f schema.sql
# 또는 Supabase 대시보드 SQL Editor에 위 SQL 붙여넣기

# 5. (Day 2-3 이후) 서버 실행
node server.js
# → http://localhost:3007 접속
```

### 에이전트 호출 가이드

- 프론트엔드 작업 (`index.html`): `single-react-dev` 에이전트 사용
- 서버 작업 (`server.js`): `single-server-specialist` 에이전트 사용
- 배포 작업 (Vercel): `vercel-deploy-optimizer` 에이전트 사용
- 두 파일이 동시에 영향받는 작업(예: 새 API 추가)은 두 에이전트 순차 호출

### Day별 끝 체크리스트

매 Day 끝에 다음 3가지 확인 후 commit:
1. ✅ 그 Day의 체크포인트 동작 확인
2. ✅ `git status`로 의도치 않은 파일 staging 안 됐는지 확인 (`uploads/`, `outputs/`, `.env` 절대 commit 금지)
3. ✅ `git commit -m "dayN: ..."` — 다음 Day에서 막히면 여기로 롤백 가능
