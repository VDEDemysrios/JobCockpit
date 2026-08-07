// Serveur : sert le dashboard et l'API REST.
//
// DEUX MODES, ET UN GARDE-FOU ENTRE LES DEUX
// ------------------------------------------
//   local  — écoute sur 127.0.0.1, sans mot de passe. La sécurité tient dans
//            l'adresse : personne d'autre ne peut atteindre le serveur.
//   en ligne — écoute sur 0.0.0.0, DERRIÈRE un mot de passe obligatoire.
//
// Le garde-fou plus bas refuse de démarrer sur une adresse publique sans mot
// de passe. C'est la seule chose qui empêche une variable d'environnement
// oubliée de publier le CV, les candidatures et les lettres.
import dotenv from 'dotenv';
import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ouvrirBase } from './db.js';
import { creerRoutes } from './api.js';
import { creerAuth, motDePasseSuggere } from './auth.js';
import { demarrerPlanificateur } from './planificateur.js';
import { collecter, SOURCES } from '../scripts/collect.js';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(RACINE, 'public');

// Le .env est cherché À CÔTÉ du projet, pas dans le dossier courant. Lancé
// depuis ailleurs (raccourci, service, tâche planifiée), le serveur démarrait
// sans aucune clé et affichait toutes les sources « non configurées » — sans
// la moindre erreur pour l'expliquer. En ligne, il n'y a pas de .env : les
// clés arrivent par les secrets de la plateforme, et dotenv ne trouve rien,
// ce qui est normal.
dotenv.config({ path: join(RACINE, '.env') });

// UN JOURNAL CASSÉ NE DOIT PAS TUER UN SERVEUR QUI MARCHE.
//
// La sortie standard est redirigée vers un fichier par le lanceur. Si ce
// fichier est tronqué ou fermé sous les pieds du processus — deux instances
// qui s'écrivent dessus, un antivirus qui verrouille —, la première écriture
// suivante lève une erreur sur `stdout`. Sans écouteur, Node considère que
// c'est fatal et arrête tout : le serveur tombait pour n'avoir pas pu écrire
// une ligne de log, alors qu'il servait très bien ses pages.
//
// Écrire dans le vide est le moindre mal ; c'est un journal, pas la base.
for (const flux of [process.stdout, process.stderr]) flux.on('error', () => {});

const PORT = Number(process.env.PORT ?? 3000);
const HOTE = process.env.HOST ?? '127.0.0.1';
const MOT_DE_PASSE = process.env.COCKPIT_MOT_DE_PASSE ?? '';

// La base vit sur un volume persistant une fois en ligne ; en local, à la
// racine du projet, là où la tâche planifiée l'écrit déjà.
const CHEMIN_BASE = process.env.DB_PATH ?? join(RACINE, 'data.db');

const publique = HOTE !== '127.0.0.1' && HOTE !== 'localhost';

if (publique && !MOT_DE_PASSE) {
  console.error('\n❌ Démarrage refusé.\n');
  console.error(`   Le serveur écouterait sur ${HOTE}, donc au-delà de cette machine,`);
  console.error('   SANS mot de passe. Ton CV, tes candidatures, tes notes et tes');
  console.error('   lettres seraient accessibles à qui trouve l\'adresse.\n');
  console.error('   Dépose un mot de passe avant de recommencer :');
  console.error(`     fly secrets set COCKPIT_MOT_DE_PASSE="${motDePasseSuggere()}"\n`);
  process.exit(1);
}

const profil = JSON.parse(readFileSync(join(RACINE, 'profile/profile.json'), 'utf8'));
const cheminCv = join(RACINE, 'profile/cv.txt');
const cv = existsSync(cheminCv) ? readFileSync(cheminCv, 'utf8') : '';
const db = ouvrirBase(CHEMIN_BASE);

const app = express();

// Derrière le répartiteur de Fly, req.ip vaudrait sinon l'adresse du proxy :
// le frein anti-force-brute compterait toutes les tentatives sur une seule IP.
if (publique) app.set('trust proxy', 1);

// L'ORDRE de ces quatre lignes est la sécurité elle-même :
//   1. le corps JSON est analysé, pour tout le monde y compris la connexion ;
//   2. les routes de connexion sont posées — elles doivent rester joignables ;
//   3. la protection ferme TOUT le reste, API comme fichiers statiques.
//      Oublier l'un des deux laisserait fuiter soit les données, soit le CV.
app.use(express.json({ limit: '2mb' })); // le collage d'annonce peut être volumineux

const auth = creerAuth({ motDePasse: MOT_DE_PASSE, securise: publique });
auth.monter(app, PUBLIC);
app.use(auth.protection);

app.use('/api', creerRoutes({ db, collecter, sources: SOURCES, profil }));
app.use(express.static(PUBLIC));

// Toute erreur non rattrapée renvoie un message lisible plutôt qu'une pile
// d'appels : le dashboard l'affiche tel quel dans un toast.
app.use((erreur, req, res, next) => {
  console.error('Erreur serveur :', erreur);
  res.status(500).json({ ok: false, error: `Erreur interne : ${erreur.message}` });
});

const planificateur = demarrerPlanificateur({
  db, collecter, sources: SOURCES, profil, cv,
  actif: process.env.COLLECTE_AUTO === '1',
});

// UN SERVEUR QUI N'ÉCOUTE PAS DOIT MOURIR.
//
// Le planificateur pose un `setInterval` : il suffit à maintenir le processus
// en vie même quand `listen` a échoué. Constaté le 2 août 2026 — une seconde
// instance lancée par mégarde n'avait pas pu prendre le port, mais restait
// là, invisible, à collecter en double dans la même base. Le tableau de bord,
// lui, était injoignable sans que rien ne l'explique.
const serveur = app.listen(PORT, HOTE, () => {
  console.log('\n🚀 Job Cockpit démarré');
  console.log(`   Écoute       : ${HOTE}:${PORT}`);
  console.log(`   Mot de passe : ${auth.actif ? 'exigé' : 'aucun (accès local uniquement)'}`);
  if (!publique) console.log(`   Ouvre ton navigateur sur : http://localhost:${PORT}`);
  console.log('');
});

serveur.on('error', (erreur) => {
  if (erreur.code === 'EADDRINUSE') {
    console.error(`\n❌ Le port ${PORT} est déjà pris.`);
    console.error('   Job Cockpit tourne probablement déjà : ouvre http://localhost:' + PORT);
    console.error('   Cette instance s\'arrête pour ne pas collecter en double.\n');
  } else {
    console.error('\n❌ Le serveur n\'a pas pu démarrer :', erreur.message, '\n');
  }
  planificateur?.arreter();
  db.close();
  process.exit(1);
});

// Fermeture propre : sans cela, le fichier SQLite peut rester verrouillé.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    planificateur?.arreter();
    serveur.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
