# 본식스냅 자동편집

내가 편집한 본식스냅 영상들을 학습해서, 새 촬영본을 넣으면 가편집본을 만들어
**캡컷 타임라인에 얹어주는** 파이프라인.

## 설계 원칙

**원본 픽셀은 평생 딱 한 번만 읽는다.**

촬영본이 100GB 규모이고 작업 머신은 M3 / RAM 8GB / 여유 디스크 54GB다.
원본을 매번 다시 디코딩하면 실험 한 번에 반나절이 날아가므로,
최초 1회 스캔에서 특징만 뽑아 DB에 적재하고 이후 모든 학습·편집은 DB 위에서만 돈다.

특징 저장소는 **원본의 1~2%**. 100GB 촬영본 → 특징 DB + 썸네일 약 1.4GB
(썸네일 480px 기준. 아래 "실패 모드 ②" 참고).

## 접근 방식 — 슬롯 템플릿 + 검색 채우기

전자동 편집기가 아니다. **하이라이트를 슬롯의 나열로 명문화해두고, 새 원본에서 각 슬롯에
맞는 소재를 검색해 끼워넣는다. 못 찾은 슬롯은 비워두고 사람이 채운다.**

이렇게 하면 "어느 감정 순간이 좋은가"라는 풀 수 없는 미학 판단 문제가
"이 조건을 만족하는 구간을 찾아라"라는 검색 문제로 바뀐다.
그리고 실패가 조용히 품질을 갉아먹는 대신 **빈칸으로 눈에 보인다.**

핵심 원칙: **오매칭이 미매칭보다 훨씬 위험하다.**
엉뚱한 컷이 자신 있게 꽂혀 있으면 편집자가 놓치지만, 빈칸은 절대 못 놓친다.
그래서 매칭은 재현율이 아니라 **정밀도 기준으로 튜닝한다 — 애매하면 비운다.**

| 단계 | 파일 | 상태 |
|---|---|---|
| ① 특징 스캔 (컷·썸네일·오디오·품질·화면속성) | `scan.py` | ✅ 동작 |
| ①-b 화면 속성 (샷사이즈·인원) | `vision_attrs.py` | ✅ `scan.py`에 배선됨 |
| ①-c 하이라이트 컷 검출 (디졸브 포함) | `shotdetect.py` | ✅ 동작 |
| ② 식순 분할 (STT 기반) | `segment.py` | 미착수 |
| ③ 하이라이트 → 슬롯 템플릿 명문화 | `templatize.py` | 스키마만 (`templates/`) |
| ④ 새 원본 → 슬롯 매칭 | `match.py` | 미착수 |
| ⑤ 캡컷 draft 출력 (빈 슬롯 = 플레이스홀더) | `../capcut-automation/run.py` | ✅ 동작 |

### ①-c 하이라이트 컷 검출 — 왜 scdet으로는 안 되는가

**ffmpeg `scdet`은 디졸브를 통째로 놓친다.** 실측:

| 전환 방식 | `scdet` 최고 score | 검출 |
|---|---|---|
| 하드컷 | 28.7 | ✓ |
| 1초 크로스페이드 | **0.9** | ✗ **0개** |

임계값(20) 근처도 못 간다. 하이라이트엔 디졸브가 깔리므로 scdet만 쓰면
**두 컷이 한 슬롯으로 뭉개진 오염된 템플릿**이 만들어진다. 템플릿이 근간인 설계라 치명적이다.

→ **완성본에만 TransNetV2**를 쓴다. 같은 크로스페이드를 2.533초(전환 중앙)로 정확히 잡는다.

```bash
.venv/bin/python shotdetect.py 하이라이트.mp4 --json cuts.json
```

원본 촬영본엔 애초에 편집점이 없으므로 `scan.py`의 scdet(28x 실시간)을 그대로 쓴다.
100GB에 신경망을 돌릴 이유가 없다. 하이라이트는 100편 × 5분 ≈ 8시간뿐이라 비용이 제한적이다.

- 가중치 30.5MB ([HF: Sn4kehead/TransNetV2](https://huggingface.co/Sn4kehead/TransNetV2)) → `models/`
- 기본 CPU. MPS가 2.8배 빠르지만 패키지가 수치 불일치를 경고해 `--device mps`로만 열어둠
- 검증: 하드컷 2.000s / 크로스페이드 2.533s / 3연속컷 3.033·6.033·9.067s (정답 3·6·9s)

### ①-b 화면 속성 — 실측 검증 결과

맥 내장 Vision 프레임워크 사용. **모델 다운로드 없음, torch 불필요, RAM 8GB에서 안전.**

실제 웨딩 사진 5장으로 검증:

| 사진 | 검출 | 판정 | 근거 |
|---|---|---|---|
| 홀 전경 (하객 80명+, 어두움) | 얼굴 0 / 인체 3 | `wide` | body |
| 신부 단독 (플라워, 밝음) | 얼굴 1 | `full` | face |
| 인물 미디엄 | 얼굴 1 | `medium` | face |
| 인물 바스트 | 얼굴 1 | `medium_closeup` | face |
| 단체 6인 | 얼굴 6 | `medium_closeup` | face |

> **발견한 실패 모드 ①:** 어두운 홀 와이드샷에서 얼굴 검출이 **완전히 무너진다**
> (하객 80명 넘는 컷에서 얼굴 0개). 그런데 이건 신부입장·행진 하이라이트의 핵심 컷이다.
> → `VNDetectHumanRectangles` 인체 높이 폴백을 넣어 해결(`BODY_SIZE_BINS`).
> 폴백 없이는 스키마의 절반이 무의미해진다.

> **발견한 실패 모드 ②:** 썸네일 해상도가 낮으면 그 폴백마저 죽는다.
> 같은 와이드샷에서 **320px 이하 → 인체 0개 / 480px 이상 → 정상**.
> → `THUMB_HEIGHT`를 320 → **480**으로 올렸다. 비용은 프레임당 17KB→30KB,
> 100GB 기준 약 1.4GB. 이 값을 낮게 잡고 100GB를 스캔했다면 전량 재스캔이었다.

> **미검증 (실촬영본 필요):** 위 480px 기준은 *정지 이미지* 실측이다.
> 영상 파이프라인을 거친 같은 컷은 720px에서도 검출에 실패했는데,
> 테스트 소재가 흰 여백 있는 정사각 앨범 JPG를 16:9에 레터박스로 넣은 것이라
> 홀 내용이 프레임 일부만 차지한 탓이다 — **실촬영본엔 없는 조건이므로 이 값으로 튜닝하면 안 된다.**
> 실제 본식 원본으로 반드시 재검증할 것.
>
> 다만 이 실패는 **안전하게 실패한다**: `shot_size=None` → 매칭 실패 → 슬롯이 빈칸으로 남고
> 사람이 채운다. 설계 원칙(애매하면 비운다)과 일치한다.

사람이 아예 안 잡히는 인서트 컷(반지·부케·홀 장식)은 `shot_size_basis=None`이 되고,
이 경우는 `subject` 조건으로만 매칭한다.

### ③ 슬롯 스펙 — 무엇을 명문화하는가

`templates/example_template.json` 참고. 슬롯 하나는 이렇게 생겼다:

```json
{
  "slot_id": "신부입장_02",
  "offset": 3.2, "duration": 2.4,
  "must":   { "subject": "신부", "shot_size": "closeup" },
  "prefer": { "camera_move": "static", "angle": "front",
              "section_progress": [0.1, 0.3] },
  "min_quality": { "sharpness_pct": 75, "no_face_occlusion": true },
  "confidence_floor": 0.80
}
```

**전부 기계적으로 측정 가능한 값만 쓴다.** "감동적인", "예쁜" 같은 건 스펙에 넣지 않는다.
넣는 순간 매칭이 불가능해지고, 그런 판단은 애초에 사람 몫으로 남기는 게 이 설계의 요점이다.

- `must` — 하나라도 어긋나면 탈락
- `prefer` — 점수 가중치
- `confidence_floor` — 이 점수 못 넘으면 **빈칸으로 남긴다.**
  감정 판단이 필요한 슬롯(부모님 리액션 등)은 문턱을 일부러 높여 대체로 비도록 만든다.
- `section_progress` — 식순 구간 내 상대 위치(0~1). 절대 시각은 예식마다 달라 못 쓴다.

## ① 특징 스캐너 — 사용법

```bash
# 원본 촬영본
.venv/bin/python scan.py /Volumes/외장/본식_20250412/원본 \
    --project 본식_20250412 --role raw

# 완성본 (편집 결과물 — 여기서 편집점을 배운다)
.venv/bin/python scan.py /Volumes/외장/본식_20250412/완성본.mp4 \
    --project 본식_20250412 --role final

# 외장 통째로 훑기
.venv/bin/python scan.py /Volumes/외장 --recursive -j 3

# 대상/용량만 미리보기
.venv/bin/python scan.py /Volumes/외장 --recursive --dry-run
```

`--role` 은 `raw`(원본) / `graded`(보정본) / `final`(완성본).
③단계에서 완성본의 컷을 원본과 매칭할 때 이 구분이 기준이 된다.

이미 스캔한 파일은 경로+크기+수정시각으로 건너뛴다. **중간에 끊겨도 다시 돌리면 이어간다.**
손상 파일이 섞여 있어도 그 파일만 실패로 기록하고 계속 진행한다.

### 성능 (실측, M3 / 1080p 20Mbps)

- 직렬 `-j 1`: 9x 실시간
- 병렬 `-j 3`: **28x 실시간** (3.2배)
- → 100GB(≈11시간 분량) 스캔에 **20~30분**. 4K면 1~1.5시간.

RAM 8GB라 `-j 3`이 안전선이다. 더 올리면 스왑이 걸려 오히려 느려진다.

### 뽑아내는 것

- **컷 경계** — `scdet` scene score. 임계값 이상만 컷으로 본다
  (검증: 정답 3.0/6.0/9.0초 → 3.023/6.023/9.056초로 검출)
  단, **디졸브는 못 잡는다** → 완성본은 `shotdetect.py`(TransNetV2)를 따로 쓴다
- **1fps 썸네일** — 세로 480px JPEG. 화면 속성 분석 + 이후 CLIP 임베딩용
- **16kHz 모노 오디오** — opus 24kbps. 식순 STT용 (원본의 1/1000)
- **프레임 품질** — 선명도(라플라시안 분산)/밝기/대비/움직임
- **화면 속성** — 샷사이즈/인원/얼굴수/얼굴크기·위치 (맥 Vision)

> scene score 곡선을 임계값 미만까지 통째로 보관한다(`SCENE_FLOOR`).
> 나중에 컷 판정 기준을 바꿔도 **100GB를 재디코딩할 필요가 없다.**

### 특징 DB 구조 (`features.db`, SQLite)

```
sources(id, path, project, role, duration, width, height, fps, created_at, thumb_dir, audio_path)
cuts(source_id, t, score)                    -- 컷 후보 + score (임계값 미만도 보관)
frames(source_id, t, thumb,
       sharpness, brightness, contrast, motion,          -- 품질
       shot_size, shot_basis, people_count, face_count,  -- 화면 속성
       face_ratio, face_cx, face_cy)
```

컷만 조회:
```sql
SELECT t, score FROM cuts WHERE source_id=? AND score >= 20 ORDER BY t;
```

슬롯 후보 찾기 (예: 신부 클로즈업, 선명한 것만):
```sql
SELECT t, thumb, sharpness FROM frames
WHERE shot_size='closeup' AND people_count=1 AND sharpness > 80
ORDER BY sharpness DESC;
```

## 왜 본식스냅이 자동편집에 유리한가

식순이 고정이다 — 신랑입장 → 신부입장 → 맞절 → 서약 → 성혼선언 → 축가 → 행진 → 폐백.
사회자 멘트를 STT로 잡으면 식순 경계가 거의 자동으로 떨어진다.

식순을 축으로 세우면 "이 영상을 어떻게 편집할까"라는 막연한 문제가
**"신부입장 구간에서 어느 앵글을 몇 초씩 몇 컷"** 이라는 좁은 문제로 줄어든다.
100개 학습으로 실용 수준이 나오는 건 이 축소 덕분이다.

## 학습 데이터 등급

- **원본+보정본+완성본이 다 있는 프로젝트** → "많은 소스 중 *왜 저걸* 골랐나"까지 학습. 진짜 라벨.
- **완성본만 있는 프로젝트** → 소재 선택은 못 배우지만 컷 리듬·식순별 길이 배분·샷 순서 문법은 뽑힌다.

100개 중 원본이 남아있는 게 20~30개만 돼도 충분하다.

> ③단계 주의: 보정본은 색보정 때문에 **pHash로는 원본 매칭이 깨진다.**
> CLIP 임베딩 공간에서 매칭해야 색이 변해도 살아남는다. 여기서 성패가 갈린다.

## 환경

```bash
python3.11 / ffmpeg 8.0 (VideoToolbox 하드웨어 디코딩)
의존성: numpy, pillow, pyobjc(Vision), torch, transnetv2-pytorch
전용 venv (capcut-automation과 분리)
  python3.11 -m venv .venv
  .venv/bin/pip install numpy pillow pyobjc-framework-Vision pyobjc-framework-Quartz transnetv2-pytorch
  .venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
```
