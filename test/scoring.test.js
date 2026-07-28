import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scorer } from '../src/scoring.js';

const profil = JSON.parse(readFileSync(new URL('../profile/profile.json', import.meta.url), 'utf8'));
const offres = JSON.parse(readFileSync(new URL('./fixtures/offers.json', import.meta.url), 'utf8'));

test('un motif éliminatoire classe directement en groupe 3', () => {
  const r = scorer({ titre: 'Juriste M&A', description: '5 ans en M&A exigés.'.padEnd(250, ' .') }, profil);
  assert.equal(r.groupe, 3);
  assert.ok(r.detail.eliminatoires.length > 0, 'le motif éliminatoire doit être tracé');
});

test('une description trop courte classe en groupe 0 (à vérifier)', () => {
  const r = scorer({ titre: 'Juriste', description: 'Trop court.' }, profil);
  assert.equal(r.groupe, 0);
});

test('score_detail liste les motifs déclenchés (verdict auditable)', () => {
  const r = scorer(offres[0], profil);
  assert.ok(Array.isArray(r.detail.positifs));
  assert.ok(r.detail.positifs.length > 0);
  assert.ok(typeof r.score === 'number');
});

test('« 2 ans d\'expérience » ne déclenche PAS le motif éliminatoire', () => {
  const r = scorer({
    titre: 'Chef de projet EnR',
    description: 'Une première expérience de 2 ans en énergies renouvelables. Développement de projets photovoltaïques et concertation locale avec les collectivités territoriales.'.padEnd(250, ' .')
  }, profil);
  assert.notEqual(r.groupe, 3);
});

// Test de calibrage : le scoring doit reproduire le jugement déjà porté.
test('les 11 offres de référence sont correctement classées', () => {
  const resultats = offres.map(o => ({
    titre: o.titre,
    attendu: o.attendu,
    obtenu: scorer(o, profil).groupe,
  }));

  const exacts = resultats.filter(r => r.obtenu === r.attendu);
  const rang = { 1: 0, 2: 1, 0: 2, 3: 3 };
  const graves = resultats.filter(r => Math.abs(rang[r.obtenu] - rang[r.attendu]) >= 3);

  const rapport = resultats
    .map(r => `${r.obtenu === r.attendu ? 'OK ' : 'KO '} attendu=${r.attendu} obtenu=${r.obtenu}  ${r.titre}`)
    .join('\n');

  assert.equal(graves.length, 0, `Erreur à deux crans détectée :\n${rapport}`);
  assert.ok(exacts.length >= 9, `Seulement ${exacts.length}/11 exacts :\n${rapport}`);
});
