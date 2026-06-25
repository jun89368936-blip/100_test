@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ========================================
echo   일괄 파일명 변경기 exe 빌드
echo ========================================
echo.

echo [1/2] 의존성 확인...
python -m pip install -r requirements.txt
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] 의존성 설치 실패
    pause
    exit /b 1
)

echo.
echo [1.5/2] 엔진 테스트 실행...
python test_renamer_core.py
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] 테스트 실패 — 빌드 중단
    pause
    exit /b 1
)

echo.
echo [2/2] PyInstaller 빌드 중...
python -m PyInstaller "파일명변경기.spec" --clean -y
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] 빌드 실패
    pause
    exit /b 1
)

echo.
echo 빌드 완료!
echo   폴더: dist\일괄파일명변경기\
echo   실행: dist\일괄파일명변경기\일괄파일명변경기.exe
echo.
set /p DO_ZIP=배포 zip 으로 압축할까요? (Y/N):
if /i "%DO_ZIP%"=="Y" (
    powershell -Command "Compress-Archive -Path 'dist\일괄파일명변경기' -DestinationPath 'dist\일괄파일명변경기.zip' -Force"
    echo   zip: dist\일괄파일명변경기.zip
)
pause
