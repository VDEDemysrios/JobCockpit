// Serveur local : sert le dashboard et l'API REST.
//
// Écoute sur 127.0.0.1 par défaut : l'application n'est PAS exposée au
// réseau local. Les données (suivi de candidatures, CV, lettres) restent
// sur cette machine.
import 'dotenv/config';
import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ouvrirBase } from './db.js';
import { creerRoutes } from './api.js';
import { collecter, SOURCES } from '../scripts/collect.js';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 3000);

const profil = JSON.parse(readFileSync(join(RACINE, 'profile/profile.json'), 'utf8'));
const db = ouvrirBase(join(RACINE, 'data.db'));

const app = express();
app.use(express.json({ limit: '2mb' })); // le collage d'annonce peut être volumineux

app.use('/api', creerRoutes({ db, collecter, sources: SOURCES, profil }));

app.use(express.static(join(RACINE, 'public')));

// Toute erreur non rattrapée renvoie un message lisible plutôt qu'une pile
// d'appels : le dashboard l'affiche tel quel dans un toast.
app.use((erreur, req, res, next) => {
  console.error('Erreur serveur :', erreur);
  res.status(500).json({ ok: false, error: `Erreur interne : ${erreur.message}` });
});

const serveur = app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🚀 Job Cockpit démarré`);
  console.log(`   Ouvre ton navigateur sur : http://localhost:${PORT}\n`);
});

// Fermeture propre : sans cela, le fichier SQLite peut rester verrouillé.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    serveur.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
