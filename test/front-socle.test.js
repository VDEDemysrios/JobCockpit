// LE SOCLE DU FRONT 4.0 : ce qui se trompe en silence.
//
// La palette qui ne trouve plus « charge mission », une ancre qui ouvre la
// mauvaise vue, une erreur affichée en noir comme une confirmation, un
// script remis en ligne dans la page de connexion : aucune de ces pannes ne
// lève d'erreur. Elles se mesurent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

import { scoreFlou, surligner, classer } from '../public/palette.js';
import { lireRoute, ecrireRoute, slugVille, villeDuSlug } from '../public/routage.js';
import { normaliserType } from '../public/toast.js';
import { surcoucheOuverte, profondeurPile } from '../public/surcouche.js';
import { placerOffre, avancement } from '../public/collecte-live.js';
import { restantDe, formaterMinuteur, DUREES_POMODORO } from '../public/focus.js';
import { pasDeFrappe } from '../public/frappe.js';
import { rappelsLocaux, urgents } from '../public/rappels.js';
import { poserMarque, poserTitreBase, titreCompose } from '../public/titre.js';
import { VUES_RACCOURCI } from '../public/clavier.js';
import { normaliser } from '../public/format.js';
import { API } from '../public/api.js';

const lire = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

// ─────────────────────────────────────────────── la palette

test('la recherche floue trouve deux bribes sans accents ni ordre', () => {
  assert.ok(scoreFlou('charge mission', 'Chargé de mission urbanisme'));
  assert.ok(scoreFlou('urba charge', 'Chargé de mission urbanisme'), 'les mots dans le désordre');
  assert.ok(scoreFlou('strbg', 'Strasbourg'), 'les lettres dans l\'ordre');
  assert.equal(scoreFlou('zzz', 'Strasbourg'), null);
});

test('la sous-chaîne en début de mot passe devant l\'éparpillé', () => {
  const net = scoreFlou('kanban', 'Kanban').score;
  const loin = scoreFlou('kanban', 'K a n b a n éparpillé partout').score ?? 0;
  assert.ok(net > loin);
  const r = classer('agenda', [
    { titre: 'Agenda des relances' }, { titre: 'Gare à la danse', offre: {} },
  ]);
  assert.equal(r[0].el.titre, 'Agenda des relances');
});

test('le surlignage tombe sur les bons caractères, accents compris', () => {
  const r = scoreFlou('charge', 'Chargé');
  assert.equal(surligner('Chargé', r.indices), '<mark>Chargé</mark>');
  assert.equal(surligner('<b>', []), '&lt;b&gt;', 'le texte reste échappé');
  assert.equal(surligner('Œuvre', scoreFlou('oeu', 'Œuvre').indices), '<mark>Œu</mark>vre');
});

// ─────────────────────────────────────────────── le routage

test('une ancre se lit et s\'écrit dans les deux sens', () => {
  assert.deepEqual(lireRoute('#/offres/strasbourg-67'), { vue: 'offers', ville: 'strasbourg-67', offre: null });
  assert.deepEqual(lireRoute('#/offre/abc123'), { vue: 'offers', ville: null, offre: 'abc123' });
  assert.deepEqual(lireRoute('#/kanban'), { vue: 'kanban', ville: null, offre: null });
  assert.deepEqual(lireRoute(''), { vue: null, ville: null, offre: null });
  assert.equal(ecrireRoute({ vue: 'offers', ville: 'Strasbourg (67)' }), '#/offres/strasbourg-67');
  assert.equal(ecrireRoute({ vue: 'dashboard' }), '#/tableau');
  assert.equal(villeDuSlug(slugVille('Saint-Étienne'), ['Lyon', 'Saint-Étienne']), 'Saint-Étienne');
});

// ─────────────────────────────────────────────── les messages

test('une erreur reste une erreur, quel que soit le mot de l\'appelant', () => {
  for (const t of ['err', 'erreur', 'error', 'échec']) assert.equal(normaliserType(t), 'err');
  assert.equal(normaliserType('win'), 'win');
  assert.equal(normaliserType(''), '');
  assert.equal(normaliserType(undefined), '');
});

test('plus aucun appel ne passe le type « erreur » non stylé', () => {
  for (const f of ['app.js', 'chill.js', 'entretien.js', 'dock.js', 'spotify-ui.js', 'twitch-ui.js', 'youtube-ui.js']) {
    assert.ok(!/,\s*'erreur'\)/.test(lire(f)), `${f} passe encore 'erreur'`);
  }
});

// ─────────────────────────────────────────────── les surcouches

test('la pile de surcouches s\'importe sous Node et démarre vide', () => {
  assert.equal(surcoucheOuverte(), false);
  assert.equal(profondeurPile(), 0);
});

test('confirm() natif n\'est plus appelé nulle part', () => {
  for (const f of ['app.js', 'chill.js', 'entretien.js', 'spotify-ui.js']) {
    // Les commentaires racontent l'ancienne boîte : on ne cherche que le code.
    const code = lire(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    assert.ok(!/(^|[^.\w])confirm\(/m.test(code), `${f} appelle encore confirm()`);
  }
});

// ─────────────────────────────────────────────── le radar

test('une offre tombe toujours au même endroit, et les prioritaires au centre', () => {
  assert.deepEqual(placerOffre('abc', 1), placerOffre('abc', 1));
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const p1 = placerOffre(id, 1);
    const p3 = placerOffre(id, 3);
    assert.ok(Math.hypot(p1.x - 50, p1.y - 50) < Math.hypot(p3.x - 50, p3.y - 50));
    assert.ok(Math.hypot(p3.x - 50, p3.y - 50) <= 47, 'aucun point hors du cadran');
  }
});

test('l\'avancement ne recule jamais d\'une étape à la suivante', () => {
  const suite = [
    avancement({ etape: 'sources', faites: 5, attendues: 10 }),
    avancement({ etape: 'sources', faites: 10, attendues: 10 }),
    avancement({ etape: 'fusion' }),
    avancement({ etape: 'analyse', analyse: { i: 3, total: 10 } }),
    avancement({ etape: 'nettoyage' }),
    avancement({ fini: true }),
  ];
  for (let i = 1; i < suite.length; i++) assert.ok(suite[i] >= suite[i - 1], `recul à l'étape ${i}`);
  assert.equal(suite.at(-1), 1);
});

// ─────────────────────────────────────────────── focus, frappe, rappels, titre

test('le minuteur se calcule depuis son heure de fin', () => {
  assert.equal(restantDe({ enMarche: true, fin: 10000 }, 4000), 6000);
  assert.equal(restantDe({ enMarche: true, fin: 1000 }, 4000), 0);
  assert.equal(restantDe({ enMarche: false, restant: 1234 }), 1234);
  assert.equal(formaterMinuteur(DUREES_POMODORO.travail), '25:00');
  assert.equal(formaterMinuteur(59001), '01:00');
});

test('la frappe tient dans sa durée, quelle que soit la longueur', () => {
  const images = (n) => Math.ceil(n / pasDeFrappe(n, 1100));
  assert.ok(images(20000) <= Math.round(1100 / 16) + 1, 'une fiche longue ne dure pas quinze secondes');
  assert.equal(pasDeFrappe(10), 1);
});

test('les rappels locaux voient la relance due et l\'entretien de demain', () => {
  const loc = (j) => { const d = new Date(); d.setDate(d.getDate() + j);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const r = rappelsLocaux([
    { id: '1', titre: 'A', suivi: { status: 'Envoyé', relance: loc(-2), sent: loc(-9) } },
    { id: '2', titre: 'B', suivi: { status: 'Entretien', entretien: loc(1) } },
    { id: '3', titre: 'C', suivi: { status: 'À postuler' } },
  ]);
  assert.deepEqual(r.map(x => x.type).sort(), ['entretien', 'relance']);
  assert.equal(urgents(r).length, 2);
});

test('le titre de l\'onglet garde toutes ses marques', () => {
  poserTitreBase('Job Cockpit');
  poserMarque('rappels', '(3)');
  poserMarque('focus', 'Focus 12:00 ·');
  assert.equal(titreCompose(), '(3) Focus 12:00 · Job Cockpit');
  poserMarque('focus', '');
  assert.equal(titreCompose(), '(3) Job Cockpit');
});

// ─────────────────────────────────────────────── clavier et aide

test('l\'aide clavier n\'annonce que des raccourcis qui existent', () => {
  const html = lire('index.html');
  const aide = html.slice(html.indexOf('id="aideClavier"'), html.indexOf('id="fermerAide"'));
  const sequences = [...aide.matchAll(/<span class="kbd">G<\/span> <span class="kbd">([A-Z])<\/span>/g)].map(m => m[1].toLowerCase());
  assert.ok(sequences.length >= 8, 'les huit vues ont leur séquence');
  for (const l of sequences) assert.ok(VUES_RACCOURCI[l], `« G ${l.toUpperCase()} » annoncé mais non branché`);
  for (const vue of ['entretiens', 'chill']) assert.ok(Object.values(VUES_RACCOURCI).includes(vue));
});

// ─────────────────────────────────────────────── balisage et sécurité

test('la page de connexion n\'a plus de script en ligne', () => {
  const html = lire('connexion.html');
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 1);
  for (const [, attrs, corps] of scripts) {
    assert.match(attrs, /src=/, 'un script sans src est en ligne : la CSP le bloque');
    assert.equal(corps.trim(), '');
  }
  assert.match(html, /method="post"/, 'sans script, le mot de passe ne doit jamais partir en GET');
});

test('le thème est posé avant le premier rendu, par un script classique', () => {
  const html = lire('index.html');
  const tete = html.slice(0, html.indexOf('</head>'));
  assert.match(tete, /<script src="theme-boot\.js"><\/script>/);
  assert.ok(tete.indexOf('theme-boot.js') < tete.indexOf('style.css'), 'avant les feuilles de style');
  assert.ok(!/<script>/.test(html), 'aucun script en ligne dans index.html');
});

test('plus de « +N pt » dans le balisage', () => {
  assert.ok(!/\+\d+\s*pt/.test(lire('index.html')));
});

test('la police est livrée en local, légère, avec sa licence', () => {
  for (const f of ['inter-latin-wght-normal.woff2', 'inter-latin-ext-wght-normal.woff2']) {
    const taille = statSync(new URL(`../public/fonts/${f}`, import.meta.url)).size;
    assert.ok(taille < 400 * 1024, `${f} pèse ${taille} octets`);
  }
  assert.ok(statSync(new URL('../public/fonts/LICENSE-Inter-OFL.txt', import.meta.url)).size > 1000);
  assert.match(lire('ui.css'), /@font-face\{[^}]*font-display:swap[^}]*url\(fonts\/inter-latin-wght-normal\.woff2\)/s);
});

test('--bord et --bg1 sont définis', () => {
  const css = lire('style.css');
  assert.match(css, /--bord:/);
  assert.match(css, /--bg1:/);
});

test('ce qui tourne en boucle dans ui.css reste sur le compositeur', () => {
  const css = lire('ui.css');
  const ADMISES = new Set(['transform', 'opacity', 'box-shadow', 'background-position']);
  const noms = new Set([...css.matchAll(/animation:\s*([a-zA-Z]+)[^;]*\binfinite\b/g)].map(m => m[1]));
  assert.ok(noms.size > 0);
  for (const nom of noms) {
    const debut = css.search(new RegExp(`@keyframes\\s+${nom}\\s*\\{`));
    if (debut < 0) continue;        // définie dans style.css (déjà vérifiée là-bas)
    let p = 0; let fin = debut;
    for (let i = css.indexOf('{', debut); i < css.length; i++) {
      if (css[i] === '{') p++;
      else if (css[i] === '}' && --p === 0) { fin = i; break; }
    }
    for (const [, prop] of css.slice(debut, fin).matchAll(/[{;]\s*([a-z-]+)\s*:/g)) {
      assert.ok(ADMISES.has(prop), `« ${nom} » anime « ${prop} » en boucle`);
    }
  }
  assert.match(css, /\[data-page="cachee"\][\s\S]{0,260}animation-play-state:\s*paused/);
});

test('un .docx déposé dans le chat ne remonte pas jusqu\'au dépôt de CV', () => {
  assert.match(lire('chill.js'), /addEventListener\('drop'[\s\S]{0,500}stopPropagation\(\)/);
  assert.match(lire('depot-cv.js'), /data-depot-propre/);
  assert.match(lire('index.html'), /id="chillZone" data-depot-propre/);
});

test('l\'API front porte les contrats 4.0', () => {
  for (const m of ['collecteDemarrer', 'collecteEtat', 'collecteFlux', 'analyserOffre', 'rappels',
    'sauvegardes', 'creerSauvegarde', 'lettreVersions', 'restaurerVersionLettre']) {
    assert.equal(typeof API[m], 'function', `API.${m} manque`);
  }
  assert.equal(API.urlIcs, '/api/agenda.ics');
});

test('normaliser retire accents et ligatures', () => {
  assert.equal(normaliser('Œuvre Éléphant'), 'oeuvre elephant');
});
