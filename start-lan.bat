@echo off
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel%==0 (
  py -3 "%~dp0host.py"
  goto done
)
if exist "C:\Program Files\Python314\python.exe" (
  "C:\Program Files\Python314\python.exe" "%~dp0host.py"
  goto done
)
where python >nul 2>&1
if %errorlevel%==0 (
  python "%~dp0host.py"
  goto done
)
echo Python was not found. Install Python, then run this again.
:done
if errorlevel 1 pause
