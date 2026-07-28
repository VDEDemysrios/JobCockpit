import { test } from 'node:test';
import assert from 'node:assert/strict';
import indeed from '../src/sources/indeed.js';

test('la source Indeed est inerte tant qu\'aucune clé n\'est configurée', () => {
  delete process.env.INDEED_API_KEY;
  assert.equal(indeed.estConfiguree(), false);
});

test('la source Indeed respecte l\'interface commune', () => {
  assert.equal(indeed.nom, 'indeed');
  assert.equal(typeof indeed.estConfiguree, 'function');
  assert.equal(typeof indeed.chercher, 'function');
});

test('chercher échoue explicitement si appelée sans implémentation', async () => {
  await assert.rejects(() => indeed.chercher({ intitule: 'juriste' }), /pas encore implémentée/);
});
