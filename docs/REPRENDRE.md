# Reprendre le développement sur une autre machine

> Ce document s'adresse à qui reprend le code — sur un autre ordinateur, ou
> après une longue pause. Pour **utiliser** l'application, c'est le
> [README](../README.md) qu'il faut lire ; pour l'**héberger**, c'est
> [MISE-EN-LIGNE.md](MISE-EN-LIGNE.md).

**Version publiée : 1.5.0** · 419 tests, 0 échec.

---

## 1. Installer, en cinq minutes

Il faut **Node.js 22 ou plus récent**. La version 20 suffit à faire tourner le
code, mais `node:sqlite` y est encore expérimental et affiche un avertissement
à chaque démarrage.

```bash
git clone https://github.com/VDEDemysrios/JobCockpit.git
cd JobCockpit
npm ci
npm test
npm start
```

Puis <http://localhost:3000>. Au premier lancement, une page d'installation
pose quatre questions et écrit `.env` et `profile/profile.json` à ta place.

---

## 2. Ce qui n'est PAS dans le dépôt — et c'est voulu

Cloner suffit à faire tourner l'application, mais **pas à retrouver tes
données**. Quatre choses restent sur l'ancienne machine :

| Fichier | Contenu | Comment le retrouver |
|---|---|---|
| `.env` | tes clés d'API | la page d'installation le recrée, ou recopie-le |
| `profile/profile.json` | ton nom, tes villes, tes critères, tes flux RSS | recréé par la page d'installation ; `profile.example.json` en montre la forme |
| `profile/cv-source.docx` + `cv.txt` | ton CV | dépose-le dans l'application, ou `npm run extract-cv -- "chemin/CV.docx"` |
| `data.db` | **offres, suivi, lettres, entretiens** | à recopier à la main (voir plus bas) |

> **Pourquoi cette exclusion.** Le `.gitignore` porte la trace d'une fuite
> réelle : un `git add -A` a poussé 1,4 Mo de base — offres, lettre et suivi de
> candidature — sur le dépôt **public**, et c'est resté en ligne plusieurs
> commits sans que rien ne le signale. Depuis, tout ce qui commence par
> `data.db` est couvert. Ne jamais desserrer ces motifs.

### Emporter ses données d'un poste à l'autre

`data.db` est un fichier SQLite unique : il se copie. **Arrête l'application
avant**, sinon les fichiers `data.db-wal` et `data.db-shm` contiennent des
écritures non encore intégrées.

```bash
npm start   # à l'arrêt, l'application intègre le journal WAL
```

Puis copie `data.db` (et rien d'autre) vers le même emplacement sur la
nouvelle machine. Copie aussi `.env`, `profile/profile.json` et
`profile/cv-source.docx` si tu ne veux pas les ressaisir.

L'application garde par ailleurs des sauvegardes automatiques :

```bash
npm run sauvegardes
```

---

## 3. Où en est le projet

### Fait

- Collecte automatique, toutes les 6 heures, sans fenêtre — tâche planifiée
  Windows créée par `npm run installer`.
- **31 flux RSS** + Adzuna. La meilleure source est *Choisir le Service
  Public* : sans clé, filtrable, avec des descriptions complètes.
- Classement déterministe, réglable dans `profile/profile.json` — jamais dans
  `src/scoring.js`.
- Analyse des offres et rédaction de lettres par Gemini.
- Dossier de candidature : lettre + CV d'origine, en un `.zip`.
- Préparation d'entretien : simulation, débriefing, fiche, cartes de révision.
- Onglet Chill : Spotify, Twitch, YouTube, jeux.
- Chaîne d'intégration qui **construit et publie** l'exécutable Windows.

### En attente d'une action humaine

| Quoi | Pourquoi ça bloque |
|---|---|
| Clés **France Travail** | le formulaire exige une URL publique — donner celle du dépôt — puis une **souscription séparée** à l'API « Offres d'emploi v2 », sans laquelle tout finit en 401 |
| Clé **Jooble** | sur demande, réponse sous 24 h |
| Clés **Chill** | Spotify, Twitch, YouTube — facultatives |
| Signature **SignPath** | l'étape se saute tant que les secrets ne sont pas configurés ; Windows affiche donc un avertissement au premier lancement |

### Chantier suspendu

Le **multi-utilisateurs** (comptes, CV par profil, suppression de compte) a été
cadré puis mis en pause : « cockpit que pour moi pour le moment ». Le schéma
Postgres avec cloisonnement RLS avait été écrit ; il n'est plus dans le dépôt,
mais l'historique le contient.

---

## 4. Les décisions à ne pas relitiger

Chacune est verrouillée par au moins un test.

1. **Une collecte n'écrit QUE dans `offers`.** Statuts, notes, relances et
   épingles survivent à tout. C'est la garantie centrale du projet.
2. **Les offres sont enregistrées AVANT d'être analysées.** L'ordre inverse a
   coûté quarante minutes de collecte le jour où le quota Gemini s'est épuisé
   en cours de route : la moisson entière avait été perdue.
3. **L'analyse est plafonnée par collecte** (`analysesParCollecte`, 25 par
   défaut). Le quota Gemini est journalier et partagé avec les lettres — et
   une lettre vaut plus qu'un verdict sur une offre jamais lue.
4. **Supprimer une offre l'inscrit dans `rejetees`.** L'identifiant est un
   hachage du contenu : sans cette liste, une offre supprimée revient à
   l'identique à la collecte suivante. C'est arrivé — 415 offres nettoyées,
   276 revenues six heures plus tard.
5. **Le CV part dans son `.docx` d'origine**, octet pour octet. Le texte
   extrait ne sert qu'à nourrir l'analyse.
6. **Pas de scraping.** Indeed n'a plus d'API publique et ses conditions
   l'interdisent : `src/sources/indeed.js` reste un emplacement inerte.
7. **Les dates sont calculées en heure locale**, jamais en UTC.
8. **Pas de backtick dans le gabarit SQL de `db.js`** — il est à l'intérieur
   d'un littéral JavaScript qu'il refermerait.

---

## 5. Publier une version

Tout part d'une étiquette. La chaîne construit l'exécutable sur une machine
neuve, vérifie qu'il démarre, contrôle qu'aucune donnée personnelle n'est
embarquée, calcule l'empreinte SHA-256, puis **crée la release**.

```bash
# 1. le numéro de version dans package.json
# 2. les notes, lues par la chaîne :
#    docs/versions/<version>.md
git tag -a v1.6.0 -F docs/versions/1.6.0.md
git push origin main v1.6.0
```

### Trois pièges, payés comptant

- **Les notes ne viennent pas de l'étiquette.** `actions/checkout` recrée les
  étiquettes en version *allégée*, et `git tag --format='%(contents)'` renvoie
  alors le message du **commit**. Une version est sortie avec un texte
  technique à la place de ses notes. D'où le fichier versionné.
- **Supprimer une étiquette fait repasser sa release en brouillon.** La mise à
  jour réussit ensuite sans erreur, et la version reste invisible du public.
  D'où le `--draft=false`.
- **`permissions: contents: write`** est indispensable, sinon la création est
  refusée — et un checkout complet, sinon les étiquettes manquent.

---

## 6. Les limites connues, à ne pas prendre pour des bugs

- **Le quota Gemini gratuit ne couvre pas plusieurs centaines d'offres.** Une
  fois atteint, l'API répond `429` : les offres restent en base, simplement
  sans verdict, et la collecte suivante reprend par les prioritaires.
- **Emploi-Environnement tronque ses descriptions** à ~150 caractères et abîme
  ses accents *à la source*.
- **Un flux RSS ne renvoie que ses 20 entrées les plus récentes.** D'où le
  découpage par département plutôt que par région.
- **La plupart des job boards français ont fermé leurs flux** — Indeed, APEC,
  Cadremploi, Jobijoba, Meteojob, Welcome to the Jungle. Inutile de chercher.
