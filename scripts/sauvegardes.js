// Voir et restaurer les sauvegardes.
//
// Une sauvegarde qu'on ne sait pas relire n'en est pas une. Ce script existe
// pour le jour où quelque chose a mal tourné — moment où on n'a ni l'envie ni
// la disponibilité d'esprit de chercher comment faire.
//
// Usage :
//   npm run sauvegardes                        -> liste ce qui existe
//   npm run sauvegardes -- --maintenant        -> en fait une tout de suite
//   npm run sauvegardes -- --restaurer 2026-08-01_21h45
import { readFileSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ouvrirBase } from '../src/db.js';
import { sauvegarder, lister, reglages } from '../src/sauvegarde.js';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const mo = (o) => `${(o / 1048576).toFixed(1)} Mo`;

function profil() {
  return JSON.parse(readFileSync(join(RACINE, 'profile/profile.json'), 'utf8'));
}

function afficherListe(p) {
  const r = reglages(p);
  const tout = lister(p);

  console.log(`\n💾 Sauvegardes — ${r.dossier}`);
  console.log(`   Rotation : tout des ${r.joursComplets} derniers jours, puis une par jour, ${r.garderJours} jours en tout.\n`);

  if (!tout.length) {
    console.log('   Aucune pour l\'instant. La prochaine collecte en fera une.\n');
    return;
  }

  for (const s of tout) console.log(`   ${s.nom}   ${mo(s.octets).padStart(8)}`);
  const total = tout.reduce((n, s) => n + s.octets, 0);
  console.log(`\n   ${tout.length} sauvegarde(s), ${mo(total)} au total.`);
  console.log(`\n   Pour en restaurer une :`);
  console.log(`     npm run sauvegardes -- --restaurer ${tout[0].nom}\n`);
}

function restaurer(p, nom) {
  const r = reglages(p);
  const source = join(r.dossier, nom, 'data.db');

  if (!existsSync(source)) {
    console.error(`\n❌ Introuvable : ${source}`);
    console.error('   Vérifie le nom avec : npm run sauvegardes\n');
    return 1;
  }

  // La base actuelle est mise de côté AVANT d'être remplacée. Restaurer par
  // erreur ne doit pas être irréversible — c'est déjà une opération qu'on ne
  // fait que dans de mauvais moments.
  const base = join(RACINE, 'data.db');
  const misDeCote = join(RACINE, `data.db.avant-restauration-${Date.now()}`);
  if (existsSync(base)) copyFileSync(base, misDeCote);

  copyFileSync(source, base);

  // Les fichiers annexes décrivent l'ANCIENNE base : les garder la
  // corromprait. SQLite les recrée au prochain démarrage.
  for (const suffixe of ['-wal', '-shm']) rmSync(base + suffixe, { force: true });

  const db = ouvrirBase(base);
  const n = db.prepare('SELECT COUNT(*) n FROM offers').get().n;
  const suivi = db.prepare('SELECT COUNT(*) n FROM tracking').get().n;
  db.close();

  console.log(`\n✅ Base restaurée depuis ${nom}`);
  console.log(`   ${n} offres, ${suivi} ligne(s) de suivi.`);
  console.log(`   L'ancienne base est gardée ici : ${misDeCote}`);
  console.log('\n   Le profil et les clés ne sont PAS restaurés automatiquement.');
  console.log(`   S'il faut aussi les remettre, ils sont dans ${join(r.dossier, nom)}\n`);
  return 0;
}

export function principal(argv = process.argv.slice(2)) {
  const p = profil();

  const i = argv.indexOf('--restaurer');
  if (i !== -1) {
    const nom = argv[i + 1];
    if (!nom) {
      console.error('\n❌ Précise laquelle : npm run sauvegardes -- --restaurer 2026-08-01_21h45\n');
      return 1;
    }
    return restaurer(p, nom);
  }

  if (argv.includes('--maintenant')) {
    const db = ouvrirBase(join(RACINE, 'data.db'));
    try {
      const r = sauvegarder(db, { racine: RACINE, profil: p });
      if (r.ok) console.log(`\n✅ ${r.chemin} (${mo(r.octets)})\n`);
      else console.error(`\n❌ ${r.erreur}\n`);
      return r.ok ? 0 : 1;
    } finally {
      db.close();
    }
  }

  afficherListe(p);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = principal();
  } catch (erreur) {
    console.error('❌ Interrompu :', erreur.message);
    process.exitCode = 1;
  }
}
