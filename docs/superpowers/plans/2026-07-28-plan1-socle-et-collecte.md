# Plan 1 — Socle & collecte : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire le socle du projet et le collecteur autonome, pour que `npm run collect` remplisse `data.db` avec des offres réelles, dédoublonnées, scorées et analysées.

**Architecture:** Modules ES Node.js sans framework. `hash.js` produit l'identifiant stable de chaque offre ; `scoring.js` est une fonction pure classant une offre en 4 groupes selon des règles externalisées dans `profile/profile.json` ; `sources/*.js` sont des adaptateurs interchangeables derrière une interface commune, chacun isolé pour qu'une panne n'affecte pas les autres ; `analyze.js` enrichit les offres retenues via Gemini ; `collect.js` orchestre le tout et écrit dans SQLite sans jamais toucher aux données personnelles.

**Tech Stack:** Node.js 22+ (ESM), `node:sqlite` (module intégré — **aucune dépendance native**), dotenv, @google/genai, mammoth (extraction CV), `node:test` comme runner de test.

> **Révision du 28/07/2026, pendant l'exécution.** Le plan visait initialement
> `better-sqlite3`. Il est impossible à installer ici : aucun binaire précompilé
> pour Node 24 sous Windows, et sa compilation réclame Visual Studio Build Tools.
> Remplacé par `node:sqlite`, intégré à Node. Deux adaptations, toutes deux
> confinées à `src/db.js` :
> - `db.pragma('journal_mode = WAL')` → `db.exec('PRAGMA journal_mode = WAL')`
> - `db.transaction(fn)` n'existe pas → helper `transaction(db, fn)` maison
>
> `node:sqlite` refuse par ailleurs `undefined` et les booléens en paramètre —
> le code de ce plan écrit déjà `?? null` et `? 1 : 0` partout, donc compatible.
> Vérifié empiriquement avant d'écrire la moindre ligne : `prepare`, `get`,
> `all`, `run`, `exec`, paramètres nommés `@cle` et `ON CONFLICT DO UPDATE`
> fonctionnent à l'identique.
>
> Autre écart constaté : Node 24 n'accepte plus un dossier nu pour `--test`.
> Le script npm est donc `node --test "test/**/*.test.js"`.

**Spec de référence:** `docs/superpowers/specs/2026-07-28-job-cockpit-automation-design.md`

---

## ⚠️ Décision préalable requise

Le dossier `JobCockpit/` n'est **pas** un dépôt git. Les tâches ci-dessous comportent des étapes `git commit`. **Avant de commencer, Benjamin doit confirmer le `git init`** (étape 1 de la tâche 1). S'il le refuse, sauter toutes les étapes de commit — le reste du plan fonctionne à l'identique.

---

## Structure des fichiers

| Fichier | Responsabilité | Dépend de |
|---|---|---|
| `package.json` | Dépendances, scripts npm | — |
| `.gitignore` / `.env.example` | Protection des secrets | — |
| `profile/profile.json` | Villes, intitulés, règles de scoring — **modifiable sans coder** | — |
| `src/hash.js` | Identifiant stable d'une offre (fonction pure) | — |
| `src/scoring.js` | Offre + profil → groupe/score/détail (fonction pure) | — |
| `src/db.js` | Schéma SQLite, lecture/écriture, helper de transaction | `node:sqlite` (intégré) |
| `src/sources/index.js` | Orchestration des sources, isolation des pannes | `sources/*.js`, `hash.js` |
| `src/sources/franceTravail.js` | Adaptateur France Travail (OAuth2 + recherche) | — |
| `src/sources/adzuna.js` | Adaptateur Adzuna | — |
| `src/sources/jooble.js` | Adaptateur Jooble | — |
| `src/sources/indeed.js` | Emplacement réservé, inerte | — |
| `src/gemini.js` | Client LLM bas niveau : quota, reprise, erreurs | @google/genai |
| `src/analyze.js` | Offre + CV → analyse structurée | `gemini.js` |
| `scripts/extract-cv.js` | `.docx` → `profile/cv.txt` (une seule fois) | mammoth |
| `scripts/collect.js` | Pipeline complet | tous les précédents |

`hash.js` et `scoring.js` sont des fonctions pures : testables sans réseau ni base, ce sont elles qui portent la logique métier la plus critique.

---

## Task 1: Initialisation du projet

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`, `README.md`

- [ ] **Step 1: Initialiser git (DEMANDER CONFIRMATION À BENJAMIN D'ABORD)**

```bash
cd "C:/Users/BenjaminPerrin/Développement Dropbox/Benjamin PERRIN/Benjamin Perrin/JobCockpit"
git init
```

Si Benjamin refuse : sauter cette étape et toutes les étapes `git commit` du plan.

- [ ] **Step 2: Créer `.gitignore` AVANT tout autre fichier**

Cet ordre est délibéré : le `.gitignore` doit exister avant qu'un `.env` ou un CV puisse être ajouté par erreur à l'index git.

```
# Secrets — ne JAMAIS commiter
.env

# Base de données locale
data.db
data.db-shm
data.db-wal

# Données personnelles (CV, lettres)
profile/cv.txt
profile/cv-source.docx
profile/cv-source.pdf

# Dépendances et journaux
node_modules/
collect.log
npm-debug.log*
```

- [ ] **Step 3: Créer `.env.example` (commité, sans aucune valeur réelle)**

```bash
# ---------------------------------------------------------------
# France Travail — https://francetravail.io
# Créer un compte > Mes applications > nouvelle application
# > s'abonner à l'API « Offres d'emploi v2 » (gratuite)
# ---------------------------------------------------------------
FRANCE_TRAVAIL_CLIENT_ID=
FRANCE_TRAVAIL_CLIENT_SECRET=

# ---------------------------------------------------------------
# Adzuna — https://developer.adzuna.com
# Inscription gratuite, 1000 appels/mois
# ---------------------------------------------------------------
ADZUNA_APP_ID=
ADZUNA_APP_KEY=

# ---------------------------------------------------------------
# Jooble — https://fr.jooble.org/api/about
# Demander une clé API gratuite
# ---------------------------------------------------------------
JOOBLE_API_KEY=

# ---------------------------------------------------------------
# Google Gemini — https://aistudio.google.com/apikey
# Clé gratuite. Sert à l'analyse des offres et aux lettres.
# ---------------------------------------------------------------
GEMINI_API_KEY=

# ---------------------------------------------------------------
# Indeed — RÉSERVÉ, inactif (voir spec §5.4)
# Laisser vide : la source est automatiquement sautée.
# ---------------------------------------------------------------
INDEED_API_KEY=

# Port du serveur (plan 2)
PORT=3000
```

- [ ] **Step 4: Créer `package.json`**

```json
{
  "name": "job-cockpit",
  "version": "1.0.0",
  "description": "Tableau de bord de recherche d'emploi avec collecte automatisée",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "collect": "node scripts/collect.js",
    "extract-cv": "node scripts/extract-cv.js",
    "test": "node --test \"test/**/*.test.js\""
  },
  "dependencies": {
    "@google/genai": "^1.0.0",
    "dotenv": "^16.4.0",
    "mammoth": "^1.8.0"
  }
}
```

Noter l'absence de dépendance SQLite : le module `node:sqlite` est fourni par
Node lui-même. Aucune compilation, aucun outil de build à installer.

- [ ] **Step 5: Installer les dépendances**

Run: `npm install`
Expected: `found 0 vulnerabilities`, aucune erreur, installation quasi
instantanée (les trois paquets sont en JavaScript pur).

- [ ] **Step 6: Vérifier que le runner de test fonctionne**

Créer `test/smoke.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('le runner de test fonctionne', () => {
  assert.equal(1 + 1, 2);
});
```

Run: `npm test`
Expected: `# pass 1`, `# fail 0`

- [ ] **Step 7: Commit**

```bash
git add .gitignore .env.example package.json package-lock.json test/smoke.test.js
git commit -m "chore: initialise le projet Job Cockpit"
```

**Vérifier que `.env` et `data.db` ne sont PAS dans le commit :** `git show --stat HEAD`

---

## Task 2: `src/hash.js` — identifiant stable

C'est la pièce la plus critique du projet : cet identifiant relie une offre à son suivi personnel. S'il change, le suivi est perdu.

**Files:**
- Create: `src/hash.js`
- Test: `test/hash.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

`test/hash.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliser, offreId } from '../src/hash.js';

test('normaliser met en minuscules et retire les accents', () => {
  assert.equal(normaliser('Chargé de Développement ÉNERGIE'), 'charge de developpement energie');
});

test('normaliser retire les mentions H/F sous toutes leurs formes', () => {
  assert.equal(normaliser('Juriste H/F'), 'juriste');
  assert.equal(normaliser('Juriste (H/F)'), 'juriste');
  assert.equal(normaliser('Juriste F/H'), 'juriste');
  assert.equal(normaliser('Juriste (h/f)'), 'juriste');
  assert.equal(normaliser('Chef de projet M/F'), 'chef de projet');
});

test('normaliser retire le code postal entre parenthèses', () => {
  assert.equal(normaliser('Strasbourg (67)'), 'strasbourg');
  assert.equal(normaliser('La Seyne-sur-Mer (83)'), 'la seyne sur mer');
});

test('normaliser compresse les espaces multiples', () => {
  assert.equal(normaliser('Chef   de    projet'), 'chef de projet');
});

test('offreId est identique malgré les variantes de graphie', () => {
  const a = offreId('Chef de projet ENR H/F', 'Veles Energies', 'Bordeaux (33)');
  const b = offreId('Chef de Projet ENR (H/F)', 'VELES ENERGIES', 'bordeaux');
  assert.equal(a, b);
});

test('offreId diffère pour deux offres différentes', () => {
  const a = offreId('Contract Manager', 'PAPREC', 'Paris (75)');
  const b = offreId('Contract Manager', 'PAPREC', 'La Seyne-sur-Mer (83)');
  assert.notEqual(a, b);
});

test('offreId fait 16 caractères hexadécimaux', () => {
  const id = offreId('Juriste', 'ACME', 'Nancy');
  assert.match(id, /^[0-9a-f]{16}$/);
});

test('offreId tolère les champs vides sans planter', () => {
  assert.match(offreId('Juriste', '', ''), /^[0-9a-f]{16}$/);
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `node --test test/hash.test.js`
Expected: FAIL — `Cannot find module '../src/hash.js'`

- [ ] **Step 3: Écrire l'implémentation**

`src/hash.js` :

```js
// Identifiant stable d'une offre.
// Cet identifiant relie une offre au suivi personnel (statut, notes, relances).
// Il doit rester IDENTIQUE quand la même offre est republiée ou vue sur une
// autre plateforme, sinon le suivi est perdu.
import { createHash } from 'node:crypto';

// Retire les variantes de la mention « homme/femme » : H/F, (H/F), F/H, M/F…
const MENTION_HF = /\(?\s*[hfm]\s*\/\s*[hfm]\s*\)?/gi;

// Retire un code postal ou département entre parenthèses : « Strasbourg (67) »
const CODE_POSTAL = /\(\s*\d{2,5}\s*\)/g;

/**
 * Normalise une chaîne pour la rendre comparable :
 * minuscules, sans accents, sans ponctuation, espaces compressés.
 */
export function normaliser(texte) {
  if (!texte) return '';
  return String(texte)
    .normalize('NFD')                      // décompose les caractères accentués
    .replace(/[\u0300-\u036f]/g, '')       // retire les diacritiques
    .toLowerCase()
    .replace(CODE_POSTAL, ' ')
    .replace(MENTION_HF, ' ')
    .replace(/[^a-z0-9]+/g, ' ')           // toute ponctuation devient espace
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Identifiant stable calculé sur titre + entreprise + ville normalisés.
 * 16 caractères : suffisant pour éviter toute collision à cette échelle
 * (quelques milliers d'offres), et lisible dans les URL et les logs.
 */
export function offreId(titre, entreprise, ville) {
  const cle = [normaliser(titre), normaliser(entreprise), normaliser(ville)].join('|');
  return createHash('sha1').update(cle, 'utf8').digest('hex').slice(0, 16);
}
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `node --test test/hash.test.js`
Expected: `# pass 8`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/hash.js test/hash.test.js
git commit -m "feat: identifiant stable des offres (hash titre+entreprise+ville)"
```

---

## Task 3: `profile/profile.json` — profil et règles de scoring

**Files:**
- Create: `profile/profile.json`

- [ ] **Step 1: Créer le fichier**

Ce fichier est **commité** (aucune donnée sensible) et conçu pour être modifié par Benjamin sans toucher au code : ajuster un poids, ajouter un mot-clé ou une ville ne demande aucune compétence en programmation.

`profile/profile.json` :

```json
{
  "villesPrioritaires": [
    { "nom": "Strasbourg", "codeInsee": "67482", "departement": "67" },
    { "nom": "Nancy",      "codeInsee": "54395", "departement": "54" },
    { "nom": "Lyon",       "codeInsee": "69123", "departement": "69" },
    { "nom": "Paris",      "codeInsee": "75056", "departement": "75" }
  ],
  "rayonKm": 30,
  "intitules": [
    "chef de projet énergies renouvelables",
    "chargé de développement EnR",
    "juriste droit public environnement",
    "chef de projet agrivoltaïque",
    "chargé de projet aménagement énergie"
  ],
  "fraicheurJours": 7,
  "scoring": {
    "positifs": [
      { "motif": "agrivolta",                          "poids": 4, "note": "90% du portefeuille actuel — différenciateur rare" },
      { "motif": "droit public",                       "poids": 3, "note": "M2 Droit et Gestion des Énergies" },
      { "motif": "droit de l environnement",           "poids": 3, "note": "M2 + stage cabinet — apostrophe devenue espace après normalisation" },
      { "motif": "energies renouvelables|\\benr\\b",   "poids": 3, "note": "portefeuille de 8 projets" },
      { "motif": "photovolta|solaire|eolien",          "poids": 3, "note": "projets solaires, éoliens, flottants" },
      { "motif": "chef de projet|charge de developpement|charge de projet", "poids": 2, "note": "poste actuel" },
      { "motif": "gestion de projet",                  "poids": 2, "note": "poste actuel" },
      { "motif": "\\benergie",                         "poids": 2, "note": "secteur d'exercice" },
      { "motif": "juriste|juridique",                  "poids": 2, "note": "double compétence" },
      { "motif": "veille juridique|veille reglementaire|conformite reglementaire|reglementation", "poids": 2, "note": "~50 projets en conformité" },
      { "motif": "concertation|acceptabilite|parties prenantes", "poids": 2, "note": "concertation élus/collectivités/riverains" },
      { "motif": "urbanisme",                          "poids": 2, "note": "stage droit public/urbanisme" },
      { "motif": "autorisation environnementale|permis de construire", "poids": 2, "note": "procédures projets EnR" },
      { "motif": "qgis|\\bsig\\b|cartographie",        "poids": 2, "note": "8 sites cartographiés" },
      { "motif": "redaction de contrats|contractuel",  "poids": 2, "note": "rédaction de contrats" },
      { "motif": "collectivite|commune|intercommunal", "poids": 1, "note": "familiarité par la concertation" },
      { "motif": "budget|financier",                   "poids": 1, "note": "Budget Sheets, simulations financières" }
    ],
    "negatifs": [
      { "motif": "diplome d ingenieur|ecole d ingenieur", "poids": -3, "note": "profil droit, pas ingénieur" },
      { "motif": "anglais courant|bilingue|anglais c1",   "poids": -2, "note": "anglais professionnel, pas courant" },
      { "motif": "\\bepc\\b|contract management",        "poids": -3, "note": "échelle et métier sans rapport" },
      { "motif": "experience confirmee|profil confirme", "poids": -3, "note": "~2 ans d'expérience" }
    ],
    "eliminatoires": [
      { "motif": "\\b([5-9]|[1-9]\\d)\\s*(ans|annees)\\b", "note": "exigence d'expérience hors de portée (~2 ans)" },
      { "motif": "\\bm a\\b|fusion acquisition",         "note": "aucune expérience en M&A — « M&A » devient « m a » après normalisation" },
      { "motif": "genie electrique|chaudronnerie|mecanique|desp|asme", "note": "hors compétences techniques" },
      { "motif": "habilitation defense|certification amf|\\bamf\\b",  "note": "habilitations non détenues" }
    ],
    "seuils": {
      "prioritaire": 6,
      "possible": 3,
      "aVerifier": 1,
      "descriptionMiniCaracteres": 200
    }
  }
}
```

**⚠ Note IMPORTANTE sur les motifs.** Ce sont des expressions régulières
appliquées au texte **déjà passé par `normaliser()`**. Cette fonction met en
minuscules, retire les accents, et **remplace toute ponctuation par un espace**.
Un motif doit donc être écrit dans cette forme normalisée, sinon il ne matchera
jamais — en silence :

| Texte de l'offre | Après normalisation | Motif à écrire |
|---|---|---|
| `agrivoltaïque` | `agrivoltaique` | `agrivolta` |
| `M&A` | `m a` | `\\bm a\\b` |
| `droit de l'environnement` | `droit de l environnement` | `droit de l environnement` |
| `diplôme d'ingénieur` | `diplome d ingenieur` | `diplome d ingenieur` |

En ajoutant un motif plus tard, toujours vérifier ce qu'en fait `normaliser()` :
`node -e "import('./src/hash.js').then(m => console.log(m.normaliser(\"M&A\")))"`

- [ ] **Step 2: Vérifier que le JSON est valide**

Run: `node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('profile/profile.json','utf8'))))"`
Expected: `[ 'villesPrioritaires', 'rayonKm', 'intitules', 'fraicheurJours', 'scoring' ]`

- [ ] **Step 3: Commit**

```bash
git add profile/profile.json
git commit -m "feat: profil et règles de scoring externalisés"
```

---

## Task 4: `src/scoring.js` — classement déterministe

**Files:**
- Create: `src/scoring.js`, `test/fixtures/offers.json`
- Test: `test/scoring.test.js`

- [ ] **Step 1: Créer le jeu de test à partir des 11 offres réelles**

Ces 11 offres viennent de la constante `SEED` du dashboard actuel, avec le
groupe que Benjamin leur a attribué à la main. Le fichier d'origine ne contenant
pas les descriptions brutes, le champ `description` est reconstitué à partir des
listes `exige` + `souhaite` de l'analyse — un substitut fidèle pour tester le
scoring, puisque ce sont ces éléments que le scoring lit.

`test/fixtures/offers.json` :

```json
[
  { "attendu": 1, "titre": "Chef de Projet Junior Aménagement et Énergie", "entreprise": "BARAN RECRUTEMENT", "ville": "Strasbourg (67)",
    "description": "Formation supérieure Ingénieur ou Master. Première expérience en gestion de projet. Connaissances des réglementations et des financements. Expérience idéalement en aménagement, énergie ou rénovation. Bon relationnel, sens pédagogique. Vous piloterez des projets d'aménagement et d'énergie pour des collectivités, avec suivi budgétaire et coordination des bureaux d'études." },

  { "attendu": 1, "titre": "Juriste H/F", "entreprise": "CC du Canton d'Erstein", "ville": "Benfeld (67)",
    "description": "Bac+4 ou Bac+5 en droit. Droit public, droit administratif, droit des collectivités territoriales. Capacités rédactionnelles. Bonne compréhension du fonctionnement des collectivités. Permis B apprécié. Vous assurerez le conseil juridique, le contrôle de légalité des actes et la rédaction de notes d'aide à la décision, ainsi que la veille juridique de la collectivité." },

  { "attendu": 0, "titre": "Conseiller·ère juridique", "entreprise": "Département de Meurthe-et-Moselle", "ville": "Écrouves (54)",
    "description": "Fiche non récupérée." },

  { "attendu": 2, "titre": "Chef de projet ENR H/F", "entreprise": "Veles Energies", "ville": "Bordeaux (33)",
    "description": "Bac+5 ingénieur, urbanisme ou droit de l'environnement. Expérience confirmée en développement ENR. Maîtrise des procédures d'autorisation. Anglais courant exigé. Permis B. Idéalement une expérience en solaire ou agrivoltaïque. Vous développerez un portefeuille de projets photovoltaïques, de la prospection au dépôt des autorisations, en menant la concertation locale." },

  { "attendu": 3, "titre": "Juriste M&A et Financement H/F", "entreprise": "TENERGIE", "ville": "Fuveau (13)",
    "description": "5 années confirmées d'expérience en juridique M&A exigées. Rédaction de contrats. Financement de projets. Vous interviendrez sur les opérations de fusion-acquisition et le financement des actifs du groupe." },

  { "attendu": 3, "titre": "Responsable Énergie H/F", "entreprise": "Société des 3 Vallées", "ville": "Courchevel (73)",
    "description": "Formation en génie électrique. Gestion énergétique de sites complexes. Connaissance des réseaux et de la supervision. Certification ISO 50001 appréciée. Un vrai projet de vie en montagne." },

  { "attendu": 3, "titre": "Juriste Contract Manager H/F", "entreprise": "Thales", "ville": "Élancourt (78)",
    "description": "Droit des affaires ou droit de la défense. 8 ans minimum d'expérience. Anglais courant impératif. Habilitation défense requise. Vision business. Vous piloterez les contrats complexes de la division." },

  { "attendu": 3, "titre": "Contract Manager H/F", "entreprise": "PAPREC", "ville": "Paris (75)",
    "description": "Diplôme d'ingénieur. 10 ans d'expérience dont 5 ans en contract management. Maîtrise des contrats EPC. Anglais courant. Vous gérerez les contrats de construction des unités de valorisation." },

  { "attendu": 3, "titre": "Contract Manager H/F", "entreprise": "PAPREC", "ville": "La Seyne-sur-Mer (83)",
    "description": "Diplôme d'ingénieur. 10 ans d'expérience dont 5 ans en contract management. Maîtrise des contrats EPC. Anglais courant. Vous gérerez les contrats de construction des unités de valorisation." },

  { "attendu": 3, "titre": "Chef de Projet Industriel H/F", "entreprise": "Groupe PARLYM", "ville": "Rueil-Malmaison (92)",
    "description": "Diplôme d'ingénieur. Mécanique, DESP, ASME. Chaudronnerie industrielle. Anglais C1. Maîtrise d'un ERP et de MS Project. Best Place to Work." },

  { "attendu": 3, "titre": "RCSI / Head of Compliance", "entreprise": "Fed Group", "ville": "Paris (75)",
    "description": "Certification AMF obligatoire. 10 ans et plus en conformité réglementaire. Expérience de direction d'équipe. Vous porterez la fonction de responsable de la conformité et du contrôle interne." }
]
```

- [ ] **Step 2: Écrire le test qui échoue**

`test/scoring.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scorer } from '../src/scoring.js';

const profil = JSON.parse(readFileSync(new URL('../profile/profile.json', import.meta.url), 'utf8'));
const offres = JSON.parse(readFileSync(new URL('./fixtures/offers.json', import.meta.url), 'utf8'));

test('un motif éliminatoire classe directement en groupe 3', () => {
  const r = scorer({ titre: 'Juriste M&A', description: '5 ans en M&A exigés.'.padEnd(250, ' .') }, profil);
  assert.equal(r.groupe, 3);
  assert.ok(r.detail.eliminatoires.length > 0, 'le motif éliminatoire doit être tracé');
});

test('une description trop courte classe en groupe 0 (à vérifier)', () => {
  const r = scorer({ titre: 'Juriste', description: 'Trop court.' }, profil);
  assert.equal(r.groupe, 0);
});

test('score_detail liste les motifs déclenchés (verdict auditable)', () => {
  const r = scorer(offres[0], profil);
  assert.ok(Array.isArray(r.detail.positifs));
  assert.ok(r.detail.positifs.length > 0);
  assert.ok(typeof r.score === 'number');
});

test('« 2 ans d\'expérience » ne déclenche PAS le motif éliminatoire', () => {
  const r = scorer({
    titre: 'Chef de projet EnR',
    description: 'Une première expérience de 2 ans en énergies renouvelables. Développement de projets photovoltaïques et concertation locale avec les collectivités territoriales.'.padEnd(250, ' .')
  }, profil);
  assert.notEqual(r.groupe, 3);
});

// Test de calibrage : le scoring doit reproduire le jugement déjà porté.
test('les 11 offres de référence sont correctement classées', () => {
  const resultats = offres.map(o => ({
    titre: o.titre,
    attendu: o.attendu,
    obtenu: scorer(o, profil).groupe,
  }));

  const exacts = resultats.filter(r => r.obtenu === r.attendu);
  const rang = { 1: 0, 2: 1, 0: 2, 3: 3 };
  const graves = resultats.filter(r => Math.abs(rang[r.obtenu] - rang[r.attendu]) >= 3);

  const rapport = resultats
    .map(r => `${r.obtenu === r.attendu ? 'OK ' : 'KO '} attendu=${r.attendu} obtenu=${r.obtenu}  ${r.titre}`)
    .join('\n');

  assert.equal(graves.length, 0, `Erreur à deux crans détectée :\n${rapport}`);
  assert.ok(exacts.length >= 9, `Seulement ${exacts.length}/11 exacts :\n${rapport}`);
});
```

**Note pour l'implémenteur :** l'offre Veles Energies (attendu `2`) sortira
probablement en `1` — son score agrivoltaïque est très élevé. C'est un écart
d'un cran, **toléré par le critère d'acceptation**. Ne pas tordre les poids pour
la faire rentrer : cela dégraderait le classement des autres.

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `node --test test/scoring.test.js`
Expected: FAIL — `Cannot find module '../src/scoring.js'`

- [ ] **Step 4: Écrire l'implémentation**

`src/scoring.js` :

```js
// Classement déterministe d'une offre en 4 groupes.
// Fonction PURE : aucun appel réseau, aucune base, aucun effet de bord.
// Les règles vivent dans profile/profile.json — modifiables sans toucher au code.
import { normaliser } from './hash.js';

/**
 * @param {{titre: string, description?: string}} offre
 * @param {object} profil  contenu de profile/profile.json
 * @returns {{groupe: 0|1|2|3, score: number, detail: object}}
 */
export function scorer(offre, profil) {
  const regles = profil.scoring;
  const seuils = regles.seuils;

  const description = offre.description || '';
  const texte = normaliser(`${offre.titre || ''} ${description}`);

  const detail = { positifs: [], negatifs: [], eliminatoires: [] };
  let score = 0;

  // 1. Motifs éliminatoires — priment sur tout le reste.
  for (const regle of regles.eliminatoires) {
    if (new RegExp(regle.motif, 'i').test(texte)) {
      detail.eliminatoires.push({ motif: regle.motif, note: regle.note });
    }
  }
  if (detail.eliminatoires.length > 0) {
    return { groupe: 3, score: 0, detail };
  }

  // 2. Description absente ou trop courte : impossible de juger sérieusement.
  //    On ne classe pas « à écarter » par défaut — on demande une vérification.
  if (description.length < seuils.descriptionMiniCaracteres) {
    return { groupe: 0, score: 0, detail };
  }

  // 3. Cumul des motifs positifs et négatifs.
  for (const regle of regles.positifs) {
    if (new RegExp(regle.motif, 'i').test(texte)) {
      score += regle.poids;
      detail.positifs.push({ motif: regle.motif, poids: regle.poids, note: regle.note });
    }
  }
  for (const regle of regles.negatifs) {
    if (new RegExp(regle.motif, 'i').test(texte)) {
      score += regle.poids; // poids déjà négatif
      detail.negatifs.push({ motif: regle.motif, poids: regle.poids, note: regle.note });
    }
  }

  // 4. Application des seuils.
  let groupe;
  if (score >= seuils.prioritaire) groupe = 1;
  else if (score >= seuils.possible) groupe = 2;
  else if (score >= seuils.aVerifier) groupe = 0;
  else groupe = 3;

  return { groupe, score, detail };
}
```

- [ ] **Step 5: Lancer le test**

Run: `node --test test/scoring.test.js`
Expected: tous les tests passent. Si le test de calibrage échoue, lire le
rapport affiché (il liste offre par offre attendu/obtenu) et ajuster **les poids
dans `profile/profile.json`**, jamais le code de `scoring.js`.

- [ ] **Step 6: Commit**

```bash
git add src/scoring.js test/scoring.test.js test/fixtures/offers.json
git commit -m "feat: scoring déterministe calibré sur les 11 offres de référence"
```

---

## Task 5: `src/db.js` — schéma SQLite

**Files:**
- Create: `src/db.js`
- Test: `test/db.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

`test/db.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase } from '../src/db.js';

test('ouvrirBase crée les 4 tables attendues', () => {
  const db = ouvrirBase(':memory:');
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map(r => r.name);

  for (const attendue of ['letters', 'meta', 'offers', 'tracking']) {
    assert.ok(tables.includes(attendue), `table « ${attendue} » manquante`);
  }
  db.close();
});

test('ouvrirBase est idempotente (relançable sans erreur)', () => {
  const db = ouvrirBase(':memory:');
  assert.doesNotThrow(() => ouvrirBase(':memory:'));
  db.close();
});

test('meta stocke et relit une valeur', () => {
  const db = ouvrirBase(':memory:');
  db.prepare('INSERT INTO meta (cle, valeur) VALUES (?, ?)').run('last_collect_at', '2026-07-28T07:00:00Z');
  const v = db.prepare('SELECT valeur FROM meta WHERE cle = ?').get('last_collect_at');
  assert.equal(v.valeur, '2026-07-28T07:00:00Z');
  db.close();
});

test('offers refuse deux offres avec le même id', () => {
  const db = ouvrirBase(':memory:');
  const ins = db.prepare('INSERT INTO offers (id, titre, entreprise, ville) VALUES (?, ?, ?, ?)');
  ins.run('abc123', 'Juriste', 'ACME', 'Nancy');
  assert.throws(() => ins.run('abc123', 'Autre', 'AUTRE', 'Lyon'), /UNIQUE/);
  db.close();
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `node --test test/db.test.js`
Expected: FAIL — `Cannot find module '../src/db.js'`

- [ ] **Step 3: Écrire l'implémentation**

`src/db.js` :

```js
// Accès à la base SQLite.
// La table `tracking` contient les données personnelles de Benjamin
// (statuts, notes, relances, épingles) : elle n'est JAMAIS écrite par une
// collecte. C'est la garantie la plus importante du projet.
//
// node:sqlite est INTÉGRÉ à Node.js — aucune dépendance à installer.
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS offers (
  id             TEXT PRIMARY KEY,
  source         TEXT,
  sources_all    TEXT,
  external_id    TEXT,
  titre          TEXT NOT NULL,
  entreprise     TEXT,
  ville          TEXT,
  departement    TEXT,
  hors_zone      INTEGER DEFAULT 0,
  contrat        TEXT,
  date_offre     TEXT,
  lien           TEXT,
  description    TEXT,
  salaire_source TEXT,
  groupe         INTEGER,
  score          INTEGER,
  score_detail   TEXT,
  analysis_json  TEXT,
  analysis_at    TEXT,
  is_manual      INTEGER DEFAULT 0,
  first_seen     TEXT,
  last_seen      TEXT
);

CREATE INDEX IF NOT EXISTS idx_offers_groupe    ON offers(groupe);
CREATE INDEX IF NOT EXISTS idx_offers_date      ON offers(date_offre);
CREATE INDEX IF NOT EXISTS idx_offers_last_seen ON offers(last_seen);

CREATE TABLE IF NOT EXISTS tracking (
  offer_id     TEXT PRIMARY KEY,
  status       TEXT DEFAULT 'À postuler',
  sent_date    TEXT,
  relance_date TEXT,
  notes        TEXT,
  pinned       INTEGER DEFAULT 0,
  updated_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracking_relance ON tracking(relance_date);

CREATE TABLE IF NOT EXISTS letters (
  offer_id     TEXT PRIMARY KEY,
  content      TEXT,
  generated_at TEXT,
  edited       INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
  cle    TEXT PRIMARY KEY,
  valeur TEXT
);
`;

/**
 * Ouvre la base et applique le schéma. Idempotent : appelable à chaque
 * démarrage sans risque pour les données existantes.
 * @param {string} chemin  fichier .db, ou ':memory:' pour les tests
 */
export function ouvrirBase(chemin = 'data.db') {
  const db = new DatabaseSync(chemin);
  // WAL : autorise une lecture (le serveur) pendant une écriture (la collecte).
  // Sans effet sur ':memory:', qui reste en mode « memory » — c'est normal.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

/**
 * Exécute `fn` dans une transaction, avec annulation en cas d'erreur.
 *
 * node:sqlite ne fournit pas l'aide `db.transaction()` de better-sqlite3 :
 * on pilote donc BEGIN / COMMIT / ROLLBACK à la main.
 * @returns la valeur retournée par `fn`
 */
export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const resultat = fn();
    db.exec('COMMIT');
    return resultat;
  } catch (erreur) {
    db.exec('ROLLBACK');
    throw erreur;
  }
}

/** Lit une valeur de la table meta. */
export function lireMeta(db, cle) {
  const ligne = db.prepare('SELECT valeur FROM meta WHERE cle = ?').get(cle);
  return ligne ? ligne.valeur : null;
}

/** Écrit (ou remplace) une valeur dans la table meta. */
export function ecrireMeta(db, cle, valeur) {
  db.prepare(
    'INSERT INTO meta (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur'
  ).run(cle, String(valeur));
}
```

- [ ] **Step 4: Lancer le test**

Run: `node --test test/db.test.js`
Expected: `# pass 4`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "feat: schéma SQLite (offers, tracking, letters, meta)"
```

---

## Task 6: `src/db.js` — upsert d'offre préservant le suivi

C'est le test le plus important du plan : il verrouille la garantie que la
collecte ne détruit jamais les données personnelles.

**Files:**
- Modify: `src/db.js` (ajout de `upsertOffre`)
- Test: `test/db-upsert.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

`test/db-upsert.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase, upsertOffre } from '../src/db.js';

function offreExemple(surcharge = {}) {
  return {
    id: 'abc123', source: 'france-travail', sourcesAll: ['france-travail'],
    externalId: 'FT-1', titre: 'Chef de projet EnR', entreprise: 'ACME',
    ville: 'Nancy (54)', departement: '54', horsZone: 0, contrat: 'CDI',
    dateOffre: '2026-07-25', lien: 'https://example.org/1',
    description: 'Description complète de l\'offre.', salaireSource: null,
    groupe: 1, score: 9, scoreDetail: { positifs: [] },
    ...surcharge,
  };
}

test('upsertOffre insère une nouvelle offre', () => {
  const db = ouvrirBase(':memory:');
  const r = upsertOffre(db, offreExemple());
  assert.equal(r.nouvelle, true);

  const ligne = db.prepare('SELECT * FROM offers WHERE id = ?').get('abc123');
  assert.equal(ligne.titre, 'Chef de projet EnR');
  assert.equal(ligne.groupe, 1);
  assert.ok(ligne.first_seen);
  db.close();
});

test('upsertOffre met à jour une offre déjà connue sans la dupliquer', () => {
  const db = ouvrirBase(':memory:');
  upsertOffre(db, offreExemple());
  const r = upsertOffre(db, offreExemple({ groupe: 2, score: 4 }));
  assert.equal(r.nouvelle, false);

  const n = db.prepare('SELECT COUNT(*) AS n FROM offers').get().n;
  assert.equal(n, 1);
  assert.equal(db.prepare('SELECT groupe FROM offers WHERE id = ?').get('abc123').groupe, 2);
  db.close();
});

test('upsertOffre conserve first_seen lors d\'une mise à jour', () => {
  const db = ouvrirBase(':memory:');
  upsertOffre(db, offreExemple());
  const avant = db.prepare('SELECT first_seen FROM offers WHERE id = ?').get('abc123').first_seen;
  upsertOffre(db, offreExemple({ titre: 'Titre modifié' }));
  const apres = db.prepare('SELECT first_seen FROM offers WHERE id = ?').get('abc123').first_seen;
  assert.equal(avant, apres);
  db.close();
});

test('upsertOffre n\'écrase JAMAIS une analyse existante par une valeur vide', () => {
  const db = ouvrirBase(':memory:');
  upsertOffre(db, offreExemple({ analysisJson: { verdict: 'Oui, fonce.' } }));
  upsertOffre(db, offreExemple({ analysisJson: null }));

  const ligne = db.prepare('SELECT analysis_json FROM offers WHERE id = ?').get('abc123');
  assert.equal(JSON.parse(ligne.analysis_json).verdict, 'Oui, fonce.');
  db.close();
});

// ---- LE TEST CRITIQUE DU PROJET ----
test('upsertOffre ne touche JAMAIS aux données personnelles', () => {
  const db = ouvrirBase(':memory:');
  upsertOffre(db, offreExemple());

  db.prepare(`INSERT INTO tracking (offer_id, status, sent_date, relance_date, notes, pinned, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('abc123', 'Entretien', '2026-07-20', '2026-08-05', 'Contact : Mme Durand', 1, '2026-07-20');

  // Une collecte ultérieure revoit l'offre, avec des données différentes.
  upsertOffre(db, offreExemple({ groupe: 3, titre: 'Titre changé', description: 'Autre.' }));

  const t = db.prepare('SELECT * FROM tracking WHERE offer_id = ?').get('abc123');
  assert.equal(t.status, 'Entretien');
  assert.equal(t.sent_date, '2026-07-20');
  assert.equal(t.relance_date, '2026-08-05');
  assert.equal(t.notes, 'Contact : Mme Durand');
  assert.equal(t.pinned, 1);
  db.close();
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `node --test test/db-upsert.test.js`
Expected: FAIL — `upsertOffre is not a function`

- [ ] **Step 3: Ajouter `upsertOffre` à la fin de `src/db.js`**

```js
/**
 * Insère ou met à jour une offre.
 *
 * GARANTIE : cette fonction n'écrit QUE dans la table `offers`.
 * Elle ne touche jamais `tracking` ni `letters` — les données personnelles
 * survivent à toutes les collectes.
 *
 * @returns {{nouvelle: boolean}}
 */
export function upsertOffre(db, offre) {
  const maintenant = new Date().toISOString();
  const existante = db.prepare('SELECT id FROM offers WHERE id = ?').get(offre.id);

  db.prepare(`
    INSERT INTO offers (
      id, source, sources_all, external_id, titre, entreprise, ville, departement,
      hors_zone, contrat, date_offre, lien, description, salaire_source,
      groupe, score, score_detail, analysis_json, analysis_at,
      is_manual, first_seen, last_seen
    ) VALUES (
      @id, @source, @sourcesAll, @externalId, @titre, @entreprise, @ville, @departement,
      @horsZone, @contrat, @dateOffre, @lien, @description, @salaireSource,
      @groupe, @score, @scoreDetail, @analysisJson, @analysisAt,
      @isManual, @maintenant, @maintenant
    )
    ON CONFLICT(id) DO UPDATE SET
      source         = excluded.source,
      sources_all    = excluded.sources_all,
      external_id    = excluded.external_id,
      titre          = excluded.titre,
      entreprise     = excluded.entreprise,
      ville          = excluded.ville,
      departement    = excluded.departement,
      hors_zone      = excluded.hors_zone,
      contrat        = excluded.contrat,
      date_offre     = excluded.date_offre,
      lien           = excluded.lien,
      -- on garde la description la plus longue (Adzuna tronque, France Travail non)
      description    = CASE WHEN length(COALESCE(excluded.description, '')) > length(COALESCE(offers.description, ''))
                            THEN excluded.description ELSE offers.description END,
      salaire_source = COALESCE(excluded.salaire_source, offers.salaire_source),
      groupe         = excluded.groupe,
      score          = excluded.score,
      score_detail   = excluded.score_detail,
      -- une analyse déjà produite n'est jamais écrasée par une valeur vide
      analysis_json  = COALESCE(excluded.analysis_json, offers.analysis_json),
      analysis_at    = COALESCE(excluded.analysis_at, offers.analysis_at),
      last_seen      = excluded.last_seen
  `).run({
    id: offre.id,
    source: offre.source ?? null,
    sourcesAll: JSON.stringify(offre.sourcesAll ?? []),
    externalId: offre.externalId ?? null,
    titre: offre.titre,
    entreprise: offre.entreprise ?? null,
    ville: offre.ville ?? null,
    departement: offre.departement ?? null,
    horsZone: offre.horsZone ? 1 : 0,
    contrat: offre.contrat ?? null,
    dateOffre: offre.dateOffre ?? null,
    lien: offre.lien ?? null,
    description: offre.description ?? null,
    salaireSource: offre.salaireSource ?? null,
    groupe: offre.groupe ?? null,
    score: offre.score ?? null,
    scoreDetail: offre.scoreDetail ? JSON.stringify(offre.scoreDetail) : null,
    analysisJson: offre.analysisJson ? JSON.stringify(offre.analysisJson) : null,
    analysisAt: offre.analysisJson ? maintenant : null,
    isManual: offre.isManual ? 1 : 0,
    maintenant,
  });

  return { nouvelle: !existante };
}
```

- [ ] **Step 4: Lancer les tests**

Run: `node --test test/db-upsert.test.js`
Expected: `# pass 5`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/db.js test/db-upsert.test.js
git commit -m "feat: upsert d'offre garantissant la préservation du suivi personnel"
```

---

## Task 7: `src/sources/index.js` — orchestration et isolation des pannes

**Files:**
- Create: `src/sources/index.js`
- Test: `test/sources-index.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

`test/sources-index.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collecterDepuisSources, fusionner } from '../src/sources/index.js';

function sourceFactice(nom, offres, { configuree = true, echoue = false } = {}) {
  return {
    nom,
    estConfiguree: () => configuree,
    chercher: async () => {
      if (echoue) throw new Error(`panne simulée de ${nom}`);
      return offres;
    },
  };
}

const OFFRE_A = { externalId: 'a1', titre: 'Juriste EnR', entreprise: 'ACME', ville: 'Nancy (54)', description: 'Longue description.', dateOffre: '2026-07-27' };

test('une source en panne n\'empêche pas les autres', async () => {
  const r = await collecterDepuisSources(
    [sourceFactice('bonne', [OFFRE_A]), sourceFactice('cassee', [], { echoue: true })],
    { intitules: ['juriste'], villes: [{ nom: 'Nancy', codeInsee: '54395' }], rayonKm: 30, depuisDate: '2026-07-21' }
  );

  assert.equal(r.offres.length, 1);
  assert.deepEqual(r.sourcesEnEchec, ['cassee']);
  assert.deepEqual(r.sourcesOk, ['bonne']);
});

test('une source non configurée est silencieusement sautée', async () => {
  const r = await collecterDepuisSources(
    [sourceFactice('absente', [OFFRE_A], { configuree: false })],
    { intitules: ['juriste'], villes: [], rayonKm: 30, depuisDate: '2026-07-21' }
  );

  assert.equal(r.offres.length, 0);
  assert.deepEqual(r.sourcesEnEchec, [], 'non configurée n\'est PAS une panne');
  assert.deepEqual(r.sourcesIgnorees, ['absente']);
});

test('fusionner dédoublonne la même offre vue sur deux sources', () => {
  const brutes = [
    { ...OFFRE_A, source: 'france-travail', description: 'Description longue et complète de l\'offre.' },
    { ...OFFRE_A, titre: 'Juriste EnR (H/F)', source: 'adzuna', description: 'Courte.' },
  ];
  const fusionnees = fusionner(brutes);

  assert.equal(fusionnees.length, 1);
  assert.deepEqual(fusionnees[0].sourcesAll.sort(), ['adzuna', 'france-travail']);
});

test('fusionner conserve la description la plus longue', () => {
  const brutes = [
    { ...OFFRE_A, source: 'adzuna', description: 'Courte.' },
    { ...OFFRE_A, source: 'france-travail', description: 'Description nettement plus longue et détaillée.' },
  ];
  assert.equal(fusionner(brutes)[0].description, 'Description nettement plus longue et détaillée.');
});

test('fusionner ne confond pas deux offres distinctes', () => {
  const brutes = [
    { ...OFFRE_A, source: 'adzuna' },
    { ...OFFRE_A, ville: 'Lyon (69)', source: 'adzuna' },
  ];
  assert.equal(fusionner(brutes).length, 2);
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `node --test test/sources-index.test.js`
Expected: FAIL — `Cannot find module '../src/sources/index.js'`

- [ ] **Step 3: Écrire l'implémentation**

`src/sources/index.js` :

```js
// Orchestration des sources d'offres.
//
// Deux garanties :
//  - une source en panne est journalisée et ignorée, les autres continuent ;
//  - une source non configurée (clé absente du .env) est sautée sans bruit.
// L'application fonctionne donc avec une seule clé sur quatre.
import { offreId } from '../hash.js';

/**
 * Interroge toutes les sources configurées, pour chaque intitulé,
 * sur chaque ville prioritaire puis au niveau national.
 *
 * @returns {Promise<{offres: object[], sourcesOk: string[], sourcesEnEchec: string[], sourcesIgnorees: string[]}>}
 */
export async function collecterDepuisSources(sources, { intitules, villes, rayonKm, depuisDate }) {
  const brutes = [];
  const sourcesOk = new Set();
  const sourcesEnEchec = new Set();
  const sourcesIgnorees = [];

  for (const source of sources) {
    if (!source.estConfiguree()) {
      sourcesIgnorees.push(source.nom);
      console.log(`  ⏭  ${source.nom} : non configurée, ignorée`);
      continue;
    }

    for (const intitule of intitules) {
      // Passe prioritaire (une requête par ville) puis passe nationale (ville = null).
      for (const ville of [...villes, null]) {
        try {
          const resultats = await source.chercher({ intitule, ville, rayonKm, depuisDate });
          for (const offre of resultats) {
            brutes.push({ ...offre, source: source.nom });
          }
          sourcesOk.add(source.nom);
        } catch (erreur) {
          // Une requête en échec ne compromet ni les autres requêtes ni les autres sources.
          sourcesEnEchec.add(source.nom);
          console.warn(`  ⚠  ${source.nom} [${intitule} / ${ville?.nom ?? 'France'}] : ${erreur.message}`);
        }
      }
    }
  }

  // Une source ayant réussi au moins une requête n'est pas comptée en échec.
  for (const nom of sourcesOk) sourcesEnEchec.delete(nom);

  return {
    offres: fusionner(brutes),
    sourcesOk: [...sourcesOk],
    sourcesEnEchec: [...sourcesEnEchec],
    sourcesIgnorees,
  };
}

/**
 * Dédoublonne par identifiant stable (titre + entreprise + ville).
 * Fusionne la même offre republiée sur plusieurs plateformes :
 * la description la plus longue gagne, les sources s'accumulent.
 */
export function fusionner(brutes) {
  const parId = new Map();

  for (const brute of brutes) {
    const id = offreId(brute.titre, brute.entreprise, brute.ville);
    const existante = parId.get(id);

    if (!existante) {
      parId.set(id, { ...brute, id, sourcesAll: [brute.source] });
      continue;
    }

    if (!existante.sourcesAll.includes(brute.source)) {
      existante.sourcesAll.push(brute.source);
    }
    // La description la plus longue est la plus utile pour l'analyse.
    if ((brute.description || '').length > (existante.description || '').length) {
      existante.description = brute.description;
      existante.source = brute.source;
      existante.externalId = brute.externalId;
    }
    existante.salaireSource = existante.salaireSource || brute.salaireSource;
    existante.lien = existante.lien || brute.lien;
  }

  return [...parId.values()];
}
```

- [ ] **Step 4: Lancer les tests**

Run: `node --test test/sources-index.test.js`
Expected: `# pass 5`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/sources/index.js test/sources-index.test.js
git commit -m "feat: orchestration des sources avec isolation des pannes"
```

---

## Task 8: `src/sources/franceTravail.js`

**Files:**
- Create: `src/sources/franceTravail.js`
- Test: `test/source-france-travail.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

Le test porte sur la **normalisation** d'une réponse figée — aucun appel réseau.

`test/source-france-travail.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliserOffre } from '../src/sources/franceTravail.js';

const REPONSE_FT = {
  id: '196MXKT',
  intitule: 'Chef de projet énergies renouvelables (H/F)',
  description: 'Vous piloterez le développement de projets photovoltaïques...',
  dateCreation: '2026-07-25T09:12:00.000Z',
  lieuTravail: { libelle: '54 - NANCY', codePostal: '54000' },
  entreprise: { nom: 'ACME ENERGIES' },
  typeContrat: 'CDI',
  salaire: { libelle: 'Annuel de 38000 à 45000 Euros' },
  origineOffre: { urlOrigine: 'https://candidat.francetravail.fr/offres/196MXKT' },
};

test('normaliserOffre extrait les champs au format commun', () => {
  const o = normaliserOffre(REPONSE_FT);
  assert.equal(o.externalId, '196MXKT');
  assert.equal(o.titre, 'Chef de projet énergies renouvelables (H/F)');
  assert.equal(o.entreprise, 'ACME ENERGIES');
  assert.equal(o.contrat, 'CDI');
  assert.equal(o.dateOffre, '2026-07-25');
  assert.equal(o.codePostal, '54000');
  assert.equal(o.salaireSource, 'Annuel de 38000 à 45000 Euros');
  assert.ok(o.lien.includes('196MXKT'));
});

test('normaliserOffre nettoie le préfixe département du lieu', () => {
  assert.equal(normaliserOffre(REPONSE_FT).ville, 'NANCY');
});

test('normaliserOffre tolère les champs absents sans planter', () => {
  const o = normaliserOffre({ id: 'X1', intitule: 'Juriste' });
  assert.equal(o.entreprise, '');
  assert.equal(o.ville, '');
  assert.equal(o.description, '');
  assert.equal(o.salaireSource, null);
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `node --test test/source-france-travail.test.js`
Expected: FAIL — `Cannot find module '../src/sources/franceTravail.js'`

- [ ] **Step 3: Écrire l'implémentation**

`src/sources/franceTravail.js` :

```js
// Source « France Travail — Offres d'emploi v2 ».
// API officielle, gratuite : https://francetravail.io
// Seule source exposant la description COMPLÈTE de l'offre — c'est elle
// qui alimente le mieux l'analyse LLM.

const URL_TOKEN = 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire';
const URL_RECHERCHE = 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';

// Jeton conservé EN MÉMOIRE du processus uniquement — jamais écrit sur disque.
let jetonCache = { valeur: null, expireA: 0 };

async function obtenirJeton() {
  if (jetonCache.valeur && Date.now() < jetonCache.expireA) {
    return jetonCache.valeur;
  }

  const corps = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.FRANCE_TRAVAIL_CLIENT_ID,
    client_secret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET,
    scope: 'api_offresdemploiv2 o2dsoffre',
  });

  const reponse = await fetch(URL_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corps,
  });

  if (!reponse.ok) {
    throw new Error(`authentification France Travail refusée (HTTP ${reponse.status}) — vérifier FRANCE_TRAVAIL_CLIENT_ID et FRANCE_TRAVAIL_CLIENT_SECRET dans .env`);
  }

  const donnees = await reponse.json();
  // On retire 60 s de marge pour ne jamais utiliser un jeton qui vient d'expirer.
  jetonCache = {
    valeur: donnees.access_token,
    expireA: Date.now() + (donnees.expires_in - 60) * 1000,
  };
  return jetonCache.valeur;
}

/** Convertit une offre France Travail vers le format commun du projet. */
export function normaliserOffre(brute) {
  const libelleLieu = brute.lieuTravail?.libelle ?? '';
  // Le libellé arrive sous la forme « 54 - NANCY » : on retire le préfixe.
  const ville = libelleLieu.replace(/^\d{2,3}\s*-\s*/, '').trim();

  return {
    externalId: brute.id,
    titre: brute.intitule ?? '',
    entreprise: brute.entreprise?.nom ?? '',
    ville,
    codePostal: brute.lieuTravail?.codePostal ?? '',
    contrat: brute.typeContrat ?? '',
    dateOffre: brute.dateCreation ? brute.dateCreation.slice(0, 10) : null,
    lien: brute.origineOffre?.urlOrigine ?? `https://candidat.francetravail.fr/offres/recherche/detail/${brute.id}`,
    description: brute.description ?? '',
    salaireSource: brute.salaire?.libelle ?? null,
  };
}

export default {
  nom: 'france-travail',

  estConfiguree() {
    return Boolean(process.env.FRANCE_TRAVAIL_CLIENT_ID && process.env.FRANCE_TRAVAIL_CLIENT_SECRET);
  },

  async chercher({ intitule, ville, rayonKm, depuisDate }) {
    const jeton = await obtenirJeton();

    const params = new URLSearchParams({
      motsCles: intitule,
      minCreationDate: `${depuisDate}T00:00:00Z`,
      range: '0-49',
    });
    // ville === null → passe nationale (aucun filtre géographique).
    if (ville) {
      params.set('commune', ville.codeInsee);
      params.set('distance', String(rayonKm));
    }

    const reponse = await fetch(`${URL_RECHERCHE}?${params}`, {
      headers: { Authorization: `Bearer ${jeton}`, Accept: 'application/json' },
    });

    // 204 = aucune offre pour ces critères : ce n'est pas une erreur.
    if (reponse.status === 204) return [];
    if (!reponse.ok) {
      throw new Error(`recherche France Travail en échec (HTTP ${reponse.status})`);
    }

    const donnees = await reponse.json();
    return (donnees.resultats ?? []).map(normaliserOffre);
  },
};
```

- [ ] **Step 4: Lancer les tests**

Run: `node --test test/source-france-travail.test.js`
Expected: `# pass 3`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/sources/franceTravail.js test/source-france-travail.test.js
git commit -m "feat: source France Travail (OAuth2 + recherche v2)"
```

---

## Task 9: `src/sources/adzuna.js`

**Files:**
- Create: `src/sources/adzuna.js`
- Test: `test/source-adzuna.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

`test/source-adzuna.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliserOffre } from '../src/sources/adzuna.js';

const REPONSE_ADZUNA = {
  id: '4912345678',
  title: 'Chargé de développement EnR H/F',
  description: 'Vous développerez un portefeuille de projets solaires…',
  created: '2026-07-24T14:03:21Z',
  company: { display_name: 'SOLARIS DEV' },
  location: { display_name: 'Strasbourg, Bas-Rhin', area: ['France', 'Grand Est', 'Bas-Rhin', 'Strasbourg'] },
  contract_type: 'permanent',
  salary_min: 36000,
  salary_max: 44000,
  redirect_url: 'https://www.adzuna.fr/land/ad/4912345678',
};

test('normaliserOffre extrait les champs au format commun', () => {
  const o = normaliserOffre(REPONSE_ADZUNA);
  assert.equal(o.externalId, '4912345678');
  assert.equal(o.titre, 'Chargé de développement EnR H/F');
  assert.equal(o.entreprise, 'SOLARIS DEV');
  assert.equal(o.ville, 'Strasbourg');
  assert.equal(o.dateOffre, '2026-07-24');
  assert.equal(o.contrat, 'CDI');
  assert.equal(o.salaireSource, '36000 – 44000 € brut annuel');
});

test('normaliserOffre traduit les types de contrat Adzuna', () => {
  assert.equal(normaliserOffre({ ...REPONSE_ADZUNA, contract_type: 'contract' }).contrat, 'CDD');
  assert.equal(normaliserOffre({ ...REPONSE_ADZUNA, contract_type: undefined }).contrat, '');
});

test('normaliserOffre laisse salaireSource à null si absent', () => {
  const o = normaliserOffre({ ...REPONSE_ADZUNA, salary_min: undefined, salary_max: undefined });
  assert.equal(o.salaireSource, null);
});

test('normaliserOffre tolère une localisation absente', () => {
  const o = normaliserOffre({ id: 'x', title: 'Juriste' });
  assert.equal(o.ville, '');
  assert.equal(o.entreprise, '');
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `node --test test/source-adzuna.test.js`
Expected: FAIL — `Cannot find module '../src/sources/adzuna.js'`

- [ ] **Step 3: Écrire l'implémentation**

`src/sources/adzuna.js` :

```js
// Source « Adzuna » — https://developer.adzuna.com
// Agrégateur. Quota gratuit : 1000 appels/mois (consommation prévue ~375).
// Attention : les descriptions sont souvent TRONQUÉES par Adzuna. Le
// dédoublonnage (sources/index.js) privilégie donc la version France Travail
// quand la même offre est vue des deux côtés.

const URL_BASE = 'https://api.adzuna.com/v1/api/jobs/fr/search/1';

// Adzuna utilise un vocabulaire anglophone pour les types de contrat.
const CONTRATS = { permanent: 'CDI', contract: 'CDD', part_time: 'Temps partiel', internship: 'Stage' };

/** Convertit une offre Adzuna vers le format commun du projet. */
export function normaliserOffre(brute) {
  // location.area = ['France', 'Grand Est', 'Bas-Rhin', 'Strasbourg']
  // Le dernier élément est le plus précis.
  const zones = brute.location?.area ?? [];
  const ville = zones.length > 0
    ? zones[zones.length - 1]
    : (brute.location?.display_name ?? '').split(',')[0].trim();

  let salaireSource = null;
  if (brute.salary_min && brute.salary_max) {
    salaireSource = `${Math.round(brute.salary_min)} – ${Math.round(brute.salary_max)} € brut annuel`;
  } else if (brute.salary_min) {
    salaireSource = `à partir de ${Math.round(brute.salary_min)} € brut annuel`;
  }

  return {
    externalId: String(brute.id ?? ''),
    titre: brute.title ?? '',
    entreprise: brute.company?.display_name ?? '',
    ville,
    codePostal: '',
    contrat: CONTRATS[brute.contract_type] ?? '',
    dateOffre: brute.created ? brute.created.slice(0, 10) : null,
    lien: brute.redirect_url ?? '',
    description: brute.description ?? '',
    salaireSource,
  };
}

export default {
  nom: 'adzuna',

  estConfiguree() {
    return Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);
  },

  async chercher({ intitule, ville, rayonKm, depuisDate }) {
    // Adzuna raisonne en « ancienneté maximale en jours », pas en date de début.
    const joursMax = Math.max(1, Math.ceil((Date.now() - new Date(depuisDate).getTime()) / 86400000));

    const params = new URLSearchParams({
      app_id: process.env.ADZUNA_APP_ID,
      app_key: process.env.ADZUNA_APP_KEY,
      what: intitule,
      max_days_old: String(joursMax),
      results_per_page: '50',
      'content-type': 'application/json',
    });
    if (ville) {
      params.set('where', ville.nom);
      params.set('distance', String(rayonKm));
    }

    const reponse = await fetch(`${URL_BASE}?${params}`);

    if (reponse.status === 429) {
      throw new Error('quota Adzuna atteint (1000 appels/mois) — réessayer le mois prochain');
    }
    if (!reponse.ok) {
      throw new Error(`recherche Adzuna en échec (HTTP ${reponse.status})`);
    }

    const donnees = await reponse.json();
    return (donnees.results ?? []).map(normaliserOffre);
  },
};
```

- [ ] **Step 4: Lancer les tests**

Run: `node --test test/source-adzuna.test.js`
Expected: `# pass 4`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/sources/adzuna.js test/source-adzuna.test.js
git commit -m "feat: source Adzuna"
```

---

## Task 10: `src/sources/jooble.js`

**Files:**
- Create: `src/sources/jooble.js`
- Test: `test/source-jooble.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

`test/source-jooble.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliserOffre, filtrerParDate } from '../src/sources/jooble.js';

const REPONSE_JOOBLE = {
  id: 8812345,
  title: 'Juriste droit public et environnement (H/F)',
  location: 'Strasbourg, 67',
  snippet: 'Au sein de la direction juridique, vous assurez la veille…',
  salary: '35 000 € - 42 000 € par an',
  source: 'apec.fr',
  type: 'CDI',
  link: 'https://fr.jooble.org/jdp/8812345',
  company: 'GRAND EST ENERGIE',
  updated: '2026-07-26T08:00:00.0000000',
};

test('normaliserOffre extrait les champs au format commun', () => {
  const o = normaliserOffre(REPONSE_JOOBLE);
  assert.equal(o.externalId, '8812345');
  assert.equal(o.titre, 'Juriste droit public et environnement (H/F)');
  assert.equal(o.entreprise, 'GRAND EST ENERGIE');
  assert.equal(o.ville, 'Strasbourg');
  assert.equal(o.dateOffre, '2026-07-26');
  assert.equal(o.contrat, 'CDI');
  assert.equal(o.salaireSource, '35 000 € - 42 000 € par an');
});

test('filtrerParDate ne garde que les offres assez récentes', () => {
  const offres = [
    { titre: 'Récente', dateOffre: '2026-07-26' },
    { titre: 'Ancienne', dateOffre: '2026-06-01' },
    { titre: 'Sans date', dateOffre: null },
  ];
  const gardees = filtrerParDate(offres, '2026-07-21').map(o => o.titre);

  assert.deepEqual(gardees, ['Récente', 'Sans date'],
    'une offre sans date est conservée : le scoring la classera « à vérifier »');
});

test('normaliserOffre tolère les champs absents', () => {
  const o = normaliserOffre({ id: 1, title: 'Juriste' });
  assert.equal(o.entreprise, '');
  assert.equal(o.ville, '');
  assert.equal(o.dateOffre, null);
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `node --test test/source-jooble.test.js`
Expected: FAIL — `Cannot find module '../src/sources/jooble.js'`

- [ ] **Step 3: Écrire l'implémentation**

`src/sources/jooble.js` :

```js
// Source « Jooble » — https://fr.jooble.org/api/about
// Méta-agrégateur : c'est la source dont la couverture ressemble le plus
// à celle d'Indeed (elle ratisse APEC, sites carrière, job boards…).
// Particularité : l'API ne propose PAS de filtre de date → filtrage côté client.

/** Convertit une offre Jooble vers le format commun du projet. */
export function normaliserOffre(brute) {
  // location arrive sous la forme « Strasbourg, 67 »
  const ville = (brute.location ?? '').split(',')[0].trim();

  return {
    externalId: String(brute.id ?? ''),
    titre: brute.title ?? '',
    entreprise: brute.company ?? '',
    ville,
    codePostal: '',
    contrat: brute.type ?? '',
    dateOffre: brute.updated ? brute.updated.slice(0, 10) : null,
    lien: brute.link ?? '',
    description: brute.snippet ?? '',
    salaireSource: brute.salary || null,
  };
}

/**
 * Filtre les offres publiées avant `depuisDate`.
 * Une offre SANS date est conservée : mieux vaut la faire remonter et laisser
 * le scoring la classer « à vérifier » que la perdre silencieusement.
 */
export function filtrerParDate(offres, depuisDate) {
  return offres.filter(o => !o.dateOffre || o.dateOffre >= depuisDate);
}

export default {
  nom: 'jooble',

  estConfiguree() {
    return Boolean(process.env.JOOBLE_API_KEY);
  },

  async chercher({ intitule, ville, rayonKm, depuisDate }) {
    const corps = { keywords: intitule, page: '1' };
    if (ville) {
      corps.location = ville.nom;
      corps.radius = String(rayonKm);
    }

    const reponse = await fetch(`https://jooble.org/api/${process.env.JOOBLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
    });

    if (!reponse.ok) {
      throw new Error(`recherche Jooble en échec (HTTP ${reponse.status})`);
    }

    const donnees = await reponse.json();
    return filtrerParDate((donnees.jobs ?? []).map(normaliserOffre), depuisDate);
  },
};
```

- [ ] **Step 4: Lancer les tests**

Run: `node --test test/source-jooble.test.js`
Expected: `# pass 3`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/sources/jooble.js test/source-jooble.test.js
git commit -m "feat: source Jooble (méta-agrégateur)"
```

---

## Task 11: `src/sources/indeed.js` — emplacement réservé, inerte

**Files:**
- Create: `src/sources/indeed.js`
- Test: `test/source-indeed.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

`test/source-indeed.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import indeed from '../src/sources/indeed.js';

test('la source Indeed est inerte tant qu\'aucune clé n\'est configurée', () => {
  delete process.env.INDEED_API_KEY;
  assert.equal(indeed.estConfiguree(), false);
});

test('la source Indeed respecte l\'interface commune', () => {
  assert.equal(indeed.nom, 'indeed');
  assert.equal(typeof indeed.estConfiguree, 'function');
  assert.equal(typeof indeed.chercher, 'function');
});

test('chercher échoue explicitement si appelée sans implémentation', async () => {
  await assert.rejects(() => indeed.chercher({ intitule: 'juriste' }), /pas encore implémentée/);
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `node --test test/source-indeed.test.js`
Expected: FAIL — `Cannot find module '../src/sources/indeed.js'`

- [ ] **Step 3: Écrire l'implémentation**

`src/sources/indeed.js` :

```js
// Source « Indeed » — EMPLACEMENT RÉSERVÉ, INACTIF.
//
// POURQUOI CE FICHIER EXISTE SANS FONCTIONNER
// -------------------------------------------
// Indeed n'expose aujourd'hui aucune API publique en libre-service pour la
// recherche d'offres : l'ancienne « Publisher API » est fermée aux nouvelles
// inscriptions, et les conditions d'utilisation d'Indeed interdisent le
// scraping de ses pages.
//
// Ce fichier réserve la place. Le jour où un accès légitime s'ouvre, il suffit
// de compléter chercher() et de renseigner INDEED_API_KEY dans .env :
// AUCUN autre fichier du projet ne change. C'est exactement ce que la couche
// d'abstraction sources/index.js existe pour garantir.
//
// DEUX VOIES D'ACCÈS LÉGITIMES CONNUES
// ------------------------------------
//  1. Partenariat Indeed : accès commercial à leur API de recherche, sur
//     dossier. À implémenter comme franceTravail.js (jeton + requête + mapping).
//  2. Réouverture d'une API publique en libre-service.
//
// À NE PAS CONFONDRE
// ------------------
// Le connecteur Indeed utilisable en conversation avec Claude n'est PAS une
// voie d'accès ici : c'est un outil de session, pas une API. Un script lancé
// par une tâche planifiée ne peut pas l'invoquer, même quand il fonctionne.
// Pour récupérer une offre trouvée par ce biais, utiliser l'import par
// collage (voir spec §5.5, livré au plan 3).

export default {
  nom: 'indeed',

  // Retourne false tant que la clé est absente → la source est silencieusement
  // sautée par sources/index.js, sans erreur ni avertissement.
  estConfiguree() {
    return Boolean(process.env.INDEED_API_KEY);
  },

  async chercher() {
    throw new Error(
      "source Indeed pas encore implémentée : aucun accès API légitime disponible à ce jour (voir les commentaires de src/sources/indeed.js)"
    );
  },
};
```

- [ ] **Step 4: Lancer les tests**

Run: `node --test test/source-indeed.test.js`
Expected: `# pass 3`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/sources/indeed.js test/source-indeed.test.js
git commit -m "feat: emplacement réservé pour une future source Indeed"
```

---

## Task 12: `scripts/extract-cv.js` — CV vers texte

**Files:**
- Create: `scripts/extract-cv.js`

- [ ] **Step 1: Écrire le script**

`scripts/extract-cv.js` :

```js
// Extrait le texte du CV (.docx) vers profile/cv.txt.
// À lancer UNE FOIS au premier démarrage, puis à chaque mise à jour du CV.
// Le CV et son extraction sont gitignorés : ce sont des données personnelles.
//
// Usage : npm run extract-cv -- "C:/chemin/vers/CV_Benjamin_Perrin.docx"
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import mammoth from 'mammoth';

const cheminSource = process.argv[2];

if (!cheminSource) {
  console.error('Usage : npm run extract-cv -- "chemin/vers/CV.docx"');
  process.exit(1);
}
if (!existsSync(cheminSource)) {
  console.error(`Fichier introuvable : ${cheminSource}`);
  process.exit(1);
}

const dossierProfil = resolve('profile');
if (!existsSync(dossierProfil)) mkdirSync(dossierProfil, { recursive: true });

const { value: texte } = await mammoth.extractRawText({ buffer: readFileSync(cheminSource) });

// Compresse les lignes vides multiples pour un prompt plus lisible.
const propre = texte.replace(/\n{3,}/g, '\n\n').trim();

if (propre.length < 200) {
  console.error(`⚠ Texte extrait très court (${propre.length} caractères). Le fichier est-il bien un CV ?`);
  process.exit(1);
}

writeFileSync(resolve('profile/cv.txt'), propre, 'utf8');
// On garde une copie du .docx d'origine (gitignorée) pour pouvoir réextraire.
copyFileSync(cheminSource, resolve('profile/cv-source.docx'));

console.log(`✓ CV extrait : ${propre.length} caractères → profile/cv.txt`);
console.log(`✓ Copie du fichier source → profile/cv-source.docx`);
```

- [ ] **Step 2: Lancer le script sur le CV réel de Benjamin**

Run:
```bash
npm run extract-cv -- "C:/Users/BenjaminPerrin/Downloads/CV_Benjamin_Perrin.docx"
```
Expected: `✓ CV extrait : NNNN caractères → profile/cv.txt`

- [ ] **Step 3: Vérifier le contenu extrait**

Run: `node -e "console.log(require('fs').readFileSync('profile/cv.txt','utf8').slice(0,400))"`
Expected: le début du CV, lisible, accents corrects. On doit y retrouver
« Chef de Projet & Juriste » et « Master 2 ».

- [ ] **Step 4: Vérifier que le CV n'est PAS suivi par git**

Run: `git status --short profile/`
Expected: **aucune** mention de `cv.txt` ni `cv-source.docx` (ils sont gitignorés).
Si l'un apparaît, corriger `.gitignore` avant de continuer.

- [ ] **Step 5: Commit**

```bash
git add scripts/extract-cv.js
git commit -m "feat: extraction du CV .docx vers profile/cv.txt"
```

---

## Task 13: `src/gemini.js` — client LLM

**Files:**
- Create: `src/gemini.js`
- Test: `test/gemini.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

Le test porte sur l'extraction JSON et la limitation de débit — pas d'appel réseau.

`test/gemini.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraireJson, Limiteur } from '../src/gemini.js';

test('extraireJson lit un JSON nu', () => {
  assert.deepEqual(extraireJson('{"verdict":"Oui"}'), { verdict: 'Oui' });
});

test('extraireJson lit un JSON encadré par un bloc markdown', () => {
  const reponse = '```json\n{"verdict":"Oui, fonce."}\n```';
  assert.deepEqual(extraireJson(reponse), { verdict: 'Oui, fonce.' });
});

test('extraireJson ignore le bavardage avant et après', () => {
  const reponse = 'Voici mon analyse :\n{"verdict":"Non"}\nJ\'espère que cela aide.';
  assert.deepEqual(extraireJson(reponse), { verdict: 'Non' });
});

test('extraireJson renvoie null sur une réponse inexploitable', () => {
  assert.equal(extraireJson('Je ne peux pas répondre.'), null);
  assert.equal(extraireJson('{"casse": '), null);
  assert.equal(extraireJson(''), null);
});

test('Limiteur espace les appels selon le débit configuré', async () => {
  const limiteur = new Limiteur(60); // 60/min → 1 appel par seconde minimum
  const debut = Date.now();
  await limiteur.attendre();
  await limiteur.attendre();
  assert.ok(Date.now() - debut >= 950, 'le deuxième appel doit être retardé');
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `node --test test/gemini.test.js`
Expected: FAIL — `Cannot find module '../src/gemini.js'`

- [ ] **Step 3: Écrire l'implémentation**

`src/gemini.js` :

```js
// Client Gemini bas niveau : limitation de débit, reprise sur erreur,
// extraction du JSON. Aucune logique métier ici — voir analyze.js.
//
// Quota gratuit : ~15 requêtes/minute, ~1500/jour. On se limite à 10/min
// pour garder de la marge.
import { GoogleGenAI } from '@google/genai';

// Chaîne de repli : si un modèle est saturé ou retiré, on tente le suivant.
const MODELES = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];

/** Espace les appels pour ne pas dépasser le quota par minute. */
export class Limiteur {
  constructor(parMinute = 10) {
    this.intervalleMs = 60000 / parMinute;
    this.dernierAppel = 0;
  }

  async attendre() {
    const ecoule = Date.now() - this.dernierAppel;
    if (ecoule < this.intervalleMs) {
      await new Promise(r => setTimeout(r, this.intervalleMs - ecoule));
    }
    this.dernierAppel = Date.now();
  }
}

/**
 * Extrait un objet JSON d'une réponse de LLM.
 * Les modèles encadrent souvent le JSON dans un bloc markdown ou l'entourent
 * de commentaires : on isole la première accolade ouvrante et la dernière
 * fermante. Retourne null si rien d'exploitable — JAMAIS d'exception, pour que
 * l'appelant puisse simplement ignorer l'analyse.
 */
export function extraireJson(texte) {
  if (!texte) return null;

  const debut = texte.indexOf('{');
  const fin = texte.lastIndexOf('}');
  if (debut === -1 || fin === -1 || fin <= debut) return null;

  try {
    return JSON.parse(texte.slice(debut, fin + 1));
  } catch {
    return null;
  }
}

let client = null;
const limiteur = new Limiteur(10);

function obtenirClient() {
  if (!client) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY absente du .env');
    }
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

/** true si l'analyse LLM est disponible. */
export function estConfigure() {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Envoie un prompt et renvoie le texte brut de la réponse.
 * Essaie chaque modèle de la chaîne de repli, une reprise par modèle.
 * @returns {Promise<string|null>} null si tous les modèles ont échoué
 */
export async function demander(prompt) {
  const genai = obtenirClient();

  for (const modele of MODELES) {
    for (let tentative = 1; tentative <= 2; tentative++) {
      try {
        await limiteur.attendre();
        const reponse = await genai.models.generateContent({
          model: modele,
          contents: prompt,
        });
        return reponse.text;
      } catch (erreur) {
        const message = String(erreur?.message ?? erreur);
        console.warn(`  ⚠ Gemini [${modele}] tentative ${tentative} : ${message}`);

        // Quota journalier épuisé : inutile d'insister sur les autres modèles.
        if (/quota|RESOURCE_EXHAUSTED/i.test(message) && tentative === 2) {
          return null;
        }
        // Pause avant la reprise.
        if (tentative === 1) await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Lancer les tests**

Run: `node --test test/gemini.test.js`
Expected: `# pass 5`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/gemini.js test/gemini.test.js
git commit -m "feat: client Gemini (débit limité, reprise, extraction JSON)"
```

---

## Task 14: `src/analyze.js` — analyse d'offre

**Files:**
- Create: `src/analyze.js`
- Test: `test/analyze.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

`test/analyze.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirePrompt, validerAnalyse } from '../src/analyze.js';

const OFFRE = {
  titre: 'Chef de projet agrivoltaïque',
  entreprise: 'SOLARIS',
  ville: 'Nancy (54)',
  description: 'Développement de projets agrivoltaïques, de la prospection au dépôt des autorisations.',
  salaireSource: '38 000 – 45 000 €',
};

test('construirePrompt inclut le CV, l\'offre et le format attendu', () => {
  const p = construirePrompt(OFFRE, 'Benjamin Perrin — Chef de Projet & Juriste. Master 2 Droit et Gestion des Énergies.');
  assert.ok(p.includes('Master 2 Droit'), 'le CV doit être dans le prompt');
  assert.ok(p.includes('Chef de projet agrivoltaïque'), 'le titre doit être dans le prompt');
  assert.ok(p.includes('SOLARIS'), 'l\'entreprise doit être dans le prompt');
  assert.ok(p.includes('"prouvable"'), 'le format JSON attendu doit être décrit');
  assert.ok(p.includes('38 000 – 45 000 €'), 'le salaire annoncé doit être transmis');
});

test('validerAnalyse accepte une analyse complète', () => {
  const analyse = {
    exige: ['Bac+5'], souhaite: ['Anglais'], decoratif: ['Ambiance'],
    prouvable: ['M2 Droit'], nonprouvable: ['5 ans'], compensable: ['Partiel'],
    verdict: 'Oui, candidature légitime.',
    kw: [['agrivoltaïsme', 'oui', '90% du portefeuille']],
    fourchette: '38 000 – 45 000 €', fnote: 'Marché EnR junior.',
    formul: ['a', 'b', 'c'], budget: ['a', 'b', 'c'],
  };
  assert.deepEqual(validerAnalyse(analyse), analyse);
});

test('validerAnalyse rejette une analyse sans verdict', () => {
  assert.equal(validerAnalyse({ exige: ['Bac+5'] }), null);
});

test('validerAnalyse rejette null et les types incorrects', () => {
  assert.equal(validerAnalyse(null), null);
  assert.equal(validerAnalyse({ verdict: 'Oui', exige: 'pas un tableau' }), null);
  assert.equal(validerAnalyse('une chaîne'), null);
});

test('validerAnalyse complète les champs facultatifs absents', () => {
  const r = validerAnalyse({ verdict: 'Oui.', exige: ['Bac+5'], prouvable: ['M2'] });
  assert.deepEqual(r.souhaite, []);
  assert.deepEqual(r.kw, []);
  assert.equal(r.fourchette, null);
});

test('validerAnalyse filtre les lignes de mots-clés mal formées', () => {
  const r = validerAnalyse({
    verdict: 'Oui.', exige: [], prouvable: [],
    kw: [['bon', 'oui', 'raison'], ['incomplet'], 'pas un tableau', ['x', 'peut-être', 'y']],
  });
  assert.deepEqual(r.kw, [['bon', 'oui', 'raison']]);
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `node --test test/analyze.test.js`
Expected: FAIL — `Cannot find module '../src/analyze.js'`

- [ ] **Step 3: Écrire l'implémentation**

`src/analyze.js` :

```js
// Analyse qualitative d'une offre au regard du CV de Benjamin.
// Produit exactement les champs que le dashboard sait déjà afficher.
import { demander, extraireJson, estConfigure } from './gemini.js';

const VALEURS_KW = new Set(['oui', 'non', 'partiel']);

/** Construit le prompt d'analyse. */
export function construirePrompt(offre, cv) {
  return `Tu es un conseiller en recrutement français, direct et sans complaisance.
Tu analyses une offre d'emploi au regard d'un CV précis.

# CV DU CANDIDAT
${cv}

# OFFRE À ANALYSER
Titre : ${offre.titre}
Entreprise : ${offre.entreprise || 'non précisée'}
Ville : ${offre.ville || 'non précisée'}
Salaire annoncé par l'employeur : ${offre.salaireSource || 'non annoncé'}

Description :
${offre.description}

# TA MISSION
Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après,
respectant exactement cette structure :

{
  "exige":        ["ce qui est RÉDHIBITOIRE si absent — cite l'offre"],
  "souhaite":     ["ce qui est souhaité mais négociable"],
  "decoratif":    ["le marketing employeur sans portée réelle"],
  "prouvable":    ["ce que le candidat peut prouver AVEC SON CV — cite l'élément du CV"],
  "nonprouvable": ["ce qu'il ne peut pas prouver — sois honnête"],
  "compensable":  ["ce qui est contournable, et comment"],
  "verdict":      "2 phrases maximum, tranchées. Exemples de ton : « Oui, c'est pour toi. Meilleure offre du lot. » ou « Non. L'exigence 5 ans M&A est éliminatoire. »",
  "kw":           [["mot-clé de l'offre absent du CV", "oui|non|partiel", "pourquoi c'est revendicable ou non"]],
  "fourchette":   "fourchette salariale réaliste, ex. « 36 000 – 44 000 € brut annuel »",
  "fnote":        "une phrase justifiant la fourchette (marché, séniorité, rareté du profil)",
  "formul":       ["3 formulations à l'oral pour annoncer ses prétentions, entre guillemets"],
  "budget":       ["3 réponses si l'employeur dit « c'est au-dessus de notre budget »"]
}

# RÈGLES IMPÉRATIVES
- Ne déclare "prouvable" QUE ce qui figure réellement dans le CV ci-dessus. Cite-le.
- N'invente jamais une expérience, un diplôme, un chiffre ou un employeur.
- Le verdict est direct : pas de langue de bois, pas de « ce poste pourrait être intéressant ».
- Pour "fourchette" : si l'employeur annonce un salaire, appuie-toi dessus.
  Sinon, estime d'après le marché français du secteur et dis-le dans "fnote".
- Tutoie le candidat dans "verdict", "formul" et "budget" (il lit ses propres notes).
- Réponds en français.`;
}

/**
 * Valide la forme de l'analyse renvoyée par le LLM.
 * Retourne null si inexploitable — l'offre sera affichée sans analyse
 * plutôt que de faire échouer la collecte.
 */
export function validerAnalyse(brute) {
  if (!brute || typeof brute !== 'object' || Array.isArray(brute)) return null;
  if (typeof brute.verdict !== 'string' || brute.verdict.trim() === '') return null;

  const listeDeTextes = (valeur) => {
    if (valeur === undefined || valeur === null) return [];
    if (!Array.isArray(valeur)) return undefined; // signale un type incorrect
    return valeur.filter(x => typeof x === 'string');
  };

  const champs = ['exige', 'souhaite', 'decoratif', 'prouvable', 'nonprouvable', 'compensable', 'formul', 'budget'];
  const resultat = { verdict: brute.verdict.trim() };

  for (const champ of champs) {
    const valeur = listeDeTextes(brute[champ]);
    if (valeur === undefined) return null; // un champ présent mais mal typé invalide tout
    resultat[champ] = valeur;
  }

  // kw : uniquement les triplets bien formés, les autres lignes sont écartées.
  resultat.kw = Array.isArray(brute.kw)
    ? brute.kw.filter(l => Array.isArray(l) && l.length === 3
        && typeof l[0] === 'string' && typeof l[2] === 'string'
        && VALEURS_KW.has(String(l[1]).toLowerCase()))
    : [];

  resultat.fourchette = typeof brute.fourchette === 'string' ? brute.fourchette : null;
  resultat.fnote = typeof brute.fnote === 'string' ? brute.fnote : null;

  return resultat;
}

/**
 * Analyse une offre. Ne lève JAMAIS d'exception : en cas de problème
 * (quota, panne, réponse illisible) elle renvoie null et la collecte continue.
 * @returns {Promise<object|null>}
 */
export async function analyserOffre(offre, cv) {
  if (!estConfigure()) return null;
  if (!cv || cv.length < 100) {
    console.warn('  ⚠ CV absent ou trop court — analyse ignorée. Lancer : npm run extract-cv');
    return null;
  }

  try {
    const reponse = await demander(construirePrompt(offre, cv));
    const analyse = validerAnalyse(extraireJson(reponse));
    if (!analyse) {
      console.warn(`  ⚠ Analyse illisible pour « ${offre.titre} » — offre conservée sans analyse`);
    }
    return analyse;
  } catch (erreur) {
    console.warn(`  ⚠ Analyse impossible pour « ${offre.titre} » : ${erreur.message}`);
    return null;
  }
}
```

- [ ] **Step 4: Lancer les tests**

Run: `node --test test/analyze.test.js`
Expected: `# pass 6`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/analyze.js test/analyze.test.js
git commit -m "feat: analyse d'offre par Gemini avec validation stricte"
```

---

## Task 15: `scripts/collect.js` — le pipeline complet

**Files:**
- Create: `scripts/collect.js`
- Test: `test/collect.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

`test/collect.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase } from '../src/db.js';
import { collecter } from '../scripts/collect.js';

const PROFIL = {
  villesPrioritaires: [{ nom: 'Nancy', codeInsee: '54395', departement: '54' }],
  rayonKm: 30,
  intitules: ['juriste enr'],
  fraicheurJours: 7,
  scoring: {
    positifs: [{ motif: 'agrivolta', poids: 4 }, { motif: 'juriste', poids: 3 }],
    negatifs: [],
    eliminatoires: [{ motif: 'm&a' }],
    seuils: { prioritaire: 6, possible: 3, aVerifier: 1, descriptionMiniCaracteres: 50 },
  },
};

function sourceFactice(offres) {
  return {
    nom: 'factice',
    estConfiguree: () => true,
    chercher: async () => offres,
  };
}

const aujourdhui = new Date().toISOString().slice(0, 10);

const OFFRE_NANCY = {
  externalId: 'f1', titre: 'Juriste agrivoltaïque', entreprise: 'ACME', ville: 'Nancy (54)',
  description: 'Poste de juriste sur des projets agrivoltaïques, avec suivi des autorisations.'.padEnd(120, ' .'),
  dateOffre: aujourdhui, lien: 'https://exemple.fr/1', contrat: 'CDI',
};

test('collecter insère les offres scorées', async () => {
  const db = ouvrirBase(':memory:');
  const r = await collecter({ db, profil: PROFIL, sources: [sourceFactice([OFFRE_NANCY])], cv: '', analyser: false });

  assert.equal(r.statut, 'ok');
  assert.equal(r.nouvelles, 1);

  const ligne = db.prepare('SELECT * FROM offers').get();
  assert.equal(ligne.titre, 'Juriste agrivoltaïque');
  assert.equal(ligne.groupe, 1);
  assert.equal(ligne.hors_zone, 0);
  db.close();
});

test('collecter écarte les offres trop anciennes', async () => {
  const db = ouvrirBase(':memory:');
  const vieille = { ...OFFRE_NANCY, externalId: 'f2', dateOffre: '2026-01-01' };
  const r = await collecter({ db, profil: PROFIL, sources: [sourceFactice([vieille])], cv: '', analyser: false });

  assert.equal(r.nouvelles, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM offers').get().n, 0);
  db.close();
});

test('collecter garde une offre hors zone si elle est prioritaire', async () => {
  const db = ouvrirBase(':memory:');
  const horsZone = { ...OFFRE_NANCY, externalId: 'f3', ville: 'Bordeaux (33)' };
  await collecter({ db, profil: PROFIL, sources: [sourceFactice([horsZone])], cv: '', analyser: false });

  const ligne = db.prepare('SELECT * FROM offers').get();
  assert.ok(ligne, 'une offre prioritaire hors zone doit être conservée');
  assert.equal(ligne.hors_zone, 1);
  db.close();
});

test('collecter écarte une offre hors zone classée « à écarter »', async () => {
  const db = ouvrirBase(':memory:');
  const mauvaise = {
    ...OFFRE_NANCY, externalId: 'f4', ville: 'Courchevel (73)', titre: 'Ingénieur',
    description: 'Poste sans aucun rapport avec le profil recherché.'.padEnd(120, ' .'),
  };
  await collecter({ db, profil: PROFIL, sources: [sourceFactice([mauvaise])], cv: '', analyser: false });

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM offers').get().n, 0);
  db.close();
});

test('collecter signale un statut « partiel » si une source échoue', async () => {
  const db = ouvrirBase(':memory:');
  const cassee = { nom: 'cassee', estConfiguree: () => true, chercher: async () => { throw new Error('panne'); } };
  const r = await collecter({ db, profil: PROFIL, sources: [sourceFactice([OFFRE_NANCY]), cassee], cv: '', analyser: false });

  assert.equal(r.statut, 'partiel');
  assert.deepEqual(r.sourcesEnEchec, ['cassee']);
  assert.equal(r.nouvelles, 1, 'les offres de la source saine doivent être conservées');
  db.close();
});

test('collecter signale « echec » si toutes les sources tombent, sans perdre les données', async () => {
  const db = ouvrirBase(':memory:');
  await collecter({ db, profil: PROFIL, sources: [sourceFactice([OFFRE_NANCY])], cv: '', analyser: false });

  const cassee = { nom: 'cassee', estConfiguree: () => true, chercher: async () => { throw new Error('panne'); } };
  const r = await collecter({ db, profil: PROFIL, sources: [cassee], cv: '', analyser: false });

  assert.equal(r.statut, 'echec');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM offers').get().n, 1,
    'les offres déjà en base doivent survivre à une panne totale');
  db.close();
});

// ---- LE TEST CRITIQUE ----
test('une collecte ne modifie JAMAIS la table tracking', async () => {
  const db = ouvrirBase(':memory:');
  await collecter({ db, profil: PROFIL, sources: [sourceFactice([OFFRE_NANCY])], cv: '', analyser: false });

  const id = db.prepare('SELECT id FROM offers').get().id;
  db.prepare(`INSERT INTO tracking (offer_id, status, notes, pinned, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, 'Entretien', 'Prépa entretien le 5 août', 1, '2026-07-28');

  // Deuxième collecte, l'offre a changé de contenu.
  await collecter({
    db, profil: PROFIL, cv: '', analyser: false,
    sources: [sourceFactice([{ ...OFFRE_NANCY, description: 'Description entièrement réécrite par l\'employeur.'.padEnd(120, ' .') }])],
  });

  const t = db.prepare('SELECT * FROM tracking WHERE offer_id = ?').get(id);
  assert.equal(t.status, 'Entretien');
  assert.equal(t.notes, 'Prépa entretien le 5 août');
  assert.equal(t.pinned, 1);
  db.close();
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `node --test test/collect.test.js`
Expected: FAIL — `Cannot find module '../scripts/collect.js'`

- [ ] **Step 3: Écrire l'implémentation**

`scripts/collect.js` :

```js
// Collecteur d'offres — script autonome.
//
// Appelé de façon IDENTIQUE par la tâche planifiée et par le bouton
// « Rafraîchir maintenant » du dashboard (plan 2) : un seul chemin de code,
// donc aucune divergence de comportement entre les deux déclencheurs.
//
// Usage : npm run collect
import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ouvrirBase, upsertOffre, ecrireMeta, transaction } from '../src/db.js';
import { collecterDepuisSources } from '../src/sources/index.js';
import { scorer } from '../src/scoring.js';
import { analyserOffre } from '../src/analyze.js';
import { normaliser } from '../src/hash.js';

import franceTravail from '../src/sources/franceTravail.js';
import adzuna from '../src/sources/adzuna.js';
import jooble from '../src/sources/jooble.js';
import indeed from '../src/sources/indeed.js';

export const SOURCES = [franceTravail, adzuna, jooble, indeed];

/** Date ISO d'il y a N jours — borne de fraîcheur. */
function ilYaNJours(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

/** true si la ville de l'offre correspond à l'une des villes prioritaires. */
function estDansZonePrioritaire(villeOffre, villesPrioritaires) {
  const ville = normaliser(villeOffre);
  if (!ville) return false;
  return villesPrioritaires.some(v => ville.includes(normaliser(v.nom)));
}

/** Déduit le département à partir d'un code postal ou d'une ville « X (67) ». */
function deduireDepartement(offre) {
  const source = offre.codePostal || offre.ville || '';
  const trouve = String(source).match(/\b(\d{2})\d{0,3}\b/);
  return trouve ? trouve[1] : null;
}

/**
 * Exécute une collecte complète.
 * @param {object} options
 * @param {import('better-sqlite3').Database} options.db
 * @param {object} options.profil    contenu de profile/profile.json
 * @param {object[]} options.sources adaptateurs de sources
 * @param {string} options.cv        texte du CV
 * @param {boolean} options.analyser lancer l'analyse LLM (false dans les tests)
 * @returns {Promise<object>} résumé de la collecte
 */
export async function collecter({ db, profil, sources, cv, analyser = true }) {
  const debut = Date.now();
  const depuisDate = ilYaNJours(profil.fraicheurJours);

  console.log(`\n🔎 Collecte — offres publiées depuis le ${depuisDate}`);

  // 1-3. Requêtes, isolation des pannes, dédoublonnage.
  const { offres, sourcesOk, sourcesEnEchec, sourcesIgnorees } =
    await collecterDepuisSources(sources, {
      intitules: profil.intitules,
      villes: profil.villesPrioritaires,
      rayonKm: profil.rayonKm,
      depuisDate,
    });

  console.log(`  ${offres.length} offre(s) distincte(s) après dédoublonnage`);

  const retenues = [];

  for (const offre of offres) {
    // 4. Filtre de fraîcheur (certaines sources ne savent pas filtrer côté API).
    if (offre.dateOffre && offre.dateOffre < depuisDate) continue;

    // 5. Scoring déterministe.
    const { groupe, score, detail } = scorer(offre, profil);
    const horsZone = !estDansZonePrioritaire(offre.ville, profil.villesPrioritaires);

    // 6. Filtre hors zone : hors des villes prioritaires, on ne garde que
    //    les groupes 1 (Prioritaire) et 2 (Possible).
    if (horsZone && groupe !== 1 && groupe !== 2) continue;

    retenues.push({
      ...offre,
      groupe,
      score,
      scoreDetail: detail,
      horsZone: horsZone ? 1 : 0,
      departement: deduireDepartement(offre),
    });
  }

  console.log(`  ${retenues.length} offre(s) retenue(s) après filtres`);

  // 7. Analyse LLM — uniquement les groupes 1, 2 et 0, et jamais deux fois
  //    la même offre (économie de quota, stabilité du verdict).
  let analysees = 0;
  if (analyser) {
    const dejaAnalysees = new Set(
      db.prepare('SELECT id FROM offers WHERE analysis_json IS NOT NULL').all().map(r => r.id)
    );

    for (const offre of retenues) {
      if (offre.groupe === 3) continue;
      if (dejaAnalysees.has(offre.id)) continue;

      const analyse = await analyserOffre(offre, cv);
      if (analyse) {
        offre.analysisJson = analyse;
        analysees++;
        console.log(`  ✓ analysée : ${offre.titre}`);
      }
    }
  }

  // 8. Écriture en base — en transaction, et UNIQUEMENT dans `offers`.
  let nouvelles = 0;
  transaction(db, () => {
    for (const offre of retenues) {
      if (upsertOffre(db, offre).nouvelle) nouvelles++;
    }
  });

  // 9. Journal.
  let statut;
  if (sourcesOk.length === 0 && sourcesEnEchec.length > 0) statut = 'echec';
  else if (sourcesEnEchec.length > 0) statut = 'partiel';
  else statut = 'ok';

  const resume = {
    statut,
    vues: offres.length,
    retenues: retenues.length,
    nouvelles,
    analysees,
    sourcesOk,
    sourcesEnEchec,
    sourcesIgnorees,
    dureeSecondes: Math.round((Date.now() - debut) / 1000),
  };

  ecrireMeta(db, 'last_collect_at', new Date().toISOString());
  ecrireMeta(db, 'last_collect_status', statut);
  ecrireMeta(db, 'last_collect_summary', JSON.stringify(resume));

  return resume;
}

/** Point d'entrée en ligne de commande. */
async function principal() {
  const profil = JSON.parse(readFileSync('profile/profile.json', 'utf8'));
  const cv = existsSync('profile/cv.txt') ? readFileSync('profile/cv.txt', 'utf8') : '';

  if (!cv) {
    console.warn('⚠ profile/cv.txt absent — les offres seront collectées et scorées, mais PAS analysées.');
    console.warn('  Pour l\'ajouter : npm run extract-cv -- "chemin/vers/CV.docx"');
  }

  const db = ouvrirBase('data.db');
  try {
    const resume = await collecter({ db, profil, sources: SOURCES, cv, analyser: true });

    console.log('\n📊 Résumé');
    console.log(`  Statut          : ${resume.statut}`);
    console.log(`  Offres vues     : ${resume.vues}`);
    console.log(`  Retenues        : ${resume.retenues}`);
    console.log(`  Nouvelles       : ${resume.nouvelles}`);
    console.log(`  Analysées       : ${resume.analysees}`);
    console.log(`  Sources OK      : ${resume.sourcesOk.join(', ') || 'aucune'}`);
    if (resume.sourcesEnEchec.length) console.log(`  Sources en échec : ${resume.sourcesEnEchec.join(', ')}`);
    if (resume.sourcesIgnorees.length) console.log(`  Non configurées  : ${resume.sourcesIgnorees.join(', ')}`);
    console.log(`  Durée           : ${resume.dureeSecondes} s\n`);

    if (resume.statut === 'echec') process.exitCode = 1;
  } finally {
    db.close();
  }
}

// Ne s'exécute que si le fichier est lancé directement (pas à l'import par les tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  principal().catch(erreur => {
    console.error('❌ Collecte interrompue :', erreur.message);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Lancer les tests**

Run: `node --test test/collect.test.js`
Expected: `# pass 7`, `# fail 0`

- [ ] **Step 5: Lancer la suite complète**

Run: `npm test`
Expected: tous les fichiers de test passent, `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add scripts/collect.js test/collect.test.js
git commit -m "feat: pipeline de collecte complet (requêtes, filtres, scoring, analyse)"
```

---

## Task 16: Purge des offres périmées (spec §6.2)

Une offre non revue lors d'une collecte est **conservée** : la supprimer ferait
perdre le suivi associé. Mais une offre disparue depuis longtemps **et sur
laquelle Benjamin n'a rien fait** n'a plus de raison d'encombrer le dashboard.

**Files:**
- Modify: `src/db.js` (ajout de `purgerOffresPerimees`)
- Modify: `scripts/collect.js` (appel après l'écriture)
- Test: `test/db-purge.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

`test/db-purge.test.js` :

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase, purgerOffresPerimees } from '../src/db.js';

function insererOffre(db, id, joursDepuisDerniereVue) {
  const vueLe = new Date(Date.now() - joursDepuisDerniereVue * 86400000).toISOString();
  db.prepare(`INSERT INTO offers (id, titre, entreprise, ville, first_seen, last_seen, is_manual)
              VALUES (?, ?, 'ACME', 'Nancy', ?, ?, 0)`)
    .run(id, `Offre ${id}`, vueLe, vueLe);
}

test('purge une offre disparue depuis plus de 30 jours et sans suivi', () => {
  const db = ouvrirBase(':memory:');
  insererOffre(db, 'vieille', 45);
  assert.equal(purgerOffresPerimees(db), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM offers').get().n, 0);
  db.close();
});

test('ne purge PAS une offre encore récente', () => {
  const db = ouvrirBase(':memory:');
  insererOffre(db, 'recente', 5);
  assert.equal(purgerOffresPerimees(db), 0);
  db.close();
});

test('ne purge JAMAIS une offre sur laquelle Benjamin a agi', () => {
  const db = ouvrirBase(':memory:');

  insererOffre(db, 'candidatee', 90);
  db.prepare(`INSERT INTO tracking (offer_id, status) VALUES (?, 'Entretien')`).run('candidatee');

  insererOffre(db, 'annotee', 90);
  db.prepare(`INSERT INTO tracking (offer_id, status, notes) VALUES (?, 'À postuler', 'Rappeler M. Martin')`).run('annotee');

  insererOffre(db, 'epinglee', 90);
  db.prepare(`INSERT INTO tracking (offer_id, status, pinned) VALUES (?, 'À postuler', 1)`).run('epinglee');

  assert.equal(purgerOffresPerimees(db), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM offers').get().n, 3);
  db.close();
});

test('purge une offre ancienne dont le suivi est resté vierge', () => {
  const db = ouvrirBase(':memory:');
  insererOffre(db, 'ignoree', 90);
  db.prepare(`INSERT INTO tracking (offer_id, status, pinned) VALUES (?, 'À postuler', 0)`).run('ignoree');

  assert.equal(purgerOffresPerimees(db), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tracking').get().n, 0,
    'le suivi vierge orphelin doit être nettoyé aussi');
  db.close();
});

test('ne purge JAMAIS une offre ajoutée manuellement', () => {
  const db = ouvrirBase(':memory:');
  const vieux = new Date(Date.now() - 200 * 86400000).toISOString();
  db.prepare(`INSERT INTO offers (id, titre, entreprise, ville, first_seen, last_seen, is_manual)
              VALUES ('manuelle', 'Ajoutée à la main', 'ACME', 'Nancy', ?, ?, 1)`).run(vieux, vieux);

  assert.equal(purgerOffresPerimees(db), 0);
  db.close();
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `node --test test/db-purge.test.js`
Expected: FAIL — `purgerOffresPerimees is not a function`

- [ ] **Step 3: Ajouter `purgerOffresPerimees` à la fin de `src/db.js`**

```js
/**
 * Supprime les offres disparues des sources depuis plus de `jours` jours
 * ET sur lesquelles Benjamin n'a rien fait.
 *
 * Une offre est PROTÉGÉE dès qu'elle porte la moindre trace d'activité :
 * un statut autre que « À postuler », une date d'envoi, une relance, une note,
 * une épingle — ou si elle a été ajoutée à la main.
 * En cas de doute, on garde : perdre une offre suivie est irrécupérable,
 * garder une offre morte ne coûte qu'une ligne.
 *
 * @returns {number} nombre d'offres supprimées
 */
export function purgerOffresPerimees(db, jours = 30) {
  const limite = new Date(Date.now() - jours * 86400000).toISOString();

  return transaction(db, () => {
    const perimees = db.prepare(`
      SELECT o.id FROM offers o
      LEFT JOIN tracking t ON t.offer_id = o.id
      LEFT JOIN letters  l ON l.offer_id = o.id
      WHERE o.is_manual = 0
        AND o.last_seen < @limite
        AND l.offer_id IS NULL
        AND (
          t.offer_id IS NULL
          OR (
            COALESCE(t.status, 'À postuler') = 'À postuler'
            AND COALESCE(t.sent_date, '')    = ''
            AND COALESCE(t.relance_date, '') = ''
            AND COALESCE(t.notes, '')        = ''
            AND COALESCE(t.pinned, 0)        = 0
          )
        )
    `).all({ limite }).map(r => r.id);

    const supprimerOffre   = db.prepare('DELETE FROM offers   WHERE id = ?');
    const supprimerTracking = db.prepare('DELETE FROM tracking WHERE offer_id = ?');
    for (const id of perimees) {
      supprimerTracking.run(id);
      supprimerOffre.run(id);
    }
    return perimees.length;
  });
}
```

**Import à compléter** en tête de `src/db.js` si ce n'est pas déjà fait :
`transaction` est défini dans ce même fichier (Task 5), donc rien à importer ici.

- [ ] **Step 4: Lancer le test**

Run: `node --test test/db-purge.test.js`
Expected: `# pass 5`, `# fail 0`

- [ ] **Step 5: Brancher la purge dans le collecteur**

Dans `scripts/collect.js`, ajouter `purgerOffresPerimees` à l'import de `db.js` :

```js
import { ouvrirBase, upsertOffre, ecrireMeta, purgerOffresPerimees } from '../src/db.js';
```

Puis, dans `collecter()`, juste après `ecrireTout(retenues);` :

```js
  // Nettoyage : offres disparues depuis 30 jours sur lesquelles rien n'a été fait.
  const purgees = purgerOffresPerimees(db, 30);
  if (purgees > 0) console.log(`  🧹 ${purgees} offre(s) périmée(s) purgée(s)`);
```

Et ajouter `purgees` au résumé, dans l'objet `resume` :

```js
  const resume = {
    statut,
    vues: offres.length,
    retenues: retenues.length,
    nouvelles,
    analysees,
    purgees,
    sourcesOk,
    sourcesEnEchec,
    sourcesIgnorees,
    dureeSecondes: Math.round((Date.now() - debut) / 1000),
  };
```

- [ ] **Step 6: Lancer la suite complète pour vérifier l'absence de régression**

Run: `npm test`
Expected: tous les tests passent, `# fail 0`. En particulier, le test
« une collecte ne modifie JAMAIS la table tracking » (Task 15) doit toujours
passer — la purge ne doit pas l'avoir cassé.

- [ ] **Step 7: Commit**

```bash
git add src/db.js scripts/collect.js test/db-purge.test.js
git commit -m "feat: purge des offres périmées sans suivi (spec §6.2)"
```

---

## Task 17: Première collecte réelle

Cette tâche demande que Benjamin ait créé ses comptes et rempli `.env`.

**Files:**
- Create: `.env` (jamais commité)

- [ ] **Step 1: Créer `.env` à partir du modèle**

```bash
cp .env.example .env
```

Benjamin renseigne ensuite les identifiants obtenus sur :
- francetravail.io → `FRANCE_TRAVAIL_CLIENT_ID`, `FRANCE_TRAVAIL_CLIENT_SECRET`
- developer.adzuna.com → `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`
- fr.jooble.org/api/about → `JOOBLE_API_KEY`
- aistudio.google.com/apikey → `GEMINI_API_KEY`

Laisser `INDEED_API_KEY` vide.

**Le collecteur fonctionne même si une seule clé est renseignée** : les sources
non configurées sont sautées.

- [ ] **Step 2: Vérifier que `.env` n'est pas suivi par git**

Run: `git status --short`
Expected: **aucune** mention de `.env`. Si `.env` apparaît, arrêter et corriger
`.gitignore` avant toute autre chose.

- [ ] **Step 3: Lancer la première collecte réelle**

Run: `npm run collect`
Expected: la sortie affiche le résumé, avec `Statut : ok` (ou `partiel` si une
source est indisponible) et un nombre d'offres retenues supérieur à 0.

- [ ] **Step 4: Inspecter le résultat**

Run:
```bash
node -e "const{ouvrirBase}=await import('./src/db.js');const db=ouvrirBase('data.db');console.table(db.prepare('SELECT groupe, hors_zone, ville, entreprise, substr(titre,1,45) AS titre FROM offers ORDER BY groupe, score DESC LIMIT 20').all());" --input-type=module
```
Expected: un tableau d'offres réelles, classées par groupe. Les groupes 1
doivent être manifestement pertinents (EnR, juridique, gestion de projet).

- [ ] **Step 5: Vérifier qu'une analyse a bien été produite**

Run:
```bash
node -e "const{ouvrirBase}=await import('./src/db.js');const db=ouvrirBase('data.db');const r=db.prepare('SELECT titre, analysis_json FROM offers WHERE analysis_json IS NOT NULL LIMIT 1').get();console.log(r?r.titre:'AUCUNE ANALYSE');if(r)console.log(JSON.parse(r.analysis_json).verdict);" --input-type=module
```
Expected: un titre d'offre et un verdict rédigé en français.

Si `AUCUNE ANALYSE` : vérifier que `GEMINI_API_KEY` est renseignée et que
`profile/cv.txt` existe.

- [ ] **Step 6: Contrôler la qualité du scoring sur des offres réelles**

Passer en revue les 20 offres affichées à l'étape 4 avec Benjamin. Si des
offres manifestement hors sujet remontent en groupe 1, ou si de bonnes offres
tombent en groupe 3, **ajuster les poids dans `profile/profile.json`** puis
relancer `npm test` pour vérifier que les 11 offres de référence passent
toujours. Ne jamais modifier `src/scoring.js` pour cela.

- [ ] **Step 7: Commit d'un éventuel réglage des poids**

```bash
git add profile/profile.json
git commit -m "chore: ajuste les poids de scoring d'après la première collecte réelle"
```

---

## Fin du plan 1

À ce stade :

- `npm run collect` remplit `data.db` avec des offres réelles, dédoublonnées
  entre 3 sources, filtrées sur 7 jours, scorées en 4 groupes et analysées.
- Les offres hors des 4 villes prioritaires ne remontent que si elles sont
  Prioritaires ou Possibles.
- Une panne d'API n'interrompt ni la collecte ni les données déjà en base.
- Les offres disparues depuis 30 jours et jamais touchées sont purgées ;
  celles portant la moindre trace d'activité sont protégées.
- La table `tracking` est prête et protégée par trois tests dédiés.
- `npm test` couvre hash, scoring, base, purge, sources et pipeline.

**Ce qui n'existe pas encore** (plans 2 et 3) : le serveur web, l'API REST, le
dashboard branché sur la base, la migration du `localStorage`, les lettres de
motivation, l'import par collage, la planification et le README.

---

## Suite

**Plan 2 — Dashboard & API** : `server.js`, les routes REST, la migration des
données depuis `localStorage`, et le branchement du HTML existant sur l'API
(en préservant intégralement le design, les thèmes, les animations et les
4 vues), plus le bouton « Rafraîchir maintenant » et l'indicateur de dernière
mise à jour.

**Plan 3 — Lettres & mise en service** : génération des lettres de motivation
et export `.docx`, import d'offre par collage, tâche planifiée Windows et cron
Unix, README pas-à-pas, et documentation de l'hébergement gratuit sur Fly.io.
