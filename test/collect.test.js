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

test('collecter signale « non-configure » quand aucune source n\'a de clé', async () => {
  const db = ouvrirBase(':memory:');
  const sansCle = { nom: 'sans-cle', estConfiguree: () => false, chercher: async () => [] };
  const r = await collecter({ db, profil: PROFIL, sources: [sansCle], cv: '', analyser: false });

  assert.equal(r.statut, 'non-configure',
    'sans clé, la collecte ne remonte rien mais n\'échoue pas — le dashboard ne doit pas afficher « à jour »');
  assert.deepEqual(r.sourcesIgnorees, ['sans-cle']);
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

// ------------------------------------------------- résistance de la collecte

// Offre volontairement moins bien notée : « juriste » seul (3 points) la place
// en groupe 2, derrière OFFRE_NANCY qui cumule agrivoltaïque + juriste.
const OFFRE_MOYENNE = {
  externalId: 'f2', titre: 'Juriste collectivité', entreprise: 'MAIRIE', ville: 'Nancy (54)',
  description: 'Poste de juriste en collectivité territoriale, marchés et contentieux.'.padEnd(120, ' .'),
  dateOffre: aujourdhui, lien: 'https://exemple.fr/2', contrat: 'CDI',
};

// Régression coûteuse : l'analyse tournait AVANT l'écriture en base. Quarante
// minutes de collecte se sont perdues d'un coup le jour où le quota Gemini
// s'est épuisé en cours de route — pas une seule offre n'avait été enregistrée.
test('les offres sont enregistrées même si l\'analyse échoue entièrement', async () => {
  const db = ouvrirBase(':memory:');
  const r = await collecter({
    db, profil: PROFIL, sources: [sourceFactice([OFFRE_NANCY, OFFRE_MOYENNE])],
    cv: 'x'.repeat(200), analyser: true,
    analyserOffre: async () => { throw new Error('429 quota épuisé'); },
  });

  assert.equal(db.prepare('SELECT COUNT(*) n FROM offers').get().n, 2,
    'la moisson doit survivre à une panne d\'analyse');
  assert.equal(r.analysees, 0);
  assert.equal(r.statut, 'ok', 'une analyse en panne ne fait pas échouer la collecte');
  db.close();
});

test('une analyse réussie est bien enregistrée', async () => {
  const db = ouvrirBase(':memory:');
  await collecter({
    db, profil: PROFIL, sources: [sourceFactice([OFFRE_NANCY])],
    cv: 'x'.repeat(200), analyser: true,
    analyserOffre: async () => ({ verdict: 'ok', prouvable: ['M2'] }),
  });

  const ligne = db.prepare('SELECT analysis_json FROM offers').get();
  assert.ok(ligne.analysis_json, 'l\'analyse doit être écrite en base');
  assert.equal(JSON.parse(ligne.analysis_json).verdict, 'ok');
  db.close();
});

// Le quota Gemini gratuit ne tient pas 265 offres. S'acharner ne fait que
// rallonger la collecte de plusieurs dizaines de minutes pour rien.
test('l\'analyse s\'arrête après une série d\'échecs consécutifs', async () => {
  const db = ouvrirBase(':memory:');
  const offres = Array.from({ length: 12 }, (_, i) => ({
    ...OFFRE_NANCY, externalId: `f${i}`, lien: `https://exemple.fr/${i}`,
  }));

  let tentatives = 0;
  await collecter({
    db, profil: PROFIL, sources: [sourceFactice(offres)],
    cv: 'x'.repeat(200), analyser: true,
    analyserOffre: async () => { tentatives++; throw new Error('429 quota'); },
  });

  assert.ok(tentatives < 12, `abandon attendu avant la 12e offre, ${tentatives} tentatives faites`);
  db.close();
});

// À quota limité, mieux vaut analyser les offres que Benjamin va vraiment
// lire. Une offre « à vérifier » analysée à la place d'une prioritaire est du
// quota gaspillé.
test('les offres prioritaires sont analysées avant les autres', async () => {
  const db = ouvrirBase(':memory:');
  const vus = [];
  await collecter({
    db, profil: PROFIL, sources: [sourceFactice([OFFRE_MOYENNE, OFFRE_NANCY])],
    cv: 'x'.repeat(200), analyser: true,
    analyserOffre: async (offre) => { vus.push(offre.groupe); return { verdict: 'ok' }; },
  });

  assert.deepEqual(vus, [1, 2], 'le groupe 1 doit passer avant le groupe 2');
  db.close();
});

// Le quota Gemini gratuit est journalier et partagé entre l'analyse des
// offres et la rédaction des lettres. Une collecte toutes les 6 heures qui
// analyse tout ce qu'elle peut le vide entièrement — et Benjamin se retrouve
// sans lettre au moment où il en veut une. Or la lettre vaut bien plus qu'un
// verdict sur une offre qu'il ne lira peut-être jamais.
test('une collecte n\'analyse jamais plus que son budget d\'analyses', async () => {
  const db = ouvrirBase(':memory:');
  // Les titres doivent différer : l'identifiant d'une offre est un hachage de
  // titre + entreprise + ville, donc vingt copies du même titre n'en font
  // qu'une seule après dédoublonnage.
  const offres = Array.from({ length: 20 }, (_, i) => ({
    ...OFFRE_NANCY, titre: `Juriste agrivoltaïque ${i}`,
    externalId: `b${i}`, lien: `https://exemple.fr/b${i}`,
  }));

  let appels = 0;
  const r = await collecter({
    db, profil: { ...PROFIL, analysesParCollecte: 6 },
    sources: [sourceFactice(offres)], cv: 'x'.repeat(200), analyser: true,
    analyserOffre: async () => { appels++; return { verdict: 'ok' }; },
  });

  assert.equal(appels, 6, 'le budget doit être respecté à l\'unité près');
  assert.equal(r.analysees, 6);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM offers').get().n, 20,
    'toutes les offres sont enregistrées, même celles qui ne seront pas analysées');
  db.close();
});

test('sans budget déclaré, une valeur par défaut raisonnable s\'applique', async () => {
  const db = ouvrirBase(':memory:');
  const offres = Array.from({ length: 60 }, (_, i) => ({
    ...OFFRE_NANCY, titre: `Juriste agrivoltaïque poste ${i}`,
    externalId: `d${i}`, lien: `https://exemple.fr/d${i}`,
  }));

  let appels = 0;
  await collecter({
    db, profil: PROFIL, sources: [sourceFactice(offres)],
    cv: 'x'.repeat(200), analyser: true,
    analyserOffre: async () => { appels++; return { verdict: 'ok' }; },
  });

  assert.ok(appels > 0 && appels < 60,
    `un plafond par défaut doit s'appliquer, ${appels} analyses faites sur 60`);
  db.close();
});
