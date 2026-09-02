#!/usr/bin/env python3
"""
⑤ 편집 계획 → 실제 영상 + 캡컷 draft.

빈 슬롯은 검은 화면에 '무엇을 찾아 넣어야 하는지'를 적어 넣는다.
채우지 못한 자리를 조용히 건너뛰면 사람이 못 알아채기 때문이다.

사용:
    .venv/bin/python render.py plan.json -o out.mp4
    .venv/bin/python render.py plan.json --capcut 프로젝트명
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

BASE = os.path.dirname(os.path.abspath(__file__))
W, H = 1920, 1080


_DUR_CACHE = {}


def clip_duration(path):
    if path not in _DUR_CACHE:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                            "format=duration", "-of", "csv=p=0", path],
                           capture_output=True, text=True)
        try:
            _DUR_CACHE[path] = float(r.stdout.strip())
        except ValueError:
            _DUR_CACHE[path] = None
    return _DUR_CACHE[path]


def seg_cmd(src, start, dur, out):
    return [
        "ffmpeg", "-y", "-v", "error", "-nostdin",
        "-ss", f"{start:.3f}", "-i", src, "-t", f"{dur:.3f}",
        "-vf", (f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
                f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30"),
        "-an", "-c:v", "h264_videotoolbox", "-b:v", "12M", out,
    ]


def blank_cmd(text, dur, out):
    safe = text.replace(":", "\\:").replace("'", "")
    return [
        "ffmpeg", "-y", "-v", "error", "-nostdin",
        "-f", "lavfi", "-i", f"color=c=0x1a1a1a:s={W}x{H}:d={dur:.3f}:r=30",
        "-vf", (f"drawtext=text='{safe}':fontcolor=white:fontsize=44:"
                f"x=(w-text_w)/2:y=(h-text_h)/2"),
        "-c:v", "h264_videotoolbox", "-b:v", "6M", out,
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("plan")
    ap.add_argument("-o", "--out", default="autoedit.mp4")
    ap.add_argument("--capcut", help="캡컷 draft도 생성 (프로젝트명)")
    ap.add_argument("--bgm", help="배경음악 파일 (영상 길이에 맞춰 반복)")
    ap.add_argument("--max-slots", type=int)
    args = ap.parse_args()

    d = json.load(open(args.plan))
    plan = d["plan"]
    if args.max_slots:
        plan = plan[: args.max_slots]

    tmp = tempfile.mkdtemp(prefix="autoedit_")
    parts = []
    filled = blanks = 0
    for i, p in enumerate(plan):
        out = os.path.join(tmp, f"{i:04d}.mp4")
        dur = max(float(p["duration"]), 0.5)
        if p.get("filled") and p.get("pick_path") and os.path.exists(p["pick_path"]):
            # 스냅캠 테이크가 5~10초로 짧아 슬롯 길이를 못 채우는 경우가 있다.
            # ffmpeg는 조용히 잘라내 컷이 짧아지므로, 시작점을 당겨 길이를 지킨다.
            src_dur = clip_duration(p["pick_path"])
            start = p["pick_t"]
            if src_dur and start + dur > src_dur:
                start = max(0.0, src_dur - dur)
                dur = min(dur, src_dur)
            r = subprocess.run(seg_cmd(p["pick_path"], start, dur, out),
                               capture_output=True, text=True)
            if r.returncode == 0 and os.path.getsize(out) > 1000:
                parts.append(out)
                filled += 1
                continue
        # 못 채웠거나 추출 실패 → 사람이 채울 자리를 명시한다
        label = f"슬롯 {p['slot']}  {p.get('shot_size') or '?'}  {dur:.1f}s"
        subprocess.run(blank_cmd(label, dur, out), capture_output=True)
        if os.path.exists(out):
            parts.append(out)
            blanks += 1
        print(f"  [{i+1}/{len(plan)}] {'✓' if p.get('filled') else '□'} "
              f"{p.get('pick_clip', '(빈칸)')}", flush=True)

    lst = os.path.join(tmp, "list.txt")
    with open(lst, "w") as fp:
        for p in parts:
            fp.write(f"file '{p}'\n")
    silent = os.path.join(tmp, "silent.mp4")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
                    "-i", lst, "-c", "copy", silent], check=True)
    if args.bgm and os.path.exists(args.bgm):
        # BGM은 영상 길이에 맞춰 반복하고 끝에서 2초 페이드아웃한다.
        total = float(subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", silent], capture_output=True,
            text=True).stdout.strip())
        subprocess.run([
            "ffmpeg", "-y", "-v", "error", "-i", silent,
            "-stream_loop", "-1", "-i", args.bgm,
            "-filter_complex",
            f"[1:a]afade=t=out:st={max(total-2,0):.2f}:d=2,volume=0.6[a]",
            "-map", "0:v", "-map", "[a]", "-t", f"{total:.3f}",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", args.out], check=True)
    else:
        shutil.move(silent, args.out)

    dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                          "format=duration", "-of", "csv=p=0", args.out],
                         capture_output=True, text=True).stdout.strip()
    print(f"\n완성: {args.out}  ({float(dur):.1f}초)")
    print(f"  채운 슬롯 {filled}개 / 빈칸 {blanks}개")

    if args.capcut:
        make_capcut(plan, args.capcut)
    shutil.rmtree(tmp, ignore_errors=True)


def make_capcut(plan, name):
    """pyCapCut로 캡컷 draft 생성 — 원본 클립을 그대로 타임라인에 얹는다."""
    sys.path.insert(0, os.path.join(BASE, "..", "capcut-automation", "pyCapCut"))
    try:
        import pycapcut as cc
        from pycapcut import trange
    except Exception as e:
        print(f"캡컷 draft 건너뜀: {e}")
        return
    folder = os.path.expanduser("~/Movies/CapCut/User Data/Projects/com.lveditor.draft")
    df = cc.DraftFolder(folder)
    script = df.create_draft(name, W, H, allow_replace=True)
    script.add_track(cc.TrackType.video)
    script.add_track(cc.TrackType.text)
    cur = 0
    for p in plan:
        dur_us = int(float(p["duration"]) * 1_000_000)
        if p.get("filled") and p.get("pick_path") and os.path.exists(p["pick_path"]):
            mat = cc.VideoMaterial(p["pick_path"])
            # 슬롯 길이가 남은 소재보다 길 수 있다(스냅캠 테이크가 5~10초로 짧다).
            # ffmpeg는 조용히 잘라내지만 캡컷은 거부하므로 여기서 명시적으로 맞춘다.
            start_us = int(p["pick_t"] * 1_000_000)
            if start_us + dur_us > mat.duration:
                start_us = max(0, mat.duration - dur_us)
            take = min(dur_us, mat.duration - start_us)
            if take < 300_000:                     # 0.3초도 못 쓰면 빈칸 처리
                script.add_segment(cc.TextSegment(
                    f"[소재부족] 슬롯 {p['slot']}", trange(cur, dur_us)))
                cur += dur_us
                continue
            seg = cc.VideoSegment(mat, trange(cur, take),
                                  source_timerange=trange(start_us, take))
            script.add_segment(seg)
            cur += take
            continue
        else:
            # 빈 슬롯은 자막으로 남긴다 — 무엇을 찾아 넣어야 하는지 보이게
            script.add_segment(cc.TextSegment(
                f"[빈칸] {p.get('shot_size') or '?'} {p['duration']:.1f}s",
                trange(cur, dur_us),
                clip_settings=cc.ClipSettings(transform_y=0.0)))
        cur += dur_us
    script.save()
    proj = os.path.join(folder, name)
    info = os.path.join(proj, "draft_info.json")
    content = os.path.join(proj, "draft_content.json")
    if os.path.exists(content):
        shutil.copy2(content, info)
    meta = os.path.join(proj, "draft_meta_info.json")
    if os.path.exists(meta):
        m = json.load(open(meta, encoding="utf-8"))
        m["tm_duration"] = cur
        json.dump(m, open(meta, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"캡컷 draft 생성: {name}  ({cur/1_000_000:.1f}초)")


if __name__ == "__main__":
    main()
