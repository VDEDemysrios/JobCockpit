// Construit JobCockpit.exe — un exécutable autonome, sans Node installé.
//
// COMMENT ÇA MARCHE
// -----------------
// Node sait, depuis la version 20, embarquer un script dans une copie de son
// propre binaire (« Single Executable Application »). Trois temps :
//   1. esbuild réunit le serveur et ses dépendances en UN fichier ;
//   2. node prépare un « blob » à partir de ce fichier ;
//   3. postject injecte ce blob dans une copie de node.exe.
//
// CE QUI RESTE À CÔTÉ DE L'EXE, ET POURQUOI
// -----------------------------------------
// `public/`, `profile/`, `.env` et `data.db` ne sont PAS embarqués. Ce n'est
// pas une limite technique mais un choix : `profile.json` se règle à la main,
// `data.db` doit survivre aux mises à jour, et le CV n'a rien à faire dans un
// binaire qu'on pourrait transmettre. Le résultat est un DOSSIER qu'on
// déplace d'un bloc, avec un exécutable dedans.
//
// Usage : npm run exe
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync, rmSync, copyFileSync, writeFileSync, readFileSync,
  existsSync, cpSync, statSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SORTIE = join(RACINE, 'dist');
const TRAVAIL = join(SORTIE, '.construction');

const etape = (n, texte) => console.log(`\n[${n}/5] ${texte}`);
const poids = (f) => `${(statSync(f).size / 1048576).toFixed(1)} Mo`;

rmSync(SORTIE, { recursive: true, force: true });
mkdirSync(TRAVAIL, { recursive: true });

// ─────────────────────────────────────────────────────────── 1. Regroupement
etape(1, 'Regroupement du serveur et de ses dépendances…');

const paquet = join(TRAVAIL, 'serveur.cjs');
await build({
  entryPoints: [join(RACINE, 'src/server.js')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: paquet,
  // Les modules intégrés au moteur ne se regroupent pas — et n'ont pas à
  // l'être : ils sont déjà dans le binaire.
  external: ['node:*'],

  // `import.meta.url` n'existe pas en CJS, et le remplacer par __filename ne
  // suffit pas : le code fait `fileURLToPath(import.meta.url)`, qui exige une
  // vraie URL « file: ».
  //
  // Deux fichiers en dépendent pour trouver leur racine :
  //     RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')
  // On fabrique donc une URL qui FAIT COMME SI le code vivait toujours dans
  // `<dossier de l'exe>/src/` — remonter d'un cran donne alors le dossier de
  // l'exécutable, exactement ce qu'il faut pour trouver public/ et profile/.
  //
  // Effet de bord voulu : les gardes `process.argv[1] === fileURLToPath(...)`
  // de collect.js et consorts deviennent fausses, donc leur `principal()` ne
  // se déclenche pas au démarrage du serveur.
  banner: {
    js: `const { pathToFileURL: __versUrl } = require('node:url');
const { join: __joindre, dirname: __parent } = require('node:path');
const __URL_MODULE = __versUrl(__joindre(__parent(process.execPath), 'src', 'serveur.js')).href;`,
  },
  define: { 'import.meta.url': '__URL_MODULE' },
  logLevel: 'warning',
});
console.log(`      ${poids(paquet)}`);

// ───────────────────────────────────────────────────────────── 2. Préparation
etape(2, 'Préparation du blob…');

const config = join(TRAVAIL, 'sea.json');
writeFileSync(config, JSON.stringify({
  main: paquet,
  output: join(TRAVAIL, 'serveur.blob'),
  disableExperimentalSEAWarning: true,
  // Le cliché de démarrage accélérerait le lancement, mais interdit tout
  // accès au système de fichiers à l'initialisation — or le serveur lit
  // profile.json et ouvre la base au démarrage.
  useSnapshot: false,
  useCodeCache: true,
}, null, 2));

execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });

// ───────────────────────────────────────────────────────────── 3. Le binaire
etape(3, 'Copie du moteur Node…');

const exe = join(SORTIE, 'JobCockpit.exe');
copyFileSync(process.execPath, exe);
console.log(`      ${poids(exe)} (moteur nu)`);

// ───────────────────────────────────────────────────────────── 4. Injection
etape(4, 'Injection du serveur dans le binaire…');

execFileSync(process.execPath, [
  join(RACINE, 'node_modules/postject/dist/cli.js'),
  exe, 'NODE_SEA_BLOB', join(TRAVAIL, 'serveur.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
], { stdio: 'inherit' });
console.log(`      ${poids(exe)} (avec le serveur)`);

// ───────────────────────────────────────────── 5. Le dossier autour de l'exe
etape(5, 'Assemblage du dossier…');

cpSync(join(RACINE, 'public'), join(SORTIE, 'public'), { recursive: true });
mkdirSync(join(SORTIE, 'profile'), { recursive: true });

// Le profil d'exemple, jamais le vrai : le dossier construit peut être copié
// ailleurs, et le profil personnel contient le nom, la ville et les critères.
copyFileSync(join(RACINE, 'profile/profile.example.json'),
  join(SORTIE, 'profile/profile.example.json'));

if (existsSync(join(RACINE, '.env.example'))) {
  copyFileSync(join(RACINE, '.env.example'), join(SORTIE, '.env.example'));
}

writeFileSync(join(SORTIE, 'LISEZ-MOI.txt'), `JOB COCKPIT — version autonome
=================================

Node n'a PAS besoin d'être installé : tout est dans JobCockpit.exe.

AVANT LE PREMIER LANCEMENT
--------------------------
1. Renomme « profile.example.json » en « profile.json » dans le dossier
   profile\\, et remplis-le : ton nom, tes villes, tes mots-clés.
2. Renomme « .env.example » en « .env » et colle tes clés d'API.
3. Dépose ton CV dans profile\\ :
     cv-source.docx   le fichier joint aux candidatures
     cv.txt           le texte, pour l'analyse

ENSUITE
-------
Double-clique JobCockpit.exe, puis ouvre http://localhost:3000

La fenêtre noire doit rester ouverte : c'est le serveur. La fermer arrête
l'application.

CE QUI T'APPARTIENT DANS CE DOSSIER
-----------------------------------
  data.db          toutes tes offres, ton suivi, tes notes, tes lettres
  profile\\         ton profil et ton CV
  .env             tes clés d'API

Ces trois-là ne sont dans aucune sauvegarde automatique. Copie-les ailleurs
de temps en temps — le reste se reconstruit, eux non.

⚠ COPIER LA BASE : LES TROIS FICHIERS, PAS UN SEUL
--------------------------------------------------
La base s'écrit en mode WAL : les modifications récentes vivent dans un
fichier séparé tant qu'elles n'ont pas été intégrées.

  data.db          le gros du contenu
  data.db-wal      les écritures récentes  <-- celui qu'on oublie
  data.db-shm      l'index de coordination

Copier « data.db » tout seul donne une base D'AVANT les dernières
modifications, sans le moindre avertissement. Constaté à la construction de
cet exécutable : 881 offres au lieu de 279, soit un état vieux de plusieurs
heures.

Le plus simple : ferme l'application (le WAL est alors intégré à data.db),
PUIS copie. Sinon, copie les trois ensemble.

METTRE À JOUR
-------------
Remplace JobCockpit.exe et le dossier public\\ par les nouveaux. Ne touche
ni à data.db, ni à profile\\, ni à .env.

⚠ SI TON ANTIVIRUS S'EN MÊLE
----------------------------
JobCockpit.exe est un moteur Node dans lequel le serveur a été injecté : il
n'est donc pas signé, il est inédit, il pèse 92 Mo et il ouvre des centaines
de connexions à chaque collecte. Pour un antivirus, ce portrait est
exactement celui qu'il surveille — même quand tout est parfaitement normal.

Deux réglages à vérifier, chez Avast comme chez les autres :

  1. EXCLUSIONS. Ajoute le dossier de l'application. Sans ça, l'exécutable
     peut être mis en quarantaine sans prévenir, et les collectes ralenties
     par l'inspection de chaque requête.

  2. OPTIMISEUR DE DÉMARRAGE. Certains antivirus désactivent d'eux-mêmes ce
     qui se lance à l'ouverture de session, pour « accélérer le démarrage ».
     C'est ce qui a désactivé trois tâches planifiées de suite pendant
     l'installation. Mets Job Cockpit en exception, ou coupe la fonction.

Ces réglages sont à faire par toi, dans ton antivirus : rien dans ce dossier
ne peut — ni ne doit — les modifier à ta place.
`, 'utf8');

rmSync(TRAVAIL, { recursive: true, force: true });

console.log(`\n✅ Terminé — ${SORTIE}`);
console.log(`   JobCockpit.exe  ${poids(exe)}`);
console.log('\n   Pour essayer : ouvre le dossier, complète profile\\ et .env,');
console.log('   puis double-clique l\'exécutable.\n');
