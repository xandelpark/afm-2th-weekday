#!/bin/bash
# Office CCTV — 로그인 시 자동 시작 등록
# macOS LaunchAgent (~/Library/LaunchAgents/com.craw.office-cctv.plist)

set -e
cd "$(dirname "$0")"
APP_DIR="$(pwd)"
NODE_BIN="$(command -v node || echo /opt/homebrew/bin/node)"
PLIST_NAME="com.craw.office-cctv.plist"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME"

if [ ! -x "$NODE_BIN" ]; then
  echo "❌ Node.js를 찾을 수 없습니다. https://nodejs.org 에서 설치 후 다시 실행하세요."
  read -p "엔터로 종료." _
  exit 1
fi

# 의존성 설치
if [ ! -d node_modules ]; then
  echo "📦 의존성 설치..."
  npm install --silent
fi

mkdir -p "$HOME/Library/LaunchAgents"

# 서버 + 브라우저 자동 오픈 래퍼
# caffeinate -i: 서버가 떠 있는 동안 시스템 idle 잠자기 차단 (디스플레이는 꺼져도 됨)
RUNNER="$APP_DIR/autostart-runner.sh"
cat > "$RUNNER" <<EOF
#!/bin/bash
cd "$APP_DIR"
# 서버가 처음 켜진 직후 한 번만 브라우저 오픈
( sleep 6 && /usr/bin/curl -s http://localhost:3030/ >/dev/null && /usr/bin/open "http://localhost:3030" ) &
exec /usr/bin/caffeinate -i "$NODE_BIN" "$APP_DIR/server.js"
EOF
chmod +x "$RUNNER"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.craw.office-cctv</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$RUNNER</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$APP_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$APP_DIR/cctv.log</string>
    <key>StandardErrorPath</key>
    <string>$APP_DIR/cctv.err.log</string>
</dict>
</plist>
EOF

# 기존 등록이 있으면 내리고 새로 등록
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo ""
echo "✅ 자동 시작 등록 완료"
echo ""
echo "   - 다음 로그인부터 자동으로 서버가 켜집니다."
echo "   - 지금부터 계속 켜져 있습니다 (백그라운드)."
echo "   - 브라우저: http://localhost:3030"
echo "   - 로그: $APP_DIR/cctv.log"
echo ""
echo "   ※ 카메라 캡처는 브라우저 탭이 떠 있어야 동작합니다."
echo "     해제: uninstall-autostart.command 실행"
echo ""

# 브라우저 자동 오픈
sleep 2
open "http://localhost:3030"

read -p "엔터로 종료." _
