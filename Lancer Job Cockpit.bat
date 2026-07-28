@echo off
chcp 65001 >nul
title Job Cockpit
cd /d "%~dp0"

echo.
echo   Job Cockpit - demarrage...
echo.

if not exist "node_modules" (
  echo   Premiere utilisation : installation des composants...
  echo   Cela peut prendre une minute.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   L'installation a echoue. Node.js est-il installe ?
    echo   Telecharge-le sur https://nodejs.org ^(bouton LTS^)
    echo.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  echo   ATTENTION : le fichier .env est absent.
  echo   Copie .env.example en .env et renseigne au moins une cle d'API.
  echo   Voir la section 2 du README.
  echo.
)

echo   Ouverture du navigateur sur http://localhost:3000
echo   Pour arreter : ferme cette fenetre ou fais Ctrl+C
echo.

start "" http://localhost:3000
call npm start

pause
