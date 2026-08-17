// RECONNAISSANCE DES LIENS DE LECTEUR.
//
// Un lien mal reconnu ne lève rien : il ouvre un cadre vide, ou pas de cadre
// du tout. Ces tests couvrent les formes réellement collées — le lien long,
// le lien court, le lien de partage avec ses paramètres de suivi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versLecteur, sansDemarrageAuto, destinationTwitch } from '../public/media.js';

test('Spotify : toutes les formes mènent au lecteur intégré', () => {
  for (const entree of [
    'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc123',
    'https://open.spotify.com/intl-fr/track/4cOdK2wGLETKBW3PvgPWqT',
    'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
  ]) {
    const r = versLecteur(entree);
    assert.equal(r?.type, 'Spotify', `non reconnu : ${entree}`);
    assert.equal(r.url, 'https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT');
  }
  assert.equal(versLecteur('https://open.spotify.com/playlist/37i9dQZF1DX0XUsuxWHRQd')?.url,
    'https://open.spotify.com/embed/playlist/37i9dQZF1DX0XUsuxWHRQd');
});

/** `-nocookie` : pas de raison de laisser un traceur pour écouter un morceau. */
test('YouTube passe par le domaine sans traceur', () => {
  for (const entree of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
  ]) {
    const r = versLecteur(entree);
    assert.equal(r?.type, 'YouTube', `non reconnu : ${entree}`);
    assert.match(r.url, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  }
});

/**
 * Twitch REFUSE de s'afficher sans `parent` correspondant à la page hôte.
 * L'oublier donne un lecteur noir, sans message : c'est le piège de ce
 * lecteur-là.
 */
test('Twitch reçoit le parent attendu', () => {
  const r = versLecteur('https://www.twitch.tv/zerator', 'localhost');
  assert.equal(r?.type, 'Twitch');
  assert.match(r.url, /channel=zerator/);
  assert.match(r.url, /parent=localhost/);

  const vod = versLecteur('https://www.twitch.tv/videos/123456789', 'localhost');
  assert.match(vod.url, /video=123456789/);
  assert.match(vod.url, /parent=localhost/);
});

/** Un nom seul : c'est presque toujours une chaîne Twitch. */
test('un nom seul est traité comme une chaîne Twitch', () => {
  const r = versLecteur('zerator', 'localhost');
  assert.equal(r?.type, 'Twitch');
  assert.match(r.url, /channel=zerator/);
});

test('ce qui n\'est pas reconnu rend null, sans lever', () => {
  for (const entree of ['', null, undefined, '   ', 'https://example.com/x',
    'une phrase avec des espaces']) {
    assert.equal(versLecteur(entree), null);
  }
});

/**
 * LE DOMAINE YOUTUBE EST UN CHOIX.
 *
 * `youtube-nocookie.com` n'installe pas de traceur, mais n'emporte pas la
 * session : pas d'abonnements, et une vidéo réservée aux connectés reste
 * noire. Le compromis appartient à qui regarde — d'où la bascule.
 */
test('YouTube bascule entre domaine sobre et session du compte', () => {
  const lien = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

  const sobre = versLecteur(lien, 'localhost', false);
  assert.match(sobre.url, /youtube-nocookie\.com/,
    'par défaut on protège : rien ne doit suivre l\'utilisateur');

  const connecte = versLecteur(lien, 'localhost', true);
  assert.match(connecte.url, /^https:\/\/www\.youtube\.com\/embed\//,
    'demandé explicitement, on passe par le domaine qui porte la session');
  assert.ok(!connecte.url.includes('nocookie'));
});

/**
 * ROUVRIR L'APPLICATION NE DOIT RIEN LANCER.
 *
 * Le lecteur flottant se rouvre là où on l'avait laissé, avec son lien. Si ce
 * lien porte encore le `autoplay=true` posé par un clic sur un direct, un
 * flux se met à parler tout seul au premier chargement de la page — dans le
 * dos de quelqu'un qui vient d'arriver au bureau, et sans qu'on sache d'où
 * vient le son.
 */
test('le démarrage automatique est retiré à la réouverture', () => {
  const direct = 'https://player.twitch.tv/?channel=x&parent=localhost&autoplay=true';
  assert.match(sansDemarrageAuto(direct), /autoplay=false/);
  assert.ok(!sansDemarrageAuto(direct).includes('autoplay=true'));

  // La forme numérique existe aussi chez YouTube : la manquer laisserait
  // exactement le défaut qu'on cherche à empêcher.
  assert.match(sansDemarrageAuto('https://x/embed/v?autoplay=1&mute=0'), /autoplay=false/);

  // Ce qui est déjà à l'arrêt ne bouge pas, et un lien sans le paramètre non
  // plus — la fonction ne doit rien inventer.
  const calme = 'https://player.twitch.tv/?channel=x&parent=localhost&autoplay=false';
  assert.equal(sansDemarrageAuto(calme), calme);
  assert.equal(sansDemarrageAuto('https://open.spotify.com/embed/track/x'),
    'https://open.spotify.com/embed/track/x');
  assert.equal(sansDemarrageAuto(null), '');
});

/** Les deux domaines doivent rester couverts par la politique de sécurité. */
test('les deux domaines YouTube sont ceux autorisés par la CSP', () => {
  const AUTORISES = [
    'https://open.spotify.com', 'https://www.youtube-nocookie.com',
    'https://www.youtube.com', 'https://player.twitch.tv', 'https://embed.twitch.tv',
  ];
  for (const [entree, compte] of [
    ['https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT', false],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', false],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', true],
    ['https://www.twitch.tv/zerator', false],
  ]) {
    const r = versLecteur(entree, 'localhost', compte);
    const origine = new URL(r.url).origin;
    assert.ok(AUTORISES.includes(origine),
      `${origine} n'est pas dans frame-src : le cadre resterait vide`);
  }
});

/**
 * UN LIEN TWITCH DÉSIGNE AUTRE CHOSE QU'UN FLUX À LIRE.
 *
 * `versLecteur` sait faire une seule chose d'une adresse Twitch : la mettre
 * dans le lecteur. C'est juste pour un direct, et faux pour tout le reste —
 * `twitch.tv/xqc/videos` finissait en « regarder xqc en direct » alors qu'on
 * demandait ses rediffusions, et `directory/game/Chess` en lecture d'une
 * chaîne nommée « directory ». Chaque fois, la seule issue restait le site.
 */
test('une adresse Twitch dit ce qu\'elle désigne', () => {
  assert.deepEqual(destinationTwitch('https://www.twitch.tv/videos/123456789'),
    { type: 'video', id: '123456789' });

  for (const u of ['https://twitch.tv/xqc', 'https://www.twitch.tv/XQC/videos',
    'https://www.twitch.tv/xqc/about', 'twitch.tv/xqc?tt_content=x']) {
    assert.deepEqual(destinationTwitch(u), { type: 'chaine', login: 'xqc' }, u);
  }

  assert.deepEqual(destinationTwitch('https://www.twitch.tv/directory/game/Just%20Chatting'),
    { type: 'categorie', nom: 'Just Chatting' });
  assert.equal(destinationTwitch('https://www.twitch.tv/directory')?.type, 'accueil');
});

/**
 * Les sections du site ne sont pas des chaînes. Sans cette réserve,
 * `twitch.tv/settings` ouvrait la page d'une chaîne « settings » qui n'existe
 * pas — un écran vide sur un lien parfaitement valide.
 */
test('les sections du site ne sont pas prises pour des chaînes', () => {
  for (const u of ['https://www.twitch.tv/settings/profile',
    'https://www.twitch.tv/downloads', 'https://www.twitch.tv/directory/all']) {
    const d = destinationTwitch(u);
    assert.notEqual(d?.type, 'chaine', u);
  }
  assert.equal(destinationTwitch('https://youtube.com/watch?v=abc'), null,
    'ce routeur ne s\'occupe que de Twitch');
  assert.equal(destinationTwitch(''), null);
});
