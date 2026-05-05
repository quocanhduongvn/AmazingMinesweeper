@echo off
title Amazing Minesweeper Local Server
echo ==========================================
echo    DANG KHOI DONG LOCAL SERVER...
echo    Link: http://localhost:8080
echo ==========================================
echo.
echo [1/2] Dang mo trinh duyet...
start http://localhost:8080
echo [2/2] Dang chay server (Nhan Ctrl+C de dung)...
echo.
python -m http.server 8080
pause
