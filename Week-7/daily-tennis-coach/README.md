# 데일리테니스 자세분석 앱 (매장 PC 로컬 운영판)

매장 PC에 영상 분석 화면을 띄우고, 손님 폰이 매장 와이파이에서 QR을 스캔해 영상을 업로드 → MediaPipe 분석 → 9:16 인스타 릴스 결과 카드를 다운로드까지 가져가는 풀스택 mini 앱.

> **클라우드 의존성 없음.** PC에서 `node server.js` 한 줄로 끝. DB도 클라우드 스토리지도 안 쓴다. PC 재시작하면 세션은 모두 초기화 — 의도된 동작이다.

## 아키텍처

```
[손님 폰]                                    [매장 PC]
   │ 1. QR 스캔                                  │ 0. 지속형 QR 표시
   │    /upload?token=...                        │    (store-token, 2일 회전)
   ▼                                             │
 모바일 업로드 페이지                            │
   │  POST /api/sessions { token } → sessionId
   │  POST /api/sessions/:id/upload (multipart) → uploads/<id>.<ext>
   │
   │ 2. 폴링                                    ▼
   │                              GET /api/queue/next  (uploaded → analyzing 전이)
   │                              ─ PC 브라우저가 영상 fetch
   │                              ─ MediaPipe로 자세 분석
   │                              ─ Canvas + MediaRecorder로 9:16 합성
   │                              POST /api/sessions/:id/result-video (multipart, webm)
   │                              ─ 서버에서 ffmpeg가 webm → mp4 → mov 변환 (60s timeout)
   │                              POST /api/sessions/:id/complete
   ▼
 GET /d/:id 페이지 (.mov 다운로드 + Files→Photos 가이드)
 GET /d/:id/raw  (Content-Disposition: attachment 강제 다운로드)
```

- **Frontend**: `public/index.html` 단일 파일 (CDN React + Tailwind + MediaPipe)
- **Backend**: `server.js` 단일 파일 (Express + multer + ffmpeg)
- **Storage**: 로컬 디스크 `uploads/`
- **Metadata**: in-memory `Map<sessionId, Session>` — PC 재시작 시 사라짐

## 설치

### macOS

```bash
# Node.js (>= 18)
brew install node

# ffmpeg (webm → mp4 / mov 변환에 필요. 없어도 webm 원본은 동작)
brew install ffmpeg

# 의존성
cd Week-7/daily-tennis-coach
npm install
```

### Windows — 1-클릭 실행 (권장)

매장 PC 처음 셋업이라면 이 방법이 가장 빠르다.

1. 이 레포를 다운로드 (둘 중 하나)
   - GitHub에서 ZIP 다운로드 → 압축 해제
   - 또는 `git clone https://github.com/xandelpark/afm-2th-weekday.git`
2. `Week-7\daily-tennis-coach\` 폴더 진입
3. **`start.bat` 더블클릭**

`start.bat`이 다음을 자동으로 처리한다:
- PowerShell 실행정책(ExecutionPolicy) 우회
- `start-store.ps1` 호출 → winget으로 **Node.js / ffmpeg / cloudflared** 자동 설치
- `npm install` (최초 1회)
- 서버(포트 3000) + Cloudflare Quick Tunnel 별도 창에서 시작
- 매장 모니터용 공개 URL을 기본 브라우저로 자동 오픈

**첫 실행 시 한 번만 뜨는 팝업:**
- Windows Defender 방화벽 → "사설 네트워크 액세스 허용" 체크
- winget 약관 동의 (Microsoft Store 첫 사용 시)

**요구사항:** Windows 10 1809+ / Windows 11 (winget 내장). 인터넷 연결 필수.

### Windows — 수동 설치 (스크립트가 막힐 때 폴백)

1. Node.js LTS 설치: <https://nodejs.org/>
2. ffmpeg 설치: <https://www.gyan.dev/ffmpeg/builds/> 의 "release essentials" 다운로드 → 압축 풀고 `ffmpeg.exe`가 들어있는 `bin` 폴더를 시스템 PATH에 추가
3. 프로젝트 폴더에서 `npm install`
4. `node server.js`

ffmpeg가 PATH에 없으면 `.env`에 절대 경로를 지정:

```
FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
```

## 실행

```bash
node server.js
# 또는 개발 모드 (코드 저장 시 자동 재시작)
npm run dev
```

시작 로그 예시:

```
📡 데일리테니스 서버 시작
   로컬:    http://localhost:3000
   매장 LAN: http://192.168.0.42:3000  (모바일은 이 주소)
   업로드 디렉토리: /Users/.../daily-tennis-coach/uploads

🎬 ffmpeg 사용 가능 (8.0.1) — webm→mp4→mov 자동 변환 활성

🎟️  Store Token: 9f3a1d2c7b6e5f04
   만료: 2026. 5. 1. 오후 10:48:00 (2일 후)
   QR URL: http://192.168.0.42:3000/upload?token=9f3a1d2c7b6e5f04
```

매장 모니터 브라우저에서 `http://localhost:3000` 열면 PC 메인 화면(QR + 안내 카드)이 뜬다. 손님은 폰 카메라로 모니터의 QR을 찍으면 자동으로 업로드 페이지로 이동한다.

## LAN IP는 어떻게 결정되는가

서버가 시작될 때 `os.networkInterfaces()`로 PC의 사설 IP를 자동 탐지한다 (`192.168.x.x`, `10.x.x.x`, `172.16~31.x.x` 우선). 매장 모니터에 표시되는 QR도, `/api/store-token`이 알려주는 `qrUrl`도, 모두 이 LAN IP를 쓴다.

> 모바일이 PC에 접속하려면 **같은 와이파이**여야 한다. 매장 게스트 와이파이에 클라이언트 격리(AP isolation)가 켜져 있으면 폰이 PC IP로 접근하지 못하는 경우가 있으니, 격리를 해제하거나 같은 SSID를 쓰자.

## 환경변수 (.env)

전부 선택사항.

| 이름 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | HTTP 포트 |
| `STORE_TOKEN_TTL_DAYS` | `2` | 매장 QR 토큰 회전 주기 (일) |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg 실행 경로. 시스템 PATH에 있으면 그대로 |

`.env.example`을 복사해 시작:

```bash
cp .env.example .env
```

## 자주 발생하는 문제

### 폰이 PC에 접속이 안 됨 (`사이트에 연결할 수 없음`)

1. **같은 와이파이**인지 확인. 매장 손님용/직원용이 분리돼 있으면 둘 중 하나로 통일.
2. **PC 방화벽**이 3000번 포트를 막고 있는지 확인.
   - macOS: 시스템 설정 → 네트워크 → 방화벽 → 옵션 → `node` 허용
   - Windows: 첫 실행 시 뜨는 방화벽 팝업에서 "사설 네트워크 액세스 허용" 체크
3. **클라이언트 격리(AP isolation)**가 와이파이 라우터에서 켜져 있는지 확인. 매장 라우터 관리 페이지에서 끈다.
4. PC IP가 바뀌었을 수 있음 → 서버 재시작하면 새 IP로 QR이 갱신된다.

### PC IP가 자주 바뀐다

DHCP 임대 만료/재연결로 LAN IP가 바뀌면 매장 모니터의 QR도 무효가 된다. 라우터에서 PC MAC 주소에 **고정 IP 할당**(DHCP reservation)을 해두자. 한 번만 설정하면 끝.

### ffmpeg가 없는데 결과 영상이 다운로드되긴 함

ffmpeg가 없거나 변환에 실패하면 webm 원본이 그대로 저장된다. 폰에서 webm은 사진앱 직접 저장이 안 되지만 Files 앱으로는 저장 가능. 매장 운영 시에는 꼭 ffmpeg를 설치하길 권장.

### 업로드 후 PC 화면이 분석 안 함

`/api/queue/next`는 1초마다 폴링한다. PC 메인 화면의 우측 큐 카운트를 확인. `uploaded` 상태로 떠 있는데 픽업되지 않으면 PC 브라우저가 이 페이지를 떠난 것 — 다시 `/`로 돌아오면 큐를 비우기 시작한다.

### 디버그 로그 박스가 보고 싶음

URL에 `?debug=1`을 붙여 접속하면 화면 하단에 console 로그가 실시간으로 뜬다 (`http://localhost:3000/?debug=1`).

## 외부 시연 — Cloudflare Tunnel

매장 와이파이가 아닌 외부에서 데모해야 할 때.

```bash
# 1) cloudflared 설치 (한번만)
brew install cloudflared        # macOS
# Windows는 https://github.com/cloudflare/cloudflared/releases 에서 binary 받아 PATH에 추가

# 2) 서버를 띄운 상태에서 다른 터미널로
cloudflared tunnel --url http://localhost:3000

# 3) 출력되는 https://<random>.trycloudflare.com 가 외부에서 접근 가능한 주소
```

서버는 `Host` 헤더를 보고 외부 host(예: `*.trycloudflare.com`)일 때는 LAN IP 치환을 안 하고 그대로 쓴다. 그래서 `/api/store-token`이 알려주는 QR URL도 자동으로 cloudflared 도메인이 박힌다.

## 폴더 구조

```
daily-tennis-coach/
├── server.js               # Express 서버 (단일 파일)
├── package.json
├── .env.example
├── start.bat               # Windows 1-클릭 진입점 (start-store.ps1 호출)
├── start-store.ps1         # Windows 자동 셋업 + 실행 스크립트
├── public/
│   ├── index.html          # PC 메인 + 모바일 업로드 + 분석 화면 (단일 페이지)
│   ├── demo.html           # PoC 데모 (참고용)
│   └── sample-pro-forehand.mp4
├── uploads/                # 업로드된 영상 + 변환된 mp4/mov (1시간 후 자동 정리)
└── README.md
```

## 주요 API

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/api/store-token` | 매장 QR 만들 때 토큰 + qrUrl 반환 |
| `POST` | `/api/sessions` | 모바일이 토큰 검증 후 세션 생성 |
| `POST` | `/api/sessions/:id/upload` | 모바일 영상 업로드 (multipart) |
| `GET` | `/api/sessions/:id/status` | 모바일 상태 폴링 |
| `GET` | `/api/queue/next` | PC 큐 폴링 (uploaded → analyzing 전이) |
| `POST` | `/api/sessions/:id/complete` | PC 분석 완료 보고 |
| `POST` | `/api/sessions/:id/skip` | PC 분석 실패 보고 |
| `POST` | `/api/sessions/:id/result-video` | PC 합성 영상 업로드 (multipart, webm) |
| `GET` | `/d/:id` | 모바일 다운로드 안내 페이지 |
| `GET` | `/d/:id/raw` | 강제 다운로드 (Content-Disposition: attachment) |
| `GET` | `/uploads/<filename>` | 정적 파일 (PC가 영상 fetch 시 사용) |
