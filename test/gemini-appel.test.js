// CE QU'ON ENVOIE À GOOGLE (chantier 4.0) : un délai, et du JSON quand on en
// attend. Vérifié avec un client factice — ni réseau, ni clé, ni quota.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demander, configurationAppel, remplacerClientPourTests, classerErreur } from '../src/gemini.js';
import { analyserOffre } from '../src/analyze.js';

function clientFactice(repondre) {
  const requetes = [];
  return {
    requetes,
    models: { generateContent: async (req) => { requetes.push(req); return repondre(req); } },
  };
}

test('chaque appel porte un délai (signal d\'abandon)', async () => {
  const c = clientFactice(() => ({ text: 'bonjour' }));
  const remettre = remplacerClientPourTests(c);
  try {
    assert.equal(await demander('salut'), 'bonjour');
    const config = c.requetes[0].config;
    assert.ok(config.abortSignal instanceof AbortSignal, 'sans délai, un modèle muet bloquait tout');
    assert.equal(config.httpOptions.timeout, 60_000);
    assert.equal(config.responseMimeType, undefined, 'du texte libre reste du texte libre');
  } finally { remettre(); }
});

test('le JSON est demandé à la source quand on en attend', async () => {
  const c = clientFactice(() => ({ text: '{"verdict":"Oui."}' }));
  const remettre = remplacerClientPourTests(c);
  const cle = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'factice';
  try {
    const analyse = await analyserOffre(
      { titre: 'Juriste', description: 'Une description.' }, 'x'.repeat(200));
    assert.equal(analyse.verdict, 'Oui.');
    assert.equal(c.requetes[0].config.responseMimeType, 'application/json');
  } finally {
    remettre();
    if (cle === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = cle;
  }
});

test('un modèle qui ne répond pas est abandonné, et on passe au suivant', async () => {
  // Il n'écoute que le signal : sans délai, cette promesse ne finirait jamais.
  const c = clientFactice((req) => new Promise((_, rejeter) => {
    req.config.abortSignal.addEventListener('abort', () => rejeter(new Error('This operation was aborted')));
  }));
  const remettre = remplacerClientPourTests(c);
  const avertir = console.warn;
  console.warn = () => {};
  try {
    const debut = Date.now();
    const r = await demander('salut', [], { delaiMs: 30 });
    assert.equal(r, null);
    assert.equal(c.requetes.length, 4, 'un essai par modèle de la chaîne, sans reprise inutile');
    assert.ok(Date.now() - debut < 2000, 'pas de pause de reprise sur un délai dépassé');
  } finally {
    console.warn = avertir;
    remettre();
  }
});

test('un délai dépassé se classe comme un modèle indisponible', () => {
  assert.equal(classerErreur('This operation was aborted'), 'modele-indisponible');
  assert.equal(classerErreur('TimeoutError: The operation was aborted due to timeout'), 'modele-indisponible');
  assert.equal(configurationAppel({ json: true, delaiMs: 5 }).responseMimeType, 'application/json');
});
