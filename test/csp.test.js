// LA POLITIQUE DE SÉCURITÉ, ÉPROUVÉE SUR UN VRAI SERVEUR.
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Le lecteur Spotify intégré est la SEULE chose du projet qui ouvre
// `script-src` : un script étranger s'exécute alors dans la page qui affiche
// le CV, les candidatures et les lettres. Cette ouverture est conditionnée à
// une option, et une installation neuve doit garder la porte fermée.
//
// Une politique de sécurité ne se dégrade jamais bruyamment. Trop large, tout
// marche mieux — et personne ne s'en aperçoit. Trop étroite, une ressource
// disparaît en silence : c'est ainsi que les pochettes Spotify sont restées
// invisibles pendant une session entière, prises pour un défaut de l'API.
//
// Ce test lance donc le vrai serveur et lit l'en-tête qu'il envoie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(fileURLToPath(new URL('.', import.meta.url)), '..');

async function lancer() {
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
  const dossier = mkdtempSync(join(tmpdir(), 'cockpit-csp-'));
  const serveur = spawn(process.execPath, [join(RACINE, 'src/server.js')], {
    env: { ...process.env, PORT: '0', DB_PATH: join(dossier, 'test.db'),
      COLLECTE_AUTO: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let journal = '';
  serveur.stdout.on('data', d => { journal += d; });
  serveur.stderr.on('data', d => { journal += d; });

  const arreter = async () => {
    if (serveur.exitCode === null) {
      serveur.kill();
      await new Promise(r => { serveur.once('exit', r); setTimeout(r, 3000); });
    }
    try { rmSync(dossier, { recursive: true, force: true }); } catch { /* verrou tardif */ }
  };

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
        const r = await fetch(`http://127.0.0.1:${port}/api/meta`);
      if (r.ok) return { port, arreter };
      } catch { /* pas encore prêt */ }
    }
    await new Promise(r => setTimeout(r, 120));
  }
  await arreter();
  assert.fail(`Le serveur n'a pas répondu :\n\n${journal}`);
}

const politique = async (port) => (await fetch(`http://127.0.0.1:${port}/api/meta`))
  .headers.get('content-security-policy');

/** Lit une directive, en rendant la liste de ses sources. */
function directive(csp, nom) {
  const bloc = csp.split(';').map(s => s.trim()).find(s => s.startsWith(`${nom} `));
  return bloc ? bloc.slice(nom.length + 1).split(/\s+/) : null;
}

/**
 * L'ÉTAT PAR DÉFAUT, celui d'une installation neuve. C'est le plus important
 * des deux : personne ne relit une politique qui n'a jamais bougé.
 */
test('sans lecteur intégré, aucun script étranger n\'est autorisé', async () => {
  const s = await lancer();
  try {
    const csp = await politique(s.port);
    assert.deepEqual(directive(csp, 'script-src'), ["'self'"],
      'une installation neuve ne doit charger aucun script d\'ailleurs');
    assert.deepEqual(directive(csp, 'connect-src'), ["'self'"],
      'rien ne doit partir vers un tiers depuis notre code');
    assert.ok(!csp.includes('sdk.scdn.co'), 'le SDK ne doit pas être autorisé d\'avance');
    assert.ok(!csp.includes('worker-src'), 'aucun worker tant que le lecteur dort');
  } finally { await s.arreter(); }
});

/** Ce qui doit rester vrai dans TOUS les cas, lecteur ou pas. */
test('les garde-fous permanents ne dépendent d\'aucune option', async () => {
  const s = await lancer();
  try {
    const csp = await politique(s.port);
    assert.deepEqual(directive(csp, 'frame-ancestors'), ["'none'"],
      'sans lui, l\'application peut être enfermée dans un cadre et détournée au clic');
    assert.deepEqual(directive(csp, 'base-uri'), ["'none'"]);
    assert.deepEqual(directive(csp, 'form-action'), ["'self'"]);
    assert.deepEqual(directive(csp, 'default-src'), ["'self'"]);
    assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"),
      'aucun script en ligne, jamais');
    assert.ok(!/script-src[^;]*\*/.test(csp), 'aucun joker sur les scripts');
  } finally { await s.arreter(); }
});

/**
 * LES POCHETTES ET LES VIGNETTES.
 *
 * Bloquées, elles ne produisent ni erreur ni message : juste des cadres gris
 * qu'on prend pour une panne de l'API. C'est exactement ce qui est arrivé.
 */
test('les hôtes d\'images des lecteurs sont autorisés', async () => {
  const s = await lancer();
  try {
    const img = directive(await politique(s.port), 'img-src');
    for (const hote of [
      'https://*.scdn.co',            // pochettes Spotify
      'https://static-cdn.jtvnw.net', // vignettes et jaquettes Twitch
      'https://*.ytimg.com',          // vignettes de vidéos YouTube
      'https://yt3.ggpht.com',        // AVATARS de chaîne YouTube — l'oubli qui laissait des ronds gris
    ]) {
      assert.ok(img.includes(hote), `${hote} manque : les vignettes resteraient vides`);
    }
    assert.ok(img.includes("'self'") && img.includes('data:'));
  } finally { await s.arreter(); }
});

/** Les cinq lecteurs en cadre, nommément — pas de joker. */
test('les cadres des lecteurs sont nommés un par un', async () => {
  const s = await lancer();
  try {
    const frame = directive(await politique(s.port), 'frame-src');
    for (const hote of ['https://open.spotify.com', 'https://www.youtube.com',
      'https://www.youtube-nocookie.com', 'https://player.twitch.tv']) {
      assert.ok(frame.includes(hote), `${hote} manque : le cadre resterait vide`);
    }
    assert.ok(!frame.includes('*'), 'aucun joker : un cadre est une porte nommée');
  } finally { await s.arreter(); }
});
