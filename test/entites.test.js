// LE DÉCODAGE DES ENTITÉS, ET LE DOUBLE ÉCHAPPEMENT.
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// L'API de YouTube renvoie ses titres DÉJÀ encodés : « "All About It" » arrive
// en `&quot;All About It&quot;`, un accent en `&#233;`. L'interface les échappe
// une SECONDE fois avant de les insérer — c'est la règle, et elle est juste —
// donc `&quot;` devient `&amp;quot;` et le navigateur affiche `&quot;` en
// toutes lettres au milieu du titre.
//
// Le coupable n'est jamais l'échappement à l'affichage : c'est l'absence de
// décodage à l'entrée. La règle du projet est donc : on décode À LA SOURCE,
// une seule fois, quand la donnée entre.
//
// Rien de tout cela ne lève d'erreur. Le seul symptôme est un titre laid, que
// l'on met volontiers sur le compte du fournisseur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decoderEntites, decoder } from '../src/entites.js';

/** Le cas exact rapporté, tel qu'il s'affichait. */
test('un titre YouTube encodé redevient lisible', () => {
  assert.equal(
    decoderEntites('Hoodie Allen - &quot;All About It&quot; ft. Ed Sheeran'),
    'Hoodie Allen - "All About It" ft. Ed Sheeran');
});

test('les accents passent, nommés comme numérotés', () => {
  assert.equal(decoderEntites('Caf&eacute;'), 'Café');
  assert.equal(decoderEntites('&#233;t&#233;'), 'été');
  assert.equal(decoderEntites('&#xE9;t&#xE9;'), 'été');
  assert.equal(decoderEntites('d&#39;accord'), 'd\'accord');
  assert.equal(decoderEntites('&agrave; c&ocirc;t&eacute;'), 'à côté');
});

/**
 * LE PIÈGE DU DÉCODAGE EN DEUX TEMPS.
 *
 * Décoder `&lt;` puis `&amp;` séparément fait que `&amp;lt;` — qui représente
 * le TEXTE « &lt; » — finit en `<`, c'est-à-dire une balise. Un passage unique
 * consomme chaque entité une seule fois et ne se casse pas si quelqu'un
 * réordonne les lignes.
 */
test('une entité échappée deux fois ne se décode qu\'une', () => {
  assert.equal(decoderEntites('&amp;lt; reste'), '&lt; reste');
  assert.equal(decoderEntites('&amp;quot;'), '&quot;');
  assert.equal(decoderEntites('&amp;amp;'), '&amp;');
});

test('les entités de base sont couvertes', () => {
  assert.equal(decoderEntites('a &amp; b'), 'a & b');
  assert.equal(decoderEntites('&lt;balise&gt;'), '<balise>');
  assert.equal(decoderEntites('&laquo;&nbsp;citation&nbsp;&raquo;'), '« citation »');
  assert.equal(decoderEntites('trois&hellip;'), 'trois…');
});

/** Ce qui n'est pas une entité connue reste tel quel, sans rien casser. */
test('une entité inconnue ou malformée est laissée intacte', () => {
  assert.equal(decoderEntites('&pasuneentite;'), '&pasuneentite;');
  assert.equal(decoderEntites('100 & 200'), '100 & 200');
  assert.equal(decoderEntites('R&D'), 'R&D');
  assert.equal(decoderEntites('&#;'), '&#;');
});

/**
 * Un point de code hors bornes fait lever `String.fromCodePoint`. Une entité
 * malformée dans un titre ne doit pas faire tomber une collecte entière.
 */
test('un point de code impossible ne lève pas', () => {
  assert.equal(decoderEntites('&#999999999;'), '&#999999999;');
  assert.equal(decoderEntites('&#x110000;'), '&#x110000;');
  assert.equal(decoderEntites('&#-5;'), '&#-5;');
});

test('rien à décoder ne rend rien de bizarre', () => {
  assert.equal(decoderEntites(''), '');
  assert.equal(decoderEntites(null), '');
  assert.equal(decoderEntites(undefined), '');
  assert.equal(decoderEntites('texte ordinaire'), 'texte ordinaire');
});

/** Les flux enveloppent leurs titres dans du CDATA. */
test('le CDATA des flux est retiré', () => {
  assert.equal(decoderEntites('<![CDATA[Un titre]]>'), 'Un titre');
});

/**
 * `decoder` est la variante des adaptateurs de flux : elle rogne en plus. Les
 * deux doivent rester d'accord sur le décodage lui-même.
 */
test('la variante des flux décode pareil, et rogne', () => {
  assert.equal(decoder('  Caf&eacute;  '), 'Café');
  assert.equal(decoder('&amp;lt;'), '&lt;');
});
