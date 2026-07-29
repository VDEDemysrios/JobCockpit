# Job Cockpit — état des lieux

> **Le document à lire en premier.** Il dit où en est le projet, ce qui reste
> à faire, et pourquoi les choses sont comme elles sont.
>
> **Il est mis à jour à chaque session de travail.** Le journal détaillé des
> sessions passées vit dans [REPRISE.md](REPRISE.md) ; ici, seul l'état
> courant. En cas de contradiction, ce document a raison.

**Dernière mise à jour : 29 juillet 2026**
**État : 163 tests passent · 264 offres en base · dépôt publié**

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
| Collecte automatique toutes les 6 h | tâche Windows « JobCockpit - collecte », sans fenêtre |
| Sources | 31 flux RSS + Adzuna ; **264 offres en base**, 135 prioritaires |
| Classement et zone | scoring déterministe réglable dans `profile.json` |
| Analyse des offres | Gemini, **bridée par le quota gratuit** (§4) |
| Lettres de motivation | 650–800 mots, adaptées à l'annonce, garde-fous anti-invention |
| Dossier de candidature | `.zip` = lettre + CV d'origine, en un clic |
| Vue « Mon CV » | document joint + couverture des mots-clés |
| Interface | 6 vues, 4 thèmes, palette `Ctrl+K` ; gamification retirée |
| Lien vers l'annonce | **le titre de chaque offre est cliquable** |
| Dépôt public | historique purgé de toute donnée personnelle |

### 🔑 En attente de Benjamin — rien ne bouge sans lui

| Quoi | Pourquoi ça bloque | Ce qu'il faut faire |
|---|---|---|
| **France Travail** | le formulaire exige une URL publique | donner l'URL du dépôt GitHub, puis **souscrire à l'API « Offres d'emploi v2 »** (étape distincte, toujours oubliée) |
| **Careerjet** | clé gratuite non demandée | compte sur careerjet.com/partners/api |
| **Jooble** | clé sur demande | fr.jooble.org/api/about |

> Benjamin a indiqué qu'il ajouterait **les sites d'emploi en dernier**. Ce
> n'est donc pas la priorité du moment.

### ⏸️ Mis en pause, par décision de Benjamin

| Chantier | État | Où |
|---|---|---|
| **Mise en ligne + comptes** | **suspendu le 29 juil. 2026** — « cockpit que pour moi pour le moment ». Le schéma Postgres est écrit et conservé, prêt à servir. | §5 |

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
- **Emploi-Environnement tronque ses descriptions** à ~150 caractères et abîme
  ses accents *à la source*. Utile pour repérer, pas pour analyser.
- **Careerjet n'a jamais été testé en vrai** — pas de clé. Le code existe.
- **Un flux ne renvoie que ses 20 entrées les plus récentes.** D'où le
  découpage par département plutôt que par région.

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

1. **Brancher France Travail** — la source la plus riche, débloquée par la
   publication du dépôt.
2. **Vérifier la qualité des lettres** sur une offre réelle, une fois le quota
   Gemini reparti. Le prompt vient d'être durci contre les compétences
   inventées (§7).
3. **Export PDF** du suivi de candidatures.
4. **Élargir les flux du Service Public** — 5 filières exploitées sur 29.

---

## 7. Journal des mises à jour

| Date | Ce qui a changé |
|---|---|
| **29 juil. 2026** | Budget d'analyses par collecte, pour ne plus vider le quota Gemini réservé aux lettres ; chantier multi-comptes suspendu |
| 29 juil. 2026 | Socle multi-comptes : schéma Postgres + RLS + suppression en cascade ; architecture Supabase/Cloudflare arrêtée |
| 29 juil. 2026 | Titre d'offre cliquable vers l'annonce ; garde-fous anti-invention dans les lettres (plus d'« expertise agronomique ») ; création de ce document |
| 29 juil. 2026 | Dépôt publié sur GitHub, historique purgé ; collecte automatique toutes les 6 h ; 31 flux ; première vraie collecte (264 offres) ; correction du bug qui perdait la moisson en cas de panne d'analyse |
| 29 juil. 2026 | CV joint en pièce jointe ; lettres étoffées ; gamification retirée ; 9 vues → 6 |
| 28 juil. 2026 | Tableau de bord, statistiques, sources Careerjet et RSS |

*Détail de chaque session dans [REPRISE.md](REPRISE.md).*
