#!/usr/bin/env python3
"""
본식스냅 자동편집 — 1단계: 특징 스캐너

원본 영상을 '딱 한 번만' 디코딩해서 아래를 동시에 뽑아 특징 DB에 적재한다.
100GB 촬영본을 매번 다시 읽지 않기 위한 단계로, 이후 학습/편집은 전부 이 DB 위에서만 돈다.

  - 컷 경계(편집점) 타임코드      : ffmpeg scene score
  - 1fps 썸네일 (긴 변 320px)     : 이후 임베딩/사람 확인용
  - 16kHz 모노 오디오             : 식순 STT용 (opus, 원본의 1/1000 용량)
  - 프레임 품질 지표              : 선명도/밝기/대비/움직임

사용법:
    .venv/bin/python scan.py /Volumes/외장/본식_20250412 --project 본식_20250412 --role raw
    .venv/bin/python scan.py /Volumes/외장 --recursive          # 통째로 훑기
    .venv/bin/python scan.py ... --dry-run                      # 대상/용량만 확인

이미 스캔한 파일은 건너뛴다(경로+크기+수정시각 기준). 중간에 끊겨도 다시 돌리면 이어간다.
"""
import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from keepawake import KeepAwake

# 메인 스레드에서 미리 임포트해 pyobjc 지연 로딩을 끝내둔다.
# 워커 스레드 안에서 처음 임포트하면 동시 접근으로 KeyError가 난다(실제 발생 이력).
try:
    from vision_attrs import analyze_image as _ANALYZE
except Exception:
    _ANALYZE = None   # Vision 없는 환경이면 품질 지표만 채운다
from datetime import datetime, timezone

VIDEO_EXT = (".mp4", ".mov", ".m4v", ".mts", ".mxf", ".avi", ".mkv")

BASE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB = os.path.join(BASE, "features.db")
DEFAULT_STORE = os.path.join(BASE, "store")

SCENE_THRESHOLD = 20.0   # 컷으로 볼 scdet score (0~100). 낮추면 과분할, 높이면 놓침
SCENE_FLOOR = 5.0        # DB에 남겨둘 최소 score. 이 아래는 버린다.
                         # 곡선을 통째로 보관하므로 임계값 재조정 시 재디코딩이 불필요하다.
THUMB_HEIGHT = 480       # 썸네일 세로 해상도.
                         # 실측: 어두운 홀 와이드샷에서 Vision 인체 검출이
                         # 320px 이하에선 0개, 480px부터 정상. 신부입장·행진의
                         # 핵심 컷이라 여기서 낮추면 슬롯 매칭이 통째로 무너진다.
                         # 비용은 프레임당 17KB→30KB(1.8배), 100GB 기준 약 1.4GB.
SCAN_HEIGHT = 180        # 컷 검출용 축소 해상도 (작을수록 빠름)
FPS = 1                  # 썸네일 추출 fps. --fps 로 덮어쓴다.
                         # 1fps는 실제 촬영 프레임의 3%만 보는 것이라 표정·눈감음이
                         # 통째로 사라진다. 전체 분석에서는 5 이상을 쓴다.


# ─── DB ──────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS sources (
    id          INTEGER PRIMARY KEY,
    path        TEXT UNIQUE NOT NULL,
    project     TEXT,
    role        TEXT,              -- raw | graded | final
    size        INTEGER,
    mtime       REAL,
    duration    REAL,
    width       INTEGER,
    height      INTEGER,
    fps         REAL,
    has_audio   INTEGER,
    created_at  TEXT,              -- 촬영 시각 (메타데이터)
    scanned_at  TEXT,
    thumb_dir   TEXT,
    audio_path  TEXT
);
CREATE TABLE IF NOT EXISTS cuts (
    id          INTEGER PRIMARY KEY,
    source_id   INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    t           REAL NOT NULL,     -- 컷 시작 시각(초)
    score       REAL
);
CREATE TABLE IF NOT EXISTS frames (
    id          INTEGER PRIMARY KEY,
    source_id   INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    t           REAL NOT NULL,     -- 초
    thumb       TEXT,              -- store 기준 상대경로
    sharpness   REAL,              -- 라플라시안 분산: 초점/흔들림
    brightness  REAL,
    contrast    REAL,
    motion      REAL,              -- 직전 프레임 대비 변화량
    -- 아래는 vision_attrs(맥 Vision)로 채우는 슬롯 매칭용 속성
    shot_size   TEXT,              -- extreme_closeup|closeup|medium_closeup|medium|full|wide
    shot_basis  TEXT,              -- face | body | NULL(사람 없는 인서트)
    people_count INTEGER,
    face_count  INTEGER,
    face_ratio  REAL,              -- 최대 얼굴(없으면 인체) 높이 / 프레임 높이
    face_cx     REAL,              -- 최대 얼굴 중심 x (구도 판단용)
    face_cy     REAL
);
CREATE INDEX IF NOT EXISTS idx_cuts_src   ON cuts(source_id);
CREATE INDEX IF NOT EXISTS idx_frames_src ON frames(source_id);
"""


def open_db(path):
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
    return conn


DB_LOCK = threading.Lock()   # 워커 스레드들의 DB 쓰기 직렬화


# ─── ffprobe ─────────────────────────────────────────────────

def probe(path):
    """영상 메타데이터. 실패하면 None (손상 파일 건너뛰기용)."""
    cmd = [
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", path,
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if out.returncode != 0:
            return None
        info = json.loads(out.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError):
        return None

    v = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    if v is None:
        return None
    a = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), None)

    fmt = info.get("format", {})
    num, _, den = (v.get("r_frame_rate") or "0/1").partition("/")
    try:
        fps = float(num) / float(den) if float(den) else 0.0
    except ValueError:
        fps = 0.0

    tags = {**fmt.get("tags", {}), **v.get("tags", {})}
    created = tags.get("creation_time") or tags.get("com.apple.quicktime.creationdate")

    return {
        "duration": float(fmt.get("duration") or v.get("duration") or 0),
        "width": int(v.get("width") or 0),
        "height": int(v.get("height") or 0),
        "fps": fps,
        "has_audio": 1 if a else 0,
        "created_at": created,
    }


# ─── 1회 디코딩 스캔 ─────────────────────────────────────────

def extract(path, meta, thumb_dir, audio_path, scene_file, hwaccel=True, fps=1):
    """디코딩 1회로 컷 검출 + 썸네일 + 오디오를 동시에 뽑는다.

    filter_complex로 디코딩된 프레임을 split해서 두 갈래로 흘려보내므로,
    각각 따로 돌릴 때보다 대략 2~3배 빠르다.
    """
    os.makedirs(thumb_dir, exist_ok=True)

    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-nostdin"]
    if hwaccel:
        cmd += ["-hwaccel", "videotoolbox"]
    cmd += ["-i", path]

    # select로 컷만 걸러내면 컷이 하나도 없는 롱테이크에서 출력 스트림이 비어
    # ffmpeg이 죽는다. 전 프레임의 scene score를 그대로 뽑고 파이썬에서 거른다.
    # 곡선을 통째로 남기므로 나중에 임계값만 바꿔 재계산할 수 있다(재디코딩 불필요).
    fc = (
        f"[0:v]scale=-2:{SCAN_HEIGHT},split=2[sc][th];"
        f"[sc]scdet=threshold={SCENE_FLOOR},"
        f"metadata=print:file={_esc(scene_file)}[scv];"
        f"[th]fps={fps},scale=-2:{THUMB_HEIGHT}[thv]"
    )
    cmd += ["-filter_complex", fc]
    cmd += ["-map", "[scv]", "-an", "-f", "null", "-"]
    cmd += ["-map", "[thv]", "-q:v", "6", os.path.join(thumb_dir, "%06d.jpg")]
    if meta["has_audio"]:
        cmd += ["-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000",
                "-c:a", "libopus", "-b:a", "24k", audio_path]

    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 and hwaccel:
        # 하드웨어 디코더가 못 먹는 코덱이 있다 → 소프트웨어로 1회 재시도
        return extract(path, meta, thumb_dir, audio_path, scene_file, False, fps)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:500])


def _esc(p):
    """filter graph 안에 들어가는 파일경로 이스케이프."""
    return p.replace("\\", "\\\\").replace(":", r"\:").replace(",", r"\,").replace("'", r"\'")


def parse_scenes(scene_file):
    """scdet metadata 출력에서 (시각, score) 목록을 뽑는다.

    scdet은 전 프레임에 lavfi.scd.score(0~100)를 붙인다. SCENE_FLOOR 이상만 남겨
    DB에 넣어두고, '컷이냐 아니냐'는 조회 시점에 임계값으로 판단한다.
    """
    if not os.path.exists(scene_file):
        return []
    out, t = [], None
    with open(scene_file, encoding="utf-8", errors="ignore") as fp:
        for line in fp:
            m = re.search(r"pts_time:(-?[0-9.]+)", line)
            if m:
                t = float(m.group(1))
                continue
            m = re.search(r"lavfi\.scd\.score=([0-9.]+)", line)
            if m and t is not None:
                s = float(m.group(1))
                if s >= SCENE_FLOOR:
                    out.append((t, s))
                t = None
    return out


# ─── 프레임 품질 지표 ────────────────────────────────────────

def frame_metrics(thumb_dir, with_vision=True, fps=1):
    """썸네일을 훑어 선명도/밝기/대비/움직임 + 화면 속성(샷사이즈·인원)을 계산한다.
    RAM 8GB를 감안해 한 장씩만 메모리에 올린다."""
    import numpy as np
    from PIL import Image

    analyze = _ANALYZE if with_vision else None

    files = sorted(f for f in os.listdir(thumb_dir) if f.endswith(".jpg"))
    rows, prev = [], None
    for i, name in enumerate(files):
        fpath = os.path.join(thumb_dir, name)
        try:
            with Image.open(fpath) as im:
                g = np.asarray(im.convert("L"), dtype=np.float32)
        except Exception:
            continue

        # 라플라시안 분산 — 초점이 나가거나 흔들리면 급격히 떨어진다
        lap = (g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
               - 4.0 * g[1:-1, 1:-1])
        sharp = float(lap.var())
        bright = float(g.mean())
        contrast = float(g.std())

        if prev is not None and prev.shape == g.shape:
            motion = float(np.abs(g - prev).mean())
        else:
            motion = 0.0
        prev = g

        # 화면 속성은 부가 정보다. 여기서 터져도 파일 전체를 실패로 만들지 않는다
        # (속성이 비면 매칭에서 그 슬롯이 빈칸으로 남을 뿐 — 안전하게 실패한다).
        try:
            v = analyze(fpath) if analyze else None
        except Exception:
            v = None
        if v:
            vis = (v["shot_size"], v["shot_size_basis"], v["people_count"],
                   v["face_count"],
                   v.get("face_height_ratio") or v.get("body_height_ratio"),
                   (v["face_center"] or (None, None))[0],
                   (v["face_center"] or (None, None))[1])
        else:
            vis = (None, None, None, None, None, None, None)

        # n번째 썸네일의 시각 = n / fps
        rows.append((round(i / fps, 3), name, sharp, bright, contrast, motion) + vis)
    return rows


# ─── 파일 1개 처리 ───────────────────────────────────────────

def scan_file(conn, path, store, project, role):
    """(상태, 표시메시지)를 돌려준다. 출력은 호출측에서 모아 찍는다."""
    st = os.stat(path)
    with DB_LOCK:
        cur = conn.execute(
            "SELECT id, size, mtime FROM sources WHERE path=?", (path,)
        ).fetchone()
    if cur and cur[1] == st.st_size and abs((cur[2] or 0) - st.st_mtime) < 1:
        return "skipped", "· 건너뜀(이미 스캔)"

    meta = probe(path)
    if not meta or meta["duration"] <= 0:
        return "failed", "✗ 읽기 실패(손상 또는 영상 스트림 없음)"

    key = f"{project}__{os.path.splitext(os.path.basename(path))[0]}"
    key = re.sub(r"[^\w가-힣.-]", "_", key)
    thumb_dir = os.path.join(store, "thumbs", key)
    audio_path = os.path.join(store, "audio", f"{key}.ogg")
    scene_file = os.path.join(store, "tmp", f"{key}.scene.txt")
    for d in (thumb_dir, os.path.dirname(audio_path), os.path.dirname(scene_file)):
        os.makedirs(d, exist_ok=True)

    t0 = time.time()
    try:
        extract(path, meta, thumb_dir, audio_path, scene_file, fps=FPS)
    except RuntimeError as e:
        shutil.rmtree(thumb_dir, ignore_errors=True)
        return "failed", f"✗ 디코딩 실패 — {str(e).splitlines()[0][:160]}"

    cuts = parse_scenes(scene_file)
    frames = frame_metrics(thumb_dir, fps=FPS)
    os.remove(scene_file)

    with DB_LOCK:
        if cur:  # 재스캔이면 기존 특징을 갈아끼운다
            conn.execute("DELETE FROM sources WHERE id=?", (cur[0],))

        c = conn.execute(
            """INSERT INTO sources
               (path, project, role, size, mtime, duration, width, height, fps,
                has_audio, created_at, scanned_at, thumb_dir, audio_path)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (path, project, role, st.st_size, st.st_mtime, meta["duration"],
             meta["width"], meta["height"], meta["fps"], meta["has_audio"],
             meta["created_at"], datetime.now(timezone.utc).isoformat(),
             os.path.relpath(thumb_dir, store),
             os.path.relpath(audio_path, store) if meta["has_audio"] else None),
        )
        sid = c.lastrowid

        conn.executemany("INSERT INTO cuts (source_id, t, score) VALUES (?,?,?)",
                         [(sid, t, s) for t, s in cuts])
        rel = os.path.relpath(thumb_dir, store)
        conn.executemany(
            """INSERT INTO frames
               (source_id, t, thumb, sharpness, brightness, contrast, motion,
                shot_size, shot_basis, people_count, face_count, face_ratio,
                face_cx, face_cy)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            [(sid, r[0], os.path.join(rel, r[1])) + tuple(r[2:]) for r in frames],
        )
        conn.commit()

    el = time.time() - t0
    speed = meta["duration"] / el if el else 0
    ncut = sum(1 for _, s in cuts if s >= SCENE_THRESHOLD)
    return "scanned", (f"✓ {meta['duration']:.0f}초 / 컷 {ncut}개(후보 {len(cuts)}) / "
                       f"프레임 {len(frames)}장 ({el:.0f}초, {speed:.0f}x)")


# ─── 수집 ────────────────────────────────────────────────────

def collect(target, recursive):
    if os.path.isfile(target):
        return [os.path.abspath(target)]
    out = []
    if recursive:
        for root, dirs, files in os.walk(target):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            out += [os.path.join(root, f) for f in files
                    if f.lower().endswith(VIDEO_EXT) and not f.startswith(".")]
    else:
        out = [os.path.join(target, f) for f in sorted(os.listdir(target))
               if f.lower().endswith(VIDEO_EXT) and not f.startswith(".")]
    return sorted(os.path.abspath(p) for p in out)


def human(n):
    for u in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f}{u}"
        n /= 1024
    return f"{n:.1f}PB"


def main():
    ap = argparse.ArgumentParser(description="본식스냅 자동편집 특징 스캐너")
    ap.add_argument("target", help="영상 파일 또는 폴더")
    ap.add_argument("--project", help="프로젝트명 (기본: 폴더명)")
    ap.add_argument("--role", default="raw", choices=["raw", "graded", "final"],
                    help="raw=원본 촬영본, graded=보정본, final=완성본")
    ap.add_argument("--recursive", "-r", action="store_true", help="하위 폴더까지")
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--store", default=DEFAULT_STORE, help="썸네일/오디오 저장 위치")
    ap.add_argument("--fps", type=float, default=1.0,
                    help="썸네일 추출 fps (기본 1). 5면 표정·눈감음까지 잡힌다")
    ap.add_argument("--jobs", "-j", type=int, default=3,
                    help="동시 처리 파일 수 (기본 3. RAM 8GB 기준 안전선)")
    ap.add_argument("--allow-sleep", action="store_true",
                    help="스캔 중 절전/화면잠금 허용 (기본은 막는다)")
    ap.add_argument("--screen-off", action="store_true",
                    help="화면은 꺼지게 두고 작업만 유지 (전력 절약)")
    ap.add_argument("--dry-run", action="store_true", help="대상만 확인하고 종료")
    ap.add_argument("--limit", type=int, help="앞에서 N개만 (테스트용)")
    args = ap.parse_args()

    global FPS
    FPS = args.fps
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg이 없습니다: brew install ffmpeg")

    files = collect(args.target, args.recursive)
    if args.limit:
        files = files[: args.limit]
    if not files:
        sys.exit(f"영상 파일이 없습니다: {args.target}")

    total = sum(os.path.getsize(f) for f in files)
    project = args.project or os.path.basename(os.path.abspath(args.target.rstrip("/")))

    print(f"\n프로젝트: {project} / 역할: {args.role}")
    print(f"대상: {len(files)}개 파일, {human(total)}")
    print(f"특징 DB: {args.db}")
    print(f"저장소: {args.store}\n")

    if args.dry_run:
        for f in files[:20]:
            print(f"  {human(os.path.getsize(f)):>9}  {f}")
        if len(files) > 20:
            print(f"  ... 외 {len(files) - 20}개")
        return

    free = shutil.disk_usage(os.path.dirname(os.path.abspath(args.store)) or ".").free
    print(f"저장소 여유공간: {human(free)}  (썸네일+오디오는 원본의 약 1~2% 차지)\n")

    conn = open_db(args.db)
    tally = {"scanned": 0, "skipped": 0, "failed": 0}
    t0 = time.time()
    done = 0
    n = len(files)

    # ffmpeg이 대부분의 시간을 쓰므로 스레드로 충분하다(GIL 밖에서 돈다).
    # RAM 8GB를 감안해 워커당 ffmpeg 1개씩만 띄운다.
    try:
        with KeepAwake(enabled=not args.allow_sleep,
                       display=not args.screen_off), \
             ThreadPoolExecutor(max_workers=args.jobs) as pool:
            futs = {
                pool.submit(scan_file, conn, f, args.store, project, args.role): f
                for f in files
            }
            for fut in as_completed(futs):
                f = futs[fut]
                done += 1
                try:
                    status, msg = fut.result()
                except Exception as e:
                    status, msg = "failed", f"✗ 예외: {type(e).__name__} {e}"
                tally[status] += 1
                print(f"[{done}/{n}] {os.path.basename(f)} — {msg}")
    except KeyboardInterrupt:
        print("\n중단됨. 다시 실행하면 이어서 진행합니다.")

    el = time.time() - t0
    print(f"\n완료 — 신규 {tally['scanned']} / 건너뜀 {tally['skipped']} / "
          f"실패 {tally['failed']}  ({el / 60:.1f}분)")

    row = conn.execute(
        "SELECT COUNT(*), COALESCE(SUM(duration),0) FROM sources"
    ).fetchone()
    ncuts = conn.execute("SELECT COUNT(*) FROM cuts").fetchone()[0]
    print(f"누적: 영상 {row[0]}개 / {row[1] / 3600:.1f}시간 / 컷 {ncuts}개")
    conn.close()


if __name__ == "__main__":
    main()
