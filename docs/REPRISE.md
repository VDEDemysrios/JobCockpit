# Document de reprise — Job Cockpit

> À lire en entier avant de toucher au code. Écrit le **28 juillet 2026**, à la
> fin d'une session qui a transformé le tableau de bord et ajouté deux sources
> d'offres. Tout ce qui suit a été **exécuté et vérifié**, sauf mention
> contraire explicite.

---

## 1. État en une ligne

**157 tests passent, 0 échec.** L'application démarre, les 6 vues se rendent
sans erreur console. Il manque **les clés France Travail** pour que la collecte
devienne réellement utile.

> Mise à jour du 29 juillet 2026 : deux sessions ont eu lieu depuis. Les flux
> RSS (§10) et la refonte demandée par Benjamin (§11) priment sur tout ce qui
> suit en cas de contradiction — notamment la §3, qui décrit une gamification
> désormais retirée.

```bash
npm test
```

```bash
npm start
```

Puis http://localhost:3000

> **Node.js** : v24.18 installé, mais **absent du PATH de certains shells**.
> Si `node` est introuvable, recharge le PATH :
> `$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")`

---

## 2. La prochaine action, avant toute autre

Benjamin n'a que **3 offres en base** parce qu'**Adzuna tourne seul** — et
Adzuna tronque les descriptions, donc l'analyse Gemini travaille à l'aveugle.

### 2.1 France Travail (priorité absolue)

Le code existe déjà (`src/sources/franceTravail.js`), il ne manque que les
identifiants. C'est la **seule source qui fournit la description complète**.

1. Compte sur [francetravail.io](https://francetravail.io)
2. Créer une application. Le formulaire exige une **URL publique** et
   **refuse `localhost`** (message : « Vous ne pouvez pas saisir d'adresse IP
   locale »). Benjamin a prévu de créer un **Gist public** décrivant
   l'application et d'y mettre son URL. Ce point était en cours au moment de
   l'arrêt.
3. **Souscrire à l'API « Offres d'emploi v2 »** — étape distincte de la
   création de l'application, et celle que tout le monde oublie. Sans elle,
   erreur `401` à chaque collecte.
4. Renseigner dans `.env` :
   ```
   FRANCE_TRAVAIL_CLIENT_ID=…
   FRANCE_TRAVAIL_CLIENT_SECRET=…
   ```

> **Ne jamais demander à Benjamin de coller ses clés dans le chat.** Il les
> écrit lui-même dans `.env`. On peut vérifier la connexion en lançant une
> collecte et en lisant le résumé, sans afficher les valeurs.

### 2.2 Ensuite

- **Careerjet** — clé gratuite sur [careerjet.com/partners/api](https://www.careerjet.com/partners/api).
  Adaptateur déjà écrit. Couvre APEC, HelloWork, Meteojob, Jobijoba.
- ~~Flux RSS~~ — **fait le 29 juillet 2026**, voir §10.

---

## 3. Ce qui a été construit dans cette session

### Backend

| Fichier | Rôle |
|---|---|
| `src/progression.js` | **réécrit** — 12 niveaux, 48 succès (4 paliers, 7 familles, jauges), barème étendu |
| `src/quetes.js` | **nouveau** — quêtes journalières et hebdomadaires, tirage déterministe |
| `src/stats.js` | **nouveau** — toutes les agrégations (séries, heatmap, radar, records, mesures de quêtes) |
| `src/db.js` | tables `evenements` et `quetes`, helper `journaliser()` |
| `src/api.js` | routes `/api/stats`, `/api/quetes`, `/api/timeline`, `/api/cv` ; journalisation |
| `src/sources/careerjet.js` | **nouveau** — méta-moteur, clé gratuite |
| `src/sources/rss.js` | **nouveau** — flux RSS/Atom génériques pilotés par `profile.json` |

### Frontend

`public/charts.js` (bibliothèque SVG maison), `public/dashboard.js`,
`public/quetes.js`, `public/cv.js`, `public/anim.js` (rouleaux de chiffres) —
tous nouveaux. `app.js`, `render.js`, `progression.js`, `style.css`,
`index.html` réécrits ou fortement étendus.

**9 vues** : Focus, Tableau de bord, Statistiques, Offres, Kanban, Agenda,
Mon CV, Progression, Options. Palette de commandes `Ctrl+K`. 4 thèmes.

---

## 4. Invariants à ne pas casser

Ce sont des décisions de conception, pas des accidents. Chacune est
verrouillée par au moins un test.

1. **`upsertOffre()` n'écrit QUE dans `offers`.** Le suivi personnel
   (statuts, notes, relances, épingles) survit à toutes les collectes.
   → `test/db-upsert.test.js`, `test/collect.test.js`

2. **L'expérience est RECALCULÉE depuis l'état réel, jamais accumulée.**
   Toute source de points doit être déductible d'un fait durable en base.
   C'est pourquoi quêtes terminées et succès obtenus sont *stockés*.
   → `test/progression.test.js`

3. **Rien ne se débloque tout seul.** Aucun succès ni aucune quête ne peut
   être atteint par le seul fonctionnement de la collecte automatique.
   → test « chaque succès dépend d'une action du candidat »

4. **Un succès obtenu et une quête terminée ne se reprennent jamais**, même
   si l'état redescend. Corriger une faute de saisie ne doit pas retirer un
   badge mérité.

5. **Le niveau utilisé pour évaluer les succès est le niveau « de base »**
   (hors primes de succès), sinon la récompense d'un succès pourrait
   déclencher ce même succès, en boucle. Voir `calculerXpBase()`.

6. **Les mesures de quêtes dédoublonnent par offre**, jamais par clic.
   Sans ça, six allers-retours sur une offre validaient « envoyer 5
   candidatures ». → `test/stats.test.js`

7. **« À postuler » efface la date d'envoi et la relance.** Un statut
   « pas encore envoyé » avec une date d'envoi est une contradiction qui
   fait mentir l'objectif hebdomadaire, la courbe et l'agenda.
   → `test/api-suivi.test.js`

8. **Le tirage des quêtes garantit au moins une quête « socle »** (faisable
   sans historique). Un premier jour proposant trois objectifs inatteignables
   décourage au lieu d'entraîner.

9. **Les dates sont calculées en heure LOCALE, jamais en UTC.** Une action
   du lundi 23 h doit compter pour lundi. Voir `isoLocal()` dans `stats.js`.

10. **Aucune information n'existe uniquement pendant une animation.** La
    valeur finale est toujours écrite AVANT d'animer, et l'état d'arrivée est
    posé sur l'élément lui-même. Une transition CSS ne démarre pas dans un
    onglet qui ne compose pas de frames — si on comptait dessus, les tuiles
    resteraient bloquées sur « 0 ». Voir l'en-tête de `public/anim.js`.

---

## 5. Pièges rencontrés, pour ne pas les refaire

- **Backticks dans le gabarit SQL.** Un commentaire SQL contenant des
  backticks à l'intérieur du littéral `SCHEMA` de `db.js` fermait la chaîne :
  7 fichiers de tests plantaient d'un coup. Ne jamais mettre de backtick dans
  ce bloc.
- **`animation-fill-mode: backwards` + onglet non composité** = élément figé
  sur son état de départ (souvent `opacity:0`). Sans conséquence dans un vrai
  navigateur, mais trompeur en vérification automatisée.
- **`getBoundingClientRect()` pendant une animation** renvoie la taille
  *transformée*, pas la taille de layout. Utiliser `offsetWidth`.
- Le CSS et le JS sont **mis en cache** : toujours demander un `Ctrl+F5` après
  une modification front.

---

## 6. Ce qui n'a PAS été vérifié

- **Careerjet n'a été testé que sur des réponses simulées.** Pas de clé
  disponible. Si le format diffère de la documentation, la source sera marquée
  « en échec » dans `collect.log` et les autres continueront — mais il faudra
  ajuster `normaliserOffre()`.
- **Aucune collecte réelle n'a été lancée** depuis les modifications. Les flux
  RSS, eux, ont été éprouvés à blanc sur des données réelles (§10).
- La vue **Statistiques est quasi vide** faute de données : le radar, la
  distribution des scores et la répartition horaire n'ont jamais été vus
  remplis.

---

## 7. État exact de la base au moment de l'arrêt

```
offers 3 · tracking 1 (« À postuler », sans date) · letters 1
succes 4 · quetes 3 · evenements 14 · xp 218
```

Les **4 succès et 3 quêtes proviennent de tests**, pas d'un vrai travail de
candidature — dont « Envoyer 5 candidatures », décroché à cause du bug de
dédoublonnage depuis corrigé. **Benjamin a été invité à faire
Options → Tes données → Réinitialiser la progression** pour repartir propre.
Vérifier s'il l'a fait ; sinon, le lui reproposer.

---

## 8. Pistes ouvertes, par ordre d'intérêt

1. ~~Choisir le Service Public via le CSV data.gouv.fr~~ — **inutile** : le
   site expose un flux RSS filtrable, exploité depuis le 29 juillet (§10).
2. **Publier le projet sur GitHub.** `.gitignore` protège déjà `.env`,
   `data.db` et le CV — **mais pas `profile/profile.json`**, qui contient le
   nom, la ville et les critères de recherche. Il faudrait le sortir du suivi
   et livrer un `profile.example.json` anonymisé.
3. Rendre le nombre de quêtes journalières réglable dans Options.
4. Export PDF du suivi de candidatures.

---

## 9. Contexte humain

Benjamin Perrin, ~2 ans d'expérience, profil **droit public / gestion de
projet EnR**, spécialité **agrivoltaïque**. Cible : Strasbourg, Nancy, Lyon,
Paris. Il n'est pas développeur : les messages d'erreur, le README et les
libellés doivent rester en français clair, et les commandes données
copiables telles quelles.

Le ton du code est en français, commentaires compris — **s'y tenir**. Les
commentaires expliquent *pourquoi*, jamais *quoi*.

---

## 10. Session du 29 juillet 2026 — les flux RSS, en vrai

**200 tests passent, 0 échec.** Le pari de la source « flux » est gagné, et
plus largement que prévu.

### Ce qui a été trouvé

La quasi-totalité des job boards français ont fermé leurs flux : Indeed (404),
Cadremploi (404), APEC (404), Jobijoba (410), Jooble (403), Meteojob (404),
Welcome to the Jungle (406). Ne pas perdre de temps à les chercher.

Deux survivants, dont un excellent :

- **Choisir le Service Public** — flux `offerRss.ashx`, **entièrement
  filtrable et combinable** (filière, métier, région, département, catégorie,
  versant, employeur), **descriptions complètes de 2 000 à 5 000 caractères**,
  aucune clé, aucune limite d'appel constatée. C'est aujourd'hui la meilleure
  source du projet — meilleure qu'Adzuna, qui tronque. Le catalogue des
  filtres est publié :
  <https://place-ep-recrute.talent-soft.com//offre-de-emploi/tous-les-flux-rss.aspx>
- **Emploi-Environnement** — un seul flux vivant (`gestion_offre/rss.php4`) ;
  les flux par catégorie annoncés dans la page d'accueil renvoient du HTML.
  Descriptions tronquées à ~150 caractères et entités abîmées **à la source**
  (`concr` + `etegrave;`) : bon pour repérer, pas pour analyser.

`profile.json` déclare **13 flux** : 3 filières × 4 départements, plus
Emploi-Environnement.

### Ce que ça donne

Collecte à blanc du 29 juillet (aucune écriture en base, aucun appel Gemini) :

```
135 offres distinctes · 84 situées dans la zone · 85 retenues par le pipeline
groupe 1 « Prioritaire » 50 · groupe 2 21 · groupe 3 11
```

À comparer aux **3 offres** en base. La vue Statistiques devrait enfin se
remplir.

### Cinq défauts corrigés, chacun trouvé sur des données réelles

Tous verrouillés par un test dans `test/source-rss.test.js`.

1. **Encodage.** `lireFlux()` lisait tout en UTF-8. Les flux français encore
   en ISO-8859-1 ne l'annoncent que dans le prologue XML, jamais dans
   l'en-tête HTTP : tous leurs accents devenaient « � ». `decoderReponse()`
   suit maintenant l'en-tête HTTP, puis le prologue, puis retombe sur UTF-8.
2. **Références en tête de titre.** « MINT_BA067PNB-123673 - DIPN67 - Chargé
   du contrôle de légalité » : la référence passait pour l'intitulé du poste,
   et l'intitulé pour l'employeur. Elles sont dépilées tant que le premier
   segment est un mot d'un seul tenant contenant un chiffre — un intitulé de
   poste, lui, a toujours des espaces.
3. **Adresse postale.** Elle est rangée dans une balise `category`, pas dans
   la description : c'est de là que viennent la ville et le code postal.
4. **Employeurs inventés.** `entreprise` retombait sur le *nom du flux* :
   toute la colonne affichait « Service Public — affaires juridiques —
   Bas-Rhin ». Mieux vaut un employeur vide qu'un employeur faux.
5. **Boîtes postales.** « CS 10205 : 75588 Paris » — le premier nombre à cinq
   chiffres n'est pas le code postal. Seul compte celui que suit un nom de
   commune.

### Nouvelle option de configuration : `zone`

Un flux filtré par département sait où sont ses offres, mais les entrées ne le
répètent pas : 51 offres sur 135 seulement portaient une adresse. Sans `zone`,
les 84 autres étaient classées « hors zone » et la plupart écartées. Avec,
elles sont situées. L'adresse d'une entrée reste prioritaire quand elle existe.

### La prochaine action

**Lancer une vraie collecte** — `npm run collect`. C'est le premier essai en
conditions réelles depuis la refonte : il écrit en base et consomme le quota
Gemini. Vérifier ensuite `collect.log` et la vue Statistiques.

Et **toujours** : les clés France Travail (§2.1), qui restent vides.

---

## 11. Session du 29 juillet 2026 (2) — la refonte demandée par Benjamin

**157 tests passent, 0 échec.** Quatre demandes, quatre livraisons. Les §3 et
§4 ci-dessus décrivent en partie un état qui n'existe plus : cette section
fait foi.

### 11.1 Le CV n'est plus recopié, il est joint

Benjamin a jugé la vue « Mon CV » **inexploitable** : elle affichait le texte
extrait du .docx, que mammoth livre dans un ordre arbitraire — « CONTACT » et
« COMPÉTENCES » ressortaient avant son nom.

La confusion était de fond : le CV joue **deux rôles**, et les mélanger rendait
la vue absurde.

- C'est un **document**, celui que l'employeur reçoit.
- C'est aussi une **matière première**, dont le texte nourrit l'analyse.

Désormais :

- **`src/dossier.js`** (nouveau) assemble un `.zip` contenant la lettre mise en
  page **et le CV d'origine, octet pour octet**. Route `/api/letter/:id/dossier`,
  bouton **« 📎 Dossier complet »** dans le panneau de lettre.
- La vue « Mon CV » montre la **carte du document** (nom tel que l'employeur le
  verra, poids, date) avec un bouton d'ouverture, plus la couverture des
  mots-clés. Le pavé de texte a disparu.
- `jszip` était une dépendance transitive de `docx` : elle est maintenant
  **déclarée explicitement** dans `package.json`.

### 11.2 Le site est épuré : 9 vues → 6

Retiré **toute la gamification** : niveaux, expérience, 48 succès, quêtes,
série de jours, célébrations, gains volants. Supprimés : `src/progression.js`,
`src/quetes.js`, `public/progression.js`, `public/quetes.js`, les tables
`succes` et `quetes`, les routes `/api/progression*` et `/api/quetes`, et
14 000 caractères de CSS.

**Focus du jour** et **Statistiques** ont fondu dans le **Tableau de bord**,
qui s'ouvre désormais sur « À faire maintenant ». Restent 6 vues : Tableau de
bord, Offres, Kanban, Agenda, Mon CV, Options.

Ce qui a été **gardé volontairement** :

- l'**objectif hebdomadaire** (réglable dans Options, rappelé en haut d'écran) :
  c'est un objectif de travail, pas un score ;
- les **confettis à l'obtention d'un entretien**, sans réglage : c'est la seule
  chose que Benjamin cherche vraiment ;
- les tables `activite` et `evenements`, qui alimentent le calendrier
  d'assiduité et le journal — la « série » disparaît, pas l'historique.

`SANS_SERIE` est devenu `SANS_ACTIVITE`, et `debutDeSemaine()` a migré de
`progression.js` vers `stats.js`, où sont les autres aides de dates.

### 11.3 Les lettres sont bien plus fournies

Benjamin les trouvait **trop courtes et trop génériques**. Le prompt passe de
« 350 à 400 mots » à **650 à 800 mots**, et surtout change de méthode : le
modèle doit d'abord **dépouiller l'annonce** pour en extraire les trois
exigences réellement mises en avant, puis leur consacrer **un paragraphe
chacune**, preuve du CV à l'appui.

Deux ajouts qui comptent :

- **90 % du portefeuille est agrivoltaïque** — à faire figurer dès que l'offre
  s'y prête, à traduire en savoir-faire quand elle n'a rien à voir ;
- un **registre « fonction publique »** : la moitié des offres vient désormais
  de là (§10), et une lettre qui ignore le statut, la catégorie ou le versant
  sonne hors sujet.

### 11.4 Le CV lui-même a été modifié

Sur demande explicite. Deux endroits, dans `profile/cv-source.docx` :

- le PROFIL : « …et en droit, **spécialisé en agrivoltaïsme — 90 % de mon
  portefeuille**. » ;
- la première puce Vent d'Est : « Portefeuille de 8 projets d'énergies
  renouvelables — **90 % en agrivoltaïsme**, complété par de l'éolien et du
  solaire flottant — … ».

Le fichier d'origine est sauvegardé en `profile/cv-source.docx.sauvegarde-20260729`.
`npm run extract-cv` a été relancé. Le motif de scoring « 90% du portefeuille
actuel » (+4) est **désormais couvert** : 15 motifs sur 17.

> Le CV de Benjamin lui appartient. Ne jamais le modifier sans demande
> explicite, et toujours sauvegarder avant.

### 11.5 Deux bugs de fond corrigés au passage

Trouvés en lançant le serveur depuis un autre dossier — ce que fait n'importe
quel raccourci ou tâche planifiée.

1. **`src/api.js` lisait le CV en chemin relatif** (`profile/cv.txt`) : lancé
   d'ailleurs, l'application perdait le CV, donc les analyses et les lettres.
   Les chemins sont maintenant résolus depuis la racine du projet.
2. **`src/server.js` chargeait `.env` depuis le dossier courant** : lancé
   d'ailleurs, il démarrait **sans aucune clé** et affichait toutes les sources
   « non configurées », sans la moindre erreur pour l'expliquer. `dotenv` reçoit
   désormais le chemin explicite.

### 11.6 Prévisualisation

L'outil de prévisualisation lit `.claude/launch.json` du **dossier principal**
(Meridien), pas celui de JobCockpit2. Une entrée `job-cockpit` y a été ajoutée,
en `node <chemin absolu>/src/server.js` — `npm` échoue, l'outil ne cite pas le
chemin « C:\Program Files\… ». C'est cette contrainte qui a révélé les deux
bugs du 11.5.

### 11.7 La prochaine action

Inchangée : **lancer une vraie collecte** (`npm run collect`), puis vérifier
le tableau de bord désormais alimenté. Et toujours les clés France Travail.

Rien n'est commité : le dernier commit reste `a457123`, et trois sessions de
travail attendent au-dessus.

---

## 12. Session du 29 juillet 2026 (3) — sources élargies, automatisation, dépôt

### 12.1 La collecte tourne toute seule, toutes les 6 heures

Tâche planifiée Windows **« JobCockpit - collecte »**, répétition `PT6H` à
partir de 7h00, option « démarrer dès que possible » pour rattraper les
passages manqués.

Elle appelle `scripts/collecte-silencieuse.vbs`, qui lance
`Collecte automatique.cmd` **sans ouvrir de fenêtre** — sans ce détour, une
console noire clignotait toutes les 6 heures en plein travail. Le compte rendu
s'ajoute à `collect.log`.

Les commandes pour vérifier, modifier la fréquence, relancer ou supprimer la
tâche sont dans le README §5.

### 12.2 De 13 à 31 flux

Le catalogue du Service Public compte **29 filières**, on n'en exploitait que
3. Deux découpages se complètent désormais, parce qu'un flux ne renvoie que
ses **20 entrées les plus récentes** :

- **par département** (20 flux) — 5 filières × 4 départements. Filtrer par
  département donne 20 offres *par département*.
- **par région** (9 flux) — 3 filières × Grand Est, Auvergne-Rhône-Alpes,
  Île-de-France, pour les départements limitrophes.

Les 5 filières : affaires juridiques, aménagement du territoire,
environnement, **agriculture** (l'agrivoltaïsme est à cheval sur l'énergie et
le foncier agricole) et **pilotage des politiques publiques** (chef de projet
cadre A).

Rendement mesuré à blanc, le 29 juillet :

```
326 offres distinctes · 203 dans la zone · 265 retenues
groupe 1 « Prioritaire » 136 · groupe 2 87 · groupe 3 14
```

Contre 85 retenues / 50 prioritaires avec 13 flux.

### 12.3 Ce qui a été cherché en vain

Pour ne pas refaire le tour une troisième fois.

- **Pages carrière des employeurs EnR.** Les `/feed/` de **Valeco, JPee et EDF
  PowerSolutions** existent mais publient des **actualités**, pas des offres
  (vérifié entrée par entrée : « La centrale solaire de Gabardan célèbre ses
  15 ans »…). **Engie Green** : flux vide. Seul **TotalEnergies** publie un
  vrai flux d'offres (`jobs.totalenergies.com/fr_FR/careers/Home/feed/`),
  ajouté.
- **SmartRecruiters** expose bien une API publique par entreprise
  (`api.smartrecruiters.com/v1/companies/{nom}/postings`), mais **Akuo** n'y a
  aucune offre publiée. La piste reste valable pour d'autres employeurs.
- **Indeed : impasse définitive.** Le programme « Publisher », seule API qui
  permettait de lire ses offres, a fermé en 2023, et ses conditions
  d'utilisation interdisent la lecture automatisée. `src/sources/indeed.js`
  reste un emplacement inerte. **Ne pas contourner** : Jooble et Careerjet
  couvrent une large part des mêmes annonces, légalement.

### 12.4 Le dépôt est prêt à être publié

Trois sessions de travail ont enfin été commitées, sur la branche
**`refonte-sources-et-epuration`** (commit `99e4e3e`, 41 fichiers,
+5 574 / −1 808). `master` reste sur `a457123` en attendant la fusion.

Audit de confidentialité fait avant tout dépôt public :

| Vérification | Résultat |
|---|---|
| `.env` déjà commité ? | **jamais** |
| Clés d'API dans l'historique ? | **aucune** |
| `profile/profile.json` suivi ? | **retiré** du suivi, remplacé par `profile.example.json` anonymisé |
| Sauvegardes de CV | ignorées (`profile/*.sauvegarde-*`) |

Deux réserves, à connaître avant de rendre le dépôt public :

1. **L'App ID Adzuna réel de Benjamin figurait en exemple dans le README.**
   Remplacé par une valeur factice — mais il reste dans les **anciens
   commits**. Ce n'est pas un secret (l'identifiant public d'une application,
   inutilisable sans la clé), mais autant le savoir.
2. **`profile/profile.json` est dans l'historique** des commits antérieurs :
   nom, ville, critères de recherche et motifs de scoring calqués sur le CV.
   Le sortir du suivi protège l'avenir, pas le passé. Pour effacer aussi le
   passé il faudrait réécrire l'historique (`git filter-repo`) — à décider
   avec Benjamin selon qu'il rend le dépôt public ou privé.

**`gh` (GitHub CLI) n'est pas installé sur cette machine.** La création du
dépôt se fera donc à la main sur github.com, ou après installation de `gh`.

### 12.5 Ce qui reste, et n'appartient qu'à Benjamin

- **Les clés France Travail.** Le blocage historique était le formulaire, qui
  exige une **URL publique** et refuse `localhost`. **Publier le dépôt sur
  GitHub résout ce point** : l'URL du dépôt fait une URL d'application
  parfaitement valable. Puis ne pas oublier de **souscrire à l'API « Offres
  d'emploi v2 »**, étape distincte de la création de l'application.
- **La clé Careerjet**, gratuite, sur careerjet.com/partners/api.
