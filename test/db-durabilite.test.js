// LA DURABILITÉ DES ÉCRITURES.
//
// En mode WAL, SQLite se contente par défaut de `synchronous = NORMAL` : il ne
// force l'écriture sur disque qu'aux points de contrôle. Bon compromis pour
// une base qui encaisse des milliers d'écritures par seconde ; mauvais pour
// celle-ci, où une écriture vaut « j'ai postulé » ou « entretien le 26 » et où
// l'application est fermée, mise à jour et relancée sans cesse.
//
// Écrit après une perte constatée : une date d'entretien confirmée par l'API,
// absente de la base après un arrêt suivi d'une mise à jour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase } from '../src/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('la base force l\'écriture sur disque à chaque validation', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'jc-'));
  try {
    const db = ouvrirBase(join(dossier, 'essai.db'));
    // 2 = FULL. En dessous, une validation peut n'exister qu'en mémoire.
    const { synchronous } = db.prepare('PRAGMA synchronous').get();
    assert.equal(synchronous, 2,
      'synchronous doit valoir FULL : une candidature perdue coûte plus cher que la lenteur');
    db.close();
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test('le mode WAL reste actif : lire pendant que la collecte écrit', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'jc-'));
  try {
    const db = ouvrirBase(join(dossier, 'essai.db'));
    const { journal_mode } = db.prepare('PRAGMA journal_mode').get();
    assert.equal(String(journal_mode).toLowerCase(), 'wal');
    db.close();
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

/** La date d'entretien survit à une fermeture et une réouverture. */
test('une date d\'entretien écrite survit à la fermeture de la base', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'jc-'));
  const chemin = join(dossier, 'essai.db');
  try {
    let db = ouvrirBase(chemin);
    db.prepare('INSERT INTO offers (id, titre) VALUES (?, ?)').run('x1', 'Poste');
    db.prepare('INSERT INTO tracking (offer_id, entretien_date) VALUES (?, ?)')
      .run('x1', '2026-08-26');
    db.close();

    db = ouvrirBase(chemin);
    const r = db.prepare('SELECT entretien_date FROM tracking WHERE offer_id = ?').get('x1');
    assert.equal(r.entretien_date, '2026-08-26');
    db.close();
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});
