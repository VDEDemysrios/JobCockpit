import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forces } from '../public/render.js';

/**
 * CE QUE CETTE FONCTION EXISTE POUR RÉSOUDRE.
 *
 * « Je doute de coller au poste. » Or l'analyse répondait déjà, 129 fois :
 * « Oui, c'est ta cible exacte. Fonce. », « ton profil coche 90 % des
 * exigences ». Couverture moyenne des atouts face aux exigences : 75 %.
 * Ce jugement vivait dans le détail replié de la carte — il fallait donc
 * avoir déjà surmonté le doute pour lire ce qui l'aurait levé.
 */
test('compte les atouts, les manques et les compensables', () => {
  const f = forces({
    verdict: 'Oui, c\'est ta cible exacte. Fonce, ton profil fait mouche.',
    prouvable: ['Portefeuille de 8 projets', 'Concertation locale', 'Master 2'],
    nonprouvable: ['Expérience en ALEC', 'Travail avec des copropriétés'],
    compensable: ['La méconnaissance des ALEC se compense'],
  });
  assert.equal(f.atouts, 3);
  assert.equal(f.manques, 2);
  assert.equal(f.compensables, 1);
  assert.equal(f.premierAtout, 'Portefeuille de 8 projets');
});

/** Sans analyse, il n'y a rien à dire — et surtout rien à inventer. */
test('rend null quand l\'offre n\'a pas été analysée', () => {
  assert.equal(forces(null), null);
  assert.equal(forces(undefined), null);
});

test('supporte une analyse aux champs absents ou vides', () => {
  const f = forces({ verdict: 'Correct.' });
  assert.equal(f.atouts, 0);
  assert.equal(f.manques, 0);
  assert.equal(f.premierAtout, '');

  const g = forces({ prouvable: ['Un point', null, ''], nonprouvable: null });
  assert.equal(g.atouts, 1, 'les entrées vides ne comptent pas');
  assert.equal(g.manques, 0);
});

/**
 * LE VERDICT RÉSERVÉ DOIT PASSER AUSSI.
 *
 * Une carte qui ne dirait que du bien deviendrait un bruit de fond qu'on
 * cesse de lire. C'est le contraste entre « Fonce » et « c'est jouable,
 * mais » qui rend le premier utile — et qui aide à choisir où mettre son
 * énergie.
 */
test('un verdict nuancé est rendu tel quel', () => {
  const f = forces({
    verdict: 'C\'est jouable grâce à ton Bac+5, mais ton profil manque d\'ancrage en collectivité.',
    prouvable: ['Bac +5'], nonprouvable: ['Collectivité', 'Marchés publics', 'Encadrement'],
  });
  assert.ok(f.verdict.startsWith('C\'est jouable'));
  assert.equal(f.manques, 3, 'les manques ne sont pas masqués');
});
