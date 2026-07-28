import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraireJson, Limiteur } from '../src/gemini.js';

test('extraireJson lit un JSON nu', () => {
  assert.deepEqual(extraireJson('{"verdict":"Oui"}'), { verdict: 'Oui' });
});

test('extraireJson lit un JSON encadré par un bloc markdown', () => {
  const reponse = '```json\n{"verdict":"Oui, fonce."}\n```';
  assert.deepEqual(extraireJson(reponse), { verdict: 'Oui, fonce.' });
});

test('extraireJson ignore le bavardage avant et après', () => {
  const reponse = 'Voici mon analyse :\n{"verdict":"Non"}\nJ\'espère que cela aide.';
  assert.deepEqual(extraireJson(reponse), { verdict: 'Non' });
});

test('extraireJson renvoie null sur une réponse inexploitable', () => {
  assert.equal(extraireJson('Je ne peux pas répondre.'), null);
  assert.equal(extraireJson('{"casse": '), null);
  assert.equal(extraireJson(''), null);
  assert.equal(extraireJson(null), null);
});

test('Limiteur espace les appels selon le débit configuré', async () => {
  const limiteur = new Limiteur(60); // 60/min → 1 appel par seconde minimum
  const debut = Date.now();
  await limiteur.attendre();
  await limiteur.attendre();
  assert.ok(Date.now() - debut >= 950, 'le deuxième appel doit être retardé');
});
