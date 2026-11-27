// LE TITRE DE L'ONGLET, À PLUSIEURS MAINS.
//
// Trois modules veulent écrire dans `document.title` : le bandeau (le nom du
// profil), les rappels (« (3) » quand trois échéances attendent) et le
// minuteur du mode focus (« 12:40 »). Chacun écrasait les autres — le
// compteur de rappels disparaissait à la première seconde du minuteur. Le
// titre est donc COMPOSÉ ici : une base, et des marques posées par clé.

const marques = new Map();
let base = 'Job Cockpit';

function composer() {
  if (typeof document === 'undefined') return;
  const prefixe = [...marques.values()].filter(Boolean).join(' ');
  document.title = prefixe ? `${prefixe} ${base}` : base;
}

/** Le titre de fond, sans marque. */
export function poserTitreBase(texte) {
  base = String(texte || 'Job Cockpit');
  composer();
}

/** Pose (ou retire, avec une valeur vide) une marque devant le titre. */
export function poserMarque(cle, texte) {
  if (texte) marques.set(cle, String(texte));
  else marques.delete(cle);
  composer();
}

/** Le titre tel qu'il serait composé — pour les tests. */
export function titreCompose() {
  const prefixe = [...marques.values()].filter(Boolean).join(' ');
  return prefixe ? `${prefixe} ${base}` : base;
}
