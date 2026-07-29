@echo off
rem Collecte automatique de Job Cockpit.
rem
rem Appele par la tache planifiee Windows "JobCockpit - collecte", toutes les
rem 6 heures. Se lance aussi a la main par double-clic, sans risque : deux
rem collectes ne peuvent pas se marcher dessus, la base est en mode WAL.
rem
rem Le compte rendu s'ajoute a collect.log, dans ce meme dossier.

chcp 65001 >nul
cd /d "%~dp0"

echo. >> collect.log
echo ======================================== >> collect.log
echo Collecte du %date% a %time% >> collect.log
echo ======================================== >> collect.log

"C:\Program Files\nodejs\node.exe" scripts/collect.js >> collect.log 2>&1

if errorlevel 1 (
  echo [ECHEC] code %errorlevel% >> collect.log
) else (
  echo [OK] collecte terminee >> collect.log
)
