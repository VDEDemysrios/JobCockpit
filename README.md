# 🚀 Job Cockpit

Tableau de bord personnel de recherche d'emploi, qui **va chercher les offres
tout seul**, les classe, les analyse au regard de ton CV, et rédige des lettres
de motivation.

Tout tourne **sur ton ordinateur**. Aucune donnée n'est envoyée ailleurs, à une
exception près, signalée plus bas.

---

## Sommaire

1. [Démarrer l'application](#1-démarrer-lapplication)
2. [Créer les clés d'accès](#2-créer-les-clés-daccès)
3. [Ajouter ton CV](#3-ajouter-ton-cv)
4. [Utiliser le tableau de bord](#4-utiliser-le-tableau-de-bord)
5. [Lancer la collecte automatiquement tous les 2 jours](#5-lancer-la-collecte-automatiquement)
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
| **Jooble** | [fr.jooble.org/api/about](https://fr.jooble.org/api/about) | Une clé API | Moyen — sur demande |

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

### Les 5 vues

- **🎯 Focus du jour** — *commence par là.* La liste de ce que tu dois faire
  maintenant, classée par urgence : relances en retard d'abord, entretiens à
  préparer, puis les offres prioritaires auxquelles tu n'as pas encore postulé.
  Clique sur une ligne pour ouvrir l'offre correspondante.
  L'application s'ouvre directement sur cette vue quand quelque chose presse.
- **Dashboard** — vue d'ensemble, statistiques, indicateur de dernière mise à
  jour, bouton « Rafraîchir maintenant ».
- **Offres** — la liste complète. Clique sur une carte pour la déplier.
- **Kanban** — glisse une carte d'une colonne à l'autre pour changer son statut.
- **Agenda** — les relances à faire, les retards en rouge.

### Les raccourcis clavier

Appuie sur **`?`** à tout moment pour les afficher.

| Raccourci | Action |
|---|---|
| `G` puis `F` | Focus du jour |
| `G` puis `D` | Dashboard |
| `G` puis `O` | Offres |
| `G` puis `K` | Kanban |
| `G` puis `A` | Agenda |
| `/` | Rechercher |
| `R` | Lancer une collecte |
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

La lettre suit la structure française classique, avec un paragraphe consacré à
« pourquoi moi et pas un autre » adossé à ton parcours réel. Le programme a
l'interdiction explicite d'inventer une expérience ou un chiffre.

Tu peux la **modifier directement** — tes retouches sont enregistrées. Trois
boutons : **Copier**, **⬇ Word** (document mis en page, prêt à envoyer), et
**Régénérer** (avec confirmation si tu l'avais retouchée).

> Relis toujours la lettre avant de l'envoyer. C'est un premier jet solide,
> pas un texte à envoyer les yeux fermés.

### Tes données personnelles sont protégées

Statuts, notes, dates de relance et épingles **ne sont jamais écrasés** par une
collecte. C'est la garantie centrale du programme, vérifiée automatiquement à
chaque modification du code.

---

## 5. Lancer la collecte automatiquement

Le bouton « Rafraîchir maintenant » lance une collecte à la demande. Pour
qu'elle se fasse toute seule tous les 2 jours :

### Windows

Ouvre **PowerShell** et colle cette commande (adapte le chemin si besoin) :

```
schtasks /create /tn "JobCockpit" /tr "cmd /c cd /d \"C:\Users\BenjaminPerrin\Développement Dropbox\Benjamin PERRIN\Benjamin Perrin\JobCockpit\" && npm run collect >> collect.log 2>&1" /sc daily /mo 2 /st 07:00
```

Ce que ça fait : tous les 2 jours à 7h00, la collecte se lance et écrit son
compte rendu dans `collect.log`.

Pour vérifier que la tâche existe :

```
schtasks /query /tn "JobCockpit"
```

Pour la lancer immédiatement, à titre de test :

```
schtasks /run /tn "JobCockpit"
```

Pour la supprimer :

```
schtasks /delete /tn "JobCockpit" /f
```

> L'ordinateur doit être allumé à l'heure prévue. S'il était éteint, Windows
> rattrape la tâche au démarrage suivant.

### Linux / macOS

```bash
crontab -e
```

Ajoute cette ligne :

```
0 7 */2 * * cd /chemin/vers/JobCockpit && /usr/bin/npm run collect >> collect.log 2>&1
```

---

## 6. Régler le classement des offres

Tout se règle dans **`profile/profile.json`**, sans toucher au code.

Tu peux modifier :

- **`villesPrioritaires`** — tes villes cibles et leurs départements limitrophes
- **`intitules`** — les 5 intitulés de poste recherchés
- **`rayonKm`** — le rayon de recherche autour de chaque ville (30 km par défaut)
- **`fraicheurJours`** — l'ancienneté maximale des offres (7 jours par défaut)
- **`scoring.positifs`** — les mots-clés qui valorisent une offre, et leur poids
- **`scoring.negatifs`** — ceux qui la pénalisent
- **`scoring.eliminatoires`** — ceux qui la disqualifient d'office
- **`scoring.seuils`** — les scores qui font basculer d'un groupe à l'autre

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

### Pourquoi pas Indeed ?

Indeed n'a plus d'API publique accessible librement, et ses conditions
d'utilisation interdisent d'aspirer ses pages — une pratique de toute façon
fragile, qui casse au moindre changement de leur site. Indeed étant lui-même un
agrégateur, les trois sources retenues couvrent largement les mêmes annonces.

Un emplacement est prêt dans `src/sources/indeed.js` si un accès légitime
s'ouvrait un jour. En attendant, l'onglet **« Coller une annonce »** permet
d'ajouter n'importe quelle offre trouvée sur Indeed ou ailleurs.

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
