#!/usr/bin/env python3
"""
하이라이트(완성본) 전용 컷 검출 — TransNetV2.

ffmpeg의 scdet은 하드컷만 잡고 디졸브/크로스페이드를 통째로 놓친다.
(실측: 하드컷 score 28.7 vs 1초 크로스페이드 0.9 — 검출 0개)
하이라이트엔 디졸브가 깔리므로 scdet만 쓰면 두 컷이 한 슬롯으로 뭉개진
오염된 템플릿이 만들어진다. 템플릿이 근간인 설계라 치명적이다.

그래서 완성본에만 TransNetV2를 쓴다. 원본 촬영본은 애초에 편집점이 없으므로
scan.py의 scdet(28x 실시간)을 그대로 쓴다 — 100GB에 신경망을 돌릴 이유가 없다.

사용:
    .venv/bin/python shotdetect.py 하이라이트.mp4
    .venv/bin/python shotdetect.py 하이라이트.mp4 --threshold 0.5 --json out.json
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np
import torch

from transnetv2_pytorch import TransNetV2

from keepawake import KeepAwake

BASE = os.path.dirname(os.path.abspath(__file__))
WEIGHTS = os.path.join(BASE, "models", "transnetv2-pytorch-weights.pth")

# TransNetV2가 학습된 입력 규격 — 바꾸면 안 된다
IN_W, IN_H = 48, 27
WINDOW = 100          # 한 번에 보는 프레임 수
STRIDE = 50           # 앞뒤 25프레임은 문맥용, 가운데 50개만 채택
PAD = 25


def load_model(device=None):
    """기본은 CPU. 패키지가 MPS 수치 불일치를 경고하는데, 템플릿의 근간이 되는
    검출이라 속도보다 정확성을 택한다. 실측상 MPS가 2.8배 빠르고 테스트에선
    결과가 일치했으므로, 급하면 --device mps 로 열 수 있게 해둔다."""
    if device is None:
        device = "cpu"
    model = TransNetV2(device=device)
    state = torch.load(WEIGHTS, map_location="cpu", weights_only=True)
    model.load_state_dict(state)
    model.eval().to(device)
    return model, device


def read_frames(path):
    """영상 전체를 48x27 RGB로 뽑는다. 프레임당 3.9KB라 1시간짜리도 500MB 안쪽."""
    cmd = [
        "ffmpeg", "-v", "error", "-nostdin", "-i", path,
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-vf", f"scale={IN_W}:{IN_H}", "-",
    ]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode()[:300])
    buf = np.frombuffer(r.stdout, dtype=np.uint8)
    n = len(buf) // (IN_W * IN_H * 3)
    return buf[: n * IN_W * IN_H * 3].reshape(n, IN_H, IN_W, 3)


@torch.no_grad()
def predict(model, device, frames, batch=8):
    """프레임별 전환 확률. 원본 구현과 동일한 패딩/윈도 규칙을 따른다."""
    n = len(frames)
    tail = STRIDE - (n % STRIDE) if n % STRIDE else 0
    padded = np.concatenate(
        [np.repeat(frames[:1], PAD, axis=0), frames,
         np.repeat(frames[-1:], PAD + tail, axis=0)], axis=0
    )

    windows, ptr = [], 0
    while ptr + WINDOW <= len(padded):
        windows.append(padded[ptr:ptr + WINDOW])
        ptr += STRIDE

    out = []
    for i in range(0, len(windows), batch):
        chunk = np.stack(windows[i:i + batch])
        x = torch.from_numpy(chunk).to(device)
        single, _ = model(x)
        p = torch.sigmoid(single)[:, PAD:PAD + STRIDE, 0]
        out.append(p.cpu().numpy().reshape(-1))
    return np.concatenate(out)[:n]


def to_scenes(prob, threshold=0.5):
    """전환 확률 → 씬 구간 [(시작프레임, 끝프레임), ...]"""
    scenes, start, inside = [], 0, False
    for i, p in enumerate(prob):
        if p > threshold:
            if not inside:
                if i > start:
                    scenes.append((start, i - 1))
                inside = True
        else:
            if inside:
                start = i
                inside = False
    if not inside and start < len(prob):
        scenes.append((start, len(prob) - 1))
    return scenes


def fps_of(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", path],
        capture_output=True, text=True)
    num, _, den = r.stdout.strip().partition("/")
    try:
        return float(num) / float(den or 1)
    except ValueError:
        return 30.0


def detect(path, threshold=0.5, model=None, device=None):
    if model is None:
        model, device = load_model()
    frames = read_frames(path)
    prob = predict(model, device, frames)
    fps = fps_of(path)
    scenes = to_scenes(prob, threshold)
    return {
        "path": path, "fps": fps, "frame_count": len(frames),
        "cuts": [round(s / fps, 3) for s, _ in scenes[1:]],  # 씬 시작 = 컷 지점
        "scenes": [{"start": round(s / fps, 3), "end": round((e + 1) / fps, 3),
                    "duration": round((e + 1 - s) / fps, 3)} for s, e in scenes],
    }


def main():
    ap = argparse.ArgumentParser(description="하이라이트 컷 검출 (TransNetV2)")
    ap.add_argument("videos", nargs="+")
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--device", choices=["cpu", "mps"], default="cpu",
                    help="mps가 2.8배 빠르지만 수치 불일치 경고가 있다 (기본 cpu)")
    ap.add_argument("--json", help="결과를 JSON으로 저장")
    ap.add_argument("--allow-sleep", action="store_true",
                    help="추론 중 절전/화면잠금 허용 (기본은 막는다)")
    ap.add_argument("--screen-off", action="store_true",
                    help="화면은 꺼지게 두고 작업만 유지 (전력 절약)")
    args = ap.parse_args()

    if not os.path.exists(WEIGHTS):
        sys.exit(f"가중치가 없습니다: {WEIGHTS}")

    model, device = load_model(args.device)
    print(f"디바이스: {device}\n")

    results = []
    with KeepAwake(enabled=not args.allow_sleep, display=not args.screen_off):
        for v in args.videos:
            r = detect(v, args.threshold, model, device)
            results.append(r)
            print(f"{os.path.basename(v)} — {r['frame_count']}프레임 @ {r['fps']:.2f}fps")
            print(f"  씬 {len(r['scenes'])}개 / 컷 {len(r['cuts'])}개")
            for t in r["cuts"][:20]:
                print(f"    컷 @ {t:.3f}s")
            if len(r["cuts"]) > 20:
                print(f"    ... 외 {len(r['cuts']) - 20}개")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fp:
            json.dump(results, fp, ensure_ascii=False, indent=2)
        print(f"\n저장: {args.json}")


if __name__ == "__main__":
    main()
