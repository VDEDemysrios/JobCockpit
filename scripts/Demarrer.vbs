' Démarre Job Cockpit sans fenêtre, à l'ouverture de session.
'
' COLLECTE_AUTO=1 fait collecter le serveur lui-même toutes les 6 heures.
' C'est ce qui permet de n'avoir plus QU'UNE tâche planifiée : l'ancienne
' paire « une tâche pour le serveur, une pour la collecte » ne se justifiait
' que parce que le serveur ne savait pas collecter seul.
'
' POURQUOI PASSER PAR CMD PLUTÔT QUE LANCER L'EXE DIRECTEMENT
' -----------------------------------------------------------
' Une fenêtre masquée n'écrit nulle part : tout ce que l'application raconte
' — collectes, analyses, quota, sauvegardes, erreurs — était perdu. On perdait
' aussi le seul moyen de savoir POURQUOI quelque chose n'a pas marché.
' `cmd /c` permet de rediriger la sortie vers un fichier, comme le faisait
' l'ancien « Collecte automatique.cmd ».
'
' Le 0 masque la fenêtre, le False rend la main aussitôt — un serveur ne se
' termine pas, attendre sa fin bloquerait la tâche jusqu'à ce que Windows la tue.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
racine = fso.GetParentFolderName(WScript.ScriptFullName)

shell.CurrentDirectory = racine
shell.Environment("PROCESS")("COLLECTE_AUTO") = "1"

' Le journal est repris à zéro à chaque démarrage : sans cela il grossit
' indéfiniment, et ce qu'on y cherche est toujours à la fin.
journal = racine & "\journal.log"
shell.Run "cmd /c """"" & racine & "\JobCockpit.exe"" > """ & journal & """ 2>&1""", 0, False
