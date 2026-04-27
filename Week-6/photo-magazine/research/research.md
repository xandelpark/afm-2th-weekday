# APERTURE 경쟁 서비스 비교 리포트

> Week-6 photo-magazine(APERTURE) — 잡지 컨셉 사진/마케팅 콘텐츠 + 유료/무료 잠금(블러+슬라이더) + TossPayments
> 조사 일자: 2026-04-27
> 조사 도구: Chrome DevTools MCP (자동 탐색·풀페이지 캡처) + WebSearch (유저 리뷰)

---

## 0. Executive Summary — 경쟁사 약점 → 본 프로젝트 차별화 도출

> 이 리포트의 결론을 한 표로 압축. 모든 화살표는 본문에 출처·인용으로 검증되어 있다.

### 도출 체인 (약점 → 원인 → 차별화)

| # | 경쟁사 약점 (유저 직접 인용 / 정책 원문) | 구조적 원인 | → APERTURE 차별화 |
| --- | --- | --- | --- |
| **1** | 롱블랙 L-6: "노트는 멤버십 결제를 유지한 상태에서만 이용 가능"<br>롱블랙 L-7: "콘텐츠 열람 이력이 발생했다면 환불 불가" | **결제 = 임대(rental)**. 구독 끊으면 결제했던 콘텐츠도 회수 | **① 단건 결제 + 영구 소장** — 결제 즉시 계정에 영구 귀속, 해지 개념 자체가 없음 |
| **2** | 롱블랙 L-1, L-2: "상업적·소비적 주제일 때가 많다… 더 소비하고 싶게 된다"<br>Aperture A-1, A-3: "pedantic and very academic" / "much too pretentious" | **양극화된 톤** — 비즈니스 일변도(롱블랙) vs 미술이론 일변도(Aperture). 사진을 일에 쓰는 사람은 양쪽 다 안 맞음 | **② 사진 × 마케팅 교차 큐레이션** — 1인 운영자가 양쪽 카테고리에 발을 담그고 에디토리얼 + 실용 톤으로 통합 |
| **3** | 매거진B B-1: "잡지에 나오는 건 죄다 비싸기 때문에 안 보는 게 통장잔고에 이로움" (₩24,000/호)<br>Aperture A-4: "Aperture can often be boring… isn't consistent enough for me to merit a subscription" | **결제는 도박** — 결제 전 본문을 거의 못 보고, 한 번 잘못 사면 환불도 어렵다 | **③ 블러 본문 + 슬라이더 잠금 해제** — 결제 직전까지 본문 톤·분량을 손에 쥐고 만져볼 수 있는 물리적 메타포 + 단건 ₩2,000~5,000 가격대 |

### 한 줄 결론

> **"매거진B의 잡지 미감과 Aperture의 큐레이션 권위를, 롱블랙이 못 채운 단건 결제 + 영구 소장 + 결제 전 미리보기 모델로 전달하는 한국어 사진/마케팅 디지털 매거진."**

→ 이 3가지가 다음 단계(`MISSION.md`, `FEATURES.md`)의 출발점이며, 이미 `AUDIENCES.md`의 페르소나 3인 / MVP 5요건으로 환원되어 있다.

상세 근거는 본문 §3.2(차별화 도출 풀버전), §3.3(페인포인트 인덱스), §3.3.4(해결 매핑)에 있다.

---

## Part 1 — 경쟁 서비스 3곳 선정

본 프로젝트의 3가지 핵심 축(잡지 미감 / 사진+마케팅 콘텐츠 / 유료 잠금)을 기준으로, 분석 폭이 넓어지도록 **국내 1 + 해외 1 + 인접 카테고리 1** 조합으로 골랐다.

| 구분 | 서비스 | 선정 이유 |
| --- | --- | --- |
| **국내 잡지** | [매거진B (magazine-b.com)](https://magazine-b.com/) | 한국 잡지 미감의 정점. 단일 주제 다큐멘터리 잡지 모델 — 본 프로젝트가 추구하는 "한 호 = 하나의 시선" 패키징의 원형 |
| **해외 매거진** | [Aperture (aperture.org)](https://aperture.org/) | 1952년 창간 사진 매거진의 글로벌 권위. 프로젝트 이름의 원조이자 에디토리얼 디자인의 기준 |
| **인접 카테고리(페이월 디지털 콘텐츠)** | [롱블랙 (longblack.co)](https://longblack.co/) | 본 프로젝트의 "콘텐츠 단위 잠금/결제" 메커닉이 가장 가까운 디지털 페이월 모델 |

---

## Part 2 — 자동 탐색 결과 (가치 제안 / 주요 기능 3개 / 가격)

각 서비스마다 **랜딩 / 핵심 기능 / 가격** 페이지를 Chrome MCP로 방문해 풀페이지 스크린샷을 저장했다(스크린샷은 `screenshots/` 폴더).

### 2.1 매거진B (Magazine B) — 국내 잡지

스크린샷: `screenshots/magazineb-home.png`, `screenshots/magazineb-product.png`

**핵심 가치 제안 (Value Proposition)**
> "광고 없는 잡지 — 철학·가격·미의식·실용성이라는 네 가지 기준으로 '균형 잡힌 브랜드'를 선정해 조명해온 다큐멘터리 잡지"
>
> 2011년 창간, 한 호 한 브랜드 단행본 시리즈. 100호 누적, 전 세계 크리에이티브 신의 수집 가치 높은 오브제로 자리매김.

**주요 기능 3개**
1. **단일 주제 인쇄 잡지** — 한 호당 하나의 브랜드/제품/주제(LEMAIRE, BLUE BOTTLE, MUJI, ARC'TERYX, DISNEY, MONOCLE 등) 깊이 다룸
2. **카테고리 분기** — Magazine B(브랜드) / Magazine C(제품·디자인) / Books(Jobs 시리즈, 단행본) / Goods & Tickets / Newsletter
3. **멀티채널 미디어** — B Cast(팟캐스트) + B Playlist + 오프라인 스토어 + KR/EN 이중언어, KRW/USD 이중통화로 글로벌 독자 흡수

**가격 정책**
| 상품 | 가격 |
| --- | --- |
| 최신호 (Issue 100) | ₩24,000 |
| 백 이슈 (정상가 ₩13,000~₩20,000) | 10% 할인 ₩11,700~₩18,000 |
| Books / Magazine C | ₩13,000~ |
| 디지털/구독 모델 | **없음** (단권 구매만) |
| 영문판 | 한글판보다 ₩3,000 더 비쌈 |

→ 100% 인쇄물 단권 판매 모델. 디지털 페이월/구독 없음.

---

### 2.2 Aperture — 해외 매거진

스크린샷: `screenshots/aperture-home.png`, `screenshots/aperture-magazine.png`, `screenshots/aperture-membership.png`

**핵심 가치 제안 (Value Proposition)**
> "Aperture is a nonprofit publisher dedicated to creating insight, community, and understanding through photography."
>
> 1952년 창간, 70년 사진 매거진 권위. 권위 있는 큐레이션 + 비영리 멤버십 모델로 사진 예술 커뮤니티 형성.

**주요 기능 3개**
1. **호(Issue) 단위 테마** — 매 호 하나의 큰 주제: "The End of Nature?"(2026 봄), "The Craft Issue", "The Seoul Issue", "Photography & AI" 등 — 한 호가 작품집
2. **웹 콘텐츠 무료 + 인쇄/멤버십 유료** — Interviews / Essays / Reviews / Portfolios / Photobooks 모두 웹 풀공개. 수익은 인쇄+멤버십+기부
3. **Aperture Portfolio Prize + PhotoBook Club + Conversations** — 외부 작가 발굴 채널 + 영상/이벤트로 커뮤니티 유지

**가격 정책 (USD)**
| 상품 | 가격 |
| --- | --- |
| 매거진 단권 | $24.95/호 |
| 매거진 구독 | 25% 할인 (≈ $75/year, 분기별 4호) |
| Friend (멤버십) | $250/year (또는 21–40세는 $75/월) |
| Patron | $1,000/year (VIP 패스, 파리 포토 패트론 트립) |
| Benefactor | $2,500/year (한정판 프린트 10% 할인, 토트백) |
| 380 Leader / Paul Strand Circle / Trustee Circle | $5,000 / $10,000 / $25,000 (점진적 혜택) |

→ 7단계 기부형 멤버십 + 인쇄물 판매. 디지털 콘텐츠 자체에는 페이월 없음.

---

### 2.3 롱블랙 (LongBlack) — 인접 카테고리(페이월 디지털 콘텐츠)

스크린샷: `screenshots/longblack-home.png`, `screenshots/longblack-about.png`, `screenshots/longblack-pricing.png`

**핵심 가치 제안 (Value Proposition)**
> "생각이 탄탄한 사람들의 하루 10분 루틴 — AI 시대, 당신의 무기가 되는 하루 10분 읽기 습관"
>
> 91.9% 재구매율을 전면 노출. "매일 읽지 않으면 생각하는 근육도 사라진다."

**주요 기능 3개**
1. **24시간 만료 메커닉** — TODAY 노트는 24시간 안에 읽어야 라이브러리에 영구 저장. 명시적 카운트다운 노출(`01:17:19`) — 강력한 FOMO 트리거
2. **관심사 기반 추천** — 직책/관심사 설정 → 추천 알고리즘 + 별점 평점(4.6/4,064 등) → 콘텐츠 신뢰 루프
3. **테마 컬렉션 + 공개 예정 카드** — "잘 쉬고 잘 회복하고 싶다면", "편안한 고객 경험 만드는 법" 등 큐레이션 / D-1, D-2 공개 예정 노트로 내일 기대감

**가격 정책 (KRW)**
| 플랜 | 가격 | 권한 |
| --- | --- | --- |
| 오늘의 노트 | 5,900원 / 30일 | 매일 1편(24시간 윈도) |
| 무제한 노트 | 9,900원 / 30일 | 1,500+ 노트 자유 열람 |
| 팀 패스 (B2B) | 별도 문의 | 회사용 멤버십 |

→ 단건/구독 페이월. 24시간 만료가 가격 가치를 만들어주는 구조.

---

## Part 3 — 비교 리포트

### 3.1 비교표 — 기능 / 가격 / UX 특징

| 항목 | 매거진B | Aperture | 롱블랙 |
| --- | --- | --- | --- |
| **포지션** | 한국형 브랜드 다큐 잡지 | 글로벌 사진 예술 매거진 | 한국형 비즈니스 페이월 콘텐츠 |
| **매체** | 인쇄(종이) | 인쇄 + 웹(무료) | 디지털(웹+앱) |
| **콘텐츠 단위** | 호(Issue) — 단일 주제 | 호(Issue) — 단일 테마 | 노트 — 일 1편 |
| **가격 모델** | 단권 구매(₩24,000) | 단권+멤버십($24.95~$25,000) | 구독(₩5,900~9,900/월) |
| **디지털 페이월** | ❌ 없음 | ❌ 웹 풀공개 | ✅ 핵심 모델 |
| **잠금 메커닉** | 물리적 잡지 구매 | 인쇄물 구매 / 멤버십 가입 | 결제 전 본문 차단 + 24시간 만료 |
| **추천/큐레이션** | 카테고리(Media/Beauty/Food/C) | 카테고리(Interviews/Essays/...) | 관심사 알고리즘 |
| **사회적 증거** | 100호 누적 + 광고 없음 | 70년 역사 + 비영리 + 권위 | 91.9% 재구매율 + 별점 시스템 |
| **부가 채널** | 팟캐스트, 플레이리스트, 오프라인 스토어 | PhotoBook Club, Portfolio Prize, 이벤트 | 모바일 앱(iOS/Android), 슬랙 커뮤니티, B2B |
| **디자인 톤** | 모더니스트 / 미니멀 / 사진 中心 | 갤러리 / 큰 이미지 / 절제된 세리프 | 가독성 우선 카드 그리드 |
| **타겟** | 브랜드/디자인 관심 직장인·디자이너 | 사진 예술 감상자 / 컬렉터 | 매일 읽는 습관을 만들고 싶은 직장인 |

### 3.2 본 프로젝트(APERTURE)의 차별화 포인트 — 내가 더 잘할 수 있는 것 3가지

각 차별화 포인트는 ① **유저 불만의 직접 인용** → ② **그 불만이 발생하는 구조적 원인** → ③ **본 프로젝트가 가진 자산으로 어떻게 더 잘하는지** 순으로 정리했다.

---

**① "산 콘텐츠를 평생 소장한다" — 롱블랙의 24시간 만료 + 해지 시 콘텐츠 회수를 정면으로 뒤집는다**

> 유저 직접 인용
> - "롱블랙은 매일 해야 하는 과제 같다… 뉴스레터의 가장 큰 장점이 '언제 어디서든, 원하는 타이밍에 읽을 수 있다'인데, 롱블랙은 정반대" — [요즘IT 리뷰](https://yozm.wishket.com/magazine/detail/1754/)
> - "지금 당장 읽지 않더라도 일단 열어서 스탬프라도 찍어놔야 한다" — [미디어오늘 인터뷰](https://www.mediatoday.co.kr/news/articleView.html?idxno=301950)
> - 롱블랙 FAQ: "노트는 멤버십 결제를 유지한 상태에서만 이용할 수 있다" — [longblack.co/faq](https://www.longblack.co/faq)

**구조적 원인** — 롱블랙은 **구독을 끊는 순간 결제했던 노트도 사라지는** 모델이다. 24시간 윈도+해지 시 회수 = 결제는 "구매"가 아니라 "임대"다.

**APERTURE가 더 잘하는 방식**
- 단건 결제 = **즉시 소유권 이전**. 결제한 콘텐츠는 계정에 영구 귀속, 1년 뒤에도 다시 읽기 가능
- TossPayments 비회원 결제 → 카드 등록·자동결제 없음 → 해지 트라우마 자체가 발생 안 함
- 카피 직결: "매일 과제 X, 한 편을 평생 소장 O"

---

**② "사진 × 마케팅 교차" — 셋 다 안 다루는 카테고리, 1인 운영자(본 프로젝트 운영자)가 가장 잘 다룰 수 있다**

> 유저 직접 인용
> - "롱블랙의 글이 흥미로운 건 사실이지만, 상업적이고 소비적인 주제일 때가 많다… 읽다 보면 더 멋있고 맛있는 것들을 소비하고 싶게 된다" — [요즘IT 리뷰](https://yozm.wishket.com/magazine/detail/1754/)
> - "Aperture is much too pretentious for my simple tastes" / "Aperture can often be boring (IMO)" — [DPReview Forums](https://www.dpreview.com/forums/threads/aperture-magazine.4751381/)
> - "the academic side has overwhelmed the experiential side" — Aperture 40주년 자체 회고

**구조적 원인** — 롱블랙은 비즈니스 콘텐츠 일변도, Aperture는 미술이론 일변도. **사진을 '실무에 쓰는 사람'(마케터·디자이너·작은 브랜드 운영자)** 의 빈자리는 양쪽 다 못 채웠다.

**APERTURE가 더 잘하는 방식**
- 한 콘텐츠 안에 **사진 + 마케팅을 동시에**: "필름 카메라의 부활이 만든 브랜드 언어", "포토그래퍼가 디렉팅한 캠페인" 같은 교차 주제
- Playfair × Cormorant Garamond + grain·cream 배경 = Aperture의 미감을 빌리되, 학술 톤 대신 **에디토리얼 + 실용** 톤(롱블랙 가독성)
- 운영자 자산: 사진과 마케팅 양쪽에 발을 담근 **1인 운영자가 직접 큐레이션** → 두 카테고리를 분리해서 운영하는 매체보다 톤 일관성이 강하다

---

**③ "결제 전에 본문을 만져보게 한다" — 롱블랙·퍼블리·매거진B 누구도 못 한 결제 동선**

> 유저 직접 인용
> - 퍼블리: "월 21,900원, 연 20만원은 부담… 넷플릭스보다 거의 두 배" — [클리앙 후기](https://www.clien.net/service/board/use/12640643)
> - 매거진B: "잡지에 나오는 건 죄다 비싸기 때문에 안 보는 게 통장잔고에 이로움" — [브런치](https://brunch.co.kr/@uren31/2)
> - 롱블랙 환불 정책: "결제 후 콘텐츠 열람 이력이 발생했다면 환불 불가" — [longblack.co/faq](https://www.longblack.co/faq)

**구조적 원인** — 셋 다 결제 전에는 본문을 거의 못 본다(롱블랙은 잠금 화면, 매거진B는 책 표지만, Aperture는 인쇄물). **결제는 신뢰에 기반한 도박**이고, 한 번 잘못 사면 환불도 어렵다.

**APERTURE가 더 잘하는 방식**
- **블러 본문 + 슬라이더 잠금 해제** UX = 결제 전에 본문 분량·톤·이미지를 시각적으로 확인 후 결제 결정
- 슬라이더를 끝까지 밀면 결제 위젯이 뜨는 **물리적 자물쇠 메타포** → "이 콘텐츠를 푼다"는 게임적 즐거움 + 결제 행위의 의미 부여
- 단건 ₩2,000~5,000 가격대 = 매거진B 한 호(₩24,000)의 1/5~1/10, 퍼블리 월 구독료의 1/5 → "잘못 사도 손해 적다"는 심리적 안전망

→ 결과적으로 **"본문을 만져본다 → 가격이 작다 → 영구 소장된다"** 의 3단 안전망이 결제 전환의 잠금을 푼다.

### 3.3 AUDIENCES.md 인풋 — 경쟁 서비스 유저 불만 (직접 인용 + 출처)

리뷰/커뮤니티에서 직접 인용 가능한 표현만 수집했다. 출처는 모두 본 리포트 하단의 출처 섹션에 링크.

#### 3.3.1 롱블랙

| # | 직접 인용 (또는 정책 원문) | 출처 |
| --- | --- | --- |
| L-1 | "롱블랙의 글이 흥미로운 건 사실이지만, 상업적이고 소비적인 주제일 때가 많다" | 요즘IT |
| L-2 | "읽다 보면 더 멋있고 맛있는 것들을 소비하고 싶게 된다… 그런 기분을 들게 만든다는 사실이 별로" | 요즘IT |
| L-3 | "롱블랙은 매일 해야 하는 과제 같다" | 요즘IT |
| L-4 | "지금 당장 읽지 않더라도 일단 열어서 스탬프라도 찍어놔야 한다" | 미디어오늘 |
| L-5 | "뉴스레터 알림이 이메일과 카카오톡 양쪽에서 오는 것이 귀찮다… 한쪽 경로로만 오도록 설정하고 싶은데 아직 기능 구현은 안 된 것 같다" | 요즘IT |
| L-6 | (정책) "노트는 멤버십 결제를 유지한 상태에서만 이용 가능" — 해지하면 결제했던 노트도 못 봄 | longblack.co/faq |
| L-7 | (정책) "콘텐츠 열람 이력이 발생했다면 환불 불가" — 한 번 열면 끝 | longblack.co/faq |
| L-8 | (정책) 2026.01.05부터 월 4,900원 → 5,900원 인상 | longblack.co 공지 |

#### 3.3.2 매거진B

| # | 직접 인용 / 사실 | 출처 |
| --- | --- | --- |
| B-1 | "잡지에 나오는 건 죄다 비싸기 때문에 안 보는 게 통장잔고에 이로움" | 브런치 |
| B-2 | (사실) 최신호 ₩24,000, 영문판은 ₩3,000 더 비쌈 | magazine-b.com |
| B-3 | (구조적) 종이 단권만 — 모바일 즉시 읽기 불가, 백 이슈 절판 시 접근 어려움 | 본 조사 |
| B-4 | (보너스 — 퍼블리, 인접 카테고리) "월 21,900원, 연 20만원 부담… 넷플릭스보다 거의 두 배" | 클리앙 |

#### 3.3.3 Aperture

| # | 직접 인용 (영문 원문 + 한국어 풀이) | 출처 |
| --- | --- | --- |
| A-1 | "pedantic and very academic" — 학술적이고 현학적 | 한 평론자(여러 매체에 인용됨) |
| A-2 | "art professors and students who want to explore post modern photographic art" — 미대 교수·학생용이지 사진 애호가용 아님 | 위키피디아 |
| A-3 | "much too pretentious for my simple tastes" — 내 단순한 취향엔 너무 잘난 척 | DPReview Forums |
| A-4 | "Aperture can often be boring (IMO)… isn't consistent enough for me to merit a subscription" — 종종 지루하고 일관성이 없어 구독할 가치 X | DPReview Forums |
| A-5 | "the academic side has overwhelmed the experiential side" — 학술이 경험을 압도 (Aperture 자체 회고) | Aperture 40주년 회고 |
| A-6 | (사실) $24.95/호 + $250 멤버십 + 영문 전용 → 한국 독자 진입장벽 큼 | aperture.org |

#### 3.3.4 → 본 프로젝트가 해결하는 매핑

| 페인포인트 | APERTURE 해결책 |
| --- | --- |
| L-1, L-2 (소비 부추김) | 사진 예술/마케팅 교차 큐레이션 — 시각·문화적 깊이로 톤 톤 다운 |
| L-3, L-4 (시간 압박) | **단건 결제 + 영구 소장** — 24시간 만료 없음 |
| L-5 (알림 피로) | v1: 푸시 알림 없음, 이메일 1회 발송. 가벼운 채널 1개 원칙 |
| L-6, L-7 (구독 회수·환불 불가) | 단건 결제 = 영구 소유. 해지 개념 자체가 없음 |
| B-1, B-2 (가격 부담) | 단건 ₩2,000~5,000 → 매거진B 한 호의 1/5~1/10 |
| B-3 (인쇄 한정) | 100% 디지털, 모바일 우선 |
| A-1, A-3, A-5 (학술 톤) | 에디토리얼 + 실용 톤. 마케터·취미 사진가도 읽기 쉬움 |
| A-2, A-4 (일관성·재미 부족) | 운영자 큐레이션 1인 일관성 + 결제 전 미리보기로 톤 검증 |
| A-6 (영문·환율) | 한국어 + 원화 + TossPayments |

### 3.4 결론 — 한 줄 포지셔닝

> **"매거진B의 잡지 미감과 Aperture의 큐레이션 권위를, 롱블랙이 못 채운 단건 결제 + 영구 소장 모델로 전달하는 한국어 사진/마케팅 디지털 매거진."**

세 곳 모두 잘 해냈지만 **각자가 비워둔 칸**이 분명히 있다. 본 프로젝트는 그 교집합을 채울 수 있는 위치에 서 있다.

---

## 출처 (User Research)

**롱블랙 직접 인용 출처**
- [롱블랙 뉴스레터 솔직 리뷰 — 요즘IT](https://yozm.wishket.com/magazine/detail/1754/) (L-1, L-2, L-3, L-5)
- [24시간 지나면 사라지는 콘텐츠, 돈 내고 구독하는 이유 — 미디어오늘](https://www.mediatoday.co.kr/news/articleView.html?idxno=301950) (L-4)
- [롱블랙 FAQ](https://www.longblack.co/faq) (L-6, L-7)
- [매일 아침 4,900원짜리 롱블랙을 읽는 이유 — 브런치](https://brunch.co.kr/@ladies-pond/79)
- [롱블랙(콘텐츠 구독) 뜯어보기 — 브런치](https://brunch.co.kr/@seastbest/1)

**매거진B 직접 인용 출처**
- [조수용의 매거진B는 카피일까? — 브런치](https://brunch.co.kr/@uren31/2) (B-1)
- [magazine-b.com 제품 페이지](https://magazine-b.com/) (B-2 가격)
- [매거진B - 나무위키](https://namu.wiki/w/%EB%A7%A4%EA%B1%B0%EC%A7%84%20B)
- [슬기로운 잡지생활(컨셉진, 매거진B, 창작과 비평)](https://odds-and-ends.co.kr/176)

**Aperture 직접 인용 출처**
- [Aperture Magazine? — DPReview Forums](https://www.dpreview.com/forums/threads/aperture-magazine.4751381/) (A-3, A-4)
- [Aperture Magazine — Real Photographers Forum](https://realphotographersforum.com/threads/aperture-magazine.25864/)
- [Aperture (magazine) — Wikipedia](https://en.wikipedia.org/wiki/Aperture_(magazine)) (A-2)
- [Aperture 40주년 회고 — Aperture NY](https://aperture.org/editorial/archive-look-back-aperture-magazines-fortieth-anniversary/) (A-5)
- [Aperture Customer Reviews — Amazon](https://www.amazon.com/Aperture/product-reviews/B002PXVY82)

**인접 카테고리(퍼블리) 보너스 인용**
- [PUBLY 한달 사용기 — 클리앙](https://www.clien.net/service/board/use/12640643) (B-4)
- [퍼블리의 '마케팅' 콘텐츠에 대한 10가지 팩트 — 브런치](https://brunch.co.kr/@yozm/105)
