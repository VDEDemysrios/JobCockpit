// LA BASE, CHANTIER 4.0 : traces oubliées, index, attente, fermeture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ouvrirBase, upsertOffre, supprimerOffres, restaurerRejet, purgerOffresPerimees,
  purgerSansReponse, offresHorsProfil, fermerBase, compacterJournal,
} from '../src/db.js';

const VIEUX = new Date(Date.now() - 90 * 86400000).toISOString();

function offre(db, id, extra = {}) {
  upsertOffre(db, {
    id, source: 'adzuna', sourcesAll: ['adzuna'], titre: `Offre ${id}`, entreprise: 'ACME',
    ville: 'Nancy', groupe: 3, score: 0, isManual: 0, ...extra,
  });
  // Vue il y a trois mois, jamais revue : candidate à toutes les purges.
  db.prepare('UPDATE offers SET first_seen = ?, last_seen = ? WHERE id = ?').run(VIEUX, VIEUX, id);
}

// RÉGRESSION : SANS_TRACE ignorait la date d'entretien et la table
// `entretiens`. Une offre « À postuler » avec un entretien noté d'avance, ou
// une préparation de trois jours, partait au premier ménage.
test('une date d\'entretien protège une offre de toutes les purges', () => {
  const db = ouvrirBase(':memory:');
  offre(db, 'avec-date');
  db.prepare(`INSERT INTO tracking (offer_id, status, entretien_date) VALUES ('avec-date', 'À postuler', '2026-12-01')`).run();

  assert.equal(purgerOffresPerimees(db, 30), 0);
  assert.equal(purgerSansReponse(db, 14), 0);
  assert.equal(offresHorsProfil(db).length, 0, 'ni proposée au nettoyage hors profil');
  assert.ok(db.prepare('SELECT 1 FROM offers WHERE id = ?').get('avec-date'));
  db.close();
});

test('une séance d\'entretien protège une offre, même sans suivi', () => {
  const db = ouvrirBase(':memory:');
  offre(db, 'preparee');
  offre(db, 'nue');
  db.prepare(`INSERT INTO entretiens (offer_id, echanges, fiche) VALUES ('preparee', '[]', 'Fiche payée en quota')`).run();

  assert.equal(purgerOffresPerimees(db, 30), 1, 'seule l\'offre sans rien part');
  assert.ok(db.prepare('SELECT 1 FROM offers WHERE id = ?').get('preparee'));
  assert.equal(db.prepare('SELECT 1 FROM offers WHERE id = ?').get('nue'), undefined);
  db.close();
});

// Écarter une offre emportait son suivi et sa lettre — mais laissait la
// séance d'entretien orpheline, et la restauration ne la rendait pas.
test('écarter puis restaurer emporte et rend la séance d\'entretien et les versions', () => {
  const db = ouvrirBase(':memory:');
  offre(db, 'x');
  db.prepare(`INSERT INTO entretiens (offer_id, echanges, notions) VALUES ('x', '[{"role":"jury"}]', '[{"terme":"PLU"}]')`).run();
  db.prepare(`INSERT INTO lettres_versions (offer_id, version, content, origine, cree_le) VALUES ('x', 1, 'v1', 'generee', ?)`).run(VIEUX);

  supprimerOffres(db, ['x'], 'manuel');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM entretiens').get().n, 0, 'plus d\'orphelin');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lettres_versions').get().n, 0);

  assert.equal(restaurerRejet(db, 'x'), true);
  const e = db.prepare('SELECT * FROM entretiens WHERE offer_id = ?').get('x');
  assert.equal(e.notions, '[{"terme":"PLU"}]', 'les cartes reviennent avec l\'offre');
  assert.equal(db.prepare('SELECT content FROM lettres_versions WHERE offer_id = ?').get('x').content, 'v1');
  db.close();
});

test('un rejet d\'avant le chantier (sans entretien ni versions) se restaure encore', () => {
  const db = ouvrirBase(':memory:');
  offre(db, 'ancien');
  const ligne = db.prepare('SELECT * FROM offers WHERE id = ?').get('ancien');
  db.prepare('DELETE FROM offers').run();
  db.prepare(`INSERT INTO rejetees (offer_id, motif, donnees) VALUES ('ancien', 'manuel', ?)`)
    .run(JSON.stringify({ offre: ligne, suivi: null, lettre: null }));
  assert.equal(restaurerRejet(db, 'ancien'), true);
  db.close();
});

test('la base attend 5 s un verrou au lieu d\'échouer aussitôt', () => {
  const db = ouvrirBase(':memory:');
  const r = db.prepare('PRAGMA busy_timeout').get();
  assert.equal(Object.values(r)[0], 5000);
  db.close();
});

test('les index du chantier 4.0 existent', () => {
  const db = ouvrirBase(':memory:');
  const index = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all().map(r => r.name));
  for (const nom of ['idx_tracking_status', 'idx_tracking_sent', 'idx_tracking_entretien',
    'idx_offers_first_seen', 'idx_offers_is_manual', 'idx_evenements_offre']) {
    assert.ok(index.has(nom), `index manquant : ${nom}`);
  }
  db.close();
});

test('une base ancienne, sans la colonne entretien_date, s\'ouvre et reçoit son index', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'jc-db40-'));
  const chemin = join(dossier, 'ancienne.db');
  try {
    const brute = ouvrirBase(chemin);
    // On simule une base d'avant la colonne : on la retire.
    brute.exec('DROP INDEX idx_tracking_entretien');
    brute.exec('ALTER TABLE tracking DROP COLUMN entretien_date');
    brute.close();

    const db = ouvrirBase(chemin);
    const cols = db.prepare(`SELECT name FROM pragma_table_info('tracking')`).all().map(r => r.name);
    assert.ok(cols.includes('entretien_date'));
    assert.ok(db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'idx_tracking_entretien'`).get());
    assert.ok(db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'lettres_versions'`).get(),
      'la table des versions est créée sur une base existante');

    // Le point de contrôle WAL rend un état, ne lève pas.
    assert.ok(compacterJournal(db));
    fermerBase(db);
    assert.throws(() => db.prepare('SELECT 1'), 'fermée pour de bon');
    fermerBase(db); // et deux fois sans dommage
  } finally {
    try { rmSync(dossier, { recursive: true, force: true }); } catch { /* verrou tardif Windows */ }
  }
});
