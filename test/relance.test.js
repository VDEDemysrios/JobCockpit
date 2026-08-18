// LA RELANCE : un rappel qui devient une action.
//
// L'application repérait les candidatures sans réponse ; elle s'arrêtait là.
// Ce module rédige le courriel de relance. On verrouille ici les deux pièces
// logiques — le délai en clair et le prompt — pas l'appel au modèle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delaiEnMots, construirePromptRelance } from '../src/relance.js';

test('le délai se dit dans la bonne unité', () => {
  assert.equal(delaiEnMots(0), "aujourd'hui");
  assert.equal(delaiEnMots(1), 'hier');
  assert.equal(delaiEnMots(12), 'il y a 12 jours');
  assert.equal(delaiEnMots(21), 'il y a 3 semaines');
  assert.equal(delaiEnMots(75), 'il y a environ 3 mois');
  assert.equal(delaiEnMots(-4), "aujourd'hui", 'un délai négatif ne dit pas « il y a -4 jours »');
});

/**
 * LE PROMPT PORTE LES GARDE-FOUS, ET DOIT LES GARDER.
 *
 * Une relance n'est pas une seconde lettre : elle ne réargumente pas et
 * n'invente rien. Le poste, l'entreprise et le délai doivent y être — sans eux
 * le modèle écrit une relance passe-partout, qu'on aurait pu copier n'importe
 * où.
 */
test('le prompt de relance porte l\'offre, le délai et l\'interdit d\'inventer', () => {
  const p = construirePromptRelance({
    offre: { titre: 'Chargé de projet EnR', entreprise: 'Voltalia', ville: 'Nancy' },
    coordonnees: { nom: 'Benjamin Perrin' },
    jours: 14,
  });
  assert.match(p, /Chargé de projet EnR/);
  assert.match(p, /Voltalia/);
  assert.match(p, /il y a 2 semaines/, 'le délai écoulé est nommé');
  assert.match(p, /Benjamin Perrin/, 'la relance est signée');
  assert.match(p, /aucune expérience.*qui ne serait pas déjà connue/is,
    'l\'interdiction d\'inventer doit rester dans le prompt');
  assert.match(p, /"objet"[\s\S]*"corps"/, 'la sortie attendue est un JSON objet + corps');
});

/** Une première relance déjà faite se dit au modèle : le ton d'une seconde diffère. */
test('une seconde relance est signalée comme telle', () => {
  const p = construirePromptRelance({
    offre: { titre: 'X', entreprise: 'Y' }, coordonnees: { nom: 'Z' },
    jours: 30, statut: 'Relancé',
  });
  assert.match(p, /première relance a déjà été faite/);
});
