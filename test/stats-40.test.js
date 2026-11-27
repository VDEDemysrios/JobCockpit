// STATISTIQUES, CHANTIER 4.0 : radar tiré du profil, semaines sans seize
// requêtes, délais en jours locaux.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase, upsertOffre } from '../src/db.js';
import { calculerStats, famillesRadar } from '../src/stats.js';

function base() {
  const db = ouvrirBase(':memory:');
  upsertOffre(db, {
    id: 'a', titre: 'Data analyst', entreprise: 'X', groupe: 1, score: 8,
    scoreDetail: { positifs: [{ motif: 'python', poids: 3 }, { motif: 'sql', poids: 2 }] },
  });
  return db;
}

// RÉGRESSION : les familles codées en dur décrivaient UN métier. Un profil
// de data analyst voyait un radar d'agrivoltaïsme et de droit public à zéro.
test('le radar suit les familles du profil quand il en déclare', () => {
  const db = base();
  const profil = { scoring: { familles: [
    { axe: 'Programmation', motifs: ['python'] },
    { axe: 'Bases de données', motifs: ['sql'] },
  ] } };
  const radar = calculerStats(db, { profil, aujourdhui: '2026-11-13' }).radar;
  assert.deepEqual(radar.map(r => r.axe), ['Programmation', 'Bases de données']);
  assert.deepEqual(radar.map(r => r.n), [1, 1]);
  db.close();
});

test('sans familles dans le profil, le radar historique reste', () => {
  const db = base();
  const radar = calculerStats(db, { aujourdhui: '2026-11-13' }).radar;
  assert.ok(radar.some(r => r.axe === 'Agrivoltaïsme'));
  assert.equal(famillesRadar({ scoring: { familles: [{ pasUnAxe: true }] } })[0].axe, 'Agrivoltaïsme',
    'des familles mal formées ne vident pas le radar');
  db.close();
});

// Seize COUNT pour un chiffre déjà en mémoire : on compte les requêtes.
test('les semaines se calculent sans une requête par semaine', () => {
  const db = base();
  for (const [id, jour] of [['a', '2026-11-10'], ['b', '2026-11-03'], ['c', '2026-11-12']]) {
    db.prepare('INSERT INTO tracking (offer_id, status, sent_date) VALUES (?, ?, ?)').run(id, 'Envoyé', jour);
  }
  const preparer = db.prepare.bind(db);
  const requetes = [];
  db.prepare = (sql) => { requetes.push(sql); return preparer(sql); };

  const stats = calculerStats(db, { aujourdhui: '2026-11-13' });
  db.prepare = preparer;

  const parSemaine = requetes.filter(sql => /sent_date >= \? AND sent_date <= \?/.test(sql));
  assert.equal(parSemaine.length, 0, `encore ${parSemaine.length} requête(s) par semaine`);

  const semaines = Object.fromEntries(stats.semaines.map(s => [s.lundi, s.envois]));
  assert.equal(semaines['2026-11-09'], 2, 'lundi 9 → dimanche 15 : le 10 et le 12');
  assert.equal(semaines['2026-11-02'], 1);
  assert.equal(stats.semaines.length, 16);
  assert.equal(stats.records.meilleureSemaine, 2);
  db.close();
});

test('le délai d\'attente se compte en jours locaux, heure d\'été comprise', () => {
  const db = base();
  // Envoyée la veille du passage à l'heure d'hiver (25 octobre 2026).
  db.prepare('INSERT INTO tracking (offer_id, status, sent_date) VALUES (?, ?, ?)').run('a', 'Envoyé', '2026-10-24');
  const p = calculerStats(db, { aujourdhui: '2026-10-31' }).performance;
  assert.equal(p.delaiMoyen, 7);
  assert.equal(p.delaiMax, 7);
  db.close();
});
