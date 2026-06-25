@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [오류] Python이 필요합니다.
  echo  Python을 설치한 뒤 다시 실행해 주세요. ^(https://www.python.org^)
  echo.
  pause
  exit /b 1
)

echo 런처를 시작합니다... 브라우저가 자동으로 열립니다.
echo 이 창을 닫으면 런처가 종료됩니다.
python launcher.py
