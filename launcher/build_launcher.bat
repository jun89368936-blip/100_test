@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ================================================
echo  통합런처 EXE 빌드
echo ================================================
echo.

where python >nul 2>nul
if errorlevel 1 ( echo [오류] Python이 필요합니다. & pause & exit /b 1 )

echo [1/3] 패키지 확인/설치...
pip install flask pyinstaller --upgrade --quiet

echo [2/3] EXE 빌드... (1~2분)
python -m PyInstaller --onefile --windowed --name "통합런처" --noconfirm launcher.py
if errorlevel 1 ( echo [오류] 빌드 실패. & pause & exit /b 1 )

echo [3/3] exe 를 런처 폴더로 복사 (tools.json 옆)...
copy /Y "dist\통합런처.exe" "통합런처.exe" >nul

echo.
echo 완료! 이제 이 폴더의 통합런처.exe 를 더블클릭하면 됩니다.
echo (바탕화면 바로가기도 이 exe 를 가리키게 해두었습니다)
pause
