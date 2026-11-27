// LE ROUTAGE PAR ANCRE : une adresse par écran.
//
// POURQUOI
// --------
// Toute l'application tenait à une seule adresse, `/`. Conséquences :
//   · « Précédent » sortait de l'application au lieu de revenir à la vue
//     d'avant — le geste le plus ancré du navigateur faisait perdre sa place ;
//   · un rechargement ramenait au tableau de bord, quelle que soit la vue ;
//   · impossible de garder un lien vers « les offres de Strasbourg » ou vers
//     une offre précise, ni de rouvrir un onglet sur ce qu'on regardait.
//
// La forme : `#/offres/strasbourg`, `#/offre/<id>`, `#/kanban`… Une ANCRE et
// non un chemin : le serveur n'a rien à savoir, `express.static` sert la même
// page, et la politique de sécurité ne bouge pas.
//
// Ce module est PUR : il traduit une ancre en intention et l'inverse. C'est
// app.js qui l'applique — ici, rien ne touche au document, et tout se teste.

import { normaliser } from './format.js';

/** Vue interne → segment d'adresse. Des mots français, lisibles dans la barre. */
export const SEGMENTS = {
  dashboard: 'tableau', offers: 'offres', kanban: 'kanban', agenda: 'agenda',
  entretiens: 'entretiens', chill: 'chill', cv: 'cv', options: 'options',
};

const VUE_DE = Object.fromEntries(Object.entries(SEGMENTS).map(([v, s]) => [s, v]));

/** « Strasbourg (67) » → « strasbourg-67 ». Stable, sans accent ni espace. */
export function slugVille(ville) {
  return normaliser(ville).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Lit une ancre.
 *
 * @param {string} hash  `location.hash`, avec ou sans `#`
 * @returns {{vue: string|null, ville: string|null, offre: string|null}}
 *          `ville` est un SLUG : c'est à l'appelant de le rapprocher de ses
 *          villes réelles (voir `villeDuSlug`).
 */
export function lireRoute(hash) {
  const brut = String(hash ?? '').replace(/^#\/?/, '');
  const [segment, suite] = brut.split('/').map(s => {
    try { return decodeURIComponent(s ?? ''); } catch { return s ?? ''; }
  });
  if (segment === 'offre' && suite) return { vue: 'offers', ville: null, offre: suite };
  const vue = VUE_DE[segment] ?? null;
  return { vue, ville: vue === 'offers' && suite ? suite : null, offre: null };
}

/** Écrit l'ancre d'une intention. */
export function ecrireRoute({ vue, ville = null, offre = null } = {}) {
  if (offre) return `#/offre/${encodeURIComponent(offre)}`;
  const segment = SEGMENTS[vue] ?? SEGMENTS.dashboard;
  if (vue === 'offers' && ville) return `#/${segment}/${encodeURIComponent(slugVille(ville))}`;
  return `#/${segment}`;
}

/** Retrouve la ville réelle d'un slug parmi celles connues, ou null. */
export function villeDuSlug(slug, villes) {
  if (!slug) return null;
  return (villes ?? []).find(v => slugVille(v) === slug) ?? null;
}
