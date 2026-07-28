// Constantes partagées et petits utilitaires d'affichage.

export const GM = {
  1: { key: 'b1', vd: 'vd1', label: '🟢 Prioritaire' },
  2: { key: 'b2', vd: 'vd2', label: '🟡 Possible' },
  3: { key: 'b3', vd: 'vd3', label: '🔴 À écarter' },
  0: { key: 'b0', vd: 'vd0', label: '⚪ À vérifier' },
};

export const STATUSES = ['À postuler', 'Envoyé', 'Relancé', 'Entretien', 'Refus'];

export const STATUS_COL = {
  'À postuler': 'var(--g0)', 'Envoyé': 'var(--info)', 'Relancé': 'var(--accent)',
  'Entretien': 'var(--g2)', 'Refus': 'var(--g3)',
};

export const STATUS_PROG = {
  'À postuler': 10, 'Envoyé': 40, 'Relancé': 60, 'Entretien': 90, 'Refus': 100,
};

export const STATUS_BG = {
  'À postuler': 'var(--g0b)', 'Envoyé': 'var(--infob)', 'Relancé': 'var(--accent-bg)',
  'Entretien': 'var(--g2b)', 'Refus': 'var(--g3b)',
};

export const KWCOLOR = {
  oui: ['var(--g1b)', 'var(--g1)', 'Oui'],
  non: ['var(--g3b)', 'var(--g3)', 'Non'],
  partiel: ['var(--g2b)', 'var(--g2)', 'Partiel'],
};

export const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

export const SOURCE_LABEL = {
  'france-travail': 'France Travail', adzuna: 'Adzuna', jooble: 'Jooble',
  indeed: 'Indeed', collage: 'collée', manuel: 'saisie', historique: 'archive',
};

export const todayISO = () => new Date().toISOString().slice(0, 10);

/** Nombre de jours écoulés depuis une date ISO (négatif si future). */
export const joursDepuis = (iso) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

/** Âge d'une offre en jours, ou null si sa date est inconnue. */
export function ageOffre(dateISO) {
  if (!dateISO) return null;
  const t = new Date(dateISO).getTime();
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
}

export function etiquetteFraicheur(age) {
  if (age === null) return null;
  if (age <= 1) return ['new', '🔥 Nouveau'];
  if (age <= 7) return ['ok', '🟢 ' + age + ' j'];
  if (age <= 14) return ['warn', '🟡 ' + age + ' j'];
  return ['old', '🔴 ' + age + ' j'];
}

/** Date lisible : « 28 juillet 2026 ». */
export function dateLisible(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Échappe le HTML : les titres et descriptions viennent de sources externes. */
export function echapper(texte) {
  return String(texte ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
