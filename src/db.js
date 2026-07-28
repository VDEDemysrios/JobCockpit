// Accès à la base SQLite.
//
// La table `tracking` contient les données personnelles de Benjamin
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

/**
 * Supprime les offres disparues des sources depuis plus de `jours` jours
 * ET sur lesquelles Benjamin n'a rien fait.
 *
 * Une offre est PROTÉGÉE dès qu'elle porte la moindre trace d'activité :
 * un statut autre que « À postuler », une date d'envoi, une relance, une note,
 * une épingle, une lettre — ou si elle a été ajoutée à la main.
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

    const supprimerOffre    = db.prepare('DELETE FROM offers   WHERE id = ?');
    const supprimerTracking = db.prepare('DELETE FROM tracking WHERE offer_id = ?');
    for (const id of perimees) {
      supprimerTracking.run(id);
      supprimerOffre.run(id);
    }
    return perimees.length;
  });
}
