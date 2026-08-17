import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraireJson, Limiteur, classerErreur } from '../src/gemini.js';

// Régression : lors de la première collecte réelle, un 429 sur un modèle
// interrompait TOUTE la chaîne de repli — les modèles suivants, pourtant
// fonctionnels, n'étaient jamais essayés et aucune offre n'était analysée.
test('classerErreur distingue les cas où changer de modèle est la bonne réponse', () => {
  assert.equal(classerErreur('{"error":{"code":404,"message":"This model is no longer available to new users"}}'), 'modele-indisponible');
  assert.equal(classerErreur('{"error":{"code":503,"message":"This model is currently experiencing high demand"}}'), 'modele-indisponible');
  assert.equal(classerErreur('{"error":{"code":429,"message":"You exceeded your current quota"}}'), 'quota');
  assert.equal(classerErreur('RESOURCE_EXHAUSTED'), 'quota');
});

test('classerErreur traite les incidents inconnus comme passagers', () => {
  assert.equal(classerErreur('socket hang up'), 'autre');
  assert.equal(classerErreur('{"error":{"code":500}}'), 'autre');
  assert.equal(classerErreur(undefined), 'autre');
});

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

/**
 * UN TABLEAU AU PREMIER NIVEAU EST DU JSON VALIDE.
 *
 * La fonction ne cherchait que des accolades. Un prompt demandant une LISTE
 * — les cartes de révision — reçoit un tableau : la première accolade
 * rencontrée était celle du premier élément, la dernière celle du dernier, et
 * la tranche découpée perdait les crochets. `JSON.parse` recevait une suite
 * d'objets séparés par des virgules et rendait null.
 *
 * Rien ne levait d'erreur : le modèle répondait juste, l'application affichait
 * « réponse illisible ».
 */
test('extraireJson accepte un tableau, pas seulement un objet', () => {
  const liste = extraireJson('Voici les cartes :\n[{"terme":"A","sur":true},{"terme":"B","sur":false}]\nVoilà.');
  assert.ok(Array.isArray(liste), 'un tableau au premier niveau doit être rendu tel quel');
  assert.equal(liste.length, 2);
  assert.equal(liste[1].terme, 'B');
});

test('extraireJson rend toujours les objets, y compris en bloc markdown', () => {
  const o = extraireJson('```json\n{"verdict":"oui","score":7}\n```');
  assert.equal(o.verdict, 'oui');
  assert.equal(o.score, 7);
});

/** Rien d'exploitable : null, jamais d'exception — l'appelant doit pouvoir ignorer. */
test('extraireJson ne lève jamais', () => {
  for (const entree of ['', null, undefined, 'aucun json ici', '{cassé', '[1,2']) {
    assert.equal(extraireJson(entree), null);
  }
});
