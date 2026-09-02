#!/bin/bash
# 코워크 서버 시작 (셸을 닫아도 계속 실행된다)
cd "$(dirname "$0")"
if lsof -ti:3011 >/dev/null 2>&1; then
  echo "이미 실행 중 (pid $(lsof -ti:3011))"; exit 0
fi
nohup node server.js >> server.log 2>&1 &
sleep 3
if lsof -ti:3011 >/dev/null 2>&1; then
  echo "시작됨 → http://localhost:3011 (pid $(lsof -ti:3011))"
else
  echo "시작 실패 — server.log 확인"; tail -20 server.log
fi
