# React 디자인 시스템 / UI 컴포넌트 라이브러리 조사

## 한눈에 비교

| 라이브러리 | GitHub Stars | CDN 사용 | 특징 |
|---|---|---|---|
| **MUI (Material UI)** | ~97k | 제한적 | Google Material Design, 가장 많은 다운로드 |
| **Ant Design** | ~97k | O | 알리바바, 엔터프라이즈급 60+ 컴포넌트 |
| **shadcn/ui** | ~83k | X | 소스코드 복사 방식, Tailwind + Radix 기반 |
| **Chakra UI** | ~40k | X | 접근성 우선, 직관적 스타일 props |
| **react-bits** | ~35k | X | 애니메이션/인터랙션 효과 특화 |
| **Mantine** | ~30k | X | 120+ 컴포넌트, 2026년 가장 빠른 성장세 |
| **HeroUI (구 NextUI)** | ~28k | X | Tailwind 기반, 아름다운 기본 디자인 |
| **Headless UI** | ~28k | X | Tailwind 팀 제작, 스타일 없는 접근성 컴포넌트 |
| **React Bootstrap** | ~22.6k | O (최적) | Bootstrap 5 React 버전, CDN 사용 최적 |
| **Blueprint** | ~21.6k | X | Palantir, 데이터 밀집 데스크톱 앱 특화 |
| **Radix UI** | ~20k | X | 스타일 없는 접근성 프리미티브 (shadcn 기반) |
| **Fluent UI** | ~20k | X | Microsoft 디자인 시스템 |
| **Semi Design** | ~9.4k | O | TikTok/Douyin 팀, 3000+ 디자인 토큰 |
| **PrimeReact** | ~8.3k | O | 80+ 컴포넌트, 간트차트 등 희귀 컴포넌트 |
| **Arco Design** | ~5.5k | O | ByteDance, 60+ 컴포넌트 |

---

## 상세 정보

### 1. MUI (Material UI)

- **사이트**: https://mui.com/
- **설치**: `npm install @mui/material @emotion/react @emotion/styled`
- **CDN**: 프로토타이핑용 UMD 빌드 존재 (프로덕션 비권장)
- **특징**:
  - Google Material Design 구현
  - npm 주간 450만+ 다운로드 (1위)
  - MUI X로 DataGrid, DatePicker, Charts 등 고급 컴포넌트 확장
  - 강력한 테마 시스템, 다크모드 지원
- **적합한 프로젝트**: 엔터프라이즈 대시보드, 관리자 패널, SaaS 제품

---

### 2. Ant Design

- **사이트**: https://ant.design/
- **설치**: `npm install antd`
- **CDN**: O (`antd.min.js`, `antd.min.css` unpkg/cdnjs/jsdelivr)
- **특징**:
  - 알리바바 Ant Group의 엔터프라이즈급 디자인 시스템
  - 60+ 고품질 컴포넌트
  - 다국어(i18n), RTL 레이아웃 지원
  - Ant Design Pro로 풀 어드민 솔루션 제공
  - TypeScript 우선
- **적합한 프로젝트**: 대규모 엔터프라이즈 시스템, CRM, CMS, 관리자 패널

---

### 3. shadcn/ui

- **사이트**: https://ui.shadcn.com/
- **설치**: `npx shadcn@latest init` → `npx shadcn@latest add button`
- **CDN**: X (소스코드 복사 방식이라 CDN 불가)
- **특징**:
  - 라이브러리가 아닌 "코드 배포 플랫폼" — 소스코드를 프로젝트에 복사
  - Radix UI(접근성) + Tailwind CSS 기반
  - 0KB 런타임 오버헤드
  - Vercel의 v0.dev에서 자연어로 컴포넌트 생성 가능
  - Vercel, Supabase 등 프로덕션 사용
- **적합한 프로젝트**: Tailwind 사용 팀, 컴포넌트 코드 완전 소유/커스터마이징 필요 시

---

### 4. Chakra UI

- **사이트**: https://chakra-ui.com/
- **설치**: `npm install @chakra-ui/react`
- **CDN**: X
- **특징**:
  - 접근성(WAI-ARIA) 우선 설계
  - 직관적 스타일 props (`bg="blue.500"`, `px={4}`)
  - v3에서 Panda CSS 아키텍처로 재작성
  - 주간 70만+ 다운로드
- **적합한 프로젝트**: 빠른 프로토타이핑, MVP 개발, 접근성 중시 프로젝트

---

### 5. Mantine

- **사이트**: https://mantine.dev/
- **설치**: `npm install @mantine/core @mantine/hooks`
- **CDN**: X (100+ 컴포넌트로 2~3MB 번들 — 메인테이너가 CDN 비권장)
- **특징**:
  - 120+ 컴포넌트 + 50+ 커스텀 훅
  - 폼 관리, 알림, 모달, 날짜 선택 등 올인원
  - 2025~2026년 가장 빠른 성장세 (주간 135만+ 다운로드)
  - React Server Components 호환성 최고
  - v9.0에서 일정 관리 컴포넌트 추가
- **적합한 프로젝트**: 2026년 신규 프로젝트의 "모멘텀 픽", 올인원 솔루션이 필요할 때

---

### 6. HeroUI (구 NextUI)

- **사이트**: https://heroui.com/
- **설치**: `npm install @heroui/react`
- **CDN**: X
- **특징**:
  - 2025년 1월 NextUI에서 리브랜딩 (Next.js 외 전체 React 생태계 확장)
  - Tailwind CSS + React Aria 기반
  - Framer Motion 애니메이션
  - 아름다운 기본 디자인, 다크모드
- **적합한 프로젝트**: 시각적 완성도가 중요한 프로젝트, Tailwind 사용 팀

---

### 7. Radix UI

- **사이트**: https://www.radix-ui.com/
- **설치**: 컴포넌트별 설치 (예: `npm install @radix-ui/react-dialog`)
- **CDN**: X
- **특징**:
  - 스타일 없는 접근성 프리미티브
  - ARIA + 키보드 인터랙션 완벽 지원
  - shadcn/ui의 기반 레이어
  - WorkOS에서 유지보수
- **적합한 프로젝트**: 자체 디자인 시스템을 처음부터 구축할 때

---

### 8. Headless UI

- **사이트**: https://headlessui.com/
- **설치**: `npm install @headlessui/react`
- **CDN**: X
- **특징**:
  - Tailwind CSS 팀(Tailwind Labs) 제작
  - 완전 스타일 없는 접근성 컴포넌트
  - 메뉴, 다이얼로그, 팝오버, 탭, 콤보박스 등 핵심 패턴
  - Vue도 지원
- **적합한 프로젝트**: Tailwind 프로젝트에서 핵심 접근성 컴포넌트만 필요할 때

---

### 9. React Bootstrap

- **사이트**: https://react-bootstrap.github.io/
- **설치**: `npm install react-bootstrap bootstrap`
- **CDN**: O — `window.ReactBootstrap`으로 전역 사용 가능 (CDN 사용 최적)
- **특징**:
  - Bootstrap 컴포넌트를 React 컴포넌트로 재구축
  - jQuery 의존성 없음
  - Bootstrap 5 테마 및 반응형 그리드
- **적합한 프로젝트**: Bootstrap 경험이 있는 팀, 빌드 도구 없이 CDN으로 개발할 때

---

### 10. Blueprint

- **사이트**: https://blueprintjs.com/
- **설치**: `npm install @blueprintjs/core`
- **CDN**: CSS만 CDN 가능, JS는 빌드 필요
- **특징**:
  - Palantir에서 제작
  - 복잡한 데이터 밀집 데스크톱 웹 앱에 최적화
  - Blueprint 6.0 (2025년 6월) 출시
- **적합한 프로젝트**: 분석 대시보드, 개발자 도구, 데이터 탐색 인터페이스

---

### 11. Fluent UI

- **사이트**: https://fluent2.microsoft.design/
- **설치**: `npm install @fluentui/react-components`
- **CDN**: X (React 버전)
- **특징**:
  - Microsoft Fluent 2 디자인 시스템
  - Microsoft 365 생태계 자연스러운 통합
  - React 컴포넌트 + 웹 컴포넌트
- **적합한 프로젝트**: Teams 확장, Office 애드인, Azure 포탈 통합

---

### 12. Semi Design

- **사이트**: https://semi.design/
- **설치**: `npm install @douyinfe/semi-ui`
- **CDN**: O (UMD 빌드)
- **특징**:
  - TikTok/Douyin 프론트엔드 팀 제작
  - 3000+ 디자인 토큰으로 깊은 커스터마이징
  - Code-to-Design: 테마에서 Figma UI Kit 자동 생성
  - 접근성(W3C, ARIA) 지원
- **적합한 프로젝트**: 디자인-코드 워크플로우가 중요한 엔터프라이즈 앱

---

### 13. PrimeReact

- **사이트**: https://primereact.org/
- **설치**: `npm install primereact`
- **CDN**: O (unpkg/cdnjs)
- **특징**:
  - 80+ 컴포넌트 (가장 많은 컴포넌트 수)
  - 간트 차트, 조직도, 트리 테이블 등 희귀 컴포넌트
  - Material, Bootstrap, Fluent 등 다양한 테마
- **적합한 프로젝트**: 특수 컴포넌트가 필요한 엔터프라이즈 앱

---

### 14. Arco Design

- **사이트**: https://arco.design/
- **설치**: `npm install @arco-design/web-react`
- **CDN**: O (UMD 빌드)
- **특징**:
  - ByteDance 엔터프라이즈 디자인 시스템
  - 60+ 컴포넌트, React/Vue/Mobile 지원
  - 컴포넌트 공유 마켓
- **적합한 프로젝트**: Ant Design 대안을 찾는 엔터프라이즈 앱

---

### 15. react-bits (신흥 강자)

- **사이트**: https://reactbits.dev/
- **설치**: `npx shadcn@latest add @react-bits/BlurText-TS-TW`
- **CDN**: X (소스코드 배포 방식)
- **특징**:
  - 2025 JS Rising Stars 2위
  - 110+ 애니메이션/인터랙티브 컴포넌트
  - 스크롤 트리거, 호버/마그네틱 효과, 픽셀 전환 등
  - shadcn CLI 지원
- **적합한 프로젝트**: 마케팅 사이트, 랜딩 페이지, 포트폴리오 (범용 UI 아님)

---

## CDN 사용 가능 여부 요약

빌드 도구 없이 `<script>` 태그로 사용할 수 있는 라이브러리:

| 사용 가능 | 라이브러리 |
|---|---|
| **O (권장)** | React Bootstrap, Ant Design |
| **O** | PrimeReact, Arco Design, Semi Design |
| **제한적** | MUI (프로토타이핑만) |
| **X** | shadcn/ui, Mantine, Chakra UI, Radix UI, HeroUI, Headless UI, Blueprint, Fluent UI, react-bits |

---

## 상황별 추천

| 상황 | 추천 |
|---|---|
| 가장 포괄적이고 검증된 솔루션 | MUI 또는 Ant Design |
| 2026년 가장 빠르게 성장 중 | Mantine |
| Tailwind + 코드 완전 소유 | shadcn/ui |
| 아름다운 기본 디자인 | HeroUI |
| 자체 디자인 시스템 구축 | Radix UI 또는 Headless UI |
| CDN / 빌드 도구 없이 사용 | React Bootstrap 또는 Ant Design |
| Microsoft 생태계 | Fluent UI |
| 데이터 밀집 데스크톱 앱 | Blueprint |
| 간트차트 등 특수 컴포넌트 | PrimeReact |
| 애니메이션/인터랙션 효과 | react-bits |
