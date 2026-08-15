// Comptabilité du quota Gemini, et réserve pour les lettres.
//
// LE PROBLÈME
// -----------
// Le quota gratuit est JOURNALIER et PARTAGÉ entre l'analyse des offres et la
// rédaction des lettres. Quatre collectes par jour le vident entièrement, et
// au moment où l'auteur veut une lettre, il n'y a plus rien. Or une lettre
// vaut infiniment plus qu'un verdict sur une offre qu'il ne lira peut-être
// jamais : c'est elle qui décroche un entretien.
//
// DEUX PROTECTIONS, l'une prévoyante, l'autre réactive
// ----------------------------------------------------
// 1. UNE RÉSERVE COMPTÉE. On tient le compte des appels du jour. L'analyse
//    s'arrête dès qu'elle entamerait la réserve ; la rédaction, elle, peut
//    aller jusqu'au bout du quota.
//
// 2. UN ARRÊT AU PREMIER REFUS. Google ne dit pas combien il reste : le
//    plafond configuré n'est qu'une estimation. Dès qu'une analyse se voit
//    refuser pour cause de quota, on cesse d'analyser pour la journée. La
//    chaîne de repli comptant plusieurs modèles, ce qui reste des autres est
//    ainsi préservé pour les lettres.
//
// Le comptage est PAR USAGE : savoir que 120 appels sont partis en analyse et
// 4 en lettres est ce qui permet de régler la réserve en connaissance de cause.

export const ANALYSE = 'analyse';
export const LETTRE = 'lettre';

/** Valeurs par défaut, si `profile.json` ne dit rien. */
const DEFAUTS = { quotaJournalier: 200, reserveLettres: 40 };

/** Jour courant en heure LOCALE — comme partout ailleurs dans le projet. */
function jourLocal(quand = new Date()) {
  const p = (v) => String(v).padStart(2, '0');
  return `${quand.getFullYear()}-${p(quand.getMonth() + 1)}-${p(quand.getDate())}`;
}

/** Réglages effectifs, bornés pour rester cohérents entre eux. */
export function reglages(profil = {}) {
  const g = profil.gemini ?? {};
  const quotaJournalier = Math.max(1, Number(g.quotaJournalier ?? DEFAUTS.quotaJournalier));
  // Une réserve plus grande que le quota interdirait toute analyse : on la
  // borne à la moitié, pour qu'il reste toujours de quoi analyser.
  const reserveLettres = Math.min(
    Math.max(0, Number(g.reserveLettres ?? DEFAUTS.reserveLettres)),
    Math.floor(quotaJournalier / 2)
  );
  return { quotaJournalier, reserveLettres };
}

/** Enregistre un appel effectivement parti chez Gemini. */
export function noterAppel(db, usage, quand = new Date()) {
  db.prepare(`
    INSERT INTO quota_gemini (jour, usage, appels) VALUES (?, ?, 1)
    ON CONFLICT(jour, usage) DO UPDATE SET appels = appels + 1
  `).run(jourLocal(quand), usage);
}

/**
 * Marque l'analyse comme close pour la journée.
 * Appelé au premier refus pour cause de quota : insister ne ferait que
 * grignoter ce qui reste aux lettres.
 */
export function fermerAnalyse(db, quand = new Date()) {
  db.prepare(`
    INSERT INTO quota_gemini (jour, usage, appels) VALUES (?, 'analyse-fermee', 1)
    ON CONFLICT(jour, usage) DO UPDATE SET appels = appels + 1
  `).run(jourLocal(quand));
}

/** Compte des appels du jour, par usage. */
export function appelsDuJour(db, quand = new Date()) {
  const lignes = db.prepare('SELECT usage, appels FROM quota_gemini WHERE jour = ?')
    .all(jourLocal(quand));
  const par = Object.fromEntries(lignes.map(l => [l.usage, l.appels]));
  return {
    analyse: par[ANALYSE] ?? 0,
    lettre: par[LETTRE] ?? 0,
    total: (par[ANALYSE] ?? 0) + (par[LETTRE] ?? 0),
    analyseFermee: Boolean(par['analyse-fermee']),
  };
}

/**
 * L'analyse peut-elle encore consommer du quota ?
 * @returns {{ok: boolean, raison?: string, restant: number}}
 */
export function peutAnalyser(db, profil, quand = new Date()) {
  const { quotaJournalier, reserveLettres } = reglages(profil);
  const a = appelsDuJour(db, quand);
  const plafondAnalyse = quotaJournalier - reserveLettres;
  const restant = Math.max(0, plafondAnalyse - a.total);

  if (a.analyseFermee) {
    return { ok: false, restant: 0, raison: 'Google a refusé une analyse aujourd\'hui — le reste du quota est gardé pour les lettres.' };
  }
  if (a.total >= plafondAnalyse) {
    return { ok: false, restant: 0, raison: `Réserve atteinte : ${reserveLettres} appels sont gardés pour les lettres.` };
  }
  return { ok: true, restant };
}

/**
 * Une lettre peut-elle être rédigée ?
 * Elle a accès à TOUT le quota, réserve comprise : c'est sa raison d'être.
 */
export function peutRediger(db, profil, quand = new Date()) {
  const { quotaJournalier } = reglages(profil);
  const a = appelsDuJour(db, quand);
  const restant = Math.max(0, quotaJournalier - a.total);
  return restant > 0
    ? { ok: true, restant }
    : { ok: false, restant: 0, raison: 'Quota journalier épuisé, lettres comprises. Il se renouvelle demain.' };
}

/** État lisible, pour l'interface et les journaux. */
export function etatQuota(db, profil, quand = new Date()) {
  const { quotaJournalier, reserveLettres } = reglages(profil);
  const a = appelsDuJour(db, quand);
  return {
    jour: jourLocal(quand),
    quotaJournalier,
    reserveLettres,
    analyses: a.analyse,
    lettres: a.lettre,
    total: a.total,
    restantAnalyse: peutAnalyser(db, profil, quand).restant,
    restantLettres: Math.max(0, quotaJournalier - a.total),
    analyseFermee: a.analyseFermee,
  };
}
