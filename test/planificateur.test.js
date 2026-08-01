import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase, ecrireMeta } from '../src/db.js';
import { demarrerPlanificateur } from '../src/planificateur.js';

/**
 * Journal muet. Le lanceur de tests de Node communique avec ses fichiers par
 * le flux de sortie : une écriture console pendant un test le corrompt, et le
 * fichier entier échoue sur « Unable to deserialize cloned data » — sans
 * qu'aucun test individuel n'ait échoué.
 */
const MUET = { log() {}, warn() {}, error() {} };

/** Attend que la file des tâches se vide, sans dormir inutilement. */
const respirer = () => new Promise(r => setTimeout(r, 30));

function planifier(db, options = {}) {
  const tours = [];
  const p = demarrerPlanificateur({
    db,
    collecter: async () => { tours.push('fait'); return { nouvelles: 0, analysees: 0, dureeSecondes: 0 }; },
    sources: [], profil: {}, cv: '',
    actif: true,
    journal: MUET,
    delaiAmorceMs: 1,
    intervalleMs: 3_600_000,
    ...options,
  });
  return { p, tours };
}

test('une collecte part au démarrage', async () => {
  const db = ouvrirBase(':memory:');
  const { p, tours } = planifier(db);
  await respirer();
  p.arreter();

  assert.deepEqual(tours, ['fait'], 'ouvrir l\'application doit ramener des offres du jour');
});

// Le déclencheur est « à l'ouverture de session » : redémarrer est ordinaire.
// Sans ce garde-fou, trois redémarrages d'affilée coûtaient trois fois le
// quota Gemini pour ramener exactement les mêmes offres.
test('elle est ignorée si une collecte vient de tourner', async () => {
  const db = ouvrirBase(':memory:');
  ecrireMeta(db, 'last_collect_at', new Date(Date.now() - 5 * 60000).toISOString());

  const { p, tours } = planifier(db);
  await respirer();
  p.arreter();

  assert.deepEqual(tours, [], 'cinq minutes, c\'est trop frais pour recollecter');
});

test('mais elle repart si la dernière est assez ancienne', async () => {
  const db = ouvrirBase(':memory:');
  ecrireMeta(db, 'last_collect_at', new Date(Date.now() - 3 * 3600000).toISOString());

  const { p, tours } = planifier(db);
  await respirer();
  p.arreter();

  assert.deepEqual(tours, ['fait']);
});

test('une date illisible ne bloque pas la collecte', async () => {
  const db = ouvrirBase(':memory:');
  ecrireMeta(db, 'last_collect_at', 'pas une date');

  const { p, tours } = planifier(db);
  await respirer();
  p.arreter();

  assert.deepEqual(tours, ['fait'], 'en cas de doute, on collecte');
});

test('sans activation, rien ne se déclenche', async () => {
  const db = ouvrirBase(':memory:');
  const { p, tours } = planifier(db, { actif: false });
  await respirer();

  assert.equal(p, null);
  assert.deepEqual(tours, []);
});

// Une collecte ratée ne doit jamais faire tomber le serveur : le tableau de
// bord doit rester consultable même quand les sources sont injoignables.
test('une collecte en échec n\'arrête pas le planificateur', async () => {
  const db = ouvrirBase(':memory:');
  const p = demarrerPlanificateur({
    db,
    collecter: async () => { throw new Error('sources injoignables'); },
    sources: [], profil: {}, cv: '', actif: true, journal: MUET,
    delaiAmorceMs: 1, intervalleMs: 3_600_000,
  });

  await respirer();
  assert.ok(p, 'le planificateur tient debout');
  p.arreter();
});
