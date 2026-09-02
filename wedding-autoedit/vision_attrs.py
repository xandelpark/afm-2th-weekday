#!/usr/bin/env python3
"""
슬롯 스펙의 '기계 측정 가능한 속성'을 뽑는 모듈.

맥 내장 Vision 프레임워크를 쓴다 — 모델 다운로드 없음, 하드웨어 가속, RAM 8GB에서도 안전.
CLIP/torch 없이 아래를 계산한다:

  shot_size     얼굴 높이가 프레임에서 차지하는 비율로 판정
  people_count  얼굴 수 + 뒤돌아선 사람까지 인체 검출로 보강
  face_area     최대 얼굴 면적비 (품질/구도 판단용)
  face_center   최대 얼굴 중심 좌표 (구도 판단용)

사용:
    from vision_attrs import analyze_image
    print(analyze_image("frame.jpg"))
"""
import os
import sys

import Quartz
import Vision

# pyobjc는 심볼을 '처음 쓸 때' 지연 로딩하는데 이 과정이 스레드 안전하지 않다.
# 워커 여러 개가 동시에 첫 호출을 하면 KeyError로 터진다.
#   실제로 발생: [1/119] C6545.MP4 — KeyError 'CFURLCreateFromFileSystemRepresentation'
#   (거치캠은 클립이 길어 타이밍이 어긋나 우연히 피했고, 5~10초짜리 스냅캠에서 재현됐다)
# 임포트 시점(=메인 스레드)에 미리 바인딩해 지연 로딩을 끝내둔다.
_CFURLCreate = Quartz.CFURLCreateFromFileSystemRepresentation
_CGImageSourceCreateWithURL = Quartz.CGImageSourceCreateWithURL
_CGImageSourceGetCount = Quartz.CGImageSourceGetCount
_CGImageSourceCreateImageAtIndex = Quartz.CGImageSourceCreateImageAtIndex
_CGImageGetWidth = Quartz.CGImageGetWidth
_CGImageGetHeight = Quartz.CGImageGetHeight
_VNImageRequestHandler = Vision.VNImageRequestHandler
_VNFaceReq = Vision.VNDetectFaceRectanglesRequest
_VNHumanReq = Vision.VNDetectHumanRectanglesRequest

# 얼굴 높이 / 프레임 높이 → 샷사이즈.
#
# ⚠ 이 값은 인물사진 감각이 아니라 **실촬영본 분포로 확정**한 것이다.
# 초기값(0.55/0.30/0.18/0.10/0.045)은 예식 영상에서 도달 불가였다:
#   실측 최대 얼굴높이비 — 거치캠 0.245 / 스냅캠 0.344 / 하이라이트 0.200
#   → extreme_closeup(≥0.55)은 0%, closeup(≥0.30)은 0.4%로 사실상 사용 불가.
# 4K 광각으로 찍는 예식 영상은 얼굴이 화면의 1/3을 넘는 일이 거의 없다.
#
# 아래 값 적용 시 스냅캠 분포: ext_cu 0.5% / closeup 4.6% / med_cu 15.8%
#                            / medium 46.4% / full 31.5%
# 원본이 하이라이트보다 타이트한 샷을 항상 더 많이 갖는 것도 확인했다
# (closeup 4.6% vs 2.1%) — 모든 슬롯에 후보가 존재한다는 뜻.
SHOT_SIZE_BINS = [
    (0.28, "extreme_closeup"),
    (0.19, "closeup"),
    (0.14, "medium_closeup"),
    (0.085, "medium"),
    (0.05, "full"),
    (0.0, "wide"),
]

# 얼굴이 안 잡힐 때(어두운 홀 와이드샷 등) 인체 높이로 폴백.
# 실측: 하객 80명 넘는 홀 전경에서 얼굴 검출은 0개였지만 인체는 잡혔다.
# 신부입장·행진의 핵심 컷이 여기 해당하므로 폴백이 없으면 스키마 절반이 무의미해진다.
BODY_SIZE_BINS = [
    (0.85, "medium_closeup"),
    (0.60, "medium"),
    (0.30, "full"),
    (0.0, "wide"),
]


def _cgimage(path):
    b = path.encode("utf-8")
    url = _CFURLCreate(None, b, len(b), False)
    src = _CGImageSourceCreateWithURL(url, None)
    if src is None or _CGImageSourceGetCount(src) == 0:
        return None
    return _CGImageSourceCreateImageAtIndex(src, 0, None)


def _run(handler, request):
    ok, err = handler.performRequests_error_([request], None)
    if not ok:
        return []
    return request.results() or []


def analyze_image(path):
    """이미지 1장의 속성. 얼굴이 없으면 shot_size=None(=판정 불가)."""
    img = _cgimage(path)
    if img is None:
        return None

    w = _CGImageGetWidth(img)
    h = _CGImageGetHeight(img)
    handler = _VNImageRequestHandler.alloc().initWithCGImage_options_(img, None)

    faces = _run(handler, _VNFaceReq.alloc().init())
    humans = _run(handler, _VNHumanReq.alloc().init())

    boxes = []
    for f in faces:
        bb = f.boundingBox()
        # Vision 좌표는 정규화 + 원점이 좌하단
        boxes.append({
            "w": bb.size.width, "h": bb.size.height,
            "cx": bb.origin.x + bb.size.width / 2,
            "cy": 1.0 - (bb.origin.y + bb.size.height / 2),  # 좌상단 기준으로 뒤집기
        })

    result = {
        "width": w, "height": h,
        "face_count": len(faces),
        "human_count": len(humans),
        # 뒤돌아선 하객까지 세려면 인체 검출이 더 크게 나온다 → 큰 쪽 채택
        "people_count": max(len(faces), len(humans)),
        "shot_size": None,
        "face_area": 0.0,
        "face_center": None,
    }

    if boxes:
        big = max(boxes, key=lambda b: b["w"] * b["h"])
        result["face_area"] = round(big["w"] * big["h"], 5)
        result["face_center"] = (round(big["cx"], 3), round(big["cy"], 3))
        result["face_height_ratio"] = round(big["h"], 4)
        for thr, name in SHOT_SIZE_BINS:
            if big["h"] >= thr:
                result["shot_size"] = name
                break
        result["shot_size_basis"] = "face"
    elif humans:
        # 얼굴이 안 잡히는 어두운 와이드샷 → 인체 높이로 판정
        hb = max((h.boundingBox() for h in humans),
                 key=lambda b: b.size.width * b.size.height)
        result["body_height_ratio"] = round(hb.size.height, 4)
        for thr, name in BODY_SIZE_BINS:
            if hb.size.height >= thr:
                result["shot_size"] = name
                break
        result["shot_size_basis"] = "body"
    else:
        # 사람이 아예 안 잡히는 컷(인서트: 반지·부케·홀 전경 등)
        result["shot_size_basis"] = None
    return result


if __name__ == "__main__":
    for p in sys.argv[1:]:
        r = analyze_image(p)
        name = os.path.basename(p)
        if not r:
            print(f"{name:<48} 읽기 실패")
            continue
        ratio = r.get("face_height_ratio") or r.get("body_height_ratio") or 0
        print(f"{name:<48} 얼굴 {r['face_count']} / 인체 {r['human_count']}  "
              f"샷사이즈={str(r['shot_size']):<16} "
              f"근거={str(r['shot_size_basis']):<5} 높이비={ratio:.3f}")
