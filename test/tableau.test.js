// LE TABLEAU DE BORD, LE KANBAN ET L'AGENDA — CE QUI SE CALCULE.
//
// L'interactivité (glisser, FLIP, réticule) ne se teste pas sans navigateur.
// Mais chacune de ces pièces repose sur un calcul pur, et c'est dans ces
// calculs que les pannes se cachaient : une grille de mois qui doublait le
// 25 octobre, un index d'insertion qui oscillait, une série qui cassait à
// 9 h du matin. Ce fichier les fige.
//
// LE FUSEAU EST IMPOSÉ AVANT TOUT `Date`. Le bug d'heure d'été n'existe que
// dans un fuseau qui en a une : sous UTC (la machine d'intégration), le test
// passerait même avec l'ancien code, et ne protégerait rien.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  joursDuMois, ordonnerColonne, indexInsertion, vitesseBord, anneauScore, badgeFraicheur, SCORE_PLEIN,
} = await import('../public/render.js');
const {
  aire, donut, cheminCourbe, reechantillonner, plafondRond, jauge, sparkline,
} = await import('../public/charts.js');
const {
  serieJours, prochainEntretien, rebours, joursSemaine,
} = await import('../public/dashboard.js');

// ─────────────────────────────────────────────────────── l'agenda

function verifierGrille(annee, mois) {
  const cases = joursDuMois(annee, mois);
  assert.equal(cases.length, 42);
  // Des jours CONSÉCUTIFS, sans doublon ni trou : c'est exactement ce que
  // l'addition de 86 400 000 ms cassait au changement d'heure.
  for (let i = 1; i < cases.length; i++) {
    const a = new Date(cases[i - 1].iso + 'T12:00:00');
    const b = new Date(cases[i].iso + 'T12:00:00');
    assert.equal(Math.round((b - a) / 86400000), 1,
      `${cases[i - 1].iso} → ${cases[i].iso} : la grille saute ou double un jour`);
  }
  // Lundi en tête, et le 1er du mois à sa place.
  assert.equal(new Date(cases[0].iso + 'T12:00:00').getDay(), 1, 'la grille doit commencer un lundi');
  const premier = cases.find(c => !c.hors);
  assert.equal(premier.jour, 1);
  assert.equal(cases.filter(c => !c.hors).length, new Date(annee, mois + 1, 0).getDate());
}

test('la grille du mois traverse le passage à l\'heure d\'hiver (25 octobre 2026)', () => {
  verifierGrille(2026, 9);
  verifierGrille(2026, 10); // novembre commence dans la semaine du 26 octobre
});

test('la grille du mois traverse le passage à l\'heure d\'été (29 mars 2026)', () => {
  verifierGrille(2026, 2);
  verifierGrille(2026, 3);
});

test('la grille couvre aussi les changements d\'année', () => {
  verifierGrille(2026, 11);
  verifierGrille(2027, 0);
});

// ─────────────────────────────────────────────────────── le Kanban

test('l\'ordre déposé est gardé, les cartes jamais rangées suivent', () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  assert.deepEqual(ordonnerColonne(items, ['3', '1']).map(o => o.id), [3, 1, 2, 4]);
  assert.deepEqual(ordonnerColonne(items, undefined).map(o => o.id), [1, 2, 3, 4]);
  // Une mémoire qui cite des cartes parties ailleurs ne casse rien.
  assert.deepEqual(ordonnerColonne(items, ['99', '4']).map(o => o.id), [4, 1, 2, 3]);
});

test('l\'index d\'insertion suit le milieu des cartes', () => {
  const cartes = [{ haut: 0, hauteur: 40 }, { haut: 46, hauteur: 40 }, { haut: 92, hauteur: 60 }];
  assert.equal(indexInsertion(cartes, -10), 0);
  assert.equal(indexInsertion(cartes, 19), 0);
  assert.equal(indexInsertion(cartes, 21), 1);
  assert.equal(indexInsertion(cartes, 70), 2);
  assert.equal(indexInsertion(cartes, 500), 3);
  assert.equal(indexInsertion([], 12), 0);
});

test('le défilement automatique ne s\'enclenche qu\'au bord, et accélère', () => {
  assert.equal(vitesseBord(80), 0);
  assert.equal(vitesseBord(56), 0);
  assert.ok(vitesseBord(30) > 0);
  assert.ok(vitesseBord(2) > vitesseBord(30), 'plus près du bord, plus vite');
  assert.ok(vitesseBord(-20) <= 22, 'au-delà du bord, la vitesse reste plafonnée');
});

// ─────────────────────────────────────────────────────── les cartes

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

test('le score devient un anneau, sans éclair', () => {
  const html = anneauScore(6);
  assert.match(html, /class="score-anneau fort"/);
  assert.ok(!EMOJI.test(html) && !html.includes('⚡'));
  // Plein à SCORE_PLEIN, vide à zéro, borné au-delà.
  const offset = (s) => Number(anneauScore(s).match(/stroke-dashoffset="([\d.]+)"/)[1]);
  assert.equal(offset(SCORE_PLEIN), 0);
  assert.equal(offset(SCORE_PLEIN * 3), 0);
  assert.ok(offset(0) > 43);
  assert.ok(offset(-4) > 43, 'un score négatif ne déborde pas');
  assert.equal(anneauScore(null), '');
});

test('la fraîcheur se dit sans emoji, en quatre paliers', () => {
  for (const [age, classe] of [[0, 'new'], [5, 'ok'], [10, 'warn'], [40, 'old']]) {
    const html = badgeFraicheur(age);
    assert.match(html, new RegExp(`fraicheur ${classe}`));
    assert.ok(!EMOJI.test(html), `emoji dans le badge de ${age} j`);
  }
  assert.equal(badgeFraicheur(null), '');
});

/**
 * Le mobilier des vues tableau ne porte plus d'emoji (règle 7 du chantier
 * 4.0). On ne lit que le CODE : les commentaires citent les anciens glyphes
 * pour expliquer ce qu'on a retiré, et c'est voulu.
 */
test('plus d\'emoji dans le mobilier de render.js, dashboard.js et charts.js', () => {
  for (const f of ['render.js', 'dashboard.js', 'charts.js']) {
    const source = readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/\r?\n/).map(l => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/\s.*$/, ''));
    const fautes = source.map((l, i) => [i + 1, l]).filter(([, l]) => EMOJI.test(l) || /[▸★☆✕↗▲▼]/.test(l));
    assert.deepEqual(fautes.map(([n, l]) => `${n}: ${l.trim().slice(0, 60)}`), [], `${f} : glyphes restants`);
  }
});

// ─────────────────────────────────────────────────────── les graphiques

test('la courbe ne déforme plus ses libellés', () => {
  const html = aire([
    { etiquette: '1er novembre', court: '01/11', valeur: 2 },
    { etiquette: '2 novembre', court: '02/11', valeur: 7 },
    { etiquette: '3 novembre', court: '03/11', valeur: 0 },
  ], { unite: ' action(s)' });
  // Le SVG étiré ne contient AUCUN texte : tout ce qui se lit est en HTML.
  const svg = html.match(/<svg[\s\S]*?<\/svg>/)[0];
  assert.match(svg, /preserveAspectRatio="none"/);
  assert.ok(!/<text/.test(svg), 'du texte dans un SVG étiré se déforme');
  assert.ok(!/<circle/.test(svg), 'un cercle dans un SVG étiré devient une ellipse');
  assert.match(svg, /vector-effect="non-scaling-stroke"/);
  assert.match(html, /data-serie="/);
  assert.match(html, /class="gr-bulle"/);
  // Les données voyagent intactes pour l'info-bulle.
  const serie = JSON.parse(html.match(/data-serie="([^"]*)"/)[1].replace(/&quot;/g, '"'));
  assert.deepEqual(serie.map(p => p.v), [2, 7, 0]);
});

test('le chemin du morph est celui de la courbe posée', () => {
  const html = aire([{ etiquette: 'a', valeur: 1 }, { etiquette: 'b', valeur: 3 }, { etiquette: 'c', valeur: 2 }]);
  const max = Number(html.match(/data-max="(\d+)"/)[1]);
  const { trace } = cheminCourbe([1 / max, 3 / max, 2 / max]);
  assert.ok(html.includes(`d="${trace}"`), 'le morph finirait sur une courbe différente de celle posée');
});

test('le rééchantillonnage garde les extrémités et interpole', () => {
  assert.deepEqual(reechantillonner([0, 1], 3), [0, 0.5, 1]);
  assert.equal(reechantillonner([0, 4, 8], 90).length, 90);
  assert.equal(reechantillonner([0, 4, 8], 90)[89], 8);
  assert.deepEqual(reechantillonner([5], 3), [5, 5, 5]);
  assert.deepEqual(reechantillonner([], 2), [0, 0]);
});

test('l\'axe monte à un plafond rond, divisible par les graduations', () => {
  for (const [max, attendu] of [[1, 4], [6, 8], [7, 8], [9, 12], [37, 40], [921, 1000]]) {
    const p = plafondRond(max, 4);
    assert.equal(p, attendu, `plafond de ${max}`);
    assert.equal(p % 4, 0);
    assert.ok(p >= max);
  }
});

test('la légende du donut est cliquable quand les parts ont une clé', () => {
  const html = donut([
    { etiquette: 'Adzuna', valeur: 3, couleur: 'red', cle: 'adzuna' },
    { etiquette: 'Jooble', valeur: 1, couleur: 'blue', cle: 'jooble' },
  ], { filtre: 'source' });
  assert.match(html, /gr-donut-wrap cliquable/);
  assert.match(html, /data-filtre="source"/);
  assert.equal((html.match(/<li data-cle="adzuna" role="button" tabindex="0"/g) ?? []).length, 1);
  assert.match(html, /class="part" data-cle="jooble"/);
  // Sans clé, rien n'est cliquable : le donut reste un donut.
  assert.ok(!/cliquable/.test(donut([{ etiquette: 'x', valeur: 1, couleur: 'red' }])));
});

test('la jauge tourne son bouton au lieu de le poser', () => {
  assert.match(jauge(50), /class="aiguille"[^>]*rotate\(90deg\)/);
  assert.match(jauge(100), /rotate\(180deg\)/);
});

test('la micro-courbe garde un trait net', () => {
  assert.match(sparkline([1, 3, 2]), /vector-effect="non-scaling-stroke"/);
});

// ─────────────────────────────────────────────────────── le héros

test('la série court jusqu\'à hier tant qu\'aujourd\'hui est vide', () => {
  const serie = [
    { jour: '2026-11-09', actions: 0 },
    { jour: '2026-11-10', actions: 1 },
    { jour: '2026-11-11', actions: 6 },
    { jour: '2026-11-12', actions: 2 },
    { jour: '2026-11-13', actions: 0 },
  ];
  const r = serieJours(serie, '2026-11-13');
  assert.equal(r.jours, 3);
  assert.equal(r.aujourdhuiFait, false);
  assert.equal(r.derniers.length, 14);
  assert.equal(r.derniers.at(-1).jour, '2026-11-13');
  assert.ok(r.derniers.at(-1).aujourdhui);

  serie[4].actions = 1;
  const s = serieJours(serie, '2026-11-13');
  assert.equal(s.jours, 4);
  assert.ok(s.aujourdhuiFait);

  assert.equal(serieJours([], '2026-11-13').jours, 0);
});

test('la série traverse le changement d\'heure sans sauter de jour', () => {
  const serie = ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']
    .map(jour => ({ jour, actions: 1 }));
  assert.equal(serieJours(serie, '2026-10-27').jours, 4);
});

test('le prochain entretien ignore le passé et les refus', () => {
  const o = (id, entretien, status = 'Entretien') => ({ id, titre: `o${id}`, suivi: { entretien, status } });
  const offres = [o(1, '2026-11-01'), o(2, '2026-11-20'), o(3, '2026-11-15', 'Refus'), o(4, '2026-11-16'), o(5, '')];
  const p = prochainEntretien(offres, '2026-11-13');
  assert.equal(p.offre.id, 4);
  assert.equal(p.jours, 3);
  assert.equal(prochainEntretien([o(6, '2026-11-13')], '2026-11-13').jours, 0, 'aujourd\'hui compte');
  assert.equal(prochainEntretien([], '2026-11-13'), null);
});

test('le compte à rebours vise le début du jour J', () => {
  const r = rebours('2026-11-16', new Date(2026, 10, 13, 9, 55));
  assert.deepEqual([r.jours, r.heures, r.minutes], [2, 14, 5]);
  assert.match(r.texte, /2 j 14 h 05 min/);
  assert.ok(rebours('2026-11-13', new Date(2026, 10, 13, 15, 0)).jourJ);
  assert.equal(rebours('2026-11-12', new Date(2026, 10, 13, 15, 0)), null);
});

test('la semaine du héros va du lundi au dimanche', () => {
  const jours = joursSemaine([{ jour: '2026-11-11', envois: 4 }], '2026-11-09', '2026-11-13');
  assert.deepEqual(jours.map(j => j.initiale).join(''), 'LMMJVSD');
  assert.equal(jours[2].envois, 4);
  assert.ok(jours[4].aujourdhui);
  assert.ok(jours[5].futur && !jours[3].futur);
});
