' Lance « Collecte automatique.cmd » SANS ouvrir de fenêtre.
'
' Sans ce raccourci, la tâche planifiée fait clignoter une console noire
' toutes les 6 heures, en plein travail. Le 0 en second argument de Run est
' le style de fenêtre « masquée », le True demande d'attendre la fin.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
racine = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.Run """" & racine & "\Collecte automatique.cmd""", 0, True
