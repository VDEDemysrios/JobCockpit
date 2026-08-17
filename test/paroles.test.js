// LES PAROLES SYNCHRONISÉES.
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Une erreur d'horodatage ne plante pas : elle décale la ligne surlignée. On
// croit que « les paroles sont mal synchronisées chez eux », on ne cherche
// pas, et la fonction la plus agréable du lecteur passe pour approximative.
//
// Deux pièges précis sont couverts ici, parce qu'ils sont invisibles :
//   · les centièmes s'écrivent sur DEUX chiffres et les millièmes sur trois —
//     lire « .31 » comme 31 ms au lieu de 310 décale tout d'un tiers de
//     seconde, ce qui se voit à l'œil ;
//   · une même ligne peut porter PLUSIEURS horodatages, parce qu'un refrain
//     n'est écrit qu'une fois. Les ignorer fait disparaître le refrain de
//     toute la seconde moitié du morceau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyserLrc, ligneCourante, choisir, resumeParoles, chercherParoles,
} from '../src/paroles.js';

test('un horodatage est lu à la milliseconde', () => {
  const l = analyserLrc('[00:26.31] Première\n[01:05.7] Deuxième\n[02:00.123] Troisième');
  assert.equal(l[0].t, 26310, '« .31 » vaut 310 ms, pas 31');
  assert.equal(l[1].t, 65700, '« .7 » vaut 700 ms');
  assert.equal(l[2].t, 120123, '« .123 » vaut bien 123 ms');
  assert.equal(l[0].texte, 'Première');
});

/** Un refrain n'est écrit qu'une fois, avec tous ses passages. */
test('une ligne à plusieurs horodatages revient à chaque fois', () => {
  const l = analyserLrc('[00:30.00][01:30.00][02:30.00] Le refrain');
  assert.equal(l.length, 3, 'le refrain doit apparaître trois fois');
  assert.deepEqual(l.map(x => x.t), [30000, 90000, 150000]);
  assert.ok(l.every(x => x.texte === 'Le refrain'));
});

/** Les en-têtes du format ne sont pas des paroles. */
test('les métadonnées du fichier sont écartées', () => {
  const l = analyserLrc('[ar:Un artiste]\n[by:quelqu\'un]\n[00:10.00] La vraie ligne');
  assert.equal(l.length, 1);
  assert.equal(l[0].texte, 'La vraie ligne');
});

test('les lignes ressortent triées, quel que soit l\'ordre du fichier', () => {
  const l = analyserLrc('[02:00.00] Fin\n[00:10.00] Début\n[01:00.00] Milieu');
  assert.deepEqual(l.map(x => x.texte), ['Début', 'Milieu', 'Fin']);
});

test('un fichier vide ou absent ne lève pas', () => {
  for (const x of ['', null, undefined, 'pas du tout du LRC']) {
    assert.deepEqual(analyserLrc(x), []);
  }
});

/**
 * LA LIGNE COURANTE EST CHERCHÉE PAR DICHOTOMIE. Sur un morceau de dix
 * minutes on l'appelle quatre fois par seconde : parcourir deux cents lignes
 * à chaque fois pour une réponse qui bouge rarement est du gaspillage.
 */
test('la ligne courante est celle dont l\'heure vient de passer', () => {
  const l = analyserLrc('[00:10.00] A\n[00:20.00] B\n[00:30.00] C');
  assert.equal(ligneCourante(l, 0), -1, 'avant la première, aucune ligne');
  assert.equal(ligneCourante(l, 9999), -1);
  assert.equal(ligneCourante(l, 10000), 0, 'pile à l\'heure, la ligne est active');
  assert.equal(ligneCourante(l, 19999), 0);
  assert.equal(ligneCourante(l, 20000), 1);
  assert.equal(ligneCourante(l, 999999), 2, 'après la dernière, on y reste');
  assert.equal(ligneCourante([], 5000), -1);
});

/**
 * LA DURÉE TRANCHE MIEUX QUE LE TITRE. Deux versions d'un morceau portent le
 * même nom ; c'est la longueur qui distingue l'édition radio de l'originale.
 */
test('le meilleur candidat est celui dont la durée colle', () => {
  const c = choisir([
    { trackName: 'Titre', artistName: 'Artiste', duration: 200, plainLyrics: 'radio' },
    { trackName: 'Titre', artistName: 'Artiste', duration: 337, syncedLyrics: '[00:01.00] vrai' },
  ], { titre: 'Titre', artiste: 'Artiste', duree: 337000 });
  assert.match(c.syncedLyrics, /vrai/);
});

/** À qualité égale, la version synchronisée l'emporte. */
test('le synchronisé prime sur le texte plat', () => {
  const c = choisir([
    { trackName: 'Titre', artistName: 'Artiste', duration: 300, plainLyrics: 'plat' },
    { trackName: 'Titre', artistName: 'Artiste', duration: 300, syncedLyrics: '[00:01.00] synchro' },
  ], { titre: 'Titre', artiste: 'Artiste', duree: 300000 });
  assert.ok(c.syncedLyrics);
});

/**
 * AFFICHER LES PAROLES D'UN AUTRE MORCEAU EST PIRE QUE DE N'EN AFFICHER
 * AUCUNE : on ne cherche pas d'où vient l'erreur, on conclut que la fonction
 * ne marche pas.
 */
test('un candidat trop éloigné est refusé', () => {
  const c = choisir([
    { trackName: 'Tout autre chose', artistName: 'Quelqu\'un d\'autre',
      duration: 90, plainLyrics: 'non' },
  ], { titre: 'Titre', artiste: 'Artiste', duree: 337000 });
  assert.equal(c, null);
  assert.equal(choisir([], { titre: 'T', artiste: 'A' }), null);
});

/** Un morceau sans paroles n'est pas un échec de recherche. */
test('l\'instrumental est un résultat, pas une absence', () => {
  const r = resumeParoles({ instrumental: true });
  assert.equal(r.trouve, true);
  assert.equal(r.instrumental, true);
  assert.deepEqual(r.lignes, []);
});

test('le résumé distingue le synchronisé du texte plat', () => {
  const synchro = resumeParoles({ syncedLyrics: '[00:05.00] Une ligne', plainLyrics: 'Une ligne',
    artistName: 'A', trackName: 'T' });
  assert.equal(synchro.synchro, true);
  assert.equal(synchro.lignes.length, 1);
  assert.equal(synchro.source, 'A — T');

  const plat = resumeParoles({ plainLyrics: 'Une ligne\nUne autre' });
  assert.equal(plat.synchro, false);
  assert.equal(plat.trouve, true);
  assert.match(plat.texte, /Une autre/);

  assert.equal(resumeParoles(null).trouve, false);
});

/**
 * LE REPLI COMPTE AUTANT QUE LA RECHERCHE EXACTE. Spotify sert « Album
 * (Deluxe Edition) » là où la base a « Album », et les durées diffèrent d'une
 * seconde d'une édition à l'autre : sans seconde tentative, la moitié des
 * morceaux n'auraient « pas de paroles » alors qu'elles existent.
 */
test('une correspondance exacte ratée passe par la recherche', async () => {
  const appels = [];
  const faux = async (url) => {
    appels.push(url);
    if (url.includes('/get?')) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ([
      { trackName: 'Titre', artistName: 'Artiste', duration: 200,
        syncedLyrics: '[00:01.00] trouvé' },
    ]) };
  };
  const d = await chercherParoles({ titre: 'Titre', artistes: 'Artiste, Autre',
    album: 'Album (Deluxe)', duree: 200000 }, faux);

  assert.ok(appels[0].includes('/get?'), 'la correspondance exacte est tentée en premier');
  assert.ok(appels[1].includes('/search?'), 'puis la recherche');
  assert.match(d.syncedLyrics, /trouvé/);
  assert.ok(appels[0].includes('Artiste'), 'seul le premier artiste sert de clé');
  assert.ok(!appels[0].includes('Autre'), 'la liste entière ne trouverait rien');
});

test('sans titre ni artiste, on n\'appelle personne', async () => {
  let appele = false;
  const faux = async () => { appele = true; return { ok: true, json: async () => ({}) }; };
  assert.equal(await chercherParoles({ titre: '', artistes: '' }, faux), null);
  assert.equal(appele, false);
});

/** Le service peut être injoignable : ce n'est pas une raison de casser le
 *  lecteur. Une absence de paroles est un état normal. */
test('un service muet rend null plutôt que de lever', async () => {
  const casse = async () => { throw new Error('réseau'); };
  assert.equal(await chercherParoles({ titre: 'T', artistes: 'A' }, casse), null);
});
