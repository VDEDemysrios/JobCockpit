import { test } from 'node:test';
import assert from 'node:assert/strict';
import jooble, { normaliserOffre, filtrerParDate } from '../src/sources/jooble.js';

const REPONSE_JOOBLE = {
  id: 8812345,
  title: 'Juriste droit public et environnement (H/F)',
  location: 'Strasbourg, 67',
  snippet: 'Au sein de la direction juridique, vous assurez la veille…',
  salary: '35 000 € - 42 000 € par an',
  source: 'apec.fr',
  type: 'CDI',
  link: 'https://fr.jooble.org/jdp/8812345',
  company: 'GRAND EST ENERGIE',
  updated: '2026-07-26T08:00:00.0000000',
};

test('normaliserOffre extrait les champs au format commun', () => {
  const o = normaliserOffre(REPONSE_JOOBLE);
  assert.equal(o.externalId, '8812345');
  assert.equal(o.titre, 'Juriste droit public et environnement (H/F)');
  assert.equal(o.entreprise, 'GRAND EST ENERGIE');
  assert.equal(o.ville, 'Strasbourg');
  assert.equal(o.dateOffre, '2026-07-26');
  assert.equal(o.contrat, 'CDI');
  assert.equal(o.salaireSource, '35 000 € - 42 000 € par an');
});

test('filtrerParDate ne garde que les offres assez récentes', () => {
  const offres = [
    { titre: 'Récente', dateOffre: '2026-07-26' },
    { titre: 'Ancienne', dateOffre: '2026-06-01' },
    { titre: 'Sans date', dateOffre: null },
  ];
  const gardees = filtrerParDate(offres, '2026-07-21').map(o => o.titre);

  assert.deepEqual(gardees, ['Récente', 'Sans date'],
    'une offre sans date est conservée : le scoring la classera « à vérifier »');
});

test('normaliserOffre tolère les champs absents', () => {
  const o = normaliserOffre({ id: 1, title: 'Juriste' });
  assert.equal(o.entreprise, '');
  assert.equal(o.ville, '');
  assert.equal(o.dateOffre, null);
  assert.equal(o.salaireSource, null);
});

// ------------------------------------------------- construction de la requête

/** Remplace `fetch` le temps d'un appel et rend l'URL demandée. */
async function urlDemandee(options) {
  const vraiFetch = globalThis.fetch;
  const vraieCle = process.env.JOOBLE_API_KEY;
  let url = null;

  process.env.JOOBLE_API_KEY = 'cle-de-test';
  globalThis.fetch = async (u) => {
    url = String(u);
    return { ok: true, status: 200, text: async () => '{"jobs":[]}', json: async () => ({ jobs: [] }) };
  };

  try {
    await jooble.chercher(options);
    return url;
  } finally {
    globalThis.fetch = vraiFetch;
    if (vraieCle === undefined) delete process.env.JOOBLE_API_KEY;
    else process.env.JOOBLE_API_KEY = vraieCle;
  }
}

// L'hôte détermine le pays et n'est pas interchangeable : `jooble.org` renvoie
// un 403 sur CHAQUE appel, même avec une clé valide. L'adaptateur visait ce
// domaine international — la source n'a donc jamais rien remonté, sans que
// rien ne le signale, aucun test ne regardant l'URL appelée.
test('la recherche vise l\'hôte français, jamais le domaine international', async () => {
  const url = await urlDemandee({
    intitule: 'juriste', ville: null, rayonKm: 30, depuisDate: '2026-07-22',
  });
  assert.match(url, /^https:\/\/fr\.jooble\.org\/api\//);
  assert.ok(url.endsWith('/cle-de-test'), 'la clé est le dernier segment du chemin');
});
