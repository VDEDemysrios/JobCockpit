// YOUTUBE : la navigation, puisque le cadre ne la permet pas.
//
// POURQUOI CE MODULE EXISTE — ET CE QUE CE FICHIER VERROUILLE
// -----------------------------------------------------------
// `youtube.com` répond `X-Frame-Options: SAMEORIGIN` sur son accueil, ses
// résultats de recherche et son interface téléviseur : rien de tout cela ne
// s'affiche dans un cadre, et aucun réglage de notre côté n'y change quoi que
// ce soit. Seules les adresses `/embed/` sont acceptées, et elles ne montrent
// qu'une vidéo. La navigation se fait donc chez nous, par l'API officielle.
//
// Le piège qui ne se voit qu'à l'exécution : **l'identifiant d'une vidéo n'est
// pas au même endroit selon le point d'accès**. `/videos` le met à la racine,
// `/search` dans `id.videoId`. Se tromper donne une liste de vignettes
// parfaitement affichées, dont aucune ne lance quoi que ce soit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { populaires, chercher, chaine, abonnes, dureeIso, COUT } from '../src/youtube.js';

const reponse = (corps, statut = 200) => async (url) => ({
  ok: statut < 400, status: statut, json: async () => corps, _url: url,
});

test('l\'identifiant est lu au bon endroit selon le point d\'accès', async () => {
  const v = await populaires({ cle: 'K' }, reponse({ items: [
    { id: 'abc123', snippet: { title: 'T', channelTitle: 'C' } }] }));
  assert.equal(v[0].id, 'abc123', '/videos met l\'identifiant à la racine');

  const s = await chercher({ cle: 'K', requete: 'x' }, reponse({ items: [
    { id: { videoId: 'xyz789' }, snippet: { title: 'T', channelTitle: 'C' } }] }));
  assert.equal(s[0].id, 'xyz789', '/search le met dans id.videoId');
});

/** Une entrée sans identifiant ne peut rien lancer : elle ne doit pas s'afficher. */
test('les entrées sans identifiant sont écartées', async () => {
  const v = await chercher({ cle: 'K', requete: 'x' }, reponse({ items: [
    { id: { channelId: 'chaine' }, snippet: { title: 'Une chaîne' } },
    { id: { videoId: 'ok' }, snippet: { title: 'Une vidéo' } },
  ] }));
  assert.equal(v.length, 1);
  assert.equal(v[0].id, 'ok');
});

/**
 * L'ACCUEIL N'EST PAS UNE RECHERCHE À VIDE, et c'est une question de quota :
 * une recherche coûte cent unités sur les dix mille de la journée, les vidéos
 * populaires en coûtent une. Cent recherches par jour contre autant d'accueils
 * qu'on veut.
 */
test('l\'accueil demande les populaires, pas une recherche', async () => {
  let vue = '';
  await populaires({ cle: 'K', pays: 'BE' }, async (url) => {
    vue = url;
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  });
  assert.match(vue, /\/videos\?/, 'l\'accueil passe par /videos');
  assert.match(vue, /chart=mostPopular/);
  assert.match(vue, /regionCode=BE/);
  assert.ok(!vue.includes('/search'), 'une recherche coûterait cent fois plus');
  assert.ok(COUT.populaires < COUT.recherche);
});

/** La clé part en paramètre, jamais en en-tête : c'est ce qu'attend l'API. */
test('la clé accompagne chaque appel', async () => {
  let vue = '';
  await chercher({ cle: 'MACLE', requete: 'lofi' }, async (url) => {
    vue = url;
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  });
  assert.match(vue, /key=MACLE/);
  assert.match(vue, /q=lofi/);
  assert.match(vue, /type=video/, 'sans ça, on remonte aussi des chaînes injouables');
});

/**
 * LES DEUX REFUS QU'ON RENCONTRE VRAIMENT, et qui ne veulent rien dire bruts.
 * « quotaExceeded » arrive un soir de recherches intensives ; « keyInvalid »
 * arrive quand l'API n'a pas été activée sur le projet — l'oubli le plus
 * fréquent, et le message de Google ne le dit pas.
 */
test('les refus de l\'API sont traduits', async () => {
  await assert.rejects(
    () => populaires({ cle: 'K' }, reponse({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403)),
    /Quota YouTube épuisé/);

  await assert.rejects(
    () => populaires({ cle: 'K' }, reponse({ error: { errors: [{ reason: 'keyInvalid' }] } }, 400)),
    /YouTube Data API v3 » est activée/);
});

/**
 * La durée arrive au format ISO 8601. Servie telle quelle, elle s'affiche
 * « PT4M13S » sous la vignette, ce qui n'apprend rien à personne.
 */
test('la durée ISO devient des secondes', () => {
  assert.equal(dureeIso('PT4M13S'), 253);
  assert.equal(dureeIso('PT1H2M3S'), 3723);
  assert.equal(dureeIso('PT45S'), 45);
  assert.equal(dureeIso('P1DT2H'), 93600);
  assert.equal(dureeIso('bidon'), null);
  assert.equal(dureeIso(null), null);
  assert.equal(dureeIso('PT0S'), null, 'une durée nulle ne s\'affiche pas');
});

/** Une réponse vide est un état normal, pas une panne. */
test('aucune vidéo ne lève rien', async () => {
  assert.deepEqual(await populaires({ cle: 'K' }, reponse({})), []);
  assert.deepEqual(await chercher({ cle: 'K', requete: 'x' }, reponse({ items: [] })), []);
});

/**
 * LE NOM D'UNE CHAÎNE MÈNE À SA PAGE — À CONDITION D'AVOIR SON IDENTIFIANT.
 *
 * Le libellé seul ne sert à rien : deux chaînes peuvent le partager, et l'API
 * réclame l'identifiant. Chaque vignette doit donc porter `chaineId`, sinon le
 * nom cliquable ouvre le vide.
 */
test('chaque vignette porte l\'identifiant de sa chaîne', async () => {
  const v = await populaires({ cle: 'K' }, reponse({ items: [
    { id: 'v1', snippet: { title: 'T', channelTitle: 'Chaîne', channelId: 'UC_42' } }] }));
  assert.equal(v[0].chaineId, 'UC_42');
  assert.equal(v[0].chaine, 'Chaîne');
});

/**
 * UNE CHAÎNE ET SES VIDÉOS EN TROIS APPELS, ET L'ENCHAÎNEMENT COMPTE.
 *
 * `/channels` donne la playlist cachée « uploads » — le SEUL moyen d'atteindre
 * les vidéos d'une chaîne, il n'existe pas de « /channel/videos ».
 * `/playlistItems` en donne les identifiants mais NI durée NI vues.
 * `/videos` complète avec durée et vues, pour que les vignettes de la chaîne
 * soient identiques à celles de l'accueil.
 */
test('une chaîne enchaîne channels → playlistItems → videos', async () => {
  const appels = [];
  const faux = async (url) => {
    appels.push(url);
    if (url.includes('/channels')) {
      return { ok: true, status: 200, json: async () => ({ items: [{
        snippet: { title: 'La Chaîne', description: 'desc',
          thumbnails: { medium: { url: 'http://a' } } },
        statistics: { subscriberCount: '1500000' },
        contentDetails: { relatedPlaylists: { uploads: 'UU_xyz' } },
      }] }) };
    }
    if (url.includes('/playlistItems')) {
      return { ok: true, status: 200, json: async () => ({ items: [
        { contentDetails: { videoId: 'v1' } },
        { contentDetails: { videoId: 'v2' } }] }) };
    }
    return { ok: true, status: 200, json: async () => ({ items: [
      { id: 'v1', snippet: { title: 'Une', channelTitle: 'La Chaîne', channelId: 'UC1' },
        contentDetails: { duration: 'PT3M' }, statistics: { viewCount: '10' } },
      { id: 'v2', snippet: { title: 'Deux', channelTitle: 'La Chaîne', channelId: 'UC1' },
        contentDetails: { duration: 'PT5M' }, statistics: { viewCount: '20' } }] }) };
  };

  const { chaine: fiche, videos } = await chaine({ cle: 'K', id: 'UC1' }, faux);
  assert.equal(fiche.nom, 'La Chaîne');
  assert.equal(fiche.abonnes, 1500000);
  assert.equal(videos.length, 2);
  assert.equal(videos[0].id, 'v1');
  assert.equal(videos[0].secondes ?? null, null, 'la durée est ajoutée côté serveur, pas ici');

  assert.ok(appels[0].includes('/channels'), '1) la chaîne');
  assert.ok(appels[1].includes('/playlistItems'), '2) sa playlist « uploads »');
  assert.ok(appels[2].includes('/videos'), '3) les vidéos, pour durée et vues');
  assert.ok(appels[2].includes('v1%2Cv2') || appels[2].includes('v1,v2'),
    'les identifiants des vidéos partent groupés en un seul appel');
});

/** Une chaîne sans playlist « uploads » n'est pas une panne : elle n'a rien publié. */
test('une chaîne sans vidéos rend une liste vide, pas une erreur', async () => {
  const faux = async () => ({ ok: true, status: 200, json: async () => ({ items: [{
    snippet: { title: 'Vide' }, statistics: {}, contentDetails: {},
  }] }) });
  const d = await chaine({ cle: 'K', id: 'UCx' }, faux);
  assert.deepEqual(d.videos, []);
  assert.equal(d.chaine.nom, 'Vide');
});

/** Les abonnés cachés valent `null`, pas zéro : « 0 abonné » serait un mensonge. */
test('les abonnés cachés ne deviennent pas zéro', async () => {
  const faux = async () => ({ ok: true, status: 200, json: async () => ({ items: [{
    snippet: { title: 'X' },
    statistics: { hiddenSubscriberCount: true, subscriberCount: '0' },
    contentDetails: {},
  }] }) });
  const d = await chaine({ cle: 'K', id: 'UCy' }, faux);
  assert.equal(d.chaine.abonnes, null);
  assert.equal(abonnes(null), '', 'et le formatage d\'un compte absent ne rend rien');
  assert.equal(abonnes(1500000), '1.5 M abonnés');
});
