import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corrections } from '../scripts/corriger-departements.js';
import { normaliserOffre } from '../src/sources/adzuna.js';
import { deduireDepartement } from '../src/zone.js';

/**
 * LE DÉFAUT D'ORIGINE.
 *
 * Adzuna descend jusqu'à l'arrondissement : ['France', 'Île-de-France',
 * 'Paris', '8ème Arrondissement']. Ne garder que le dernier élément — le plus
 * précis — faisait perdre « Paris » en chemin. Treize offres parisiennes se
 * retrouvaient sous un nom de quartier que rien ne rattachait à une ville.
 */
test('Adzuna : l\'arrondissement ne remplace pas la ville', () => {
  const avec = (area) => normaliserOffre({ location: { area } }).ville;

  assert.equal(avec(['France', 'Île-de-France', 'Paris', '8ème Arrondissement']),
    'Paris 8ème Arrondissement');
  assert.equal(avec(['France', 'Île-de-France', 'Paris', '1er-Arrondissement']),
    'Paris 1er-Arrondissement');
  assert.equal(avec(['France', "Provence-Alpes-Côte d'Azur", 'Marseille', '7e Arrondissement']),
    'Marseille 7e Arrondissement');

  // Une commune ordinaire n'est pas touchée : le dernier élément reste le bon.
  assert.equal(avec(['France', 'Grand Est', 'Bas-Rhin', 'Strasbourg']), 'Strasbourg');
  assert.equal(avec(['France', 'Grand Est', 'Bas-Rhin']), 'Bas-Rhin');
});

/**
 * L'ERREUR QUI SUIVAIT, ET QUI ÉTAIT PIRE.
 *
 * Le numéro du quartier était ensuite lu comme un département :
 * « 13ème Arrondissement » devenait les Bouches-du-Rhône, « 17ème » la
 * Charente-Maritime, « 18ème » le Cher. Trois offres de Paris rangées à
 * l'autre bout du pays — et avec l'assurance d'un champ rempli.
 */
test('un numéro d\'arrondissement n\'est jamais un département', () => {
  assert.equal(deduireDepartement({ ville: '13ème Arrondissement' }), null);
  assert.equal(deduireDepartement({ ville: '17ème Arrondissement' }), null);
  assert.equal(deduireDepartement({ ville: '1er-Arrondissement' }), null);
  assert.equal(deduireDepartement({ ville: 'Paris 8e Arrondissement' }), null);

  // Ce qui est un vrai département continue de l'être.
  assert.equal(deduireDepartement({ codePostal: '67230' }), '67');
  assert.equal(deduireDepartement({ ville: 'NANCY', zone: '54 - NANCY' }), '54');
  assert.equal(deduireDepartement({ departement: '75' }), '75');
  // Un code postal reste lisible même à côté d'un arrondissement.
  assert.equal(deduireDepartement({ codePostal: '75008', ville: '8ème Arrondissement' }), '75');
});

test('la réparation ne corrige que ce dont elle est sûre', () => {
  // Majorité NETTE : sept Metz en 57 contre un en 67.
  const metz = [
    { id: 'a', ville: 'Metz', departement: '67' },
    ...Array.from({ length: 7 }, (_, i) => ({ id: 's' + i, ville: 'Metz', departement: '57' })),
  ];
  const r = corrections(metz);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 'a');
  assert.equal(r[0].apres, '57');

  // Égalité parfaite : on ne sait pas, donc on ne touche à rien. L'ordre de
  // tri n'est pas un arbitre.
  assert.deepEqual(corrections([
    { id: 'x', ville: 'Étiolles', departement: '88' },
    { id: 'y', ville: 'Étiolles', departement: '91' },
  ]), []);

  // Le département issu d'un numéro d'arrondissement est remis à vide plutôt
  // que remplacé : la ville étant inconnue, en inventer une refait l'erreur.
  const arr = corrections([{ id: 'z', ville: '13ème Arrondissement', departement: '13' }]);
  assert.equal(arr.length, 1);
  assert.equal(arr[0].apres, null);

  // Un vrai arrondissement parisien, lui, garde son département.
  assert.deepEqual(corrections([{ id: 'w', ville: 'Paris 18e Arrondissement', departement: '75' }]), []);
});
