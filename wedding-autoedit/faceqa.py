#!/usr/bin/env python3
"""
얼굴 품질·표정 분석 — '이 컷이 인물 컷으로 쓸 만한가'를 수치화한다.

왜 필요한가
    지금까지 쓰던 신호는 샷사이즈·인원·선명도뿐이다. 편집자가 실제로 보는 것,
    즉 **눈을 떴는가 · 웃고 있는가 · 얼굴이 잘 보이는가**는 하나도 안 봤다.
    1fps·480px 썸네일로는 애초에 보이지도 않았다.

무엇을 쓰는가
    1) VNDetectFaceCaptureQuality — 애플이 사진 앱 베스트샷 선정에 쓰는 점수.
       흐림·가림·표정·조명을 종합한 0~1 값이라 우리가 따로 만들 필요가 없다.
    2) 얼굴 랜드마크 — 눈 개폐(EAR)와 입꼬리로 눈감음·웃음을 잰다.
    3) roll/yaw — 고개가 돌아가 정면이 아닌 컷을 걸러낸다.
"""
import os
import sys

import numpy as np
import Quartz
import Vision

_CFURLCreate = Quartz.CFURLCreateFromFileSystemRepresentation
_SrcURL = Quartz.CGImageSourceCreateWithURL
_SrcCount = Quartz.CGImageSourceGetCount
_SrcImage = Quartz.CGImageSourceCreateImageAtIndex
_Handler = Vision.VNImageRequestHandler
_QualityReq = Vision.VNDetectFaceCaptureQualityRequest
_LandmarkReq = Vision.VNDetectFaceLandmarksRequest


def _cgimage(path):
    b = path.encode("utf-8")
    url = _CFURLCreate(None, b, len(b), False)
    src = _SrcURL(url, None)
    if src is None or _SrcCount(src) == 0:
        return None
    return _SrcImage(src, 0, None)


def _pts(region):
    """VNFaceLandmarkRegion2D → (N,2) 정규화 좌표."""
    if region is None:
        return None
    n = region.pointCount()
    if not n:
        return None
    out = np.empty((n, 2), np.float32)
    for i in range(n):
        p = region.normalizedPoints()[i]
        out[i] = (p.x, p.y)
    return out


def _ear(eye):
    """Eye Aspect Ratio — 눈 세로/가로. 감으면 급격히 작아진다."""
    if eye is None or len(eye) < 4:
        return None
    w = eye[:, 0].max() - eye[:, 0].min()
    h = eye[:, 1].max() - eye[:, 1].min()
    return float(h / w) if w > 1e-6 else None


def analyze_face(path):
    """이미지 1장 → 가장 큰 얼굴의 품질·표정 지표. 얼굴 없으면 None."""
    img = _cgimage(path)
    if img is None:
        return None
    handler = _Handler.alloc().initWithCGImage_options_(img, None)

    qreq = _QualityReq.alloc().init()
    lreq = _LandmarkReq.alloc().init()
    ok, _ = handler.performRequests_error_([qreq, lreq], None)
    if not ok:
        return None

    qres = qreq.results() or []
    lres = lreq.results() or []
    if not qres and not lres:
        return None

    # 가장 큰 얼굴 하나만 본다 (주 피사체)
    def area(o):
        b = o.boundingBox()
        return b.size.width * b.size.height

    out = {"face_quality": None, "ear": None, "smile": None,
           "roll": None, "yaw": None, "n_faces": len(qres or lres)}

    if qres:
        best = max(qres, key=area)
        q = best.faceCaptureQuality()
        out["face_quality"] = float(q) if q is not None else None

    if lres:
        best = max(lres, key=area)
        r = best.roll()
        y = best.yaw()
        out["roll"] = float(r) if r is not None else None
        out["yaw"] = float(y) if y is not None else None
        lm = best.landmarks()
        if lm is not None:
            le, re_ = _ear(_pts(lm.leftEye())), _ear(_pts(lm.rightEye()))
            vals = [v for v in (le, re_) if v is not None]
            out["ear"] = float(np.mean(vals)) if vals else None
            # 입꼬리가 입 중앙보다 위로 올라가면 웃음
            outer = _pts(lm.outerLips())
            if outer is not None and len(outer) >= 6:
                lo = outer[np.argmin(outer[:, 0])]
                hi = outer[np.argmax(outer[:, 0])]
                mid_y = outer[:, 1].mean()
                width = abs(hi[0] - lo[0])
                if width > 1e-6:
                    out["smile"] = float(((lo[1] + hi[1]) / 2 - mid_y) / width)
    return out


if __name__ == "__main__":
    for p in sys.argv[1:]:
        r = analyze_face(p)
        name = os.path.basename(p)
        if not r:
            print(f"{name:<28} 얼굴 없음")
            continue
        f = lambda v: f"{v:6.3f}" if v is not None else "   —  "
        print(f"{name:<28} 품질={f(r['face_quality'])} 눈={f(r['ear'])} "
              f"웃음={f(r['smile'])} roll={f(r['roll'])} yaw={f(r['yaw'])} "
              f"얼굴{r['n_faces']}")
