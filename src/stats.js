// Agrégation statistique pour le tableau de bord.
//
// Tout est calculé ICI, côté serveur, en SQL. Le navigateur ne fait que
// dessiner. C'est délibéré : les mêmes chiffres alimentent le tableau de bord,
// les quêtes et les graphiques, et un seul lieu de calcul évite qu'un
// « taux de réponse » diverge d'un écran à l'autre.
//
// Deux sources de vérité coexistent, et c'est voulu :
//  · `tracking.sent_date` porte l'historique complet des envois, y compris
//    ceux saisis avant l'existence du journal ;
//  · `evenements` porte le détail fin (type, heure) des actions récentes.
// Les courbes d'envoi s'appuient donc sur la première, les quêtes et la
// répartition horaire sur la seconde.



const JOUR_MS = 86400000;

/** Date ISO locale — surtout pas toISOString(), qui décale d'un jour le soir. */
export function isoLocal(date = new Date()) {
  const p = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Liste de `combien` dates ISO consécutives se terminant aujourd'hui. */
export function derniersJours(combien, aujourdhui = isoLocal()) {
  const fin = new Date(aujourdhui + 'T12:00:00');
  return Array.from({ length: combien }, (_, i) => {
    const d = new Date(fin.getTime() - (combien - 1 - i) * JOUR_MS);
    return isoLocal(d);
  });
}

/** Décale une date ISO de n jours. */
export function decaler(iso, jours) {
  return isoLocal(new Date(new Date(iso + 'T12:00:00').getTime() + jours * JOUR_MS));
}

/** Lundi de la semaine en cours, au format ISO. */
export function debutDeSemaine(aujourdhui) {
  const d = new Date(aujourdhui + 'T12:00:00Z');
  const jour = d.getUTCDay();
  const recul = jour === 0 ? 6 : jour - 1; // lundi = début de semaine
  d.setUTCDate(d.getUTCDate() - recul);
  return d.toISOString().slice(0, 10);
}

const compter = (rows, cle = 'jour', valeur = 'n') =>
  Object.fromEntries(rows.map(r => [r[cle], r[valeur]]));

/**
 * Toutes les statistiques du tableau de bord, en un appel.
 * @param {object} db  base ouverte
 * @param {object} [options] { aujourdhui } pour les tests
 */
export function calculerStats(db, options = {}) {
  const aujourdhui = options.aujourdhui ?? isoLocal();
  const lundi = debutDeSemaine(aujourdhui);
  const lundiPrecedent = decaler(lundi, -7);

  const un = (sql, params = []) => db.prepare(sql).get(...params) ?? {};
  const tous = (sql, params = []) => db.prepare(sql).all(...params);
  const nb = (sql, params = []) => Number(un(sql, params).n ?? 0);

  // ─────────────────────────── Vue d'ensemble ───────────────────────────

  const total = nb('SELECT COUNT(*) n FROM offers');
  const parGroupe = tous('SELECT groupe, COUNT(*) n FROM offers GROUP BY groupe')
    .map(r => ({ groupe: Number(r.groupe ?? 0), n: Number(r.n) }));

  const parStatut = tous(`
    SELECT COALESCE(t.status, 'À postuler') statut, COUNT(*) n
    FROM offers o LEFT JOIN tracking t ON t.offer_id = o.id
    GROUP BY statut`).map(r => ({ statut: r.statut, n: Number(r.n) }));

  const statut = (s) => parStatut.find(x => x.statut === s)?.n ?? 0;
  const envoyees = statut('Envoyé') + statut('Relancé') + statut('Entretien') + statut('Refus');
  const entretiens = statut('Entretien');
  const refus = statut('Refus');
  const reponses = entretiens + refus;

  // ─────────────────────────── Séries temporelles ───────────────────────

  const envoisParJour = compter(tous(`
    SELECT sent_date jour, COUNT(*) n FROM tracking
    WHERE sent_date <> '' AND sent_date IS NOT NULL GROUP BY sent_date`));

  const evenementsParJour = compter(tous(`
    SELECT jour, COUNT(*) n FROM evenements GROUP BY jour`));

  const actionsParJour = compter(tous(`
    SELECT jour, actions n FROM activite`));

  const lettresParJour = compter(tous(`
    SELECT jour, COUNT(*) n FROM evenements WHERE type = 'lettre' GROUP BY jour`));

  const relancesParJour = compter(tous(`
    SELECT jour, COUNT(*) n FROM evenements WHERE type = 'relance' GROUP BY jour`));

  const serie90 = derniersJours(90, aujourdhui).map(jour => ({
    jour,
    envois: envoisParJour[jour] ?? 0,
    lettres: lettresParJour[jour] ?? 0,
    relances: relancesParJour[jour] ?? 0,
    actions: Math.max(evenementsParJour[jour] ?? 0, actionsParJour[jour] ?? 0),
  }));

  // Calendrier d'assiduité : 26 semaines, calées sur un lundi pour que les
  // colonnes soient des semaines pleines.
  const debutHeatmap = debutDeSemaine(decaler(aujourdhui, -(26 * 7 - 1)));
  const joursHeatmap = [];
  for (let j = debutHeatmap; j <= aujourdhui; j = decaler(j, 1)) {
    joursHeatmap.push({
      jour: j,
      actions: Math.max(evenementsParJour[j] ?? 0, actionsParJour[j] ?? 0),
      envois: envoisParJour[j] ?? 0,
    });
  }

  // Semaines : 16 dernières, pour la courbe de rythme.
  const semaines = [];
  for (let i = 15; i >= 0; i--) {
    const debut = decaler(lundi, -7 * i);
    const fin = decaler(debut, 6);
    semaines.push({
      lundi: debut,
      envois: nb(`SELECT COUNT(*) n FROM tracking WHERE sent_date >= ? AND sent_date <= ?`, [debut, fin]),
      actions: joursHeatmap
        .filter(x => x.jour >= debut && x.jour <= fin)
        .reduce((t, x) => t + x.actions, 0),
    });
  }

  // ────────────────────────────── Répartitions ──────────────────────────

  const parVille = tous(`
    SELECT COALESCE(NULLIF(TRIM(ville), ''), '—') ville, COUNT(*) n,
           SUM(CASE WHEN t.status IS NOT NULL AND t.status <> 'À postuler' THEN 1 ELSE 0 END) envoyees
    FROM offers o LEFT JOIN tracking t ON t.offer_id = o.id
    GROUP BY ville ORDER BY n DESC LIMIT 12`)
    .map(r => ({ ville: nettoyerVille(r.ville), n: Number(r.n), envoyees: Number(r.envoyees ?? 0) }));

  const parSource = tous(`
    SELECT COALESCE(source, 'inconnue') source, COUNT(*) n
    FROM offers GROUP BY source ORDER BY n DESC`)
    .map(r => ({ source: r.source, n: Number(r.n) }));

  const parContrat = tous(`
    SELECT COALESCE(NULLIF(TRIM(contrat), ''), 'Non précisé') contrat, COUNT(*) n
    FROM offers GROUP BY contrat ORDER BY n DESC LIMIT 8`)
    .map(r => ({ contrat: r.contrat, n: Number(r.n) }));

  const topEntreprises = tous(`
    SELECT COALESCE(NULLIF(TRIM(entreprise), ''), '—') entreprise, COUNT(*) n
    FROM offers GROUP BY entreprise HAVING n > 1 ORDER BY n DESC LIMIT 8`)
    .map(r => ({ entreprise: r.entreprise, n: Number(r.n) }));

  // Distribution des scores, par tranches de 2 points.
  const scores = tous(`
    SELECT score FROM offers WHERE score IS NOT NULL`).map(r => Number(r.score));
  const distributionScores = distribuer(scores);

  // ───────────────────────────── Performance ────────────────────────────

  const enAttente = tous(`
    SELECT sent_date FROM tracking
    WHERE sent_date <> '' AND sent_date IS NOT NULL AND status IN ('Envoyé', 'Relancé')`)
    .map(r => Math.floor((new Date(aujourdhui) - new Date(r.sent_date)) / JOUR_MS))
    .filter(j => Number.isFinite(j) && j >= 0);

  const delaiMoyen = enAttente.length
    ? Math.round(enAttente.reduce((t, j) => t + j, 0) / enAttente.length) : 0;

  const envoisSemaine = nb(`SELECT COUNT(*) n FROM tracking WHERE sent_date >= ?`, [lundi]);
  const envoisSemainePrecedente = nb(
    `SELECT COUNT(*) n FROM tracking WHERE sent_date >= ? AND sent_date < ?`,
    [lundiPrecedent, lundi]);

  // Répartition horaire des actions : à quelle heure l'auteur travaille.
  const parHeure = Array.from({ length: 24 }, (_, h) => ({ heure: h, n: 0 }));
  for (const r of tous(`SELECT heure, COUNT(*) n FROM evenements WHERE heure IS NOT NULL GROUP BY heure`)) {
    const h = Number(r.heure);
    if (h >= 0 && h < 24) parHeure[h].n = Number(r.n);
  }

  // ─────────────────────── Adéquation par thème (radar) ─────────────────
  // Les motifs de scoring sont regroupés en grandes familles métier. Le radar
  // montre sur quels axes les offres collectées collent au profil — et donc
  // ce que le marché propose vraiment, pas ce qu'on aimerait qu'il propose.
  const radar = calculerRadar(tous(`
    SELECT score_detail FROM offers WHERE score_detail IS NOT NULL AND groupe IN (0, 1, 2)`));

  // ───────────────────────────── Records ────────────────────────────────

  const meilleurJour = Math.max(0, ...Object.values(envoisParJour).map(Number));
  const meilleureSemaine = Math.max(0, ...semaines.map(s => s.envois));

  return {
    aujourdhui,
    lundi,
    resume: {
      total,
      envoyees,
      entretiens,
      refus,
      reponses,
      sansReponse: Math.max(0, envoyees - reponses),
      actionnables: (parGroupe.find(g => g.groupe === 1)?.n ?? 0) + (parGroupe.find(g => g.groupe === 2)?.n ?? 0),
      avecLettre: nb('SELECT COUNT(*) n FROM letters'),
      epinglees: nb('SELECT COUNT(*) n FROM tracking WHERE pinned = 1'),
      annotees: nb(`SELECT COUNT(*) n FROM tracking WHERE notes <> '' AND notes IS NOT NULL`),
    },
    performance: {
      tauxReponse: envoyees ? Math.round(reponses / envoyees * 100) : 0,
      tauxEntretien: envoyees ? Math.round(entretiens / envoyees * 100) : 0,
      tauxCandidature: total ? Math.round(envoyees / total * 100) : 0,
      delaiMoyen,
      delaiMax: enAttente.length ? Math.max(...enAttente) : 0,
      envoisSemaine,
      envoisSemainePrecedente,
      tendance: envoisSemaine - envoisSemainePrecedente,
    },
    records: { meilleurJour, meilleureSemaine },
    parGroupe,
    parStatut,
    parVille,
    parSource,
    parContrat,
    topEntreprises,
    distributionScores,
    serie90,
    semaines,
    heatmap: joursHeatmap,
    parHeure,
    radar,
  };
}

/** « Strasbourg (67) » → « Strasbourg ». */
function nettoyerVille(brut) {
  return String(brut ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim() || '—';
}

/** Histogramme des scores, en tranches de 2. */
function distribuer(scores) {
  if (!scores.length) return [];
  const max = Math.max(...scores, 10);
  const tranches = [];
  for (let debut = 0; debut <= max; debut += 2) {
    tranches.push({
      libelle: `${debut}–${debut + 1}`,
      n: scores.filter(s => s >= debut && s < debut + 2).length,
    });
  }
  return tranches;
}

/**
 * Familles de motifs de scoring, pour le radar d'adéquation.
 * Le motif brut (`agrivolta`, `\benr\b`…) est illisible sur un graphique :
 * on le rattache à un axe métier nommé.
 */
const FAMILLES_RADAR = [
  { axe: 'Agrivoltaïsme', motifs: ['agrivolta'] },
  { axe: 'Droit & juridique', motifs: ['droit public', 'droit de l environnement', 'juriste|juridique', 'redaction de contrats|contractuel'] },
  { axe: 'EnR & énergie', motifs: ['energies renouvelables|\\benr\\b', 'photovolta|solaire|eolien', '\\benergie'] },
  { axe: 'Gestion de projet', motifs: ['chef de projet|charge de developpement|charge de projet', 'gestion de projet', 'budget|financier'] },
  { axe: 'Réglementaire', motifs: ['veille juridique|veille reglementaire|conformite reglementaire|reglementation', 'autorisation environnementale|permis de construire', 'urbanisme'] },
  { axe: 'Territoire', motifs: ['concertation|acceptabilite|parties prenantes', 'collectivite|commune|intercommunal', 'qgis|\\bsig\\b|cartographie'] },
];

function calculerRadar(lignes) {
  const totaux = new Map(FAMILLES_RADAR.map(f => [f.axe, 0]));

  for (const ligne of lignes) {
    let detail;
    try { detail = JSON.parse(ligne.score_detail); } catch { continue; }
    for (const positif of detail?.positifs ?? []) {
      const famille = FAMILLES_RADAR.find(f => f.motifs.includes(positif.motif));
      if (famille) totaux.set(famille.axe, totaux.get(famille.axe) + 1);
    }
  }

  const max = Math.max(1, ...totaux.values());
  return FAMILLES_RADAR.map(f => ({
    axe: f.axe,
    n: totaux.get(f.axe),
    valeur: Math.round(totaux.get(f.axe) / max * 100),
  }));
}
