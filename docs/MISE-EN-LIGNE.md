# Mettre Job Cockpit en ligne, pas à pas

> Résultat : une adresse permanente du genre `https://job-cockpit.fly.dev`,
> ouverte par un mot de passe, joignable depuis ton téléphone, **PC éteint**.
> La collecte continue toute seule toutes les 6 heures.

Tout est déjà écrit et éprouvé en local. Il te reste **trois commandes** et un
compte à créer.

---

## Avant de commencer, deux choses à savoir

**1. Le mot de passe n'est pas décoratif.** La base contient ton CV, tes
candidatures, tes notes et tes lettres. Sans mot de passe, une adresse publique
les expose à qui la trouve — et une URL finit toujours par être trouvée.
`src/server.js` **refuse de démarrer** sur une adresse publique sans mot de
passe : ce n'est pas contournable par distraction.

**2. Une seule base, un seul collecteur.** Une fois en ligne, l'application
collecte elle-même. Si la tâche Windows continue en parallèle, elle remplit une
base **locale** que plus personne ne regarde, et ton suivi de candidatures se
scinde en deux sans prévenir. La dernière étape s'en occupe — ne la saute pas.

---

## 1. Créer le compte et installer l'outil

Le compte, c'est toi qui le crées : <https://fly.io/app/sign-up>

Puis, dans PowerShell :

```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

Ferme et rouvre PowerShell, puis connecte-toi :

```bash
fly auth login
```

---

## 2. Choisir un mot de passe

Prends-en un long et unique — ton gestionnaire de mots de passe en génère un
très bien. Tu ne le taperas qu'une fois par appareil, la session dure 30 jours.

Pour en fabriquer un au hasard :

```bash
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
```

**Garde-le dans ton gestionnaire avant de continuer.** Il n'est stocké nulle
part ailleurs, et le changer déconnecte toutes les sessions en cours.

---

## 3. Déployer

Depuis le dossier du projet :

```bash
fly launch --no-deploy --copy-config --name job-cockpit --region cdg
```

> Si le nom est déjà pris, Fly en proposera un autre — accepte, l'URL suivra.

Crée le volume qui gardera la base d'un déploiement à l'autre :

```bash
fly volumes create cockpit_data --region cdg --size 1
```

Dépose les clés. **C'est toi qui tapes cette commande** : elles ne doivent
transiter ni par le dépôt, ni par une conversation.

```bash
fly secrets set COCKPIT_MOT_DE_PASSE="ton-mot-de-passe" GEMINI_API_KEY="..." ADZUNA_APP_ID="..." ADZUNA_APP_KEY="..." FRANCE_TRAVAIL_CLIENT_ID="..." FRANCE_TRAVAIL_CLIENT_SECRET="..." JOOBLE_API_KEY="..."
```

Les valeurs sont dans ton `.env` local. Puis :

```bash
fly deploy
```

Le premier déploiement prend quelques minutes. À la fin, Fly affiche ton
adresse. Ouvre-la : la page de connexion t'attend.

---

## 4. Éteindre la tâche Windows

**L'étape qu'on oublie, et qui coûte cher.** Tant qu'elle tourne, deux
collectes remplissent deux bases séparées.

```powershell
Disable-ScheduledTask -TaskName "JobCockpit - collecte"
```

Pour la supprimer définitivement :

```powershell
Unregister-ScheduledTask -TaskName "JobCockpit - collecte" -Confirm:$false
```

---

## Vivre avec

| Besoin | Commande |
|---|---|
| Voir les journaux, dont les collectes | `fly logs` |
| Redéployer après une modification | `fly deploy` |
| Changer le mot de passe | `fly secrets set COCKPIT_MOT_DE_PASSE="..."` |
| Récupérer la base | `fly ssh sftp get /data/data.db` |
| Arrêter tout | `fly apps destroy job-cockpit` |

**Sauvegarde ta base de temps en temps.** Le volume Fly n'est pas répliqué :
`fly ssh sftp get /data/data.db` te ramène offres, suivi, notes et lettres.

---

## Ce que ça coûte

Une machine `shared-cpu-1x` à 512 Mo qui ne s'endort jamais, plus un volume de
1 Go : quelques euros par mois. Fly facture à l'usage et prévient avant de
dépasser.

Le réglage `auto_stop_machines = false` dans `fly.toml` est ce qui coûte : une
machine endormie ne collecte pas, les passages de 6 heures ne se
déclencheraient qu'à l'ouverture de la page. Si tu préfères payer moins et
accepter ça, passe-le à `true`.

---

## Si ça coince

| Symptôme | Cause |
|---|---|
| `Démarrage refusé` dans `fly logs` | `COCKPIT_MOT_DE_PASSE` n'est pas déposé |
| Cockpit vide à la première visite | volume neuf ; attends la collecte de démarrage (1 min) ou clique sur « Collecter » |
| Sources « non configurées » | une clé manque dans `fly secrets list` |
| Déconnexion à chaque visite | le mot de passe a changé — c'est voulu, il invalide les sessions |
| Offres qui n'arrivent plus | `fly logs` : quota Gemini, ou plafond Jooble (HANDOFF §4) |
