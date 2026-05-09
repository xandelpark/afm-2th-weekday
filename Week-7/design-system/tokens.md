# Design Tokens (shadcn/ui 기반)

[shadcn/ui](https://ui.shadcn.com/)의 토큰 컨벤션을 그대로 채택. 색은 **HSL space-separated** 형식의 CSS 변수로 정의하고, Tailwind는 `hsl(var(--xxx) / <alpha-value>)` 패턴으로 소비한다.

## 1. 토큰 표 (shadcn 컨벤션)

| CSS 변수 | Tailwind 토큰 | 역할 |
|---|---|---|
| `--background` | `bg-background` | 페이지 배경 |
| `--foreground` | `text-foreground` | 본문 텍스트 |
| `--card` | `bg-card` | 카드 표면 |
| `--card-foreground` | `text-card-foreground` | 카드 위 텍스트 |
| `--popover` | `bg-popover` | 팝오버/메뉴 표면 |
| `--popover-foreground` | `text-popover-foreground` | 팝오버 텍스트 |
| `--primary` | `bg-primary` | Primary 버튼 배경 |
| `--primary-foreground` | `text-primary-foreground` | Primary 버튼 텍스트 |
| `--secondary` | `bg-secondary` | Secondary 버튼/뱃지 |
| `--secondary-foreground` | `text-secondary-foreground` | Secondary 텍스트 |
| `--muted` | `bg-muted` | 비활성/배경 보조 |
| `--muted-foreground` | `text-muted-foreground` | 보조 텍스트 |
| `--accent` | `bg-accent` | Hover/액센트 배경 |
| `--accent-foreground` | `text-accent-foreground` | 액센트 텍스트 |
| `--destructive` | `bg-destructive` | 위험/삭제 |
| `--destructive-foreground` | `text-destructive-foreground` | 위험 텍스트 |
| `--border` | `border-border` | 보더 색 |
| `--input` | `border-input` | 입력 보더 |
| `--ring` | `ring-ring` | 포커스 링 |
| `--radius` | `rounded-md/lg/xl` 기준 | 라운드 단위(0.5rem 기본) |

## 2. Tailwind 설정 (CDN 환경)

```html
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    darkMode: ['class'],
    theme: {
      extend: {
        colors: {
          border: 'hsl(var(--border))',
          input: 'hsl(var(--input))',
          ring: 'hsl(var(--ring))',
          background: 'hsl(var(--background))',
          foreground: 'hsl(var(--foreground))',
          primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
          secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
          destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
          muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
          accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
          popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
          card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        },
        borderRadius: {
          lg: 'var(--radius)',
          md: 'calc(var(--radius) - 2px)',
          sm: 'calc(var(--radius) - 4px)',
        },
      }
    }
  };
</script>
```

## 3. 팔레트 (3종)

각 팔레트는 동일한 토큰 이름을 채우는 HSL 값 세트. **컴포넌트 코드는 그대로 두고 팔레트만 교체**해서 톤을 바꾼다.

### 3-1. Default (shadcn neutral, 기본 — 미정시 사용)

```css
:root {
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 240 10% 3.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 240 10% 3.9%;
  --primary: 240 5.9% 10%;
  --primary-foreground: 0 0% 98%;
  --secondary: 240 4.8% 95.9%;
  --secondary-foreground: 240 5.9% 10%;
  --muted: 240 4.8% 95.9%;
  --muted-foreground: 240 3.8% 46.1%;
  --accent: 240 4.8% 95.9%;
  --accent-foreground: 240 5.9% 10%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 5.9% 90%;
  --input: 240 5.9% 90%;
  --ring: 240 5.9% 10%;
  --radius: 0.5rem;
}
.dark {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  --card: 240 10% 3.9%;
  --card-foreground: 0 0% 98%;
  --popover: 240 10% 3.9%;
  --popover-foreground: 0 0% 98%;
  --primary: 0 0% 98%;
  --primary-foreground: 240 5.9% 10%;
  --secondary: 240 3.7% 15.9%;
  --secondary-foreground: 0 0% 98%;
  --muted: 240 3.7% 15.9%;
  --muted-foreground: 240 5% 64.9%;
  --accent: 240 3.7% 15.9%;
  --accent-foreground: 0 0% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 0 0% 98%;
  --border: 240 3.7% 15.9%;
  --input: 240 3.7% 15.9%;
  --ring: 240 4.9% 83.9%;
}
```

### 3-2. Editorial Cream (따뜻한 종이 톤, 테라코타 액센트)

```css
:root {
  --background: 36 33% 97%;        /* #FAF7F2 cream */
  --foreground: 0 0% 10%;          /* #1A1A1A ink */
  --card: 0 0% 100%;
  --card-foreground: 0 0% 10%;
  --popover: 0 0% 100%;
  --popover-foreground: 0 0% 10%;
  --primary: 0 0% 10%;             /* ink primary */
  --primary-foreground: 36 33% 97%;
  --secondary: 36 25% 92%;         /* hairline soft */
  --secondary-foreground: 0 0% 10%;
  --muted: 36 25% 92%;
  --muted-foreground: 22 9% 47%;   /* #7B7470 muted */
  --accent: 14 47% 59%;            /* #C97B63 terracotta */
  --accent-foreground: 0 0% 100%;
  --destructive: 0 70% 50%;
  --destructive-foreground: 0 0% 100%;
  --border: 36 22% 89%;            /* #E8E4DD hairline */
  --input: 36 22% 89%;
  --ring: 14 47% 59%;
  --radius: 0.75rem;               /* 살짝 더 둥글게 */
}
```

### 3-3. Cinematic Dark (영화적 다크, 핏빛 액센트)

```css
:root {
  --background: 0 0% 2%;           /* #050505 bg-deep */
  --foreground: 16 14% 76%;        /* #c9bfb6 ash */
  --card: 0 0% 4%;                 /* #0a0a0a bg-soft */
  --card-foreground: 16 14% 76%;
  --popover: 0 0% 4%;
  --popover-foreground: 16 14% 76%;
  --primary: 0 62% 36%;            /* #9b1c1c blood-bright */
  --primary-foreground: 28 70% 92%; /* #f5e9e2 bone */
  --secondary: 0 0% 10%;
  --secondary-foreground: 16 14% 76%;
  --muted: 0 0% 8%;
  --muted-foreground: 16 10% 55%;
  --accent: 0 62% 30%;             /* #7c1d1d blood */
  --accent-foreground: 28 70% 92%;
  --destructive: 0 80% 45%;
  --destructive-foreground: 28 70% 92%;
  --border: 16 14% 76% / 0.1;      /* ash 10% */
  --input: 16 14% 20%;
  --ring: 0 62% 36%;
  --radius: 0rem;                  /* 영화적 직각 */
}
```

> Cinematic Dark에는 추가로 grain / scanlines / vignette / flicker 효과를 base CSS에 포함한다 (템플릿 참고).

### 3-4. Marian Editorial (웨딩 포토 스튜디오, 딥 네이비 액센트)

[marianwedding.co.kr](http://www.marianwedding.co.kr/) 무드. 흰 배경 + 풀블리드 사진 + 딥 네이비(`#091940`) 단일 액센트 + Helvetica Bold 큰 디스플레이.

```css
:root {
  --background: 0 0% 100%;          /* white */
  --foreground: 0 0% 13%;           /* #212121 near-black */
  --card: 0 0% 100%;
  --card-foreground: 0 0% 13%;
  --popover: 0 0% 100%;
  --popover-foreground: 0 0% 13%;
  --primary: 224 75% 14%;           /* #091940 midnight navy */
  --primary-foreground: 0 0% 100%;
  --secondary: 0 0% 96%;
  --secondary-foreground: 0 0% 20%;
  --muted: 0 0% 96%;
  --muted-foreground: 0 0% 40%;     /* #666 */
  --accent: 224 75% 14%;            /* navy 동일 */
  --accent-foreground: 0 0% 100%;
  --destructive: 0 70% 45%;
  --destructive-foreground: 0 0% 100%;
  --border: 0 0% 87%;               /* #ddd hairline */
  --input: 0 0% 87%;
  --ring: 224 75% 14%;
  --radius: 0rem;                   /* 직각, 클래식 포멀 */
}
```

타이포 / 시그니처 효과:
- `font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif` (영문 디스플레이)
- 한글은 Pretendard fallback
- 디스플레이 헤드라인은 **굵고 큰** (60~120px), 모든 글자에 약간의 letter-spacing(`0.02em ~ 0.08em`)
- 풀블리드 히어로 이미지 위에 **흰 텍스트 오버레이 + 그라데이션 마스크**
- UI는 1px hairline + 직각, 그림자 거의 없음

### 3-5. Mono Utility (회색 중성, 결제/관리자/B2B)

```css
:root {
  --background: 0 0% 98%;          /* #FAFAFA */
  --foreground: 222 47% 11%;       /* #111827 gray-900 */
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 222 47% 11%;
  --primary: 215 28% 17%;          /* #1F2937 gray-800 */
  --primary-foreground: 0 0% 100%;
  --secondary: 220 14% 96%;        /* gray-100 */
  --secondary-foreground: 222 47% 11%;
  --muted: 220 14% 96%;
  --muted-foreground: 220 9% 46%;  /* gray-500 */
  --accent: 220 14% 96%;
  --accent-foreground: 222 47% 11%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 100%;
  --border: 220 13% 91%;           /* gray-200 */
  --input: 220 13% 91%;
  --ring: 215 28% 17%;
  --radius: 0.5rem;
}
```

## 4. 타이포그래피

| 테마 | Body | Display | 특징 |
|---|---|---|---|
| Default | system / Pretendard | system | tracking 기본 |
| Editorial Cream | Pretendard | Cormorant Garamond italic | tabular-nums, eyebrow uppercase tracking-[0.18em] |
| Cinematic Dark | Noto Serif KR | Cinzel uppercase | tracking-[0.18em ~ 0.4em], 와이드 트래킹 |
| Marian Editorial | Pretendard | Helvetica Neue Bold | 60~120px 큰 디스플레이, 풀블리드 사진 히어로, 직각 hairline |
| Mono Utility | system | system | 와이드 트래킹 금지 |

## 5. 의사결정 가이드

> "어떤 팔레트?"
- 사용자 앱/툴/대시보드 → **Editorial Cream** (또는 Default)
- 콘텐츠 마케팅/포스터/티저 → **Cinematic Dark**
- 웨딩/포토 스튜디오/포트폴리오 → **Marian Editorial**
- 결제/관리자/B2B/내부 시스템 → **Mono Utility**
- 결정 못 함 → **Default(shadcn neutral)**
