// Constantes partagées et petits utilitaires d'affichage.

export const GM = {
  1: { key: 'b1', vd: 'vd1', label: 'Prioritaire', emoji: '🟢', couleur: 'var(--g1)', fond: 'var(--g1b)' },
  2: { key: 'b2', vd: 'vd2', label: 'Possible',    emoji: '🟡', couleur: 'var(--g2)', fond: 'var(--g2b)' },
  3: { key: 'b3', vd: 'vd3', label: 'À écarter',   emoji: '🔴', couleur: 'var(--g3)', fond: 'var(--g3b)' },
  0: { key: 'b0', vd: 'vd0', label: 'À vérifier',  emoji: '⚪', couleur: 'var(--g0)', fond: 'var(--g0b)' },
};

export const STATUSES = ['À postuler', 'Envoyé', 'Relancé', 'Entretien', 'Refus'];

export const STATUS_EMOJI = {
  'À postuler': '📋', 'Envoyé': '📨', 'Relancé': '🔔', 'Entretien': '🤝', 'Refus': '🙅',
};

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

/** Palette des graphiques : lisible sur les trois thèmes, distincte à l'œil. */
export const PALETTE = [
  'var(--accent)', 'var(--g1)', 'var(--g2)', 'var(--info)',
  'var(--pink)', 'var(--accent2)', 'var(--g3)', 'var(--g0)',
];

export const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const MOIS_COURT = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin',
  'juil', 'août', 'sep', 'oct', 'nov', 'déc'];
export const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

export const SOURCE_LABEL = {
  'france-travail': 'France Travail', adzuna: 'Adzuna', jooble: 'Jooble',
  careerjet: 'Careerjet', flux: 'Flux RSS', indeed: 'Indeed',
  collage: 'collée', manuel: 'saisie', historique: 'archive', inconnue: 'inconnue',
};

/** Libellé des types d'événement du journal d'activité. */
export const EVENEMENT = {
  candidature: { emoji: '📮', texte: 'Candidature envoyée' },
  relance:     { emoji: '🔔', texte: 'Relance effectuée' },
  entretien:   { emoji: '🤝', texte: 'Entretien décroché' },
  refus:       { emoji: '🙅', texte: 'Refus enregistré' },
  statut:      { emoji: '🔄', texte: 'Statut modifié' },
  lettre:      { emoji: '🖋️', texte: 'Lettre rédigée' },
  retouche:    { emoji: '🎨', texte: 'Lettre retouchée' },
  note:        { emoji: '🧠', texte: 'Note ajoutée' },
  ajout:       { emoji: '🔎', texte: 'Offre ajoutée' },
  epingle:     { emoji: '📌', texte: 'Offre épinglée' },
  collecte:    { emoji: '📡', texte: 'Collecte lancée' },
};

export const todayISO = () => {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

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
  if (age <= 7) return ['ok', '🌿 ' + age + ' j'];
  if (age <= 14) return ['warn', '🍂 ' + age + ' j'];
  return ['old', '🥀 ' + age + ' j'];
}

/** Date lisible : « 28 juillet 2026 ». */
export function dateLisible(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Date courte : « 28 juil. ». */
export function dateCourte(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getDate()} ${MOIS_COURT[d.getMonth()]}`;
}

/** Écart lisible : « il y a 2 h », « hier », « il y a 5 jours ». */
export function ilYA(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const minutes = Math.floor((Date.now() - t) / 60000);
  if (minutes < 1) return 'à l\'instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  const jours = Math.floor(heures / 24);
  if (jours === 1) return 'hier';
  if (jours < 30) return `il y a ${jours} jours`;
  const mois = Math.floor(jours / 30);
  return mois === 1 ? 'il y a un mois' : `il y a ${mois} mois`;
}

/** Accord du pluriel, sans répéter la même ternaire partout. */
export const pluriel = (n, singulier, pluriel_ = singulier + 's') =>
  `${n} ${n > 1 ? pluriel_ : singulier}`;

/** Échappe le HTML : les titres et descriptions viennent de sources externes. */
export function echapper(texte) {
  return String(texte ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
