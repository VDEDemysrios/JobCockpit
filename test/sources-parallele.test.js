// LES SOURCES EN PARALLÈLE, CHACUNE EN SÉRIE (chantier 4.0).
//
// Avant, la collecte durait la SOMME des sources ; elle dure désormais celle
// de la plus lente. Les garanties de sources-index.test.js tiennent toujours
// (elles y sont testées) ; on vérifie ici ce que le parallélisme pourrait
// casser : l'ordre interne d'une source, l'ordre de fusion, l'isolement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collecterDepuisSources } from '../src/sources/index.js';

const pause = (ms) => new Promise(r => setTimeout(r, ms));

const OPTIONS = {
  intitules: ['juriste', 'chargé'],
  villes: [{ nom: 'Nancy', codeInsee: '54395' }],
  rayonKm: 30, depuisDate: '2026-07-21',
};

/** Une source lente qui note quand elle commence et finit chaque requête. */
function sourceLente(nom, journal, { delai = 40, offres = () => [] } = {}) {
  let enVol = 0;
  return {
    nom,
    estConfiguree: () => true,
    chercher: async ({ intitule, ville }) => {
      enVol++;
      journal.push({ nom, enVol, intitule, ville: ville?.nom ?? 'France' });
      await pause(delai);
      enVol--;
      return offres({ intitule, ville });
    },
  };
}

test('les sources tournent ensemble, mais chacune une requête à la fois', async () => {
  const journal = [];
  const sources = [sourceLente('a', journal), sourceLente('b', journal), sourceLente('c', journal)];

  const debut = Date.now();
  await collecterDepuisSources(sources, OPTIONS);
  const duree = Date.now() - debut;

  // 3 sources × 2 intitulés × 2 villes × 40 ms = 480 ms en série ; 160 ms
  // en parallèle par source. Large marge pour une machine chargée.
  assert.ok(duree < 400, `trop lent pour du parallèle : ${duree} ms`);
  assert.ok(journal.every(j => j.enVol === 1), 'une source n\'a jamais deux requêtes en vol');

  // L'ordre INTERNE d'une source est conservé : villes puis France, par intitulé.
  const deA = journal.filter(j => j.nom === 'a').map(j => `${j.intitule}/${j.ville}`);
  assert.deepEqual(deA, ['juriste/Nancy', 'juriste/France', 'chargé/Nancy', 'chargé/France']);
});

test('la fusion ne dépend pas de la source qui répond la première', async () => {
  const offre = { titre: 'Juriste EnR', entreprise: 'ACME', ville: 'Nancy (54)', description: 'Même texte.' };
  const journal = [];
  // La PREMIÈRE de la liste répond en DERNIER.
  const sources = [
    sourceLente('premiere', journal, { delai: 60, offres: () => [offre] }),
    sourceLente('seconde', journal, { delai: 5, offres: () => [offre] }),
  ];
  const r = await collecterDepuisSources(sources, { ...OPTIONS, intitules: ['juriste'], villes: [] });

  assert.equal(r.offres.length, 1);
  assert.equal(r.offres[0].source, 'premiere', 'à description égale, la première de la LISTE gagne');
  assert.deepEqual(r.offres[0].sourcesAll, ['premiere', 'seconde']);
  assert.deepEqual(r.sourcesOk, ['premiere', 'seconde'], 'les noms restent dans l\'ordre de la liste');
  assert.equal(r.brutes, 2);
});

test('un adaptateur cassé reste une panne isolée, même en parallèle', async () => {
  const offre = { titre: 'Juriste', entreprise: 'ACME', ville: 'Nancy', description: 'x' };
  const traitre = {
    nom: 'traitre',
    estConfiguree: () => true,
    // Un adaptateur qui lève dès qu'on touche à sa méthode, pas dans sa promesse.
    get chercher() { throw new Error('adaptateur cassé'); },
  };
  const r = await collecterDepuisSources(
    [traitre, { nom: 'bonne', estConfiguree: () => true, chercher: async () => [offre] }],
    { ...OPTIONS, intitules: ['juriste'], villes: [] });

  assert.equal(r.offres.length, 1);
  assert.deepEqual(r.sourcesOk, ['bonne']);
  assert.deepEqual(r.sourcesEnEchec, ['traitre']);
});

test('chaque requête s\'annonce sur le flux : début, puis ok ou échec', async () => {
  const recus = [];
  await collecterDepuisSources([
    { nom: 'ok', estConfiguree: () => true, chercher: async () => [{ titre: 't', entreprise: 'e', ville: 'v' }] },
    { nom: 'ko', estConfiguree: () => true, chercher: async () => { throw new Error('503'); } },
    { nom: 'off', estConfiguree: () => false, chercher: async () => [] },
  ], { ...OPTIONS, intitules: ['juriste'], villes: [], progres: (evt, d) => recus.push({ evt, ...d }) });

  assert.ok(recus.every(e => e.evt === 'source'));
  assert.ok(recus.some(e => e.nom === 'off' && e.etat === 'ignoree'));
  assert.ok(recus.some(e => e.etat === 'ok' && e.trouvees === 1));
  assert.ok(recus.some(e => e.etat === 'echec' && e.message === '503'));
  assert.equal(recus.filter(e => e.etat === 'debut').length, 2, 'une annonce par requête lancée');
});
