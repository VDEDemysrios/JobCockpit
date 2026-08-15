import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusionner } from '../src/sources/index.js';
import { groupes } from '../scripts/fusionner-republications.js';

const VILLES = [
  { nom: 'Strasbourg', departement: '67', departementsOnglet: ['67'], zonesOnglet: ['bas rhin'] },
  { nom: 'Nancy', departement: '54', departementsOnglet: ['54'], zonesOnglet: ['meurthe et moselle'] },
];

/** Une annonce de cabinet, republiée à l'identique dans plusieurs villes. */
const republication = (ville) => ({
  titre: "h/f Chargé d'affaires photovoltaïque",
  entreprise: 'LTd',
  ville,
  description: 'Le même texte, au caractère près, dans toutes les villes.',
  source: 'france-travail',
  externalId: 'ft-' + ville,
  lien: 'https://exemple.fr/' + ville,
});

/**
 * LE CAS RÉEL, RELEVÉ SUR LA BASE.
 *
 * « h/f Chargé d'affaires photovoltaïque — LTd » apparaissait dix fois : La
 * Rochelle, Pau, Grenoble, Annecy, Clermont-Ferrand, Bourg-en-Bresse,
 * Toulouse, Savoie, Var, Bouches-du-Rhône. Même intitulé, même entreprise, et
 * surtout la même description au caractère près. Sur 386 offres, 55 étaient
 * de cette nature.
 */
test('une annonce republiée ville par ville ne compte que pour une', () => {
  const villes = ['La Rochelle', 'Pau', 'Grenoble', 'Annecy', 'Toulouse'];
  const offres = fusionner(villes.map(republication), VILLES);

  assert.equal(offres.length, 1, 'les cinq copies doivent tenir en une offre');
  assert.equal(offres[0].villesRepubliees, 5);
});

/**
 * LA MOITIÉ DU CONTRAT QU'IL SERAIT FACILE DE CASSER.
 *
 * Regrouper sur le seul couple intitulé + entreprise fusionnerait deux postes
 * réellement ouverts dans deux villes par le même employeur — et en ferait
 * disparaître un. C'est la DESCRIPTION qui tranche : deux postes distincts
 * ont deux textes distincts.
 */
test('deux postes distincts du même employeur restent deux offres', () => {
  const offres = fusionner([
    { ...republication('Strasbourg'), description: 'Poste de chargé d\'affaires, secteur Est.' },
    { ...republication('Nancy'), description: 'Poste de chargé d\'affaires, secteur Lorraine, déplacements.' },
  ], VILLES);

  assert.equal(offres.length, 2, 'des descriptions différentes = des postes différents');
});

/**
 * Quand l'annonce touche l'une des villes visées, c'est CELLE-LÀ qu'il faut
 * voir : la ranger sous Toulouse enverrait dans « Autre » une offre qui
 * recrute aussi à Strasbourg.
 */
test('la ville retenue est une ville visée quand il y en a une', () => {
  const offres = fusionner(
    ['Toulouse', 'Strasbourg', 'Pau'].map(republication), VILLES);

  assert.equal(offres.length, 1);
  assert.equal(offres[0].ville, 'Strasbourg');
});

/**
 * L'identifiant doit être STABLE d'une collecte à l'autre. Les sources ne
 * renvoient pas la même liste de villes chaque jour : si l'identifiant en
 * dépendait, la même annonce reviendrait sous une nouvelle identité à chaque
 * passage, et la base se remplirait de fantômes.
 */
test('l\'identifiant ne dépend pas des villes renvoyées ce jour-là', () => {
  const lundi = fusionner(['Toulouse', 'Pau', 'Annecy'].map(republication), VILLES);
  const mardi = fusionner(['Annecy', 'Toulouse'].map(republication), VILLES);

  assert.equal(lundi[0].id, mardi[0].id);
});

// ------------------------------------- consolidation de ce qui est déjà en base

const copie = (id, ville, extra = {}) => ({
  id, ville, titre: 'Chargé d\'Affaires Éolien', entreprise: 'LTd',
  description: 'Texte identique.', aUneTrace: false, villePrio: null, ...extra,
});

/**
 * LE PIÈGE DE CE MÉNAGE.
 *
 * Choisir la copie à garder par ordre alphabétique seul faisait conserver
 * l'Essonne là où Paris figurait dans le même lot : l'annonce quittait
 * l'onglet Paris pour « Autre ». Un nettoyage qui rend une offre pertinente
 * invisible est pire que pas de nettoyage.
 */
test('la copie conservée est celle rattachée à une ville visée', () => {
  const [g] = groupes([
    copie('a', 'Essonne'),
    copie('b', 'Hauts-de-Seine', { villePrio: 'Paris' }),
    copie('c', 'Yvelines'),
  ]);
  assert.equal(g.garde.id, 'b');
  assert.equal(g.retire.length, 2);
});

/** Le travail déjà fait passe avant tout le reste. */
test('une offre portant une candidature ou une lettre est celle qu\'on garde', () => {
  const [g] = groupes([
    copie('a', 'Paris', { villePrio: 'Paris' }),
    copie('b', 'Toulouse', { aUneTrace: true }),
  ]);
  assert.equal(g.garde.id, 'b', 'le suivi l\'emporte même sur une ville visée');
});

/** Deux traces dans le même lot : ce n'est pas au script de trancher. */
test('un lot où plusieurs offres portent du travail est laissé intact', () => {
  assert.deepEqual(groupes([
    copie('a', 'Paris', { aUneTrace: true }),
    copie('b', 'Lyon', { aUneTrace: true }),
  ]), []);
});

/** Une offre ordinaire ne doit rien changer : ni son identité, ni son compte. */
test('une offre unique garde son identifiant et son compte à un', () => {
  const seule = {
    titre: 'Chef de projet EnR', entreprise: 'ACME', ville: 'Strasbourg',
    description: 'Une description.', source: 'france-travail', externalId: 'x', lien: 'https://x',
  };
  const [offre] = fusionner([seule], VILLES);

  assert.equal(offre.villesRepubliees, undefined,
    'une offre non republiée ne porte pas de compte — la base met 1 par défaut');
  // Deux offres identiques vues sur deux plateformes fusionnent déjà, et leur
  // identifiant reste celui construit avec la ville : le changer ferait
  // perdre le suivi de candidature et les lettres, qui s'y rattachent.
  const [memeOffre] = fusionner([seule, { ...seule, source: 'adzuna' }], VILLES);
  assert.equal(memeOffre.id, offre.id);
  assert.deepEqual(memeOffre.sourcesAll.sort(), ['adzuna', 'france-travail']);
});
