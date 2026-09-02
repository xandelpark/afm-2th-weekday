#!/usr/bin/env python3
"""
Sony 카메라 XML 사이드카 파서 — 멀티캠 동기화용.

촬영본 클립마다 C0001M01.XML 같은 사이드카가 붙어 있다.
"같은 순간을 거치캠·스냅캠이 각각 어떻게 담았나"를 붙이는 게 슬롯 매칭의 전제다.

⚠ **동기화 기준은 LTC가 아니라 CreationDate(실시각)다.**
   실데이터 확인 결과 이 LTC는 **레코드런**(녹화 중에만 진행)이라 카메라가 멈춘
   시간이 누락된다. 촬영시각과 TC의 차이가 클립마다 흘러가서 기준으로 못 쓴다:
     거치캠 +4.55h → +4.78h,  스냅캠 +5.96h → +7.47h
   근거: 거치캠 C0001이 06:55:27:11에 끝나고 C0002가 06:55:27:12에 시작 —
   파일 크기 한계로 쪼개진 하나의 연속 녹화이며, 그 사이 정지 구간이 TC에 없다.

   LTC의 쓸모는 따로 있다: **TC가 이어지면 같은 연속 녹화**라는 판정이다.

   동기화 전략
     1차: CreationDate로 초 단위 정렬 (카메라 시계 오차만큼 틀어짐)
     2차: scan.py가 뽑아둔 16kHz 오디오로 상호상관 → 프레임 단위 보정

LTC value는 Sony BCD 패킹이다. 8자리 16진수를 바이트로 끊으면 [프레임][초][분][시] 순이고,
각 바이트의 상위 니블에는 드롭프레임/컬러프레임 플래그 비트가 섞여 있어 마스킹이 필요하다.
  0x55 → 하위 니블 5(1의 자리), 상위 니블 5 & 0b11 = 1(10의 자리) → 15프레임

검증: C0001M01.XML의 시작 06:32:56:15 → 끝 06:55:27:11 = 1350.9초,
      Duration 40484프레임 / 29.97fps = 1350.8초. 일치.

사용:
    .venv/bin/python sonyxml.py "/경로/거치캠"
"""
import os
import re
import sys
from datetime import datetime


def _bcd(byte, tens_mask):
    """BCD 한 바이트 → 정수. 상위 니블의 플래그 비트를 마스킹한다."""
    return ((byte >> 4) & tens_mask) * 10 + (byte & 0x0F)


def decode_ltc(value):
    """LTC 패킹값 → (시, 분, 초, 프레임).

    value는 **16진 문자열**이다 (실데이터 246개 전부 a-f를 포함해 확정: "58C60905").
    16진 문자열을 왼쪽부터 바이트로 끊으면 [프레임][초][분][시] 순이므로,
    정수로 만들면 시(hour)가 최하위 바이트가 된다.
    """
    v = int(value, 16)
    b = [(v >> (8 * i)) & 0xFF for i in range(4)]   # b[0]=시 … b[3]=프레임
    return (
        _bcd(b[0], 0b11),   # 시   (0~23)
        _bcd(b[1], 0b111),  # 분   (0~59)
        _bcd(b[2], 0b111),  # 초   (0~59)
        _bcd(b[3], 0b11),   # 프레임 (상위 니블에 드롭/컬러프레임 플래그)
    )


def tc_to_seconds(tc, fps):
    h, m, s, f = tc
    return h * 3600 + m * 60 + s + (f / fps if fps else 0)


def parse(path):
    """XML 사이드카 1개 → dict. 실패하면 None."""
    try:
        raw = open(path, encoding="utf-8", errors="ignore").read()
    except OSError:
        return None

    def attr(tag, name):
        m = re.search(rf'<{tag}\b[^>]*\b{name}="([^"]*)"', raw)
        return m.group(1) if m else None

    fps_raw = attr("VideoFrame", "captureFps") or ""
    m = re.match(r"([0-9.]+)", fps_raw)
    fps = float(m.group(1)) if m else 0.0

    dur_frames = attr("Duration", "value")
    dur_frames = int(dur_frames) if dur_frames else 0

    ltc = re.findall(r'<LtcChange\b[^>]*frameCount="(\d+)"[^>]*value="(\d+)"', raw)
    start_tc = decode_ltc(ltc[0][1]) if ltc else None
    end_tc = decode_ltc(ltc[-1][1]) if len(ltc) > 1 else None

    created = attr("CreationDate", "value")

    return {
        "xml": path,
        "fps": fps,
        "duration_frames": dur_frames,
        "duration_sec": round(dur_frames / fps, 3) if fps else 0.0,
        "start_tc": start_tc,
        "end_tc": end_tc,
        "start_sec": round(tc_to_seconds(start_tc, fps), 3) if start_tc else None,
        "created": created,
        "camera": attr("Device", "modelName"),
        "codec": attr("VideoFrame", "videoCodec"),
    }


def fmt_tc(tc):
    return "%02d:%02d:%02d:%02d" % tc if tc else "—"


def find_video(xml_path):
    """사이드카에 대응하는 영상 파일 경로. C0001M01.XML → C0001.MP4"""
    d = os.path.dirname(xml_path)
    base = os.path.basename(xml_path)
    stem = re.sub(r"M\d+\.XML$", "", base, flags=re.I)
    for ext in (".MP4", ".mp4", ".MOV", ".mov"):
        p = os.path.join(d, stem + ext)
        if os.path.exists(p):
            return p
    return None


def main():
    target = sys.argv[1]
    xmls = []
    if os.path.isdir(target):
        for root, _, files in os.walk(target):
            xmls += [os.path.join(root, f) for f in files if f.upper().endswith(".XML")]
    else:
        xmls = [target]
    xmls.sort()

    print(f"{'클립':<14} {'카메라':<12} {'fps':>6}  {'시작TC':<12} {'끝TC':<12} "
          f"{'길이':>8}  검증")
    print("-" * 78)
    ok = bad = 0
    for x in xmls:
        r = parse(x)
        if not r:
            continue
        # 시작~끝 TC 차이가 Duration과 맞는지 = 디코딩이 옳다는 증거
        verdict = "—"
        if r["start_tc"] and r["end_tc"] and r["fps"]:
            span = tc_to_seconds(r["end_tc"], r["fps"]) - tc_to_seconds(r["start_tc"], r["fps"])
            if span < 0:
                span += 24 * 3600      # 자정 넘김
            diff = abs(span - r["duration_sec"])
            if diff < 1.0:
                verdict = "OK"
                ok += 1
            else:
                verdict = f"불일치 {diff:.1f}s"
                bad += 1
        v = find_video(x)
        name = os.path.basename(v) if v else os.path.basename(x) + "(영상없음)"
        print(f"{name:<14} {str(r['camera']):<12} {r['fps']:>6.2f}  "
              f"{fmt_tc(r['start_tc']):<12} {fmt_tc(r['end_tc']):<12} "
              f"{r['duration_sec']:>7.1f}s  {verdict}")
    print("-" * 78)
    print(f"TC 디코딩 검증: 일치 {ok} / 불일치 {bad}")


if __name__ == "__main__":
    main()
