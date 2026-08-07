// Le choix du jour : trois offres, pas trois cents.
//
// LE CONSTAT QUI A MENÉ ICI
// -------------------------
// 341 offres collectées, UNE candidature envoyée. L'outil ramassait très bien
// et n'aidait pas à agir. Le tableau de bord annonçait « 282 actions en
// attente » — ce n'est pas une liste de tâches, c'est un mur.
//
// L'entonnoir mesuré sur la base explique le blocage :
//     374  offres
//     200  prioritaires
//      81  dans une ville visée      <- la vraie chute
//      54  fraîches, analysées, intactes
// Les bonnes existent. Elles sont noyées dans sept fois leur nombre.
//
// TROIS, ET PAS UN DE PLUS
// ------------------------
// Trois candidatures soignées par jour, c'est ce qu'une personne tient
// réellement. Le nombre est petit EXPRÈS : une sélection de vingt redeviendrait
// une liste, et une liste redevient un mur. Les trois ne se renouvellent pas
// quand on les traite — les finir est la victoire du jour.
//
// AUCUN HASARD, AUCUNE ROTATION
// -----------------------------
// Ce sont les MEILLEURES du moment, pas trois tirées au sort. Elles restent
// donc jusqu'à ce qu'on s'en occupe : impossible d'esquiver une offre en
// rechargeant la page. Pour en écarter une, il y a le bouton prévu pour ça —
// un refus explicite, pas un tirage plus clément.

/** Les critères, du plus exigeant au plus lâche. */
const CRITERES = [
  { nom: 'prioritaire', test: (o) => o.groupe === 1 },
  { nom: 'dans une ville visée', test: (o) => Boolean(o.villePrio) },
  { nom: 'fraîche', test: (o) => o.age !== null && o.age <= 14 },
  { nom: 'pas diffusée partout', test: (o) => (o.villesRepubliees ?? 1) <= 2 },
  { nom: 'déjà analysée', test: (o) => Boolean(o.analyse) },
];

/** Âge en jours d'une offre, ou null si la date manque. */
function ageEnJours(dateOffre) {
  if (!dateOffre) return null;
  const j = Math.floor((Date.now() - new Date(dateOffre).getTime()) / 86400000);
  return Number.isFinite(j) ? j : null;
}

/** Une offre sur laquelle il reste quelque chose à faire. */
function aTraiter(offre) {
  return (offre.suivi?.status ?? 'À postuler') === 'À postuler';
}

/**
 * Les offres du jour.
 *
 * Les critères se relâchent un par un tant qu'il n'y en a pas assez : mieux
 * vaut proposer trois offres correctes que deux parfaites et un vide. La
 * dernière exigence lâchée en premier est la moins déterminante — une analyse
 * absente se rattrape, une ville hors zone non.
 *
 * @param {object[]} offres  les offres telles que l'API les rend
 * @param {number} [combien]
 * @returns {{offres: object[], criteresRelaches: string[], vivier: number}}
 */
export function offresDuJour(offres, combien = 3) {
  const candidates = offres
    .filter(aTraiter)
    .map(o => ({ ...o, age: ageEnJours(o.dateOffre) }));

  // On retire les exigences par la fin, une à la fois, jusqu'à en avoir assez.
  let retenues = [];
  let relaches = [];
  for (let garde = CRITERES.length; garde >= 1; garde--) {
    const actifs = CRITERES.slice(0, garde);
    retenues = candidates.filter(o => actifs.every(c => c.test(o)));
    relaches = CRITERES.slice(garde).map(c => c.nom);
    if (retenues.length >= combien) break;
  }

  // Le meilleur score d'abord, puis la plus fraîche : une offre publiée le jour
  // même a plus de chances d'être encore ouverte qu'une de quinze jours.
  const classees = retenues.sort((a, b) =>
    (b.score ?? 0) - (a.score ?? 0)
    || (a.age ?? 99) - (b.age ?? 99)
    || String(a.id).localeCompare(String(b.id)));

  return {
    offres: classees.slice(0, combien),
    criteresRelaches: relaches,
    vivier: retenues.length,
  };
}

/**
 * Ce qui a été accompli aujourd'hui, pour le compteur.
 *
 * On compte les candidatures ENVOYÉES dans la journée, pas les lettres
 * écrites : une lettre est un brouillon, une candidature est un acte.
 */
export function envoyeesAujourdhui(offres) {
  const aujourdhui = new Date().toISOString().slice(0, 10);
  return offres.filter(o => o.suivi?.sent === aujourdhui).length;
}
