@echo off
rem Windows: clique duas vezes -> abre o painel em http://localhost:8765; a prospeccao e iniciada por la
cd /d "%~dp0"
where python >nul 2>nul || (
  echo Python nao encontrado, instalando via winget...
  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
  echo Feche esta janela e abra o rodar.bat de novo.
  pause & exit /b
)
echo Painel em http://localhost:8765  (deixe esta janela aberta)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8765"
rem impede o PC de dormir enquanto a janela estiver aberta (volta ao normal ao fechar)
powershell -NoProfile -Command "Add-Type -Name P -Namespace W -MemberDefinition '[DllImport(\"kernel32.dll\")]public static extern uint SetThreadExecutionState(uint e);'; [W.P]::SetThreadExecutionState(0x80000001) > $null; python -X utf8 painel.py"
pause
