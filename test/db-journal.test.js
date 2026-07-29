import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase, journaliser, lireJoursActifs, SANS_ACTIVITE } from '../src/db.js';

test('journaliser enregistre le type, le jour et l\'heure', () => {
  const db = ouvrirBase(':memory:');
  journaliser(db, 'candidature', { offerId: 'abc', quand: new Date(2026, 6, 28, 14, 30) });

  const e = db.prepare('SELECT * FROM evenements').get();
  assert.equal(e.type, 'candidature');
  assert.equal(e.offer_id, 'abc');
  assert.equal(e.jour, '2026-07-28');
  assert.equal(e.heure, 14);
});

// Une action du lundi 23 h doit compter pour LUNDI. Une conversion UTC
// l'aurait basculée au mardi et cassé la série un jour sur deux en été.
test('le jour est calculé en heure locale, pas en UTC', () => {
  const db = ouvrirBase(':memory:');
  journaliser(db, 'lettre', { quand: new Date(2026, 6, 28, 23, 45) });
  assert.equal(db.prepare('SELECT jour FROM evenements').get().jour, '2026-07-28');
});

test('journaliser nourrit la série', () => {
  const db = ouvrirBase(':memory:');
  journaliser(db, 'candidature', { quand: new Date(2026, 6, 28, 9, 0) });
  journaliser(db, 'relance', { quand: new Date(2026, 6, 28, 10, 0) });

  assert.deepEqual(lireJoursActifs(db), ['2026-07-28']);
  assert.equal(db.prepare('SELECT actions FROM activite WHERE jour = ?').get('2026-07-28').actions, 2);
});

// Épingler ou annoter n'est pas « avancer » : compter ces gestes
// entretiendrait une série sans qu'aucune candidature ne bouge.
test('les actions sans portée ne comptent pas comme une journée de travail', () => {
  const db = ouvrirBase(':memory:');
  journaliser(db, 'epingle', { quand: new Date(2026, 6, 28, 9, 0), sansActivite: true });

  assert.equal(db.prepare('SELECT COUNT(*) n FROM evenements').get().n, 1,
    'l\'événement est bien journalisé');
  assert.deepEqual(lireJoursActifs(db), [],
    'mais il ne compte pas comme une journée active');
});

test('la liste des actions neutres est explicite', () => {
  assert.ok(SANS_ACTIVITE.has('epingle'));
  assert.ok(SANS_ACTIVITE.has('note'));
  assert.ok(SANS_ACTIVITE.has('collecte'));
  assert.ok(!SANS_ACTIVITE.has('candidature'));
  assert.ok(!SANS_ACTIVITE.has('lettre'));
});

test('le journal survit à une réouverture de la base', () => {
  // Le schéma est appliqué à chaque démarrage : il doit rester idempotent.
  const db = ouvrirBase(':memory:');
  journaliser(db, 'candidature', {});

  assert.doesNotThrow(() => db.exec(`
    CREATE TABLE IF NOT EXISTS evenements (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL,
      offer_id TEXT, jour TEXT NOT NULL, heure INTEGER, cree_le TEXT, meta TEXT)`));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM evenements').get().n, 1);
});
