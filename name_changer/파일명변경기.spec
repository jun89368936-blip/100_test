# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec — 일괄 파일명 변경기 (onedir 배포)

빌드: build_release.bat  실행  (또는  pyinstaller 파일명변경기.spec --clean -y)
"""
import os
from PyInstaller.utils.hooks import collect_all

# tkinterdnd2: 플랫폼별 tkdnd DLL 폴더 전체 포함 (드래그&드롭)
tkdnd_datas, tkdnd_binaries, tkdnd_hidden = collect_all("tkinterdnd2")

a = Analysis(
    ["main.py"],
    pathex=[os.path.abspath(".")],
    binaries=tkdnd_binaries,
    datas=tkdnd_datas + ([("icon.ico", ".")] if os.path.exists("icon.ico") else []),
    hiddenimports=tkdnd_hidden + [
        "tkinter", "tkinter.ttk", "tkinter.filedialog", "tkinter.messagebox",
        "renamer_core",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["matplotlib", "numpy", "pandas", "scipy", "cv2",
              "PyQt5", "PyQt6", "PySide2", "PySide6"],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

# onedir 방식: onefile 은 실행 시마다 압축 해제(30~60초)가 발생하므로
# 폴더 배포(onedir)로 즉시 실행되게 한다.
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="일괄파일명변경기",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="icon.ico" if os.path.exists("icon.ico") else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="일괄파일명변경기",
)
