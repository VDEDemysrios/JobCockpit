import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collecterDepuisSources, fusionner } from '../src/sources/index.js';

function sourceFactice(nom, offres, { configuree = true, echoue = false } = {}) {
  return {
    nom,
    estConfiguree: () => configuree,
    chercher: async () => {
      if (echoue) throw new Error(`panne simulée de ${nom}`);
      return offres;
    },
  };
}

const OFFRE_A = {
  externalId: 'a1', titre: 'Juriste EnR', entreprise: 'ACME', ville: 'Nancy (54)',
  description: 'Longue description.', dateOffre: '2026-07-27',
};

test('une source en panne n\'empêche pas les autres', async () => {
  const r = await collecterDepuisSources(
    [sourceFactice('bonne', [OFFRE_A]), sourceFactice('cassee', [], { echoue: true })],
    { intitules: ['juriste'], villes: [{ nom: 'Nancy', codeInsee: '54395' }], rayonKm: 30, depuisDate: '2026-07-21' }
  );

  assert.equal(r.offres.length, 1);
  assert.deepEqual(r.sourcesEnEchec, ['cassee']);
  assert.deepEqual(r.sourcesOk, ['bonne']);
});

test('une source non configurée est silencieusement sautée', async () => {
  const r = await collecterDepuisSources(
    [sourceFactice('absente', [OFFRE_A], { configuree: false })],
    { intitules: ['juriste'], villes: [], rayonKm: 30, depuisDate: '2026-07-21' }
  );

  assert.equal(r.offres.length, 0);
  assert.deepEqual(r.sourcesEnEchec, [], 'non configurée n\'est PAS une panne');
  assert.deepEqual(r.sourcesIgnorees, ['absente']);
});

test('fusionner dédoublonne la même offre vue sur deux sources', () => {
  const brutes = [
    { ...OFFRE_A, source: 'france-travail', description: 'Description longue et complète de l\'offre.' },
    { ...OFFRE_A, titre: 'Juriste EnR (H/F)', source: 'adzuna', description: 'Courte.' },
  ];
  const fusionnees = fusionner(brutes);

  assert.equal(fusionnees.length, 1);
  assert.deepEqual(fusionnees[0].sourcesAll.sort(), ['adzuna', 'france-travail']);
});

test('fusionner conserve la description la plus longue', () => {
  const brutes = [
    { ...OFFRE_A, source: 'adzuna', description: 'Courte.' },
    { ...OFFRE_A, source: 'france-travail', description: 'Description nettement plus longue et détaillée.' },
  ];
  assert.equal(fusionner(brutes)[0].description, 'Description nettement plus longue et détaillée.');
});

/**
 * CE QUI SÉPARE DEUX OFFRES A CHANGÉ, ET LES DONNÉES L'ONT IMPOSÉ.
 *
 * Ce test affirmait auparavant que le même intitulé dans deux villes faisait
 * deux offres. C'est faux dans la vie réelle : les cabinets diffusent une
 * annonce unique ville par ville, et la base en portait 55 exemplaires
 * inutiles — dont un intitulé republié dix fois, de La Rochelle à Annecy,
 * avec la même description au caractère près.
 *
 * Le critère est donc la DESCRIPTION. Textes identiques, une seule offre ;
 * textes différents, deux postes, même intitulé et même employeur.
 */
test('fusionner sépare deux postes aux descriptions différentes', () => {
  const brutes = [
    { ...OFFRE_A, source: 'adzuna', description: 'Poste secteur Grand Est.' },
    { ...OFFRE_A, ville: 'Lyon (69)', source: 'adzuna', description: 'Poste secteur Rhône-Alpes, déplacements.' },
  ];
  assert.equal(fusionner(brutes).length, 2);
});

test('fusionner regroupe la même annonce republiée dans deux villes', () => {
  const brutes = [
    { ...OFFRE_A, source: 'adzuna' },
    { ...OFFRE_A, ville: 'Lyon (69)', source: 'adzuna' },
  ];
  const [offre] = fusionner(brutes);
  assert.equal(fusionner(brutes).length, 1, 'même texte = même annonce');
  assert.equal(offre.villesRepubliees, 2);
});

test('collecterDepuisSources interroge chaque ville PUIS la France entière', async () => {
  const appels = [];
  const espion = {
    nom: 'espion',
    estConfiguree: () => true,
    chercher: async ({ intitule, ville }) => { appels.push({ intitule, ville: ville?.nom ?? null }); return []; },
  };

  await collecterDepuisSources([espion], {
    intitules: ['juriste'],
    villes: [{ nom: 'Nancy', codeInsee: '54395' }, { nom: 'Lyon', codeInsee: '69123' }],
    rayonKm: 30, depuisDate: '2026-07-21',
  });

  assert.deepEqual(appels.map(a => a.ville), ['Nancy', 'Lyon', null],
    'la passe nationale (ville=null) doit suivre les villes prioritaires');
});

// Toutes les sources ne se configurent pas dans .env : les flux RSS se
// déclarent dans profile.json, et doivent donc voir le profil.
test('le profil est transmis à estConfiguree et à chercher', async () => {
  const vu = { configuration: null, recherche: null };
  const source = {
    nom: 'profil-conscient',
    estConfiguree: (profil) => { vu.configuration = profil; return true; },
    chercher: async ({ profil }) => { vu.recherche = profil; return []; },
  };
  const profil = { flux: [{ url: 'https://exemple.fr/rss' }] };

  await collecterDepuisSources([source], {
    intitules: ['juriste'], villes: [], rayonKm: 30, depuisDate: '2026-07-21', profil,
  });

  assert.equal(vu.configuration, profil);
  assert.equal(vu.recherche, profil);
});
