// Les villes prioritaires : leur table de départements, et leur fabrication.
//
// POURQUOI CE MODULE EXISTE
// -------------------------
// Le premier profil de l'application avait quatre villes choisies par une
// seule personne, et leurs périmètres avaient été réglés à la main, offre par
// offre, jusqu'à ce que les onglets cessent de mélanger les voisines. Rien de
// tout cela n'était reproductible : l'assistant de première configuration
// écrivait un département par ville, et le reste demandait d'éditer le JSON.
//
// Quelqu'un qui installe l'outil ne fera pas les mêmes choix, ne connaît pas
// ce fichier, et n'a aucune raison d'apprendre sa structure. Ce module rend
// donc réglable, depuis l'application, ce qui n'était accessible qu'à celui
// qui l'avait écrite.
//
// DEUX PÉRIMÈTRES, PAS UN — voir l'en-tête de `zone.js` pour le détail.
// L'onglet est SERRÉ (ce qu'on veut voir rangé sous ce nom), la collecte est
// LARGE (ce qu'on accepte de considérer). Les confondre est ce qui mettait
// Metz dans l'onglet Nancy.
//
// LES LIBELLÉS DE DÉPARTEMENT SONT DÉRIVÉS ; LES AUTRES SONT GARDÉS.
// Les noms de départements se régénèrent depuis les numéros — c'est ce qui
// fait que rétrécir un périmètre le rétrécit vraiment, au lieu de laisser
// « moselle » continuer à ramener Metz dans l'onglet Nancy.
//
// Mais tout n'est pas dérivable. Sur 300 offres réelles, une annonce à
// VILLEURBANNE, sans code postal ni département, n'était rattachée à Lyon que
// par son libellé propre : « villeurbanne » ne contient pas « lyon », donc la
// comparaison par nom de ville ne la rattrape pas. Les communes
// d'agglomération au nom distinct — Villeurbanne, Vandœuvre, Schiltigheim —
// sont donc CONSERVÉES telles quelles, et restent modifiables.
//
// Même mesure pour les libellés régionaux réservés à la collecte (« alsace »,
// « lorraine », « ile de france ») : ils rattrapent une offre sur 300 que les
// départements manquent. Peu, mais pas zéro — et ce sont justement les
// annonces mal renseignées, celles qu'aucun autre signal ne sauve.
import { normaliser } from './hash.js';

/**
 * Les départements français, numéro → nom.
 *
 * Ils servent à deux choses : afficher « 68 Haut-Rhin » plutôt que « 68 » au
 * moment du réglage — un numéro seul ne se vérifie pas d'un coup d'œil — et
 * fabriquer les libellés de zone comparés aux annonces.
 */
export const DEPARTEMENTS = {
  '01': 'Ain', '02': 'Aisne', '03': 'Allier', '04': 'Alpes-de-Haute-Provence',
  '05': 'Hautes-Alpes', '06': 'Alpes-Maritimes', '07': 'Ardèche', '08': 'Ardennes',
  '09': 'Ariège', '10': 'Aube', '11': 'Aude', '12': 'Aveyron',
  '13': 'Bouches-du-Rhône', '14': 'Calvados', '15': 'Cantal', '16': 'Charente',
  '17': 'Charente-Maritime', '18': 'Cher', '19': 'Corrèze',
  '2A': 'Corse-du-Sud', '2B': 'Haute-Corse',
  '21': "Côte-d'Or", '22': "Côtes-d'Armor", '23': 'Creuse', '24': 'Dordogne',
  '25': 'Doubs', '26': 'Drôme', '27': 'Eure', '28': 'Eure-et-Loir',
  '29': 'Finistère', '30': 'Gard', '31': 'Haute-Garonne', '32': 'Gers',
  '33': 'Gironde', '34': 'Hérault', '35': 'Ille-et-Vilaine', '36': 'Indre',
  '37': 'Indre-et-Loire', '38': 'Isère', '39': 'Jura', '40': 'Landes',
  '41': 'Loir-et-Cher', '42': 'Loire', '43': 'Haute-Loire', '44': 'Loire-Atlantique',
  '45': 'Loiret', '46': 'Lot', '47': 'Lot-et-Garonne', '48': 'Lozère',
  '49': 'Maine-et-Loire', '50': 'Manche', '51': 'Marne', '52': 'Haute-Marne',
  '53': 'Mayenne', '54': 'Meurthe-et-Moselle', '55': 'Meuse', '56': 'Morbihan',
  '57': 'Moselle', '58': 'Nièvre', '59': 'Nord', '60': 'Oise',
  '61': 'Orne', '62': 'Pas-de-Calais', '63': 'Puy-de-Dôme', '64': 'Pyrénées-Atlantiques',
  '65': 'Hautes-Pyrénées', '66': 'Pyrénées-Orientales', '67': 'Bas-Rhin', '68': 'Haut-Rhin',
  '69': 'Rhône', '70': 'Haute-Saône', '71': 'Saône-et-Loire', '72': 'Sarthe',
  '73': 'Savoie', '74': 'Haute-Savoie', '75': 'Paris', '76': 'Seine-Maritime',
  '77': 'Seine-et-Marne', '78': 'Yvelines', '79': 'Deux-Sèvres', '80': 'Somme',
  '81': 'Tarn', '82': 'Tarn-et-Garonne', '83': 'Var', '84': 'Vaucluse',
  '85': 'Vendée', '86': 'Vienne', '87': 'Haute-Vienne', '88': 'Vosges',
  '89': 'Yonne', '90': 'Territoire de Belfort', '91': 'Essonne', '92': 'Hauts-de-Seine',
  '93': 'Seine-Saint-Denis', '94': 'Val-de-Marne', '95': "Val-d'Oise",
  '971': 'Guadeloupe', '972': 'Martinique', '973': 'Guyane', '974': 'La Réunion',
  '976': 'Mayotte',
};

/**
 * Combien de villes au maximum.
 *
 * Ce n'est pas une limite d'affichage : chaque ville multiplie les requêtes de
 * collecte par le nombre d'intitulés, sur chaque source. Au-delà, les quotas
 * gratuits s'épuisent avant la fin de la collecte, et les dernières villes de
 * la liste ne ramènent rien — une panne silencieuse, et bien pire qu'un refus
 * annoncé.
 */
export const VILLES_MAX = 8;

/** « 67000 », « Strasbourg 67000 », « 67 » → « 67 ». Null si illisible. */
export function departementDuCode(saisie) {
  const texte = String(saisie ?? '').trim().toUpperCase();

  // La Corse d'abord, écrite directement : « 2A » / « 2B ».
  const corse = texte.match(/\b(2[AB])\b/);
  if (corse) return corse[1];

  const cinq = texte.match(/\b(\d{5})\b/);
  if (cinq) {
    // « 20 » n'existe pas comme département : la Corse se découpe en 2A et 2B,
    // et ses codes postaux commencent tous par 20. Le partage se lit dans le
    // troisième chiffre — 200xx et 201xx au sud, 202xx et au-delà au nord.
    //
    // Renvoyer 2A pour tout code corse, comme on le faisait, donnait la
    // Corse-du-Sud à Bastia. La règle ci-dessous couvre la quasi-totalité des
    // communes ; les quelques limites entre les deux se corrigent dans les
    // Options, où le département se saisit à la main.
    if (cinq[1].startsWith('20')) return Number(cinq[1]) < 20200 ? '2A' : '2B';

    const outreMer = cinq[1].slice(0, 3);
    if (DEPARTEMENTS[outreMer]) return outreMer;
    const metropole = cinq[1].slice(0, 2);
    return DEPARTEMENTS[metropole] ? metropole : null;
  }

  const court = texte.match(/^(\d{2,3})$/);
  if (court) {
    if (DEPARTEMENTS[court[1]]) return court[1];
    const deux = court[1].slice(0, 2);
    return DEPARTEMENTS[deux] ? deux : null;
  }
  return null;
}

/** Le nom d'un département, ou null s'il n'existe pas. */
export function nomDepartement(numero) {
  return DEPARTEMENTS[String(numero ?? '').trim().toUpperCase()] ?? null;
}

/**
 * Lit une liste de départements saisie librement : « 67 68 », « 67,68 »,
 * « 67, 68 ». Ne garde que ceux qui existent, sans doublon, dans l'ordre.
 */
export function lireDepartements(saisie) {
  if (Array.isArray(saisie)) saisie = saisie.join(' ');
  const vus = new Set();
  const gardes = [];
  for (const brut of String(saisie ?? '').split(/[^0-9AB]+/i)) {
    const num = String(brut).trim().toUpperCase();
    if (!num || !DEPARTEMENTS[num] || vus.has(num)) continue;
    vus.add(num);
    gardes.push(num);
  }
  return gardes;
}

/** Nettoie une liste de libellés libres : « Villeurbanne, Bron » → deux entrées. */
export function lireLibelles(saisie) {
  if (Array.isArray(saisie)) saisie = saisie.join(',');
  const vus = new Set();
  for (const brut of String(saisie ?? '').split(/[,;\n]+/)) {
    const z = normaliser(brut);
    if (z) vus.add(z);
  }
  return [...vus];
}

/**
 * Fabrique une ville prioritaire complète à partir d'une saisie.
 *
 * L'onglet est TOUJOURS inclus dans la collecte : un onglet qui montre un
 * département qu'on ne collecte pas resterait vide pour toujours, sans que
 * rien ne l'explique. On élargit donc la collecte plutôt que de refuser.
 *
 * @param {object} saisie
 * @param {string} saisie.nom
 * @param {string} [saisie.codePostal]      d'où l'on déduit le département
 * @param {string|string[]} [saisie.onglet]   départements rangés sous ce nom
 * @param {string|string[]} [saisie.collecte] départements où l'on cherche
 * @param {string|string[]} [saisie.communes] communes rangées sous ce nom
 * @param {string|string[]} [saisie.zonesLarges] libellés acceptés à la collecte
 * @returns {object|null} la ville, ou null si elle est inexploitable
 */
export function construireVille(saisie) {
  const nom = String(saisie?.nom ?? '').trim().slice(0, 60);
  if (!nom) return null;

  const duCode = departementDuCode(saisie?.codePostal);
  const onglet = lireDepartements(saisie?.onglet);
  const collecte = lireDepartements(saisie?.collecte);

  // Le département du code postal sert de socle : sans lui, une ville dont on
  // n'a rempli que le nom ne rattacherait aucune offre et l'onglet resterait
  // vide sans raison visible.
  const departementsOnglet = onglet.length ? onglet : (duCode ? [duCode] : []);
  if (!departementsOnglet.length) return null;

  const departementsProches = [...new Set([...departementsOnglet, ...collecte])];
  const departement = duCode ?? departementsOnglet[0];

  const communes = lireLibelles(saisie?.communes);
  const larges = lireLibelles(saisie?.zonesLarges);
  const nomsDeps = (liste) => liste.map(d => normaliser(DEPARTEMENTS[d]));

  return {
    nom,
    departement,
    // Le filet large, pour collecter. Les communes de l'onglet en font partie :
    // ranger une offre dans un onglet sans l'avoir collectée est impossible.
    departementsProches,
    zonesProches: [...new Set([...nomsDeps(departementsProches), ...communes, ...larges])],
    // Le périmètre serré, pour ranger.
    departementsOnglet,
    zonesOnglet: [...new Set([...nomsDeps(departementsOnglet), ...communes])],
  };
}

/**
 * Valide une liste de villes venue de l'interface.
 *
 * @param {object[]} saisies
 * @returns {{villes: object[], erreur: string|null}}
 */
export function validerVilles(saisies) {
  if (!Array.isArray(saisies)) {
    return { villes: [], erreur: 'Liste de villes attendue.' };
  }
  if (saisies.length > VILLES_MAX) {
    return { villes: [], erreur:
      `${VILLES_MAX} villes au maximum : au-delà, les quotas gratuits s'épuisent `
      + 'avant la fin de la collecte et les dernières ne ramènent rien.' };
  }

  const villes = [];
  for (const saisie of saisies) {
    const ville = construireVille(saisie);
    if (!ville) {
      const nom = String(saisie?.nom ?? '').trim();
      return { villes: [], erreur: nom
        ? `« ${nom} » : il manque le code postal, ou le département indiqué n'existe pas.`
        : 'Une ville est sans nom.' };
    }
    villes.push(ville);
  }

  if (!villes.length) {
    return { villes: [], erreur: 'Garde au moins une ville : c\'est elle qui oriente la collecte.' };
  }

  // Deux villes de même nom donneraient deux onglets identiques, dont le
  // second serait inatteignable — l'offre part toujours dans le premier trouvé.
  const noms = villes.map(v => normaliser(v.nom));
  const double = noms.find((n, i) => noms.indexOf(n) !== i);
  if (double) {
    return { villes: [], erreur: `« ${villes[noms.indexOf(double)].nom} » est en double.` };
  }

  return { villes, erreur: null };
}

/** Les noms de départements, normalisés — ce qui est dérivable, donc jetable. */
const NOMS_DEPARTEMENTS = new Set(Object.values(DEPARTEMENTS).map(normaliser));

/**
 * L'inverse de `construireVille` : ce que l'interface affiche pour éditer.
 *
 * Les libellés dérivables d'un département sont écartés — ils se
 * régénéreront. Ne remontent que ceux qu'aucune règle ne saurait retrouver :
 * les communes d'agglomération et les libellés régionaux.
 */
export function decrireVille(ville) {
  const onglet = ville?.departementsOnglet ?? ville?.departementsProches ?? [];
  const collecte = ville?.departementsProches ?? onglet;
  const propres = (liste) => (liste ?? []).filter(z => !NOMS_DEPARTEMENTS.has(z));

  const communes = propres(ville?.zonesOnglet);
  return {
    nom: ville?.nom ?? '',
    departement: ville?.departement ?? onglet[0] ?? '',
    onglet: [...onglet],
    collecte: [...collecte],
    communes,
    zonesLarges: propres(ville?.zonesProches).filter(z => !communes.includes(z)),
  };
}
