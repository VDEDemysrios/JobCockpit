import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ouvrirBase, upsertOffre } from '../src/db.js';
import { trier, reglages, sauvegarder, lister } from '../src/sauvegarde.js';

const LE_1ER_AOUT = new Date('2026-08-01T21:45:00');

// ------------------------------------------------------------------ rotation

// Fonction pure : c'est la logique qu'on veut pouvoir vérifier sans disque,
// parce que c'est elle qui décide de ce qu'on perd.
test('la rotation garde tout des jours récents, puis une par jour', () => {
  const noms = [
    '2026-08-01_07h00', '2026-08-01_13h00', '2026-08-01_19h00', // aujourd'hui
    '2026-07-31_07h00', '2026-07-31_19h00',                     // hier
    '2026-07-30_07h00', '2026-07-30_13h00', '2026-07-30_19h00', // avant-hier
    '2026-07-20_07h00', '2026-07-20_19h00',                     // ancien
    '2026-06-01_07h00',                                          // hors fenêtre
  ];

  const { garder, supprimer } = trier(noms, reglages({}), LE_1ER_AOUT);

  // Les deux derniers jours : tout est gardé.
  assert.ok(garder.includes('2026-08-01_07h00'));
  assert.ok(garder.includes('2026-08-01_19h00'));
  assert.ok(garder.includes('2026-07-31_07h00'));
  assert.ok(garder.includes('2026-07-31_19h00'));

  // Au-delà : seulement la dernière du jour.
  assert.ok(garder.includes('2026-07-30_19h00'));
  assert.ok(supprimer.includes('2026-07-30_07h00'));
  assert.ok(supprimer.includes('2026-07-30_13h00'));
  assert.ok(garder.includes('2026-07-20_19h00'));
  assert.ok(supprimer.includes('2026-07-20_07h00'));

  // Trop vieux : rien.
  assert.ok(supprimer.includes('2026-06-01_07h00'));
});

test('la rotation ignore ce qui ne lui appartient pas', () => {
  const { garder, supprimer } = trier(
    ['2026-08-01_07h00', 'notes.txt', 'un-dossier', 'README.md'],
    reglages({}), LE_1ER_AOUT);

  assert.deepEqual(garder, ['2026-08-01_07h00']);
  assert.deepEqual(supprimer, [], 'aucun fichier étranger ne doit être supprimé');
});

test('les réglages ont des valeurs sensées par défaut', () => {
  const r = reglages({});
  assert.equal(r.active, true, 'activée sauf refus explicite');
  assert.ok(r.dossier.length > 0);
  assert.equal(r.garderJours, 30);
  assert.equal(r.joursComplets, 2);

  assert.equal(reglages({ sauvegarde: { active: false } }).active, false);
  assert.equal(reglages({ sauvegarde: { garderJours: 0 } }).garderJours, 1, 'jamais zéro');
});

// -------------------------------------------------------------- sur le disque

test('sauvegarder écrit une base complète et lisible', () => {
  const bac = mkdtempSync(join(tmpdir(), 'cockpit-sauv-'));
  try {
    const racine = join(bac, 'projet');
    mkdirSync(join(racine, 'profile'), { recursive: true });
    writeFileSync(join(racine, 'profile/profile.json'), '{"nom":"test"}');
    writeFileSync(join(racine, '.env'), 'CLE=valeur');

    const db = ouvrirBase(join(racine, 'data.db'));
    upsertOffre(db, {
      id: 'a', titre: 'Chef de projet', entreprise: 'ACME', ville: 'Nancy',
      description: 'x', groupe: 1, score: 8,
    });

    const profil = { sauvegarde: { dossier: join(bac, 'copies') } };
    const r = sauvegarder(db, { racine, profil, quand: LE_1ER_AOUT });

    assert.equal(r.ok, true, r.erreur);
    assert.ok(r.chemin.endsWith('2026-08-01_21h45'));

    // La base copiée doit être lisible SEULE : ni -wal ni -shm à côté.
    const copie = join(r.chemin, 'data.db');
    assert.ok(existsSync(copie));
    assert.equal(existsSync(copie + '-wal'), false, 'VACUUM INTO ne laisse pas de WAL');

    const relue = ouvrirBase(copie);
    assert.equal(relue.prepare('SELECT COUNT(*) n FROM offers').get().n, 1);
    assert.equal(relue.prepare('SELECT titre FROM offers').get().titre, 'Chef de projet');
    relue.close();

    // Le profil et les clés suivent : ils ne se reconstruisent pas non plus.
    assert.ok(existsSync(join(r.chemin, 'profile.json')));
    assert.ok(existsSync(join(r.chemin, '.env')));

    assert.equal(lister(profil).length, 1);
    db.close();
  } finally {
    rmSync(bac, { recursive: true, force: true });
  }
});

// Une sauvegarde impossible ne doit JAMAIS faire échouer la collecte qu'elle
// accompagne : ce serait perdre la moisson pour protéger la moisson.
test('une sauvegarde impossible est signalée, pas levée', () => {
  const bac = mkdtempSync(join(tmpdir(), 'cockpit-sauv-'));
  try {
    const db = ouvrirBase(':memory:');
    const r = sauvegarder(db, {
      racine: bac,
      // Un chemin invalide sous Windows : les deux-points sont interdits.
      profil: { sauvegarde: { dossier: join(bac, 'in:valide') } },
    });
    assert.equal(r.ok, false);
    assert.ok(typeof r.erreur === 'string' && r.erreur.length > 0);
    db.close();
  } finally {
    rmSync(bac, { recursive: true, force: true });
  }
});

test('désactivée, elle n\'écrit rien', () => {
  const bac = mkdtempSync(join(tmpdir(), 'cockpit-sauv-'));
  try {
    const db = ouvrirBase(':memory:');
    const dossier = join(bac, 'copies');
    const r = sauvegarder(db, { racine: bac, profil: { sauvegarde: { active: false, dossier } } });
    assert.equal(r.ok, false);
    assert.equal(existsSync(dossier), false);
    db.close();
  } finally {
    rmSync(bac, { recursive: true, force: true });
  }
});

// Ce garde-fou n'est pas théorique : sans lui, chaque test appelant
// `collecter()` écrivait une fausse sauvegarde d'une offre dans les Documents
// de l'utilisateur — et poussait les vraies hors de la rotation.
test('une base en mémoire n\'est jamais sauvegardée', () => {
  const bac = mkdtempSync(join(tmpdir(), 'cockpit-sauv-'));
  try {
    const db = ouvrirBase(':memory:');
    upsertOffre(db, {
      id: 'a', titre: 'Offre de test', entreprise: 'ACME', ville: 'Nancy',
      description: 'x', groupe: 1, score: 8,
    });

    const dossier = join(bac, 'copies');
    const r = sauvegarder(db, { racine: bac, profil: { sauvegarde: { dossier } } });

    assert.equal(r.ok, false);
    assert.match(r.erreur, /mémoire/);
    assert.equal(existsSync(dossier), false, 'aucun dossier ne doit être créé');
    db.close();
  } finally {
    rmSync(bac, { recursive: true, force: true });
  }
});

// VACUUM INTO refuse d'écrire sur un fichier existant : deux collectes dans
// la même minute tombent sur le même horodatage.
test('deux sauvegardes dans la même minute ne s\'annulent pas', () => {
  const bac = mkdtempSync(join(tmpdir(), 'cockpit-sauv-'));
  try {
    const racine = join(bac, 'projet');
    mkdirSync(racine, { recursive: true });
    const db = ouvrirBase(join(racine, 'data.db'));
    upsertOffre(db, {
      id: 'a', titre: 'Offre', entreprise: 'ACME', ville: 'Nancy',
      description: 'x', groupe: 1, score: 8,
    });

    const profil = { sauvegarde: { dossier: join(bac, 'copies') } };
    const un = sauvegarder(db, { racine, profil, quand: LE_1ER_AOUT });
    const deux = sauvegarder(db, { racine, profil, quand: LE_1ER_AOUT });

    assert.equal(un.ok, true, un.erreur);
    assert.equal(deux.ok, true, deux.erreur);
    assert.equal(lister(profil).length, 1, 'la seconde remplace la première');
    db.close();
  } finally {
    rmSync(bac, { recursive: true, force: true });
  }
});
