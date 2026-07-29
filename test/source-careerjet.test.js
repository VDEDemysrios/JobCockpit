import { test } from 'node:test';
import assert from 'node:assert/strict';
import careerjet, { normaliserOffre, filtrerParDate } from '../src/sources/careerjet.js';

const REPONSE_CAREERJET = {
  title: 'Chef de projet éolien H/F',
  company: 'BORALEX',
  locations: 'Nancy, Meurthe-et-Moselle',
  salary: '45 000 € - 55 000 € par an',
  date: '2026-07-24 09:12:00',
  url: 'https://www.careerjet.fr/jobad/fr9f2a1b',
  description: 'Vous pilotez le développement de parcs éoliens dans le Grand Est.',
};

test('normaliserOffre extrait les champs au format commun', () => {
  const o = normaliserOffre(REPONSE_CAREERJET);
  assert.equal(o.titre, 'Chef de projet éolien H/F');
  assert.equal(o.entreprise, 'BORALEX');
  assert.equal(o.ville, 'Nancy');
  assert.equal(o.dateOffre, '2026-07-24');
  assert.equal(o.lien, 'https://www.careerjet.fr/jobad/fr9f2a1b');
  assert.equal(o.salaireSource, '45 000 € - 55 000 € par an');
});

// Le libellé complet porte le département : c'est lui qui permet de
// reconnaître qu'une commune inconnue est bien dans la zone visée.
test('la zone conserve le libellé géographique entier', () => {
  assert.equal(normaliserOffre(REPONSE_CAREERJET).zone, 'Nancy, Meurthe-et-Moselle');
});

test('normaliserOffre tolère les champs absents', () => {
  const o = normaliserOffre({ title: 'Juriste' });
  assert.equal(o.entreprise, '');
  assert.equal(o.ville, '');
  assert.equal(o.dateOffre, null);
  assert.equal(o.salaireSource, null);
});

test('une date au format court reste exploitable', () => {
  assert.equal(normaliserOffre({ title: 'x', date: '2026-07-24' }).dateOffre, '2026-07-24');
});

test('une date illisible ne casse pas la normalisation', () => {
  assert.equal(normaliserOffre({ title: 'x', date: 'hier' }).dateOffre, null);
});

// L'API Careerjet ne sait pas filtrer par date : le tri se fait ici.
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

test('la source est ignorée tant que la clé est absente', () => {
  const avant = process.env.CAREERJET_API_KEY;
  delete process.env.CAREERJET_API_KEY;
  assert.equal(careerjet.estConfiguree(), false);

  process.env.CAREERJET_API_KEY = 'clef-de-test';
  assert.equal(careerjet.estConfiguree(), true);

  if (avant === undefined) delete process.env.CAREERJET_API_KEY;
  else process.env.CAREERJET_API_KEY = avant;
});
