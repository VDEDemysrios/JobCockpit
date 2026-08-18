// CV ADAPTÉ + ÉCART.
//
// Deux pièces logiques, verrouillées ici : l'écart tiré de l'analyse (pas un
// nouvel appel au modèle), et les garde-fous du prompt (rien d'inventé).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculerEcart, construirePromptCvAdapte } from '../src/cvadapte.js';

/**
 * L'ÉCART VIENT DE L'ANALYSE EXISTANTE, sans nouvel appel. Ce que l'offre
 * exige et que le CV ne prouve pas, plus les mots-clés marqués absents — mais
 * PAS ceux jugés « partiels » (à moitié couverts, pas vraiment un manque).
 */
test('l\'écart retient les manques réels, pas les à-moitié', () => {
  const ec = calculerEcart({
    nonprouvable: ['5 ans en M&A', 'anglais courant', ''],
    kw: [
      ['due diligence', 'non', 'jamais fait'],
      ['modélisation financière', 'partiel', 'à moitié'],
      ['Excel', 'oui', 'maîtrisé'],
    ],
  });
  assert.deepEqual(ec.manques, ['5 ans en M&A', 'anglais courant'], 'le vide est écarté');
  assert.deepEqual(ec.motsCles, ['due diligence'],
    'seuls les « non » sont des manques ; « partiel » et « oui » n\'y sont pas');
});

test('sans analyse, l\'écart est vide plutôt qu\'en erreur', () => {
  assert.deepEqual(calculerEcart(null), { manques: [], motsCles: [] });
  assert.deepEqual(calculerEcart({}), { manques: [], motsCles: [] });
});

/**
 * LE PROMPT INTERDIT D'INVENTER, ET DOIT LE GARDER. Un CV adapté qui fabrique
 * une expérience se démonte au premier entretien — c'est pire qu'un CV
 * générique.
 */
test('le prompt du CV adapté interdit toute invention', () => {
  const p = construirePromptCvAdapte({
    offre: { titre: 'Directeur de projet', entreprise: 'Neoen', description: 'Piloter des parcs.' },
    analyse: { exige: ['piloter un portefeuille'], prouvable: ['8 projets menés'] },
    cv: 'x'.repeat(200),
  });
  assert.match(p, /Directeur de projet/);
  assert.match(p, /N'utilise QUE ce qui figure dans le CV/i);
  assert.match(p, /Réordonner et reformuler est permis ; fabriquer est interdit/i);
  assert.match(p, /"accroche"[\s\S]*"points"[\s\S]*"forces"/, 'sortie JSON structurée');
  // L'analyse déjà faite est réinjectée, pas refaite.
  assert.match(p, /8 projets menés/, 'ce que le candidat peut prouver est rappelé');
});
