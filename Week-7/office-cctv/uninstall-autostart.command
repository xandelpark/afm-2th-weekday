#!/bin/bash
# Office CCTV — 자동 시작 해제
PLIST_PATH="$HOME/Library/LaunchAgents/com.craw.office-cctv.plist"

if [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm "$PLIST_PATH"
  echo "✅ 자동 시작 해제 완료"
else
  echo "ℹ️  등록된 자동 시작이 없습니다."
fi

read -p "엔터로 종료." _
