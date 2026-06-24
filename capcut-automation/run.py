#!/usr/bin/env python3
"""
캡컷 자동 편집 — 폴더의 클립들을 순서대로 타임라인에 배치하고,
자막(subs.txt) + BGM(bgm.mp3)을 자동으로 깔아 CapCut draft를 생성한다.

사용법:
    .venv/bin/python run.py                 # 기본: sources/ -> drafts/
    .venv/bin/python run.py 프로젝트이름

음성 없는 영상도 그대로 자동화된다(자막은 subs.txt 기준, 음성 STT 아님).
맥에서는 draft 생성까지 자동 / 최종 export는 CapCut에서 직접.
"""
import os
import sys

# 클론한 pyCapCut 패키지를 import 경로에 추가
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "pyCapCut"))
import pycapcut as cc
from pycapcut import trange

# ─── 경로 설정 ───────────────────────────────────────────────
BASE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.join(BASE, "sources")
CLIPS_DIR = os.path.join(SOURCES, "clips")
SUBS_FILE = os.path.join(SOURCES, "subs.txt")
BGM_FILE = os.path.join(SOURCES, "bgm.mp3")

# CapCut 실제 draft 폴더 → 생성하면 캡컷 첫 화면에 바로 프로젝트로 뜬다.
DRAFT_FOLDER = os.path.expanduser(
    "~/Movies/CapCut/User Data/Projects/com.lveditor.draft"
)
# 검증/테스트만 하고 싶으면 아래 줄 주석을 풀어 로컬 폴더로 생성:
# DRAFT_FOLDER = os.path.join(BASE, "drafts")

# 영상 규격 (세로 9:16 릴스 기준)
WIDTH, HEIGHT = 1080, 1920


def _post_process(proj_path, total_us):
    """최신 CapCut(8.x) 호환 후처리.
    - pyCapCut는 draft_content.json을 쓰지만 최신 CapCut은 draft_info.json을 읽는다 → 복사.
    - draft_meta_info.json의 tm_duration을 채워 홈 화면 길이가 0으로 안 뜨게 한다.
    """
    import json
    content = os.path.join(proj_path, "draft_content.json")
    info = os.path.join(proj_path, "draft_info.json")
    if os.path.exists(content):
        import shutil
        shutil.copy2(content, info)  # 최신 CapCut이 읽는 파일명
    meta = os.path.join(proj_path, "draft_meta_info.json")
    if os.path.exists(meta):
        with open(meta, encoding="utf-8") as fp:
            m = json.load(fp)
        m["tm_duration"] = total_us
        with open(meta, "w", encoding="utf-8") as fp:
            json.dump(m, fp, ensure_ascii=False)


def main(project_name="자동편집_demo"):
    draft_folder = cc.DraftFolder(DRAFT_FOLDER)
    script = draft_folder.create_draft(project_name, WIDTH, HEIGHT, allow_replace=True)

    # 트랙 3개: 영상 / 자막(텍스트) / 오디오
    script.add_track(cc.TrackType.video)
    script.add_track(cc.TrackType.text)
    script.add_track(cc.TrackType.audio)

    # 1) 클립 폴더에서 파일명 순서대로 영상 배치
    clip_files = sorted(
        f for f in os.listdir(CLIPS_DIR)
        if f.lower().endswith((".mp4", ".mov", ".m4v"))
    )
    subs = []
    if os.path.exists(SUBS_FILE):
        with open(SUBS_FILE, encoding="utf-8") as fp:
            subs = [line.strip() for line in fp if line.strip()]

    cursor = 0  # 타임라인 현재 위치(마이크로초)
    for i, name in enumerate(clip_files):
        mat = cc.VideoMaterial(os.path.join(CLIPS_DIR, name))
        seg = cc.VideoSegment(mat, trange(cursor, mat.duration))
        script.add_segment(seg)

        # 2) 해당 클립 구간에 자막 깔기 (subs.txt 줄 순서대로 매칭)
        if i < len(subs):
            text = cc.TextSegment(
                subs[i],
                trange(cursor, mat.duration),
                clip_settings=cc.ClipSettings(transform_y=-0.75),  # 화면 하단
            )
            script.add_segment(text)

        cursor += mat.duration

    total = cursor  # 전체 영상 길이

    # 3) BGM 전체에 깔기 (영상 길이에 맞춰 자름, 볼륨 60%)
    if os.path.exists(BGM_FILE):
        bgm = cc.AudioMaterial(BGM_FILE)
        dur = min(bgm.duration, total)
        audio = cc.AudioSegment(BGM_FILE, trange(0, dur), volume=0.6)
        audio.add_fade("0s", "1s")  # 끝에 1초 페이드아웃
        script.add_segment(audio)

    script.save()
    _post_process(os.path.join(DRAFT_FOLDER, project_name), total)

    sec = total / 1_000_000
    print(f"✅ draft 생성 완료: {project_name}")
    print(f"   - 클립 {len(clip_files)}개 / 자막 {min(len(subs), len(clip_files))}줄 / 전체 {sec:.1f}초")
    print(f"   - 위치: {os.path.join(DRAFT_FOLDER, project_name)}")


if __name__ == "__main__":
    name = sys.argv[1] if len(sys.argv) > 1 else "자동편집_demo"
    main(name)
