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

-- Jours où Benjamin a fait quelque chose. Alimente la carte d'activité.
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
  ajouterColonnesManquantes(db);
  return db;
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
const SANS_TRACE = `
  o.is_manual = 0
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
  )`;

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
    const rejeter           = db.prepare(`INSERT INTO rejetees (offer_id, motif, titre, rejete_le, donnees)
                                          VALUES (?, ?, ?, ?, ?)
                                          ON CONFLICT(offer_id) DO UPDATE SET
                                            motif = excluded.motif, donnees = excluded.donnees`);
    const supprimerOffre    = db.prepare('DELETE FROM offers   WHERE id = ?');
    const supprimerTracking = db.prepare('DELETE FROM tracking WHERE offer_id = ?');
    const supprimerLettre   = db.prepare('DELETE FROM letters  WHERE offer_id = ?');
    const maintenant = new Date().toISOString();

    for (const id of ids) {
      const offre = lireOffre.get(id);
      if (motif) {
        // ON GARDE DE QUOI REVENIR EN ARRIÈRE — mais seulement pour ce que
        // Benjamin écarte LUI-MÊME. Les suppressions automatiques portent sur
        // des milliers d'offres : conserver chacune ferait grossir la base
        // sans jamais servir, personne ne cherchant à annuler un ménage qu'il
        // n'a pas demandé.
        const donnees = motif === 'manuel' && offre
          ? JSON.stringify({ offre, suivi: lireSuivi.get(id) ?? null, lettre: lireLettre.get(id) ?? null })
          : null;
        rejeter.run(id, motif, offre?.titre ?? null, maintenant, donnees);
      }
      supprimerLettre.run(id);
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

  const { offre, suivi, lettre } = JSON.parse(ligne.donnees);
  if (!offre) return false;

  return transaction(db, () => {
    const colonnes = Object.keys(offre);
    db.prepare(`INSERT OR REPLACE INTO offers (${colonnes.join(', ')})
                VALUES (${colonnes.map(c => '@' + c).join(', ')})`).run(offre);

    if (suivi) {
      const cs = Object.keys(suivi);
      db.prepare(`INSERT OR REPLACE INTO tracking (${cs.join(', ')})
                  VALUES (${cs.map(c => '@' + c).join(', ')})`).run(suivi);
    }
    if (lettre) {
      const cl = Object.keys(lettre);
      db.prepare(`INSERT OR REPLACE INTO letters (${cl.join(', ')})
                  VALUES (${cl.map(c => '@' + c).join(', ')})`).run(lettre);
    }
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
 * sous les yeux de Benjamin, pas sa date de publication.
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
    LEFT JOIN tracking t ON t.offer_id = o.id
    LEFT JOIN letters  l ON l.offer_id = o.id
    WHERE o.first_seen < @limite AND ${SANS_TRACE}
  `).all({ limite }).map(r => r.id);

  return supprimerOffres(db, dormantes, 'sans-reponse');
}

/**
 * Supprime les offres disparues des sources depuis plus de `jours` jours
 * ET sur lesquelles Benjamin n'a rien fait.
 *
 * @returns {number} nombre d'offres supprimées
 */
export function purgerOffresPerimees(db, jours = 30) {
  const limite = new Date(Date.now() - jours * 86400000).toISOString();

  const perimees = db.prepare(`
    SELECT o.id FROM offers o
    LEFT JOIN tracking t ON t.offer_id = o.id
    LEFT JOIN letters  l ON l.offer_id = o.id
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
    LEFT JOIN tracking t ON t.offer_id = o.id
    LEFT JOIN letters  l ON l.offer_id = o.id
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
