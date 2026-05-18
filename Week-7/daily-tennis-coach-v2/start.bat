@echo off
REM ============================================================
REM  데일리테니스 자세분석 — Windows 1-클릭 실행 진입점
REM
REM  이 파일을 더블클릭하면:
REM    1) PowerShell 실행 정책(ExecutionPolicy) 우회
REM    2) start-store.ps1 호출
REM    3) Node / ffmpeg / cloudflared 자동 설치
REM    4) 서버 + Cloudflare 터널 + 브라우저 자동 오픈
REM ============================================================

chcp 65001 >nul
cd /d "%~dp0"

REM PowerShell 7(pwsh) 우선, 없으면 기본 PowerShell 5.1 사용
where pwsh >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    pwsh -NoProfile -ExecutionPolicy Bypass -File ".\start-store.ps1"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File ".\start-store.ps1"
)

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [오류] start-store.ps1 실행 실패. 위 메시지를 확인하세요.
    pause
)
