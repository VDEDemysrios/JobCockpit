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

' UNE SEULE INSTANCE.
' Deux serveurs sur la même base, c'est deux collectes simultanées, deux fois
' le quota Gemini dépensé, et des écritures entrelacées. Le second ne peut de
' toute façon pas prendre le port — autant ne pas le lancer, plutôt que de le
' laisser vivre sans écouter, ce qui rendait le tableau de bord injoignable
' sans que rien ne l'explique.
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
If wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name = 'JobCockpit.exe'").Count > 0 Then
  WScript.Quit 0
End If

shell.CurrentDirectory = racine
shell.Environment("PROCESS")("COLLECTE_AUTO") = "1"

' LE JOURNAL EST VIDÉ ICI, ET LA REDIRECTION AJOUTE.
'
' C'est ce détail qui tuait l'application après une mise à jour, quatre fois
' de suite, sans que rien ne le laisse deviner. Les deux instances écrivaient
' dans le MÊME fichier, et « > » le tronque à l'ouverture : la seconde coupait
' le fichier sous la première. La première, qui avait pourtant gagné le port,
' mourait à son écriture suivante — et il ne restait plus personne.
'
' Le contrôle d'instance unique juste au-dessus ne suffit pas : entre le
' moment où il regarde et celui où il lance, un autre lanceur peut passer.
' Vider le journal AVANT, puis écrire en « >> », ôte au perdant tout moyen de
' nuire au gagnant.
journal = racine & "\journal.log"
fso.CreateTextFile(journal, True).Close

shell.Run "cmd /c """"" & racine & "\JobCockpit.exe"" >> """ & journal & """ 2>&1""", 0, False
