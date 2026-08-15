' Ouvre Job Cockpit — et le démarre d'abord s'il ne tourne pas.
'
' POURQUOI UN SEUL RACCOURCI
' --------------------------
' Il y en avait deux : « ouvrir » et « relancer ». Deux raccourcis pour une
' seule intention, dont l'un échouait en silence si l'application était
' fermée — le navigateur affichait « impossible d'accéder à ce site » sans
' dire quoi faire. Celui-ci vérifie, démarre au besoin, puis ouvre.

Const ADRESSE = "http://localhost:3000"

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
racine = fso.GetParentFolderName(WScript.ScriptFullName)

' Le serveur répond-il déjà ?
Function EnMarche()
  On Error Resume Next
  Set requete = CreateObject("MSXML2.XMLHTTP.6.0")
  requete.Open "GET", ADRESSE & "/api/meta", False
  requete.Send
  EnMarche = (Err.Number = 0 And requete.Status = 200)
  On Error GoTo 0
End Function

If Not EnMarche() Then
  shell.Run """" & racine & "\Demarrer.vbs""", 0, False

  ' En temps normal le serveur écoute en une seconde. Mais le PREMIER
  ' lancement qui suit une mise à jour est bien plus lent : l'antivirus
  ' analyse les 92 Mo du binaire avant de le laisser partir. Mesuré à plus de
  ' quinze secondes. On attend donc jusqu'à une minute, en vérifiant plutôt
  ' qu'en pariant sur une durée.
  For essai = 1 To 120
    WScript.Sleep 500
    If EnMarche() Then Exit For
  Next

  If Not EnMarche() Then
    MsgBox "Job Cockpit n'a pas démarré." & vbCrLf & vbCrLf & _
           "Regarde " & racine & "\journal.log pour savoir pourquoi." & vbCrLf & vbCrLf & _
           "Si ton antivirus a mis JobCockpit.exe en quarantaine, " & _
           "il faut l'y autoriser — voir LISEZ-MOI.txt.", _
           vbExclamation, "Job Cockpit"
    WScript.Quit 1
  End If
End If

shell.Run ADRESSE, 1, False
