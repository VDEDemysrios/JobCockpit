// Moteur d'échecs : règles complètes, et une IA qui cherche vraiment.
//
// POURQUOI UN VRAI MOTEUR
// -----------------------
// Un jeu d'échecs qui accepte les coups illégaux, ignore le clouage ou laisse
// le roi en échec n'est pas un jeu d'échecs : c'est un damier. Et une « IA »
// qui joue au hasard se démasque au troisième coup. Autant ne rien proposer.
//
// Module PUR : ni DOM, ni horloge, ni aléa non maîtrisé. C'est ce qui le rend
// testable — une règle d'échecs fausse ne lève aucune erreur, elle produit
// juste une partie qui n'en est pas une.
//
// REPRÉSENTATION
// --------------
// Plateau de 64 cases, index 0 = a8, 63 = h1 (comme la lecture d'un FEN).
// Une pièce est une chaîne de deux lettres : couleur + type, « bR » = tour
// noire. Case vide : null.

export const BLANC = 'b';
export const NOIR = 'n';

/** Position de départ. */
export function nouvellePartie() {
  const vide = () => Array(8).fill(null);
  const cases = [
    ['nT', 'nC', 'nF', 'nD', 'nR', 'nF', 'nC', 'nT'],
    Array(8).fill('nP'),
    vide(), vide(), vide(), vide(),
    Array(8).fill('bP'),
    ['bT', 'bC', 'bF', 'bD', 'bR', 'bF', 'bC', 'bT'],
  ].flat();

  return {
    cases,
    trait: BLANC,
    // Droits de roque, perdus dès que le roi ou la tour concernée bouge.
    roque: { bR: true, bD: true, nR: true, nD: true },
    // Case de prise en passant possible au coup suivant, ou null.
    enPassant: null,
    // Demi-coups depuis la dernière prise ou poussée de pion (règle des 50).
    demiCoups: 0,
    coups: [],
  };
}

const ligne = (i) => Math.floor(i / 8);
const colonne = (i) => i % 8;
const couleur = (p) => (p ? p[0] : null);
const type = (p) => (p ? p[1] : null);

/** Une case existe-t-elle, et le déplacement ne traverse-t-il pas le bord ? */
function valide(depart, dl, dc) {
  const l = ligne(depart) + dl;
  const c = colonne(depart) + dc;
  if (l < 0 || l > 7 || c < 0 || c > 7) return -1;
  return l * 8 + c;
}

const GLISSE = {
  T: [[-1, 0], [1, 0], [0, -1], [0, 1]],
  F: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  D: [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]],
};
const SAUTE = {
  C: [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]],
  R: [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]],
};

/**
 * Coups PSEUDO-légaux d'une case : les règles de déplacement, sans vérifier
 * si le roi reste en échec. Le filtrage vient après — le faire ici obligerait
 * à une récursion sans fin (pour savoir si le roi est attaqué, il faut
 * générer les coups adverses, qui eux-mêmes…).
 */
function coupsDepuis(etat, depart) {
  const { cases, trait, enPassant } = etat;
  const p = cases[depart];
  if (!p || couleur(p) !== trait) return [];
  const t = type(p);
  const sortie = [];
  const adverse = trait === BLANC ? NOIR : BLANC;

  if (t === 'P') {
    const sens = trait === BLANC ? -1 : 1;
    const depart2 = trait === BLANC ? 6 : 1;
    const promo = trait === BLANC ? 0 : 7;

    const devant = valide(depart, sens, 0);
    if (devant >= 0 && !cases[devant]) {
      if (ligne(devant) === promo) {
        for (const q of ['D', 'T', 'F', 'C']) sortie.push({ depart, arrivee: devant, promotion: q });
      } else {
        sortie.push({ depart, arrivee: devant });
        // Le double pas n'existe que depuis la rangée initiale, et exige les
        // DEUX cases libres — l'oublier laisse sauter par-dessus une pièce.
        const devant2 = valide(depart, sens * 2, 0);
        if (ligne(depart) === depart2 && devant2 >= 0 && !cases[devant2]) {
          sortie.push({ depart, arrivee: devant2, doublePas: true });
        }
      }
    }
    for (const dc of [-1, 1]) {
      const prise = valide(depart, sens, dc);
      if (prise < 0) continue;
      const cible = cases[prise];
      if (cible && couleur(cible) === adverse) {
        if (ligne(prise) === promo) {
          for (const q of ['D', 'T', 'F', 'C']) sortie.push({ depart, arrivee: prise, promotion: q });
        } else sortie.push({ depart, arrivee: prise });
      } else if (prise === enPassant) {
        sortie.push({ depart, arrivee: prise, enPassant: true });
      }
    }
    return sortie;
  }

  if (GLISSE[t]) {
    for (const [dl, dc] of GLISSE[t]) {
      for (let n = 1; n < 8; n++) {
        const a = valide(depart, dl * n, dc * n);
        if (a < 0) break;
        const cible = cases[a];
        if (!cible) { sortie.push({ depart, arrivee: a }); continue; }
        if (couleur(cible) === adverse) sortie.push({ depart, arrivee: a });
        break;
      }
    }
    return sortie;
  }

  for (const [dl, dc] of SAUTE[t]) {
    const a = valide(depart, dl, dc);
    if (a < 0) continue;
    const cible = cases[a];
    if (!cible || couleur(cible) === adverse) sortie.push({ depart, arrivee: a });
  }

  if (t === 'R') {
    // ROQUE. Trois conditions qu'on oublie facilement, et qui produisent
    // chacune une position illégale : le roi ne doit pas être en échec, ne
    // doit pas TRAVERSER une case attaquée, et n'arrive pas sur une case
    // attaquée. Les deux dernières sont vérifiées ici ; la première aussi.
    const base = trait === BLANC ? 56 : 0;
    const cle = trait === BLANC ? 'b' : 'n';
    if (depart === base + 4 && !estAttaquee(etat, base + 4, adverse)) {
      if (etat.roque[`${cle}R`]
        && !cases[base + 5] && !cases[base + 6]
        && cases[base + 7] === `${cle}T`
        && !estAttaquee(etat, base + 5, adverse)
        && !estAttaquee(etat, base + 6, adverse)) {
        sortie.push({ depart, arrivee: base + 6, roque: 'R' });
      }
      if (etat.roque[`${cle}D`]
        && !cases[base + 1] && !cases[base + 2] && !cases[base + 3]
        && cases[base] === `${cle}T`
        && !estAttaquee(etat, base + 3, adverse)
        && !estAttaquee(etat, base + 2, adverse)) {
        sortie.push({ depart, arrivee: base + 2, roque: 'D' });
      }
    }
  }
  return sortie;
}

/** Cette case est-elle attaquée par `par` ? Sans générer de coups complets. */
export function estAttaquee(etat, cible, par) {
  const { cases } = etat;
  const sens = par === BLANC ? 1 : -1;   // d'où viendrait un pion attaquant

  for (const dc of [-1, 1]) {
    const i = valide(cible, sens, dc);
    if (i >= 0 && cases[i] === `${par}P`) return true;
  }
  for (const [dl, dc] of SAUTE.C) {
    const i = valide(cible, dl, dc);
    if (i >= 0 && cases[i] === `${par}C`) return true;
  }
  for (const [dl, dc] of SAUTE.R) {
    const i = valide(cible, dl, dc);
    if (i >= 0 && cases[i] === `${par}R`) return true;
  }
  for (const [nom, dirs] of [['T', GLISSE.T], ['F', GLISSE.F]]) {
    for (const [dl, dc] of dirs) {
      for (let n = 1; n < 8; n++) {
        const i = valide(cible, dl * n, dc * n);
        if (i < 0) break;
        const p = cases[i];
        if (!p) continue;
        if (couleur(p) === par && (type(p) === nom || type(p) === 'D')) return true;
        break;
      }
    }
  }
  return false;
}

/** Où est le roi de cette couleur ? */
function roi(etat, c) {
  return etat.cases.indexOf(`${c}R`);
}

export function enEchec(etat, c = etat.trait) {
  const r = roi(etat, c);
  return r >= 0 && estAttaquee(etat, r, c === BLANC ? NOIR : BLANC);
}

/**
 * Applique un coup et rend un NOUVEL état. Aucune mutation : c'est ce qui
 * permet à l'IA d'explorer sans avoir à défaire, et au reste du code de
 * comparer deux positions sans se demander laquelle a bougé.
 */
export function jouer(etat, coup) {
  const cases = etat.cases.slice();
  const p = cases[coup.depart];
  const t = type(p);
  const c = couleur(p);
  const roque = { ...etat.roque };

  cases[coup.depart] = null;
  cases[coup.arrivee] = coup.promotion ? `${c}${coup.promotion}` : p;

  if (coup.enPassant) {
    // Le pion pris n'est PAS sur la case d'arrivée : il est juste derrière.
    cases[coup.arrivee + (c === BLANC ? 8 : -8)] = null;
  }
  if (coup.roque) {
    const base = c === BLANC ? 56 : 0;
    if (coup.roque === 'R') { cases[base + 5] = cases[base + 7]; cases[base + 7] = null; }
    else { cases[base + 3] = cases[base]; cases[base] = null; }
  }

  // Droits de roque perdus : roi qui bouge, tour qui bouge, tour capturée.
  if (t === 'R') { roque[`${c}R`] = false; roque[`${c}D`] = false; }
  if (t === 'T') {
    const base = c === BLANC ? 56 : 0;
    if (coup.depart === base + 7) roque[`${c}R`] = false;
    if (coup.depart === base) roque[`${c}D`] = false;
  }
  for (const [adv, base] of [[BLANC, 56], [NOIR, 0]]) {
    if (coup.arrivee === base + 7) roque[`${adv}R`] = false;
    if (coup.arrivee === base) roque[`${adv}D`] = false;
  }

  const prise = Boolean(etat.cases[coup.arrivee]) || coup.enPassant;

  return {
    cases,
    trait: c === BLANC ? NOIR : BLANC,
    roque,
    enPassant: coup.doublePas ? (coup.depart + coup.arrivee) / 2 : null,
    demiCoups: (t === 'P' || prise) ? 0 : etat.demiCoups + 1,
    coups: [...etat.coups, coup],
  };
}

/** Les coups LÉGAUX : pseudo-légaux, moins ceux qui laissent le roi en échec. */
export function coupsLegaux(etat) {
  const sortie = [];
  for (let i = 0; i < 64; i++) {
    if (couleur(etat.cases[i]) !== etat.trait) continue;
    for (const coup of coupsDepuis(etat, i)) {
      if (!enEchec(jouer(etat, coup), etat.trait)) sortie.push(coup);
    }
  }
  return sortie;
}

/** Mat, pat, nulle, ou rien. */
export function issue(etat) {
  if (coupsLegaux(etat).length === 0) {
    return enEchec(etat) ? { fin: 'mat', gagnant: etat.trait === BLANC ? NOIR : BLANC }
      : { fin: 'pat' };
  }
  if (etat.demiCoups >= 100) return { fin: 'nulle', raison: '50 coups sans prise ni pion' };
  // Matériel insuffisant : roi seul contre roi, ou roi et pièce mineure.
  const restants = etat.cases.filter(Boolean).map(type).sort().join('');
  if (['RR', 'CRR', 'FRR'].includes(restants)) {
    return { fin: 'nulle', raison: 'matériel insuffisant' };
  }
  return null;
}

// ─────────────────────────────────── L'IA

const VALEUR = { P: 100, C: 320, F: 330, T: 500, D: 900, R: 20000 };

/**
 * Tables de position : où une pièce est-elle bien placée.
 *
 * Sans elles, une IA à matériel égal joue n'importe quoi — elle sort sa dame
 * au deuxième coup et laisse ses pions doublés, parce que rien ne distingue
 * deux positions de même valeur. Ce sont ces tables qui donnent l'impression
 * d'un adversaire qui « comprend » quelque chose.
 *
 * Écrites du point de vue des BLANCS ; on les retourne pour les noirs.
 */
const TABLES = {
  P: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  C: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  F: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  T: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  D: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  R: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 20, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};

/** Évaluation, du point de vue des blancs. Positif = les blancs sont mieux. */
export function evaluer(etat) {
  let note = 0;
  for (let i = 0; i < 64; i++) {
    const p = etat.cases[i];
    if (!p) continue;
    const t = type(p);
    const pos = couleur(p) === BLANC ? TABLES[t][i] : TABLES[t][63 - i];
    note += (couleur(p) === BLANC ? 1 : -1) * (VALEUR[t] + pos);
  }
  return note;
}

/** Les prises d'abord : c'est ce qui fait travailler l'élagage alpha-bêta. */
function ordonner(etat, coups) {
  return coups.slice().sort((a, b) => {
    const va = etat.cases[a.arrivee] ? VALEUR[type(etat.cases[a.arrivee])] : 0;
    const vb = etat.cases[b.arrivee] ? VALEUR[type(etat.cases[b.arrivee])] : 0;
    return vb - va;
  });
}

function negamax(etat, profondeur, alpha, beta, signe) {
  const fin = issue(etat);
  if (fin) {
    if (fin.fin === 'mat') {
      // Le mat le PLUS COURT vaut mieux : sans la profondeur dans la note,
      // l'IA voit un mat en 1 et un mat en 5 comme équivalents, et tourne en
      // rond au lieu de conclure.
      return signe * (fin.gagnant === BLANC ? 1 : -1) * (100000 + profondeur);
    }
    return 0;
  }
  if (profondeur === 0) return signe * evaluer(etat);

  let meilleure = -Infinity;
  for (const coup of ordonner(etat, coupsLegaux(etat))) {
    const note = -negamax(jouer(etat, coup), profondeur - 1, -beta, -alpha, -signe);
    if (note > meilleure) meilleure = note;
    if (meilleure > alpha) alpha = meilleure;
    if (alpha >= beta) break;
  }
  return meilleure;
}

/**
 * Le coup choisi par l'IA.
 *
 * @param {object} etat
 * @param {number} profondeur   2 = débutant, 3 = correct, 4 = solide (et lent)
 * @param {() => number} alea   injecté : une IA testable ne tire pas au sort
 *                              toute seule. Sert à départager les coups de
 *                              même valeur, faute de quoi elle rejoue
 *                              exactement la même partie chaque fois.
 */
export function meilleurCoup(etat, profondeur = 3, alea = Math.random) {
  const signe = etat.trait === BLANC ? 1 : -1;
  const coups = ordonner(etat, coupsLegaux(etat));
  if (!coups.length) return null;

  let meilleures = [];
  let meilleure = -Infinity;
  for (const coup of coups) {
    const note = -negamax(jouer(etat, coup), profondeur - 1, -Infinity, Infinity, -signe);
    if (note > meilleure) { meilleure = note; meilleures = [coup]; }
    else if (note === meilleure) meilleures.push(coup);
  }
  return meilleures[Math.floor(alea() * meilleures.length)];
}

/** Notation lisible d'un coup : « e2-e4 », « O-O », « e7-e8=D ». */
export function notation(coup) {
  if (coup.roque) return coup.roque === 'R' ? 'O-O' : 'O-O-O';
  const nom = (i) => 'abcdefgh'[colonne(i)] + (8 - ligne(i));
  return nom(coup.depart) + '-' + nom(coup.arrivee)
    + (coup.promotion ? `=${coup.promotion}` : '');
}
