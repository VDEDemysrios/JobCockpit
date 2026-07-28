import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliserOffre } from '../src/sources/adzuna.js';

const REPONSE_ADZUNA = {
  id: '4912345678',
  title: 'Chargé de développement EnR H/F',
  description: 'Vous développerez un portefeuille de projets solaires…',
  created: '2026-07-24T14:03:21Z',
  company: { display_name: 'SOLARIS DEV' },
  location: { display_name: 'Strasbourg, Bas-Rhin', area: ['France', 'Grand Est', 'Bas-Rhin', 'Strasbourg'] },
  contract_type: 'permanent',
  salary_min: 36000,
  salary_max: 44000,
  redirect_url: 'https://www.adzuna.fr/land/ad/4912345678',
};

test('normaliserOffre extrait les champs au format commun', () => {
  const o = normaliserOffre(REPONSE_ADZUNA);
  assert.equal(o.externalId, '4912345678');
  assert.equal(o.titre, 'Chargé de développement EnR H/F');
  assert.equal(o.entreprise, 'SOLARIS DEV');
  assert.equal(o.ville, 'Strasbourg');
  assert.equal(o.dateOffre, '2026-07-24');
  assert.equal(o.contrat, 'CDI');
  assert.equal(o.salaireSource, '36000 – 44000 € brut annuel');
});

test('normaliserOffre traduit les types de contrat Adzuna', () => {
  assert.equal(normaliserOffre({ ...REPONSE_ADZUNA, contract_type: 'contract' }).contrat, 'CDD');
  assert.equal(normaliserOffre({ ...REPONSE_ADZUNA, contract_type: undefined }).contrat, '');
});

test('normaliserOffre gère un salaire minimum seul', () => {
  const o = normaliserOffre({ ...REPONSE_ADZUNA, salary_max: undefined });
  assert.equal(o.salaireSource, 'à partir de 36000 € brut annuel');
});

test('normaliserOffre laisse salaireSource à null si absent', () => {
  const o = normaliserOffre({ ...REPONSE_ADZUNA, salary_min: undefined, salary_max: undefined });
  assert.equal(o.salaireSource, null);
});

test('normaliserOffre tolère une localisation absente', () => {
  const o = normaliserOffre({ id: 'x', title: 'Juriste' });
  assert.equal(o.ville, '');
  assert.equal(o.entreprise, '');
});
