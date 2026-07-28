import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliserOffre } from '../src/sources/franceTravail.js';

const REPONSE_FT = {
  id: '196MXKT',
  intitule: 'Chef de projet énergies renouvelables (H/F)',
  description: 'Vous piloterez le développement de projets photovoltaïques...',
  dateCreation: '2026-07-25T09:12:00.000Z',
  lieuTravail: { libelle: '54 - NANCY', codePostal: '54000' },
  entreprise: { nom: 'ACME ENERGIES' },
  typeContrat: 'CDI',
  salaire: { libelle: 'Annuel de 38000 à 45000 Euros' },
  origineOffre: { urlOrigine: 'https://candidat.francetravail.fr/offres/196MXKT' },
};

test('normaliserOffre extrait les champs au format commun', () => {
  const o = normaliserOffre(REPONSE_FT);
  assert.equal(o.externalId, '196MXKT');
  assert.equal(o.titre, 'Chef de projet énergies renouvelables (H/F)');
  assert.equal(o.entreprise, 'ACME ENERGIES');
  assert.equal(o.contrat, 'CDI');
  assert.equal(o.dateOffre, '2026-07-25');
  assert.equal(o.codePostal, '54000');
  assert.equal(o.salaireSource, 'Annuel de 38000 à 45000 Euros');
  assert.ok(o.lien.includes('196MXKT'));
});

test('normaliserOffre nettoie le préfixe département du lieu', () => {
  assert.equal(normaliserOffre(REPONSE_FT).ville, 'NANCY');
});

test('normaliserOffre construit un lien de repli si urlOrigine manque', () => {
  const o = normaliserOffre({ ...REPONSE_FT, origineOffre: undefined });
  assert.ok(o.lien.includes('196MXKT'));
});

test('normaliserOffre tolère les champs absents sans planter', () => {
  const o = normaliserOffre({ id: 'X1', intitule: 'Juriste' });
  assert.equal(o.entreprise, '');
  assert.equal(o.ville, '');
  assert.equal(o.description, '');
  assert.equal(o.salaireSource, null);
});
