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

// ------------------------------------------- nettoyage hors profil en fin de collecte

/** Une offre que le scoring classera en groupe 3 : le motif est éliminatoire. */
const OFFRE_ECARTEE = {
  externalId: 'f9', titre: 'Analyste M A', entreprise: 'ACME', ville: 'Nancy (54)',
  description: 'Poste centré sur les opérations de m a et le conseil financier.'.padEnd(120, ' .'),
  dateOffre: aujourdhui, lien: 'https://exemple.fr/9', contrat: 'CDI',
};

test('sans réglage, la collecte ne supprime rien : le groupe 3 reste consultable', async () => {
  const db = ouvrirBase(':memory:');
  const r = await collecter({
    db, profil: PROFIL, sources: [sourceFactice([OFFRE_NANCY, OFFRE_ECARTEE])], cv: '', analyser: false,
  });

  assert.equal(r.horsProfil, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM offers WHERE groupe = 3').get().n, 1,
    'désactivé par défaut : une suppression ne doit jamais être une surprise');
});

test('avec nettoyageAutomatique, le groupe 3 part en fin de collecte', async () => {
  const db = ouvrirBase(':memory:');
  const r = await collecter({
    db, profil: { ...PROFIL, nettoyageAutomatique: true },
    sources: [sourceFactice([OFFRE_NANCY, OFFRE_ECARTEE])], cv: '', analyser: false,
  });

  assert.equal(r.horsProfil, 1);
  const restantes = db.prepare('SELECT titre FROM offers').all().map(o => o.titre);
  assert.deepEqual(restantes, ['Juriste agrivoltaïque']);
});

// La garantie centrale du projet tient aussi dans ce chemin automatique :
// c'est le plus dangereux, puisqu'il s'exécute sans que personne ne regarde.
test('le nettoyage automatique ne touche jamais une offre suivie', async () => {
  const db = ouvrirBase(':memory:');
  const sources = [sourceFactice([OFFRE_ECARTEE])];

  // Première passe sans nettoyage : l'offre entre en base.
  await collecter({ db, profil: PROFIL, sources, cv: '', analyser: false });
  const id = db.prepare('SELECT id FROM offers').get().id;

  // Benjamin l'annote — c'est ce geste qui doit la sauver.
  db.prepare('INSERT INTO tracking (offer_id, notes) VALUES (?, ?)').run(id, 'appelé le recruteur');

  const r = await collecter({
    db, profil: { ...PROFIL, nettoyageAutomatique: true }, sources, cv: '', analyser: false,
  });

  assert.equal(r.horsProfil, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM offers').get().n, 1,
    'une note suffit à protéger une offre, même du nettoyage automatique');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rejetees').get().n, 0,
    'et elle ne doit pas non plus être inscrite parmi les offres écartées');
});

// --------------------------------------------------- offres écartées pour de bon

// La raison d'être de la table `rejetees`. L'identifiant est un hash stable
// du contenu : sans mémoire des rejets, une offre supprimée revient à
// l'identique dès que la source la republie — et supprimer ne sert à rien.
test('une offre écartée ne revient pas à la collecte suivante', async () => {
  const { supprimerOffres } = await import('../src/db.js');
  const db = ouvrirBase(':memory:');
  const sources = [sourceFactice([OFFRE_NANCY])];

  await collecter({ db, profil: PROFIL, sources, cv: '', analyser: false });
  const id = db.prepare('SELECT id FROM offers').get().id;

  supprimerOffres(db, [id], 'manuel');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM offers').get().n, 0);

  // La source publie toujours la même offre.
  const r = await collecter({ db, profil: PROFIL, sources, cv: '', analyser: false });
  assert.equal(r.ignorees, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM offers').get().n, 0,
    'elle doit rester écartée');
});

test('oublier les rejets remet les offres en circulation', async () => {
  const { supprimerOffres, oublierRejets } = await import('../src/db.js');
  const db = ouvrirBase(':memory:');
  const sources = [sourceFactice([OFFRE_NANCY])];

  await collecter({ db, profil: PROFIL, sources, cv: '', analyser: false });
  supprimerOffres(db, [db.prepare('SELECT id FROM offers').get().id], 'manuel');

  assert.equal(oublierRejets(db), 1);
  await collecter({ db, profil: PROFIL, sources, cv: '', analyser: false });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM offers').get().n, 1);
});

// --------------------------------------------- offres restées sans réponse

test('les offres sans suite depuis N jours sont écartées, les autres non', async () => {
  const db = ouvrirBase(':memory:');
  const sources = [sourceFactice([OFFRE_NANCY, { ...OFFRE_NANCY, externalId: 'f2', titre: 'Juriste agrivoltaïque bis' }])];

  await collecter({ db, profil: PROFIL, sources, cv: '', analyser: false });
  const ids = db.prepare('SELECT id FROM offers ORDER BY titre').all().map(o => o.id);

  // On vieillit la première de 20 jours, et on annote la seconde.
  const vieux = new Date(Date.now() - 20 * 86400000).toISOString();
  db.prepare('UPDATE offers SET first_seen = ? WHERE id = ?').run(vieux, ids[0]);
  db.prepare('UPDATE offers SET first_seen = ? WHERE id = ?').run(vieux, ids[1]);
  db.prepare('INSERT INTO tracking (offer_id, notes) VALUES (?, ?)').run(ids[1], 'à rappeler');

  const r = await collecter({
    db, profil: { ...PROFIL, sansReponseJours: 14 }, sources, cv: '', analyser: false,
  });

  assert.equal(r.sansReponse, 1, 'seule celle sans la moindre trace part');
  const restantes = db.prepare('SELECT id FROM offers').all().map(o => o.id);
  assert.deepEqual(restantes, [ids[1]], 'une note protège, même de la purge par ancienneté');
});

test('sans réglage sansReponseJours, aucune offre n\'est écartée par ancienneté', async () => {
  const db = ouvrirBase(':memory:');
  const sources = [sourceFactice([OFFRE_NANCY])];
  await collecter({ db, profil: PROFIL, sources, cv: '', analyser: false });
  db.prepare('UPDATE offers SET first_seen = ?').run(new Date(Date.now() - 90 * 86400000).toISOString());

  const r = await collecter({ db, profil: PROFIL, sources, cv: '', analyser: false });
  assert.equal(r.sansReponse, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM offers').get().n, 1);
});
