' 통합런처 - 콘솔창 없이 백그라운드로 실행
' (pythonw 로 실행해 검은 창이 뜨지 않으며, launcher.py 가 브라우저를 자동으로 엽니다)
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "pythonw launcher.py", 0, False
