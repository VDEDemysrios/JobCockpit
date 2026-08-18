// L'ÂGE D'UNE VIDÉO, LISIBLE — ce qui manquait aux deux onglets.
//
// Sans date, une liste d'archives ne se trie pas de l'œil : on ne savait pas
// si une rediffusion datait d'hier ou de trois ans. `depuisRelatif` donne le
// format que tout le monde lit — « il y a 3 j », « il y a 2 mois ». Deux
// pièges qu'on verrouille ici : une date FUTURE ne doit pas rendre « il y a
// -1 j », et les seuils (semaine, mois, an) doivent tomber juste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depuisRelatif } from '../public/format.js';

/** Une date à `j` jours dans le passé (ou le futur si négatif). */
const ilYA = (j) => new Date(Date.now() - j * 86400000).toISOString();

test('l\'âge se dit dans la bonne unité, du jour à l\'année', () => {
  assert.equal(depuisRelatif(ilYA(0)), "aujourd'hui");
  assert.equal(depuisRelatif(ilYA(1)), 'hier');
  assert.equal(depuisRelatif(ilYA(3)), 'il y a 3 j');
  assert.equal(depuisRelatif(ilYA(6)), 'il y a 6 j');
  assert.equal(depuisRelatif(ilYA(10)), 'il y a 1 sem.');
  assert.equal(depuisRelatif(ilYA(20)), 'il y a 2 sem.');
  assert.equal(depuisRelatif(ilYA(60)), 'il y a 2 mois');
  assert.equal(depuisRelatif(ilYA(400)), 'il y a 1 an');
  assert.equal(depuisRelatif(ilYA(800)), 'il y a 2 ans', 'le pluriel des années');
});

test('une date future ou absente ne ment pas', () => {
  assert.equal(depuisRelatif(ilYA(-5)), '', 'jamais « il y a -5 j »');
  assert.equal(depuisRelatif(null), '');
  assert.equal(depuisRelatif(''), '');
  assert.equal(depuisRelatif('pas une date'), '');
});
