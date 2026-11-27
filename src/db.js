// Accès à la base SQLite.
//
// La table `tracking` contient les données personnelles de l'auteur
// (statuts, notes, relances, épingles) : elle n'est JAMAIS écrite par une
// collecte. C'est la garantie la plus importante du projet, verrouillée par
// des tests dédiés dans test/db-upsert.test.js et test/collect.test.js.
//
// node:sqlite est INTÉGRÉ à Node.js 22+ — aucune dépendance à installer,
// aucune compilation. Deux différences avec better-sqlite3 :
//   - pas d'aide db.transaction()  -> helper transaction() ci-dessous
//   - typage strict : `undefined` et les booléens sont refusés en paramètre,
//     d'où les `?? null` et `? 1 : 0` systématiques.
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

-- Préparation d'entretien : une séance par offre, conservée.
--
-- Elle est GARDÉE plutôt que jetée à la fermeture : on prépare un entretien
-- sur plusieurs jours, en reprenant là où on s'était arrêté, et le débriefing
-- de la veille est exactement ce qu'on veut relire le matin même. La colonne
-- echanges tient le fil complet en JSON : questions du jury et réponses, dans
-- l'ordre. (Pas d'accent grave dans ce commentaire : il est à l'intérieur
-- d'un gabarit JavaScript, qu'il refermerait.)
CREATE TABLE IF NOT EXISTS entretiens (
  offer_id   TEXT PRIMARY KEY,
  echanges   TEXT,
  debrief    TEXT,
  fiche      TEXT,
  cree_le    TEXT,
  maj_le     TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  cle    TEXT PRIMARY KEY,
  valeur TEXT
);

-- Appels partis chez Gemini, par jour et par usage.
--
-- Google ne dit pas combien il reste de quota : la seule façon de garder de
-- quoi rédiger une lettre est de tenir le compte soi-même, et d'arrêter
-- l'analyse avant d'avoir tout dépensé. Le détail par usage permet de régler
-- la réserve en connaissance de cause plutôt qu'au jugé.
CREATE TABLE IF NOT EXISTS quota_gemini (
  jour   TEXT,               -- AAAA-MM-JJ, en heure locale
  usage  TEXT,               -- analyse | lettre | analyse-fermee
  appels INTEGER DEFAULT 0,
  PRIMARY KEY (jour, usage)
);

-- Offres écartées pour de bon.
--
-- SANS CETTE TABLE, SUPPRIMER NE SERT À RIEN. L'identifiant d'une offre est
-- un hash de son contenu, stable par construction : une offre supprimée que
-- la source publie toujours revient à l'identique à la collecte suivante.
-- C'est exactement ce qui s'est produit le 1er août 2026 — 415 offres
-- nettoyées, 276 revenues six heures plus tard.
--
-- La collecte consulte cette liste et saute ce qui s'y trouve. On garde le
-- motif pour pouvoir revenir en arrière en connaissance de cause.
CREATE TABLE IF NOT EXISTS rejetees (
  offer_id  TEXT PRIMARY KEY,
  motif     TEXT,              -- manuel | sans-reponse | hors-profil
  titre     TEXT,              -- pour relire la liste sans deviner
  rejete_le TEXT
);

-- Jours où l'auteur a fait quelque chose. Alimente la carte d'activité.
CREATE TABLE IF NOT EXISTS activite (
  jour    TEXT PRIMARY KEY,   -- AAAA-MM-JJ
  actions INTEGER DEFAULT 0
);

-- Journal des actions. Alimente les courbes d'activité et le journal.
-- Contrairement à la table « activite » (un simple compteur par jour), il
-- conserve le TYPE et l'HEURE de chaque action : c'est ce qui permet de
-- distinguer « 3 candidatures » de « 3 épinglages » un même jour.
CREATE TABLE IF NOT EXISTS evenements (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  type    TEXT NOT NULL,      -- candidature, relance, lettre, note, ajout…
  offer_id TEXT,
  jour    TEXT NOT NULL,      -- AAAA-MM-JJ, en heure locale
  heure   INTEGER,            -- 0-23, heure locale
  cree_le TEXT,
  meta    TEXT
);

CREATE INDEX IF NOT EXISTS idx_evenements_jour ON evenements(jour);
CREATE INDEX IF NOT EXISTS idx_evenements_type ON evenements(type);

-- LES INDEX QUI MANQUAIENT (chantier 4.0).
--
-- Chaque chargement du tableau de bord filtre le suivi par statut et par date
-- d'envoi, la purge balaie les offres par date d'apparition et par saisie
-- manuelle, la frise rattache les événements à leur offre. Sans index, SQLite
-- parcourait la table entière à chaque fois : invisible à 300 offres, sensible
-- à 3 000, et la base ne fait que grossir. L'index sur la date d'entretien est
-- posé APRÈS la migration des colonnes (voir creerIndexTardifs) : sur une base
-- ancienne, la colonne n'existe pas encore quand ce gabarit s'exécute.
CREATE INDEX IF NOT EXISTS idx_tracking_status    ON tracking(status);
CREATE INDEX IF NOT EXISTS idx_tracking_sent      ON tracking(sent_date);
CREATE INDEX IF NOT EXISTS idx_offers_first_seen  ON offers(first_seen);
CREATE INDEX IF NOT EXISTS idx_offers_is_manual   ON offers(is_manual);
CREATE INDEX IF NOT EXISTS idx_evenements_offre   ON evenements(offer_id);

-- Historique des versions d'une lettre.
--
-- Régénérer écrasait la lettre précédente, retoucher aussi : une bonne
-- formulation perdue en un clic ne se retrouvait jamais. Chaque génération et
-- chaque retouche enregistre désormais une version, numérotée par offre. La
-- table letters garde la version COURANTE ; celle-ci garde le passé.
CREATE TABLE IF NOT EXISTS lettres_versions (
  offer_id TEXT NOT NULL,
  version  INTEGER NOT NULL,
  content  TEXT,
  origine  TEXT,              -- generee | retouche | restauree
  cree_le  TEXT,
  PRIMARY KEY (offer_id, version)
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

  // DURABILITÉ AVANT VITESSE.
  //
  // En mode WAL, SQLite se contente par défaut de `synchronous = NORMAL` : il
  // ne force l'écriture sur le disque qu'aux points de contrôle, pas à chaque
  // validation. C'est le bon compromis pour une base qui encaisse des
  // milliers d'écritures par seconde. Ce n'est pas la nôtre.
  //
  // Ici, une écriture, c'est « j'ai postulé », « entretien le 26 » — quelques
  // dizaines par jour, dans une application qu'on ferme, qu'on met à jour,
  // qu'on relance. Le coût de `FULL` est invisible à ce volume ; le coût
  // d'une candidature perdue ne l'est pas.
  //
  // Motivé par une perte constatée : une date d'entretien écrite et confirmée
  // par l'API, absente de la base après un arrêt suivi d'une mise à jour. Un
  // seul cas, non reproduit — mais sur ces données-là, une explication qui
  // manque ne se paie pas au même prix qu'un peu de lenteur.
  db.exec('PRAGMA synchronous = FULL');

  // ATTENDRE PLUTÔT QUE TOMBER.
  //
  // Deux processus écrivent dans la même base : le serveur, et la tâche
  // Windows qui lance `scripts/collect.js`. Sans délai d'attente, le second à
  // vouloir écrire reçoit aussitôt « database is locked » — une case cochée
  // dans le tableau de bord échouait parce qu'une collecte validait sa
  // transaction à la même milliseconde. Cinq secondes couvrent largement la
  // plus longue de nos écritures.
  db.exec('PRAGMA busy_timeout = 5000');

  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  ajouterColonnesManquantes(db);
  creerIndexTardifs(db);
  return db;
}

/**
 * Les index portant sur des colonnes ajoutées par migration.
 * Ils ne peuvent pas vivre dans le gabarit : sur une base ancienne, le
 * gabarit s'exécute AVANT que la colonne existe, et l'ouverture échouerait.
 */
function creerIndexTardifs(db) {
  db.exec('CREATE INDEX IF NOT EXISTS idx_tracking_entretien ON tracking(entretien_date)');
}

/**
 * Ferme la base proprement.
 *
 * `PRAGMA optimize` d'abord : SQLite y met à jour les statistiques dont son
 * planificateur se sert pour choisir un index, mais seulement pour les tables
 * dont l'usage le justifie. C'est l'appel que la documentation recommande « à
 * la fermeture de chaque connexion » ; sans lui, les index posés plus haut
 * peuvent être ignorés faute de statistiques.
 */
export function fermerBase(db) {
  try { db.exec('PRAGMA optimize'); } catch { /* base déjà fermée ou en lecture seule */ }
  try { db.close(); } catch { /* déjà fermée */ }
}

/**
 * Replie le journal WAL dans la base, et le ramène à zéro.
 *
 * Une collecte écrit des centaines de lignes ; tant qu'aucun point de contrôle
 * complet n'a lieu, `data.db-wal` grossit et chaque lecture doit le parcourir.
 * TRUNCATE ne bloque personne : si un lecteur est en cours, SQLite fait ce
 * qu'il peut et rend la main — d'où l'absence d'erreur à attendre ici.
 */
export function compacterJournal(db) {
  try {
    return db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() ?? null;
  } catch {
    return null;
  }
}

/**
 * Ajoute les colonnes apparues après coup.
 *
 * `CREATE TABLE IF NOT EXISTS` ne touche pas à une table déjà là : sur une
 * base existante, une colonne nouvelle n'apparaîtrait jamais, et la première
 * requête qui l'utilise échouerait. On les ajoute donc une par une, sans
 * bruit si elles sont déjà présentes.
 */
export function ajouterColonnesManquantes(db) {
  const NOUVELLES = [
    // Nombre de villes où la MÊME annonce a été republiée. Voir `fusionner`
    // dans sources/index.js : les cabinets de recrutement diffusent le même
    // texte sur toute la France, et le compte est un signal de qualité.
    ['offers', 'villes_republiees', 'INTEGER DEFAULT 1'],
    // De quoi remettre une offre écartée par erreur : l'offre, son suivi et
    // sa lettre, en JSON. Rempli uniquement pour les rejets manuels.
    ['rejetees', 'donnees', 'TEXT'],
    // Vérification des liens. `lien_mort` n'est posé que sur un 404 ou un 410 :
    // voir l'en-tête de `src/liens.js` pour ce qui a été mesuré sur les offres
    // réelles, et pourquoi rien d'autre ne conclut. `lien_verifie_le` évite de
    // re-sonder ce qu'on vient de voir.
    ['offers', 'lien_verifie_le', 'TEXT'],
    ['offers', 'lien_mort', 'INTEGER DEFAULT 0'],
    // Cartes de révision d'un entretien, en JSON, avec l'avancement : une
    // notion se retient en tentant de la restituer, pas en la relisant.
    ['entretiens', 'notions', 'TEXT'],
    // Les pages réellement consultées par le modèle lors de la recherche
    // ancrée : de quoi aller lire le texte au lieu de croire une définition.
    ['entretiens', 'liens', 'TEXT'],
    // La DATE de l'entretien. Le statut « Entretien » existait sans elle :
    // l'application savait qu'un entretien était décroché, jamais quand il
    // avait lieu. Elle ne pouvait donc ni le rappeler, ni en tirer une
    // urgence — alors que c'est la seule échéance d'une recherche d'emploi
    // qu'on ne peut ni décaler ni rattraper.
    ['tracking', 'entretien_date', 'TEXT'],
  ];
  for (const [table, colonne, type] of NOUVELLES) {
    const existe = db.prepare(`SELECT COUNT(*) n FROM pragma_table_info(?) WHERE name = ?`)
      .get(table, colonne).n;
    if (!existe) db.exec(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${type}`);
  }
}

/**
 * Exécute `fn` dans une transaction, avec annulation en cas d'erreur.
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
      is_manual, villes_republiees, first_seen, last_seen
    ) VALUES (
      @id, @source, @sourcesAll, @externalId, @titre, @entreprise, @ville, @departement,
      @horsZone, @contrat, @dateOffre, @lien, @description, @salaireSource,
      @groupe, @score, @scoreDetail, @analysisJson, @analysisAt,
      @isManual, @villesRepubliees, @maintenant, @maintenant
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
      villes_republiees = excluded.villes_republiees,
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
    villesRepubliees: offre.villesRepubliees ?? 1,
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

/**
 * Enregistre qu'une action a eu lieu aujourd'hui.
 * Alimente le calcul de la série de jours ouvrés consécutifs.
 */
export function noterActivite(db, jour = new Date().toISOString().slice(0, 10)) {
  db.prepare(`
    INSERT INTO activite (jour, actions) VALUES (?, 1)
    ON CONFLICT(jour) DO UPDATE SET actions = actions + 1
  `).run(jour);
}

/** Jours d'activité, du plus récent au plus ancien (400 derniers). */
export function lireJoursActifs(db) {
  return db.prepare('SELECT jour FROM activite ORDER BY jour DESC LIMIT 400')
    .all().map(r => r.jour);
}

/**
 * Journalise une action et note l'activité du jour.
 *
 * Le jour et l'heure sont pris en heure LOCALE, pas en UTC : « j'ai postulé
 * lundi soir » doit compter pour lundi, y compris à 23 h — une conversion UTC
 * l'aurait basculé au mardi et cassé la série d'un jour sur deux en été.
 *
 * `sansActivite` journalise l'action sans compter comme une journée de travail. Épingler, annoter ou
 * lancer une collecte, ce n'est pas « avancer » : compter ces gestes
 * entretiendrait une série sans qu'aucune candidature ne bouge.
 *
 * @param {string} type      candidature | relance | lettre | retouche | note |
 *                           ajout | epingle | statut | entretien | refus | collecte
 * @param {object} [options] { offerId, meta, quand, sansActivite }
 */
export function journaliser(db, type, options = {}) {
  const quand = options.quand instanceof Date ? options.quand : new Date();
  const p = (v) => String(v).padStart(2, '0');
  const jour = `${quand.getFullYear()}-${p(quand.getMonth() + 1)}-${p(quand.getDate())}`;

  db.prepare(`
    INSERT INTO evenements (type, offer_id, jour, heure, cree_le, meta)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(type, options.offerId ?? null, jour, quand.getHours(),
    quand.toISOString(), options.meta ? JSON.stringify(options.meta) : null);

  if (!options.sansActivite) noterActivite(db, jour);
  return jour;
}

/** Types d'action qui ne comptent pas comme une journée de travail. */
export const SANS_ACTIVITE = new Set(['note', 'epingle', 'collecte']);

/**
 * Condition SQL isolant les offres SUPPRIMABLES.
 *
 * Une offre est PROTÉGÉE dès qu'elle porte la moindre trace d'activité :
 * un statut autre que « À postuler », une date d'envoi, une relance, une note,
 * une épingle, une lettre — ou si elle a été ajoutée à la main.
 * En cas de doute, on garde : perdre une offre suivie est irrécupérable,
 * garder une offre morte ne coûte qu'une ligne.
 *
 * Cette condition est partagée par toutes les suppressions automatiques.
 * Deux copies auraient fini par diverger, et la copie oubliée aurait effacé
 * une candidature suivie.
 */
//
// L'ENTRETIEN ÉTAIT OUBLIÉ. La date d'entretien et la table `entretiens`
// sont arrivées après cette condition, et personne ne l'a rouverte : une
// offre « À postuler » portant une date d'entretien saisie d'avance, ou une
// séance de préparation de trois jours, partait au premier ménage — avec les
// cartes de révision qu'on avait payées en quota. Les deux comptent désormais
// comme une trace, et la jointure TRACE_JOINTURES les rend visibles.
const SANS_TRACE = `
  o.is_manual = 0
  AND l.offer_id IS NULL
  AND e.offer_id IS NULL
  AND (
    t.offer_id IS NULL
    OR (
      COALESCE(t.status, 'À postuler') = 'À postuler'
      AND COALESCE(t.sent_date, '')      = ''
      AND COALESCE(t.relance_date, '')   = ''
      AND COALESCE(t.entretien_date, '') = ''
      AND COALESCE(t.notes, '')          = ''
      AND COALESCE(t.pinned, 0)          = 0
    )
  )`;

/** Les jointures que SANS_TRACE suppose : une seule copie, comme elle. */
const TRACE_JOINTURES = `
    LEFT JOIN tracking   t ON t.offer_id = o.id
    LEFT JOIN letters    l ON l.offer_id = o.id
    LEFT JOIN entretiens e ON e.offer_id = o.id`;

/**
 * Supprime les offres désignées, et le suivi vide qui leur reste attaché.
 *
 * `motif` inscrit l'offre dans `rejetees`, ce qui l'empêche de revenir à la
 * collecte suivante. Sans motif, la suppression est simplement définitive
 * pour cette base — utile pour une offre saisie à la main, qu'aucune source
 * ne republiera.
 *
 * @param {string} [motif] manuel | sans-reponse | hors-profil
 */
export function supprimerOffres(db, ids, motif = null) {
  return transaction(db, () => {
    const lireOffre         = db.prepare('SELECT * FROM offers   WHERE id = ?');
    const lireSuivi         = db.prepare('SELECT * FROM tracking WHERE offer_id = ?');
    const lireLettre        = db.prepare('SELECT * FROM letters  WHERE offer_id = ?');
    const lireEntretien     = db.prepare('SELECT * FROM entretiens WHERE offer_id = ?');
    const lireVersions      = db.prepare('SELECT * FROM lettres_versions WHERE offer_id = ? ORDER BY version');
    const rejeter           = db.prepare(`INSERT INTO rejetees (offer_id, motif, titre, rejete_le, donnees)
                                          VALUES (?, ?, ?, ?, ?)
                                          ON CONFLICT(offer_id) DO UPDATE SET
                                            motif = excluded.motif, donnees = excluded.donnees`);
    const supprimerOffre    = db.prepare('DELETE FROM offers   WHERE id = ?');
    const supprimerTracking = db.prepare('DELETE FROM tracking WHERE offer_id = ?');
    const supprimerLettre   = db.prepare('DELETE FROM letters  WHERE offer_id = ?');
    // La séance d'entretien et l'historique des lettres partent AVEC l'offre :
    // laissés derrière, ils restaient en base sans rien pour les rattacher, et
    // une offre restaurée retrouvait son suivi mais plus ses cartes.
    const supprimerEntretien = db.prepare('DELETE FROM entretiens WHERE offer_id = ?');
    const supprimerVersions  = db.prepare('DELETE FROM lettres_versions WHERE offer_id = ?');
    const maintenant = new Date().toISOString();

    for (const id of ids) {
      const offre = lireOffre.get(id);
      if (motif) {
        // ON GARDE DE QUOI REVENIR EN ARRIÈRE — mais seulement pour ce que
        // l'auteur écarte LUI-MÊME. Les suppressions automatiques portent sur
        // des milliers d'offres : conserver chacune ferait grossir la base
        // sans jamais servir, personne ne cherchant à annuler un ménage qu'il
        // n'a pas demandé.
        const donnees = motif === 'manuel' && offre
          ? JSON.stringify({
            offre,
            suivi: lireSuivi.get(id) ?? null,
            lettre: lireLettre.get(id) ?? null,
            entretien: lireEntretien.get(id) ?? null,
            versions: lireVersions.all(id),
          })
          : null;
        rejeter.run(id, motif, offre?.titre ?? null, maintenant, donnees);
      }
      supprimerLettre.run(id);
      supprimerVersions.run(id);
      supprimerEntretien.run(id);
      supprimerTracking.run(id);
      supprimerOffre.run(id);
    }
    return ids.length;
  });
}

/**
 * Remet une offre écartée exactement là où elle était.
 *
 * ÉCARTER SE FAIT EN UN CLIC ; SE TROMPER AUSSI. Sans retour possible, la
 * seule issue était « Tout remettre » dans les Options — qui ramène les 2 500
 * offres du ménage automatique avec la seule qu'on voulait. Autant dire rien.
 *
 * On restaure l'offre, son suivi et sa lettre, puis on efface le rejet : elle
 * redevient collectable. Renvoie `false` si l'offre n'a pas de sauvegarde —
 * une suppression automatique, ou un rejet d'avant cette fonctionnalité.
 */
export function restaurerRejet(db, id) {
  const ligne = db.prepare('SELECT donnees FROM rejetees WHERE offer_id = ?').get(id);
  if (!ligne?.donnees) return false;

  const { offre, suivi, lettre, entretien, versions } = JSON.parse(ligne.donnees);
  if (!offre) return false;

  /** Réinsère une ligne telle qu'elle a été lue, colonne pour colonne. */
  const reinserer = (table, valeurs) => {
    const cs = Object.keys(valeurs);
    db.prepare(`INSERT OR REPLACE INTO ${table} (${cs.join(', ')})
                VALUES (${cs.map(c => '@' + c).join(', ')})`).run(valeurs);
  };

  return transaction(db, () => {
    reinserer('offers', offre);
    if (suivi) reinserer('tracking', suivi);
    if (lettre) reinserer('letters', lettre);
    // Les rejets d'avant le chantier 4.0 n'ont ni entretien ni versions :
    // leur absence n'est pas une erreur.
    if (entretien) reinserer('entretiens', entretien);
    for (const v of versions ?? []) reinserer('lettres_versions', v);
    db.prepare('DELETE FROM rejetees WHERE offer_id = ?').run(id);
    return true;
  });
}

/** Identifiants des offres écartées pour de bon, à sauter à la collecte. */
export function idsRejetes(db) {
  return new Set(db.prepare('SELECT offer_id FROM rejetees').all().map(r => r.offer_id));
}

/** Remet en circulation les offres écartées, toutes ou par motif. */
export function oublierRejets(db, motif = null) {
  const requete = motif
    ? db.prepare('DELETE FROM rejetees WHERE motif = ?')
    : db.prepare('DELETE FROM rejetees');
  const avant = db.prepare('SELECT COUNT(*) n FROM rejetees').get().n;
  motif ? requete.run(motif) : requete.run();
  return avant - db.prepare('SELECT COUNT(*) n FROM rejetees').get().n;
}

/**
 * Écarte les offres restées « À postuler » plus de `jours` jours.
 *
 * Une offre qu'on n'a pas ouverte en deux semaines ne sera pas ouverte : elle
 * encombre la liste et fait paraître le travail plus lourd qu'il n'est.
 * L'ancienneté se compte depuis `first_seen` — le jour où elle est apparue
 * sous les yeux de l'auteur, pas sa date de publication.
 *
 * Elles sont inscrites dans `rejetees` : sans cela, la source les republiant
 * toujours, elles reviendraient six heures plus tard.
 *
 * @returns {number} nombre d'offres écartées
 */
export function purgerSansReponse(db, jours) {
  if (!jours || jours <= 0) return 0;
  const limite = new Date(Date.now() - jours * 86400000).toISOString();

  const dormantes = db.prepare(`
    SELECT o.id FROM offers o
    ${TRACE_JOINTURES}
    WHERE o.first_seen < @limite AND ${SANS_TRACE}
  `).all({ limite }).map(r => r.id);

  return supprimerOffres(db, dormantes, 'sans-reponse');
}

/**
 * Supprime les offres disparues des sources depuis plus de `jours` jours
 * ET sur lesquelles l'auteur n'a rien fait.
 *
 * @returns {number} nombre d'offres supprimées
 */
export function purgerOffresPerimees(db, jours = 30) {
  const limite = new Date(Date.now() - jours * 86400000).toISOString();

  const perimees = db.prepare(`
    SELECT o.id FROM offers o
    ${TRACE_JOINTURES}
    WHERE o.last_seen < @limite AND ${SANS_TRACE}
  `).all({ limite }).map(r => r.id);

  return supprimerOffres(db, perimees);
}

/**
 * Un verdict d'analyse qui commence par un refus.
 *
 * Le score par mots-clés voit « énergie renouvelable » là où l'analyse voit un
 * poste d'ingénieur d'exploitation : quand les deux divergent, c'est le verdict
 * qui a raison — les cartes le disent déjà à l'écran, le nettoyage s'aligne.
 */
const VERDICT_NEGATIF = /^\s*(non|à écarter|a ecarter|passe ton chemin)/i;

/**
 * Les offres qui ne correspondent pas au profil, sans en supprimer aucune.
 *
 * Deux motifs, du plus sûr au plus discutable :
 *   - « ecartee »  : le classement déterministe les a mises en groupe 3,
 *                    soit un motif éliminatoire, soit un score sous le seuil ;
 *   - « verdict »  : l'analyse du contenu commence par un refus, alors que
 *                    les mots-clés les avaient classées ailleurs.
 *
 * Rien n'est décidé ici : la fonction rend la liste, l'appelant tranche.
 * @returns {{id: string, titre: string, entreprise: string, ville: string,
 *            score: number, groupe: number, motif: 'ecartee'|'verdict',
 *            detail: string}[]}
 */
export function offresHorsProfil(db) {
  const lignes = db.prepare(`
    SELECT o.id, o.titre, o.entreprise, o.ville, o.score, o.groupe,
           o.score_detail, o.analysis_json
    FROM offers o
    ${TRACE_JOINTURES}
    WHERE ${SANS_TRACE}
    ORDER BY o.groupe DESC, o.score ASC
  `).all();

  const hors = [];

  for (const o of lignes) {
    let analyse = null;
    try { analyse = o.analysis_json ? JSON.parse(o.analysis_json) : null; } catch { /* illisible : ignorée */ }

    if (o.groupe === 3) {
      let detail = 'score sous le seuil';
      try {
        const eliminatoires = JSON.parse(o.score_detail ?? '{}').eliminatoires ?? [];
        if (eliminatoires.length) detail = eliminatoires.map(e => e.note ?? e.motif).join(' · ');
      } catch { /* détail illisible : le motif générique suffit */ }
      hors.push({ ...o, motif: 'ecartee', detail });
      continue;
    }

    if (analyse?.verdict && VERDICT_NEGATIF.test(analyse.verdict)) {
      hors.push({ ...o, motif: 'verdict', detail: String(analyse.verdict).slice(0, 120) });
    }
  }

  return hors.map(({ score_detail, analysis_json, ...reste }) => reste);
}

/**
 * Enregistre l'analyse d'une offre déjà en base.
 *
 * Écrire l'analyse offre par offre, plutôt qu'en un bloc à la fin de la
 * collecte, garantit que chaque analyse payée en quota est conservée — même
 * si la suivante échoue.
 */
export function enregistrerAnalyse(db, id, analyse) {
  db.prepare('UPDATE offers SET analysis_json = ?, analysis_at = ? WHERE id = ?')
    .run(JSON.stringify(analyse), new Date().toISOString(), id);
}
