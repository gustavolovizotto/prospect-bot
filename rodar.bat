@echo off
rem Windows: clique duas vezes, ou: rodar.bat "Campinas,Sorocaba"
cd /d "%~dp0"
where python >nul 2>nul || (
  echo Python nao encontrado, instalando via winget...
  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
  echo Feche esta janela e abra o rodar.bat de novo.
  pause & exit /b
)
set "CIDADES=%~1"
if "%CIDADES%"=="" set /p "CIDADES=Cidades separadas por virgula [Campinas]: "
if "%CIDADES%"=="" set "CIDADES=Campinas"
rem impede o PC de dormir enquanto a janela estiver aberta (volta ao normal ao fechar)
powershell -NoProfile -Command "Add-Type -Name P -Namespace W -MemberDefinition '[DllImport(\"kernel32.dll\")]public static extern uint SetThreadExecutionState(uint e);'; [W.P]::SetThreadExecutionState(0x80000001) > $null; python -X utf8 -u bot.py --cidades '%CIDADES%' --loop 2>&1 | Tee-Object -Append run.log"
pause
