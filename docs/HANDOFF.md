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

### 🚧 Demandé, pas encore commencé

| Chantier | Taille | Où c'est décrit |
|---|---|---|
| **Comptes et multi-utilisateurs** | très gros — change l'architecture | §5 |

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

- **Le quota Gemini gratuit ne couvre pas 264 offres.** Environ 40 analyses
  par jour passent, puis l'API répond `429`. Les offres sont bien en base,
  simplement sans verdict ; chaque collecte reprend où la précédente s'est
  arrêtée, en commençant par les prioritaires. Passer au palier payant, ou
  accepter le rythme.
- **Emploi-Environnement tronque ses descriptions** à ~150 caractères et abîme
  ses accents *à la source*. Utile pour repérer, pas pour analyser.
- **Careerjet n'a jamais été testé en vrai** — pas de clé. Le code existe.
- **Un flux ne renvoie que ses 20 entrées les plus récentes.** D'où le
  découpage par département plutôt que par région.

---

## 5. Comptes et multi-utilisateurs — demandé le 29 juillet 2026

Benjamin veut pouvoir ouvrir le site à d'autres personnes : compte, import de
son propre CV, suppression de compte, offres correspondant à son profil, et
raccordement de ses propres accès France Travail / Adzuna / Indeed.

**Ce n'est pas une fonctionnalité, c'est un changement de nature du projet.**
Aujourd'hui Job Cockpit est un outil **local, mono-utilisateur, sans
authentification**, dont la base contient un seul profil. Le rendre
multi-utilisateur touche à tout :

| Ce que ça implique | Pourquoi c'est du travail |
|---|---|
| Authentification | inscription, connexion, mot de passe oublié, sessions |
| Cloisonnement des données | chaque table gagne un `user_id` ; **une fuite entre comptes serait grave** |
| CV par compte | téléversement, stockage, extraction, suppression |
| Clés d'API par compte | des **secrets de tiers** à chiffrer au repos — plus seulement un `.env` |
| Suppression de compte | effacer *tout* : offres, suivi, lettres, CV, clés |
| Hébergement | le poste de Benjamin ne suffit plus ; il faut un serveur, un nom de domaine, HTTPS |
| Obligations légales | données personnelles de tiers : RGPD, mentions, durée de conservation |
| Coût | le quota Gemini est **par clé** : soit chacun apporte la sienne, soit Benjamin paie pour tous |

**Décisions nécessaires avant d'écrire la moindre ligne** — elles n'ont pas
encore été prises :

1. **Pour qui ?** Trois amis, ou un service ouvert ? La réponse change tout.
2. **Où l'héberger ?**
3. **Qui paie l'analyse Gemini ?**
4. **Chacun apporte-t-il ses propres clés d'API**, ou partage-t-on celles de
   Benjamin ? (Les conditions d'Adzuna et de France Travail encadrent la
   redistribution — à vérifier avant de choisir.)

> **Recommandation.** Ne pas se lancer tant que ces quatre points ne sont pas
> tranchés. Et si le besoin réel est « faire essayer à deux ou trois
> personnes », une piste bien plus économe existe : garder l'application
> mono-utilisateur et la faire installer chez chacun — le dépôt est public,
> le `Lancer Job Cockpit.bat` est déjà là. Zéro serveur, zéro RGPD, zéro
> secret de tiers à protéger.

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
| **29 juil. 2026** | Titre d'offre cliquable vers l'annonce ; garde-fous anti-invention dans les lettres (plus d'« expertise agronomique ») ; création de ce document |
| 29 juil. 2026 | Dépôt publié sur GitHub, historique purgé ; collecte automatique toutes les 6 h ; 31 flux ; première vraie collecte (264 offres) ; correction du bug qui perdait la moisson en cas de panne d'analyse |
| 29 juil. 2026 | CV joint en pièce jointe ; lettres étoffées ; gamification retirée ; 9 vues → 6 |
| 28 juil. 2026 | Tableau de bord, statistiques, sources Careerjet et RSS |

*Détail de chaque session dans [REPRISE.md](REPRISE.md).*
