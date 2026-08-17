// SPOTIFY PKCE : le secret jetable, et les refus traduits.
//
// Le flux « code d'autorisation » ordinaire exige un `client_secret`, qu'il
// faudrait stocker et protéger. PKCE le remplace par un secret fabriqué à
// chaque connexion : l'application envoie l'EMPREINTE d'une chaîne aléatoire,
// puis prouve son identité en révélant la chaîne. Un code intercepté ne sert
// donc à rien sans elle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  fabriquerDefi, urlAutorisation, echangerCode, rafraichir, estExpire,
  appeler, resumeLecture, PORTEES,
} from '../src/spotify.js';

test('le défi est bien l\'empreinte du vérificateur', () => {
  const { verificateur, defi } = fabriquerDefi();
  const attendu = createHash('sha256').update(verificateur).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(defi, attendu, 'Spotify recalcule cette empreinte : elle doit correspondre');
  assert.ok(verificateur.length >= 43, 'PKCE exige au moins 43 caractères');
  assert.ok(!/[+/=]/.test(defi), 'base64 URL-safe : ni +, ni /, ni =');
});

test('deux connexions ne partagent jamais le même vérificateur', () => {
  assert.notEqual(fabriquerDefi().verificateur, fabriquerDefi().verificateur);
});

/** Aucun secret ne doit apparaître dans l'URL d'autorisation. */
test('l\'URL d\'autorisation ne porte que des valeurs publiques', () => {
  const u = new URL(urlAutorisation({
    clientId: 'abc123', redirection: 'http://127.0.0.1:3000/spotify/retour',
    defi: 'DEFI', etat: 'xyz',
  }));
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('code_challenge'), 'DEFI');
  assert.equal(u.searchParams.get('client_id'), 'abc123');
  assert.ok(!u.search.includes('secret'), 'aucun secret ne circule');
  assert.ok(!u.search.includes('code_verifier'),
    'le vérificateur ne part PAS à cette étape : c\'est tout le principe de PKCE');
});

/** On ne demande que ce qu'on sait justifier. */
test('les portées demandées restent minimales', () => {
  assert.ok(!PORTEES.includes('user-read-email'), 'on n\'a rien à faire de son adresse');
  assert.ok(!PORTEES.includes('playlist-modify'), 'on ne modifie aucune playlist');
  assert.ok(PORTEES.includes('user-modify-playback-state'));
});

test('l\'échange envoie le vérificateur, jamais un secret', async () => {
  let corpsEnvoye = null;
  const faux = async (url, o) => {
    corpsEnvoye = o.body;
    return {
      ok: true, status: 200,
      json: async () => ({ access_token: 'A', refresh_token: 'R', expires_in: 3600 }),
    };
  };
  const j = await echangerCode({
    clientId: 'c', redirection: 'r', code: 'CODE', verificateur: 'VERIF',
  }, faux);

  assert.equal(corpsEnvoye.get('code_verifier'), 'VERIF');
  assert.ok(!corpsEnvoye.has('client_secret'));
  assert.equal(j.acces, 'A');
  assert.equal(j.refresh, 'R');
  assert.ok(j.expireLe > Date.now(), 'la date d\'expiration doit être future');
});

/**
 * MARGE SUR L'EXPIRATION. Un jeton qui expire pendant le trajet de la requête
 * produit un 401 qu'on aurait pu éviter : on le considère mort une minute
 * avant l'heure.
 */
test('un jeton est considéré expiré avec une minute d\'avance', async () => {
  const faux = async () => ({
    ok: true, status: 200,
    json: async () => ({ access_token: 'A', expires_in: 3600 }),
  });
  const j = await echangerCode({ clientId: 'c', redirection: 'r', code: 'x', verificateur: 'v' }, faux);
  assert.ok(j.expireLe <= Date.now() + 3600 * 1000 - 59000);
  assert.ok(!estExpire(j));
  assert.ok(estExpire({ acces: 'A', expireLe: Date.now() - 1 }));
  assert.ok(estExpire(null));
});

/** Spotify ne renvoie pas toujours un nouveau jeton de rafraîchissement. */
test('le rafraîchissement garde l\'ancien jeton si aucun n\'est renvoyé', async () => {
  const faux = async () => ({
    ok: true, status: 200,
    json: async () => ({ access_token: 'NOUVEAU', expires_in: 3600 }),
  });
  const j = await rafraichir({ clientId: 'c', refresh: 'ANCIEN' }, faux);
  assert.equal(j.acces, 'NOUVEAU');
  assert.equal(j.refresh, 'ANCIEN', 'sans lui, la session serait perdue au bout d\'une heure');
});

/**
 * LES REFUS DE SPOTIFY NE VEULENT RIEN DIRE POUR QUI LES REÇOIT.
 * 403 = « il faut Premium », 404 = « aucun appareil actif ». Les laisser
 * passer bruts afficherait un code HTTP à quelqu'un qui voulait de la musique.
 */
test('les refus de Spotify sont traduits en français', async () => {
  const code = (n) => async () => ({ status: n, ok: false, json: async () => ({}) });

  await assert.rejects(() => appeler('/x', { acces: 'a' }, code(403)), /Premium/);
  await assert.rejects(() => appeler('/x', { acces: 'a' }, code(404)), /appareil actif/);
  await assert.rejects(() => appeler('/x', { acces: 'a' }, code(401)), (e) => e.expire === true);
});

/** 204 : « rien ne joue ». C'est une réponse normale, pas une panne. */
test('« rien ne joue » n\'est pas une erreur', async () => {
  const vide = async () => ({ status: 204, ok: true });
  assert.equal(await appeler('/me/player', { acces: 'a' }, vide), null);
  assert.deepEqual(resumeLecture(null), { joue: false });
});

test('le résumé de lecture garde l\'essentiel', () => {
  const r = resumeLecture({
    is_playing: true,
    progress_ms: 30000,
    device: { name: 'Portable' },
    item: {
      name: 'Titre', duration_ms: 200000, uri: 'spotify:track:x',
      artists: [{ name: 'A' }, { name: 'B' }],
      album: { name: 'Album', images: [{ url: 'http://p' }] },
    },
  });
  assert.equal(r.joue, true);
  assert.equal(r.artistes, 'A, B');
  assert.equal(r.pochette, 'http://p');
  assert.equal(r.appareil, 'Portable');
});
