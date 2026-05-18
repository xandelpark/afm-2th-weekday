<#
.SYNOPSIS
  데일리테니스 자세분석 앱 — Windows 매장 PC 1-클릭 실행 스크립트.

.DESCRIPTION
  1) Node.js / ffmpeg / cloudflared 미설치면 winget으로 자동 설치
  2) node_modules 없으면 npm install
  3) server.js 별도 창에서 실행 (포트 3000)
  4) Cloudflare Quick Tunnel 별도 창에서 실행 → 로그에서 공개 URL 추출
  5) 공개 URL을 기본 브라우저로 자동 오픈

  매장 손님 폰은 어떤 네트워크(LTE/타사 와이파이)든 무관하게 QR로 접속 가능.

.NOTES
  요구사항:
    - Windows 10 1809+ / 11 (winget 내장)
    - 인터넷 연결
  사용:
    프로젝트 폴더의 start-store.ps1을 우클릭 → "PowerShell로 실행" 또는
    PowerShell에서:  .\start-store.ps1
#>

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$port = 3000

# ─────────────────────────────────────────────────────────────
# 0) winget 존재 확인
# ─────────────────────────────────────────────────────────────
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host "✗ winget이 없습니다. Windows 10 1809+ / 11이어야 합니다." -ForegroundColor Red
  Write-Host "  Microsoft Store에서 'App Installer'를 설치하면 winget이 들어옵니다." -ForegroundColor DarkGray
  pause
  exit 1
}

function Install-IfMissing {
  param([string]$Name, [string]$CheckCommand, [string]$WingetId)
  if (Get-Command $CheckCommand -ErrorAction SilentlyContinue) {
    Write-Host "  ✓ $Name 이미 설치됨" -ForegroundColor Green
    return
  }
  Write-Host "  → $Name 설치 중 (winget)..." -ForegroundColor Yellow
  winget install -e --id $WingetId --accept-source-agreements --accept-package-agreements --silent
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  ✗ $Name 설치 실패. 수동 설치 후 다시 실행해주세요." -ForegroundColor Red
    pause
    exit 1
  }
}

# ─────────────────────────────────────────────────────────────
# 1) 필수 도구 설치
# ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  🎾 데일리테니스 자세분석 — 매장 PC 부팅 시퀀스" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "[1/5] 필수 도구 점검" -ForegroundColor White
Install-IfMissing 'Node.js'    'node'        'OpenJS.NodeJS.LTS'
Install-IfMissing 'ffmpeg'     'ffmpeg'      'Gyan.FFmpeg'
Install-IfMissing 'cloudflared' 'cloudflared' 'Cloudflare.cloudflared'

# winget 직후 동일 세션에 PATH 반영 (새 도구 사용을 위해)
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [Environment]::GetEnvironmentVariable('Path', 'User')

# ─────────────────────────────────────────────────────────────
# 2) npm install (node_modules 없을 때만)
# ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[2/5] 의존성 설치 점검" -ForegroundColor White
Set-Location $projectRoot
if (-not (Test-Path (Join-Path $projectRoot 'node_modules'))) {
  Write-Host "  → npm install 실행..." -ForegroundColor Yellow
  npm install
  if ($LASTEXITCODE -ne 0) { Write-Host "  ✗ npm install 실패" -ForegroundColor Red; pause; exit 1 }
} else {
  Write-Host "  ✓ node_modules 존재 — 건너뜀" -ForegroundColor Green
}

# ─────────────────────────────────────────────────────────────
# 3) 서버 시작 (별도 창)
# ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[3/5] 서버 시작 (포트 $port)" -ForegroundColor White
$env:PORT = "$port"
$serverProc = Start-Process powershell -PassThru -ArgumentList @(
  '-NoExit',
  '-Command',
  "Set-Location '$projectRoot'; `$env:PORT='$port'; node server.js"
)
Write-Host "  ✓ 서버 창 띄움 (PID $($serverProc.Id))" -ForegroundColor Green

# 서버가 LISTEN 시작할 때까지 짧게 대기
Start-Sleep -Seconds 3

# ─────────────────────────────────────────────────────────────
# 4) Cloudflare Quick Tunnel 시작 + URL 캡처
# ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[4/5] 공개 터널 시작 (Cloudflare Quick Tunnel)" -ForegroundColor White

$tunnelLog = Join-Path $env:TEMP 'daily-tennis-tunnel.log'
if (Test-Path $tunnelLog) { Remove-Item $tunnelLog -Force }

$tunnelProc = Start-Process powershell -PassThru -ArgumentList @(
  '-NoExit',
  '-Command',
  "cloudflared tunnel --url http://localhost:$port --no-autoupdate 2>&1 | Tee-Object -FilePath '$tunnelLog'"
)
Write-Host "  → cloudflared 창 띄움 (PID $($tunnelProc.Id)). URL 대기..." -ForegroundColor Yellow

# 최대 40초간 로그에서 trycloudflare URL 추출
$publicUrl = $null
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $tunnelLog) {
    $content = Get-Content $tunnelLog -Raw -ErrorAction SilentlyContinue
    if ($content -and ($content -match 'https://[a-z0-9-]+\.trycloudflare\.com')) {
      $publicUrl = $matches[0]
      break
    }
  }
}

if (-not $publicUrl) {
  Write-Host "  ✗ 40초 내에 터널 URL을 찾지 못함." -ForegroundColor Red
  Write-Host "    cloudflared 창의 로그를 확인해주세요." -ForegroundColor DarkGray
  pause
  exit 1
}
Write-Host "  ✓ 공개 URL 확보: $publicUrl" -ForegroundColor Green

# ─────────────────────────────────────────────────────────────
# 5) 브라우저로 PC 매장 모니터 화면 오픈
# ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[5/5] 매장 모니터 브라우저 오픈" -ForegroundColor White
Start-Process $publicUrl
Write-Host "  ✓ 브라우저 띄움" -ForegroundColor Green

# ─────────────────────────────────────────────────────────────
# 완료 안내
# ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  ✅ 매장 운영 준비 완료" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "  📺 PC 매장 모니터: $publicUrl" -ForegroundColor White
Write-Host "  📱 손님 폰 QR 스캔: $publicUrl/upload?token=..." -ForegroundColor Gray
Write-Host ""
Write-Host "  • 손님 폰은 LTE/타사 와이파이 OK (매장 와이파이 불필요)" -ForegroundColor DarkGray
Write-Host "  • 종료하려면: 서버 창 + cloudflared 창 닫기" -ForegroundColor DarkGray
Write-Host "  • 다시 켤 때 터널 URL은 매번 새로 발급됨" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  창을 닫으려면 Enter ↵ (이 창은 닫혀도 서버/터널은 계속 돌아감)" -ForegroundColor DarkGray
Read-Host
