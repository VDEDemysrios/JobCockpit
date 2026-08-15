import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase, purgerOffresPerimees } from '../src/db.js';

function insererOffre(db, id, joursDepuisDerniereVue) {
  const vueLe = new Date(Date.now() - joursDepuisDerniereVue * 86400000).toISOString();
  db.prepare(`INSERT INTO offers (id, titre, entreprise, ville, first_seen, last_seen, is_manual)
              VALUES (?, ?, 'ACME', 'Nancy', ?, ?, 0)`)
    .run(id, `Offre ${id}`, vueLe, vueLe);
}

test('purge une offre disparue depuis plus de 30 jours et sans suivi', () => {
  const db = ouvrirBase(':memory:');
  insererOffre(db, 'vieille', 45);
  assert.equal(purgerOffresPerimees(db), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM offers').get().n, 0);
  db.close();
});

test('ne purge PAS une offre encore récente', () => {
  const db = ouvrirBase(':memory:');
  insererOffre(db, 'recente', 5);
  assert.equal(purgerOffresPerimees(db), 0);
  db.close();
});

test('ne purge JAMAIS une offre sur laquelle on a agi', () => {
  const db = ouvrirBase(':memory:');

  insererOffre(db, 'candidatee', 90);
  db.prepare(`INSERT INTO tracking (offer_id, status) VALUES (?, 'Entretien')`).run('candidatee');

  insererOffre(db, 'annotee', 90);
  db.prepare(`INSERT INTO tracking (offer_id, status, notes) VALUES (?, 'À postuler', 'Rappeler M. Martin')`).run('annotee');

  insererOffre(db, 'epinglee', 90);
  db.prepare(`INSERT INTO tracking (offer_id, status, pinned) VALUES (?, 'À postuler', 1)`).run('epinglee');

  insererOffre(db, 'relancee', 90);
  db.prepare(`INSERT INTO tracking (offer_id, status, relance_date) VALUES (?, 'À postuler', '2026-09-01')`).run('relancee');

  insererOffre(db, 'aveclettre', 90);
  db.prepare(`INSERT INTO letters (offer_id, content) VALUES (?, 'Madame, Monsieur…')`).run('aveclettre');

  assert.equal(purgerOffresPerimees(db), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM offers').get().n, 5);
  db.close();
});

test('purge une offre ancienne dont le suivi est resté vierge', () => {
  const db = ouvrirBase(':memory:');
  insererOffre(db, 'ignoree', 90);
  db.prepare(`INSERT INTO tracking (offer_id, status, pinned) VALUES (?, 'À postuler', 0)`).run('ignoree');

  assert.equal(purgerOffresPerimees(db), 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tracking').get().n, 0,
    'le suivi vierge orphelin doit être nettoyé aussi');
  db.close();
});

test('ne purge JAMAIS une offre ajoutée manuellement', () => {
  const db = ouvrirBase(':memory:');
  const vieux = new Date(Date.now() - 200 * 86400000).toISOString();
  db.prepare(`INSERT INTO offers (id, titre, entreprise, ville, first_seen, last_seen, is_manual)
              VALUES ('manuelle', 'Ajoutée à la main', 'ACME', 'Nancy', ?, ?, 1)`).run(vieux, vieux);

  assert.equal(purgerOffresPerimees(db), 0);
  db.close();
});
