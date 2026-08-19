// EST-CE QUE ÇA DÉMARRE ?
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Deux pannes de démarrage ont traversé une suite entièrement verte :
//
//   · le serveur lisait `profile/profile.json` sans filet, et mourait au
//     premier double-clic sur une installation neuve ;
//   · une fonction déplacée d'un module à l'autre n'a pas été ajoutée aux
//     imports — 284 tests au vert, et une application qui ne se lance plus.
//
// Les deux fois, tous les modules étaient corrects PRIS UN À UN. C'est leur
// assemblage qui ne tenait pas, et rien ne l'assemblait avant l'utilisateur.
//
// Ce test lance donc le vrai serveur, dans un vrai processus, et lui parle.
// Il est plus lent que les autres réunis ; il est aussi le seul dont l'échec
// signifie « personne ne peut ouvrir l'application ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Lance le serveur et attend qu'il réponde.
 *
 * Le port est tiré au hasard dans la plage éphémère : un port fixe entrerait
 * en conflit avec l'application de l'utilisateur, qui tourne peut-être pendant
 * que la suite s'exécute — et le test échouerait pour une raison qui n'a rien
 * à voir avec le code.
 *
 * La base part dans un dossier temporaire : un test ne touche pas aux données
 * de quelqu'un.
 */
async function lancerServeur() {
  // ON NE TIRE PLUS DE PORT AU HASARD, ON LAISSE LE SYSTÈME EN DONNER UN.
  //
  // Un tirage dans 42000-50000 évite bien le port de l'utilisateur, mais
  // pas les plages que Windows RÉSERVE pour lui (Hyper-V, exclusions
  // `netsh`). La chaîne d'intégration est tombée là-dessus : `listen
  // EACCES: permission denied 127.0.0.1:49732`, sur un test qui passait
  // partout ailleurs. Un échec de ce genre coûte cher — il fait chercher
  // un défaut dans le code publié alors qu'il n'y en a pas.
  //
  // `PORT=0` demande au système un port libre, et il connaît les siens.
  // On lit ensuite le port RÉELLEMENT ouvert dans le journal de démarrage.
  const dossier = mkdtempSync(join(tmpdir(), 'cockpit-demarrage-'));

  const serveur = spawn(process.execPath, [join(RACINE, 'src/server.js')], {
    env: { ...process.env, PORT: '0', DB_PATH: join(dossier, 'test.db'), COLLECTE_AUTO: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let journal = '';
  serveur.stdout.on('data', d => { journal += d; });
  serveur.stderr.on('data', d => { journal += d; });

  /**
   * Sous Windows, le fichier de base reste VERROUILLÉ tant que le processus
   * n'a pas rendu la main : effacer aussitôt après `kill()` échoue en EPERM.
   * On attend donc sa sortie — et un dossier temporaire qui survivrait n'est
   * pas un échec de test, seulement quelques kilo-octets dans %TEMP%.
   */
  const arreter = async () => {
    if (serveur.exitCode === null) {
      serveur.kill();
      await new Promise(r => { serveur.once('exit', r); setTimeout(r, 3000); });
    }
    try { rmSync(dossier, { recursive: true, force: true }); } catch { /* verrou tardif */ }
  };

  // On interroge jusqu'à obtenir une réponse : attendre une durée fixe donne
  // soit un test lent, soit un test qui échoue sur une machine chargée.
  const limite = Date.now() + 20000;
  let port = 0;
  while (Date.now() < limite) {
    if (serveur.exitCode !== null) {
      await arreter();
      assert.fail(`Le serveur s'est arrêté (code ${serveur.exitCode}) :\n\n${journal}`);
    }
    // Le port apparaît dans le journal dès que l'écoute est ouverte.
    if (!port) {
      const vu = journal.match(/Écoute\s+:\s+\S+?:(\d+)/);
      if (vu) port = Number(vu[1]);
    }
    if (port) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' });
      return { port, serveur, journal: () => journal, arreter, premiereReponse: r };
      } catch { /* pas encore prêt */ }
    }
    await new Promise(r => setTimeout(r, 120));
  }
  await arreter();
  assert.fail(`Le serveur n'a pas répondu en 20 s :\n\n${journal}`);
}

test('le serveur démarre et répond', async () => {
  const s = await lancerServeur();
  try {
    // 200 sur le tableau de bord, ou 302 vers l'assistant si rien n'est encore
    // configuré : les deux sont des démarrages réussis. Ce qu'on refuse, c'est
    // l'absence de réponse.
    assert.ok([200, 302].includes(s.premiereReponse.status),
      `la racine a répondu ${s.premiereReponse.status}`);

    const meta = await (await fetch(`http://127.0.0.1:${s.port}/api/meta`)).json();
    assert.equal(meta.ok, true, 'l\'API doit répondre, pas seulement les fichiers statiques');
    assert.ok(Array.isArray(meta.villes), 'le profil doit être chargé et exposé');
  } finally {
    await s.arreter();
  }
});

/**
 * Une erreur écrite sur la sortie standard au démarrage passe inaperçue :
 * l'application est lancée par un raccourci qui masque la fenêtre. Une
 * variable manquante, un module introuvable, une promesse rejetée — rien de
 * tout cela n'atteindrait jamais l'utilisateur.
 */
test('aucune erreur ne sort au démarrage', async () => {
  const s = await lancerServeur();
  await new Promise(r => setTimeout(r, 400));
  const texte = s.journal();
  await s.arreter();

  for (const suspect of [/ReferenceError/, /TypeError/, /is not defined/,
    /Cannot find module/, /UnhandledPromiseRejection/]) {
    assert.ok(!suspect.test(texte), `le démarrage écrit « ${suspect} » :\n\n${texte}`);
  }
});

/**
 * L'AVERTISSEMENT QUE L'UTILISATEUR NE DOIT PAS VOIR.
 *
 * `node:sqlite` était expérimental jusqu'à Node 24, et affichait à chaque
 * démarrage :
 *
 *     ExperimentalWarning: SQLite is an experimental feature
 *     and might change at any time
 *
 * Ce n'est pas une panne, mais c'est la première ligne que voit quelqu'un qui
 * vient d'ouvrir l'application — et « expérimental » n'est pas le mot qu'on
 * veut lire au-dessus de ses candidatures.
 *
 * La contrainte porte donc sur le MOTEUR EMBARQUÉ, pas sur le code : c'est
 * pourquoi la chaîne d'intégration construit avec Node 24. Sur une version
 * plus ancienne, lancer les sources reste parfaitement valable — le projet
 * l'autorise — et le test ne l'interdit pas.
 */
test('le moteur retenu n\'annonce pas SQLite comme expérimental', async (t) => {
  const majeure = Number(process.versions.node.split('.')[0]);
  if (majeure < 24) {
    return t.skip(`Node ${majeure} : l'avertissement est attendu, c'est Node 24 qu'on publie`);
  }

  const s = await lancerServeur();
  await new Promise(r => setTimeout(r, 400));
  const texte = s.journal();
  await s.arreter();

  assert.ok(!/ExperimentalWarning: SQLite/.test(texte),
    `Node ${majeure} affiche encore l'avertissement SQLite :\n\n${texte}`);
});
