import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offresDuJour, envoyeesAujourdhui } from '../public/selection.js';

const jourMoins = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const offre = (id, extra = {}) => ({
  id, titre: 'Chef de projet EnR ' + id, entreprise: 'ACME', ville: 'Paris',
  groupe: 1, score: 10, villePrio: 'Paris', dateOffre: jourMoins(2),
  villesRepubliees: 1, analyse: { verdict: 'ok' },
  suivi: { status: 'À postuler', sent: '' }, aLettre: false, ...extra,
});

test('rend exactement trois offres quand le vivier est fourni', () => {
  const r = offresDuJour(Array.from({ length: 20 }, (_, i) => offre('o' + i)), 3);
  assert.equal(r.offres.length, 3);
  assert.deepEqual(r.criteresRelaches, [], 'aucun critère ne devrait être relâché');
});

test('classe par score, puis par fraîcheur', () => {
  const r = offresDuJour([
    offre('faible', { score: 5 }),
    offre('fort-vieux', { score: 18, dateOffre: jourMoins(12) }),
    offre('fort-frais', { score: 18, dateOffre: jourMoins(1) }),
  ], 3);
  assert.deepEqual(r.offres.map(o => o.id), ['fort-frais', 'fort-vieux', 'faible']);
});

/**
 * CE QUI NE DOIT JAMAIS ENTRER DANS LA SÉLECTION.
 *
 * Une offre déjà envoyée n'est plus une action : la remettre en tête ferait
 * du bloc un rappel de ce qui est fait, alors qu'il sert à dire quoi faire.
 */
test('une offre déjà envoyée sort de la sélection', () => {
  const r = offresDuJour([
    offre('envoyee', { suivi: { status: 'Envoyé', sent: jourMoins(1) } }),
    offre('entretien', { suivi: { status: 'Entretien', sent: jourMoins(9) } }),
    offre('a-faire'),
  ], 3);
  assert.deepEqual(r.offres.map(o => o.id), ['a-faire']);
});

/**
 * LE MUR QU'ON CHERCHE À ÉVITER.
 *
 * Sur les 374 offres réelles, 200 étaient « prioritaires » mais 81 seulement
 * dans une ville visée. Sans ce filtre, la sélection proposerait des postes à
 * Toulouse ou à Nice — parfaitement notés, parfaitement inutiles.
 */
test('une offre hors des villes visées ne passe pas devant une offre locale', () => {
  const r = offresDuJour([
    offre('toulouse', { score: 20, villePrio: null, ville: 'Toulouse' }),
    offre('paris', { score: 8 }),
  ], 1);
  assert.equal(r.offres[0].id, 'paris', 'la ville prime sur le score');
});

/** Une annonce diffusée dans dix villes est un cabinet qui ratisse. */
test('une annonce republiée partout est écartée de la sélection', () => {
  const r = offresDuJour([
    offre('diffusee', { score: 20, villesRepubliees: 9 }),
    offre('vraie', { score: 8 }),
  ], 1);
  assert.equal(r.offres[0].id, 'vraie');
});

/**
 * LE CAS QUI FERAIT UN BLOC VIDE.
 *
 * Une semaine creuse, aucune offre ne coche tout. Mieux vaut trois offres
 * correctes et le DIRE que trois cases vides : un tableau de bord qui n'a
 * rien à proposer cesse d'être consulté.
 */
test('les critères se relâchent plutôt que de rendre un bloc vide', () => {
  const r = offresDuJour([
    offre('sans-analyse', { analyse: null }),
    offre('vieille', { analyse: null, dateOffre: jourMoins(40) }),
  ], 3);
  assert.equal(r.offres.length, 2, 'on propose ce qu\'on a');
  assert.ok(r.criteresRelaches.includes('déjà analysée'),
    'le relâchement doit être annoncé, pas silencieux');
});

test('l\'ordre des critères relâchés va du moins grave au plus grave', () => {
  // Seule une offre hors zone existe : il faut avoir lâché « ville visée »,
  // donc aussi tout ce qui vient après dans la liste.
  const r = offresDuJour([offre('lointaine', { villePrio: null, analyse: null })], 3);
  assert.equal(r.offres.length, 1);
  assert.ok(r.criteresRelaches.includes('dans une ville visée'));
});

test('la sélection est stable : deux appels donnent le même trio', () => {
  const lot = Array.from({ length: 12 }, (_, i) => offre('o' + i, { score: 10 }));
  assert.deepEqual(
    offresDuJour(lot, 3).offres.map(o => o.id),
    offresDuJour(lot, 3).offres.map(o => o.id),
    'à score égal, l\'identifiant tranche — pas le hasard');
});

test('le compteur ne retient que les envois du jour', () => {
  assert.equal(envoyeesAujourdhui([
    offre('a', { suivi: { status: 'Envoyé', sent: new Date().toISOString().slice(0, 10) } }),
    offre('b', { suivi: { status: 'Envoyé', sent: jourMoins(1) } }),
    offre('c', { aLettre: true }),
  ]), 1, 'une lettre écrite n\'est pas une candidature envoyée');
});
