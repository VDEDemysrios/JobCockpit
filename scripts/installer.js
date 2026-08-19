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
import { synchroniser as synchroniserCles } from './cles.js';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(RACINE, 'dist');
const DEFAUT = resolve(RACINE, '..', 'Application');

const mo = (o) => `${(o / 1048576).toFixed(1)} Mo`;

/**
 * Arrête l'application si elle tourne.
 * @returns {boolean} true si elle tournait — l'appelant la relancera.
 */
/** Vrai tant qu'un JobCockpit.exe figure dans la liste des processus. */
function tourneEncore() {
  try {
    return execFileSync('tasklist', ['/FI', 'IMAGENAME eq JobCockpit.exe', '/NH'],
      { encoding: 'latin1' }).includes('JobCockpit.exe');
  } catch {
    return false;
  }
}

function arreterApplication() {
  try {
    if (!tourneEncore()) return false;

    // ON DEMANDE AVANT D'EXIGER.
    //
    // `taskkill /F` tue sans préavis : le gestionnaire de SIGTERM du serveur —
    // celui qui arrête le planificateur PUIS ferme la base — n'est jamais
    // exécuté. Or fermer la base est ce qui vide son journal WAL dans le
    // fichier principal. Chaque mise à jour se faisait donc sur une base
    // laissée en plan, à charge pour l'ouverture suivante de la récupérer.
    //
    // On tente donc une fermeture ordinaire, et on ne force qu'à défaut. Le
    // pire cas coûte deux secondes et demie ; le meilleur évite de couper une
    // écriture au milieu.
    // Le try est ISOLÉ : sans fenêtre à qui envoyer sa demande de fermeture,
    // `taskkill` sans /F sort en erreur. Dans un try partagé, cette sortie
    // emportait tout l'arrêt — le repli en force n'était jamais atteint, et
    // la mise à jour échouait sur un « resource busy » quelques lignes plus
    // loin. Une tentative qui échoue doit rester une tentative.
    try {
      execFileSync('taskkill', ['/IM', 'JobCockpit.exe'], { stdio: 'ignore' });
      const douceur = Date.now() + 2500;
      while (tourneEncore() && Date.now() < douceur) {
        execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},150)']);
      }
    } catch { /* pas de fermeture en douceur possible : on forcera */ }

    if (tourneEncore()) {
      execFileSync('taskkill', ['/IM', 'JobCockpit.exe', '/F'], { stdio: 'ignore' });
    }

    // ON ATTEND LA DISPARITION RÉELLE, PAS UN DÉLAI AU JUGÉ.
    //
    // `taskkill` rend la main avant que le processus soit parti : il a
    // seulement demandé sa mort. L'ancienne version dormait 1,5 s en
    // espérant que ça suffise. Quand ça ne suffisait pas, le processus tenait
    // encore le port 3000 à la relance : la nouvelle instance se heurtait à
    // EADDRINUSE et refusait de démarrer — correctement — pendant que
    // l'ancienne finissait de mourir. Il ne restait plus personne, et
    // l'application était injoignable après une simple mise à jour.
    //
    // Constaté en direct : « démarré, écoute 127.0.0.1:3000 » suivi de
    // « le port 3000 est déjà pris », et zéro instance à l'arrivée.
    const limite = Date.now() + 10_000;
    while (tourneEncore() && Date.now() < limite) {
      execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},200)']);
    }
    // Un dernier temps mort pour le verrou de fichier, que Windows relâche
    // juste après la fin du processus.
    execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},600)']);
    return true;
  } catch {
    return false;
  }
}

/** Une pause bloquante de `ms` millisecondes, sans dépendance. */
const pause = (ms) => execFileSync(process.execPath, ['-e', `setTimeout(()=>{},${ms})`]);

/**
 * Vrai si quelqu'un répond sur le port de l'application.
 *
 * On interroge le PORT, pas la liste des processus : un exécutable vivant qui
 * n'écoute pas est exactement le cas qu'on cherche à détecter.
 */
function repond(port = 3000) {
  try {
    const sortie = execFileSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'latin1' });
    return sortie.split(/\r?\n/).some(l => /LISTENING/i.test(l) && l.includes(`:${port}`));
  } catch {
    return false;
  }
}

/**
 * Relance l'application — et VÉRIFIE qu'elle est repartie.
 *
 * Lancer ne suffit pas. Deux fois de suite, une mise à jour a laissé zéro
 * instance : le lanceur avait fait son travail, mais l'instance neuve tombait
 * sur un port encore tenu par l'ancienne, refusait de démarrer — à juste
 * titre — pendant que l'ancienne achevait de mourir. Le journal disait
 * « le port 3000 est déjà pris », l'installateur disait « application
 * relancée », et le tableau de bord était injoignable.
 *
 * Un installateur répond du RÉSULTAT, pas du geste : on attend la réponse, et
 * on retente une fois si elle ne vient pas.
 */
function relancerApplication(cible) {
  const lanceur = join(cible, 'Demarrer.vbs');
  if (!existsSync(lanceur)) return false;

  for (const essai of [1, 2]) {
    try {
      execFileSync('wscript.exe', [lanceur], { cwd: cible, stdio: 'ignore' });
    } catch {
      return false;
    }

    const limite = Date.now() + 25_000;
    while (Date.now() < limite) {
      pause(700);
      if (repond()) return true;
    }
    if (essai === 1) {
      console.log('   ⏳ pas de réponse sur le port 3000 — seconde tentative');
      // Le port peut rester tenu quelques secondes après la mort du processus.
      pause(3000);
    }
  }
  return false;
}

export function principal(argv = process.argv.slice(2)) {
  const cible = argv.find(a => !a.startsWith('--')) ?? DEFAUT;
  const premiere = !existsSync(join(cible, 'JobCockpit.exe'));

  // 1. L'EXÉCUTABLE DOIT EXISTER AVANT QU'ON TOUCHE À QUOI QUE CE SOIT.
  //
  // Ce contrôle a été ajouté après avoir DÉTRUIT une installation qui
  // marchait. La construction avait échoué — Avast refusait d'écrire un
  // fichier nommé `JobCockpit.exe` — et l'installation a continué : elle a
  // remplacé `public\`, les lanceurs et l'icône, puis annoncé « Mis à
  // jour ». Le dossier s'est retrouvé sans programme, et l'application ne
  // démarrait plus du tout.
  //
  // Une mise à jour qui échoue doit laisser l'existant INTACT. On vérifie
  // donc tout avant la première écriture, et on s'arrête sans rien casser.
  const source = join(DIST, 'JobCockpit.exe');
  if (!existsSync(source)) {
    console.log('⚙  Aucun exécutable construit — construction en cours…\n');
    try {
      execFileSync(process.execPath, [join(RACINE, 'scripts/construire-exe.mjs')], { stdio: 'inherit' });
    } catch {
      console.error('\n❌ La construction a échoué. Rien n\'a été touché.\n');
      process.exit(1);
    }
  }

  // Un exécutable de quelques kilo-octets est un reste de construction
  // interrompue, pas un programme : le copier casserait tout aussi bien.
  const POIDS_MINIMAL = 50 * 1024 * 1024;
  if (!existsSync(source) || statSync(source).size < POIDS_MINIMAL) {
    console.error('\n❌ Installation refusée : aucun exécutable exploitable dans dist/.\n');
    console.error(`   Attendu : ${source}`);
    if (existsSync(source)) console.error(`   Trouvé  : ${mo(statSync(source).size)} — beaucoup trop petit.`);
    console.error('\n   L\'installation existante n\'a PAS été modifiée.');
    console.error('\n   Cause la plus fréquente : un antivirus refuse d\'écrire un fichier');
    console.error('   nommé JobCockpit.exe. Exclure le dossier du projet et celui de');
    console.error('   l\'application règle la question — voir docs/HANDOFF.md §4.\n');
    process.exit(1);
  }

  mkdirSync(cible, { recursive: true });
  console.log(`\n📦 ${premiere ? 'Installation' : 'Mise à jour'} — ${cible}\n`);

  // Windows verrouille un exécutable en cours d'exécution : sans cet arrêt,
  // toute mise à jour échouait sur « EBUSY: resource busy or locked ». On
  // relance à la fin, pour que mettre à jour ne demande aucun geste de plus.
  const tournait = arreterApplication();
  if (tournait) console.log('   ⏹ application arrêtée le temps de la mise à jour');

  // 2. Le programme, toujours remplacé.
  const arrivee = join(cible, 'JobCockpit.exe');
  try {
    copyFileSync(source, arrivee);
  } catch (e) {
    console.error(`\n❌ Copie du programme impossible : ${e.message}`);
    console.error('   Un antivirus bloque probablement ce nom de fichier.');
    console.error('   L\'application est peut-être inutilisable : relance après exclusion.\n');
    process.exit(1);
  }
  if (!existsSync(arrivee) || statSync(arrivee).size < POIDS_MINIMAL) {
    console.error('\n❌ Le programme copié est absent ou tronqué. Relance après exclusion.\n');
    process.exit(1);
  }
  rmSync(join(cible, 'public'), { recursive: true, force: true });
  cpSync(join(DIST, 'public'), join(cible, 'public'), { recursive: true });
  copyFileSync(join(DIST, 'LISEZ-MOI.txt'), join(cible, 'LISEZ-MOI.txt'));
  console.log(`   ✓ JobCockpit.exe  ${mo(statSync(join(cible, 'JobCockpit.exe')).size)}`);
  console.log('   ✓ public\\');

  // Les lanceurs et l'icône font partie du programme, pas des données : ils
  // sont donc remplacés à chaque mise à jour. Les oublier ici serait les
  // perdre au premier `npm run installer` fait depuis une machine neuve.
  for (const nom of ['Demarrer.vbs', 'Ouvrir.vbs']) {
    copyFileSync(join(RACINE, 'scripts', nom), join(cible, nom));
  }
  const icone = join(RACINE, 'assets/job-cockpit.ico');
  if (existsSync(icone)) copyFileSync(icone, join(cible, 'job-cockpit.ico'));
  console.log('   ✓ lanceurs et icône');

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

  // LE BUG LE PLUS GRAVE QUE J'AIE ÉCRIT DANS CE PROJET.
  //
  // Cette ligne s'exécutait à CHAQUE installation, mise à jour comprise. Or
  // en mode WAL, `data.db-wal` n'est pas un fichier annexe jetable : c'est là
  // que vivent toutes les écritures depuis le dernier point de contrôle.
  // L'effacer revient à jeter le travail le plus récent — précisément celui
  // auquel on tient.
  //
  // Constaté deux fois dans la même soirée : l'auteur marque une candidature
  // « Envoyé », je reconstruis l'exécutable, et la candidature a disparu.
  // L'offre était intacte, absente de `rejetees`, et aucune suppression n'avait
  // eu lieu depuis le matin — parce qu'il n'y avait pas eu de suppression. Il y
  // avait eu une perte.
  //
  // Le raisonnement d'origine ne valait QUE pour la première installation :
  // après un `VACUUM INTO`, les annexes de la copie décrivent la base source
  // et n'ont effectivement rien à faire là. Sur une mise à jour, la base est
  // celle qui vit, et son WAL avec elle.
  if (reprisesBase) {
    for (const suffixe of ['-wal', '-shm']) rmSync(join(cible, 'data.db' + suffixe), { force: true });
  }

  if (protegees) console.log(`   ⊘ ${protegees} fichier(s) de données déjà présent(s) — non touché(s)`);

  // LES CLÉS AJOUTÉES DEPUIS LA PREMIÈRE INSTALLATION N'ARRIVAIENT JAMAIS ICI.
  //
  // Le `.env` fait partie des données : il est copié une fois, puis protégé.
  // C'est la bonne règle — sauf pour une clé NOUVELLE, qui reste alors dans le
  // projet pendant que l'application affiche « non configuré ». Le symptôme ne
  // ressemble pas à un problème de fichier, et il a déjà coûté deux sessions.
  //
  // On complète donc ce qui manque, sans jamais toucher à ce qui est rempli.
  const ajoutees = synchroniserCles(join(cible, '.env'));
  if (ajoutees.length) {
    console.log(`   ✓ .env complété depuis le projet : ${ajoutees.join(', ')}`);
  }

  // Le succès de la relance est DIT, et son échec aussi. Se taire quand
  // l'application n'est pas repartie laissait croire à une mise à jour réussie
  // alors que le tableau de bord était injoignable.
  if (tournait) {
    if (relancerApplication(cible)) {
      console.log('   ▶ application relancée — elle répond sur http://localhost:3000');
    } else {
      console.log('\n   ⚠ L\'APPLICATION N\'EST PAS REPARTIE.');
      console.log('     Rien n\'est perdu : lance-la toi-même depuis le Bureau,');
      console.log(`     ou double-clique ${join(cible, 'Demarrer.vbs')}`);
    }
  }

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
  //
  // ET SURTOUT : HORS DU DÉPÔT.
  // Cette copie vivait à la racine du projet, donc sous surveillance de git.
  // Son nom horodaté échappait au `.gitignore` de l'époque, et un
  // `git add -A` l'a publiée sur un dépôt PUBLIC — 1,4 Mo de recherche
  // d'emploi. Le `.gitignore` est corrigé, mais un fichier de données n'a
  // de toute façon rien à faire dans un arbre versionné : on l'écrit un
  // cran au-dessus, là où git ne regarde pas.
  const misDeCote = resolve(RACINE, '..', `data.db.remplacee-par-l-application-${Date.now()}`);
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
