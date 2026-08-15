import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase, upsertOffre } from '../src/db.js';

function offreExemple(surcharge = {}) {
  return {
    id: 'abc123', source: 'france-travail', sourcesAll: ['france-travail'],
    externalId: 'FT-1', titre: 'Chef de projet EnR', entreprise: 'ACME',
    ville: 'Nancy (54)', departement: '54', horsZone: 0, contrat: 'CDI',
    dateOffre: '2026-07-25', lien: 'https://example.org/1',
    description: 'Description complète de l\'offre.', salaireSource: null,
    groupe: 1, score: 9, scoreDetail: { positifs: [] },
    ...surcharge,
  };
}

test('upsertOffre insère une nouvelle offre', () => {
  const db = ouvrirBase(':memory:');
  const r = upsertOffre(db, offreExemple());
  assert.equal(r.nouvelle, true);

  const ligne = db.prepare('SELECT * FROM offers WHERE id = ?').get('abc123');
  assert.equal(ligne.titre, 'Chef de projet EnR');
  assert.equal(ligne.groupe, 1);
  assert.ok(ligne.first_seen);
  db.close();
});

test('upsertOffre met à jour une offre déjà connue sans la dupliquer', () => {
  const db = ouvrirBase(':memory:');
  upsertOffre(db, offreExemple());
  const r = upsertOffre(db, offreExemple({ groupe: 2, score: 4 }));
  assert.equal(r.nouvelle, false);

  const n = db.prepare('SELECT COUNT(*) AS n FROM offers').get().n;
  assert.equal(n, 1);
  assert.equal(db.prepare('SELECT groupe FROM offers WHERE id = ?').get('abc123').groupe, 2);
  db.close();
});

test('upsertOffre conserve first_seen lors d\'une mise à jour', () => {
  const db = ouvrirBase(':memory:');
  upsertOffre(db, offreExemple());
  const avant = db.prepare('SELECT first_seen FROM offers WHERE id = ?').get('abc123').first_seen;
  upsertOffre(db, offreExemple({ titre: 'Titre modifié' }));
  const apres = db.prepare('SELECT first_seen FROM offers WHERE id = ?').get('abc123').first_seen;
  assert.equal(avant, apres);
  db.close();
});

test('upsertOffre n\'écrase JAMAIS une analyse existante par une valeur vide', () => {
  const db = ouvrirBase(':memory:');
  upsertOffre(db, offreExemple({ analysisJson: { verdict: 'Oui, fonce.' } }));
  upsertOffre(db, offreExemple({ analysisJson: null }));

  const ligne = db.prepare('SELECT analysis_json FROM offers WHERE id = ?').get('abc123');
  assert.equal(JSON.parse(ligne.analysis_json).verdict, 'Oui, fonce.');
  db.close();
});

test('upsertOffre garde la description la plus longue', () => {
  const db = ouvrirBase(':memory:');
  upsertOffre(db, offreExemple({ description: 'Description nettement plus longue et détaillée du poste.' }));
  upsertOffre(db, offreExemple({ description: 'Courte.' }));

  const ligne = db.prepare('SELECT description FROM offers WHERE id = ?').get('abc123');
  assert.match(ligne.description, /nettement plus longue/);
  db.close();
});

// ---- LE TEST CRITIQUE DU PROJET ----
test('upsertOffre ne touche JAMAIS aux données personnelles', () => {
  const db = ouvrirBase(':memory:');
  upsertOffre(db, offreExemple());

  db.prepare(`INSERT INTO tracking (offer_id, status, sent_date, relance_date, notes, pinned, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('abc123', 'Entretien', '2026-07-20', '2026-08-05', 'Contact : Mme Durand', 1, '2026-07-20');

  // Une collecte ultérieure revoit l'offre, avec des données différentes.
  upsertOffre(db, offreExemple({ groupe: 3, titre: 'Titre changé', description: 'Autre.' }));

  const t = db.prepare('SELECT * FROM tracking WHERE offer_id = ?').get('abc123');
  assert.equal(t.status, 'Entretien');
  assert.equal(t.sent_date, '2026-07-20');
  assert.equal(t.relance_date, '2026-08-05');
  assert.equal(t.notes, 'Contact : Mme Durand');
  assert.equal(t.pinned, 1);
  db.close();
});
