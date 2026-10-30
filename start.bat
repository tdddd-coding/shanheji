@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel%==0 (
  python serve.py
  goto :end
)

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 serve.py
  goto :end
)

echo.
echo 未找到 Python。请先安装 Python 3.8+，或手动运行：
echo   python serve.py
echo.
pause
exit /b 1

:end
if errorlevel 1 pause
