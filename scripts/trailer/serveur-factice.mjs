// Serveur d'essai : la vraie application, mais une collecte FACTICE qui
// rejoue une séquence d'événements réalistes sans toucher aux API externes
// ni au quota Gemini. Port 4321.
import express from 'express';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ouvrirBase } from '../../src/db.js';
import { creerRoutes } from '../../src/api.js';
import { creerCollecteLive, emetteur } from '../../src/collecte-live.js';
import { chargerProfil } from '../../src/configuration.js';

// La racine du projet : deux niveaux au-dessus de ce fichier, quel que soit
// l'endroit où le dépôt a été cloné.
const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DB = process.env.DB_PATH;
const db = ouvrirBase(DB);
const { profil } = chargerProfil(RACINE);
const attendre = (ms) => new Promise(r => setTimeout(r, ms));

const offresReelles = db.prepare('SELECT id, titre, entreprise, ville, groupe, score, source FROM offers ORDER BY RANDOM() LIMIT 90').all();

async function collecterFactice(options) {
  const e = emetteur(options.progres);
  const sources = ['france-travail', 'adzuna', 'jooble', 'flux'];
  const villes = ['Strasbourg', 'Nancy', 'Lyon', 'Paris', 'France'];
  const intitules = ['juriste énergies renouvelables', 'chargé de projet urbanisme', 'chef de projet ENR'];
  e('debut', { id: 'x', debut: new Date().toISOString(), sources, intitules, villes, depuisDate: '2026-11-06' });
  await attendre(600);
  for (const nom of sources) {
    for (const intitule of intitules) {
      for (const ville of villes) {
        e('source', { nom, etat: 'debut', intitule, ville, trouvees: 0, message: null });
        await attendre(Number(process.env.VITE ?? 45));
        const echec = nom === 'jooble' && ville === 'Paris';
        e('source', { nom, etat: echec ? 'echec' : 'ok', intitule, ville, trouvees: echec ? 0 : 3 + Math.floor(Math.random() * 14), message: echec ? 'HTTP 429' : null });
      }
    }
  }
  e('etape', { nom: 'fusion', detail: { brutes: 812, distinctes: 331 } });
  await attendre(500);
  e('etape', { nom: 'filtrage', detail: { retenues: 90, ignorees: 12 } });
  await attendre(400);
  e('etape', { nom: 'ecriture', detail: { nouvelles: 23 } });
  let n = 0;
  for (const o of offresReelles) {
    e('offre', { id: o.id, titre: o.titre, entreprise: o.entreprise, ville: o.ville, groupe: o.groupe, score: o.score, nouvelle: n++ % 4 === 0, source: o.source });
    await attendre(Number(process.env.VITE_OFFRE ?? 110));
  }
  e('etape', { nom: 'analyse', detail: { prevues: 8 } });
  const prio = offresReelles.filter(o => o.groupe === 1).slice(0, 8);
  for (let i = 0; i < prio.length; i++) {
    await attendre(700);
    e('analyse', { id: prio[i].id, titre: prio[i].titre, i: i + 1, total: prio.length, verdict: i % 3 === 2 ? 'Non, trop junior.' : 'Oui, candidature solide.' });
  }
  e('etape', { nom: 'nettoyage', detail: { purgees: 3, horsProfil: 0, departementsCorriges: 1 } });
  await attendre(500);
  e('etape', { nom: 'sauvegarde', detail: {} });
  await attendre(400);
  return { statut: 'ok', vues: 812, retenues: 90, nouvelles: 23, analysees: prio.length, purgees: 3, horsProfil: 0,
    sansReponse: 0, ignorees: 12, sourcesOk: sources.slice(0, 3), sourcesEnEchec: ['jooble'], sourcesIgnorees: ['indeed'], dureeSecondes: 19 };
}

const app = express();
app.use(express.json({ limit: '2mb' }));
const live = creerCollecteLive({ db });
app.use('/api', creerRoutes({ db, collecter: collecterFactice, sources: [], profil, live, lireCv: () => '', racine: RACINE }));
app.use(express.static(join(RACINE, 'public')));
app.listen(4321, '127.0.0.1', () => console.log('factice sur http://127.0.0.1:4321'));

