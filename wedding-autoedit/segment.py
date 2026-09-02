#!/usr/bin/env python3
"""
② 식순 분할 — 사회자 멘트에서 예식 구간 경계를 찾는다.

왜 필요한가
    지금은 '촬영 당일 진행률'을 축으로 쓴다. 하지만 예식마다 일정이 다르고
    카메라를 껐다 켰다 하므로 시계로는 같은 상황을 못 찾는다.
    실측: 시간 축 매칭은 기저 대비 1.21배에 그쳤다.

    "45분 지점"을 "신부입장 구간 3번째 컷"으로 바꾸면 탐색 범위가
    12분에서 해당 식순 구간으로 좁혀진다. 예식장이 달라도 신부입장은 신부입장이다.

어떻게
    사회자는 식순을 반드시 말로 알린다("신랑 입장하겠습니다").
    Whisper 전사에서 그 문구를 찾아 경계로 삼는다.
    Whisper가 한국어를 자주 틀리므로(팔짱→팔참) 정확한 문자열이 아니라
    **핵심 형태소 조합**으로 느슨하게 잡는다.

사용:
    .venv/bin/python segment.py 260425_홍주영
    .venv/bin/python segment.py --all --save
"""
import argparse
import os
import re
import sqlite3
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "features.db")

# 식순 정의. 각 항목은 (이름, 필수어 목록, 보조어 목록).
# 필수어가 하나라도 있고 보조어가 하나 이상이면 경계로 본다.
# Whisper 오인식을 감안해 짧고 흔한 형태소를 쓴다.
STAGES = [
    ("신랑입장",  ["신랑"],           ["입장", "들어오", "등장"]),
    ("신부입장",  ["신부"],           ["입장", "들어오", "등장"]),
    ("맞절",      ["맞절", "인사"],   ["신랑", "신부", "부모", "혼주"]),
    ("혼인서약",  ["서약", "성혼"],   ["선언", "낭독", "혼인", "묻겠"]),
    ("축가",      ["축가"],           ["불러", "부르", "준비", "순서"]),
    ("행진",      ["행진"],           ["신랑", "신부", "퇴장", "나가"]),
    ("단체사진",  ["사진", "촬영"],   ["단체", "가족", "친구", "찍겠", "모여"]),
    ("폐백",      ["폐백"],           []),
]


def norm(s):
    return re.sub(r"\s+", "", s or "")


def match_stage(text):
    t = norm(text)
    for name, must, aux in STAGES:
        if not any(m in t for m in must):
            continue
        if not aux or any(a in t for a in aux):
            return name
    return None


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def find_boundaries(conn, project):
    """연속녹음의 전사에서 식순 경계를 뽑는다. 촬영 실시각 기준."""
    rows = conn.execute("""
        SELECT s.id, s.path, s.created_at, t.start, t.end, t.text
        FROM transcript t JOIN sources s ON s.id = t.source_id
        WHERE s.project = ?
        ORDER BY s.created_at, t.start""", (project,)).fetchall()
    if not rows:
        return [], None

    t0 = min(ts(r[2]) for r in rows)
    hits = []
    for sid, path, ca, st, en, text in rows:
        stage = match_stage(text)
        if stage:
            hits.append({
                "stage": stage,
                "abs": ts(ca) + st - t0,
                "clip": os.path.basename(path),
                "clip_t": round(st, 1),
                "text": text.strip(),
            })
    return hits, t0


def dedupe(hits, gap=120):
    """같은 식순이 연달아 잡히면 첫 번째만 남긴다(사회자가 반복해 말함)."""
    out = []
    for h in hits:
        prev = next((o for o in reversed(out) if o["stage"] == h["stage"]), None)
        if prev and h["abs"] - prev["abs"] < gap:
            continue
        out.append(h)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("project", nargs="?")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--save", action="store_true")
    args = ap.parse_args()

    conn = sqlite3.connect(DB)
    if args.save:
        conn.execute("""CREATE TABLE IF NOT EXISTS stages (
            id INTEGER PRIMARY KEY, project TEXT, stage TEXT,
            abs_t REAL, clip TEXT, clip_t REAL, text TEXT)""")

    projects = ([r[0] for r in conn.execute(
        "SELECT DISTINCT project FROM sources ORDER BY project")]
        if args.all else [args.project])

    for p in projects:
        hits, t0 = find_boundaries(conn, p)
        if not hits:
            print(f"[{p}] 전사 없음 — transcribe.py 먼저 실행")
            continue
        hits = dedupe(hits)
        print(f"\n═══ {p} — 식순 경계 {len(hits)}개 ═══")
        for h in hits:
            m, s = divmod(int(h["abs"]), 60)
            print(f"  {m:>3}:{s:02d}  {h['stage']:<8} "
                  f"{h['clip']} {h['clip_t']:.0f}s  \"{h['text'][:40]}\"")
        if args.save:
            conn.execute("DELETE FROM stages WHERE project=?", (p,))
            conn.executemany(
                "INSERT INTO stages (project,stage,abs_t,clip,clip_t,text) "
                "VALUES (?,?,?,?,?,?)",
                [(p, h["stage"], h["abs"], h["clip"], h["clip_t"], h["text"])
                 for h in hits])
            conn.commit()
    if args.save:
        print("\n저장 완료 (stages 테이블)")


if __name__ == "__main__":
    main()
