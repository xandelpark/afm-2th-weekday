# 데일리테니스 자세분석 앱 — DEV.md

> 매장 PC + 고객 폰 QR 업로드 기반 셀프 코칭 앱.
> Architecture: **옵션 1 — Single-File Architecture (CDN React + Express server.js)**

---

## 0. 프로젝트 스펙 요약 (MISSION.md 압축)

### Requirements (V1)
- [ ] 회원가입/로그인 (이메일/비번 + 손잡이 1회 선택)
- [ ] 비회원도 분석 가능 (결과 저장 시점에 가입 유도)
- [ ] PC 화면 QR → 폰으로 영상 업로드 (30초 이내)
- [ ] 30초 영상에서 모든 스윙 자동 분리 (포핸드/백핸드 혼합 OK)
- [ ] 포/백 자동 분류
- [ ] 6축 룰베이스 채점 (준비/백스윙/체중이동/회전타이밍/임팩트/팔로우스루)
- [ ] 종합 점수 0~100 + 6축 별점 5단계
- [ ] 슬로모션 리플레이 + 스켈레톤 오버레이
- [ ] SNS용 결과 영상 다운로드
- [ ] 회원 히스토리 누적 (마이페이지 카드 리스트)

### Non-goals (V2 이후)
- 서브, 발리 분석
- 라켓/공 추적, 임팩트 정확도
- 한 달 전 대비 변화 그래프
- 코치 코멘트 첨부
- 스윙별 카드형 상세 뷰
- 자동 임팩트 검출 (사용자가 폰에서 직접 30초 컷으로 우회)

### Style
- 한국어 UI, 친근한 매장 톤 ("나 78점 받음!" SNS 친화적)
- 모바일 업로드 페이지: 단순/큼직한 버튼 (할머니도 누를 수 있을 정도)
- PC 결과 화면: 위닝일레븐 능력치 카드 느낌 (육각형 + 큰 점수)
- 색상: 테니스 코트 그린 + 화이트 + 액센트 옐로우

### Key Concepts
- **세션(Session)**: PC가 QR 띄울 때 발급하는 UUID. 폰 업로드 ↔ PC 폴링이 같은 UUID로 매칭.
- **스윙(Swing)**: 손목 속도 피크 1개 = 스윙 1개. ±0.5초 윈도우로 잘라냄.
- **6축**: 시간순 흐름형 (준비→백스윙→체중이동→회전타이밍→임팩트→팔로우스루)
- **룰북(Rulebook)**: 포핸드/백핸드별 가중치 JSON. 운영하면서 코치들과 보정.
- **임팩트 시점**: 손목 속도 정점으로 근사 (라켓 추적 없이).

### Open Questions
- Supabase 같은 프로젝트(Week-5/6/7 공유)에 새 스키마(`tennis`)로 추가할지, 별도 프로젝트로 분리할지
- 매장 운영 환경: 로컬 LAN(고정 IP) vs ngrok/Cloudflare Tunnel vs Vercel 배포 — Week 1에 결정
- 가중치 초기값 출처: 일반론 + 논문(Elliott 등) + 매장 코치 직관 중 어떤 비율
- 비회원 영상 보관 기간 (30분 세션 만료 후 즉시 삭제? 아니면 24시간?)

---

## 1. 아키텍처 결정 요약 (옵션 1)

**왜 옵션 1인가:**
- MVP라 빠른 셋업이 우선. CDN React + Express 단일 server.js면 즉시 시작 가능
- 매장 PC 1대에서만 굴러도 충분 (스케일 부담 X)
- Vercel 배포 시 server.js만 옮기면 됨 (확장 가능성 열어둠)
- 포즈 추정/슬로모션은 모두 **클라이언트(브라우저)**에서 처리 → 서버 부하 낮음

**서버 책임 (`server.js`):**
- 인증 (회원가입/로그인/JWT 발급)
- 세션 발급 + 폴링 응답
- 영상 multer 업로드 → 로컬 `uploads/` 저장
- 결과 저장/조회 (Supabase PostgreSQL)
- 정적 파일 서빙 (`index.html`, 업로드된 영상)

**클라이언트 책임 (`index.html` 단일 파일):**
- Hash routing: `#/` `#/login` `#/upload` `#/result/:id` `#/me`
- PC 화면 (메인): QR 표시 + 세션 폴링 + 분석 진행 + 결과 표시
- 모바일 업로드 페이지: 영상 선택 + 업로드 진행률
- MediaPipe Pose Landmarker 통합 (브라우저에서 직접 추론)
- Canvas 스켈레톤 오버레이 + 슬로모션 재생
- 6축 채점 함수 (룰북 모듈, 클라이언트에서 실행)

**개발 에이전트 분담:**
- `single-react-dev`: `index.html` 전담 (컴포넌트, 스타일, 포즈 추정 통합, 채점 로직). JS/CSS 파일 분리 절대 금지.
- `single-server-specialist`: `server.js` 전담 (Express 라우트, multer, JWT, pg).

---

## 2. 파일 구조

```
/Users/craw/afm-2th-weekday/Week-7/daily-tennis-coach/
├── index.html          # 프론트엔드 전체 (React + Tailwind CDN, 파일 분리 불가)
├── server.js           # Express 서버 (인증 + 업로드 + DB)
├── rulebook.json       # 6축 가중치 (포핸드/백핸드 별도)
├── package.json
├── package-lock.json
├── .env                # gitignore. DATABASE_URL, JWT_SECRET
├── .env.example        # 커밋용 템플릿
├── .gitignore
├── uploads/            # multer 임시 저장. gitignore.
│   └── {sessionId}.mp4
├── prototype-v1.html   # Week 1 초반에만 존재. 더미 데이터 UI 검증용 (이후 index.html로 통합)
├── MISSION.md
└── DEV.md
```

`index.html` 내부 구조 (`<script type="text/babel">` 한 블록):
1. React Hooks Destructuring
2. Design System (Button, Card, Modal, Spinner, ScoreBadge)
3. Common Components (Header, NavBar, ProtectedRoute)
4. **Pose Engine** (MediaPipe 초기화, 비디오→키포인트 시계열)
5. **Rulebook** (6축 채점 함수 6개 + 가중치)
6. **Swing Splitter** (손목 속도 피크 검출, 포/백 분류)
7. Page Components (HomePage, LoginPage, SignupPage, UploadPage, AnalyzingPage, ResultPage, MyPage)
8. App Component (라우터, 상태관리, JWT)
9. ReactDOM.render

---

## 3. 주요 의존성

### 서버 (`package.json`)
```json
{
  "dependencies": {
    "express": "^4.19.0",
    "multer": "^1.4.5-lts.1",
    "pg": "^8.11.0",
    "jsonwebtoken": "^9.0.2",
    "bcryptjs": "^2.4.3",
    "dotenv": "^16.4.0",
    "uuid": "^9.0.1",
    "cors": "^2.8.5"
  }
}
```

### 클라이언트 (CDN, `index.html` `<head>`)
- React 18: `https://unpkg.com/react@18/umd/react.development.js`
- ReactDOM 18: `https://unpkg.com/react-dom@18/umd/react-dom.development.js`
- Babel Standalone: `https://unpkg.com/@babel/standalone/babel.min.js`
- Tailwind: `https://cdn.tailwindcss.com`
- MediaPipe Tasks Vision: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/vision_bundle.mjs`
  - 모델: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task` (~5MB) 또는 `_full` (~15MB, 정확도↑)
- QR 생성: `https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js`

---

## 4. DB 스키마 (SQL)

> **스키마 분리**: Supabase 무료 플랜 한 프로젝트 안에 `tennis` 스키마로 격리. Week-5/6 앱들과 안 섞이게.

```sql
-- 1) 스키마 생성
CREATE SCHEMA IF NOT EXISTS tennis;

-- 2) users
CREATE TABLE tennis.users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  hand VARCHAR(10) NOT NULL CHECK (hand IN ('right', 'left')),
  display_name VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3) sessions (QR 업로드 세션. 비회원도 발급 가능)
CREATE TABLE tennis.sessions (
  id UUID PRIMARY KEY,
  status VARCHAR(20) DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'uploaded', 'analyzing', 'done', 'expired', 'failed')),
  video_path TEXT,
  hand VARCHAR(10) CHECK (hand IN ('right', 'left')),
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '30 minutes'
);

-- 4) results (분석 결과. 회원만 저장)
CREATE TABLE tennis.results (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES tennis.users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES tennis.sessions(id),
  total_score INTEGER NOT NULL,
  forehand_score INTEGER,
  backhand_score INTEGER,
  axis_scores JSONB NOT NULL,  -- {ready: 80, backswing: 65, weight: 72, kinetic: 88, impact: 70, follow: 75}
  swing_count INTEGER NOT NULL,
  forehand_count INTEGER DEFAULT 0,
  backhand_count INTEGER DEFAULT 0,
  video_url TEXT,
  thumbnail_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tennis_results_user ON tennis.results(user_id, created_at DESC);
CREATE INDEX idx_tennis_sessions_status ON tennis.sessions(status, expires_at);
```

`server.js`에서는 pg connection 시 `search_path = tennis, public` 설정.

---

## 5. API 명세

모든 응답은 JSON. 인증은 `Authorization: Bearer <JWT>` 헤더.

### 5.1 인증

#### `POST /api/auth/signup`
```jsonc
// Request
{ "email": "user@example.com", "password": "secret123", "hand": "right", "displayName": "민수" }
// Response 201
{ "token": "eyJ...", "user": { "id": 1, "email": "...", "hand": "right", "displayName": "민수" } }
// Response 400: { "error": "이미 가입된 이메일입니다" }
```

#### `POST /api/auth/login`
```jsonc
// Request
{ "email": "user@example.com", "password": "secret123" }
// Response 200
{ "token": "eyJ...", "user": { ... } }
// Response 401: { "error": "이메일 또는 비밀번호가 틀렸습니다" }
```

#### `GET /api/auth/me` (인증 필요)
```jsonc
// Response 200
{ "user": { "id": 1, "email": "...", "hand": "right", "displayName": "민수" } }
```

### 5.2 세션 (QR 업로드)

#### `POST /api/sessions` (비회원 OK)
```jsonc
// Request: 빈 바디 또는 { "hand": "right" }  (비회원 시 손잡이 즉석 입력)
// Response 201
{ "sessionId": "550e8400-e29b-41d4-a716-446655440000", "expiresAt": "2026-04-29T01:30:00Z" }
```

#### `GET /api/sessions/:id/status` (PC 폴링용)
```jsonc
// Response 200
{ "status": "waiting" }                       // QR 띄운 직후
{ "status": "uploaded", "videoUrl": "/uploads/550e...mp4" }  // 폰 업로드 완료
{ "status": "expired" }
```

#### `POST /api/sessions/:id/upload` (모바일에서)
```
Content-Type: multipart/form-data
field: video (file, max 100MB, mp4/mov)
```
```jsonc
// Response 200
{ "status": "uploaded", "videoUrl": "/uploads/550e...mp4" }
// 400: { "error": "영상이 30초를 초과합니다" } 또는 { "error": "지원하지 않는 형식입니다" }
```

### 5.3 결과

#### `POST /api/results` (인증 필요. 회원만 저장)
```jsonc
// Request
{
  "sessionId": "550e...",
  "totalScore": 78,
  "forehandScore": 82,
  "backhandScore": 73,
  "axisScores": { "ready": 80, "backswing": 65, "weight": 72, "kinetic": 88, "impact": 70, "follow": 75 },
  "swingCount": 12,
  "forehandCount": 7,
  "backhandCount": 5,
  "videoUrl": "/uploads/550e...mp4",
  "thumbnailUrl": "/uploads/thumb-550e.jpg"
}
// Response 201
{ "id": 42, "createdAt": "2026-04-29T01:35:00Z" }
```

#### `GET /api/results/me` (인증 필요)
```jsonc
// Response 200
{
  "results": [
    { "id": 42, "totalScore": 78, "forehandScore": 82, "backhandScore": 73,
      "axisScores": {...}, "swingCount": 12, "videoUrl": "...", "thumbnailUrl": "...",
      "createdAt": "2026-04-29T01:35:00Z" },
    ...
  ]
}
```

#### `GET /api/results/:id` (인증 필요. 본인 것만)
```jsonc
// Response 200: 위 결과 1건 전체
// Response 403: { "error": "권한이 없습니다" }
```

---

## 6. 8주 로드맵 (체크박스 TODO)

> 매주 끝날 때 git commit + 다음 주 시작 전 동작 확인. 실패하면 이전 commit으로 롤백 가능.

### Week 1 — 셋업 + 인증

**목표**: 회원가입/로그인이 되는 빈 껍데기 앱.

**산출물**: 로그인하면 holding-page 노출. DB에 user 1명 생성됨.

- [ ] 🟢 디자인/UI 프로토타입 — `prototype-v1.html` (더미 데이터, 모든 화면 와이어프레임. 서버 없이 브라우저 직접 열기)
- [ ] 🟢 프로젝트 디렉토리 셋업 (`package.json` init, `.gitignore`, `.env.example`, `uploads/.gitkeep`)
- [ ] 🟢 의존성 설치 (`express multer pg jsonwebtoken bcryptjs dotenv uuid cors`)
- [ ] 🟢 `server.js` 기본 골격 (Express, dotenv, pg pool, JWT 미들웨어, CORS, 정적 서빙)
- [ ] 🟡 Supabase에 `tennis` 스키마 + 3개 테이블 생성 (위 SQL 실행)
- [ ] 🟢 `index.html` 기본 골격 (React + Tailwind + Babel CDN, hash router, App 컴포넌트)
- [ ] 🟡 회원가입 API + UI (`POST /api/auth/signup`, 손잡이 라디오)
- [ ] 🟡 로그인 API + UI (`POST /api/auth/login`, JWT localStorage 저장)
- [ ] 🟢 보호 라우트 (`/api/auth/me` + ProtectedRoute 컴포넌트)
- 검증: 회원가입 → 로그아웃 → 로그인 → 마이페이지 진입까지 흐름 끊김 없음. DB에 row 확인.
- 잠재 리스크: Supabase URL의 특수문자 인코딩 누락. CORS preflight 빠뜨림.
- 📌 git commit
- 📌 체크포인트: 인증 플로우 통과. PC에서 hash routing 동작. uploads/ 폴더 mounted.

---

### Week 2 — QR 업로드 플로우

**목표**: 다른 폰에서 QR 스캔 → 영상 업로드 → PC 화면이 자동 다음 단계로.

**산출물**: PC와 폰이 영상 한 개를 주고받는 데모.

- [ ] 🟢 `POST /api/sessions` (UUID 발급, status='waiting')
- [ ] 🟡 PC 메인 화면 — 세션 발급 후 QR 표시 (qrcode-generator CDN). URL은 `http://<PC-IP>:3000/?session={uuid}#/upload`
- [ ] 🟡 `GET /api/sessions/:id/status` 폴링 훅 (1초 간격, 'uploaded' 되면 정지)
- [ ] 🟡 모바일 업로드 페이지 (`#/upload?session=xxx`) — `<input type="file" accept="video/*" capture>`, 30초 길이 검증 (HTMLVideoElement.duration)
- [ ] 🔴 `POST /api/sessions/:id/upload` multer 처리 + sessions 테이블 status 업데이트
- [ ] 🟡 업로드 진행률 UI (XHR upload progress)
- [ ] 🟢 업로드 완료 → PC가 폴링으로 감지 → 다음 화면으로 자동 전환
- 검증: PC에서 QR 띄우고 폰으로 스캔 → 영상 선택 → 업로드 → PC 화면이 "분석 중"으로 넘어감.
- 잠재 리스크: 매장 라우터에서 PC IP 변동. multer 100MB 제한, 폰 영상이 더 클 수 있음(설정 조정).
- 📌 git commit
- 📌 체크포인트: 다른 기기 간 영상 전송 동작. uploads/에 mp4 저장.

---

### Week 3 — 포즈 추정 통합 (가장 큰 리스크)

**목표**: 30초 영상에서 33 keypoints 시계열 데이터 추출 + 시각화.

**산출물**: 영상 위에 빨간 스켈레톤이 따라다니는 데모.

- [ ] 🔴 **PoC 먼저** — 빠른 스윙 영상 1~2개로 MediaPipe 정확도 사전 검증 (별도 HTML 파일에서 실험)
- [ ] 🟡 MediaPipe Tasks Vision 초기화 (`PoseLandmarker.createFromOptions`, RUNNING_MODE=VIDEO)
- [ ] 🔴 영상 → 프레임 추출 → `detectForVideo` 루프 → 시계열 배열 (`[{t, landmarks: [...33]}]`)
- [ ] 🟡 Canvas 오버레이 — `<canvas>` 영상 위에 절대위치, 매 프레임 스켈레톤 그리기 (어깨-팔꿈치-손목, 골반-무릎-발목)
- [ ] 🟡 분석 진행률 UI ("프레임 142/600 처리 중")
- [ ] 🟢 결과 데이터 메모리 보관 (이번 주는 console.log + 임시 화면)
- 검증: 30초 영상이 PC에서 30초~1분 안에 처리. 키포인트가 실제 사람 위에 잘 붙음.
- 잠재 리스크: **모션블러로 손목 키포인트 흔들림** → smoothing 필요할 수 있음. **8GB RAM 미만 매장 PC**는 OOM 위험. **모델 로딩 ~5MB CDN 다운로드** 매장 와이파이 느리면 첫 사용자 대기 김.
- ⚠️ 우회 방안: lite 모델(5MB)로 시작 → 정확도 부족하면 full 모델(15MB)로 교체. 매장 PC 사양 미리 확인.
- 📌 git commit
- 📌 체크포인트: 키포인트 시계열 1개 영상에서 추출 성공. 스켈레톤 시각화 OK.

---

### Week 4 — 스윙 분리 + 포/백 분류

**목표**: 30초 영상에서 스윙 N개를 자동으로 잘라내고 각각 포/백 라벨링.

**산출물**: "포핸드 7개, 백핸드 5개" 같은 정확한 카운트.

- [ ] 🔴 손목(wrist) 키포인트 시계열 → 속도 계산 (`Δposition / Δt`) → 1D smoothing
- [ ] 🔴 속도 피크 검출 (임계값 + minimum distance 조합)
- [ ] 🟡 각 피크마다 ±0.5초 윈도우(스윙 1개 = 프레임 30개)
- [ ] 🔴 포/백 자동 분류:
  - 라켓 든 손(유저 hand 정보 활용) wrist X좌표 변화 방향
  - 어깨 회전 방향 (left_shoulder vs right_shoulder X차이 변화)
  - 룰: 오른손 유저 → wrist X가 left→right이면 포핸드
- [ ] 🟢 분류 결과 디버그 UI (각 스윙 시작 시점 + 라벨)
- 검증: 코치 손수 라벨링한 영상 3개에서 분류 정확도 ≥ 90%.
- 잠재 리스크: **백스윙만 하다 끝나는 영상**은 분류 어려움. **연속 스윙 시 피크가 합쳐짐** (peak distance 튜닝 필요).
- ⚠️ 우회 방안: 분류 confidence 낮으면 "분류 불가" 라벨로 표시 + 점수에서 제외.
- 📌 git commit
- 📌 체크포인트: 매장 영상 3~5개에 대해 스윙 카운트가 코치 직관과 일치.

---

### Week 5 — 6축 채점 함수

**목표**: 스윙 1개 → 6축 점수 0~100 6개.

**산출물**: 좋은/나쁜 스윙 영상에서 점수 차이가 직관적으로 명확.

- [ ] 🟡 `rulebook.json` 작성 (포핸드/백핸드 별도 가중치 + 임계값)
- [ ] 🟡 `scoreReadyPosition(swingFrames, hand)` — 백스윙 시작 시 어깨/무릎/스탠스 각도
- [ ] 🟡 `scoreBackswingStability(swingFrames, hand)` — 정점에서 라켓팔 위치 + 어깨 회전 각도
- [ ] 🟡 `scoreWeightTransfer(swingFrames, hand)` — 골반 X좌표 이동 폭
- [ ] 🔴 `scoreKineticChainTiming(swingFrames, hand)` — 골반 회전 정점 → 어깨 정점 → 손목 정점 시간차
- [ ] 🟡 `scoreImpactPosture(swingFrames, hand)` — 손목 속도 정점 시점의 무릎 굴곡/척추 직립도/머리 위치
- [ ] 🟡 `scoreFollowThrough(swingFrames, hand)` — 임팩트 후 팔 궤적 + 종료 위치
- [ ] 🟢 종합 점수 = 6축 가중평균 (rulebook의 weights)
- [ ] 🟢 포핸드 평균 / 백핸드 평균 별도 계산
- 검증: 좋은 스윙 영상 평균 75+ / 나쁜 스윙 영상 평균 50- 차이가 명확.
- 잠재 리스크: **임팩트 시점이 손목 속도 정점이 아닐 수도** (라켓이 늦게 가속). **회전 타이밍 정의가 모호** → 코치와 상의 필요.
- 📌 git commit
- 📌 체크포인트: 모든 스윙에 6축 점수 부여 성공. 점수가 코치 직관과 ±20점 안에 들어감.

---

### Week 6 — 결과 화면 (육각형 + 슬로모션)

**목표**: SNS에 올리고 싶을 만한 결과 화면.

**산출물**: 종합 점수 + 육각형 + 슬로모션 한 화면 + 다운로드 버튼.

- [ ] 🟡 육각형 차트 (SVG 직접 — 6 vertex, 5단계 별점)
- [ ] 🟢 종합 점수 큰 숫자 표시 + 별점 컴포넌트
- [ ] 🟢 포핸드/백핸드 평균 점수 작게
- [ ] 🟡 슬로모션 리플레이 (`<video>` `playbackRate=0.25` + Canvas 스켈레톤 오버레이 동기화)
- [ ] 🔴 SNS 다운로드 버튼 — Canvas 합성 영상을 `MediaRecorder`로 녹화 → blob 다운로드
- [ ] 🟡 스윙별 클릭 시 해당 구간으로 시킹 (선택)
- 검증: 모바일 스크린샷 찍어봤을 때 "오 이거 인스타 올릴 만한데?" 톤.
- 잠재 리스크: **MediaRecorder 호환성** (Safari 부분 지원). **Canvas 합성 시 영상-스켈레톤 싱크 어긋남**.
- ⚠️ 우회 방안: 다운로드는 일단 원본+오버레이 GIF로 시작. MediaRecorder는 V1.1로.
- 📌 git commit
- 📌 체크포인트: 결과 화면이 SNS 친화적. 다운로드 1번이라도 동작.

---

### Week 7 — 결과 저장 + 가입 유도

**목표**: 비회원이 분석 → 저장 누르면 자연스레 가입 → 자동 저장.

**산출물**: 마이페이지에 과거 기록이 카드로 쌓임.

- [ ] 🟡 `POST /api/results` (인증 필요)
- [ ] 🟡 비회원 결과 화면에 "저장하시려면 가입하세요" 모달
- [ ] 🟡 모달 → 가입 폼 (현재 결과를 sessionStorage에 임시 저장) → 가입 후 자동으로 /api/results POST
- [ ] 🟢 `GET /api/results/me`
- [ ] 🟡 마이페이지 카드 리스트 (썸네일 + 종합 점수 + 날짜)
- [ ] 🟢 카드 클릭 시 `GET /api/results/:id` → 결과 화면 재현
- 검증: 비회원 분석 → 저장 시도 → 가입 → 마이페이지에 방금 결과 떠있음.
- 잠재 리스크: 가입 도중 결과 데이터 휘발 (새로고침 등) → sessionStorage 백업 필수.
- 📌 git commit
- 📌 체크포인트: 비회원→회원 전환 시 결과 누락 0%. 마이페이지 동작.

---

### Week 8 — 매장 실사용 테스트 + 룰북 보정

**목표**: 매장 실사용 5~10명 + 코치 피드백으로 룰북 v1.1.

**산출물**: 가중치 조정된 `rulebook.json`. 매장 운영 시작.

- [ ] 🟡 매장 PC에 배포 (Vercel or 로컬 LAN, 위 결정사항)
- [ ] 🟡 카메라 거치대 + 안내 포스터 1장 비치
- [ ] 🟡 5~10명 실사용 (코치 옆에서 직접 관찰)
- [ ] 🟡 각 축 점수 vs 코치 직관 점수 비교 시트 작성
- [ ] 🔴 가중치 보정 (`rulebook.json` 업데이트, 예: 회전타이밍 비중 ↑, 백스윙 안정성 비중 ↓)
- [ ] 🟢 버그 패치 (Week 1~7에서 누락된 엣지케이스)
- [ ] 🟢 매장 운영 메뉴얼 1페이지 (코치용)
- 검증: 코치 직관 점수와 앱 점수 평균 오차 ±15점 이내.
- 📌 git commit + tag `v1.0`
- 📌 체크포인트: 매장에서 손님이 셀프 사용 가능. SNS 콘텐츠 1개라도 발행.

---

## 7. 외부 설정 체크리스트

> 코드로 안 풀리는 것들. 사용자가 직접 해야 함.

### 필수 (Must Have)

| 항목 | 설명 | 획득 방법 |
|------|------|----------|
| `DATABASE_URL` | Supabase pooler 연결 URL | 이미 보유 (`supabase_db.md` 참조). `tennis` 스키마 추가만 하면 됨 |
| `JWT_SECRET` | JWT 서명 키 | `openssl rand -hex 32` 로 생성, `.env`에 저장 |
| 카메라 거치대 | 측면 촬영용 삼각대 또는 펜스 클립 | 매장에 1개 비치. 거리 가이드 3m |
| 매장 PC 사양 | RAM 8GB+ 권장, Chrome/Edge 최신 | 기존 PC 사양 확인 → 부족하면 업그레이드 |
| 테스트 영상 | 좋은/나쁜/혼합 스윙 각 5~10개 | Week 1~2 동안 매장에서 직접 촬영해 둘 것 |

### 매장 네트워크 (Week 1에 1택 결정)

| 옵션 | 장점 | 단점 |
|------|------|------|
| **A. 로컬 LAN** (`http://192.168.x.x:3000`) | 빠름, 외부 네트워크 무관 | 매장 PC 고정 IP 설정 필요. 폰이 매장 와이파이여야 함 |
| **B. ngrok / Cloudflare Tunnel** | 외부에서도 접근 가능 | 무료는 URL 매번 바뀜. 매장 와이파이 느리면 업로드 답답 |
| **C. Vercel 배포 + 도메인** | 가장 안정. 모바일 데이터로도 OK | uploads/ 디렉토리 사용 불가 → S3 또는 Supabase Storage 필요 |

**추천**: 매장 라우터에 PC 고정 IP 할당 + QR에 해당 IP 인코딩 (옵션 A). 운영 안정되면 옵션 C 마이그레이션.

### 선택 (Nice to Have)

| 항목 | 설명 |
|------|------|
| MediaPipe 모델 self-host | 매장 와이파이 느리면 `pose_landmarker_lite.task` 다운받아 서버에서 서빙 |
| 매장 안내 포스터 | "여기 서서 측면으로 30초만!" + QR 위치 안내 |
| 카카오 로그인 (V2) | 가입 마찰 ↓ |

### `.env.example` 템플릿

```bash
# Supabase (Week-5/6/7 공유 프로젝트, tennis 스키마)
DATABASE_URL=postgresql://postgres.scukjshdtiuegnrrsdna:%2B%2Bbvni%21%2F3giQ3%3F%21@aws-1-us-east-1.pooler.supabase.com:6543/postgres

# JWT
JWT_SECRET=your-random-hex-string-here

# Server
PORT=3000
NODE_ENV=development

# Upload
MAX_UPLOAD_MB=100
UPLOAD_DIR=./uploads
```

---

## 8. 위험 요소 & PoC 검증 항목

### Week 3 시작 전 PoC 필수 (가장 큰 불확실성)

| 항목 | 검증 방법 | 실패 시 대응 |
|------|-----------|--------------|
| **포즈 추정 정확도** | 빠른 스윙 영상 2개에 MediaPipe 돌려보기. 손목/어깨가 따라오는지 눈으로 확인 | full 모델로 교체. 그래도 안 되면 MoveNet 검토 |
| **손목 속도 피크 = 임팩트?** | 코치와 영상 보며 정점 프레임 합의 | 라켓팔 elbow 속도 정점 + wrist 속도 정점 평균으로 변경 |
| **30초 영상 처리 시간** | 매장 PC 사양에서 1번 돌려보기 | 1분 넘으면 lite 모델 + 프레임 다운샘플링 (15fps) |
| **포/백 자동 분류 정확도** | 혼합 영상 3개에서 손수 라벨 vs 자동 라벨 비교 | 분류 confidence 표시 + 사용자가 수동 보정 가능하게 |

### 일반 리스크

- **WebCodecs / MediaRecorder 호환성**: Safari 일부 미지원 → 매장 PC는 Chrome/Edge 권장 안내
- **모션블러**: 폰 셔터스피드 낮으면 손목 키포인트 흔들림 → smoothing 필터 필수
- **여러 사람 등장**: 매장 코트 옆에 다른 사람 있을 때 잘못 탐지 → 첫 프레임에서 ROI 박스 잡고 그 안의 사람만 추적
- **첫 사용자 모델 다운로드 시간**: ~5MB 모델 첫 로드 시 5초~30초 → 로딩 화면 친절하게

---

## 9. 매장 운영 가이드 (V1 출시 후)

### 매장 비치
- 매장 PC 옆에 안내 포스터 1장: "30초 영상 찍고 와서 QR 스캔!"
- 카메라 거치대 위치 표시 테이프 (3m 지점)

### 코치 동선
- 신규 손님 → 코치가 1번 시범 → 손님 혼자 사용
- 결과 화면 같이 보면서 약점 1개만 짚어주기 (코치 시간 5분)
- SNS 콘텐츠 발행 동의 받기 (다운로드 받은 영상 → 매장 인스타)

### 운영 회고 루프 (월 1회)
- 가중치 보정: `rulebook.json` 업데이트
- 신규 케이스 수집 (분류 실패한 영상 별도 보관)
- 코치 직관 vs 앱 점수 비교 시트 갱신

### 데이터 보관 정책
- 비회원 영상: 세션 만료(30분) 후 cron으로 삭제
- 회원 영상: `uploads/` 90일 보관 후 archive 또는 삭제 (V1.1에 결정)

---

## 10. 시작하기

```bash
cd /Users/craw/afm-2th-weekday/Week-7/daily-tennis-coach

# Week 1 시작
npm init -y
npm install express multer pg jsonwebtoken bcryptjs dotenv uuid cors

# .env 생성
cp .env.example .env
# .env 수정 (JWT_SECRET 랜덤값 넣기)

# Supabase에 스키마 생성 (위 SQL 실행)

# 서버 시작
node server.js

# 브라우저에서 http://localhost:3000
```

### Week 1 첫 커밋 메시지 예시
```
Week 1: 데일리테니스 자세분석 앱 셋업 + 인증

- Express + Supabase tennis 스키마 + JWT 인증
- React 18 CDN + Tailwind + hash routing
- 회원가입/로그인 API + UI (손잡이 선택 포함)
```

---

## 부록 A — `rulebook.json` 초기 템플릿

```json
{
  "forehand": {
    "weights": { "ready": 0.10, "backswing": 0.15, "weight": 0.20, "kinetic": 0.25, "impact": 0.20, "follow": 0.10 },
    "thresholds": {
      "weightTransferMinPx": 30,
      "kineticTimingIdealMs": 80,
      "impactKneeFlexionDeg": [120, 160]
    }
  },
  "backhand": {
    "weights": { "ready": 0.10, "backswing": 0.20, "weight": 0.15, "kinetic": 0.25, "impact": 0.20, "follow": 0.10 },
    "thresholds": {
      "weightTransferMinPx": 25,
      "kineticTimingIdealMs": 90,
      "impactKneeFlexionDeg": [115, 155]
    }
  }
}
```

이 가중치는 일반론 기반 추측. Week 8 매장 데이터로 보정한다.
