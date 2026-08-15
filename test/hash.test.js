import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliser, offreId } from '../src/hash.js';

test('normaliser met en minuscules et retire les accents', () => {
  assert.equal(normaliser('Chargé de Développement ÉNERGIE'), 'charge de developpement energie');
});

test('normaliser retire les mentions H/F sous toutes leurs formes', () => {
  assert.equal(normaliser('Juriste H/F'), 'juriste');
  assert.equal(normaliser('Juriste (H/F)'), 'juriste');
  assert.equal(normaliser('Juriste F/H'), 'juriste');
  assert.equal(normaliser('Juriste (h/f)'), 'juriste');
  assert.equal(normaliser('Chef de projet M/F'), 'chef de projet');
});

test('normaliser retire le code postal entre parenthèses', () => {
  assert.equal(normaliser('Strasbourg (67)'), 'strasbourg');
  assert.equal(normaliser('La Seyne-sur-Mer (83)'), 'la seyne sur mer');
});

test('normaliser compresse les espaces multiples', () => {
  assert.equal(normaliser('Chef   de    projet'), 'chef de projet');
});

test('offreId est identique malgré les variantes de graphie', () => {
  const a = offreId('Chef de projet ENR H/F', 'Veles Energies', 'Bordeaux (33)');
  const b = offreId('Chef de Projet ENR (H/F)', 'VELES ENERGIES', 'bordeaux');
  assert.equal(a, b);
});

test('offreId diffère pour deux offres différentes', () => {
  const a = offreId('Contract Manager', 'PAPREC', 'Paris (75)');
  const b = offreId('Contract Manager', 'PAPREC', 'La Seyne-sur-Mer (83)');
  assert.notEqual(a, b);
});

test('offreId fait 16 caractères hexadécimaux', () => {
  const id = offreId('Juriste', 'ACME', 'Nancy');
  assert.match(id, /^[0-9a-f]{16}$/);
});

test('offreId tolère les champs vides sans planter', () => {
  assert.match(offreId('Juriste', '', ''), /^[0-9a-f]{16}$/);
});
