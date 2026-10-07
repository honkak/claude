@echo off
rem Daily report launcher - double-click to start
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\goodocs-relay\goodocs-relay-server.ps1"
if errorlevel 1 pause
