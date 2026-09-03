@echo off
cd /d "%~dp0"
echo Starte Docker-Container (Datenbank, Redis, Mailpit)...
docker compose up -d --wait
if errorlevel 1 (
    echo.
    echo Fehler beim Starten der Docker-Container.
    echo Ist Docker Desktop geoeffnet und fertig gestartet?
    pause
    exit /b 1
)
echo.
echo Docker laeuft. Starte Backend...
echo.
cd backend
deno task dev
pause
