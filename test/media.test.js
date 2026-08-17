// RECONNAISSANCE DES LIENS DE LECTEUR.
//
// Un lien mal reconnu ne lève rien : il ouvre un cadre vide, ou pas de cadre
// du tout. Ces tests couvrent les formes réellement collées — le lien long,
// le lien court, le lien de partage avec ses paramètres de suivi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versLecteur } from '../public/media.js';

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
