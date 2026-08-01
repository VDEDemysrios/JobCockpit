// Installe l'exécutable comme application principale.
//
// POURQUOI CE SCRIPT PLUTÔT QU'UN GLISSER-DÉPOSER
// -----------------------------------------------
// `dist/` est un dossier de CONSTRUCTION : `npm run exe` l'efface entièrement
// avant de le refaire. Y déposer sa base et ses clés reviendrait à les perdre
// à la première reconstruction. L'application vit donc ailleurs, et
// l'installation ne recopie QUE le programme.
//
// LA RÈGLE ABSOLUE : NE JAMAIS ÉCRASER DE DONNÉES
// -----------------------------------------------
// `data.db`, `.env` et `profile/` sont copiés à la PREMIÈRE installation
// seulement. Ensuite, mettre à jour ne touche qu'à l'exécutable et à
// l'interface. Une mise à jour qui efface le suivi de candidatures serait
// pire que pas de mise à jour du tout.
//
// Usage :
//   npm run installer                      -> vers Bureau\JobCockpit\Application
//   npm run installer -- "D:\Mon\Dossier"
import {
  existsSync, mkdirSync, copyFileSync, cpSync, rmSync, readdirSync, statSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(RACINE, 'dist');
const DEFAUT = resolve(RACINE, '..', 'Application');

const mo = (o) => `${(o / 1048576).toFixed(1)} Mo`;

export function principal(argv = process.argv.slice(2)) {
  const cible = argv.find(a => !a.startsWith('--')) ?? DEFAUT;
  const premiere = !existsSync(join(cible, 'JobCockpit.exe'));

  // 1. L'exécutable doit exister et être à jour.
  if (!existsSync(join(DIST, 'JobCockpit.exe'))) {
    console.log('⚙  Aucun exécutable construit — construction en cours…\n');
    execFileSync(process.execPath, [join(RACINE, 'scripts/construire-exe.mjs')], { stdio: 'inherit' });
  }

  mkdirSync(cible, { recursive: true });
  console.log(`\n📦 ${premiere ? 'Installation' : 'Mise à jour'} — ${cible}\n`);

  // 2. Le programme, toujours remplacé.
  copyFileSync(join(DIST, 'JobCockpit.exe'), join(cible, 'JobCockpit.exe'));
  rmSync(join(cible, 'public'), { recursive: true, force: true });
  cpSync(join(DIST, 'public'), join(cible, 'public'), { recursive: true });
  copyFileSync(join(DIST, 'LISEZ-MOI.txt'), join(cible, 'LISEZ-MOI.txt'));
  console.log(`   ✓ JobCockpit.exe  ${mo(statSync(join(cible, 'JobCockpit.exe')).size)}`);
  console.log('   ✓ public\\');

  // 3. Les données, à la première installation SEULEMENT.
  let reprises = 0, protegees = 0, reprisesBase = false;

  // LA BASE À PART. Un copier-coller de `data.db` donnerait un état périmé :
  // en mode WAL, les écritures récentes vivent dans `data.db-wal` tant
  // qu'elles ne sont pas intégrées — ici 5,4 Mo en attente. `VACUUM INTO`
  // écrit une copie complète et cohérente, et c'est la seule façon correcte.
  const baseSource = join(RACINE, 'data.db');
  const baseCible = join(cible, 'data.db');
  if (existsSync(baseSource) && !existsSync(baseCible)) {
    const db = new DatabaseSync(baseSource, { readOnly: true });
    try {
      db.exec(`VACUUM INTO '${baseCible.replace(/\\/g, '/').replace(/'/g, "''")}'`);
      const n = db.prepare('SELECT COUNT(*) n FROM offers').get().n;
      console.log(`   ✓ data.db repris depuis le projet — ${n} offres (copie cohérente, WAL compris)`);
      reprisesBase = true;
    } finally {
      db.close();
    }
  } else if (existsSync(baseCible)) {
    console.log('   ⊘ data.db déjà présent — non touché');
  }

  const donnees = [
    ['.env', join(RACINE, '.env'), join(cible, '.env')],
    ['profile/profile.json', join(RACINE, 'profile/profile.json'), join(cible, 'profile/profile.json')],
    ['profile/cv.txt', join(RACINE, 'profile/cv.txt'), join(cible, 'profile/cv.txt')],
    ['profile/cv-source.docx', join(RACINE, 'profile/cv-source.docx'), join(cible, 'profile/cv-source.docx')],
  ];

  mkdirSync(join(cible, 'profile'), { recursive: true });

  for (const [nom, source, destination] of donnees) {
    if (!existsSync(source)) continue;
    if (existsSync(destination)) { protegees++; continue; }
    copyFileSync(source, destination);
    reprises++;
    console.log(`   ✓ ${nom} repris depuis le projet`);
  }

  // Les fichiers annexes de SQLite décrivent la base d'origine : les recopier
  // corromprait la copie. SQLite les recrée seul au premier démarrage.
  for (const suffixe of ['-wal', '-shm']) rmSync(join(cible, 'data.db' + suffixe), { force: true });

  if (protegees) console.log(`   ⊘ ${protegees} fichier(s) de données déjà présent(s) — non touché(s)`);

  console.log(`\n✅ ${premiere ? 'Installé' : 'Mis à jour'}.`);
  if (premiere && reprises) {
    console.log('\n   ⚠ Tu as maintenant DEUX bases : celle-ci et celle du projet.');
    console.log('     Elles vont diverger dès la prochaine collecte. Pour éviter ça :');
    console.log('       npm run installer -- --neutraliser-le-projet');
  }
  console.log(`\n   L'application : ${join(cible, 'JobCockpit.exe')}\n`);

  return 0;
}

/**
 * Met la base du projet hors d'usage, sans la détruire.
 *
 * Deux bases qui divergent est le piège dans lequel ce projet est déjà tombé
 * une fois — un second poste collectait dans son coin pendant des semaines.
 * On renomme plutôt que de supprimer : la remettre demande un geste, la
 * perdre ne doit demander aucun regret.
 */
export function neutraliser() {
  const base = join(RACINE, 'data.db');
  if (!existsSync(base)) {
    console.log('\n   Le projet n\'a déjà plus de base.\n');
    return 0;
  }

  // VACUUM INTO, pas un copier-coller : le WAL peut contenir des heures
  // d'écritures. Mettre de côté une copie tronquée ne serait pas « garder au
  // cas où », ce serait garder un leurre.
  const misDeCote = join(RACINE, `data.db.remplacee-par-l-application-${Date.now()}`);
  const db = new DatabaseSync(base, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${misDeCote.replace(/\\/g, '/').replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  for (const suffixe of ['', '-wal', '-shm']) rmSync(base + suffixe, { force: true });

  console.log(`\n✅ Base du projet mise de côté : ${misDeCote}`);
  console.log('   Le projet ne sert plus qu\'à développer ; l\'application a la seule base vivante.\n');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = process.argv.includes('--neutraliser-le-projet')
      ? neutraliser()
      : principal();
  } catch (erreur) {
    console.error('❌ Installation interrompue :', erreur.message);
    process.exitCode = 1;
  }
}
