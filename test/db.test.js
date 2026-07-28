import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase, lireMeta, ecrireMeta, transaction } from '../src/db.js';

test('ouvrirBase crée les 4 tables attendues', () => {
  const db = ouvrirBase(':memory:');
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map(r => r.name);

  for (const attendue of ['letters', 'meta', 'offers', 'tracking']) {
    assert.ok(tables.includes(attendue), `table « ${attendue} » manquante`);
  }
  db.close();
});

test('ouvrirBase est idempotente (relançable sans erreur)', () => {
  const db = ouvrirBase(':memory:');
  assert.doesNotThrow(() => ouvrirBase(':memory:'));
  db.close();
});

test('meta stocke et relit une valeur', () => {
  const db = ouvrirBase(':memory:');
  ecrireMeta(db, 'last_collect_at', '2026-07-28T07:00:00Z');
  assert.equal(lireMeta(db, 'last_collect_at'), '2026-07-28T07:00:00Z');
  db.close();
});

test('ecrireMeta remplace une valeur existante', () => {
  const db = ouvrirBase(':memory:');
  ecrireMeta(db, 'statut', 'ok');
  ecrireMeta(db, 'statut', 'partiel');
  assert.equal(lireMeta(db, 'statut'), 'partiel');
  db.close();
});

test('lireMeta renvoie null pour une clé inconnue', () => {
  const db = ouvrirBase(':memory:');
  assert.equal(lireMeta(db, 'jamais_ecrite'), null);
  db.close();
});

test('offers refuse deux offres avec le même id', () => {
  const db = ouvrirBase(':memory:');
  const ins = db.prepare('INSERT INTO offers (id, titre, entreprise, ville) VALUES (?, ?, ?, ?)');
  ins.run('abc123', 'Juriste', 'ACME', 'Nancy');
  assert.throws(() => ins.run('abc123', 'Autre', 'AUTRE', 'Lyon'), /UNIQUE|constraint/i);
  db.close();
});

test('transaction valide les écritures en cas de succès', () => {
  const db = ouvrirBase(':memory:');
  const resultat = transaction(db, () => {
    ecrireMeta(db, 'a', '1');
    return 'termine';
  });
  assert.equal(resultat, 'termine');
  assert.equal(lireMeta(db, 'a'), '1');
  db.close();
});

test('transaction annule tout en cas d\'erreur', () => {
  const db = ouvrirBase(':memory:');
  ecrireMeta(db, 'avant', 'ok');

  assert.throws(() => transaction(db, () => {
    ecrireMeta(db, 'pendant', 'devrait disparaitre');
    throw new Error('boum');
  }), /boum/);

  assert.equal(lireMeta(db, 'pendant'), null, 'l\'écriture doit avoir été annulée');
  assert.equal(lireMeta(db, 'avant'), 'ok', 'l\'écriture antérieure doit survivre');
  db.close();
});
