// LES ROUTES DU CHANTIER 4.0 (contrats 3.2 à 3.7) et les bugs serveur
// corrigés au passage. Même montage que api-suivi.test.js : l'API sur une
// base en mémoire, un vrai serveur HTTP sur un port libre, et des appels au
// modèle INJECTÉS — aucun ne part chez Google.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Le battement SSE se règle par l'environnement AVANT le chargement de l'API :
// attendre vingt secondes dans un test n'est pas envisageable.
process.env.JC_PING_SSE_MS = '40';
const { creerRoutes } = await import('../src/api.js');
const { ouvrirBase, upsertOffre, journaliser } = await import('../src/db.js');
const { noterAppel, CHAT } = await import('../src/quota.js');
const { creerCollecteLive } = await import('../src/collecte-live.js');

const PROFIL = {
  candidat: { nom: 'Test' },
  villesPrioritaires: [{ nom: 'Nancy', codeInsee: '54395', departement: '54' }],
  intitules: ['juriste'], rayonKm: 30, fraicheurJours: 7,
  scoring: {
    positifs: [{ motif: 'juriste', poids: 7 }], negatifs: [], eliminatoires: [],
    seuils: { prioritaire: 6, possible: 3, aVerifier: 1, descriptionMiniCaracteres: 10 },
  },
  gemini: { quotaJournalier: 100, reserveLettres: 20, reserveChat: 10 },
};

const CV = 'Juriste en droit de l\'environnement. '.repeat(10);

function iso(decalageJours = 0) {
  const d = new Date();
  d.setDate(d.getDate() + decalageJours);
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function monter({ profil = PROFIL, ia = {}, lireCv = () => CV, db = ouvrirBase(':memory:'), racine } = {}) {
  upsertOffre(db, {
    id: 'x1', source: 'adzuna', sourcesAll: ['adzuna'], titre: 'Juriste EnR', entreprise: 'ACME',
    ville: 'Nancy (54)', description: 'Développement de projets solaires.', groupe: 1, score: 7,
  });
  const app = express();
  app.use(express.json());
  const live = creerCollecteLive({ db });
  app.use('/api', creerRoutes({ db, collecter: async () => ({}), sources: [], profil, ia, lireCv, live,
    ...(racine ? { racine } : {}) }));
  // Comme server.js : une erreur non rattrapée devient un 500 lisible — et
  // n'imprime pas sa pile au milieu du rapport de tests.
  app.use((erreur, req, res, next) => res.status(500).json({ ok: false, error: erreur.message }));
  const serveur = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const appeler = async (methode, chemin, corps) => {
    const r = await fetch(base + chemin, {
      method: methode, headers: { 'Content-Type': 'application/json' },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
    const type = r.headers.get('content-type') ?? '';
    return { status: r.status, type, corps: type.includes('json') ? await r.json() : await r.text() };
  };
  return {
    db, base,
    get: (c) => appeler('GET', c),
    post: (c, b = {}) => appeler('POST', c, b),
    patch: (c, b) => appeler('PATCH', c, b),
    fermer: () => new Promise(r => { serveur.closeAllConnections?.(); serveur.close(() => { db.close(); r(); }); }),
  };
}

// ─────────────────────────── 3.6 Suivi ───────────────────────────

test('PATCH /track refuse un statut hors de la liste fermée', async () => {
  const s = await monter();
  try {
    const r = await s.patch('/api/track/x1', { status: 'envoye' });
    assert.equal(r.status, 400);
    assert.match(r.corps.error, /Statut inconnu/);
    assert.equal(s.db.prepare('SELECT 1 FROM tracking').get(), undefined, 'rien n\'a été écrit');
  } finally { await s.fermer(); }
});

test('PATCH /track renvoie la date d\'entretien', async () => {
  const s = await monter();
  try {
    const r = await s.patch('/api/track/x1', { status: 'Entretien', entretien: '2026-12-02' });
    assert.equal(r.status, 200);
    assert.equal(r.corps.suivi.entretien, '2026-12-02');
    assert.equal(r.corps.suivi.status, 'Entretien');
  } finally { await s.fermer(); }
});

test('PATCH /track est atomique : un échec au milieu n\'écrit rien', async () => {
  const s = await monter();
  try {
    // On fait échouer le journal, dernière écriture de la transaction.
    s.db.exec(`CREATE TRIGGER casse BEFORE INSERT ON evenements BEGIN SELECT RAISE(ABORT, 'disque plein'); END`);
    const r = await s.patch('/api/track/x1', { status: 'Envoyé', sent: '2026-11-10' });
    assert.equal(r.status, 500);
    assert.equal(s.db.prepare('SELECT 1 FROM tracking WHERE offer_id = ?').get('x1'), undefined,
      'ni statut sans journal, ni ligne à moitié écrite');
  } finally { await s.fermer(); }
});

// ─────────────────────── Lettres et versions (3.5) ───────────────────────

test('PATCH /letter sur une offre inexistante répond 404 sans rien créer', async () => {
  const s = await monter();
  try {
    const r = await s.patch('/api/letter/fantome', { contenu: 'Madame, Monsieur' });
    assert.equal(r.status, 404);
    assert.equal(s.db.prepare('SELECT COUNT(*) n FROM letters').get().n, 0);
  } finally { await s.fermer(); }
});

test('chaque génération et chaque retouche fait une version, restaurable', async () => {
  let n = 0;
  const s = await monter({ ia: {
    analyserOffre: async () => ({ verdict: 'Oui.' }),
    genererLettre: async () => `Lettre générée n°${++n}`,
  } });
  try {
    assert.equal((await s.post('/api/letter/x1')).corps.contenu, 'Lettre générée n°1');
    await s.patch('/api/letter/x1', { contenu: 'Retouche A' });
    // Une retouche juste après la précédente la remplace : pas une version par frappe.
    await s.patch('/api/letter/x1', { contenu: 'Retouche AB' });
    const regen = await s.post('/api/letter/x1', { regenerer: true, confirmerEcrasement: true });
    assert.equal(regen.corps.contenu, 'Lettre générée n°2');

    const { corps } = await s.get('/api/letter/x1/versions');
    assert.equal(corps.ok, true);
    assert.deepEqual(corps.versions.map(v => [v.version, v.origine]),
      [[3, 'generee'], [2, 'retouche'], [1, 'generee']], 'de la plus récente à la plus ancienne');
    assert.equal(corps.versions[1].apercu, 'Retouche AB');
    assert.ok(corps.versions[0].creeLe);

    const r = await s.post('/api/letter/x1/versions/2/restaurer');
    assert.equal(r.corps.contenu, 'Retouche AB');
    const lettre = await s.get('/api/letter/x1');
    assert.equal(lettre.corps.contenu, 'Retouche AB');
    assert.equal(lettre.corps.editee, true, 'restaurer est un choix : régénérer demandera confirmation');

    assert.equal((await s.post('/api/letter/x1/versions/9/restaurer')).status, 404);
    assert.equal((await s.get('/api/letter/fantome/versions')).status, 404);
  } finally { await s.fermer(); }
});

// ─────────────────────────── Collage ───────────────────────────

const OFFRE_COLLEE = {
  titre: 'Juriste urbanisme', entreprise: 'Mairie', ville: 'Nancy', contrat: 'CDI',
  dateOffre: null, lien: null, description: 'Poste de juriste en urbanisme.', salaireSource: null, externalId: null,
};

// RÉGRESSION : l'offre collée était `is_manual = 0`. Aucune source ne la
// revoyant, la purge des 30 jours l'effaçait.
test('une offre collée est protégée de la purge, compte son quota et lève un rejet', async () => {
  const s = await monter({ ia: {
    extraireOffreCollee: async () => ({ ...OFFRE_COLLEE }),
    analyserOffre: async () => ({ verdict: 'Oui.' }),
  } });
  try {
    const { offreId } = await import('../src/hash.js');
    const id = offreId(OFFRE_COLLEE.titre, OFFRE_COLLEE.entreprise, OFFRE_COLLEE.ville);
    s.db.prepare(`INSERT INTO rejetees (offer_id, motif) VALUES (?, 'manuel')`).run(id);

    const r = await s.post('/api/offers/paste', { texte: 'x'.repeat(200) });
    assert.equal(r.status, 200);
    assert.equal(r.corps.rejetLeve, true);
    assert.equal(s.db.prepare('SELECT is_manual FROM offers WHERE id = ?').get(id).is_manual, 1);
    assert.equal(s.db.prepare('SELECT 1 FROM rejetees WHERE offer_id = ?').get(id), undefined);

    const quota = (await s.get('/api/meta')).corps.quota;
    assert.equal(quota.total, 2, 'extraction + analyse, toutes deux comptées');
  } finally { await s.fermer(); }
});

test('le collage est refusé (503) quand le quota est épuisé', async () => {
  let appele = false;
  const s = await monter({ ia: { extraireOffreCollee: async () => { appele = true; return OFFRE_COLLEE; } } });
  try {
    for (let i = 0; i < 100; i++) noterAppel(s.db, CHAT);
    const r = await s.post('/api/offers/paste', { texte: 'x'.repeat(200) });
    assert.equal(r.status, 503);
    assert.equal(appele, false, 'aucun appel ne part');
  } finally { await s.fermer(); }
});

// ─────────────────────── 3.2 Analyse à la demande ───────────────────────

test('POST /offers/:id/analyser relance l\'analyse, même déjà faite', async () => {
  let n = 0;
  const s = await monter({ ia: { geminiPret: () => true, analyserOffre: async () => ({ verdict: `Verdict ${++n}` }) } });
  try {
    s.db.prepare(`UPDATE offers SET analysis_json = '{"verdict":"ancien"}' WHERE id = 'x1'`).run();
    const r = await s.post('/api/offers/x1/analyser');
    assert.equal(r.status, 200);
    assert.equal(r.corps.analyse.verdict, 'Verdict 1');
    assert.equal(r.corps.quota.analyses, 1);
    assert.equal(JSON.parse(s.db.prepare('SELECT analysis_json a FROM offers').get().a).verdict, 'Verdict 1');

    assert.equal((await s.post('/api/offers/inconnue/analyser')).status, 404);
  } finally { await s.fermer(); }
});

test('analyser : 400 sans clé ou sans CV, 503 si le modèle échoue', async () => {
  const sansCle = await monter({ ia: { geminiPret: () => false } });
  try { assert.equal((await sansCle.post('/api/offers/x1/analyser')).status, 400); } finally { await sansCle.fermer(); }

  const sansCv = await monter({ lireCv: () => '', ia: { geminiPret: () => true } });
  try { assert.equal((await sansCv.post('/api/offers/x1/analyser')).status, 400); } finally { await sansCv.fermer(); }

  const panne = await monter({ ia: { geminiPret: () => true, analyserOffre: async () => null } });
  try {
    const r = await panne.post('/api/offers/x1/analyser');
    assert.equal(r.status, 503);
    assert.equal(r.corps.ok, false);
  } finally { await panne.fermer(); }
});

// ─────────────────────────── 3.2 Rappels ───────────────────────────

test('GET /rappels ordonne entretien, relance en retard, sans réponse, offre fraîche', async () => {
  const s = await monter();
  try {
    const ajouter = (id, extra) => upsertOffre(s.db, { id, titre: `Offre ${id}`, entreprise: 'E', groupe: 2, score: 4, ...extra });
    ajouter('ent'); ajouter('rel'); ajouter('muette'); ajouter('loin');
    const suivi = s.db.prepare(`INSERT INTO tracking (offer_id, status, sent_date, relance_date, entretien_date)
                                VALUES (?, ?, ?, ?, ?)`);
    suivi.run('ent', 'Entretien', iso(-10), '', iso(2));
    suivi.run('rel', 'Envoyé', iso(-9), iso(-2), '');
    suivi.run('muette', 'Envoyé', iso(-20), '', '');
    suivi.run('loin', 'Envoyé', iso(-3), iso(20), '');
    // x1 : prioritaire vue à l'instant, encore à postuler → offre fraîche.

    const { corps } = await s.get('/api/rappels');
    assert.equal(corps.ok, true);
    assert.deepEqual(corps.rappels.map(r => `${r.type}:${r.offerId}`),
      ['entretien:ent', 'relance:rel', 'sans-reponse:muette', 'offre-fraiche:x1']);
    const [ent, rel, muette] = corps.rappels;
    assert.equal(ent.dansJours, 2);
    assert.equal(rel.retardJours, 2);
    assert.equal(muette.retardJours, 6, '20 jours, dont 6 au-delà du seuil de 14');
    for (const r of corps.rappels) {
      for (const cle of ['type', 'offerId', 'titre', 'entreprise', 'date', 'dansJours', 'retardJours', 'poids']) {
        assert.ok(cle in r, `champ « ${cle} » absent`);
      }
    }
  } finally { await s.fermer(); }
});

test('une candidature qui a bougé récemment n\'est pas « sans réponse »', async () => {
  const s = await monter();
  try {
    upsertOffre(s.db, { id: 'r', titre: 'R', groupe: 2 });
    s.db.prepare(`INSERT INTO tracking (offer_id, status, sent_date) VALUES ('r', 'Relancé', ?)`).run(iso(-30));
    journaliser(s.db, 'relance', { offerId: 'r', quand: new Date(Date.now() - 3 * 86400000) });
    const { corps } = await s.get('/api/rappels');
    assert.equal(corps.rappels.some(r => r.offerId === 'r'), false);
  } finally { await s.fermer(); }
});

// ─────────────────────────── 3.3 Agenda ───────────────────────────

test('GET /agenda.ics produit un calendrier valide, UID stables et alarme la veille', async () => {
  const s = await monter();
  try {
    upsertOffre(s.db, { id: 'y', titre: 'Chargée d\'affaires, EnR; Grand Est', entreprise: 'Soleil', groupe: 1 });
    s.db.prepare(`INSERT INTO tracking (offer_id, status, entretien_date) VALUES ('x1', 'Entretien', '2026-12-02')`).run();
    s.db.prepare(`INSERT INTO tracking (offer_id, status, sent_date, relance_date) VALUES ('y', 'Envoyé', '2026-11-01', '2026-11-20')`).run();

    const r = await s.get('/api/agenda.ics');
    assert.equal(r.status, 200);
    assert.match(r.type, /^text\/calendar/);
    const ics = r.corps;
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
    assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
    assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
    assert.match(ics, /UID:x1-entretien@jobcockpit/);
    assert.match(ics, /UID:y-relance@jobcockpit/);
    assert.match(ics, /DTSTART;VALUE=DATE:20261202/);
    assert.match(ics, /DTEND;VALUE=DATE:20261203/);
    assert.equal((ics.match(/BEGIN:VALARM/g) ?? []).length, 1, 'une alarme, pour l\'entretien seulement');
    assert.match(ics, /Chargée d'affaires\\, EnR\\; Grand Est/, 'virgules et points-virgules échappés');
    for (const ligne of ics.split('\r\n')) {
      assert.ok(Buffer.byteLength(ligne) <= 75, `ligne trop longue : ${ligne}`);
    }
  } finally { await s.fermer(); }
});

// ────────────────────────── 3.4 Sauvegardes ──────────────────────────

test('GET et POST /sauvegardes', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'jc-sauv-'));
  const racine = mkdtempSync(join(tmpdir(), 'jc-racine-'));
  const profil = { ...PROFIL, sauvegarde: { dossier: join(dossier, 'cible') } };
  let s;
  try {
    mkdirSync(join(dossier, 'cible', '2026-08-01_21h45'), { recursive: true });
    writeFileSync(join(dossier, 'cible', '2026-08-01_21h45', 'data.db'), 'abc');
    mkdirSync(join(dossier, 'cible', 'pas-une-sauvegarde'));

    // Base EN FICHIER : une base en mémoire n'a rien à sauvegarder.
    s = await monter({ profil, racine, db: ouvrirBase(join(dossier, 'vivante.db')) });
    const liste = await s.get('/api/sauvegardes');
    assert.equal(liste.corps.ok, true);
    assert.equal(liste.corps.dossier, join(dossier, 'cible'));
    assert.deepEqual(liste.corps.sauvegardes, [{ nom: '2026-08-01_21h45', date: '2026-08-01T21:45:00', tailleOctets: 3 }]);

    const r = await s.post('/api/sauvegardes');
    assert.equal(r.status, 200);
    assert.match(r.corps.nom, /^\d{4}-\d{2}-\d{2}_\d{2}h\d{2}$/);
    assert.ok(existsSync(join(dossier, 'cible', r.corps.nom, 'data.db')));
    assert.equal((await s.get('/api/sauvegardes')).corps.sauvegardes[0].nom, r.corps.nom, 'la plus récente d\'abord');
  } finally {
    await s?.fermer();
    for (const d of [dossier, racine]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows */ } }
  }
});

test('POST /sauvegardes répond 503 quand rien ne peut être sauvegardé', async () => {
  const s = await monter({ profil: { ...PROFIL, sauvegarde: { active: false } } });
  try {
    const r = await s.post('/api/sauvegardes');
    assert.equal(r.status, 503);
    assert.equal(r.corps.ok, false);
  } finally { await s.fermer(); }
});

// ─────────────────────────── 3.7 Quota ───────────────────────────

test('GET /meta expose entretiens, chat et reserveChat dans le quota', async () => {
  const s = await monter();
  try {
    noterAppel(s.db, CHAT);
    noterAppel(s.db, 'entretien');
    const q = (await s.get('/api/meta')).corps.quota;
    assert.equal(q.chat, 1);
    assert.equal(q.entretiens, 1);
    assert.equal(q.total, 2);
    assert.equal(q.reserveChat, 10);
  } finally { await s.fermer(); }
});

test('le chat s\'arrête au seuil de la réserve des lettres (503)', async () => {
  const cle = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'factice';
  const s = await monter();
  try {
    for (let i = 0; i < 80; i++) noterAppel(s.db, CHAT);
    const r = await s.post('/api/chat', { messages: [{ role: 'user', texte: 'Salut' }] });
    assert.equal(r.status, 503);
    assert.match(r.corps.error, /lettres/);
  } finally {
    await s.fermer();
    if (cle === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = cle;
  }
});

// ─────────────────────────── 3.1 Battement ───────────────────────────

test('le flux SSE envoie « : ping » à intervalle régulier', async () => {
  const s = await monter();
  const controle = new AbortController();
  try {
    const r = await fetch(`${s.base}/api/collecte/flux`, { signal: controle.signal });
    const lecteur = r.body.getReader();
    let texte = '';
    const limite = Date.now() + 2000;
    while (!texte.includes(': ping') && Date.now() < limite) {
      const { value, done } = await lecteur.read();
      if (done) break;
      texte += new TextDecoder().decode(value);
    }
    assert.match(texte, /^retry: \d+/m);
    assert.match(texte, /^: ping$/m);
  } finally {
    controle.abort();
    await s.fermer();
  }
});
