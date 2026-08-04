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
  //
  // UN NUMÉRO D'ARRONDISSEMENT N'EST PAS UN DÉPARTEMENT.
  // « 13ème Arrondissement » donnait les Bouches-du-Rhône, « 17ème » la
  // Charente-Maritime, « 18ème » le Cher — trois offres parisiennes envoyées
  // à l'autre bout du pays. Le numéro du quartier est donc retiré AVANT toute
  // déduction : mieux vaut aucun département qu'un département inventé, car
  // le premier laisse l'offre dans « Autre » quand le second la range
  // faussement ailleurs, avec l'air d'être sûr de lui.
  const source = `${offre.codePostal ?? ''} ${offre.ville ?? ''} ${offre.zone ?? ''}`
    .replace(/\b\d{1,2}\s*(?:er|ère|re|e|ème|eme)?[-\s]*arrondissements?\b/gi, ' ');

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
 * DEUX QUESTIONS, PAS UNE.
 *
 * Elles se ressemblent assez pour avoir longtemps partagé la même
 * configuration, et c'est ce qui a produit le défaut : l'onglet « Nancy »
 * affichait Metz et Épinal, « Strasbourg » affichait Colmar et Mulhouse.
 *
 *   « Est-ce que ce poste est géographiquement acceptable ? »
 *      → LARGE. C'est le bassin qu'on accepte de considérer. Metz depuis
 *        Nancy, oui. Cette réponse commande la COLLECTE : hors de ce
 *        périmètre, seules les offres prioritaires ou possibles sont gardées.
 *
 *   « Dans quel onglet cette offre doit-elle apparaître ? »
 *      → SERRÉ. Un onglet nommé « Nancy » qui contient Metz ne range rien :
 *        il déguise un département en ville. Cette réponse commande
 *        l'AFFICHAGE, et tout ce qui n'entre nulle part tombe dans « Autre »,
 *        qui existe précisément pour ça.
 *
 * D'où deux jeux de champs dans profile.json :
 *   · `zonesProches` / `departementsProches` — le filet large, pour collecter ;
 *   · `zonesOnglet`  / `departementsOnglet`  — le périmètre serré, pour ranger.
 *
 * Les seconds retombent sur les premiers s'ils manquent : un profil qui n'a
 * pas encore été mis à jour garde exactement l'ancien comportement.
 */

/** Passes de rattachement, du signal le plus sûr au plus grossier. */
function chercher(offre, villes, { zones, departements }) {
  const segments = segmentsGeo(offre);

  // 1. Le nom de la ville prioritaire est distinctif : une inclusion suffit
  //    (« Eurométropole de Strasbourg » doit correspondre à Strasbourg).
  for (const v of villes) {
    const nom = normaliser(v.nom);
    if (segments.some(s => s.includes(nom))) return v.nom;
  }

  // 2. Les communes et zones déclarées, elles, exigent l'égalité exacte.
  for (const v of villes) {
    const liste = zones(v).map(normaliser);
    if (segments.some(s => liste.includes(s))) return v.nom;
  }

  // 3. À défaut, le département — le signal le plus grossier, donc le dernier.
  const departement = deduireDepartement(offre);
  if (departement) {
    for (const v of villes) {
      if (departements(v).includes(departement)) return v.nom;
    }
  }

  return null;
}

/**
 * L'onglet dans lequel ranger une offre, ou null pour « Autre ».
 *
 * Périmètre SERRÉ : la ville et son agglomération réelle.
 *
 * @param {{ville?: string, zone?: string, codePostal?: string, departement?: string}} offre
 * @param {object[]} villesPrioritaires  profil.villesPrioritaires
 * @returns {string|null} le nom de la ville, tel qu'écrit dans le profil
 */
export function villeDeRattachement(offre, villesPrioritaires = []) {
  return chercher(offre, villesPrioritaires, {
    zones: v => v.zonesOnglet ?? v.zonesProches ?? [],
    departements: v => v.departementsOnglet ?? (v.departement ? [v.departement] : []),
  });
}

/**
 * true si l'offre se situe dans un bassin qu'on accepte de considérer.
 *
 * Périmètre LARGE, et volontairement distinct de l'onglet : une offre à Metz
 * reste collectée — elle est à trois quarts d'heure de Nancy — mais elle
 * s'affiche dans « Autre », pas dans l'onglet Nancy.
 *
 * Les sources ne renvoient pas toutes une commune : Adzuna a renvoyé
 * « Hauts-de-Seine » (un département) et « Dammartin-en-Goële » (une commune
 * de banlieue). Un simple test sur le nom de la ville les classait « hors
 * zone » alors qu'elles sont en Île-de-France.
 */
export function estDansZonePrioritaire(offre, villesPrioritaires = []) {
  return chercher(offre, villesPrioritaires, {
    zones: v => v.zonesProches ?? [],
    departements: v => v.departementsProches ?? (v.departement ? [v.departement] : []),
  }) !== null;
}
