#!/bin/bash
# 실촬영본 배치 스캔.
# 폴더별로 --role을 정확히 나눠 넣는다. 재귀로 한 번에 훑으면 편집본이 raw로 박히고,
# 이미 스캔된 파일은 건너뛰므로 나중에 고칠 수 없다.
set -u
cd "$(dirname "$0")"
# -u : 출력 버퍼링 끄기. 없으면 로그를 파일로 리다이렉트했을 때
#      파일별 진행 줄이 버퍼에 갇혀서 한참 뒤에야 몰아서 나온다.
PY=".venv/bin/python -u"
ROOT="/Volumes/Extreme SSD/학습"

A="$ROOT/260425.홍주영.동서울웨딩컨벤션.마리안웨딩.노시진.123"
B="$ROOT/260425_서지민 양수범_광명 아이벡스_마리안웨딩"

run() {  # run <폴더> <프로젝트> <역할>
    echo ""
    echo "▶ [$3] $(basename "$1")"
    $PY scan.py "$1" -r --project "$2" --role "$3" -j 3
}

run "$A/거치캠"      260425_홍주영       raw
run "$A/스냅캠"      260425_홍주영       raw
run "$A/편집본"      260425_홍주영       final

run "$B/메인캠(205)" 260425_서지민양수범 raw
run "$B/서브캠(14)"  260425_서지민양수범 raw
run "$B/편집본"      260425_서지민양수범 final

echo ""
echo "════════ 전체 완료 ════════"
$PY -c "
import sqlite3
c=sqlite3.connect('features.db')
print('프로젝트        역할    영상   시간     컷')
print('-'*48)
for r in c.execute('''SELECT project, role, COUNT(*), SUM(duration)/3600.0,
                      (SELECT COUNT(*) FROM cuts WHERE source_id IN
                       (SELECT id FROM sources s2 WHERE s2.project=s.project AND s2.role=s.role))
                      FROM sources s GROUP BY project, role ORDER BY project, role'''):
    print(f'{r[0]:<16} {r[1]:<6} {r[2]:>4}  {r[3]:>6.2f}h  {r[4]:>6}')
"
