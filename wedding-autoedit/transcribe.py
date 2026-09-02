#!/usr/bin/env python3
"""
오디오 전사 — 놀고 있던 신호를 쓴다.

왜 필요한가
    지금까지 영상 프레임의 3%만, 그것도 핸드헬드 18%만 보고 판단했다.
    오디오는 350개를 뽑아놓고 한 번도 안 썼다.
    사회자 멘트("신랑 신부 입장")가 식순 경계를 그대로 알려주는데 버리고 있었다.

    특히 거치캠·서브캠은 예식 내내 연속 녹음이라 식순 전체가 담겨 있다.
    하이라이트에 안 쓰인다고 통째로 제외한 게 잘못이었다 — 영상은 안 써도
    **오디오는 식순 축의 근거**가 된다.

사용:
    .venv/bin/python transcribe.py --continuous     # 거치캠·서브캠(연속녹음)만
    .venv/bin/python transcribe.py --all
"""
import argparse
import json
import os
import sqlite3
import time

from faster_whisper import WhisperModel

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "features.db")
STORE = os.path.join(BASE, "store")

SCHEMA = """
CREATE TABLE IF NOT EXISTS transcript (
    id        INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    start     REAL NOT NULL,      -- 클립 내 초
    end       REAL NOT NULL,
    text      TEXT,
    prob      REAL                -- 평균 로그확률 (신뢰도)
);
CREATE INDEX IF NOT EXISTS idx_tr_src ON transcript(source_id);
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="large-v3-turbo",
                    help="turbo 권장. large-v3는 CPU에서 8배 느려 실측 47분간 0건이었다")
    ap.add_argument("--continuous", action="store_true",
                    help="거치캠·서브캠(연속녹음)만")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--project")
    args = ap.parse_args()

    conn = sqlite3.connect(DB)
    conn.executescript(SCHEMA)

    where = "s.audio_path IS NOT NULL"
    if args.continuous:
        where += " AND (s.path LIKE '%거치캠%' OR s.path LIKE '%서브캠%')"
    if args.project:
        where += f" AND s.project = '{args.project}'"
    rows = conn.execute(f"""SELECT s.id, s.path, s.audio_path, s.duration
        FROM sources s WHERE {where} AND s.duration > 30
        ORDER BY s.created_at""").fetchall()

    done = {r[0] for r in conn.execute("SELECT DISTINCT source_id FROM transcript")}
    rows = [r for r in rows if r[0] not in done]
    total = sum(r[3] for r in rows)
    print(f"대상 {len(rows)}개 / {total/3600:.2f}시간  (이미 완료 {len(done)}개 제외)")
    if not rows:
        return

    # 맥에서는 CPU int8이 가장 안정적이다 (MPS는 미지원)
    # 맥은 MPS 미지원이라 CPU int8. 스레드를 절반만 써서
    # 동시에 도는 스캔 작업과 CPU를 나눠 쓴다.
    import os as _os
    model = WhisperModel(args.model, device="cpu", compute_type="int8",
                         cpu_threads=max(2, (_os.cpu_count() or 4) // 2))
    print(f"모델 {args.model} 로드 완료\n")

    t0 = time.time()
    for n, (sid, path, apath, dur) in enumerate(rows, 1):
        full = os.path.join(STORE, apath)
        if not os.path.exists(full):
            continue
        t1 = time.time()
        segs, info = model.transcribe(
            full, language="ko", beam_size=5,
            vad_filter=True,                       # 무음 구간 건너뛰기
            vad_parameters={"min_silence_duration_ms": 700})
        buf = []
        for s in segs:
            buf.append((sid, s.start, s.end, s.text.strip(), s.avg_logprob))
        conn.executemany(
            "INSERT INTO transcript (source_id,start,end,text,prob) VALUES (?,?,?,?,?)",
            buf)
        conn.commit()
        el = time.time() - t1
        print(f"[{n}/{len(rows)}] {os.path.basename(path):<14} "
              f"{dur/60:5.1f}분 → 문장 {len(buf):>4}개  "
              f"({el/60:.1f}분, {dur/el:.1f}x)", flush=True)

    print(f"\n완료 — {(time.time()-t0)/60:.1f}분")
    n = conn.execute("SELECT COUNT(*) FROM transcript").fetchone()[0]
    print(f"전사 문장 누적 {n:,}개")


if __name__ == "__main__":
    main()
