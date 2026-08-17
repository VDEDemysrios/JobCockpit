// LE MOTEUR D'ÉCHECS : les règles, vérifiées par comptage exhaustif.
//
// Une règle d'échecs fausse ne lève aucune erreur. Elle produit une partie
// qui n'en est pas une : un roi qui reste en échec, un roque à travers une
// case attaquée, une prise en passant qui laisse le pion en vie. Rien de tout
// cela ne se voit en jouant deux coups.
//
// D'où le PERFT : on compte toutes les positions atteignables à N coups, et
// on compare aux valeurs de référence, connues et publiées. Un seul écart
// signale un défaut de génération — c'est le test le plus impitoyable qui
// soit pour un moteur d'échecs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nouvellePartie, coupsLegaux, jouer, enEchec, issue, meilleurCoup,
  evaluer, notation, BLANC, NOIR,
} from '../public/jeux/echecs-moteur.js';

function perft(etat, profondeur) {
  if (profondeur === 0) return 1;
  let n = 0;
  for (const coup of coupsLegaux(etat)) n += perft(jouer(etat, coup), profondeur - 1);
  return n;
}

test('perft : la génération de coups est exacte jusqu\'à 4 demi-coups', () => {
  const d = nouvellePartie();
  assert.equal(perft(d, 1), 20, '20 premiers coups : 16 de pions, 4 de cavaliers');
  assert.equal(perft(d, 2), 400);
  assert.equal(perft(d, 3), 8902);
  assert.equal(perft(d, 4), 197281);
});

/** Position « Kiwipete » : roques, prises en passant, clouages. La référence. */
test('perft : position piégeuse, roques et prises en passant compris', () => {
  const etat = nouvellePartie();
  // r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -
  const rangs = ['r3k2r', 'p1ppqpb1', 'bn2pnp1', '3PN3', '1p2P3', '2N2Q1p', 'PPPBBPPP', 'R3K2R'];
  const cases = [];
  for (const r of rangs) {
    for (const c of r) {
      if (/\d/.test(c)) { for (let i = 0; i < Number(c); i++) cases.push(null); continue; }
      const t = { p: 'P', n: 'C', b: 'F', r: 'T', q: 'D', k: 'R' }[c.toLowerCase()];
      cases.push((c === c.toUpperCase() ? 'b' : 'n') + t);
    }
  }
  etat.cases = cases;
  etat.trait = BLANC;
  etat.roque = { bR: true, bD: true, nR: true, nD: true };

  assert.equal(perft(etat, 1), 48);
  assert.equal(perft(etat, 2), 2039);
  assert.equal(perft(etat, 3), 97862);
});

/** Un coup qui laisse son propre roi en échec n'est pas un coup. */
test('le clouage est respecté', () => {
  const e = nouvellePartie();
  e.cases = Array(64).fill(null);
  e.cases[60] = 'bR';   // roi blanc e1
  e.cases[52] = 'bF';   // fou blanc e2, cloué
  e.cases[4] = 'nD';    // dame noire e8
  e.roque = { bR: false, bD: false, nR: false, nD: false };

  const depuisFou = coupsLegaux(e).filter(c => c.depart === 52);
  assert.ok(depuisFou.length === 0,
    'le fou cloué ne peut pas bouger : il découvrirait son roi');
});

test('le mat du berger est reconnu comme un mat', () => {
  let e = nouvellePartie();
  // e4 e5 · Fc4 Cc6 · Dh5 Cf6?? · Dxf7#
  // Indices : 0 = a8, 63 = h1. e2=52 e4=36 · e7=12 e5=28 · f1=61 c4=34
  //           b8=1 c6=18 · d1=59 h5=31 · g8=6 f6=21 · f7=13
  for (const [d, a] of [[52, 36], [12, 28], [61, 34], [1, 18], [59, 31], [6, 21], [31, 13]]) {
    const coup = coupsLegaux(e).find(c => c.depart === d && c.arrivee === a);
    assert.ok(coup, `coup ${d}->${a} introuvable`);
    e = jouer(e, coup);
  }
  const fin = issue(e);
  assert.equal(fin?.fin, 'mat');
  assert.equal(fin.gagnant, BLANC);
});

test('le pat n\'est pas un mat', () => {
  const e = nouvellePartie();
  e.cases = Array(64).fill(null);
  e.cases[0] = 'nR';    // roi noir a8
  e.cases[17] = 'bD';   // dame blanche b6 — étouffe sans donner échec
  e.cases[63] = 'bR';
  e.trait = NOIR;
  e.roque = { bR: false, bD: false, nR: false, nD: false };

  assert.equal(coupsLegaux(e).length, 0);
  assert.ok(!enEchec(e, NOIR), 'le roi ne doit PAS être en échec');
  assert.equal(issue(e)?.fin, 'pat');
});

/** Le pion pris en passant n'est pas sur la case d'arrivée. */
test('la prise en passant retire bien le bon pion', () => {
  // e4 a6 · e5 d5 : le pion blanc e5 peut alors prendre en passant en d6.
  // e2=52 e4=36 · a7=8 a6=16 · e5=28 · d7=11 d5=27 · d6=19
  let e = nouvellePartie();
  for (const [d, a] of [[52, 36], [8, 16], [36, 28], [11, 27]]) {
    const coup = coupsLegaux(e).find(c => c.depart === d && c.arrivee === a);
    assert.ok(coup, `coup ${d}->${a} introuvable`);
    e = jouer(e, coup);
  }
  const ep = coupsLegaux(e).find(c => c.enPassant);
  assert.ok(ep, 'la prise en passant doit être proposée');

  const apres = jouer(e, ep);
  assert.equal(apres.cases[27], null, 'le pion noir capturé doit disparaître');
  assert.equal(apres.cases[19], 'bP', 'le pion blanc arrive derrière');
});

test('le roque déplace la tour, et se perd quand le roi bouge', () => {
  const e = nouvellePartie();
  e.cases[61] = null; e.cases[62] = null;   // dégage f1 et g1
  const roque = coupsLegaux(e).find(c => c.roque === 'R');
  assert.ok(roque, 'le petit roque doit être possible');

  const apres = jouer(e, roque);
  assert.equal(apres.cases[62], 'bR', 'roi en g1');
  assert.equal(apres.cases[61], 'bT', 'tour en f1');
  assert.equal(apres.cases[63], null, 'la tour a quitté h1');
  assert.equal(apres.roque.bR, false);
  assert.equal(apres.roque.bD, false, 'les DEUX droits se perdent');
});

// ─────────────────────────────────── L'IA

test('l\'IA prend une dame en prise', () => {
  const e = nouvellePartie();
  e.cases = Array(64).fill(null);
  e.cases[60] = 'bR'; e.cases[4] = 'nR';
  e.cases[36] = 'bT';   // tour blanche e4
  e.cases[28] = 'nD';   // dame noire e5, sans défense
  e.roque = { bR: false, bD: false, nR: false, nD: false };

  const coup = meilleurCoup(e, 2, () => 0);
  assert.equal(coup.depart, 36);
  assert.equal(coup.arrivee, 28, 'une dame gratuite se prend');
});

test('l\'IA trouve le mat en un plutôt qu\'une prise', () => {
  const e = nouvellePartie();
  e.cases = Array(64).fill(null);
  e.cases[0] = 'nR';    // roi noir a8, confiné
  e.cases[63] = 'bR';
  e.cases[9] = 'bD';    // dame blanche b7 : Dh7# ... on vise le mat
  e.cases[16] = 'bT';   // tour a6
  e.cases[40] = 'nP';   // un pion à prendre, pour offrir la tentation
  e.roque = { bR: false, bD: false, nR: false, nD: false };

  const coup = meilleurCoup(e, 3, () => 0);
  const fin = issue(jouer(e, coup));
  assert.equal(fin?.fin, 'mat', 'le mat immédiat passe avant le matériel');
});

test('l\'évaluation compte le matériel du bon côté', () => {
  const e = nouvellePartie();
  assert.ok(Math.abs(evaluer(e)) < 50, 'position de départ : quasi égale');

  const sansDameNoire = { ...e, cases: e.cases.slice() };
  sansDameNoire.cases[3] = null;
  assert.ok(evaluer(sansDameNoire) > 800, 'une dame noire en moins avantage les blancs');
});

test('la notation est lisible', () => {
  assert.equal(notation({ depart: 52, arrivee: 36 }), 'e2-e4');
  assert.equal(notation({ roque: 'R' }), 'O-O');
  assert.equal(notation({ depart: 8, arrivee: 0, promotion: 'D' }), 'a7-a8=D');
});
