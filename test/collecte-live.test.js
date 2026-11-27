// LA COLLECTE EN DIRECT (chantier 4.0, contrat 3.1).
//
// Ce qui est verrouillé ici :
//   · UN verrou pour le bouton, `/refresh` et le planificateur — il y en avait
//     deux, qui ne se voyaient pas, et deux collectes tournaient ensemble ;
//   · le verrou posé en base par la tâche Windows (autre processus) ;
//   · le flux SSE, sur un VRAI serveur HTTP : en-têtes, rejeu du journal,
//     diffusion en direct, fermeture propre quand le client s'en va ;
//   · les événements émis par `collecter()` lui-même, sources factices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { ouvrirBase, ecrireMeta, lireMeta } from '../src/db.js';
import { creerRoutes } from '../src/api.js';
import { creerCollecteLive, emetteur } from '../src/collecte-live.js';
import { creerVerrou, CLE_VERROU } from '../src/verrou.js';
import { demarrerPlanificateur } from '../src/planificateur.js';
import { collecter } from '../scripts/collect.js';

const MUET = { log() {}, warn() {}, error() {} };

const PROFIL = {
  villesPrioritaires: [{ nom: 'Nancy', codeInsee: '54395', departement: '54' }],
  rayonKm: 30, intitules: ['juriste enr'], fraicheurJours: 7,
  scoring: {
    positifs: [{ motif: 'agrivolta', poids: 4 }, { motif: 'juriste', poids: 3 }],
    negatifs: [], eliminatoires: [],
    seuils: { prioritaire: 6, possible: 3, aVerifier: 1, descriptionMiniCaracteres: 50 },
  },
  // Aucune sauvegarde réelle depuis un test : la base est en mémoire, mais
  // autant le dire deux fois.
  sauvegarde: { active: false },
};

/** Une collecte factice qu'on termine quand on veut. */
function collecteTenue() {
  let liberer;
  const barriere = new Promise(r => { liberer = r; });
  const appels = [];
  const fn = async (options) => {
    appels.push(options);
    const emettre = emetteur(options.progres);
    emettre('debut', { sources: ['factice'], intitules: ['juriste'], villes: ['Nancy'], depuisDate: '2026-11-06' });
    emettre('source', { nom: 'factice', etat: 'ok', intitule: 'juriste', ville: 'Nancy', trouvees: 2, message: null });
    emettre('offre', { id: 'o1', titre: 'Juriste', entreprise: 'ACME', ville: 'Nancy', groupe: 1, score: 7, nouvelle: true, source: 'factice' });
    await barriere;
    emettre('analyse', { id: 'o1', titre: 'Juriste', i: 1, total: 1, verdict: 'Oui.' });
    return { statut: 'ok', nouvelles: 1, analysees: 1, dureeSecondes: 0 };
  };
  return { fn, liberer, appels };
}

async function monter({ collecter: c, live } = {}) {
  const db = ouvrirBase(':memory:');
  const app = express();
  app.use(express.json());
  const l = live ?? creerCollecteLive({ db });
  app.use('/api', creerRoutes({ db, collecter: c, sources: [], profil: PROFIL, live: l, lireCv: () => '' }));
  const serveur = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${serveur.address().port}`;
  return {
    db, live: l, base,
    post: async (chemin, corps) => {
      const r = await fetch(base + chemin, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps ?? {}) });
      return { status: r.status, corps: await r.json() };
    },
    get: async (chemin) => (await fetch(base + chemin)).json(),
    fermer: () => new Promise(r => { serveur.closeAllConnections?.(); serveur.close(() => { db.close(); r(); }); }),
  };
}

/**
 * Lit un flux SSE et rend les événements au fil de l'eau.
 * `jusqua(nom)` attend qu'un événement de ce nom soit arrivé.
 */
async function ouvrirFlux(url) {
  const controle = new AbortController();
  const r = await fetch(url, { signal: controle.signal });
  const lecteur = r.body.getReader();
  const decodeur = new TextDecoder();
  const evenements = [];
  const brut = [];
  let tampon = '';
  let attente = null;

  (async () => {
    try {
      for (;;) {
        const { value, done } = await lecteur.read();
        if (done) break;
        tampon += decodeur.decode(value, { stream: true });
        let i;
        while ((i = tampon.indexOf('\n\n')) !== -1) {
          const bloc = tampon.slice(0, i);
          tampon = tampon.slice(i + 2);
          brut.push(bloc);
          const nom = /^event: (.+)$/m.exec(bloc)?.[1];
          const data = /^data: (.+)$/m.exec(bloc)?.[1];
          if (nom) evenements.push({ nom, donnees: JSON.parse(data) });
          attente?.();
        }
      }
    } catch { /* fermeture volontaire */ }
  })();

  return {
    reponse: r,
    evenements,
    brut,
    async jusqua(nom, delai = 3000) {
      const fin = Date.now() + delai;
      while (!evenements.some(e => e.nom === nom)) {
        if (Date.now() > fin) throw new Error(`« ${nom} » jamais reçu ; reçus : ${evenements.map(e => e.nom).join(', ')}`);
        await new Promise(r => { attente = r; setTimeout(r, 50); });
      }
    },
    fermer: () => controle.abort(),
  };
}

// ─────────────────────────────── Verrou ───────────────────────────────

test('le verrou est unique : un second preneur est refusé, puis accepté une fois rendu', () => {
  const v = creerVerrou();
  assert.equal(v.prendre({ id: 'a' }).ok, true);
  const refus = v.prendre({ id: 'b' });
  assert.equal(refus.ok, false);
  assert.equal(refus.id, 'a', 'le refus nomme la collecte qui tourne');
  v.rendre();
  assert.equal(v.prendre({ id: 'c' }).ok, true);
  v.rendre();
});

// La tâche Windows tourne dans un autre processus : son seul signe de vie
// est l'horodatage qu'elle pose en base.
test('un verrou posé en base depuis moins de 30 min bloque le serveur', () => {
  const db = ouvrirBase(':memory:');
  ecrireMeta(db, CLE_VERROU, new Date(Date.now() - 5 * 60000).toISOString());
  const v = creerVerrou({ db });
  const refus = v.prendre();
  assert.equal(refus.ok, false);
  assert.match(refus.error, /autre processus/);
  assert.deepEqual([v.etat().pris, v.etat().local], [true, false], 'tenu, mais pas par nous');

  // Au-delà de 30 minutes, il est tenu pour abandonné (processus mort).
  ecrireMeta(db, CLE_VERROU, new Date(Date.now() - 45 * 60000).toISOString());
  assert.equal(v.prendre().ok, true);
  assert.ok(lireMeta(db, CLE_VERROU), 'le serveur pose à son tour son horodatage, pour la tâche Windows');
  v.rendre();
  assert.equal(lireMeta(db, CLE_VERROU), null, 'rendu, il est effacé');
  db.close();
});

// RÉGRESSION : le planificateur avait son propre booléen. Le bouton pressé
// pendant la collecte automatique en lançait une seconde, en parallèle.
test('le planificateur et le bouton partagent le même verrou', async () => {
  const tenue = collecteTenue();
  const s = await monter({ collecter: tenue.fn });
  try {
    const r = await s.post('/api/collecte/demarrer');
    assert.equal(r.status, 202);

    const tours = [];
    const p = demarrerPlanificateur({
      db: s.db, live: s.live, sources: [], profil: PROFIL, cv: '', actif: true,
      journal: { log() {}, error() {}, warn: (m) => tours.push(m) },
      collecter: async () => { tours.push('collecte lancée !'); return {}; },
      delaiAmorceMs: 1, intervalleMs: 3_600_000,
    });
    await new Promise(r => setTimeout(r, 40));
    p.arreter();
    assert.equal(tours.includes('collecte lancée !'), false, 'le planificateur doit renoncer');
    assert.match(tours.join(' '), /déjà en cours/);

    // Et /refresh aussi.
    const refresh = await s.post('/api/refresh');
    assert.equal(refresh.status, 409);
  } finally {
    tenue.liberer();
    await new Promise(r => setTimeout(r, 20));
    await s.fermer();
  }
});

// ───────────────────────────── Routes 3.1 ─────────────────────────────

test('POST /collecte/demarrer répond 202 tout de suite, puis 409 tant qu\'elle tourne', async () => {
  const tenue = collecteTenue();
  const s = await monter({ collecter: tenue.fn });
  try {
    const premier = await s.post('/api/collecte/demarrer');
    assert.equal(premier.status, 202, 'la réponse n\'attend pas la fin de la collecte');
    assert.equal(premier.corps.ok, true);
    assert.match(premier.corps.id, /^c-/);

    const second = await s.post('/api/collecte/demarrer');
    assert.equal(second.status, 409);
    assert.equal(second.corps.ok, false);
    assert.equal(second.corps.id, premier.corps.id, 'le 409 nomme la collecte en cours');

    const etat = await s.get('/api/collecte/etat');
    assert.equal(etat.ok, true);
    assert.equal(etat.enCours, true);
    assert.equal(etat.id, premier.corps.id);
    assert.deepEqual(etat.evenements.map(e => e.nom), ['debut', 'source', 'offre']);
    assert.equal(etat.evenements[0].donnees.id, premier.corps.id, '`debut` porte l\'identifiant');

    assert.equal((await s.get('/api/meta')).collecteEnCours, true);

    tenue.liberer();
    await new Promise(r => setTimeout(r, 30));
    const apres = await s.get('/api/collecte/etat');
    assert.equal(apres.enCours, false);
    assert.equal(apres.evenements.at(-1).nom, 'fin');
    assert.equal(apres.evenements.at(-1).donnees.resume.nouvelles, 1, '`fin` porte le même résumé que /refresh');
    assert.equal(tenue.appels[0].analyser, true);
  } finally {
    tenue.liberer();
    await s.fermer();
  }
});

test('le flux SSE rejoue le journal puis diffuse en direct', async () => {
  const tenue = collecteTenue();
  const s = await monter({ collecter: tenue.fn });
  let flux;
  try {
    const { corps } = await s.post('/api/collecte/demarrer');
    flux = await ouvrirFlux(`${s.base}/api/collecte/flux`);

    assert.equal(flux.reponse.status, 200);
    assert.match(flux.reponse.headers.get('content-type'), /^text\/event-stream/);
    assert.match(flux.reponse.headers.get('cache-control'), /no-cache/);
    assert.equal(flux.reponse.headers.get('x-accel-buffering'), 'no');

    // Le rejeu : ce qui s'est passé AVANT la connexion.
    await flux.jusqua('offre');
    assert.deepEqual(flux.evenements.map(e => e.nom), ['debut', 'source', 'offre']);
    assert.equal(flux.evenements[0].donnees.id, corps.id);

    // Le direct : ce qui arrive APRÈS.
    tenue.liberer();
    await flux.jusqua('fin');
    assert.deepEqual(flux.evenements.map(e => e.nom), ['debut', 'source', 'offre', 'analyse', 'fin']);
    assert.equal(flux.evenements.at(-1).donnees.resume.statut, 'ok');
    assert.ok(flux.brut.some(b => /^id: \d+$/m.test(b)), 'chaque événement porte un id');
  } finally {
    flux?.fermer();
    tenue.liberer();
    await s.fermer();
  }
});

test('un client qui part libère son écouteur', async () => {
  const tenue = collecteTenue();
  const s = await monter({ collecter: tenue.fn });
  try {
    await s.post('/api/collecte/demarrer');
    const avant = s.live.bus.listenerCount('evenement');
    const flux = await ouvrirFlux(`${s.base}/api/collecte/flux`);
    await flux.jusqua('offre');
    assert.equal(s.live.bus.listenerCount('evenement'), avant + 1);

    flux.fermer();
    const limite = Date.now() + 2000;
    while (s.live.bus.listenerCount('evenement') > avant && Date.now() < limite) {
      await new Promise(r => setTimeout(r, 20));
    }
    assert.equal(s.live.bus.listenerCount('evenement'), avant, 'aucun écouteur fantôme');
  } finally {
    tenue.liberer();
    await s.fermer();
  }
});

test('le flux rejoue une collecte déjà finie si on la nomme', async () => {
  const s = await monter({ collecter: async () => ({ statut: 'non-configure', nouvelles: 0 }) });
  let flux;
  try {
    const { corps } = await s.post('/api/collecte/demarrer');
    await new Promise(r => setTimeout(r, 30));
    flux = await ouvrirFlux(`${s.base}/api/collecte/flux?id=${corps.id}`);
    await flux.jusqua('fin');
    assert.equal(flux.evenements.at(-1).donnees.resume.statut, 'non-configure');
  } finally {
    flux?.fermer();
    await s.fermer();
  }
});

test('une collecte qui lève émet « erreur » et rend le verrou', async () => {
  const s = await monter({ collecter: async () => { throw new Error('sources injoignables'); } });
  try {
    await s.post('/api/collecte/demarrer');
    await new Promise(r => setTimeout(r, 30));
    const etat = await s.get('/api/collecte/etat');
    assert.equal(etat.evenements.at(-1).nom, 'erreur');
    assert.match(etat.evenements.at(-1).donnees.message, /injoignables/);
    assert.equal((await s.post('/api/collecte/demarrer')).status, 202, 'le verrou est rendu');
  } finally {
    await new Promise(r => setTimeout(r, 30));
    await s.fermer();
  }
});

test('/refresh reste synchrone et passe par le même journal', async () => {
  const s = await monter({ collecter: async ({ progres }) => {
    emetteur(progres)('debut', { sources: [] });
    return { statut: 'ok', nouvelles: 2 };
  } });
  try {
    const r = await s.post('/api/refresh');
    assert.equal(r.status, 200);
    assert.equal(r.corps.resume.nouvelles, 2);
    const etat = await s.get('/api/collecte/etat');
    assert.deepEqual(etat.evenements.map(e => e.nom), ['debut', 'fin']);
  } finally { await s.fermer(); }
});

// ────────────────────── Événements émis par collecter ──────────────────────

const aujourdhui = new Date().toISOString().slice(0, 10);
const OFFRE = {
  externalId: 'f1', titre: 'Juriste agrivoltaïque', entreprise: 'ACME', ville: 'Nancy (54)',
  description: 'Poste de juriste sur des projets agrivoltaïques, avec suivi des autorisations.'.padEnd(120, ' .'),
  dateOffre: aujourdhui, lien: 'https://exemple.fr/1', contrat: 'CDI',
};

test('collecter émet debut, source, étapes, une offre par retenue et une analyse par appel', async () => {
  const db = ouvrirBase(':memory:');
  const recus = [];
  const sources = [
    { nom: 'factice', estConfiguree: () => true, chercher: async () => [OFFRE] },
    { nom: 'absente', estConfiguree: () => false, chercher: async () => [] },
  ];
  const r = await collecter({
    db, profil: PROFIL, sources, cv: 'x'.repeat(200), analyser: true,
    analyserOffre: async () => ({ verdict: 'Oui, fonce.' }),
    progres: (nom, donnees) => recus.push({ nom, donnees }),
  });

  const noms = recus.map(e => e.nom);
  assert.equal(noms[0], 'debut');
  assert.deepEqual(recus[0].donnees.sources, ['factice', 'absente']);
  assert.deepEqual(recus[0].donnees.villes, ['Nancy']);

  const sourcesEvt = recus.filter(e => e.nom === 'source').map(e => e.donnees);
  assert.ok(sourcesEvt.some(s => s.nom === 'absente' && s.etat === 'ignoree'));
  assert.ok(sourcesEvt.some(s => s.nom === 'factice' && s.etat === 'ok' && s.ville === 'France'),
    'la passe nationale s\'annonce « France »');

  const etapes = recus.filter(e => e.nom === 'etape').map(e => e.donnees.nom);
  assert.deepEqual(etapes, ['fusion', 'filtrage', 'ecriture', 'analyse', 'nettoyage', 'sauvegarde']);
  const fusion = recus.find(e => e.nom === 'etape' && e.donnees.nom === 'fusion').donnees.detail;
  assert.equal(fusion.brutes, 2, 'une offre par requête : Nancy puis France');
  assert.equal(fusion.distinctes, 1);

  const offres = recus.filter(e => e.nom === 'offre');
  assert.equal(offres.length, r.retenues);
  assert.equal(offres[0].donnees.nouvelle, true);
  assert.equal(offres[0].donnees.groupe, 1);

  const analyses = recus.filter(e => e.nom === 'analyse');
  assert.equal(analyses.length, 1);
  assert.deepEqual({ i: analyses[0].donnees.i, total: analyses[0].donnees.total, verdict: analyses[0].donnees.verdict },
    { i: 1, total: 1, verdict: 'Oui, fonce.' });
  db.close();
});

test('un observateur qui lève ne casse pas la collecte', async () => {
  const db = ouvrirBase(':memory:');
  const r = await collecter({
    db, profil: PROFIL, sources: [{ nom: 'factice', estConfiguree: () => true, chercher: async () => [OFFRE] }],
    cv: '', analyser: false, progres: () => { throw new Error('radar cassé'); },
  });
  assert.equal(r.nouvelles, 1);
  db.close();
});

// RÉGRESSION : le CV était lu une fois au démarrage du serveur, puis figé.
test('le planificateur relit le CV à chaque tour', async () => {
  const db = ouvrirBase(':memory:');
  let version = 'CV v1';
  const vus = [];
  const p = demarrerPlanificateur({
    db, sources: [], profil: {}, actif: true, journal: MUET,
    cv: () => version,
    collecter: async ({ cv }) => { vus.push(cv); return {}; },
    delaiAmorceMs: 1, intervalleMs: 40,
  });
  await new Promise(r => setTimeout(r, 20));
  version = 'CV v2';
  await new Promise(r => setTimeout(r, 70));
  p.arreter();
  assert.equal(vus[0], 'CV v1');
  assert.ok(vus.includes('CV v2'), `le nouveau CV doit servir dès le tour suivant (vus : ${vus.join(', ')})`);
  db.close();
});
