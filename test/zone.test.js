import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estDansZonePrioritaire } from '../scripts/collect.js';
import { villeDeRattachement } from '../src/zone.js';

const profil = JSON.parse(readFileSync(new URL('./fixtures/profil.json', import.meta.url), 'utf8'));
const VILLES = profil.villesPrioritaires;

const dansLaZone = (offre) => estDansZonePrioritaire(offre, VILLES);
const rattachee = (offre) => villeDeRattachement(offre, VILLES);

test('reconnaît une ville prioritaire nommée directement', () => {
  assert.ok(dansLaZone({ ville: 'Strasbourg' }));
  assert.ok(dansLaZone({ ville: 'NANCY', zone: '54 - NANCY' }));
  assert.ok(dansLaZone({ ville: 'Paris' }));
  assert.ok(dansLaZone({ ville: 'Lyon' }));
});

// Régressions observées lors de la première collecte réelle : ces deux offres
// étaient marquées « hors zone » alors qu'elles sont en Île-de-France.
test('reconnaît un département renvoyé à la place d\'une commune', () => {
  assert.ok(dansLaZone({ ville: 'Hauts-de-Seine', zone: 'France, Ile-de-France, Hauts-de-Seine' }),
    'Hauts-de-Seine est limitrophe de Paris');
});

test('reconnaît une commune de banlieue via la hiérarchie géographique', () => {
  assert.ok(dansLaZone({
    ville: 'Dammartin-en-Goele',
    zone: 'France, Ile-de-France, Seine-et-Marne, Dammartin-en-Goele',
  }), 'commune inconnue, mais la zone porte « Seine-et-Marne »');
});

test('reconnaît la zone via un code postal', () => {
  assert.ok(dansLaZone({ ville: 'Benfeld', codePostal: '67230' }), 'Bas-Rhin');
  assert.ok(dansLaZone({ ville: 'Ecrouves', codePostal: '54200' }), 'Meurthe-et-Moselle');
});

test('reconnaît la zone via un libellé « 54 - COMMUNE »', () => {
  assert.ok(dansLaZone({ ville: 'TOUL', zone: '54 - TOUL' }));
});

test('classe bien hors zone ce qui est réellement éloigné', () => {
  assert.equal(dansLaZone({ ville: 'Bordeaux', zone: 'France, Nouvelle-Aquitaine, Gironde, Bordeaux' }), false);
  assert.equal(dansLaZone({ ville: 'Courchevel', codePostal: '73120' }), false);
  assert.equal(dansLaZone({ ville: 'Fuveau', zone: 'France, Provence-Alpes-Cote d Azur, Bouches-du-Rhone' }), false);
  assert.equal(dansLaZone({ ville: 'La Seyne-sur-Mer', codePostal: '83500' }), false);
});

test('une localisation vide n\'est jamais considérée dans la zone', () => {
  assert.equal(dansLaZone({ ville: '', zone: '' }), false);
  assert.equal(dansLaZone({}), false);
});

// ----------------------------------------------------------- onglets de ville

test('rattache chaque offre à la bonne ville prioritaire', () => {
  assert.equal(rattachee({ ville: 'Strasbourg' }), 'Strasbourg');
  assert.equal(rattachee({ ville: 'NANCY', zone: '54 - NANCY' }), 'Nancy');
  assert.equal(rattachee({ ville: 'Lyon' }), 'Lyon');
  assert.equal(rattachee({ ville: 'Paris' }), 'Paris');
});

test('rattache par zone limitrophe et par département', () => {
  assert.equal(rattachee({ ville: 'Hauts-de-Seine', zone: 'France, Ile-de-France, Hauts-de-Seine' }), 'Paris');
  assert.equal(rattachee({ ville: 'Benfeld', codePostal: '67230' }), 'Strasbourg');
  assert.equal(rattachee({ ville: 'Ecrouves', codePostal: '54200' }), 'Nancy');
  assert.equal(rattachee({ ville: 'Villeurbanne' }), 'Lyon');
});

// Les offres relues en base ne portent plus de libellé de zone : seuls
// `ville` et la colonne `departement` subsistent. L'onglet doit tenir avec ça.
test('rattache une offre relue en base, à partir du département stocké', () => {
  assert.equal(rattachee({ ville: 'Schiltigheim', departement: '67' }), 'Strasbourg');
  assert.equal(rattachee({ ville: 'Boulogne-Billancourt', departement: '92' }), 'Paris');
});

/**
 * LE DÉFAUT QUE CES TESTS EXISTENT POUR ATTRAPER.
 *
 * L'onglet « Nancy » affichait Metz et Épinal, « Strasbourg » affichait
 * Colmar et Mulhouse, « Lyon » affichait Grenoble. Les onglets portaient un
 * nom de ville mais contenaient un département — quatre, dans le cas de
 * Nancy. Sur les 337 offres en base, 50 étaient rangées sous une ville où
 * elles ne sont pas.
 *
 * La cause n'était pas le code mais la configuration : un seul jeu de zones
 * servait à DEUX questions qui n'ont pas la même réponse. Voir l'en-tête de
 * src/zone.js.
 */
test('un onglet de ville ne contient pas les villes voisines', () => {
  for (const [offre, attendu] of [
    [{ ville: 'Metz', departement: '57' },      'Nancy'],
    [{ ville: 'EPINAL CEDEX', departement: '88' }, 'Nancy'],
    [{ ville: 'Colmar', departement: '68' },    'Strasbourg'],
    [{ ville: 'Guebwiller', departement: '68' }, 'Strasbourg'],
    [{ ville: 'Grenoble', departement: '38' },  'Lyon'],
    [{ ville: 'Versailles', departement: '78' }, 'Paris'],
  ]) {
    assert.notEqual(rattachee(offre), attendu,
      `${offre.ville} n'a rien à faire dans l'onglet ${attendu}`);
  }
});

/**
 * L'AUTRE MOITIÉ DU CONTRAT, ET LA PLUS FACILE À CASSER.
 *
 * Resserrer les onglets ne doit RIEN retirer de la collecte : `collect.js`
 * jette les offres hors zone qui ne sont ni prioritaires ni possibles. Si les
 * deux périmètres se remettaient à n'en faire qu'un, Metz et Colmar
 * cesseraient d'être collectées — une perte silencieuse, invisible dans
 * l'interface, et qu'on ne remarquerait qu'en ne recevant plus rien.
 */
test('resserrer les onglets ne rétrécit pas la collecte', () => {
  for (const offre of [
    { ville: 'Metz', departement: '57' },
    { ville: 'Colmar', departement: '68' },
    { ville: 'Grenoble', departement: '38' },
    { ville: 'Versailles', departement: '78' },
  ]) {
    assert.ok(dansLaZone(offre),
      `${offre.ville} doit rester collectée, même rangée dans « Autre »`);
    assert.equal(rattachee(offre), null,
      `${offre.ville} doit tomber dans « Autre »`);
  }
});

// Un nom de commune explicite doit primer sur une simple coïncidence de
// département, quel que soit l'ordre des villes dans profile.json.
test('le nom de la commune prime sur le département', () => {
  assert.equal(rattachee({ ville: 'Lyon', departement: '67' }), 'Lyon');
});

test('ce qui est hors zone n\'est rattaché à aucune ville', () => {
  assert.equal(rattachee({ ville: 'Bordeaux', zone: 'France, Nouvelle-Aquitaine, Gironde' }), null);
  assert.equal(rattachee({ ville: 'Fuveau', zone: 'France, Provence-Alpes-Cote d Azur, Bouches-du-Rhone' }), null);
  assert.equal(rattachee({}), null);
});
