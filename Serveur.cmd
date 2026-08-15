@echo off
rem Demarre le serveur de Job Cockpit.
rem
rem Appele par la tache planifiee "JobCockpit - serveur" a l'ouverture de
rem session, via serveur-silencieux.vbs qui le lance sans fenetre.
rem Se lance aussi a la main par double-clic.
rem
rem Le compte rendu s'ajoute a serveur.log, dans ce meme dossier. Il reste
rem minuscule : le serveur n'ecrit qu'a son demarrage et en cas d'erreur.

chcp 65001 >nul
cd /d "%~dp0"

echo. >> serveur.log
echo ======================================== >> serveur.log
echo Demarrage du %date% a %time% >> serveur.log
echo ======================================== >> serveur.log

rem Pas de npm ici : sous PowerShell, npm passe par npm.ps1 et se heurte a la
rem strategie d'execution des scripts. node.exe s'appelle directement.
"C:\Program Files\nodejs\node.exe" src/server.js >> serveur.log 2>&1

echo [ARRET] le serveur s'est termine (code %errorlevel%) >> serveur.log
