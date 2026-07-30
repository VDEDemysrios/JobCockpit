// Rattachement géographique d'une offre à l'une des villes prioritaires.
//
// Fonctions PURES : aucun accès réseau ni base. Les villes, leurs zones
// limitrophes et leurs départements vivent dans profile/profile.json.
//
// Ce module sert deux usages qui doivent rester cohérents :
//   - la collecte, pour décider si une offre est « dans la zone » ;
//   - l'interface, pour ranger chaque offre dans l'onglet de sa ville.
// Les deux répondent à la même question ; les faire diverger produirait une
// offre marquée « dans la zone » que l'onglet Strasbourg n'afficherait pas.
import { normaliser } from './hash.js';

/**
 * Déduit le département depuis un code postal, une ville « X (67) »,
 * ou un libellé de zone « 54 - NANCY » / « Strasbourg, 67 ».
 *
 * Le champ `departement` déjà calculé lors de la collecte est prioritaire :
 * les offres relues en base le portent, mais pas toujours leur libellé de zone.
 */
export function deduireDepartement(offre) {
  if (offre.departement) return String(offre.departement).slice(0, 2);

  // On balaie les trois champs : le code postal est absent chez Adzuna, et
  // « 54 - NANCY » (France Travail) ou « Strasbourg, 67 » (Jooble) ne portent
  // le code que dans le libellé de zone.
  const source = `${offre.codePostal ?? ''} ${offre.ville ?? ''} ${offre.zone ?? ''}`;
  const trouve = source.match(/\b(\d{2})\d{0,3}\b/);
  return trouve ? trouve[1] : null;
}

/**
 * Découpe le libellé géographique en SEGMENTS comparables entiers :
 * « France », « Île-de-France », « Seine-et-Marne », « Dammartin-en-Goële ».
 *
 * Comparer par sous-chaîne serait piégeux : « Bouches-du-Rhône » (13)
 * contient « Rhône » (69) et Fuveau se retrouvait classé près de Lyon.
 */
function segmentsGeo(offre) {
  return [offre.ville ?? '', ...String(offre.zone ?? '').split(',')]
    .map(normaliser)
    .filter(Boolean);
}

/**
 * La ville prioritaire à laquelle rattacher une offre, ou null.
 *
 * Les trois critères sont appliqués en PASSES SUCCESSIVES, du plus sûr au
 * plus large : un nom de commune explicite doit l'emporter sur une simple
 * coïncidence de département, quel que soit l'ordre des villes du profil.
 *
 * @param {{ville?: string, zone?: string, codePostal?: string, departement?: string}} offre
 * @param {object[]} villesPrioritaires  profil.villesPrioritaires
 * @returns {string|null} le nom de la ville, tel qu'écrit dans le profil
 */
export function villeDeRattachement(offre, villesPrioritaires = []) {
  const segments = segmentsGeo(offre);
  const departement = deduireDepartement(offre);

  // 1. Le nom de la ville prioritaire est distinctif : une inclusion suffit
  //    (« Eurométropole de Strasbourg » doit correspondre à Strasbourg).
  for (const v of villesPrioritaires) {
    const nom = normaliser(v.nom);
    if (segments.some(s => s.includes(nom))) return v.nom;
  }

  // 2. Les zones limitrophes, elles, exigent une correspondance EXACTE.
  for (const v of villesPrioritaires) {
    const proches = (v.zonesProches ?? []).map(normaliser);
    if (segments.some(s => proches.includes(s))) return v.nom;
  }

  // 3. À défaut, le département — le signal le plus grossier, donc le dernier.
  if (departement) {
    for (const v of villesPrioritaires) {
      const deps = v.departementsProches ?? [v.departement];
      if (deps.includes(departement)) return v.nom;
    }
  }

  return null;
}

/**
 * true si l'offre se situe dans (ou près d')une ville prioritaire.
 *
 * Les sources ne renvoient pas toutes une commune : Adzuna a renvoyé
 * « Hauts-de-Seine » (un département) et « Dammartin-en-Goële » (une commune
 * de banlieue). Un simple test sur le nom de la ville les classait « hors
 * zone » alors qu'elles sont en Île-de-France.
 */
export function estDansZonePrioritaire(offre, villesPrioritaires) {
  return villeDeRattachement(offre, villesPrioritaires) !== null;
}
