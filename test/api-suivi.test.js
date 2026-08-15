import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { ouvrirBase, upsertOffre } from '../src/db.js';
import { creerRoutes } from '../src/api.js';

const PROFIL = {
  candidat: { nom: 'Test', ville: 'Nancy' },
  villesPrioritaires: [{ nom: 'Nancy', codeInsee: '54395', departement: '54' }],
  intitules: ['chef de projet'], rayonKm: 30, fraicheurJours: 7,
  scoring: {
    positifs: [
      { motif: 'agrivolta', poids: 4, note: 'spécialité' },
      { motif: 'chaudronnerie', poids: 2, note: 'jamais fait' },
    ],
    negatifs: [], eliminatoires: [],
    seuils: { prioritaire: 6, possible: 3, aVerifier: 1, descriptionMiniCaracteres: 200 },
  },
};

/** Monte l'API sur une base en mémoire et renvoie un client minimal. */
async function serveurDeTest() {
  const db = ouvrirBase(':memory:');
  upsertOffre(db, {
    id: 'x1', source: 'adzuna', sourcesAll: ['adzuna'], externalId: 'a',
    titre: 'Chef de projet EnR', entreprise: 'ACME', ville: 'Nancy (54)',
    contrat: 'CDI', dateOffre: '2026-07-26', lien: null,
    description: 'Développement de projets solaires.', groupe: 1, score: 7,
    scoreDetail: null, analysisJson: null, isManual: 0, horsZone: 0,
    departement: '54', salaireSource: null,
  });

  const app = express();
  app.use(express.json());
  app.use('/api', creerRoutes({ db, collecter: async () => ({}), sources: [], profil: PROFIL }));

  const serveur = await new Promise(resoudre => {
    const s = app.listen(0, '127.0.0.1', () => resoudre(s));
  });
  const port = serveur.address().port;

  return {
    db,
    fermer: () => { serveur.close(); db.close(); },
    suivi: () => db.prepare('SELECT status, sent_date, relance_date FROM tracking WHERE offer_id = ?').get('x1'),
    patch: async (corps) => (await fetch(`http://127.0.0.1:${port}/api/track/x1`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
    })).json(),
    get: async (chemin) => (await fetch(`http://127.0.0.1:${port}${chemin}`)).json(),
  };
}

// Régression : marquer une offre « Envoyé » puis revenir à « À postuler »
// laissait la date d'envoi et la relance en base. L'objectif de la semaine
// restait à 1/5, la courbe d'activité comptait toujours un envoi et une
// relance fantôme apparaissait dans l'agenda.
test('revenir à « À postuler » efface la date d\'envoi et la relance', async () => {
  const s = await serveurDeTest();
  try {
    await s.patch({ status: 'Envoyé', sent: '2026-07-28', relance: '2026-08-04' });
    assert.equal(s.suivi().sent_date, '2026-07-28');
    assert.equal(s.suivi().relance_date, '2026-08-04');

    await s.patch({ status: 'À postuler' });
    assert.equal(s.suivi().status, 'À postuler');
    assert.equal(s.suivi().sent_date, '', 'la date d\'envoi doit être effacée');
    assert.equal(s.suivi().relance_date, '', 'la relance doit être effacée');
  } finally { s.fermer(); }
});

test('l\'objectif de la semaine et la courbe redescendent après un retour arrière', async () => {
  const s = await serveurDeTest();
  try {
    const aujourdhui = new Date();
    const p = v => String(v).padStart(2, '0');
    const iso = `${aujourdhui.getFullYear()}-${p(aujourdhui.getMonth() + 1)}-${p(aujourdhui.getDate())}`;

    await s.patch({ status: 'Envoyé', sent: iso });
    const pendant = (await s.get('/api/stats')).stats;
    assert.equal(pendant.performance.envoisSemaine, 1);

    await s.patch({ status: 'À postuler' });

    const stats = (await s.get('/api/stats')).stats;
    assert.equal(stats.performance.envoisSemaine, 0, 'l\'objectif hebdomadaire doit redescendre');
    assert.equal(stats.resume.envoyees, 0);
    assert.equal(stats.records.meilleurJour, 0, 'le record d\'envois doit redescendre');
    assert.equal(stats.serie90.reduce((t, j) => t + j.envois, 0), 0, 'la courbe ne doit plus montrer d\'envoi');
  } finally { s.fermer(); }
});

// Le nettoyage ne doit pas écraser une saisie volontaire faite dans la même
// requête : l'utilisateur reste souverain sur ses propres dates.
test('une date fournie explicitement dans la même requête est respectée', async () => {
  const s = await serveurDeTest();
  try {
    await s.patch({ status: 'Envoyé', sent: '2026-07-28', relance: '2026-08-04' });
    await s.patch({ status: 'À postuler', sent: '2026-07-01' });

    assert.equal(s.suivi().sent_date, '2026-07-01', 'la saisie explicite prime');
    assert.equal(s.suivi().relance_date, '', 'mais la relance non fournie est bien effacée');
  } finally { s.fermer(); }
});

test('changer un autre champ ne déclenche aucun nettoyage', async () => {
  const s = await serveurDeTest();
  try {
    await s.patch({ status: 'Envoyé', sent: '2026-07-28', relance: '2026-08-04' });
    await s.patch({ notes: 'Contact : Marie Dupont' });

    assert.equal(s.suivi().sent_date, '2026-07-28');
    assert.equal(s.suivi().relance_date, '2026-08-04');
  } finally { s.fermer(); }
});

// Le navigateur doit refléter l'état RÉEL, pas les champs qu'il a demandés.
test('la réponse renvoie le suivi tel qu\'il est en base', async () => {
  const s = await serveurDeTest();
  try {
    await s.patch({ status: 'Envoyé', sent: '2026-07-28', relance: '2026-08-04' });
    const r = await s.patch({ status: 'À postuler' });

    assert.deepEqual(r.suivi, {
      status: 'À postuler', sent: '', relance: '', notes: '', pinned: false,
    });
  } finally { s.fermer(); }
});

// ─────────────────────────────── Mon CV ───────────────────────────────

// La vue CV sert à vérifier la matière première : c'est le texte EXTRAIT qui
// part chez Gemini, pas le .docx. Et la couverture des mots-clés dit si le
// scoring valorise des compétences que le CV ne démontre pas.
test('la route CV renvoie le texte, ses mesures et la couverture des mots-clés', async () => {
  const s = await serveurDeTest();
  try {
    const cv = await s.get('/api/cv');
    // Le CV réel du projet existe : on vérifie la forme de la réponse.
    assert.equal(cv.ok, true);
    if (!cv.present) {
      assert.ok(cv.aide.includes('extract-cv'), 'un CV absent doit expliquer quoi faire');
      return;
    }

    assert.equal(typeof cv.texte, 'string');
    assert.ok(cv.mots > 0 && cv.lignes > 0);
    assert.equal(cv.candidat.nom, 'Test', 'les coordonnées viennent du profil');
    assert.equal(cv.couverture.length, 2, 'un motif positif = une ligne de couverture');

    const parMotif = Object.fromEntries(cv.couverture.map(c => [c.motif, c.present]));
    assert.equal(parMotif.chaudronnerie, false,
      'un motif absent du CV doit être signalé comme non couvert');
    assert.equal(typeof parMotif.agrivolta, 'boolean');
  } finally { s.fermer(); }
});

test('la couverture teste le CV normalisé, pas le texte brut', async () => {
  const s = await serveurDeTest();
  try {
    const cv = await s.get('/api/cv');
    if (!cv.present) return;
    // « agrivoltaïque » dans le CV doit correspondre au motif « agrivolta »,
    // qui est écrit sans accent parce qu'il s'applique au texte normalisé.
    const attendu = /agrivolta/i.test(cv.texte.normalize('NFD').replace(/[̀-ͯ]/g, ''));
    assert.equal(cv.couverture.find(c => c.motif === 'agrivolta').present, attendu);
  } finally { s.fermer(); }
});

test('un aller-retour ne journalise pas deux candidatures', async () => {
  const s = await serveurDeTest();
  try {
    await s.patch({ status: 'Envoyé', sent: '2026-07-28' });
    await s.patch({ status: 'À postuler' });
    await s.patch({ status: 'Envoyé', sent: '2026-07-28' });

    const n = s.db.prepare(`SELECT COUNT(*) n FROM evenements WHERE type = 'candidature'`).get().n;
    assert.equal(n, 2, 'deux envois distincts, pas un de plus');
  } finally { s.fermer(); }
});
