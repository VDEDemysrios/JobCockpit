# Job Cockpit — état des lieux

> **Le document à lire en premier.** Il dit où en est le projet, ce qui reste
> à faire, et pourquoi les choses sont comme elles sont.
>
> **Il est mis à jour à chaque session de travail.** Le journal détaillé des
> sessions passées vit dans [REPRISE.md](REPRISE.md) ; ici, seul l'état
> courant. En cas de contradiction, ce document a raison.

**Dernière mise à jour : 29 juillet 2026 (soir)**
**État : 177 tests passent · 258 offres en base · France Travail et 30 flux actifs**

> ## ⚠️ Il existe DEUX postes. Celui-ci n'est pas celui qui a tout.
>
> Découvert le 29 juillet 2026 au soir, et c'est la clé de trois anomalies qui
> semblaient sans rapport. Le README §5 donne le chemin d'origine de la tâche
> planifiée, écrit en dur :
>
> `C:\Users\BenjaminPerrin\Développement Dropbox\…\JobCockpit2`
>
> Trois choses n'y correspondent pas à la machine du Bureau : le profil Windows
> est `BenjaminPerrin` et non `benja`, le projet est dans un **Dropbox**, et le
> dossier s'appelle **JobCockpit2**. Aucun des trois n'existe ici (vérifié :
> profils utilisateur, dossiers Dropbox, `JobCockpit2` sur C: et D:).
>
> **Ce qui manque sur ce poste, et qui est sur l'autre :**
>
> | Manquait ici | Conséquence | État |
> |---|---|---|
> | `data.db` avec 264 offres | la base repartait de 3 offres | **258 offres** recollectées le 29 juil. au soir |
> | `profile.json` avec 31 flux RSS | `"flux": []` → 8 offres au lieu de 326 | **30 flux reconstitués** (§11) |
> | tâche planifiée + `collect.log` | aucune collecte automatique ici | **recréée et éprouvée** |
>
> Ces deux fichiers sont dans `.gitignore` : ils ne sont donc **pas** sur GitHub.
> **Mais Dropbox se moque de `.gitignore`** — ils restent probablement
> récupérables depuis le dossier `JobCockpit2` synchronisé. Ça n'a plus rien
> d'urgent pour les offres et les flux, qui sont reconstitués. Ça le reste pour
> **le suivi de candidatures, les notes et les lettres déjà rédigées** : ceux-là
> ne se recollectent pas.
>
> **Avant de faire tourner les deux postes en même temps :** deux collectes vers
> deux bases séparées scindent le suivi en deux. Décider lequel fait foi.
>
> La copie du Bureau était par ailleurs en retard de 6 commits sur GitHub ; elle
> a été remise à niveau, l'ancien dossier est conservé dans
> `Bureau\JobCockpit\_sauvegarde-avant-refonte-2026-07-29`.

---

## 1. Ce que fait le projet, en trois lignes

Job Cockpit va chercher les offres d'emploi tout seul toutes les 6 heures, les
classe selon un profil, les analyse au regard d'un CV, et rédige des lettres
de motivation. Tout tourne en local ; seuls le CV et les offres partent chez
Google Gemini au moment d'une analyse.

Démarrer : `npm start`, puis <http://localhost:3000>.
Dépôt : <https://github.com/VDEDemysrios/JobCockpit>

---

## 2. Où en est-on ?

### ✅ Fait et vérifié

| Chantier | État |
|---|---|
| **L'application vit dans `Bureau\JobCockpit\Application`** | Depuis le 1ᵉʳ août 2026, c'est `JobCockpit.exe` qui tourne, pas le projet. Une seule tâche planifiée, « Job Cockpit », le lance à l'ouverture de session, sans fenêtre — avec `COLLECTE_AUTO=1`, il collecte lui-même toutes les 6 h. **Attention au piège de la batterie — voir §4.** |
| Le dossier du projet | ne sert plus qu'à développer. Sa base a été mise de côté sous `data.db.remplacee-par-l-application-*` : sans ça, `npm run collect` aurait rempli une seconde base, et le suivi se serait scindé en deux — le piège dans lequel ce projet est déjà tombé. |
| Mettre à jour l'application | `npm run exe` puis `npm run installer`. L'installation ne remplace QUE le programme : `data.db`, `.env` et `profile/` ne sont jamais écrasés. |
| Sources | 31 flux RSS + Adzuna ; **264 offres en base**, 135 prioritaires |
| Classement et zone | scoring déterministe réglable dans `profile.json` |
| Analyse des offres | Gemini, **bridée par le quota gratuit** (§4) |
| Lettres de motivation | 650–800 mots, adaptées à l'annonce, garde-fous anti-invention |
| Dossier de candidature | `.zip` = lettre + CV d'origine, en un clic |
| Vue « Mon CV » | document joint + couverture des mots-clés |
| Interface | 6 vues, 4 thèmes, palette `Ctrl+K` ; gamification retirée |
| Lien vers l'annonce | **le titre de chaque offre est cliquable** |
| Onglets de villes | Strasbourg · Nancy · Lyon · Paris · Autre, classement par pertinence dans chacun (§8) |
| Sources | France Travail + Adzuna + Jooble + **30 flux RSS** (§10) — **425 offres en base**, 143 prioritaires |
| Nettoyage hors profil | `npm run nettoyer`, en simulation par défaut (§9) |
| **France Travail** | **branché et vérifié le 29 juil. 2026 au soir** — identifiants dans `.env`, abonnement « Offres d'emploi v2 » actif, 10 appels/s. Voir le piège §4. |
| Dépôt public | historique purgé de toute donnée personnelle |

### 🔑 En attente de Benjamin — rien ne bouge sans lui

| Quoi | Pourquoi ça bloque | Ce qu'il faut faire |
|---|---|---|
| *(aucun pour l'instant)* | — | — |

> **Jooble est branché** depuis le 29 juillet 2026 au soir. Clé obtenue sur
> fr.jooble.org, plafond annoncé à 500 requêtes.

> Benjamin a indiqué qu'il ajouterait **les sites d'emploi en dernier**. Ce
> n'est donc pas la priorité du moment.

### 🚀 Mise en ligne — prête à déployer, en attente de Benjamin

Benjamin a demandé une adresse permanente le 29 juillet 2026 au soir. **Tout
est écrit et éprouvé en local** ; il reste à créer le compte Fly et à lancer
trois commandes : [MISE-EN-LIGNE.md](MISE-EN-LIGNE.md).

| Brique | État |
|---|---|
| Porte d'entrée par mot de passe | `src/auth.js` — cookie signé HMAC, sans dépendance ; 8 tests |
| Garde-fou | `src/server.js` **refuse de démarrer** en écoute publique sans mot de passe |
| Collecte en ligne | `src/planificateur.js` — toutes les 6 h depuis le serveur, activé par `COLLECTE_AUTO=1` |
| Conteneur | `Dockerfile`, `.dockerignore`, `fly.toml`, volume `/data` |
| Amorçage | `scripts/amorcer-base.js` — recopie la base dans le volume au 1ᵉʳ démarrage, n'écrase jamais |

> ⚠️ **Une fois en ligne, désactiver la tâche Windows.** Sinon elle continue de
> remplir une base LOCALE que plus personne ne regarde, et le suivi de
> candidatures se scinde en deux.

Le socle **multi-comptes** (Supabase, §5) reste suspendu, et c'est cohérent :
un mot de passe unique suffit à un utilisateur unique. Le jour où quelqu'un
d'autre doit avoir son propre accès, c'est §5 qu'on reprend — pas `auth.js`
qu'on étend.

---

## 3. Les décisions déjà prises — ne pas les relitiger

1. **Une collecte n'écrit QUE dans la table `offers`.** Statuts, notes,
   relances et épingles survivent à tout. C'est la garantie centrale du
   projet, verrouillée par des tests dédiés.
2. **Les offres sont enregistrées AVANT d'être analysées.** La récolte ne doit
   dépendre d'aucun service extérieur — une panne Gemini ne doit plus coûter
   la moisson entière.
3. **Pas de gamification.** Niveaux, points, succès et quêtes ont été retirés :
   l'outil sert à candidater, pas à collectionner. Seul reste un objectif
   hebdomadaire.
4. **Le CV part dans son `.docx` d'origine**, octet pour octet. Le texte
   extrait sert à nourrir l'analyse, jamais à être envoyé.
5. **Pas de scraping.** Indeed n'a plus d'API publique et ses conditions
   l'interdisent : `src/sources/indeed.js` reste inerte. On ne contourne pas.
6. **Le scoring se règle dans `profile.json`**, jamais dans `src/scoring.js`.
7. **Les dates sont calculées en heure locale**, jamais en UTC.

---

## 4. Les limites connues, à ne pas prendre pour des bugs

- **Le quota Gemini gratuit ne couvre pas 264 offres.** Il est JOURNALIER et
  PARTAGÉ entre l'analyse des offres et la rédaction des lettres. Chaque
  collecte s'arrête donc à **25 analyses** (réglable par `analysesParCollecte`
  dans `profile.json`), pour en garder aux lettres — qui valent bien plus
  qu'un verdict sur une offre jamais lue. Les offres non analysées restent en
  base et passeront aux collectes suivantes, prioritaires d'abord.
- **Avast désactive les tâches planifiées, et peut viser l'exécutable.**
  Trois tâches créées le 1ᵉʳ août 2026 — `JobCockpit - collecte`,
  `JobCockpit - serveur`, `Job Cockpit` — sont passées en *Disabled* peu après
  avoir tourné. C'est l'optimiseur de démarrage d'Avast : il désactive ce qui
  se lance à l'ouverture de session pour « accélérer le démarrage ». Le journal
  du planificateur Windows étant désactivé sur cette machine, rien ne le
  signalait. **Contourné** par un raccourci dans le dossier *Démarrage*, qui ne
  dépend d'aucune stratégie de tâches.
  Le second risque n'est pas encore survenu mais reste ouvert :
  `JobCockpit.exe` n'est **pas signé** (l'injection invalide la signature de
  node.exe), il est inédit, pèse 92 Mo et ouvre des centaines de connexions par
  collecte — le portrait type de ce que CyberCapture met en quarantaine.
  **À faire par Benjamin** : exclure le dossier de l'application dans Avast.
  Aucun script du projet ne doit toucher aux réglages de l'antivirus.
- **Copier `data.db` seul donne une base périmée.** SQLite tourne en mode WAL :
  les écritures récentes vivent dans `data.db-wal` tant qu'elles ne sont pas
  intégrées. Constaté le 1ᵉʳ août 2026 en éprouvant l'exécutable — la copie
  servait **881 offres au lieu de 279**, un état vieux de plusieurs heures, et
  rien ne le signalait. Pour sauvegarder : **arrêter l'application d'abord**
  (la fermeture propre intègre le WAL), ou copier les trois fichiers ensemble
  — `data.db`, `data.db-wal`, `data.db-shm`.
- **Les mots-clés se comportent à l'INVERSE selon la source.** France Travail
  exige tous les mots — « chargé de développement EnR » y renvoyait 0 offre.
  Jooble et Adzuna font de la correspondance floue — « chef de projet énergie »
  leur fait remonter « Chef de projet MOE bâtiment ». Un mot-clé jugé sur une
  seule source trompe : « foncier » gardait 40 % de ses offres sur France
  Travail, mais **6 % sur Jooble**. Toute modification des `intitules` doit être
  mesurée sur les trois, en taux de survie — la part des offres qui passe les
  filtres au lieu d'être supprimée. Mesuré ainsi le 1ᵉʳ août 2026 : 7 mots-clés
  bien choisis suppriment 509 offres là où 10 choisis à l'intuition en
  supprimaient 837, pour davantage de prioritaires.
- **Le piège de la batterie, sur les tâches planifiées.** Windows applique par
  défaut « ne pas démarrer sur batterie » et « arrêter si on passe sur
  batterie ». Sur un portable, la collecte est donc **refusée en silence** dès
  que la machine est débranchée : le 30 juillet 2026, **4 exécutions manquées
  en une journée**, sans une ligne dans `collect.log` — il n'est écrit qu'au
  démarrage d'une collecte. Corrigé par `-AllowStartIfOnBatteries` et
  `-DontStopIfGoingOnBatteries` sur les deux tâches. Le seul endroit où ça se
  voit :
  `Get-ScheduledTaskInfo -TaskName "JobCockpit - collecte" | Select LastRunTime, NumberOfMissedRuns`
- **Emploi-Environnement est mort.** Son flux `gestion_offre/rss.php4` répond
  HTTP 404 depuis le 29 juillet 2026 au soir ; il a été retiré des flux. La
  perte est faible : il tronquait ses descriptions à ~150 caractères et abîmait
  ses accents *à la source*. Utile pour repérer, jamais pour analyser.
- **Careerjet a été RETIRÉ du projet** le 1ᵉʳ août 2026 — code, tests,
  variables d'environnement et documentation. Leur programme délivre une clé
  « par site web éditeur », c'est-à-dire un site qui rediffuse leurs offres à
  ses visiteurs : Job Cockpit, outil privé qui ne publie rien, n'entre pas dans
  ce cadre, et le formulaire refusait l'URL du dépôt. Sa valeur annoncée —
  couvrir APEC, HelloWork, Meteojob, Jobijoba — est de toute façon **déjà
  assurée par Jooble**. Ne pas le réintroduire sans que ces deux points aient
  changé.
- **Jooble annonce un plafond de 500 requêtes.** Une collecte l'interroge 25
  fois (5 intitulés × 4 villes + passe nationale), soit ~100 appels par jour à
  4 collectes. Si les 500 sont un total et non un quota journalier, la source
  s'éteindra en cinq jours. À surveiller dans `collect.log`.
- **Un flux ne renvoie que ses 20 entrées les plus récentes.** D'où le
  découpage par département plutôt que par région.
- **France Travail exige `minCreationDate` ET `maxCreationDate` ensemble.**
  L'adaptateur n'envoyait que la borne basse : l'API répondait HTTP 400 à
  *chaque* requête, et la source n'a donc jamais rien remonté avant le
  29 juillet 2026 au soir. Le bug avait survécu parce que les tests ne
  vérifiaient que la conversion des offres reçues, jamais l'URL construite —
  c'est corrigé, la requête est désormais testée.
  L'API accepte une borne haute dans le futur : elle est posée à J+1, pour
  qu'une horloge locale en retard ne fasse pas disparaître les offres du jour.

---

## 5. Mise en ligne et comptes — chantier en cours

Décidé le 29 juillet 2026 : **Supabase** (comptes + base + fichiers) et
**Cloudflare** (hébergement), c'est-à-dire le socle qui fait déjà tourner
Méridien (<https://meridien-veille.pages.dev>).

### 5.1 L'architecture retenue

| Brique | Où | Pourquoi |
|---|---|---|
| Interface | Cloudflare (statique) | déjà en place pour Méridien, gratuit |
| Comptes | Supabase Auth | inscription, mot de passe oublié, sessions : **ne jamais écrire ça soi-même** |
| Données | Supabase Postgres | RLS = cloisonnement appliqué par la base, pas par le code |
| CV | Supabase Storage | seau privé, un dossier par compte |
| Collecte | *à trancher* — §5.4 | c'est le seul point qui coince |

### 5.2 Le cloisonnement, et pourquoi RLS

`supabase/migrations/0001_socle_multi_comptes.sql` porte tout le schéma.

Chaque table a un `user_id`, et une politique **RLS** qui limite chaque
requête aux lignes du compte connecté. La différence avec un filtre écrit
dans le code est décisive : une requête qui oublie son `WHERE user_id = …`
ne renvoie **rien** au lieu de tout renvoyer. La faute est visible tout de
suite, au lieu d'exposer silencieusement les candidatures des autres.

Deux conséquences heureuses :

- **La suppression de compte est gratuite.** Tout est en
  `on delete cascade` depuis `auth.users` : effacer le compte efface offres,
  suivi, lettres, journal, réglages et CV. C'est ce que le RGPD exige.
- **L'identifiant d'offre reste un hachage du contenu**, donc deux comptes
  peuvent collecter la même offre. La clé primaire est le couple
  `(user_id, id)` — sans ça, le second collecteur écraserait le premier.

### 5.3 La limite Cloudflare qu'il faut connaître

Vérifié sur la documentation officielle le 29 juillet 2026 :

| | Gratuit | Payant (5 $/mois) |
|---|---|---|
| CPU par exécution | **10 ms** | 30 s |
| Requêtes sortantes par exécution | **50** | 10 000 |

**La collecte ne tient pas dans le plan gratuit** : 31 flux à analyser, plus
les appels Gemini. Ni les 10 ms de CPU, ni les 50 requêtes.

### 5.4 Décision en attente : où tourne la collecte

| Option | Coût | Conséquence |
|---|---|---|
| **A — la collecte reste sur le PC** | 0 € | L'app est en ligne, consultable du téléphone ; mais le PC doit être allumé pour que les offres arrivent. La tâche Windows actuelle continue, en écrivant vers Supabase au lieu du fichier local. |
| **B — Workers payant** | 5 $/mois | Tout est dans le cloud. Le PC ne sert plus à rien. |

> Le travail est **le même dans les deux cas** jusqu'à la dernière étape :
> schéma, comptes, interface, portage des données. La bifurcation n'arrive
> qu'au moment de déplacer la collecte. Rien n'oblige à trancher maintenant.

### 5.5 Ce que Benjamin doit créer — rien ne peut avancer sans

Je ne crée pas de comptes à sa place (ni ne saisis de mot de passe).

1. **Un projet Supabase** sur <https://supabase.com/dashboard> — gratuit.
   Région : *Europe (Paris ou Frankfurt)*, pour que les données restent en UE.
2. Dans **SQL Editor**, coller et exécuter
   `supabase/migrations/0001_socle_multi_comptes.sql`.
3. Me transmettre, depuis *Project Settings → API* :
   - l'**URL du projet** (publique, sans risque) ;
   - la clé **anon / publishable** (publique elle aussi : c'est RLS qui
     protège, pas le secret de cette clé).
4. **Ne jamais me transmettre la clé `service_role`.** Elle contourne RLS.
   Si la collecte passe un jour dans un Worker, elle s'y déposera par
   `wrangler secret put`, sans passer par la conversation.

### 5.6 Les étapes, dans l'ordre

- [x] Schéma Postgres + RLS + suppression en cascade
- [ ] Projet Supabase créé, schéma appliqué *(Benjamin)*
- [ ] Écran de connexion et portage de l'interface vers Supabase
- [ ] Import des 264 offres locales vers le compte de Benjamin
- [ ] Mise en ligne sur Cloudflare
- [ ] Téléversement du CV par compte
- [ ] Clés d'API par compte, chiffrées
- [ ] Décision A ou B sur la collecte *(§5.4)*

### 5.7 Ce à quoi il faudra penser avant d'ouvrir à d'autres

Tant que Benjamin est seul utilisateur, ces points peuvent attendre. Le jour
où quelqu'un d'autre crée un compte, ils deviennent obligatoires :

- une **page de confidentialité** : quelles données, pourquoi, combien de
  temps, comment les supprimer ;
- le **quota Gemini est par clé** — soit chacun apporte la sienne, soit
  Benjamin paie pour tout le monde ;
- les **conditions d'Adzuna et de France Travail** encadrent la
  redistribution de leurs données : à relire avant d'ouvrir le service.
---

## 6. Pistes ouvertes, par ordre d'intérêt

1. **Récupérer le suivi de candidatures depuis Dropbox** — les offres et les
   flux sont reconstitués, mais les statuts, notes et lettres déjà rédigées de
   l'autre poste ne se recollectent pas.
2. **Vérifier la qualité des lettres** sur une offre réelle, une fois le quota
   Gemini reparti. Le prompt vient d'être durci contre les compétences
   inventées (§7).
3. **Export PDF** du suivi de candidatures.
4. **Élargir les flux du Service Public** — 5 filières exploitées sur 29.

---

## 8. Les onglets de villes

La vue Offres s'ouvre sur cinq onglets : **Strasbourg · Nancy · Lyon · Paris ·
Autre**. La partition est complète — rien n'est masqué, ce qui n'est rattaché à
aucune ville prioritaire tombe dans « Autre ».

Le rattachement vit dans `src/zone.js`, en trois passes du plus sûr au plus
large : nom de commune, puis zone limitrophe déclarée dans `profile.json`, puis
département. Un nom explicite l'emporte donc toujours sur une simple
coïncidence de département.

Trois points qui ont leur raison d'être :

- **Il est calculé à la lecture, pas stocké.** Les offres déjà en base se rangent
  dans leur onglet sans attendre une collecte, et corriger une zone limitrophe
  dans `profile.json` prend effet au rechargement de la page.
- **Les onglets viennent du profil.** Ajouter une ville à `villesPrioritaires`
  crée son onglet ; il n'y a pas de liste de villes dans le code de l'interface.
- **Les compteurs tiennent compte des filtres en cours.** « Nancy 3 » veut dire
  « 3 offres à voir ici avec ce que tu cherches en ce moment » — pas 3 offres
  dont aucune ne s'afficherait.

Dans chaque onglet, le classement par pertinence est inchangé : groupe
(prioritaire → possible → à vérifier → à écarter), puis score décroissant, les
épinglées toujours en tête. L'onglet choisi est conservé d'une session à
l'autre ; à la première visite, c'est le mieux fourni qui s'ouvre.

---

## 9. Le nettoyage des offres hors profil

```bash
npm run nettoyer                 # liste ce qui partirait, ne supprime rien
npm run nettoyer -- --appliquer  # supprime pour de bon
npm run nettoyer -- --ecartees   # ignore les verdicts, ne garde que le groupe 3
```

Deux motifs de retrait, du plus sûr au plus discutable :

1. **groupe 3** — le classement déterministe les a écartées (motif éliminatoire,
   ou score sous le seuil) ;
2. **verdict négatif** — l'analyse du contenu commence par un refus alors que
   les mots-clés les avaient bien notées. C'est le cas intéressant : une offre
   à 14 points que Gemini résume par « passe ton chemin ». Le verdict fait
   autorité, les cartes le disaient déjà à l'écran.

**Une offre portant la moindre trace de travail n'est jamais supprimée** :
statut autre que « À postuler », date d'envoi, relance, note, épingle, lettre,
ou saisie à la main. C'est la même garantie que la purge automatique, et elles
partagent désormais la même condition SQL — deux copies auraient fini par
diverger, et la copie oubliée aurait effacé une candidature suivie.
Verrouillé par `test/db-hors-profil.test.js`.

La simulation est le comportement par défaut : une suppression est
irrécupérable, elle ne doit pas être ce que fait une commande lancée par erreur.

### Le rendre automatique

Une collecte ratisse large exprès. Constaté le 1ᵉʳ août 2026 : **une seule
passe a remis 300 offres du groupe 3** dans une base qu'on venait de nettoyer.
Sans balayage automatique, `npm run nettoyer` devient une corvée sans fin.

Une ligne à la racine de `profile.json` :

```json
"nettoyageAutomatique": true
```

**Désactivé par défaut, et c'est délibéré** : l'activer sans le savoir viderait
l'onglet « 🔴 À écarter » de son contenu. Les protections sont les mêmes que
partout — verrouillé par trois tests dans `test/collect.test.js`, dont un qui
vérifie qu'une simple note suffit à mettre une offre à l'abri du balayage
automatique. C'est le chemin le plus dangereux du projet, puisqu'il s'exécute
sans que personne ne regarde.

### Reclasser ce qui est déjà en base

Le classement est calculé à la collecte **puis stocké**. Modifier un seuil ou
un motif ne change donc rien aux offres déjà ramenées — on ajuste les règles
sans rien voir bouger. D'où :

```bash
npm run reclasser                 # montre ce qui bougerait
npm run reclasser -- --appliquer
```

Il n'écrit que dans les colonnes de classement : ni statut, ni note, ni
relance, ni lettre.

---

## 10. Les 30 flux RSS, reconstitués

`profile.json` avait perdu ses flux. Ils ont été refaits le 29 juillet 2026 au
soir d'après la recette de [REPRISE.md §12.2](REPRISE.md), et **chacun a été
appelé avant d'être écrit** — 30 répondent, 472 entrées au total.

Le découpage, inchangé, tient au fait qu'**un flux ne rend que ses 20 entrées
les plus récentes** :

- **20 flux par département** — 5 filières × Bas-Rhin (236), Meurthe-et-Moselle
  (298), Rhône (336), Paris (284). Ils portent une `zone`, qui situe les offres
  dont l'entrée n'a pas d'adresse.
- **9 flux par région** — 3 filières × Grand Est (196), Auvergne-Rhône-Alpes
  (198), Île-de-France (208), pour rattraper les départements limitrophes.
  **Pas de `zone` sur ceux-là** : « Grand Est » ne correspond à aucune
  `zonesProches` du profil, l'annoncer ne situerait rien. Leurs entrées sont
  situées par leur propre adresse.
- **1 flux employeur** — Carrières TotalEnergies.

Les 5 filières et leurs identifiants : affaires juridiques (3504), aménagement
et développement durable du territoire (3506), environnement (3514),
agriculture (3505), direction et pilotage des politiques publiques (3512).
Le catalogue complet des filtres est en commentaire dans `profile.json`.

Rendement mesuré à blanc juste après :

```
268 offres distinctes · 257 retenues
🟢 136 prioritaires · 🟡 85 possibles · ⚪ 20 à vérifier · 🔴 16 à écarter
Paris 84 · Lyon 60 · Autre 57 · Strasbourg 31 · Nancy 25
```

136 prioritaires : exactement le chiffre relevé lors du premier essai à 31 flux.

---

## 11. Journal des mises à jour

| Date | Ce qui a changé |
|---|---|
| **29 juil. 2026 (soir)** | **Mise en ligne préparée** : mot de passe, garde-fou anti-exposition, collecte intégrée au serveur, conteneur et volume Fly — voir [MISE-EN-LIGNE.md](MISE-EN-LIGNE.md) |
| **29 juil. 2026 (soir)** | **30 flux RSS reconstitués** (§10) et base repeuplée à 258 offres ; tâche planifiée recréée et éprouvée ; découverte du second poste sous Dropbox ; Emploi-Environnement retiré (404) |
| **29 juil. 2026 (soir)** | **France Travail branché** — et correction du bug qui faisait échouer 100 % de ses requêtes (bornes de date dépendantes, §4) ; copie locale remise au niveau de GitHub ; onglets de villes (§8) ; nettoyage hors profil (§9) ; interface désencombrée et échelle élargie ; correction d'un `fete is not defined` qui cassait la touche Échap, et de `celebrer` jamais importé |
| 29 juil. 2026 | Budget d'analyses par collecte, pour ne plus vider le quota Gemini réservé aux lettres ; chantier multi-comptes suspendu |
| 29 juil. 2026 | Socle multi-comptes : schéma Postgres + RLS + suppression en cascade ; architecture Supabase/Cloudflare arrêtée |
| 29 juil. 2026 | Titre d'offre cliquable vers l'annonce ; garde-fous anti-invention dans les lettres (plus d'« expertise agronomique ») ; création de ce document |
| 29 juil. 2026 | Dépôt publié sur GitHub, historique purgé ; collecte automatique toutes les 6 h ; 31 flux ; première vraie collecte (264 offres) ; correction du bug qui perdait la moisson en cas de panne d'analyse |
| 29 juil. 2026 | CV joint en pièce jointe ; lettres étoffées ; gamification retirée ; 9 vues → 6 |
| 28 juil. 2026 | Tableau de bord, statistiques, sources Careerjet et RSS |

*Détail de chaque session dans [REPRISE.md](REPRISE.md).*
