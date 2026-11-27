# Chantier 4.0 — « premium, animations et fonctionnalités de zinzin »

> **Bilan (13 novembre 2026, soir).** Le chantier est livré : les trois lots
> (serveur, front socle, front tableau) sont intégrés, 570 tests passent, et
> chaque vue a été vérifiée dans les quatre thèmes et sur mobile. Le détail de
> ce qui a changé est dans `docs/versions/4.0.0.md`. Ce document reste comme
> trace des contrats d'API (§3), qui sont ceux du code ; la propriété des
> fichiers (§2) n'a plus cours. Restes connus : l'ordre des cartes dans une
> colonne du Kanban n'est que local (`localStorage`) ; la fermeture animée du
> détail d'une carte n'est fluide que sur Chromium ; les cartes de révision
> (`demanderAncre`) ne reçoivent pas `responseMimeType`, l'API le refuse avec
> la recherche Google.

> Document de coordination du chantier 4.0 (13 novembre 2026). Il fixe les
> règles communes, la propriété des fichiers entre chantiers parallèles, et
> les CONTRATS d'API que le front et le serveur implémentent chacun de leur
> côté, en même temps. Chaque chantier lit ce fichier avant de commencer.

## 0. L'intention

L'application est déjà solide (474 tests, 4 thèmes, palette, ouverture radar,
lecteur flottant). Le but du 4.0 n'est pas d'ajouter du bruit, c'est de la
rendre **professionnelle et spectaculaire à la fois** : chaque geste répond,
chaque attente est habitée, chaque écran a une hiérarchie, et quelques
fonctionnalités font dire « ah ouais ». Référence de qualité : Linear, Raycast,
Arc. Ton : français, tutoiement, commentaires narratifs (POURQUOI, ce qui ne
marchait pas, titres en MAJUSCULES) — c'est la voix du projet, on la garde.

## 1. Règles communes, non négociables

1. `npm test` doit rester vert (474 tests au départ). Lire `test/style.test.js`,
   `test/cv-depot.test.js`, `test/csp.test.js`, `test/intro.test.js` avant de
   toucher au CSS, à index.html ou à la CSP.
2. **CSP stricte** : aucun script en ligne, aucune ressource distante (pas de
   Google Fonts, pas de CDN), `connect-src 'self'`. Tout est servi par le
   serveur. `style-src 'unsafe-inline'` est toléré (attributs `style=`).
3. Les modules testés sous Node (`render.js`, `entretien.js`, `intro.js`,
   `format.js`, `selection.js`, `rapport.js`, `media.js`, `icons.js`,
   `api.js`, `surcouche.js`, `sons.js`) ne touchent ni `document` ni
   `window` au niveau du module sans garde `typeof window`.
4. Animations en boucle (`infinite`) : uniquement `transform`, `opacity`,
   `box-shadow`, `background-position` ; et leur sélecteur passe sous
   `[data-page="cachee"] … { animation-play-state: paused }`. L'interrupteur
   `[data-anim="off"]` et `prefers-reduced-motion` coupent TOUT mouvement,
   y compris les transitions de vue et les nouveaux effets.
5. Ordre des plans (z-index) : toast 9500 > intro 9000 > dépôt CV 8900 >
   tuto 8800 > overlay 150 > dock 70. `#dock`, les `.overlay` et `#toastZone`
   restent FRÈRES de `.app`, jamais dedans.
6. Décisions serveur à ne pas relitiger (`docs/REPRENDRE.md` §4) : la collecte
   n'écrit que dans `offers` ; les offres sont enregistrées avant l'analyse ;
   l'analyse est plafonnée ; supprimer inscrit dans `rejetees` ; le CV part en
   .docx d'origine ; pas de scraping ; dates en heure locale ; pas de backtick
   dans le gabarit SQL.
7. Zéro emoji dans le MOBILIER de l'interface (icônes SVG de `icons.js`) ; les
   emoji restent admis dans le CONTENU (texte d'un verdict, d'un chat).
8. Chaque ajout est **optimisé** : pas de re-rendu complet quand une carte
   suffit, pas de fetch à chaque rendu, pas de layout thrash dans une boucle
   d'animation.

## 2. Propriété des fichiers (chantiers parallèles)

| Chantier | Fichiers qu'il est SEUL à modifier |
|---|---|
| **Serveur** | `src/**`, `scripts/**`, `test/**` (serveur), `package.json` (dépendances seulement si indispensable) |
| **Front socle** | `public/app.js`, `public/index.html`, `public/style.css`, `public/ui.css`, `public/surcouche.js`, `public/format.js`, `public/icons.js`, `public/api.js`, `public/connexion.html` + nouveau `connexion.js`, `public/tutoriel.js`, `public/chill.js`, `public/entretien.js`, `public/dock.js`, `public/spotify-ui.js`, `public/twitch-ui.js`, `public/youtube-ui.js`, `public/cv.js`, `public/depot-cv.js`, `public/sons.js`, `public/bienvenue.*`, nouveaux modules front, `public/fonts/**`, tests front |
| **Front tableau** | `public/render.js`, `public/charts.js`, `public/dashboard.js`, `public/tableau.css`, `public/anim.js`, `public/selection.js`, `public/rapport.js`, `public/impression.js`, tests de ces modules |

Un chantier qui a besoin d'une modification dans un fichier qui n'est pas à
lui la décrit dans son rapport final (fichier, ligne, texte exact) ; elle
sera faite à l'intégration. Il n'y touche pas.

Points d'ancrage déjà posés :
- `index.html` charge `ui.css` puis `tableau.css` après `style.css` ;
- `#dashHero` (vide) est en tête de `#view-dashboard`, avant « Les 3 du jour » ;
- `deposerKanban(id, statut)` dans app.js renvoie `true` si le serveur a
  accepté le déplacement, `false` sinon (déjà fait).

## 3. Contrats d'API (serveur ↔ front)

Toutes les réponses : `{ ok: true, … }` ou `{ ok: false, error: "message
lisible en français" }`. Le front ajoute les méthodes dans `public/api.js`.

### 3.1 Collecte en direct

- `POST /api/collecte/demarrer` → `202 { ok, id }` ; `409` si une collecte
  tourne déjà (`{ ok:false, error, id }`). Lance `collecter()` en tâche de
  fond et répond tout de suite. **`POST /api/refresh` reste** tel quel
  (synchrone), pour compatibilité.
- `GET /api/collecte/etat` → `{ ok, enCours, id, debut, evenements: [...] }`
  — `evenements` est le journal de la collecte en cours ou de la dernière
  (200 derniers événements), pour qu'une page rechargée se raccroche.
- `GET /api/collecte/flux` → **SSE** (`Content-Type: text/event-stream`,
  `Cache-Control: no-cache`, `X-Accel-Buffering: no`). À la connexion, le
  serveur rejoue le journal de la collecte en cours, puis diffuse en direct.
  Un commentaire `: ping` toutes les 20 s garde la connexion. Événements
  (`event: <nom>`, `data: <JSON>`) :
  - `debut` `{ id, debut, sources:[nom], intitules:[…], villes:[nom], depuisDate }`
  - `source` `{ nom, etat: 'debut'|'ok'|'echec'|'ignoree', intitule, ville, trouvees, message }`
    — une par requête (source × intitulé × ville). `ville` vaut `"France"`
    pour la passe nationale.
  - `etape` `{ nom: 'fusion'|'filtrage'|'ecriture'|'analyse'|'nettoyage'|'sauvegarde', detail: { … } }`
    — `fusion` : `{ brutes, distinctes }` ; `filtrage` : `{ retenues, ignorees }` ;
    `ecriture` : `{ nouvelles }` ; `analyse` : `{ prevues }` ;
    `nettoyage` : `{ purgees, horsProfil, departementsCorriges }`.
  - `offre` `{ id, titre, entreprise, ville, groupe, score, nouvelle, source }`
    — une par offre retenue, émise à l'écriture (c'est ce que le radar affiche).
  - `analyse` `{ id, titre, i, total, verdict }` — une par analyse Gemini.
  - `fin` `{ resume }` — le même `resume` que `/api/refresh`.
  - `erreur` `{ message }`.
- Verrou **unique** : serveur (bouton), planificateur et `/api/refresh`
  partagent le même verrou. Une collecte lancée par la tâche Windows (autre
  processus) pose `meta.collecte_verrou = <horodatage>` au début et l'efface
  à la fin ; le serveur refuse de démarrer si ce verrou a moins de 30 min.

### 3.2 Offres

- `POST /api/offers/:id/analyser` → `{ ok, analyse, quota }` : relance
  l'analyse Gemini d'une offre (forcée, même déjà analysée), compte le quota
  (`peutRediger` : c'est l'utilisateur qui demande). `404` si absente, `503`
  si quota ou Gemini indisponible, `400` sans clé Gemini ou sans CV.
- `GET /api/rappels` → `{ ok, rappels: [{ type:'relance'|'entretien'|'sans-reponse'|'offre-fraiche', offerId, titre, entreprise, date, dansJours, retardJours, poids }] }`
  triés par urgence. `sans-reponse` = envoyé il y a plus de 14 jours sans
  changement de statut. `offre-fraiche` = prioritaire de moins de 48 h.

### 3.3 Agenda

- `GET /api/agenda.ics` → `text/calendar`, un `VEVENT` par relance planifiée
  et par entretien (`DTSTART` en date locale, `VALARM` la veille pour les
  entretiens), `UID` stable = `<offerId>-<type>@jobcockpit`.

### 3.4 Sauvegardes

- `GET /api/sauvegardes` → `{ ok, dossier, sauvegardes: [{ nom, date, tailleOctets }] }`.
- `POST /api/sauvegardes` → `{ ok, nom }` : sauvegarde immédiate (même
  mécanisme qu'en fin de collecte).

### 3.5 Lettres : historique des versions

- Chaque génération et chaque retouche enregistre une version
  (`lettres_versions(offer_id, version, content, origine, cree_le)`).
- `GET /api/letter/:id/versions` → `{ ok, versions: [{ version, origine:'generee'|'retouche', creeLe, apercu }] }`
- `POST /api/letter/:id/versions/:v/restaurer` → `{ ok, contenu }`.

### 3.6 Suivi

- `PATCH /api/track/:id` renvoie désormais `suivi` **avec** `entretien`, et
  refuse (`400`) un statut hors de la liste fermée
  `['À postuler','Envoyé','Relancé','Entretien','Refus']`.

### 3.7 Quota

- `GET /api/meta` → `quota` inclut désormais `entretiens` et `chat` dans
  `total`, plus `reserveChat` (défaut 20, bornée).

## 4. Backlog par chantier

### Serveur
1. Bugs : quota qui sous-compte (entretien, chat) ; `POST /offers/paste`
   sans quota ni rejetées, et offres collées purgées à 30 j (→ `is_manual=1`) ;
   `SANS_TRACE` ignore `entretien_date` et la table `entretiens`
   (`supprimerOffres`/`restaurerRejet` doivent emporter et rendre la ligne
   `entretiens`) ; deux verrous de collecte ; `PRAGMA busy_timeout=5000` ;
   CV figé dans le planificateur (relire `profile/cv.txt` à chaque tour) ;
   `PATCH /track` (entretien absent de la réponse, statut non validé, en
   transaction) ; `PATCH /letter/:id` sur une offre inexistante ; `stats.js`
   `new Date(aujourdhui)` en UTC ; Gemini sans timeout (`AbortSignal.timeout`
   60 s) ; `responseMimeType:'application/json'` partout où l'on attend du
   JSON ; radar dérivé du profil (`profil.scoring.familles` si présent, sinon
   l'actuel).
2. Index manquants : `tracking(status)`, `tracking(sent_date)`,
   `tracking(entretien_date)`, `offers(first_seen)`, `offers(is_manual)`,
   `evenements(offer_id)`. `stats.js` : `semaines` en une requête.
3. Contrats 3.1 à 3.7, avec tests (`node:test`, même style que
   `test/api-suivi.test.js`).
4. Collecte : `collecterDepuisSources` parallélise les requêtes PAR SOURCE
   (les sources entre elles en parallèle, chaque source séquentielle pour
   respecter ses limites), et émet les événements `source`.

### Front socle
1. Bugs : `connexion.html` (script en ligne → `connexion.js`, route libre
   dans `src/auth.js` `CHEMINS_LIBRES` — à signaler pour l'intégration, ou à
   faire si trivial) ; `.docx` déposé dans Chill qui remplace le CV
   (`stopPropagation`) ; toasts `'erreur'` → `'err'` (normaliser DANS `toast()`
   et remplacer les appels) ; `--bord`/`--bg1` non définis ; Échap sur
   l'entretien blanc ; raccourcis actifs derrière les surcouches (pile de
   surcouches dans `surcouche.js`) ; aide clavier mensongère ; restes
   « +N pt » ; flash de thème ; `#nb-entretiens` jamais rempli ; `resize` du
   tutoriel jamais retiré ; visite sautée si animations coupées.
2. Police **Inter Variable** livrée en local (`public/fonts/`, `@font-face`,
   `font-display:swap`, licence OFL copiée à côté) ; `--font-titre` distincte
   pour les titres.
3. `theme-boot.js` (script classique dans `<head>`, autorisé par
   `script-src 'self'`) : thème, densité, animations posés avant le premier
   rendu ; option « Système » (`prefers-color-scheme`) ; transition croisée au
   changement de thème.
4. Toasts pro : `aria-live`, icônes SVG, barre de temps, pile limitée, bouton
   fermer, pause au survol, sortie animée, action « Annuler ».
5. `dialogue.js` : confirmation maison à la place de `confirm()`, action
   destructive en rouge, Entrée/Échap, focus géré.
6. Palette v2 : fuzzy avec surlignage, récents, toutes les vues et actions,
   actions contextuelles sur une offre, icônes SVG, aperçu.
7. Clavier : j/k dans la liste, Entrée déplie, p épingle, x écarte, e envoyé,
   l lettre ; `.card.focus` ; `.head` focusable ; `aria-current`.
8. Routage par hash (`#/offres/strasbourg`, `#/offre/<id>`), précédent /
   suivant.
9. View Transitions API entre vues (repli `.entre`), ouverture du détail de
   carte en hauteur animée (`grid-template-rows`), skeletons au premier
   chargement et sur les zones Gemini.
10. Rendu incrémental : `rafraichirCarte(id)` plutôt que `rendreTout()`
    après pin/statut/notes, pour ne pas perdre les zones ouvertes.
11. Radar de collecte en direct (contrat 3.1) : une surcouche plein écran
    façon ouverture radar, qui montre les sources interrogées, les offres
    qui tombent une à une (points qui s'allument, couleur du groupe), les
    analyses, puis le résumé ; réductible en pastille dans le bandeau ;
    se raccroche à une collecte en cours au rechargement.
12. Mode focus (rail et bandeau masqués, 3 du jour + carte en cours,
    minuteur Pomodoro, son de fin).
13. Rappels (contrat 3.2) : badge d'onglet `(3)`, `#nb-entretiens`,
    Notification API locale (après accord), centre de notifications dans le
    bandeau.
14. Frappe animée (révélation progressive) pour la lettre, la relance, la
    fiche et le chat ; le chat n'est plus reconstruit à l'envoi.
15. Micro-interactions : 3e argument d'`essayer()` utilisé (secousse /
    pulsation), coche dessinée au passage « Envoyé », anneau d'objectif qui
    progresse en direct, `celebrer` à l'objectif atteint.
16. Historique des versions de lettre (contrat 3.5) dans la zone lettre ;
    « Analyser maintenant » (contrat 3.2) sur une carte sans analyse ;
    export `.ics` et sauvegardes (3.3, 3.4) dans Options.
17. Nettoyage : CSS morte identifiée (`.sbq*`, `.prog-tile`, `.funnel-row`,
    `.goal-*`, ancien `.chill-*`), debounce de la recherche, `#burger`
    étiqueté, états vides illustrés (SVG inline, pas d'emoji).

### Front tableau
1. Kanban pro : pointer events (souris, tactile, stylet), carte fantôme,
   placeholder d'insertion, défilement auto près des bords, animation FLIP,
   mise à jour optimiste avec retour arrière (`surDepot` renvoie un booléen),
   déplacement au clavier (Espace, flèches, Entrée), compteurs animés,
   colonnes repliables, hauteur fluide (plus de `calc(100% - 90px)`).
2. Graphiques : réticule + info-bulle maison sur l'aire, morph animé entre
   30 j / 90 j / semaines, légende cliquable du donut (événement
   `jc:filtre` `{ source }` écouté par app.js), libellés non déformés
   (plus de `preserveAspectRatio="none"` sur du texte), barres et anneaux qui
   s'animent à l'arrivée ET à la mise à jour, `celebrer()` respectant
   `data-anim`.
3. Tableau de bord : `#dashHero` = objectif hebdo en grand anneau animé,
   série (jours consécutifs), prochain entretien avec compte à rebours,
   dernière collecte ; tuiles KPI avec delta et sparkline nets ; sections
   secondaires en onglets plutôt qu'en pile.
4. Cartes (`rendreCarte`) : en-tête sans emoji ni glyphes texte (★☆✕▸ →
   icônes), score en anneau miniature, chevron animé, badge de fraîcheur
   coloré, bouton « Analyser maintenant » (`data-act="analyser"`, branché
   par app.js) quand `offre.analyse` est absente.
5. Agenda : correction du bug d'heure d'été (`render.js` 660/676 — passer
   par `setDate`), mois navigable (précédent / suivant), jours avec aperçu
   au survol.
6. Mobile : kanban tactile, grille fluide.
