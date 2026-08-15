import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirePrompt, validerAnalyse, analyserOffre } from '../src/analyze.js';

const OFFRE = {
  titre: 'Chef de projet agrivoltaïque',
  entreprise: 'SOLARIS',
  ville: 'Nancy (54)',
  description: 'Développement de projets agrivoltaïques, de la prospection au dépôt des autorisations.',
  salaireSource: '38 000 – 45 000 €',
};

test('construirePrompt inclut le CV, l\'offre et le format attendu', () => {
  const p = construirePrompt(OFFRE, 'Camille Durand — Chef de Projet & Juriste. Master 2 Droit et Gestion des Énergies.');
  assert.ok(p.includes('Master 2 Droit'), 'le CV doit être dans le prompt');
  assert.ok(p.includes('Chef de projet agrivoltaïque'), 'le titre doit être dans le prompt');
  assert.ok(p.includes('SOLARIS'), 'l\'entreprise doit être dans le prompt');
  assert.ok(p.includes('"prouvable"'), 'le format JSON attendu doit être décrit');
  assert.ok(p.includes('38 000 – 45 000 €'), 'le salaire annoncé doit être transmis');
});

test('validerAnalyse accepte une analyse complète', () => {
  const analyse = {
    exige: ['Bac+5'], souhaite: ['Anglais'], decoratif: ['Ambiance'],
    prouvable: ['M2 Droit'], nonprouvable: ['5 ans'], compensable: ['Partiel'],
    verdict: 'Oui, candidature légitime.',
    kw: [['agrivoltaïsme', 'oui', '90% du portefeuille']],
    fourchette: '38 000 – 45 000 €', fnote: 'Marché EnR junior.',
    formul: ['a', 'b', 'c'], budget: ['a', 'b', 'c'],
  };
  assert.deepEqual(validerAnalyse(analyse), analyse);
});

test('validerAnalyse rejette une analyse sans verdict', () => {
  assert.equal(validerAnalyse({ exige: ['Bac+5'] }), null);
  assert.equal(validerAnalyse({ verdict: '   ' }), null);
});

test('validerAnalyse rejette null et les types incorrects', () => {
  assert.equal(validerAnalyse(null), null);
  assert.equal(validerAnalyse({ verdict: 'Oui', exige: 'pas un tableau' }), null);
  assert.equal(validerAnalyse('une chaîne'), null);
  assert.equal(validerAnalyse([1, 2, 3]), null);
});

test('validerAnalyse complète les champs facultatifs absents', () => {
  const r = validerAnalyse({ verdict: 'Oui.', exige: ['Bac+5'], prouvable: ['M2'] });
  assert.deepEqual(r.souhaite, []);
  assert.deepEqual(r.kw, []);
  assert.equal(r.fourchette, null);
});

test('validerAnalyse filtre les lignes de mots-clés mal formées', () => {
  const r = validerAnalyse({
    verdict: 'Oui.', exige: [], prouvable: [],
    kw: [['bon', 'oui', 'raison'], ['incomplet'], 'pas un tableau', ['x', 'peut-être', 'y']],
  });
  assert.deepEqual(r.kw, [['bon', 'oui', 'raison']]);
});

test('analyserOffre renvoie null sans clé API, sans lever d\'exception', async () => {
  const cle = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  assert.equal(await analyserOffre(OFFRE, 'un CV assez long'.padEnd(200, ' .')), null);
  if (cle) process.env.GEMINI_API_KEY = cle;
});
