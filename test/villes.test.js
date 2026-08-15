// LES VILLES PRIORITAIRES, RÉGLABLES PAR QUELQU'UN D'AUTRE QUE L'AUTEUR.
//
// Le premier profil de l'application avait quatre villes choisies par une
// seule personne, aux périmètres réglés à la main. Ces tests protègent ce qui
// permet à quelqu'un d'autre d'en avoir d'autres — et surtout, ce qui casse
// SANS LEVER D'ERREUR : un onglet qui se remplit de villes voisines, un
// périmètre qu'on croit avoir rétréci, un département faux qui a l'air juste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  construireVille, decrireVille, validerVilles, departementDuCode,
  lireDepartements, VILLES_MAX,
} from '../src/villes.js';
import { villeDeRattachement } from '../src/zone.js';

/**
 * L'ALLER-RETOUR NE DOIT RIEN PERDRE.
 *
 * Éditer ses villes passe par `decrireVille` (afficher) puis `construireVille`
 * (réécrire). Si le trajet perd quelque chose, il le perd à chaque
 * enregistrement : ouvrir les Options, ne rien changer, cliquer — et voir son
 * réglage s'éroder.
 *
 * Le cas qui l'a révélé est VILLEURBANNE. Les libellés de département se
 * régénèrent depuis leur numéro, mais « villeurbanne » ne se déduit de rien :
 * il ne contient pas « lyon », donc la comparaison par nom de ville ne le
 * rattrape pas non plus. Sur 300 offres réelles, une annonce n'était rattachée
 * à Lyon que par lui.
 */
test('éditer ses villes sans rien changer ne perd rien', () => {
  const lyon = {
    nom: 'Lyon', departement: '69',
    departementsOnglet: ['69'], zonesOnglet: ['rhone', 'metropole de lyon', 'villeurbanne'],
    departementsProches: ['69', '01', '38', '42'],
    zonesProches: ['rhone', 'ain', 'isere', 'loire', 'metropole de lyon', 'villeurbanne'],
  };
  const apres = construireVille(decrireVille(lyon));

  assert.deepEqual(apres.departementsOnglet, ['69']);
  assert.deepEqual(apres.departementsProches, ['69', '01', '38', '42']);
  assert.ok(apres.zonesOnglet.includes('villeurbanne'),
    'une commune de l\'agglomération ne se déduit d\'aucun numéro : la perdre décroche ses offres');

  // Et l'offre elle-même retombe bien au même endroit.
  const offre = { ville: 'Villeurbanne', departement: null };
  assert.equal(villeDeRattachement(offre, [lyon]), 'Lyon');
  assert.equal(villeDeRattachement(offre, [apres]), 'Lyon');
});

/**
 * RÉTRÉCIR DOIT RÉTRÉCIR POUR DE BON.
 *
 * C'est le défaut d'origine : l'onglet « Nancy » affichait Metz. Si le libellé
 * « moselle » survivait au retrait du département 57, le réglage n'aurait
 * aucun effet visible — et on chercherait la panne partout ailleurs.
 */
test('retirer un département retire aussi son libellé', () => {
  const nancy = {
    nom: 'Nancy', departement: '54',
    departementsOnglet: ['54', '57'], zonesOnglet: ['meurthe et moselle', 'moselle', 'grand nancy'],
    departementsProches: ['54', '57'], zonesProches: ['meurthe et moselle', 'moselle'],
  };
  const resserre = construireVille({ ...decrireVille(nancy), onglet: ['54'], collecte: ['54'] });

  assert.ok(!resserre.zonesOnglet.includes('moselle'),
    'le libellé du département retiré doit disparaître, sinon Metz revient dans l\'onglet Nancy');
  assert.ok(resserre.zonesOnglet.includes('grand nancy'),
    'la commune de l\'agglomération, elle, n\'a rien à voir avec le département retiré');
  assert.equal(villeDeRattachement({ ville: 'Metz', departement: '57' }, [resserre]), null);
});

/**
 * Un onglet qui affiche un département que la collecte ne parcourt pas reste
 * vide pour toujours, sans que rien ne l'explique. On élargit la collecte
 * plutôt que de refuser : le réglage demandé est celui de l'onglet.
 */
test('la collecte couvre toujours au moins ce que l\'onglet affiche', () => {
  const v = construireVille({ nom: 'Paris', codePostal: '75008',
    onglet: ['75', '92', '93', '94'], collecte: ['75'] });
  for (const dep of ['75', '92', '93', '94']) {
    assert.ok(v.departementsProches.includes(dep), `${dep} est affiché mais jamais collecté`);
  }
});

/**
 * LA CORSE. « 20 » n'existe pas comme département — elle se partage entre 2A
 * et 2B, et tous ses codes postaux commencent par 20. Renvoyer 2A pour tout
 * code corse, ce qu'on faisait, donnait la Corse-du-Sud à Bastia : un
 * département faux, avec l'air d'être sûr de lui.
 */
test('un code postal corse donne le bon des deux départements', () => {
  assert.equal(departementDuCode('20000'), '2A', 'Ajaccio est en Corse-du-Sud');
  assert.equal(departementDuCode('20200'), '2B', 'Bastia est en Haute-Corse');
  assert.equal(departementDuCode('2B'), '2B', 'le département écrit directement est accepté');
});

/** L'outre-mer a des numéros à trois chiffres : les couper à deux les perd. */
test('les départements d\'outre-mer sont reconnus', () => {
  assert.equal(departementDuCode('97400'), '974');
  assert.equal(departementDuCode('97100'), '971');
});

/**
 * Un numéro inexistant saisi par erreur ne doit pas entrer dans le profil :
 * il n'y lèverait aucune erreur, et se manifesterait six heures plus tard par
 * un onglet resté vide.
 */
test('un département qui n\'existe pas est écarté', () => {
  assert.deepEqual(lireDepartements('67 99 68'), ['67', '68']);
  assert.deepEqual(lireDepartements('67 67'), ['67'], 'sans doublon');
  assert.equal(departementDuCode('99999'), null);
});

/**
 * Deux villes de même nom donneraient deux onglets identiques dont le second
 * serait inatteignable : le rattachement retourne toujours le premier trouvé.
 */
test('deux villes ne peuvent pas porter le même nom', () => {
  const { erreur } = validerVilles([
    { nom: 'Lyon', codePostal: '69000' },
    { nom: 'lyon', codePostal: '69000' },
  ]);
  assert.match(String(erreur), /double/i);
});

/** Sans ville, la collecte n'a plus de direction : le refus est explicite. */
test('une liste vide est refusée, et le dit', () => {
  const { erreur } = validerVilles([]);
  assert.match(String(erreur), /au moins une ville/i);
});

/**
 * Le plafond n'est pas une limite d'affichage : chaque ville multiplie les
 * requêtes par le nombre d'intitulés, sur chaque source. Le dépassement doit
 * être ANNONCÉ — tronquer en silence ferait disparaître des villes qu'on vient
 * de saisir, et chercher la panne du mauvais côté.
 */
test('au-delà du plafond, on refuse au lieu de tronquer', () => {
  const trop = Array.from({ length: VILLES_MAX + 1 },
    (_, i) => ({ nom: `Ville${i}`, codePostal: '44000' }));
  const { villes, erreur } = validerVilles(trop);
  assert.equal(villes.length, 0);
  assert.match(String(erreur), new RegExp(String(VILLES_MAX)));
});

/** Une ville sans département exploitable est refusée avec son nom. */
test('une ville sans code postal lisible est nommée dans le refus', () => {
  const { erreur } = validerVilles([{ nom: 'Quelque part', codePostal: 'zzz' }]);
  assert.match(String(erreur), /Quelque part/);
});

/**
 * Le cas ordinaire : un nom, un code postal, rien d'autre. C'est tout ce que
 * l'assistant de première configuration demande, et cela doit suffire à
 * produire une ville complète.
 */
test('un nom et un code postal suffisent', () => {
  const v = construireVille({ nom: 'Bordeaux', codePostal: '33000' });
  assert.equal(v.departement, '33');
  assert.deepEqual(v.departementsOnglet, ['33']);
  assert.deepEqual(v.departementsProches, ['33']);
  assert.deepEqual(v.zonesOnglet, ['gironde']);
  assert.equal(villeDeRattachement({ ville: 'Mérignac', departement: '33' }, [v]), 'Bordeaux');
});
