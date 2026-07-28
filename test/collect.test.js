import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase } from '../src/db.js';
import { collecter } from '../scripts/collect.js';

const PROFIL = {
  villesPrioritaires: [{ nom: 'Nancy', codeInsee: '54395', departement: '54' }],
  rayonKm: 30,
  intitules: ['juriste enr'],
  fraicheurJours: 7,
  scoring: {
    positifs: [{ motif: 'agrivolta', poids: 4 }, { motif: 'juriste', poids: 3 }],
    negatifs: [],
    eliminatoires: [{ motif: '\\bm a\\b' }],
    seuils: { prioritaire: 6, possible: 3, aVerifier: 1, descriptionMiniCaracteres: 50 },
  },
};

function sourceFactice(offres) {
  return {
    nom: 'factice',
    estConfiguree: () => true,
    chercher: async () => offres,
  };
}

const aujourdhui = new Date().toISOString().slice(0, 10);

const OFFRE_NANCY = {
  externalId: 'f1', titre: 'Juriste agrivoltaïque', entreprise: 'ACME', ville: 'Nancy (54)',
  description: 'Poste de juriste sur des projets agrivoltaïques, avec suivi des autorisations.'.padEnd(120, ' .'),
  dateOffre: aujourdhui, lien: 'https://exemple.fr/1', contrat: 'CDI',
};

test('collecter insère les offres scorées', async () => {
  const db = ouvrirBase(':memory:');
  const r = await collecter({ db, profil: PROFIL, sources: [sourceFactice([OFFRE_NANCY])], cv: '', analyser: false });

  assert.equal(r.statut, 'ok');
  assert.equal(r.nouvelles, 1);

  const ligne = db.prepare('SELECT * FROM offers').get();
  assert.equal(ligne.titre, 'Juriste agrivoltaïque');
  assert.equal(ligne.groupe, 1);
  assert.equal(ligne.hors_zone, 0);
  db.close();
});

test('collecter écarte les offres trop anciennes', async () => {
  const db = ouvrirBase(':memory:');
  const vieille = { ...OFFRE_NANCY, externalId: 'f2', dateOffre: '2026-01-01' };
  const r = await collecter({ db, profil: PROFIL, sources: [sourceFactice([vieille])], cv: '', analyser: false });

  assert.equal(r.nouvelles, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM offers').get().n, 0);
  db.close();
});

test('collecter garde une offre hors zone si elle est prioritaire', async () => {
  const db = ouvrirBase(':memory:');
  const horsZone = { ...OFFRE_NANCY, externalId: 'f3', ville: 'Bordeaux (33)' };
  await collecter({ db, profil: PROFIL, sources: [sourceFactice([horsZone])], cv: '', analyser: false });

  const ligne = db.prepare('SELECT * FROM offers').get();
  assert.ok(ligne, 'une offre prioritaire hors zone doit être conservée');
  assert.equal(ligne.hors_zone, 1);
  db.close();
});

test('collecter écarte une offre hors zone classée « à écarter »', async () => {
  const db = ouvrirBase(':memory:');
  const mauvaise = {
    ...OFFRE_NANCY, externalId: 'f4', ville: 'Courchevel (73)', titre: 'Ingénieur',
    description: 'Poste sans aucun rapport avec le profil recherché.'.padEnd(120, ' .'),
  };
  await collecter({ db, profil: PROFIL, sources: [sourceFactice([mauvaise])], cv: '', analyser: false });

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM offers').get().n, 0);
  db.close();
});

test('collecter signale un statut « partiel » si une source échoue', async () => {
  const db = ouvrirBase(':memory:');
  const cassee = { nom: 'cassee', estConfiguree: () => true, chercher: async () => { throw new Error('panne'); } };
  const r = await collecter({ db, profil: PROFIL, sources: [sourceFactice([OFFRE_NANCY]), cassee], cv: '', analyser: false });

  assert.equal(r.statut, 'partiel');
  assert.deepEqual(r.sourcesEnEchec, ['cassee']);
  assert.equal(r.nouvelles, 1, 'les offres de la source saine doivent être conservées');
  db.close();
});

test('collecter signale « echec » si toutes les sources tombent, sans perdre les données', async () => {
  const db = ouvrirBase(':memory:');
  await collecter({ db, profil: PROFIL, sources: [sourceFactice([OFFRE_NANCY])], cv: '', analyser: false });

  const cassee = { nom: 'cassee', estConfiguree: () => true, chercher: async () => { throw new Error('panne'); } };
  const r = await collecter({ db, profil: PROFIL, sources: [cassee], cv: '', analyser: false });

  assert.equal(r.statut, 'echec');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM offers').get().n, 1,
    'les offres déjà en base doivent survivre à une panne totale');
  db.close();
});

test('collecter renseigne la date et le statut de dernière collecte', async () => {
  const db = ouvrirBase(':memory:');
  await collecter({ db, profil: PROFIL, sources: [sourceFactice([OFFRE_NANCY])], cv: '', analyser: false });

  const date = db.prepare("SELECT valeur FROM meta WHERE cle = 'last_collect_at'").get();
  const statut = db.prepare("SELECT valeur FROM meta WHERE cle = 'last_collect_status'").get();
  assert.match(date.valeur, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(statut.valeur, 'ok');
  db.close();
});

// ---- LE TEST CRITIQUE ----
test('une collecte ne modifie JAMAIS la table tracking', async () => {
  const db = ouvrirBase(':memory:');
  await collecter({ db, profil: PROFIL, sources: [sourceFactice([OFFRE_NANCY])], cv: '', analyser: false });

  const id = db.prepare('SELECT id FROM offers').get().id;
  db.prepare(`INSERT INTO tracking (offer_id, status, notes, pinned, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, 'Entretien', 'Prépa entretien le 5 août', 1, '2026-07-28');

  // Deuxième collecte, l'offre a changé de contenu.
  await collecter({
    db, profil: PROFIL, cv: '', analyser: false,
    sources: [sourceFactice([{ ...OFFRE_NANCY, description: 'Description entièrement réécrite par l\'employeur.'.padEnd(120, ' .') }])],
  });

  const t = db.prepare('SELECT * FROM tracking WHERE offer_id = ?').get(id);
  assert.equal(t.status, 'Entretien');
  assert.equal(t.notes, 'Prépa entretien le 5 août');
  assert.equal(t.pinned, 1);
  db.close();
});
