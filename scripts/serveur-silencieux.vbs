' Lance « Serveur.cmd » SANS ouvrir de fenêtre, et sans attendre sa fin.
'
' Deux différences avec collecte-silencieuse.vbs, et elles comptent :
'   · le troisième argument de Run est False — un serveur ne se termine pas,
'     attendre sa fin bloquerait la tâche planifiée pendant des heures et
'     Windows finirait par la tuer ;
'   · le 0 masque la fenêtre, sinon une console noire resterait ouverte en
'     permanence sur le bureau.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
racine = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = racine
shell.Run """" & racine & "\Serveur.cmd""", 0, False
