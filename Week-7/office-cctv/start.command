#!/bin/bash
# 더블클릭으로 실행되는 macOS 시작 스크립트
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js가 설치되어 있지 않습니다."
  echo "   https://nodejs.org 에서 설치 후 다시 실행해주세요."
  read -p "엔터를 누르면 종료합니다."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "📦 의존성 설치 중..."
  npm install
fi

# 브라우저 자동 열기 (3초 후)
( sleep 3 && open "http://localhost:3030" ) &

# caffeinate -i: 서버가 떠 있는 동안 시스템 idle 잠자기 차단
exec /usr/bin/caffeinate -i node server.js
