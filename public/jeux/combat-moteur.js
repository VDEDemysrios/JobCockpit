// Le moteur du jeu de combat : états, collisions, arbitrage, IA.
//
// Module PUR : ni canevas, ni clavier, ni horloge. Il reçoit des intentions
// (« avance », « frappe fort ») et fait avancer la simulation d'UNE image.
// C'est ce qui le rend testable — et dans un jeu de combat, presque tout ce
// qui compte est invisible : une image de départ de trop, un coup qui reste
// actif après la fin de son animation, une portée mal mesurée. Rien de tout
// cela ne lève d'erreur ; ça rend juste le jeu injouable.
//
// LE MODÈLE, EN UNE PHRASE
// ------------------------
// Chaque combattant est dans UN état à la fois (repos, marche, esquive,
// attaque, encaissement, garde), et cet état dit ce qu'il a le droit de
// faire. Un jeu de combat n'est rien d'autre que cette table de droits.
import { COMBATTANTS, ARENE, REGLES } from './combat-donnees.js';

export const ETATS = {
  REPOS: 'repos',
  MARCHE: 'marche',
  ESQUIVE: 'esquive',
  GARDE: 'garde',
  ATTAQUE: 'attaque',
  TOUCHE: 'touche',
  BLOQUE: 'bloque',
  KO: 'ko',
};

/** Les états pendant lesquels on ne peut RIEN entreprendre. */
const OCCUPE = new Set([ETATS.ATTAQUE, ETATS.TOUCHE, ETATS.BLOQUE, ETATS.ESQUIVE, ETATS.KO]);

function creerCombattant(cle, x, sens) {
  const c = COMBATTANTS[cle];
  return {
    cle, x, sens,
    vie: c.vie, vieMax: c.vie,
    etat: ETATS.REPOS,
    image: 0,          // compteur dans l'état courant
    coup: null,        // le coup en cours, s'il y en a un
    aTouche: false,    // un coup ne touche qu'UNE fois par activation
    armure: 0,
    vitesseX: 0,
    combo: 0,
  };
}

export function nouvelleRencontre(cleA, cleB, { round = 1, scores = [0, 0] } = {}) {
  const milieu = ARENE.largeur / 2;
  const d = REGLES.distanceDepart / 2;
  return {
    a: creerCombattant(cleA, milieu - d, 1),
    b: creerCombattant(cleB, milieu + d, -1),
    projectiles: [],
    temps: REGLES.duree,
    round,
    scores: [...scores],
    fin: null,        // null | { vainqueur: 'a'|'b'|null, raison }
    secousse: 0,      // retour visuel d'impact, décrémenté par le rendu
    annonce: null,
  };
}

const donnees = (f) => COMBATTANTS[f.cle];

/** Boîte de collision d'un combattant. Rectangle simple : suffisant au sol. */
export function boite(f) {
  return { x: f.x - 26, y: 0, l: 52, h: 108 };
}

/**
 * Boîte du coup EN COURS, ou null s'il n'est pas actif.
 *
 * Elle n'existe que pendant les images actives : un coup dont la boîte
 * traînerait pendant la récupération toucherait après la fin de son
 * animation, ce qui est le défaut le plus déroutant qui soit — on se fait
 * frapper par un coup qu'on voit se terminer.
 */
export function boiteCoup(f) {
  if (f.etat !== ETATS.ATTAQUE || !f.coup) return null;
  const c = f.coup;

  // UN COUP À PROJECTILE NE FRAPPE PAS AUSSI AU CORPS À CORPS.
  //
  // Le défaut le plus coûteux de ce moteur, et invisible : `portee` décrivait
  // la distance d'apparition du projectile, mais servait AUSSI de boîte de
  // contact. Le samouraï frappait donc à 210 unités — presque le double du
  // plus long coup de mêlée du jeu — tout en lançant sa lame de vent.
  //
  // Mesuré sur 40 combats : son special touchait 820 fois contre 12 pour le
  // projectile lui-même. Il gagnait 97 % des matchs sans qu'aucun test ne
  // signale quoi que ce soit.
  //
  // Le projectile porte les dégâts ; le geste qui le lance n'en porte aucun.
  if (c.projectile) return null;
  const debut = c.depart;
  const fin = c.depart + c.actif;
  if (f.image < debut || f.image >= fin) return null;

  const l = c.portee;
  return {
    x: f.sens > 0 ? f.x + 18 : f.x - 18 - l,
    y: 108 - c.hauteur - 18,
    l,
    h: c.hauteur,
  };
}

const seChevauchent = (p, q) =>
  p && q && p.x < q.x + q.l && p.x + p.l > q.x && p.y < q.y + q.h && p.y + p.h > q.y;

/** Le combattant garde-t-il vraiment ? Il faut reculer, et être libre. */
function gardeActive(f, intention) {
  if (OCCUPE.has(f.etat)) return false;
  return intention.recule === true;
}

function lancerCoup(f, nom) {
  const c = donnees(f).coups[nom];
  if (!c) return;
  f.etat = ETATS.ATTAQUE;
  f.image = 0;
  f.coup = { ...c, nom: nom };
  f.aTouche = false;
  f.armure = c.armure ?? 0;
}

/**
 * Applique un coup encaissé.
 *
 * L'ARMURE ABSORBE, MAIS NE PROTÈGE PAS DES DÉGÂTS. Sinon le lourd
 * traverserait le jeu sans jamais perdre de vie ; là, il paie son entrée.
 */
function encaisser(cible, coup, sensAttaquant, garde) {
  const d = donnees(cible);
  const chip = garde ? REGLES.chip : 1;
  const degats = Math.round(coup.degats * chip);

  cible.vie = Math.max(0, cible.vie - degats);

  if (garde) {
    cible.etat = ETATS.BLOQUE;
    cible.image = 0;
    cible.vitesseX = sensAttaquant * (coup.poussee * 0.45) / d.poids;
    cible.combo = 0;
    return { degats, garde: true };
  }

  if (cible.armure > 0) {
    // L'armure encaisse le recul, pas les dégâts : le porteur continue son
    // coup. C'est ce qui permet au lourd d'entrer face à un adversaire qui
    // le mitraille de coups faibles.
    cible.armure -= 1;
    return { degats, garde: false, absorbe: true };
  }

  cible.etat = ETATS.TOUCHE;
  cible.image = 0;
  cible.coup = null;
  cible.vitesseX = sensAttaquant * coup.poussee / d.poids;
  cible.combo += 1;
  if (cible.vie <= 0) { cible.etat = ETATS.KO; cible.image = 0; }
  return { degats, garde: false };
}

/** Durée de l'état d'encaissement, allongée par le poids du coup. */
const dureeHitstun = (coup) => REGLES.hitstunBase + Math.round(coup.degats / 12);
const dureeBlockstun = (coup) => REGLES.blockstunBase + Math.round(coup.degats / 22);

/**
 * Avance la simulation d'UNE image.
 *
 * @param {object} etat
 * @param {object} intentions  { a: {...}, b: {...} } — avance, recule, leger,
 *                             lourd, special, esquive
 * @returns {object} le nouvel état (muté sur place : un jeu à 60 images par
 *                   seconde ne peut pas se permettre de tout recopier)
 */
export function avancer(etat, intentions) {
  if (etat.fin) return etat;

  etat.temps = Math.max(0, etat.temps - 1);
  const paires = [['a', 'b'], ['b', 'a']];

  // 1. Orientation : on regarde toujours l'adversaire. Un combattant qui
  //    frappe dans le vide parce qu'il est retourné n'amuse personne.
  for (const [moi, lui] of paires) {
    const f = etat[moi];
    if (OCCUPE.has(f.etat)) continue;
    f.sens = etat[lui].x >= f.x ? 1 : -1;
  }

  // 2. Intentions et déplacements.
  for (const [moi] of paires) {
    const f = etat[moi];
    const i = intentions[moi] ?? {};
    const d = donnees(f);
    f.image += 1;

    if (f.etat === ETATS.KO) continue;

    if (f.etat === ETATS.ATTAQUE) {
      const total = f.coup.depart + f.coup.actif + f.coup.recup;
      // L'avance du coup se fait pendant le DÉPART : elle sert à entrer, pas
      // à poursuivre l'adversaire une fois le coup lancé.
      if (f.coup.avance && f.image <= f.coup.depart) {
        f.x += f.sens * (f.coup.avance / f.coup.depart);
      }
      if (f.image >= total) { f.etat = ETATS.REPOS; f.image = 0; f.coup = null; f.armure = 0; }
      continue;
    }

    if (f.etat === ETATS.TOUCHE || f.etat === ETATS.BLOQUE) {
      const duree = f.etat === ETATS.TOUCHE ? f.hitstun ?? 14 : f.blockstun ?? 9;
      f.x += f.vitesseX;
      f.vitesseX *= 0.82;
      if (f.image >= duree) { f.etat = ETATS.REPOS; f.image = 0; f.combo = 0; }
      continue;
    }

    if (f.etat === ETATS.ESQUIVE) {
      f.x += f.sens * (i.esquiveArriere ? -1 : 1) * REGLES.dashVitesse;
      if (f.image >= REGLES.dashImages) { f.etat = ETATS.REPOS; f.image = 0; }
      continue;
    }

    // Libre d'agir.
    if (i.esquive) { f.etat = ETATS.ESQUIVE; f.image = 0; continue; }
    if (i.leger) { lancerCoup(f, 'leger'); continue; }
    if (i.lourd) { lancerCoup(f, 'lourd'); continue; }
    if (i.special) { lancerCoup(f, 'special'); continue; }

    if (gardeActive(f, i)) {
      f.etat = ETATS.GARDE;
      // On recule EN GARDANT, plus lentement : c'est ce qui rend le repli
      // possible sans le rendre gratuit.
      f.x -= f.sens * d.vitesse * 0.55;
      continue;
    }
    if (i.avance) { f.etat = ETATS.MARCHE; f.x += f.sens * d.vitesse; continue; }
    if (i.recule) { f.etat = ETATS.MARCHE; f.x -= f.sens * d.vitesse; continue; }
    f.etat = ETATS.REPOS;
  }

  // 3. Coups portés. On résout les DEUX avant d'appliquer, sinon celui qui
  //    est traité en premier annule le coup de l'autre — et le jeu devient
  //    injuste selon l'ordre des lettres.
  const impacts = [];
  for (const [moi, lui] of paires) {
    const f = etat[moi];
    const c = etat[lui];
    if (f.aTouche) continue;
    const bc = boiteCoup(f);
    if (!bc || !seChevauchent(bc, boite(c))) continue;

    const garde = c.etat === ETATS.GARDE && !f.coup.imparable;
    impacts.push({ attaquant: f, cible: c, coup: f.coup, garde });
  }
  for (const im of impacts) {
    im.attaquant.aTouche = true;
    const r = encaisser(im.cible, im.coup, im.attaquant.sens, im.garde);
    im.cible.hitstun = dureeHitstun(im.coup);
    im.cible.blockstun = dureeBlockstun(im.coup);
    etat.secousse = Math.max(etat.secousse, im.garde ? 3 : 8);
    if (!im.garde && im.coup.traverse) {
      // Le coup traversant fait passer DERRIÈRE : on échange les positions
      // de part et d'autre, c'est la signature du ninja.
      im.attaquant.x = im.cible.x + im.attaquant.sens * 46;
    }
  }

  // 4. Projectiles.
  for (const p of etat.projectiles) p.x += p.sens * p.vitesse;
  for (const [moi, lui] of paires) {
    const f = etat[moi];
    if (f.etat === ETATS.ATTAQUE && f.coup?.projectile && f.image === f.coup.depart) {
      etat.projectiles.push({
        de: moi, x: f.x + f.sens * 40, sens: f.sens,
        vitesse: f.coup.projectile.vitesse,
        restant: f.coup.projectile.portee,
        degats: f.coup.degats, poussee: f.coup.poussee,
      });
    }
  }
  etat.projectiles = etat.projectiles.filter(p => {
    p.restant -= p.vitesse;
    if (p.restant <= 0) return false;
    const cible = etat[p.de === 'a' ? 'b' : 'a'];
    const b = boite(cible);
    if (p.x > b.x && p.x < b.x + b.l) {
      const garde = cible.etat === ETATS.GARDE;
      encaisser(cible, { degats: p.degats, poussee: p.poussee }, p.sens, garde);
      cible.hitstun = 16; cible.blockstun = 10;
      etat.secousse = Math.max(etat.secousse, garde ? 3 : 6);
      return false;
    }
    return true;
  });

  // 5. Interpénétration, PUIS murs — et le coin en dernier.
  //
  // L'ORDRE EST LE PIÈGE. Plaquer aux murs d'abord puis séparer laisse la
  // poussée renvoyer un combattant HORS de l'arène : dans un coin, on glisse
  // dehors. On sépare donc en premier, on replace ensuite, et si l'un est
  // acculé on pousse l'AUTRE — c'est aussi ce qu'on attend d'un coin dans un
  // jeu de combat : le dos au mur, on ne recule plus, l'adversaire si.
  const MINI = 48;
  const gauche = ARENE.mur;
  const droite = ARENE.largeur - ARENE.mur;

  const separer = () => {
    const ecart = etat.b.x - etat.a.x;
    if (Math.abs(ecart) >= MINI) return;
    const manque = (MINI - Math.abs(ecart)) / 2;
    const s = ecart >= 0 ? 1 : -1;
    const pa = donnees(etat.a).poids;
    const pb = donnees(etat.b).poids;
    const total = pa + pb;
    etat.a.x -= s * manque * (2 * pb / total);
    etat.b.x += s * manque * (2 * pa / total);
  };

  separer();
  for (const f of [etat.a, etat.b]) f.x = Math.min(droite, Math.max(gauche, f.x));

  // Après recadrage, ils peuvent se chevaucher à nouveau si l'un touche le
  // mur : on décale alors celui qui a de la place.
  const reste = MINI - Math.abs(etat.b.x - etat.a.x);
  if (reste > 0) {
    const s = etat.b.x >= etat.a.x ? 1 : -1;
    const aAcculé = etat.a.x <= gauche + 0.5 || etat.a.x >= droite - 0.5;
    if (aAcculé) etat.b.x = Math.min(droite, Math.max(gauche, etat.b.x + s * reste));
    else etat.a.x = Math.min(droite, Math.max(gauche, etat.a.x - s * reste));
  }

  // 6. Fin de round.
  if (etat.a.vie <= 0 || etat.b.vie <= 0) {
    const vainqueur = etat.a.vie <= 0 && etat.b.vie <= 0 ? null
      : etat.a.vie <= 0 ? 'b' : 'a';
    etat.fin = { vainqueur, raison: 'ko' };
  } else if (etat.temps <= 0) {
    const ra = etat.a.vie / etat.a.vieMax;
    const rb = etat.b.vie / etat.b.vieMax;
    etat.fin = { vainqueur: ra === rb ? null : ra > rb ? 'a' : 'b', raison: 'temps' };
  }

  return etat;
}

// ─────────────────────────────────── L'IA

/**
 * L'adversaire.
 *
 * ELLE NE LIT PAS LES INTENTIONS DU JOUEUR. Une IA qui réagit à l'image près
 * à ce qu'on vient d'appuyer est imbattable et détestable : on n'a pas
 * l'impression d'affronter quelqu'un, mais de se faire lire. Celle-ci décide
 * d'après ce qu'elle VOIT — la distance, l'état visible de l'adversaire — et
 * avec un temps de réaction.
 *
 * @param {object} etat
 * @param {'a'|'b'} moi
 * @param {number} niveau  1 = tranquille, 2 = correct, 3 = coriace
 * @param {() => number} alea
 */
export function intentionIA(etat, moi, niveau = 2, alea = Math.random) {
  const f = etat[moi];
  const c = etat[moi === 'a' ? 'b' : 'a'];
  const rien = {};
  if (OCCUPE.has(f.etat) || etat.fin) return rien;

  const d = donnees(f);
  const distance = Math.abs(c.x - f.x);
  const coups = d.coups;

  // Le temps de réaction : plus le niveau est bas, plus elle hésite.
  const hesite = [0.42, 0.2, 0.07][niveau - 1] ?? 0.2;
  if (alea() < hesite) return rien;

  // GARDER quand l'adversaire attaque et qu'on est à portée. Le niveau 1
  // garde rarement, le niveau 3 presque toujours — c'est là que se joue
  // l'essentiel de la difficulté ressentie.
  const menace = c.etat === ETATS.ATTAQUE && distance < (c.coup?.portee ?? 0) + 40;
  // Une IA qui garde peu rend inutile le seul outil de l'empoigneur — son
  // coup imparable ne vaut que face à quelqu'un qui bloque. Relevé après
  // mesure : le lutteur plafonnait à 21 % de victoires.
  const gardeSi = [0.4, 0.78, 0.93][niveau - 1] ?? 0.78;
  if (menace && alea() < gardeSi) return { recule: true };

  // PUNIR : l'adversaire vient de rater, on a une fenêtre. C'est ce qui donne
  // l'impression d'un adversaire qui comprend le jeu.
  const punissable = c.etat === ETATS.ATTAQUE
    && c.image > (c.coup?.depart ?? 0) + (c.coup?.actif ?? 0);
  if (punissable && distance < coups.lourd.portee && alea() < 0.7) {
    return { lourd: true };
  }

  // LA BONNE DISTANCE SE MESURE SUR CE QU'ON RISQUE, PAS SUR CE QU'ON PORTE.
  //
  // Première version : la distance visée venait du coup LÉGER du personnage.
  // Conséquence mesurée sur 900 combats — le samouraï gagnait 96 % en
  // n'encaissant que 22 dégâts par seconde contre 51 à 72 pour les autres. Il
  // se tenait à 51 unités et frappait à 104 : hors de portée de l'adversaire,
  // à portée de lui. Une position gratuite.
  //
  // On tient donc compte de la portée ADVERSE : on se place juste au-delà de
  // ce qui peut nous toucher, et on entre pour frapper. C'est ce que fait un
  // joueur, et c'est ce qui rend les six personnages comparables.
  const menaceAdverse = Math.max(
    COMBATTANTS[c.cle].coups.leger.portee,
    COMBATTANTS[c.cle].coups.lourd.portee * 0.72,
  );
  const maPortee = Math.max(coups.leger.portee, coups.lourd.portee * 0.8);

  const ideale = d.archetype === 'Zoneur' ? Math.max(maPortee * 0.95, menaceAdverse + 20)
    : d.archetype === 'Empoigneur' ? coups.special.portee * 0.85
      : Math.min(maPortee * 0.85, menaceAdverse + 6);

  if (distance > ideale + 30) {
    if (coups.special.projectile && alea() < 0.22) return { special: true };
    if (alea() < 0.12) return { esquive: true };
    return { avance: true };
  }
  if (distance < ideale - 40 && d.archetype !== 'Empoigneur') {
    return { recule: true };
  }

  // À portée : on frappe, en variant. Une IA qui répète un seul coup se lit
  // en trois secondes.
  const tirage = alea();
  if (d.archetype === 'Empoigneur' && distance < coups.special.portee && tirage < 0.35) {
    return { special: true };
  }
  if (tirage < 0.45) return { leger: true };
  if (tirage < 0.7) return { lourd: true };
  if (tirage < 0.82) return { special: true };
  return { avance: true };
}
