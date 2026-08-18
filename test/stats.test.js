import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase, upsertOffre, journaliser } from '../src/db.js';
import { calculerStats, derniersJours, decaler, isoLocal } from '../src/stats.js';

/** Base en mémoire avec une offre et son suivi. */
function baseAvecOffre({ id = 'a1', ville = 'Nancy (54)', groupe = 1, score = 8, statut, envoiLe, relanceLe } = {}) {
  const db = ouvrirBase(':memory:');
  upsertOffre(db, {
    id, source: 'france-travail', sourcesAll: ['france-travail'], externalId: 'x',
    titre: 'Chef de projet EnR', entreprise: 'Voltalia', ville,
    contrat: 'CDI', dateOffre: '2026-07-20', lien: 'https://exemple.fr',
    description: 'Développement de projets agrivoltaïques.',
    groupe, score, scoreDetail: { positifs: [{ motif: 'agrivolta', poids: 4 }], negatifs: [], eliminatoires: [] },
    analysisJson: null, isManual: 0, horsZone: 0, departement: '54', salaireSource: null,
  });

  if (statut) {
    db.prepare(`INSERT INTO tracking (offer_id, status, sent_date, relance_date, notes, pinned)
                VALUES (?, ?, ?, ?, '', 0)`)
      .run(id, statut, envoiLe ?? '', relanceLe ?? '');
  }
  return db;
}

// ------------------------------------------------------------- utilitaires

test('derniersJours renvoie une plage continue finissant aujourd\'hui', () => {
  const jours = derniersJours(5, '2026-07-28');
  assert.deepEqual(jours, ['2026-07-24', '2026-07-25', '2026-07-26', '2026-07-27', '2026-07-28']);
});

test('decaler traverse correctement une fin de mois', () => {
  assert.equal(decaler('2026-07-31', 1), '2026-08-01');
  assert.equal(decaler('2026-08-01', -1), '2026-07-31');
});

// La date locale, pas UTC : une action du lundi 23 h doit compter pour lundi.
test('isoLocal suit le fuseau de la machine, pas UTC', () => {
  const soir = new Date(2026, 6, 28, 23, 30);
  assert.equal(isoLocal(soir), '2026-07-28');
});

// ------------------------------------------------------------ vue d'ensemble

test('une base vide produit des statistiques nulles, pas des NaN', () => {
  const stats = calculerStats(ouvrirBase(':memory:'), { aujourdhui: '2026-07-28' });
  assert.equal(stats.resume.total, 0);
  assert.equal(stats.performance.tauxReponse, 0);
  assert.equal(stats.performance.tauxCandidature, 0);
  assert.equal(stats.records.meilleurJour, 0);
  assert.equal(stats.serie90.length, 90);
  assert.ok(stats.radar.every(a => Number.isFinite(a.valeur)));
});

test('le taux de réponse se calcule sur les envois, pas sur toutes les offres', () => {
  const db = baseAvecOffre({ statut: 'Refus', envoiLe: '2026-07-20' });
  // Une seconde offre jamais envoyée ne doit pas diluer le taux.
  upsertOffre(db, {
    id: 'a2', source: 'adzuna', sourcesAll: ['adzuna'], externalId: 'y',
    titre: 'Juriste', entreprise: 'Cabinet', ville: 'Lyon', contrat: 'CDI',
    dateOffre: '2026-07-22', lien: null, description: 'x', groupe: 2, score: 4,
    scoreDetail: null, analysisJson: null, isManual: 0, horsZone: 0,
    departement: '69', salaireSource: null,
  });

  const stats = calculerStats(db, { aujourdhui: '2026-07-28' });
  assert.equal(stats.resume.total, 2);
  assert.equal(stats.resume.envoyees, 1);
  assert.equal(stats.performance.tauxReponse, 100, '1 refus sur 1 envoi = 100 %');
  assert.equal(stats.performance.tauxCandidature, 50, '1 offre sur 2 a reçu une candidature');
});

test('les envois alimentent la courbe au bon jour', () => {
  const db = baseAvecOffre({ statut: 'Envoyé', envoiLe: '2026-07-27' });
  const stats = calculerStats(db, { aujourdhui: '2026-07-28' });
  const hier = stats.serie90.find(j => j.jour === '2026-07-27');
  assert.equal(hier.envois, 1);
  assert.equal(stats.serie90.find(j => j.jour === '2026-07-28').envois, 0);
});

test('le délai d\'attente ne compte que les candidatures sans réponse', () => {
  const db = baseAvecOffre({ statut: 'Envoyé', envoiLe: '2026-07-18' });
  const stats = calculerStats(db, { aujourdhui: '2026-07-28' });
  assert.equal(stats.performance.delaiMoyen, 10);

  // Passée en refus, l'offre sort du calcul : l'attente est terminée.
  db.prepare(`UPDATE tracking SET status = 'Refus' WHERE offer_id = 'a1'`).run();
  assert.equal(calculerStats(db, { aujourdhui: '2026-07-28' }).performance.delaiMoyen, 0);
});

test('la ville est nettoyée de son code départemental', () => {
  const db = baseAvecOffre({ ville: 'Nancy (54)' });
  const stats = calculerStats(db, { aujourdhui: '2026-07-28' });
  assert.equal(stats.parVille[0].ville, 'Nancy');
});

test('le radar rattache un motif de scoring à son axe métier', () => {
  const db = baseAvecOffre();
  const stats = calculerStats(db, { aujourdhui: '2026-07-28' });
  const axe = stats.radar.find(a => a.axe === 'Agrivoltaïsme');
  assert.equal(axe.n, 1);
  assert.equal(axe.valeur, 100, 'seul axe alimenté, donc au maximum');
});

test('la tendance compare la semaine en cours à la précédente', () => {
  // Lundi de la semaine du 28 juillet 2026 = 27 juillet.
  const db = baseAvecOffre({ statut: 'Envoyé', envoiLe: '2026-07-27' });
  db.prepare(`INSERT INTO offers (id, titre) VALUES ('a2', 'Autre')`).run();
  db.prepare(`INSERT INTO tracking (offer_id, status, sent_date) VALUES ('a2','Envoyé','2026-07-22')`).run();

  const stats = calculerStats(db, { aujourdhui: '2026-07-28' });
  assert.equal(stats.performance.envoisSemaine, 1);
  assert.equal(stats.performance.envoisSemainePrecedente, 1);
  assert.equal(stats.performance.tendance, 0);
});

/**
 * LA CONVERSION PAR SOURCE — d'où viennent les RÉPONSES, pas juste les offres.
 * Une réponse = entretien ou refus (l'employeur s'est manifesté) ; « Relancé »
 * reste notre action, pas la sienne.
 */
test('la conversion par source distingue envoyées et réponses', () => {
  const db = baseAvecOffre({ id: 'a1', statut: 'Entretien', envoiLe: '2026-07-25' });
  // une seconde offre de la même source, envoyée sans réponse
  upsertOffre(db, {
    id: 'a2', source: 'france-travail', sourcesAll: ['france-travail'], externalId: 'y',
    titre: 'Juriste', entreprise: 'X', ville: 'Nancy (54)', contrat: 'CDI',
    dateOffre: '2026-07-20', lien: 'https://e.fr', description: 'd',
    groupe: 1, score: 6, scoreDetail: { positifs: [], negatifs: [], eliminatoires: [] },
    analysisJson: null, isManual: 0, horsZone: 0, departement: '54', salaireSource: null,
  });
  db.prepare(`INSERT INTO tracking (offer_id, status, sent_date, relance_date, notes, pinned)
              VALUES ('a2', 'Envoyé', '2026-07-26', '', '', 0)`).run();

  const s = calculerStats(db, { aujourdhui: '2026-07-28' });
  const ft = s.parSource.find(x => x.source === 'france-travail');
  db.close();

  assert.equal(ft.n, 2, 'deux offres collectées');
  assert.equal(ft.envoyees, 2, 'les deux envoyées');
  assert.equal(ft.reponses, 1, 'une seule réponse — l\'entretien ; « Envoyé » n\'en est pas une');
  assert.equal(ft.entretiens, 1);
});
