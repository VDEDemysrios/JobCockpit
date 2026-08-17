// TWITCH : le code d'appareil, et les vignettes qui n'en sont pas.
//
// POURQUOI CE FLUX, APRÈS DEUX AUTRES
// -----------------------------------
// Twitch ne connaît pas PKCE. Le flux « code d'autorisation » exige un
// secret ; le flux implicite exige une URL de redirection, et **le formulaire
// de Twitch refuse toute adresse en `http://`** — ce qui condamne une
// application servie en local, sauf à monter du HTTPS avec un certificat
// auto-signé. Reste le code d'appareil, qui ne demande AUCUNE redirection.
//
// Trois choses se dégradent ici sans rien signaler, et ces tests les tiennent :
// une portée demandée en trop ne se voit que sur l'écran de consentement, une
// fois, chez l'utilisateur ; « en attente » pris pour une erreur ferait
// clignoter un échec pendant toute la connexion ; et une vignette dont les
// gabarits ne sont pas remplacés donne un 404 silencieux.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  demanderCode, reclamerJeton, rafraichirJeton, estExpire,
  validerJeton, appeler, resumeDirects, resumeSuivies, resumeRecherche, PORTEES,
  dimensionner, resumeCategories, resumeChaines, resumeVideos,
} from '../src/twitch.js';

/** Une réponse HTTP factice, réduite à ce que le module en lit. */
const reponse = (statut, corps) => async (url, o) => ({
  ok: statut >= 200 && statut < 300,
  status: statut,
  json: async () => corps,
  _url: url, _options: o,
});

/**
 * AUCUNE URL DE REDIRECTION NE DOIT PARTIR. C'est la raison d'être de ce flux :
 * le formulaire de Twitch refuse `http://`, et l'application est servie en
 * local. Une redirection qui se glisserait dans la demande ramènerait le
 * problème par la fenêtre.
 */
test('la demande de code ne porte ni secret ni redirection', async () => {
  let corps = null;
  const faux = async (url, o) => {
    corps = o.body;
    assert.equal(url, 'https://id.twitch.tv/oauth2/device');
    assert.equal(o.method, 'POST');
    return { ok: true, status: 200, json: async () => ({
      user_code: 'ABCD1234', device_code: 'dev-xyz',
      verification_uri: 'https://www.twitch.tv/activate',
      expires_in: 1800, interval: 5 }) };
  };
  const d = await demanderCode({ clientId: 'abc123' }, faux);

  assert.equal(corps.get('client_id'), 'abc123');
  assert.equal(corps.get('scopes'), PORTEES);
  assert.ok(!corps.has('client_secret'), 'aucun secret ne circule');
  assert.ok(!corps.has('redirect_uri'), 'aucune redirection : c\'est tout l\'intérêt');

  assert.equal(d.code, 'ABCD1234');
  assert.equal(d.appareil, 'dev-xyz', 'le device_code reste côté serveur');
  assert.ok(d.expireLe > Date.now());
});

/** La cadence vient de Twitch, et jamais en dessous de cinq secondes :
 *  interroger plus vite fait répondre `slow_down`. */
test('la cadence d\'interrogation a un plancher', async () => {
  const d = await demanderCode({ clientId: 'c' }, reponse(200, {
    user_code: 'A', device_code: 'd', interval: 1, expires_in: 1800 }));
  assert.ok(d.cadence >= 5000, `cadence de ${d.cadence} ms : Twitch répondrait slow_down`);
});

/**
 * « EN ATTENTE » N'EST PAS UNE ERREUR.
 *
 * C'est la réponse normale pendant tout le temps où l'utilisateur tape son
 * code, c'est-à-dire la quasi-totalité des appels. Traitée comme une panne,
 * elle ferait clignoter un message d'échec dix fois par minute sur un
 * déroulement parfaitement ordinaire.
 */
test('l\'attente rend null, elle ne lève pas', async () => {
  for (const message of ['authorization_pending', 'authorization pending', 'slow_down']) {
    const r = await reclamerJeton({ clientId: 'c', appareil: 'd' },
      reponse(400, { message }));
    assert.equal(r, null, `« ${message} » doit être lu comme une attente`);
  }
});

test('un code expiré est signalé, pas confondu avec une attente', async () => {
  await assert.rejects(
    () => reclamerJeton({ clientId: 'c', appareil: 'd' },
      reponse(400, { message: 'invalid device code: expired' })),
    /expiré/);
});

/**
 * LE JETON DE RAFRAÎCHISSEMENT EST LE VRAI GAIN DE CE FLUX. Le flux implicite
 * n'en donnait pas : la liaison mourait au bout d'une soixantaine de jours,
 * sans prévenir, et il fallait tout refaire.
 */
test('la réclamation aboutie rend un jeton renouvelable', async () => {
  let corps = null;
  const faux = async (url, o) => {
    corps = o.body;
    return { ok: true, status: 200, json: async () => ({
      access_token: 'A', refresh_token: 'R', expires_in: 14400 }) };
  };
  const j = await reclamerJeton({ clientId: 'c', appareil: 'dev-xyz' }, faux);

  assert.equal(corps.get('grant_type'), 'urn:ietf:params:oauth:grant-type:device_code');
  assert.equal(corps.get('device_code'), 'dev-xyz');
  assert.ok(!corps.has('client_secret'));
  assert.equal(j.acces, 'A');
  assert.equal(j.refresh, 'R', 'sans lui la liaison mourrait toute seule');
  assert.ok(j.expireLe > Date.now());
});

/** Twitch ne renvoie pas toujours un nouveau jeton de rafraîchissement. */
test('le renouvellement garde l\'ancien jeton si aucun n\'est renvoyé', async () => {
  const j = await rafraichirJeton({ clientId: 'c', refresh: 'ANCIEN' },
    reponse(200, { access_token: 'NEUF', expires_in: 14400 }));
  assert.equal(j.acces, 'NEUF');
  assert.equal(j.refresh, 'ANCIEN');
});

/** Une minute de marge : un jeton qui meurt en cours de requête donne un 401
 *  qu'on aurait pu éviter. */
test('un jeton est considéré expiré avec une minute d\'avance', async () => {
  const j = await rafraichirJeton({ clientId: 'c', refresh: 'R' },
    reponse(200, { access_token: 'A', expires_in: 3600 }));
  assert.ok(j.expireLe <= Date.now() + 3600 * 1000 - 59000);
  assert.ok(!estExpire(j));
  assert.ok(estExpire({ acces: 'A', expireLe: Date.now() - 1 }));
  assert.ok(estExpire(null));
});

/** On ne demande que ce qu'on sait justifier. */
test('une seule portée est demandée, et c\'est la lecture des suivis', () => {
  assert.equal(PORTEES, 'user:read:follows');
  for (const trop of ['chat:', 'channel:manage', 'user:read:email', 'moderator:']) {
    assert.ok(!PORTEES.includes(trop), `« ${trop} » n'a rien à faire là`);
  }
});

/**
 * UN JETON RÉVOQUÉ DOIT SE DIRE TOUT DE SUITE. Rien ne nous prévient qu'un
 * accès a été retiré depuis le compte Twitch : sans validation, l'interface
 * annoncerait « compte lié » jusqu'au premier appel en échec, c'est-à-dire au
 * moment précis où l'on veut s'en servir.
 */
test('un jeton refusé rend null plutôt que de lever', async () => {
  assert.equal(await validerJeton('mort', reponse(401, {})), null);

  const v = await validerJeton('vif', reponse(200, {
    user_id: '42', login: 'quelqu_un', scopes: ['user:read:follows'] }));
  assert.equal(v.login, 'quelqu_un');
  assert.equal(v.id, '42');
});

/**
 * TWITCH EXIGE DEUX EN-TÊTES, PAS UN. Oublier le Client ID donne un 401
 * identique à celui d'un jeton périmé — on croit alors à une session expirée
 * et on refait la connexion pour rien.
 */
test('chaque appel porte le jeton ET le Client ID', async () => {
  let vus = null;
  const faux = async (url, o) => { vus = o.headers; return { ok: true, status: 200, json: async () => ({}) }; };
  await appeler('/users', { acces: 'JETON', clientId: 'CLI' }, faux);
  assert.equal(vus.Authorization, 'Bearer JETON');
  assert.equal(vus['Client-Id'], 'CLI');
});

test('un 401 est signalé comme une expiration, pas comme une panne', async () => {
  await assert.rejects(() => appeler('/users', { acces: 'a', clientId: 'c' }, reponse(401, {})),
    (e) => e.expire === true);
});

/**
 * LE PIÈGE DES VIGNETTES.
 *
 * `thumbnail_url` arrive avec les gabarits `{width}` et `{height}` LITTÉRAUX
 * dans l'adresse. Servie telle quelle, l'image est un 404 — et une liste de
 * cadres gris ne dit pas pourquoi.
 */
test('les gabarits de taille sont remplacés dans les vignettes', () => {
  const d = resumeDirects({ data: [{
    user_login: 'chaine', user_name: 'Chaîne', title: 'Un titre', game_name: 'Un jeu',
    viewer_count: 1234, started_at: '2026-08-17T10:00:00Z',
    thumbnail_url: 'https://static-cdn.jtvnw.net/x-{width}x{height}.jpg',
  }] });
  assert.ok(!d[0].vignette.includes('{width}'), 'un gabarit non remplacé donne un 404');
  assert.ok(!d[0].vignette.includes('{height}'));
  assert.match(d[0].vignette, /320x180/);
  assert.equal(d[0].spectateurs, 1234);
  assert.equal(d[0].login, 'chaine');
});

/** Une réponse vide est le cas normal : personne n'émet en permanence. */
test('aucun direct n\'est un état ordinaire', () => {
  assert.deepEqual(resumeDirects(null), []);
  assert.deepEqual(resumeDirects({ data: [] }), []);
  assert.deepEqual(resumeSuivies(null), []);
  assert.deepEqual(resumeRecherche(null), []);
});

test('la recherche distingue le direct de la vitrine', () => {
  const r = resumeRecherche({ data: [
    { broadcaster_login: 'a', display_name: 'A', is_live: true, game_name: 'J' },
    { broadcaster_login: 'b', display_name: 'B', is_live: false },
  ] });
  assert.equal(r[0].enDirect, true);
  assert.equal(r[1].enDirect, false);
  assert.equal(r[1].jeu, '', 'un champ absent vaut vide, jamais undefined dans le balisage');
});

/**
 * LES DEUX ÉCRITURES DU GABARIT, ET CELLE QU'ON AVAIT MANQUÉE.
 *
 * Les directs et les jaquettes écrivent `{width}` ; les rediffusions écrivent
 * `%{width}`. Ne traiter que la première laissait toutes les rediffusions sans
 * image — ce qui ressemble à une panne de l'onglet, pas à une histoire de
 * signe pour cent.
 */
test('les deux écritures du gabarit de taille sont remplacées', () => {
  assert.equal(dimensionner('a-{width}x{height}.jpg', 320, 180), 'a-320x180.jpg');
  assert.equal(dimensionner('a-%{width}x%{height}.jpg', 320, 180), 'a-320x180.jpg');
  assert.equal(dimensionner(null, 1, 2), '', 'une adresse absente ne devient pas « null »');

  const v = resumeVideos({ data: [{
    id: '123', title: 'Rediff', duration: '3h20m10s', view_count: 42,
    thumbnail_url: 'https://x/%{width}x%{height}.jpg',
  }] });
  assert.ok(!v[0].vignette.includes('%'), 'le gabarit des rediffusions est le piège');
  assert.match(v[0].vignette, /320x180/);
  assert.equal(v[0].id, '123');
});

/** Une catégorie sans jaquette lisible ne se distingue plus des autres. */
test('les catégories rendent une jaquette utilisable', () => {
  const c = resumeCategories({ data: [
    { id: '509658', name: 'Just Chatting', box_art_url: 'https://x/{width}x{height}.jpg' },
  ] });
  assert.equal(c[0].id, '509658');
  assert.equal(c[0].nom, 'Just Chatting');
  assert.ok(!c[0].jaquette.includes('{'));
  assert.deepEqual(resumeCategories(null), []);
});

/** La page d'une chaîne a besoin de son identifiant : `/videos` refuse un pseudo. */
test('une chaîne rend l\'identifiant que réclame /videos', () => {
  const u = resumeChaines({ data: [{
    id: '4242', login: 'chaine', display_name: 'Chaîne',
    profile_image_url: 'https://x/a.png', description: 'Bonjour',
  }] });
  assert.equal(u[0].id, '4242');
  assert.equal(u[0].login, 'chaine');
  assert.equal(u[0].avatar, 'https://x/a.png');
  assert.deepEqual(resumeChaines(null), []);
});
