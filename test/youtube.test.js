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
import { populaires, chercher, dureeIso, COUT } from '../src/youtube.js';

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
