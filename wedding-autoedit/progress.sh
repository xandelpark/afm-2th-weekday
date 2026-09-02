#!/bin/bash
# 스캔 진행률 보기. 언제든 실행해도 되고, 스캔에 영향을 주지 않는다.
#   ./progress.sh        한 번 보고 끝
#   ./progress.sh -w     2초마다 갱신 (Ctrl+C로 중단)
cd "$(dirname "$0")"

TOTAL_FILES=350   # 거치캠4 + 스냅캠119 + 편집본4 + 메인캠205 + 서브캠14 + 편집본4

show() {
    if pgrep -f "scan_batch.sh" >/dev/null; then
        ET=$(ps -o etime= -p "$(pgrep -f scan_batch.sh | head -1)" | tr -d ' ')
        STATE="🟢 진행 중 (경과 $ET)"
    else
        STATE="⚪️ 종료됨"
    fi

    .venv/bin/python - "$TOTAL_FILES" "$STATE" <<'PY'
import sqlite3, sys, os, subprocess
total_files, state = int(sys.argv[1]), sys.argv[2]
try:
    c = sqlite3.connect('file:features.db?mode=ro', uri=True)
    n, hrs = c.execute("SELECT COUNT(*), COALESCE(SUM(duration),0)/3600 FROM sources").fetchone()
    rows = c.execute("""SELECT project, role, COUNT(*), COALESCE(SUM(duration),0)/3600
                        FROM sources GROUP BY project, role ORDER BY project, role""").fetchall()
except Exception:
    n, hrs, rows = 0, 0.0, []

# 진행 중인 파일: DB에 아직 없지만 썸네일이 쌓이고 있는 것
inflight = 0
if os.path.isdir('store/thumbs'):
    done = {os.path.basename(r) for r in
            [x[0] for x in (c.execute("SELECT thumb_dir FROM sources").fetchall() if n else [])]}
    for d in os.listdir('store/thumbs'):
        if d not in done:
            inflight += 1

pct = n / total_files * 100
bar = '█' * int(pct / 2.5) + '░' * (40 - int(pct / 2.5))

print(f"\n  {state}")
print(f"\n  [{bar}] {pct:5.1f}%")
print(f"  파일 {n}/{total_files}개 완료" + (f" (+{inflight}개 처리 중)" if inflight else ""))
print(f"  영상 {hrs:.2f}시간 분석 완료")
if rows:
    print()
    for p, role, cnt, h in rows:
        print(f"    {p:<18} {role:<6} {cnt:>4}개  {h:>5.2f}h")
try:
    sz = subprocess.run(['du','-sh','store'], capture_output=True, text=True).stdout.split()[0]
    print(f"\n  특징 저장소: {sz}")
except Exception:
    pass
print()
PY
}

if [ "${1:-}" = "-w" ]; then
    while true; do clear; show; sleep 2; done
else
    show
fi
