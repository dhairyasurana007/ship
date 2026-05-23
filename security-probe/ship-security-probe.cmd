@echo off
setlocal
set SCRIPT_DIR=%~dp0
"%ProgramFiles%\nodejs\npx.cmd" tsx "%SCRIPT_DIR%index.ts" %*
endlocal
