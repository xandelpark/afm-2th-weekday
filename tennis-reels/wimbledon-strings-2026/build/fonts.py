# -*- coding: utf-8 -*-
"""폰트 헬퍼 (시스템 폰트 폴백, magazine-reel §0-3 대체안)."""
from PIL import ImageFont

DIDOT = "/System/Library/Fonts/Supplemental/Didot.ttc"
MYUNGJO = "/System/Library/Fonts/Supplemental/AppleMyungjo.ttf"
SDGOTHIC = "/System/Library/Fonts/AppleSDGothicNeo.ttc"
BEBAS = "/System/Library/PrivateFrameworks/FontServices.framework/Versions/A/Resources/Fonts/ApplicationSupport/BebasNeue.otf"

_cache = {}


def _f(path, size, index=0):
    key = (path, size, index)
    if key not in _cache:
        _cache[key] = ImageFont.truetype(path, size, index=index)
    return _cache[key]


def Di(size):
    """Didot Regular — 영문 에디토리얼 세리프."""
    return _f(DIDOT, size, 0)


def DiIt(size):
    """Didot Italic — 영문 악센트."""
    return _f(DIDOT, size, 1)


def DiBd(size):
    """Didot Bold — 거대 숫자용."""
    return _f(DIDOT, size, 2)


def Be(size):
    """Bebas Neue — 영문 키커/라벨 (ASCII·숫자·—·· 만, 한글 금지)."""
    return _f(BEBAS, size, 0)


def Mj(size):
    """AppleMyungjo — 한글(+라틴) 세리프 본문."""
    return _f(MYUNGJO, size, 0)


def Sd(size, weight="semibold"):
    """AppleSDGothicNeo — 한글 헤비/임팩트 헤드라인. weight: regular/medium/semibold."""
    idx = {"regular": 0, "medium": 2, "semibold": 4}.get(weight, 4)
    return _f(SDGOTHIC, size, idx)
