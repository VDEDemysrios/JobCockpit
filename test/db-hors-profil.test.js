import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase, upsertOffre, offresHorsProfil, supprimerOffres } from '../src/db.js';

const OFFRE = {
  id: 'x', source: 'adzuna', sourcesAll: ['adzuna'], externalId: 'e1',
  titre: 'Chef de projet', entreprise: 'ACME', ville: 'Nancy (54)', departement: '54',
  horsZone: 0, contrat: 'CDI', dateOffre: '2026-07-20', lien: 'https://x',
  description: 'texte', salaireSource: null, groupe: 1, score: 8,
  scoreDetail: null, analysisJson: null, isManual: 0,
};

const base = (offres) => {
  const db = ouvrirBase(':memory:');
  for (const o of offres) upsertOffre(db, o);
  return db;
};

test('repère les offres classées « à écarter », avec leur motif éliminatoire', () => {
  const db = base([{
    ...OFFRE, id: 'a', groupe: 3, score: 0,
    scoreDetail: { eliminatoires: [{ motif: 'genie electrique', note: 'hors compétences techniques' }] },
  }]);

  const hors = offresHorsProfil(db);
  assert.equal(hors.length, 1);
  assert.equal(hors[0].motif, 'ecartee');
  assert.equal(hors[0].detail, 'hors compétences techniques');
});

test('repère les offres que l\'analyse refuse, même bien notées par les mots-clés', () => {
  const db = base([{
    ...OFFRE, id: 'b', groupe: 1, score: 9,
    analysisJson: { verdict: 'Non — poste d\'ingénieur d\'exploitation, sans rapport.' },
  }]);

  const hors = offresHorsProfil(db);
  assert.equal(hors.length, 1);
  assert.equal(hors[0].motif, 'verdict');
});

test('laisse tranquilles les offres qui correspondent', () => {
  const db = base([
    { ...OFFRE, id: 'c' },
    { ...OFFRE, id: 'd', groupe: 2, score: 4, analysisJson: { verdict: 'Oui, à tenter.' } },
  ]);
  assert.equal(offresHorsProfil(db).length, 0);
});

// La garantie centrale du projet : une offre portant la moindre trace de
// travail personnel n'est jamais candidate à la suppression automatique.
test('protège toute offre portant une trace de suivi', () => {
  const traces = [
    { status: 'Envoyé' },
    { sent_date: '2026-07-25' },
    { relance_date: '2026-08-01' },
    { notes: 'appelé le recruteur' },
    { pinned: 1 },
  ];

  for (const trace of traces) {
    const db = base([{ ...OFFRE, id: 'e', groupe: 3, score: 0 }]);
    const colonnes = Object.keys(trace);
    db.prepare(`INSERT INTO tracking (offer_id, ${colonnes.join(', ')})
                VALUES (?, ${colonnes.map(() => '?').join(', ')})`)
      .run('e', ...Object.values(trace));

    assert.equal(offresHorsProfil(db).length, 0,
      `une offre avec ${colonnes[0]} renseigné doit être protégée`);
  }

  // Une lettre rédigée protège aussi, même sans suivi.
  const avecLettre = base([{ ...OFFRE, id: 'f', groupe: 3, score: 0 }]);
  avecLettre.prepare('INSERT INTO letters (offer_id, content) VALUES (?, ?)').run('f', 'Madame…');
  assert.equal(offresHorsProfil(avecLettre).length, 0);

  // Une offre saisie à la main est un choix délibéré : on n'y touche pas.
  const manuelle = base([{ ...OFFRE, id: 'g', groupe: 3, score: 0, isManual: 1 }]);
  assert.equal(offresHorsProfil(manuelle).length, 0);
});

test('la suppression n\'enlève que les offres désignées', () => {
  const db = base([
    { ...OFFRE, id: 'h', groupe: 3, score: 0 },
    { ...OFFRE, id: 'i' },
  ]);

  assert.equal(supprimerOffres(db, offresHorsProfil(db).map(o => o.id)), 1);
  const restantes = db.prepare('SELECT id FROM offers').all().map(r => r.id);
  assert.deepEqual(restantes, ['i']);
});
