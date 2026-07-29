# 🚀 Job Cockpit

Tableau de bord personnel de recherche d'emploi, qui **va chercher les offres
tout seul**, les classe, les analyse au regard de ton CV, et rédige des lettres
de motivation.

Tout tourne **sur ton ordinateur**. Aucune donnée n'est envoyée ailleurs, à une
exception près, signalée plus bas.

> **Où en est le projet ?** → [`docs/HANDOFF.md`](docs/HANDOFF.md) : ce qui est
> fait, ce qui reste à faire, les décisions prises et les limites connues.
> Le journal détaillé des sessions est dans [`docs/REPRISE.md`](docs/REPRISE.md).

---

## Sommaire

1. [Démarrer l'application](#1-démarrer-lapplication)
2. [Créer les clés d'accès](#2-créer-les-clés-daccès)
3. [Ajouter ton CV](#3-ajouter-ton-cv)
4. [Utiliser le tableau de bord](#4-utiliser-le-tableau-de-bord)
5. [La collecte automatique, toutes les 6 heures](#5-la-collecte-automatique)
6. [Régler le classement des offres](#6-régler-le-classement-des-offres)
7. [En cas de problème](#7-en-cas-de-problème)
8. [Ce que fait le programme, en détail](#8-ce-que-fait-le-programme-en-détail)
9. [Héberger l'application en ligne](#9-héberger-lapplication-en-ligne-optionnel)

---

## 1. Démarrer l'application

Il faut **Node.js version 22 ou plus récente**. Pour vérifier, ouvre un terminal
et tape :

```bash
node --version
```

Si la commande est inconnue ou affiche moins que `v22`, installe Node depuis
[nodejs.org](https://nodejs.org) (bouton « LTS »).

Ensuite, une seule fois :

```bash
npm install
```

Puis, à chaque fois que tu veux utiliser l'application :

```bash
npm start
```

Ouvre ton navigateur sur **http://localhost:3000**.

Pour arrêter : reviens dans le terminal et fais `Ctrl+C`.

---

## 2. Créer les clés d'accès

Les sites d'emploi demandent une « clé » pour autoriser un programme à
consulter leurs offres. Elles sont **gratuites**, mais tu dois les créer
toi-même : ce sont des comptes à ton nom.

**Bonne nouvelle : une seule clé suffit pour démarrer.** Les sources non
configurées sont simplement ignorées.

| Service | Où s'inscrire | Ce que tu obtiens | Difficulté |
|---|---|---|---|
| **Adzuna** | [developer.adzuna.com](https://developer.adzuna.com) | `Application ID` + `Application Key` | Facile — 5 min |
| **Google Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Une clé API | Facile — 2 min |
| **France Travail** | [francetravail.io](https://francetravail.io) | `client_id` + `client_secret` | Moyen — 15 min |
| **Careerjet** | [careerjet.com/partners/api](https://www.careerjet.com/partners/api) | Une clé API | Moyen — compte partenaire |
| **Jooble** | [fr.jooble.org/api/about](https://fr.jooble.org/api/about) | Une clé API | Moyen — sur demande |
| **Flux RSS** | *aucune inscription* | rien à créer | Facile — voir §6 |

### Ce que chaque service apporte

- **Gemini** est indispensable pour l'analyse des offres et les lettres de
  motivation. Sans lui, les offres sont collectées et classées, mais pas
  analysées.
- **France Travail** est la source la plus riche : c'est la seule qui fournit
  la **description complète** de l'offre, donc l'analyse y est bien plus fine.
  Pense à t'abonner à l'API « Offres d'emploi v2 » après avoir créé ton
  application.
- **Adzuna** et **Jooble** sont des agrégateurs. Jooble est celui dont la
  couverture ressemble le plus à Indeed.
- **Indeed n'est pas disponible, et ne le sera pas.** Son programme
  « Publisher » — la seule API qui permettait de lire ses offres — a été fermé
  en 2023, et ses conditions d'utilisation interdisent explicitement la lecture
  automatisée du site. `src/sources/indeed.js` existe comme emplacement inerte,
  au cas où une API rouvrirait. En attendant, **Jooble et Careerjet couvrent
  une large part des mêmes annonces**, légalement.
- **Careerjet** est un méta-moteur : sa couverture française remonte des offres
  de l'APEC, de HelloWork, de Meteojob, de Jobijoba et de milliers de sites
  carrière. C'est le meilleur rapport « une clé / beaucoup de sites ».
- **Les flux RSS** ne demandent aucune clé : tu colles l'adresse d'un flux dans
  `profile/profile.json` et il est collecté comme les autres sources. C'est le
  moyen d'ajouter un site qui n'ouvre pas d'API (voir la section 6).

### Où mettre les clés

Copie le fichier `.env.example` en `.env` :

```bash
cp .env.example .env
```

Ouvre `.env` avec le Bloc-notes et colle chaque clé après le signe `=`, sans
espace ni guillemets :

```
ADZUNA_APP_ID=12345678
ADZUNA_APP_KEY=0000000000000000000000000000abcd
GEMINI_API_KEY=XX.XxXxXx...
```

*(valeurs d'exemple — remplace-les par les tiennes)*

Laisse vides les lignes des services que tu n'as pas encore.

> ⚠️ **Le fichier `.env` contient tes clés. Ne le partage jamais, ne l'envoie
> par mail à personne, et n'en fais pas de capture d'écran.** Il est déjà
> configuré pour ne jamais partir sur un dépôt de code.
>
> Si une clé a fuité, régénère-la sur le site concerné : c'est immédiat et
> gratuit.

---

## 3. Ajouter ton CV

Le programme compare chaque offre à ton CV réel. Sans lui, pas d'analyse ni de
lettres.

```bash
npm run extract-cv -- "C:/Users/TonNom/Documents/CV.docx"
```

Le texte est extrait dans `profile/cv.txt`. Le CV et sa copie **ne quittent pas
ton ordinateur**, sauf pour être envoyés à Google Gemini au moment de l'analyse
(voir la section 8).

Relance cette commande à chaque fois que tu mets ton CV à jour.

Vérifie aussi le bloc `candidat` dans `profile/profile.json` — il alimente
l'en-tête de tes lettres Word :

```json
"candidat": {
  "nom": "Benjamin Perrin",
  "email": "",
  "telephone": "",
  "ville": "Épinal"
}
```

Laisser `email` et `telephone` vides fait chercher ces valeurs dans le CV.

---

## 4. Utiliser le tableau de bord

### Les 6 vues

- **📊 Tableau de bord** — *tout est là.* Il s'ouvre sur **ce que tu dois faire
  maintenant**, classé par urgence : relances en retard d'abord, entretiens à
  préparer, puis les offres prioritaires auxquelles tu n'as pas encore postulé.
  Clique sur une ligne pour ouvrir l'offre.

  Dessous, dans l'ordre : six indicateurs avec leur micro-courbe et leur
  évolution par rapport à la semaine dernière, l'entonnoir de candidature, deux
  jauges de résultat, ta courbe de rythme (30 j / 90 j / par semaine), un
  **calendrier d'assiduité** sur 6 mois, la répartition par ville, l'origine des
  offres, le radar d'adéquation par thème métier, la distribution des scores,
  les types de contrat, les entreprises qui recrutent le plus, et le journal de
  toutes tes actions.
- **🗂️ Offres** — la liste complète, en liste ou en grille. Filtres cumulables
  (épinglées, avec lettre, fraîches), tri par score, et une carte qui explique
  **pourquoi** l'offre est classée là.
- **🧲 Kanban** — glisse une carte d'une colonne à l'autre pour changer son statut.
- **📅 Agenda** — un calendrier du mois avec une pastille par relance, puis la
  liste chronologique, les retards en rouge.
- **📄 Mon CV** — **le document que tu envoies**, à ouvrir d'un clic : c'est lui,
  tel quel, qui part en pièce jointe de tes candidatures. Avec la **couverture
  de tes mots-clés** : chaque motif positif de ton scoring y est confronté au
  texte extrait du CV. Un motif non couvert fait monter des offres pour une
  compétence que ton CV ne démontre pas. Une pastille rouge apparaît dans la
  navigation si le CV manque ou si ton document a été modifié après la dernière
  extraction.
- **⚙️ Options** — densité, animations, thème, délai de relance, objectif
  hebdomadaire, état des sources et export de toutes tes données en JSON.

> **Un objectif hebdomadaire**, réglable dans les Options, est rappelé en haut
> de chaque écran. La semaine démarre le lundi. C'est le seul compteur de
> l'application : ni points, ni niveaux, ni badges — l'outil sert à candidater,
> pas à collectionner.

### Les quatre thèmes

☀️ **Clair** · 🌿 **EnR** · 🌙 **Nuit** · 🛰️ **Cockpit** (fonds froids, accent
ambre, pensé pour les sessions du soir). Touche `T` pour tourner.

### Les raccourcis clavier

Appuie sur **`?`** à tout moment pour les afficher.

| Raccourci | Action |
|---|---|
| `Ctrl` + `K` | **Palette de commandes** — aller à une offre ou lancer une action |
| `G` puis `D` | Tableau de bord |
| `G` puis `O` | Offres |
| `G` puis `K` | Kanban |
| `G` puis `A` | Agenda |
| `G` puis `V` | Mon CV |
| `G` puis `R` | Options |
| `/` | Rechercher |
| `R` | Lancer une collecte |
| `N` | Ajouter une offre |
| `T` | Changer de thème |
| `Échap` | Fermer / annuler |

### La relance planifiée toute seule

Quand tu marques une candidature comme envoyée — bouton, liste déroulante ou
glisser-déposer dans le Kanban — une **relance est automatiquement planifiée
7 jours plus tard**, si tu n'en avais pas déjà fixé une. Elle apparaît alors
dans l'Agenda et dans le Focus du jour.

Tu peux évidemment changer ou effacer cette date.

### Tes statistiques de résultat

Le Dashboard affiche ce que tes candidatures donnent réellement :

- **Taux de réponse** — calculé sur les candidatures **envoyées**, pas sur
  l'ensemble des offres (sinon il serait artificiellement bas).
- **Taux d'entretien** — la proportion d'envois qui débouchent sur un entretien.
- **En attente depuis** — le délai moyen, en jours, de tes candidatures encore
  sans réponse.
- **Courbe d'activité** — tes envois sur les 30 derniers jours. Survole une
  barre pour voir le détail.

L'anneau indique la part des offres pour lesquelles tu as effectivement postulé.

### Les 4 groupes

| Groupe | Sens |
|---|---|
| 🟢 Prioritaire | Correspond fortement à ton profil |
| 🟡 Possible | Correspond partiellement |
| 🔴 À écarter | Une exigence bloquante a été détectée |
| ⚪ À vérifier | Pas assez d'informations pour juger |

> **Important.** Ce classement repose sur des **mots-clés**. Il fait un tri
> rapide, mais il ne comprend pas le métier. Le **verdict de l'analyse**, lui,
> lit toute l'annonce.
>
> Quand les deux se contredisent, un avertissement apparaît sur la carte :
> *« Le tri par mots-clés a classé cette offre Prioritaire, mais l'analyse dit
> non. »* **Fie-toi au verdict.**
>
> Exemple réel : une offre « Chef de projet efficacité énergétique / énergie
> renouvelable » a été classée 🟢 par les mots-clés, alors que le métier
> (efficacité énergétique du bâtiment) n'a rien à voir avec le développement
> de projets EnR.

### Les autres repères

- **🌍 Hors zone** — l'offre est en dehors de Strasbourg, Nancy, Lyon et Paris.
  Elle n'apparaît que si elle est Prioritaire ou Possible.
- **🔥 Nouveau / 🟢 3 j / 🔴 20 j** — l'ancienneté de l'offre.
- **Adzuna / France Travail / Jooble** — d'où vient l'offre. Une même offre vue
  sur plusieurs sites n'apparaît qu'une fois.

### Ajouter une offre trouvée ailleurs

Bouton **« + Offre »**, deux possibilités :

- **Saisir une offre** — tu remplis les champs à la main.
- **Coller une annonce** — tu colles le texte brut d'une annonce trouvée
  n'importe où (LinkedIn, APEC, un site carrière, une conversation). Le
  programme en extrait les informations, la classe et l'analyse comme les
  autres.

### La lettre de motivation

Déplie une offre, section **✉️ Lettre de motivation**, bouton **« Rédiger la
lettre »**. Comptez une vingtaine de secondes.

La lettre fait **650 à 800 mots**, en 7 à 8 paragraphes. Avant d'écrire, le
programme dépouille l'annonce pour en tirer les **trois exigences réellement
mises en avant** par l'employeur, et consacre un paragraphe à chacune, preuve
du CV à l'appui. S'y ajoutent le paragraphe « pourquoi moi et pas un autre »
— où figurent tes 90 % de portefeuille agrivoltaïque dès que l'offre s'y
prête — et un registre adapté quand l'annonce vient de la fonction publique.
Le programme a l'interdiction explicite d'inventer une expérience ou un chiffre.

Tu peux la **modifier directement** — tes retouches sont enregistrées. Quatre
boutons :

- **📎 Dossier complet** — un seul fichier `.zip` contenant **la lettre mise en
  page et ton CV**, prêt à joindre à un mail. C'est le bouton à utiliser dans
  99 % des cas.
- **⬇ Lettre seule** — le document Word de la lettre, sans le CV.
- **📋 Copier** — le texte brut, pour un formulaire en ligne.
- **🔄 Régénérer** — avec confirmation si tu l'avais retouchée.

> Ton CV part **dans sa version d'origine**, octet pour octet : le programme ne
> réécrit jamais ta mise en page.

> Relis toujours la lettre avant de l'envoyer. C'est un premier jet solide,
> pas un texte à envoyer les yeux fermés.

### Tes données personnelles sont protégées

Statuts, notes, dates de relance et épingles **ne sont jamais écrasés** par une
collecte. C'est la garantie centrale du programme, vérifiée automatiquement à
chaque modification du code.

---

## 5. La collecte automatique

**C'est déjà en place.** Une tâche planifiée Windows nommée
**« JobCockpit - collecte »** lance une collecte **toutes les 6 heures**, à
partir de 7h00. Tu n'as plus rien à faire : ouvre le tableau de bord, les
offres sont déjà là.

La collecte se fait **sans aucune fenêtre** : elle passe par
`scripts/collecte-silencieuse.vbs`, qui appelle `Collecte automatique.cmd`
en arrière-plan. Le compte rendu de chaque passage s'ajoute à `collect.log`.

Le bouton **« Rafraîchir maintenant »** du tableau de bord reste disponible
quand tu ne veux pas attendre.

> L'ordinateur doit être allumé à l'heure prévue. S'il était éteint, Windows
> rattrape la collecte manquée au démarrage suivant (option « démarrer dès que
> possible »).

### Vérifier, modifier ou supprimer la tâche

Dans **PowerShell** :

```powershell
Get-ScheduledTaskInfo -TaskName "JobCockpit - collecte"
```

Pour la lancer tout de suite, à titre de test :

```powershell
Start-ScheduledTask -TaskName "JobCockpit - collecte"
```

Pour changer la fréquence — ici toutes les 3 heures :

```powershell
Set-ScheduledTask -TaskName "JobCockpit - collecte" -Trigger (New-ScheduledTaskTrigger -Once -At 7am -RepetitionInterval (New-TimeSpan -Hours 3))
```

Pour la supprimer :

```powershell
Unregister-ScheduledTask -TaskName "JobCockpit - collecte" -Confirm:$false
```

### La recréer depuis zéro

Si tu déplaces le dossier du projet, la tâche pointera dans le vide. Colle
ceci dans PowerShell, après avoir adapté la première ligne :

```powershell
$racine = "C:\Users\BenjaminPerrin\Développement Dropbox\Benjamin PERRIN\Benjamin Perrin\JobCockpit2"
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$racine\scripts\collecte-silencieuse.vbs`"" -WorkingDirectory $racine
$declencheur = New-ScheduledTaskTrigger -Once -At 7am -RepetitionInterval (New-TimeSpan -Hours 6)
$reglages = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName "JobCockpit - collecte" -Action $action -Trigger $declencheur -Settings $reglages -Force
```

### Linux / macOS

```bash
crontab -e
```

Ajoute cette ligne :

```
0 */6 * * * cd /chemin/vers/JobCockpit2 && /usr/bin/npm run collect >> collect.log 2>&1
```


## 6. Régler le classement des offres

Tout se règle dans **`profile/profile.json`**, sans toucher au code.

Tu peux modifier :

- **`villesPrioritaires`** — tes villes cibles et leurs départements limitrophes
- **`flux`** — les flux RSS à surveiller (voir juste en dessous)
- **`intitules`** — les 5 intitulés de poste recherchés
- **`rayonKm`** — le rayon de recherche autour de chaque ville (30 km par défaut)
- **`fraicheurJours`** — l'ancienneté maximale des offres (7 jours par défaut)
- **`scoring.positifs`** — les mots-clés qui valorisent une offre, et leur poids
- **`scoring.negatifs`** — ceux qui la pénalisent
- **`scoring.eliminatoires`** — ceux qui la disqualifient d'office
- **`scoring.seuils`** — les scores qui font basculer d'un groupe à l'autre

### Ajouter un site sans écrire de code : les flux RSS

La plupart des sites d'emploi français n'ouvrent pas d'API en libre-service,
mais presque tous publient des **flux RSS** : une recherche enregistrée, une
page « nos offres », une alerte. Un flux public est fait pour être lu par un
programme — c'est même sa seule raison d'être.

Ajoute-les dans le bloc `flux` de `profile/profile.json` :

```json
"flux": [
  { "nom": "APEC — chef de projet EnR",
    "url": "https://www.apec.fr/.../rss?motsCles={intitule}" },

  { "nom": "Carrières Voltalia",
    "url": "https://www.voltalia.com/…/jobs.rss",
    "entreprise": "Voltalia" },

  { "nom": "France Travail Grand Est",
    "url": "https://…/flux.rss",
    "ville": "Nancy" }
]
```

| Champ | Rôle |
|---|---|
| `url` | l'adresse du flux. Le jeton `{intitule}` y est remplacé par chacun de tes intitulés de recherche, encodé pour l'URL. Sans ce jeton, le flux est lu tel quel. |
| `nom` | libellé affiché dans le journal de collecte |
| `entreprise` | force le nom de l'employeur — utile pour un flux de page carrière |
| `ville` | force la ville — utile pour un flux régional |
| `zone` | situe les offres d'un flux **déjà filtré par département**, quand les entrées ne donnent pas d'adresse. Sans lui, ces offres sont comptées « hors zone » et la plupart sont écartées. Écris-la sous la forme `"Bas-Rhin, 67"`. |

Le programme découpe les titres de la forme
« *Poste - Entreprise - Ville (67)* » ou « *Poste chez Entreprise* ». Quand la
découpe échoue, il garde le titre entier plutôt que d'inventer. Les références
internes placées en tête de titre (« *MINT_BA067PNB-123673 - Chargé du contrôle
de légalité* ») sont retirées.

### Les flux déjà configurés

`profile.json` en contient **31**, tous vérifiés sur des données réelles le
29 juillet 2026. Ensemble, ils remontent **326 offres distinctes**, dont 265
passent le filtre de zone et 136 arrivent en groupe 1 « Prioritaire ».

- **29 flux « Choisir le Service Public »** — c'est **la meilleure source du
  projet** : aucune clé, aucune limite d'appel constatée, et des descriptions
  de poste **complètes** (2 000 à 5 000 caractères), là où Adzuna les tronque.
  Deux découpages se complètent :
  - **par département** (20 flux) — 5 filières × tes 4 départements (67, 54,
    69, 75). Un flux ne renvoie que ses **20 entrées les plus récentes** :
    filtrer par département donne donc 20 offres *par département*.
  - **par région** (9 flux) — 3 filières × Grand Est, Auvergne-Rhône-Alpes,
    Île-de-France, pour ratisser les départements limitrophes.

  Les 5 filières retenues : *affaires juridiques*, *aménagement du territoire*,
  *environnement*, *agriculture* (pour l'agrivoltaïsme, à cheval sur l'énergie
  et le foncier agricole) et *pilotage des politiques publiques* (postes de
  chef de projet cadre A).
- **1 flux Emploi-Environnement** — national, tout le secteur. Attention, ce
  site **tronque ses descriptions à ~150 caractères** et abîme certains
  accents à la source : utile pour repérer une offre, pas pour l'analyser.
- **1 flux TotalEnergies** — les offres monde du groupe. Le filtre de zone
  écarte tout seul ce qui est hors de tes villes.

> **Les autres sites d'emploi français ont fermé leurs flux.** Vérifié un par
> un le 29 juillet 2026 : Indeed (404), Cadremploi (404), APEC (404), Jobijoba
> (410), Jooble (403), Meteojob (404), Welcome to the Jungle (406). Inutile de
> les chercher. Côté employeurs EnR, les `/feed/` de Valeco, JPee et EDF
> PowerSolutions existent mais publient des **actualités**, pas des offres.

Ces flux se règlent en modifiant l'URL. Le catalogue complet des filtres
disponibles (filière, métier, région, département, catégorie, versant…) est
sur <https://place-ep-recrute.talent-soft.com//offre-de-emploi/tous-les-flux-rss.aspx>.
Les critères **se combinent** : il suffit de coller leurs paramètres à la
suite, séparés par `&`.

**Pour trouver le flux d'un site** : lance une recherche, puis cherche
« RSS », « Flux » ou l'icône 📶 en bas de page. Beaucoup de sites acceptent
aussi d'ajouter `?format=rss` ou `/rss` à l'URL de résultats.

Un flux mort est signalé dans le résumé de collecte et ignoré : il ne fait
jamais tomber les autres.

### ⚠️ Le piège des mots-clés

Les mots-clés sont comparés à un texte **nettoyé** : minuscules, accents
retirés, et **toute ponctuation remplacée par un espace**. Un mot-clé écrit
avec sa ponctuation d'origine ne correspondra **jamais**, et l'échec est
silencieux.

| Ce qui est écrit dans l'annonce | Ce que le programme compare | Ce qu'il faut écrire |
|---|---|---|
| `agrivoltaïque` | `agrivoltaique` | `agrivolta` |
| `M&A` | `m a` | `\bm a\b` |
| `droit de l'environnement` | `droit de l environnement` | `droit de l environnement` |
| `diplôme d'ingénieur` | `diplome d ingenieur` | `diplome d ingenieur` |

Pour vérifier ce que devient un mot avant de l'ajouter :

```bash
npm run normaliser -- "M&A" "diplôme d'ingénieur"
```

Après toute modification, contrôle que le classement reste cohérent :

```bash
npm test
```

Le programme vérifie qu'il classe toujours correctement 11 offres de référence
que tu avais triées à la main.

---

## 7. En cas de problème

| Symptôme | Cause probable et solution |
|---|---|
| « Le serveur ne répond pas » | L'application n'est pas démarrée. Lance `npm start`. |
| « Aucune source configurée » | Aucune clé dans `.env`. Voir la section 2. |
| La collecte ne trouve rien | Normal si tes intitulés sont pointus. Élargis `intitules` dans `profile.json`, ou ajoute une source. |
| Les offres arrivent sans analyse | Quota Gemini atteint (~1500 requêtes/jour), ou `GEMINI_API_KEY` absente. Ça repartira tout seul le lendemain. |
| « Aucun modèle Gemini disponible » | Google a fait évoluer son catalogue. Lance `npm run modeles` pour voir ce qui fonctionne, et reporte les noms dans `src/gemini.js`. |
| Une source affiche « en échec » | Panne passagère du site. Les autres sources ont quand même fonctionné, et tes données sont intactes. |
| Le port 3000 est déjà utilisé | Change `PORT=3001` dans `.env`. |

### Vérifier que tout va bien

```bash
npm test
```

Doit afficher `fail 0`. Si un test échoue après une modification de
`profile.json`, c'est que le réglage a cassé le classement.

---

## 8. Ce que fait le programme, en détail

### Le déroulé d'une collecte

1. Pour chacun de tes 5 intitulés, il interroge chaque source sur tes 4 villes
   (rayon 30 km), **puis sur la France entière**.
2. Il ne garde que les offres publiées dans les 7 derniers jours.
3. Il élimine les doublons — une même offre vue sur plusieurs sites ne compte
   qu'une fois, et c'est la description la plus complète qui est conservée.
4. Il classe chaque offre en 4 groupes selon tes mots-clés.
5. Hors de tes villes prioritaires, il ne retient que les Prioritaires et les
   Possibles.
6. Il fait analyser chaque offre retenue par Gemini, au regard de ton CV.
7. Il enregistre. **Il ne touche jamais à ton suivi personnel.**
8. Il supprime les offres disparues depuis plus de 30 jours — sauf celles où tu
   as laissé une trace (statut, note, relance, épingle, lettre).

### Pourquoi pas Indeed, LinkedIn, l'APEC ou Welcome to the Jungle ?

Aucun des quatre n'ouvre d'API en libre-service, et leurs conditions
d'utilisation interdisent d'aspirer leurs pages — une pratique de toute façon
fragile, qui casse au moindre changement de leur site.

Deux contournements légitimes existent, et le programme les couvre tous les
deux :

1. **Careerjet** est un méta-moteur qui indexe déjà l'APEC, HelloWork,
   Meteojob, Jobijoba et des milliers de sites carrière. Une clé, une source,
   la couverture de dizaines de sites.
2. **Les flux RSS** (section 6) : l'APEC et beaucoup d'autres publient un flux
   par recherche enregistrée. C'est public, prévu pour être lu par un
   programme, et il suffit de coller l'adresse dans `profile.json`.

Un emplacement reste prêt dans `src/sources/indeed.js` si un accès légitime
s'ouvrait un jour. En attendant, l'onglet **« Coller une annonce »** permet
d'ajouter n'importe quelle offre trouvée sur Indeed, LinkedIn ou ailleurs :
elle sera analysée et classée comme les autres.

### Où vont tes données

Tout reste sur ton ordinateur : `data.db` (les offres et ton suivi),
`profile/cv.txt` (ton CV), `.env` (tes clés).

**Une seule exception :** au moment de l'analyse d'une offre ou de la rédaction
d'une lettre, le texte de ton CV et celui de l'offre sont envoyés à l'API
Google Gemini. C'est indispensable au fonctionnement. Si tu ne le souhaites
pas, laisse `GEMINI_API_KEY` vide : les offres seront collectées et classées,
sans analyse ni lettres.

Le serveur n'écoute que sur ton ordinateur (`127.0.0.1`) : personne sur ton
réseau ne peut y accéder.

---

## 9. Héberger l'application en ligne (optionnel)

Par défaut, la collecte n'a lieu que si ton ordinateur est allumé. Pour qu'elle
tourne en permanence, tu peux héberger l'application gratuitement.

### Fly.io — recommandé

C'est le seul des trois qui offre un **disque persistant gratuit**, ce qui est
indispensable : ta base `data.db` est un fichier, et sans disque persistant
elle serait effacée à chaque redéploiement.

1. Crée un compte sur [fly.io](https://fly.io) et installe `flyctl`.
2. Dans le dossier du projet : `fly launch` (réponds non au déploiement immédiat).
3. Crée le disque : `fly volumes create donnees --size 1`.
4. Dans `fly.toml`, monte le disque sur `/data` et fais pointer la base dessus.
5. Enregistre tes clés comme secrets — **jamais** en déployant le fichier `.env` :
   ```bash
   fly secrets set GEMINI_API_KEY=xxx ADZUNA_APP_ID=xxx ADZUNA_APP_KEY=xxx
   ```
6. Déploie : `fly deploy`.
7. Pour la collecte automatique, remplace la tâche planifiée Windows par une
   machine programmée Fly qui exécute `npm run collect`.

### Les autres

- **Railway** — simple, disque persistant disponible, crédit mensuel gratuit
  limité.
- **Render** — plan gratuit, mais **système de fichiers éphémère** : ta base
  serait perdue à chaque redéploiement. Il faudrait migrer vers PostgreSQL,
  ce qui demande de réécrire l'accès aux données.

> Une fois en ligne, ton CV et tes candidatures se trouvent sur un serveur
> tiers. Ajoute au minimum un mot de passe d'accès avant de franchir ce pas —
> l'application n'en a aucun aujourd'hui, puisqu'elle est conçue pour rester
> sur ta machine.

---

## Les commandes, en résumé

| Commande | Ce qu'elle fait |
|---|---|
| `npm start` | Démarre le tableau de bord sur http://localhost:3000 |
| `npm run collect` | Lance une collecte depuis le terminal |
| `npm run extract-cv -- "chemin/CV.docx"` | Met à jour ton CV |
| `npm run normaliser -- "M&A"` | Montre comment un mot-clé est transformé |
| `npm run modeles` | Liste les modèles Gemini qui fonctionnent |
| `npm test` | Vérifie que tout fonctionne encore |
