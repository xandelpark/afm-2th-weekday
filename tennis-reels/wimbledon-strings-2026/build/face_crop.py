# -*- coding: utf-8 -*-
"""
얼굴 인식 자동 크롭 (dailytennis 매거진 표준).
OpenCV haar cascade(frontal default + alt2 + profile, 좌우반전 포함)로
가장 큰 얼굴을 찾아 대상 비율에 맞춰 얼굴을 중앙정렬한다.
"""
import cv2
import numpy as np
from PIL import Image

_CASCADES = None


def _load_cascades():
    global _CASCADES
    if _CASCADES is not None:
        return _CASCADES
    base = cv2.data.haarcascades
    _CASCADES = [
        cv2.CascadeClassifier(base + "haarcascade_frontalface_default.xml"),
        cv2.CascadeClassifier(base + "haarcascade_frontalface_alt2.xml"),
        cv2.CascadeClassifier(base + "haarcascade_profileface.xml"),
    ]
    return _CASCADES


def _detect_faces(gray):
    """모든 캐스케이드 + 좌우반전으로 얼굴 후보를 모은다."""
    faces = []
    h, w = gray.shape[:2]
    for casc in _load_cascades():
        for flipped in (False, True):
            img = cv2.flip(gray, 1) if flipped else gray
            found = casc.detectMultiScale(
                img, scaleFactor=1.08, minNeighbors=5, minSize=(int(w * 0.08), int(w * 0.08))
            )
            for (x, y, fw, fh) in found:
                if flipped:
                    x = w - x - fw
                faces.append((x, y, fw, fh))
    return faces


def face_crop(src_path, target_w, target_h, out_path=None):
    """
    src_path 이미지를 target_w x target_h 비율로 얼굴 중심 크롭.
    - crop_h = min(img_h, face_h*2.0)
    - crop_w = crop_h*aspect (초과 시 img_w로 클램프)
    - 가로 = 얼굴 중심, 세로 = 얼굴을 상단 44% 지점(headroom)에 두고 클램프
    - 미검출 시 상단중심 폴백
    반환: PIL.Image (target_w x target_h로 최종 리사이즈됨)
    """
    aspect = target_w / target_h
    pil_img = Image.open(src_path).convert("RGB")
    # EXIF orientation 보정
    from PIL import ImageOps
    pil_img = ImageOps.exif_transpose(pil_img)
    img_w, img_h = pil_img.size

    cv_img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)

    faces = _detect_faces(gray)

    if faces:
        # 가장 큰 얼굴(면적 기준)
        fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
        face_cx = fx + fw / 2.0
        face_cy = fy + fh / 2.0

        crop_h = min(img_h, fh * 2.0)
        crop_w = crop_h * aspect
        if crop_w > img_w:
            crop_w = img_w
            crop_h = crop_w / aspect

        # 가로: 얼굴 중심
        left = face_cx - crop_w / 2.0
        # 세로: 얼굴을 상단 44% 지점에 (headroom)
        top = face_cy - crop_h * 0.44

        left = max(0, min(left, img_w - crop_w))
        top = max(0, min(top, img_h - crop_h))
        box = (int(left), int(top), int(left + crop_w), int(top + crop_h))
        detected = True
    else:
        # 폴백: 상단 중심
        crop_h = img_h
        crop_w = crop_h * aspect
        if crop_w > img_w:
            crop_w = img_w
            crop_h = crop_w / aspect
        left = (img_w - crop_w) / 2.0
        top = 0
        box = (int(left), int(top), int(left + crop_w), int(top + crop_h))
        detected = False

    cropped = pil_img.crop(box).resize((target_w, target_h), Image.LANCZOS)
    if out_path:
        cropped.save(out_path)
    return cropped, detected, box


if __name__ == "__main__":
    import sys
    src, tw, th, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    _, det, box = face_crop(src, tw, th, out)
    print("detected:", det, "box:", box, "->", out)
