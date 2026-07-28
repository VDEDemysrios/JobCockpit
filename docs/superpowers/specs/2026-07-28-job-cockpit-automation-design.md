# Job Cockpit — automatisation de la collecte d'offres

**Date** : 28 juillet 2026
**Auteur** : Benjamin Perrin (conception assistée)
**Statut** : spec validée, en attente de plan d'implémentation

---

## 1. Contexte

`job_cockpit_v3.html` est un tableau de bord de recherche d'emploi autonome
(HTML/CSS/JS sans dépendance, données en `localStorage`). Il affiche 11 offres
codées en dur dans une constante `SEED`, permet de suivre chaque candidature
(statut, date d'envoi, relance, notes, épingles), et propose 4 vues :
Dashboard, Offres, Kanban, Agenda.

La collecte est aujourd'hui 100 % manuelle : les offres sont récupérées en
conversation puis recopiées dans le fichier. Le bandeau « veille à rafraîchir »
n'est qu'un rappel — il ne déclenche rien.

**Objectif** : transformer ce fichier statique en une application locale qui
collecte les offres automatiquement, les analyse, les stocke, et met à jour le
dashboard — sans copier-coller.

---

## 2. Périmètre

### Dans le périmètre

- Backend Node.js + Express + SQLite servant le dashboard et une API REST.
- Collecte automatisée depuis 3 sources d'offres légales et gratuites.
- Scoring déterministe des offres en 4 groupes (logique actuelle du HTML).
- Analyse qualitative générée par LLM (Gemini) à partir du CV.
- Génération de lettre de motivation à la demande, par offre.
- Migration des données personnelles existantes depuis `localStorage`.
- Planification tous les 2 jours (cron Unix + tâche planifiée Windows).
- README pas-à-pas pour non-développeur.

### Hors périmètre

- **Scraping d'Indeed.** Indeed n'expose pas d'API publique en libre-service
  (l'ancienne Publisher API est fermée aux nouvelles inscriptions) et ses
  conditions d'utilisation interdisent le scraping de ses pages, qui casserait
  de toute façon à chaque changement de leur HTML. Indeed étant lui-même un
  agrégateur, sa couverture est reconstituée par les trois sources retenues.
  Un **emplacement d'adaptateur Indeed est néanmoins prévu** (§5.4) pour le
  jour où un accès légitime deviendrait disponible.
- Envoi automatique de candidatures (aucune action sortante automatisée).
- Multi-utilisateur, authentification, comptes.
- Application mobile native (le dashboard reste responsive).

---

## 3. Architecture

```
JobCockpit/
├── .env                      # secrets — jamais commité
├── .env.example              # modèle documenté, commité
├── .gitignore
├── package.json
├── README.md
├── data.db                   # SQLite — gitignoré
├── profile/
│   ├── cv.txt                # texte du CV extrait — gitignoré
│   ├── cv-source.docx        # CV original — gitignoré
│   └── profile.json          # villes, intitulés, règles de scoring — commité
├── public/
│   └── index.html            # dashboard (design actuel préservé)
├── src/
│   ├── server.js             # Express : statique + API REST
│   ├── db.js                 # accès SQLite, migrations de schéma
│   ├── hash.js               # identifiant stable d'une offre
│   ├── sources/
│   │   ├── index.js          # couche d'abstraction, agrégation
│   │   ├── franceTravail.js
│   │   ├── adzuna.js
│   │   ├── jooble.js
│   │   └── indeed.js         # emplacement réservé, inerte (§5.4)
│   ├── scoring.js            # classement 1/2/3/0 (déterministe)
│   ├── gemini.js             # client LLM bas niveau (retry, quota, erreurs)
│   ├── analyze.js            # génération de l'analyse d'offre
│   ├── letter.js             # génération de lettre de motivation
│   └── letterDocx.js         # export .docx de la lettre
├── scripts/
│   ├── extract-cv.js         # .docx → profile/cv.txt (une fois)
│   └── collect.js            # collecteur — cron ET bouton
└── test/
    ├── fixtures/offers.json  # les 11 offres actuelles + groupe attendu
    ├── scoring.test.js
    ├── hash.test.js
    └── sources.test.js       # réponses API figées, aucun appel réseau
```

**Choix Node.js + Express plutôt que Python + FastAPI** : un seul écosystème
pour le backend, le collecteur et le frontend (déjà en JS vanilla), donc un
seul `npm install && npm start` à maintenir. Python serait tout aussi capable
mais ajouterait un second runtime (venv, pip) sans bénéfice — il n'y a ici ni
machine learning ni traitement de données lourd.

**SQLite via `node:sqlite`** : module **intégré à Node.js 22+**, donc aucune
dépendance native à compiler. Fichier unique, aucun serveur à installer, API
synchrone (pas de gestion de callbacks pour un outil mono-utilisateur).

*Décision révisée le 28/07/2026, en cours d'implémentation.* Le choix initial
était `better-sqlite3`, écarté après échec constaté : aucun binaire précompilé
pour Node 24 sous Windows, et la compilation depuis les sources exige Visual
Studio Build Tools (plusieurs Go, droits administrateur). `node:sqlite` offre la
même API synchrone (`prepare` / `get` / `all` / `run` / `exec`, paramètres
nommés, `ON CONFLICT DO UPDATE`), avec deux différences absorbées par `db.js` :
pas d'aide `db.transaction()` (remplacée par un helper `BEGIN`/`COMMIT`/
`ROLLBACK`) et un typage strict refusant `undefined` et les booléens (le code
écrit déjà `?? null` et `? 1 : 0` partout). Bénéfice collatéral : `npm install`
devient instantané pour un non-développeur, et l'hébergement gratuit s'en
trouve simplifié.

### Découpage des responsabilités

Chaque module a une seule raison de changer :

| Module | Rôle | Dépend de |
|---|---|---|
| `sources/*.js` | Parler à **une** API externe, renvoyer des offres normalisées | rien du projet |
| `sources/index.js` | Appeler chaque source, isoler les pannes, fusionner | `sources/*.js`, `hash.js` |
| `scoring.js` | Fonction pure : offre + profil → groupe | rien |
| `analyze.js` | Offre + CV → analyse structurée | `gemini.js` |
| `letter.js` | Offre + analyse + CV → texte de lettre | `gemini.js` |
| `db.js` | Lecture/écriture SQLite | rien |
| `collect.js` | Orchestrer le pipeline | tous les précédents |
| `server.js` | Exposer l'API HTTP | `db.js`, `collect.js`, `letter.js` |

`scoring.js` est une fonction pure et testable sans réseau ni base. Les sources
sont interchangeables sans toucher au reste. Le serveur ne connaît pas les APIs
externes — il appelle `collect.js`.

---

## 4. Modèle de données (SQLite)

### Table `offers` — remplacée/mise à jour par les collectes

| Colonne | Type | Note |
|---|---|---|
| `id` | TEXT PK | hash stable — voir §4.1 |
| `source` | TEXT | `france-travail` \| `adzuna` \| `jooble` \| `indeed` \| `collage` \| `manuel` |
| `sources_all` | TEXT | JSON : toutes les sources où l'offre a été vue |
| `external_id` | TEXT | identifiant chez la source |
| `titre`, `entreprise`, `ville` | TEXT | |
| `departement` | TEXT | code à 2 chiffres, déduit du code postal |
| `hors_zone` | INTEGER | 1 si hors des 4 villes prioritaires |
| `contrat` | TEXT | CDI, CDD, stage… |
| `date_offre` | TEXT | ISO `YYYY-MM-DD`, date de publication |
| `lien` | TEXT | URL de candidature |
| `description` | TEXT | texte brut de l'offre |
| `salaire_source` | TEXT | fourchette annoncée par l'employeur, si présente |
| `groupe` | INTEGER | 1 / 2 / 3 / 0 — produit par `scoring.js` |
| `score` | INTEGER | score numérique brut, pour audit et réglage |
| `score_detail` | TEXT | JSON : mots-clés déclenchés, pour comprendre le verdict |
| `analysis_json` | TEXT | analyse LLM — voir §8 — NULL si non générée |
| `analysis_at` | TEXT | horodatage de génération |
| `is_manual` | INTEGER | 1 pour les offres ajoutées à la main |
| `first_seen`, `last_seen` | TEXT | horodatages ISO |

### Table `tracking` — **données personnelles, jamais écrasées**

| Colonne | Type |
|---|---|
| `offer_id` | TEXT PK |
| `status` | TEXT (`À postuler`, `Envoyé`, `Relancé`, `Entretien`, `Refus`) |
| `sent_date` | TEXT |
| `relance_date` | TEXT |
| `notes` | TEXT |
| `pinned` | INTEGER |
| `updated_at` | TEXT |

### Table `letters`

| Colonne | Type |
|---|---|
| `offer_id` | TEXT PK |
| `content` | TEXT — texte de la lettre, éditable |
| `generated_at` | TEXT |
| `edited` | INTEGER — 1 si retouchée à la main |

Une lettre retouchée (`edited = 1`) déclenche une confirmation avant
régénération, pour ne pas perdre le travail de l'utilisateur.

### Table `meta`

Clé/valeur : `last_collect_at`, `last_collect_status`, `last_collect_summary`,
`migrated_from_localstorage`.

### 4.1 Identifiant stable

```
id = sha1( normalize(titre) + "|" + normalize(entreprise) + "|" + normalize(ville) ).slice(0, 16)
```

`normalize()` : minuscules, accents retirés, ponctuation retirée, mentions
`H/F`, `(H/F)`, `F/H`, `M/F` retirées, espaces compressés, code postal entre
parenthèses retiré de la ville.

Cet identifiant est la clé de voûte du système : il survit à une republication
de l'offre, permet de fusionner la même offre vue sur les 3 sources, et
maintient le lien avec le suivi personnel même si l'offre disparaît puis
réapparaît.

---

## 5. Sources

### Interface commune

Chaque module de `src/sources/` exporte :

```js
module.exports = {
  nom: 'france-travail',
  estConfiguree(env),          // → bool : les clés sont-elles présentes ?
  async chercher({ intitule, ville, rayonKm, depuisDate }), // → [OffreBrute]
};
```

`OffreBrute` est le format normalisé commun : `{ externalId, titre, entreprise,
ville, codePostal, contrat, dateOffre, lien, description, salaireSource }`.

Ajouter une source revient à créer un fichier respectant ce contrat et à
l'enregistrer dans `sources/index.js`. Aucun autre fichier ne change.

### France Travail — « Offres d'emploi v2 »

- Authentification OAuth2 `client_credentials` contre
  `https://entreprise.francetravail.fr/connexion/oauth2/access_token`.
  Le jeton (~24 h) est gardé **en mémoire du processus**, jamais écrit sur disque.
- Recherche : `GET /partenaire/offresdemploi/v2/offres/search`
  avec `motsCles`, `commune` (code INSEE), `distance` (km),
  `minCreationDate`, `range`.
- Seule source à exposer la **description complète** de l'offre → c'est elle qui
  alimente le mieux l'analyse LLM.
- Codes INSEE dans `profile.json` : Strasbourg `67482`, Nancy `54395`,
  Lyon `69123`, Paris `75056`.

### Adzuna

- `GET https://api.adzuna.com/v1/api/jobs/fr/search/1`
  avec `app_id`, `app_key`, `what`, `where`, `distance`, `max_days_old=7`.
- Quota gratuit : **1 000 appels/mois**. Consommation prévue ≈ 375/mois
  (voir §6.1) — marge confortable.
- Description souvent tronquée → l'analyse LLM sera moins riche sur ces offres.
  Si la même offre est aussi vue chez France Travail, c'est la description la
  plus longue qui est conservée.

### Jooble

- `POST https://jooble.org/api/{clé}` avec `{ keywords, location, radius }`.
- Méta-agrégateur : c'est la source dont la couverture ressemble le plus à
  celle d'Indeed.
- Pas de filtre de date côté API → filtrage des 7 jours côté client.

### 5.4 Indeed — emplacement réservé, désactivé

`src/sources/indeed.js` est créé dès la v1 comme **adaptateur inerte** :
il respecte l'interface commune, mais `estConfiguree()` renvoie `false` tant
qu'aucune variable `INDEED_*` n'est présente dans le `.env`. Il est donc
silencieusement sauté à chaque collecte, exactement comme n'importe quelle
source non configurée.

Le fichier documente en commentaire les deux voies d'accès légitimes connues,
et ce qu'il faudrait implémenter dans chaque cas :

- un **partenariat Indeed** (accès commercial à leur API de recherche) ;
- la réouverture d'une **API publique** en libre-service.

Le jour où l'une des deux se concrétise, activer Indeed consiste à compléter la
fonction `chercher()` et à renseigner la clé dans `.env`. **Aucun autre fichier
du projet ne change** — c'est précisément ce que la couche d'abstraction §5
existe pour garantir. Le dédoublonnage par hash (§4.1) fusionnera
automatiquement les offres Indeed avec celles déjà vues ailleurs.

**Précision importante.** Le connecteur Indeed utilisable en conversation avec
Claude n'est *pas* une voie d'accès pour ce projet : c'est un outil de session,
pas une API. Un script lancé par une tâche planifiée ne peut pas l'invoquer,
même quand il fonctionne. Sa remise en service restaure la recherche manuelle
en conversation — c'est ce que couvre l'import par collage (§5.5), pas
l'adaptateur ci-dessus.

### 5.5 Import par collage

`POST /api/offers/paste` accepte un bloc de texte brut : le contenu d'une offre
trouvée par n'importe quel moyen (conversation avec Claude, LinkedIn, APEC,
site carrière d'une entreprise, bouche-à-oreille).

Le backend en extrait titre, entreprise, ville et description via un appel
Gemini au format JSON imposé, puis fait passer l'offre par **exactement le même
pipeline** que les offres collectées automatiquement : hash stable, scoring,
analyse, stockage. Elle est marquée `source = 'collage'`.

C'est le pont entre la collecte automatique et tout ce qu'elle ne couvre pas —
et la réponse durable à l'indisponibilité d'Indeed, quelle qu'en soit la cause.

### Tolérance aux pannes

`sources/index.js` appelle chaque source dans son propre `try/catch`. Une
source en échec est journalisée et **ignorée** ; les autres alimentent quand
même la collecte. Une source non configurée (clé absente du `.env`) est
silencieusement sautée — l'application fonctionne avec une seule clé sur trois.

---

## 6. Pipeline de collecte

`scripts/collect.js` est un script autonome, appelé de façon identique par le
cron et par le bouton « Rafraîchir maintenant ». Un seul chemin de code, donc
pas de divergence de comportement entre les deux déclencheurs.

### 6.1 Étapes

1. **Requêtes.** Pour chaque source × chaque intitulé (5) :
   - **Passe prioritaire** : × chaque ville (4), rayon 30 km.
     Le rayon capture les communes périphériques (Benfeld, Écrouves…).
   - **Passe nationale** : 1 requête sans filtre géographique par intitulé.

   Volume : 3 sources × 5 intitulés × (4 villes + 1 national) = **75 requêtes
   par collecte**, soit ~1 125/mois réparties sur 3 fournisseurs — dont ~375
   pour Adzuna. *Note d'implémentation : si le quota Adzuna (1 000/mois) devait
   se révéler tendu, la passe nationale Adzuna est la première à retirer.*

2. **Filtre de fraîcheur** : offres publiées dans les 7 derniers jours.

3. **Dédoublonnage**, dans cet ordre :
   - par `(source, external_id)` — même offre relue chez le même fournisseur ;
   - par `id` (hash titre+entreprise+ville) — même offre vue chez plusieurs
     fournisseurs. La fusion conserve la description la plus longue et
     accumule les noms de sources dans `sources_all`.

4. **Scoring** (§7) → `groupe`, `score`, `score_detail`.

5. **Filtre hors zone.** Une offre située hors des 4 villes prioritaires n'est
   retenue que si son groupe est **1 (Prioritaire) ou 2 (Possible)**. Les
   groupes 3 et 0 hors zone sont écartés sans être stockés. Les offres retenues
   portent `hors_zone = 1` et un badge dédié dans l'interface.

6. **Analyse LLM** (§8), uniquement pour les groupes 1, 2 et 0, et uniquement
   si `analysis_json` est vide (jamais deux fois pour la même offre — économie
   de quota et stabilité du verdict d'une collecte à l'autre).

7. **Écriture en base.** `INSERT ... ON CONFLICT(id) DO UPDATE` sur `offers`.
   La table `tracking` n'est **jamais** touchée par cette étape.

8. **Journal.** Écriture de `last_collect_at`, `last_collect_status`
   (`ok` / `partiel` / `echec`) et `last_collect_summary` (nombre d'offres
   vues / nouvelles / analysées, sources en échec) dans `meta`.

### 6.2 Offres disparues

Une offre déjà en base et non revue lors d'une collecte est **conservée**
(son `last_seen` ne bouge plus). Supprimer une offre ferait perdre le suivi
associé. Une offre non revue depuis plus de 30 jours et sans suivi
(`status = 'À postuler'`, pas de notes) est purgée automatiquement.

---

## 7. Scoring déterministe

`scoring.js` expose une fonction pure :

```js
function scorer(offre, profil) → { groupe, score, detail }
```

Les règles vivent dans `profile/profile.json` — modifiables sans toucher au
code. Elles opèrent sur `titre + description` normalisés.

### Mots-clés positifs (extraits, pondérés)

| Motif | Poids | Justification (CV) |
|---|---|---|
| `agrivolta` | +4 | 90 % du portefeuille actuel — différenciateur rare |
| `droit public`, `droit de l'environnement` | +3 | M2 Droit et Gestion des Énergies |
| `énergies renouvelables`, `enr`, `photovoltaïque`, `éolien` | +3 | portefeuille de 8 projets |
| `chef de projet`, `chargé de développement` | +2 | poste actuel |
| `juriste`, `veille juridique`, `conformité réglementaire` | +2 | ~50 projets en conformité |
| `concertation`, `acceptabilité`, `parties prenantes` | +2 | concertation élus/riverains |
| `urbanisme`, `autorisation environnementale`, `permis de construire` | +2 | stage droit public/urbanisme |
| `qgis`, `sig`, `cartographie` | +2 | 8 sites cartographiés |
| `rédaction de contrats` | +2 | expérience directe |
| `collectivité territoriale` | +1 | familiarité par la concertation |

### Motifs négatifs et éliminatoires

| Motif | Poids | Justification |
|---|---|---|
| `\b([5-9]\|1\d) ans` d'expérience | **éliminatoire** | ~2 ans d'expérience |
| `m&a`, `fusion-acquisition` | **éliminatoire** | aucune expérience |
| `génie électrique`, `chaudronnerie`, `mécanique` | **éliminatoire** | hors compétences |
| `habilitation défense`, `certification amf` | **éliminatoire** | non détenues |
| `diplôme d'ingénieur` exigé | −3 | profil droit, pas ingénieur |
| `anglais courant`, `bilingue`, `c1` | −2 | anglais professionnel |
| `epc`, `contract management` | −3 | échelle sans rapport |

### Seuils

| Condition | Groupe |
|---|---|
| motif éliminatoire déclenché | **3** — À écarter |
| score ≥ 6 | **1** — Prioritaire |
| score 3 à 5 | **2** — Possible |
| score 1 à 2 | **0** — À vérifier |
| score ≤ 0 | **3** — À écarter |
| description absente ou < 200 caractères | **0** — À vérifier |

`score_detail` conserve la liste des motifs déclenchés : le classement est
toujours auditable et réglable, jamais une boîte noire.

### Calibrage

Les 11 offres actuellement dans `SEED`, avec leur `groupe` attribué à la main,
constituent le jeu de test de `scoring.js` (`test/fixtures/offers.json`). Les
poids sont ajustés jusqu'à reproduire ces classements, ce qui garantit que le
scoring automatique prolonge le jugement déjà porté plutôt que d'en inventer un
autre. **Critère d'acceptation : au moins 9 des 11 offres correctement
classées, et aucune erreur à deux crans (1 classé 3, ou 3 classé 1).**

---

## 8. Analyse LLM

`analyze.js` construit un prompt contenant :

- le **texte du CV** (`profile/cv.txt`, extrait une fois par
  `scripts/extract-cv.js`) ;
- le titre, l'entreprise, la ville et la **description complète** de l'offre ;
- le format JSON de sortie attendu, décrit champ par champ.

Sortie attendue — reprend exactement les champs déjà affichés par le HTML :

```json
{
  "exige":        ["…"],   "souhaite":     ["…"],   "decoratif":  ["…"],
  "prouvable":    ["…"],   "nonprouvable": ["…"],   "compensable":["…"],
  "verdict":      "…",
  "kw":           [["mot-clé", "oui|non|partiel", "pourquoi"]],
  "fourchette":   "32 000 – 38 000 € brut annuel",
  "fnote":        "…",
  "formul":       ["…", "…", "…"],
  "budget":       ["…", "…", "…"]
}
```

### Consignes du prompt

- Distinguer ce qui est **exigé** (rédhibitoire), **souhaité** (négociable) et
  **décoratif** (marketing employeur sans portée).
- Ne déclarer « prouvable » qu'un élément **effectivement présent dans le CV**,
  en le citant.
- Le verdict est direct et tranché (« Oui, c'est pour toi », « Non, l'exigence
  X est éliminatoire ») — pas de langue de bois.
- La fourchette salariale s'appuie sur `salaire_source` si l'employeur en
  annonce une, sinon sur le marché français du secteur, en le précisant.

### Garde-fous

- Réponse parsée en JSON avec validation de forme. Une réponse invalide est
  **ignorée** : `analysis_json` reste NULL, l'offre s'affiche normalement avec
  son groupe et un message « analyse non disponible ». Le dashboard ne casse
  jamais à cause du LLM.
- 1 tentative + 1 reprise, puis abandon pour cette offre.
- Débit limité à 10 requêtes/minute (quota Gemini gratuit : ~15/min).
- Groupe 3 non analysé — économie de quota sur les offres écartées.

---

## 9. Lettre de motivation

### Déclenchement

Bouton **« ✉️ Lettre de motivation »** dans le bloc « Suivi de candidature » de
chaque carte d'offre. Au clic : `POST /api/letter/:id`.

Si une lettre existe déjà, elle est affichée sans nouvel appel au LLM. Le
bouton devient « Régénérer » (avec confirmation si `edited = 1`).

### Structure imposée (lettre française classique « vous – moi – nous »)

1. **Accroche** — pourquoi *cette* entreprise et *ce* poste. Doit citer un
   élément concret de l'offre. Les formules passe-partout (« votre entreprise
   dynamique », « je suis vivement intéressé ») sont explicitement interdites
   dans le prompt.
2. **« Vous »** — la lecture du besoin, reformulé à partir des exigences réelles
   de l'offre. Montre que l'annonce a été lue.
3. **« Moi »** — les preuves du CV répondant point par point aux exigences,
   chiffrées quand c'est possible (« portefeuille de 8 projets solaires,
   éoliens et flottants menés de la faisabilité à l'exploitation »).
4. **« Pourquoi moi et pas un autre »** — le différenciateur, tiré de
   l'analyse : la double compétence droit + gestion de projet, la spécialisation
   agrivoltaïque, la capacité à faire dialoguer bureaux d'études, collectivités
   et riverains. C'est le paragraphe pivot de la lettre.
5. **La motivation, adossée au parcours** — pourquoi ce poste s'inscrit dans une
   trajectoire cohérente (M2 Droit et Gestion des Énergies → développement EnR
   → ce poste), et non un intérêt déclaré sans fondement.
6. **Clôture** — disponibilité, entretien, formule de politesse française
   complète.

### Contraintes passées au prompt

- 350 à 400 mots, 5 à 6 paragraphes.
- Vouvoiement, registre professionnel, première personne.
- **Chaque affirmation doit être adossée à un fait du CV.** Interdiction
  formelle d'inventer une expérience, un chiffre, un diplôme ou un employeur.
- Reprendre le vocabulaire de l'offre (mots-clés ATS) sans copier ses phrases.
- Ne pas nier les manques : si l'analyse a identifié un point faible
  compensable (l'anglais, la durée d'expérience), l'aborder par le contournement
  plutôt que par le silence.
- Objet : `Candidature au poste de {titre} — {entreprise}`.

Le contexte fourni au LLM comprend le CV, l'offre complète, et
`analysis_json` s'il existe — la lettre s'appuie ainsi sur le travail
d'analyse déjà fait (prouvable / compensable / mots-clés).

### Restitution

- Affichage dans la carte, dans un `<textarea>` éditable. Toute modification
  est enregistrée (`PATCH /api/letter/:id`, `edited = 1`).
- Bouton **« Copier »** (presse-papiers).
- Bouton **« Régénérer »**.
- Bouton **« ⬇ Word »** → `GET /api/letter/:id/docx` : document `.docx` mis en
  page via la bibliothèque `docx` (npm) — coordonnées en en-tête (issues du CV :
  nom, e-mail, téléphone, ville), destinataire, date du jour, objet, corps,
  formule de politesse. Mise en page sobre et générique, à retoucher si besoin.

---

## 10. API REST

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/offers` | Toutes les offres + leur suivi + présence d'une lettre |
| `POST` | `/api/offers` | Ajout manuel (formulaire « + Offre » conservé) |
| `POST` | `/api/offers/paste` | Import d'une offre par collage de texte brut (§5.5) |
| `DELETE` | `/api/offers/:id` | Suppression (offres manuelles uniquement) |
| `PATCH` | `/api/track/:id` | Statut, date d'envoi, relance, notes, épingle |
| `POST` | `/api/refresh` | Déclenche une collecte, renvoie le résumé |
| `GET` | `/api/meta` | Date et statut de la dernière collecte |
| `POST` | `/api/letter/:id` | Génère (ou renvoie) la lettre |
| `PATCH` | `/api/letter/:id` | Enregistre la lettre retouchée |
| `GET` | `/api/letter/:id/docx` | Télécharge la lettre en `.docx` |
| `POST` | `/api/migrate` | Import unique depuis `localStorage` (§11) |

Toutes les réponses d'erreur suivent la forme `{ ok: false, error: "message
lisible en français" }` avec un code HTTP adapté. Le frontend affiche ce
message via le système de `toast()` déjà présent.

`POST /api/refresh` est protégé contre les appels concurrents : une collecte
déjà en cours renvoie `409` et le message « Collecte déjà en cours ».

---

## 11. Migration des données personnelles

Au premier chargement du dashboard, le frontend vérifie `GET /api/meta`. Si
`migrated_from_localstorage` est absent, il lit les 4 clés existantes
(`bp_track`, `bp_offers`, `bp_pins`, `bp_lastveille`) et les envoie **une fois**
à `POST /api/migrate`.

Le backend :

1. recalcule le hash stable de chacune des 11 offres de `SEED` (embarquées
   comme table de correspondance `ancien id numérique → nouveau hash`) ;
2. réinsère les suivis, épingles et notes sur ces identifiants ;
3. réinsère les offres ajoutées manuellement (`bp_offers`) avec `is_manual = 1` ;
4. inscrit `migrated_from_localstorage = <date>` dans `meta`.

L'opération est **idempotente** : relancée, elle ne duplique rien et n'écrase
aucune donnée plus récente. Les clés `localStorage` ne sont pas effacées —
elles servent de filet de sécurité.

`bp_theme` (préférence de thème) **reste** en `localStorage` : c'est une
préférence d'affichage, pas une donnée à protéger.

---

## 12. Frontend

`public/index.html` **conserve intégralement** : les 3 thèmes (Vif / EnR /
Nuit), toutes les animations CSS (`fadeUp`, `pop`, `pulse`, `slideIn`, `grow`,
`toastIn`), l'horloge, les 4 vues, le Kanban en glisser-déposer, l'agenda des
relances, les chips de filtrage, les tris, la recherche, l'export CSV et le
responsive.

Modifications, limitées au `<script>` :

| Avant | Après |
|---|---|
| `const SEED = [...]` | `await fetch('/api/offers')` |
| `getTrack()` / `setTrack()` sur `localStorage` | `PATCH /api/track/:id` |
| `getPins()` / `setPins()` | idem, champ `pinned` |
| `getExtra()` / `setExtra()` | `POST` / `DELETE /api/offers` |
| Bandeau « veille à rafraîchir » manuel | Indicateur « dernière mise à jour » depuis `/api/meta` + bouton « 🔄 Rafraîchir maintenant » |

Ajouts visuels :

- Badge **« 🌍 Hors zone »** sur les offres situées hors des 4 villes
  prioritaires (réutilise le style `.badge` existant).
- Badge indiquant la ou les sources de l'offre (France Travail / Adzuna /
  Jooble / collage / manuel).
- Onglet **« 📋 Coller une offre »** dans le formulaire d'ajout existant : une
  grande zone de texte, un bouton « Analyser et ajouter » (§5.5).
- Bloc **lettre de motivation** dans la section « Suivi de candidature ».
- Pendant une collecte : le bouton passe en état chargement (l'animation
  `spin`, déjà déclarée dans le CSS mais inutilisée, sert enfin).

Le fichier restant volumineux, le `<script>` est extrait vers
`public/app.js` et découpé en modules ES (`api.js`, `render.js`, `views.js`).
Le CSS et le HTML ne bougent pas.

---

## 13. Planification

Le collecteur est un script autonome : `npm run collect`.

**Linux / macOS** — `crontab -e` :
```
0 7 */2 * * cd /chemin/vers/JobCockpit && /usr/bin/npm run collect >> collect.log 2>&1
```

**Windows** — tâche planifiée, en PowerShell (une seule ligne) :
```
schtasks /create /tn "JobCockpit" /tr "cmd /c cd /d C:\chemin\vers\JobCockpit && npm run collect >> collect.log 2>&1" /sc daily /mo 2 /st 07:00
```

Les commandes exactes, avec le chemin réel et la marche à suivre écran par
écran, figureront dans le README.

---

## 14. Gestion des erreurs

| Panne | Comportement |
|---|---|
| Une source API indisponible | Journalisée, ignorée ; les autres sources alimentent la collecte ; statut `partiel` |
| Toutes les sources indisponibles | Collecte en `echec` ; **les offres déjà en base restent intactes** ; message explicite dans le dashboard |
| Quota Gemini atteint | Offres stockées avec leur groupe, sans analyse ; réessai à la collecte suivante |
| Réponse LLM mal formée | Ignorée, `analysis_json` reste NULL, l'offre s'affiche quand même |
| Backend arrêté | Le dashboard affiche un message clair au lieu d'une page blanche |
| Base verrouillée | `node:sqlite` en mode WAL ; opérations d'écriture en transaction |

Principe directeur : **aucune panne externe ne doit rendre le dashboard
inutilisable ni faire perdre une donnée personnelle.**

---

## 15. Sécurité et données sensibles

- Secrets (4 clés d'API) exclusivement dans `.env`, chargé par `dotenv`.
  Jamais de valeur en dur dans le code, jamais dans un log.
- `.gitignore` couvre : `.env`, `data.db`, `data.db-*`, `profile/cv.txt`,
  `profile/cv-source.docx`, `node_modules/`, `collect.log`.
- `.env.example` est commité, documenté, et ne contient aucune valeur réelle.
- Le serveur écoute sur `127.0.0.1` par défaut — non exposé au réseau local.
- Le CV et les lettres de motivation contiennent des données personnelles :
  ils restent en local et ne quittent la machine que vers l'API Gemini, ce qui
  est signalé explicitement dans le README.

---

## 16. Tests

- `scoring.test.js` — les 11 offres de référence sont correctement classées
  (critère §7). Fonction pure : aucun réseau, aucune base.
- `hash.test.js` — stabilité du hash : « Chef de Projet ENR H/F » et
  « Chef de projet ENR (H/F) » chez le même employeur produisent le même
  identifiant.
- `sources.test.js` — chaque adaptateur normalise correctement une réponse API
  **figée en fixture** ; aucun appel réseau réel.
- Test d'intégration : `POST /api/refresh` avec des sources simulées écrit bien
  en base **sans toucher** à `tracking` (garantie de non-régression sur le
  point le plus critique du projet).

---

## 17. Hébergement gratuit (optionnel, documenté en fin de README)

Pour faire tourner la collecte sans laisser le PC allumé :

- **Fly.io** — recommandé : volume persistant gratuit, indispensable puisque
  SQLite est un fichier. Le cron devient une `fly machine` planifiée.
- **Render** — plan gratuit, mais **système de fichiers éphémère** : la base
  serait perdue à chaque redéploiement. Nécessiterait de migrer vers Postgres.
- **Railway** — simple, crédit mensuel gratuit limité, volume persistant
  disponible.

Le README documentera Fly.io comme option principale, en insistant sur le point
critique : **le volume persistant pour `data.db`**. Les clés d'API deviennent
des secrets de la plateforme, jamais un fichier `.env` déployé.

---

## 18. À faire côté Benjamin (aucune ne peut être faite à sa place)

1. Créer un compte sur **francetravail.io**, y créer une application, l'abonner
   à l'API « Offres d'emploi v2 » → `client_id` + `client_secret`.
2. Créer un compte sur **developer.adzuna.com** → `app_id` + `app_key`.
3. Demander une clé API sur **jooble.org/api/about**.
4. Créer une clé **Google Gemini** sur `aistudio.google.com` (distincte de celle
   de Méridien).
5. Coller les 4 jeux d'identifiants dans `.env` en suivant `.env.example`.

L'application démarre et fonctionne même si une seule de ces clés est
renseignée : les sources non configurées sont simplement sautées.

---

## 19. Critères d'acceptation

- [ ] `npm install && npm start` sert le dashboard sur `http://localhost:3000`
      avec l'intégralité du design, des animations et des 4 vues d'origine.
- [ ] Les statuts, notes, relances et épingles actuels sont retrouvés après
      migration.
- [ ] Une collecte remplit la base depuis au moins une source réelle.
- [ ] Une collecte ne modifie jamais la table `tracking`.
- [ ] Les 11 offres de référence sont reclassées conformément au critère §7.
- [ ] Le bouton « Rafraîchir maintenant » déclenche une collecte et met à jour
      l'indicateur de dernière mise à jour.
- [ ] Une offre prioritaire hors zone apparaît avec son badge « Hors zone ».
- [ ] Coller le texte d'une offre l'ajoute au dashboard, scorée et analysée.
- [ ] `sources/indeed.js` existe, renvoie `estConfiguree() === false`, et est
      sauté sans erreur ni avertissement lors d'une collecte.
- [ ] Le bouton « Lettre de motivation » produit une lettre conforme à la
      structure §9, éditable, copiable et téléchargeable en `.docx`.
- [ ] Couper le réseau ne casse ni le dashboard ni les données existantes.
- [ ] Le README permet à un non-développeur d'aller de zéro à un dashboard
      fonctionnel.
