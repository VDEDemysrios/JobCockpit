import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NIVEAUX, SUCCES, POINTS, niveauPour, calculerXp, calculerSerie,
  debutDeSemaine, succesAtteints,
} from '../src/progression.js';

const etatVide = {
  envoyees: 0, relances: 0, lettres: 0, ajoutsManuels: 0, entretiens: 0,
  analysees: 0, serie: 0, objectifHebdo: 5, faitCetteSemaine: 0,
  urgencesEnAttente: 0, agrivoltaique: false, villesDistinctes: 0,
};

// ------------------------------------------------------------------ niveaux

test('le niveau 1 commence à zéro expérience', () => {
  const n = niveauPour(0);
  assert.equal(n.rang, 1);
  assert.equal(n.titre, 'Prospecteur');
  assert.equal(n.progression, 0);
});

test('le niveau progresse avec l\'expérience', () => {
  assert.equal(niveauPour(119).rang, 1);
  assert.equal(niveauPour(120).rang, 2);
  assert.equal(niveauPour(320).rang, 3);
});

test('la progression vers le palier suivant est un pourcentage', () => {
  const n = niveauPour(220); // à mi-chemin entre 120 et 320
  assert.equal(n.rang, 2);
  assert.equal(n.progression, 50);
  assert.equal(n.manquant, 100);
});

test('le dernier niveau ne promet pas de suite', () => {
  const n = niveauPour(99999);
  assert.equal(n.rang, NIVEAUX.length);
  assert.equal(n.seuilSuivant, null);
  assert.equal(n.titreSuivant, null);
  assert.equal(n.progression, 100);
});

// ------------------------------------------------------------- expérience

test('l\'expérience récompense l\'effort plus que le hasard', () => {
  assert.ok(POINTS.candidatureEnvoyee > 0);
  assert.ok(POINTS.relanceEffectuee > 0);
  assert.ok(POINTS.lettreRedigee > 0);
});

test('calculerXp additionne chaque type d\'action', () => {
  const xp = calculerXp({ ...etatVide, envoyees: 2, relances: 1, lettres: 3, analysees: 10 });
  assert.equal(xp, 2 * 25 + 1 * 15 + 3 * 10 + 10 * 1);
});

test('aucun palier ne dépend d\'un entretien — le candidat ne le maîtrise pas', () => {
  // Avec uniquement de l'effort et zéro entretien, on doit pouvoir progresser.
  const xp = calculerXp({ ...etatVide, envoyees: 6, lettres: 6 });
  assert.ok(niveauPour(xp).rang >= 2, 'l\'effort seul doit suffire à monter de niveau');
});

// ------------------------------------------------------------------- série

test('la série compte les jours ouvrés consécutifs', () => {
  // mercredi 29, jeudi 30, vendredi 31 juillet 2026
  assert.equal(calculerSerie(['2026-07-29', '2026-07-30', '2026-07-31'], '2026-07-31'), 3);
});

test('un week-end inactif ne rompt PAS la série', () => {
  // vendredi 31 juillet puis lundi 3 août : le week-end est ignoré.
  assert.equal(calculerSerie(['2026-07-31', '2026-08-03'], '2026-08-03'), 2);
});

test('la série survit si la dernière action date du jour ouvré précédent', () => {
  assert.equal(calculerSerie(['2026-07-30'], '2026-07-31'), 1);
});

test('la série est rompue après deux jours ouvrés sans activité', () => {
  assert.equal(calculerSerie(['2026-07-27'], '2026-07-31'), 0);
});

test('aucune activité, aucune série', () => {
  assert.equal(calculerSerie([], '2026-07-31'), 0);
});

// -------------------------------------------------------------- semaine

test('la semaine commence le lundi', () => {
  assert.equal(debutDeSemaine('2026-07-28'), '2026-07-27'); // mardi -> lundi
  assert.equal(debutDeSemaine('2026-07-27'), '2026-07-27'); // lundi -> lui-même
  assert.equal(debutDeSemaine('2026-08-02'), '2026-07-27'); // dimanche -> lundi précédent
});

// -------------------------------------------------------------- succès

test('aucun succès sur un compte vierge', () => {
  assert.deepEqual(succesAtteints(etatVide), []);
});

test('le premier envoi débloque son succès', () => {
  const codes = succesAtteints({ ...etatVide, envoyees: 1 });
  assert.ok(codes.includes('premier-envoi'));
  assert.ok(!codes.includes('cinq-envois'));
});

test('les succès se cumulent', () => {
  const codes = succesAtteints({ ...etatVide, envoyees: 15 });
  assert.ok(codes.includes('premier-envoi'));
  assert.ok(codes.includes('cinq-envois'));
  assert.ok(codes.includes('quinze-envois'));
});

test('« Boîte vide » exige d\'avoir travaillé, pas seulement d\'être inactif', () => {
  // Un compte vierge n'a rien d'urgent, mais n'a rien fait non plus.
  assert.ok(!succesAtteints({ ...etatVide, urgencesEnAttente: 0 }).includes('boite-vide'));
  assert.ok(succesAtteints({ ...etatVide, envoyees: 3, urgencesEnAttente: 0 }).includes('boite-vide'));
});

test('l\'objectif hebdomadaire se débloque quand il est atteint', () => {
  assert.ok(succesAtteints({ ...etatVide, objectifHebdo: 3, faitCetteSemaine: 3 }).includes('objectif-atteint'));
  assert.ok(!succesAtteints({ ...etatVide, objectifHebdo: 3, faitCetteSemaine: 2 }).includes('objectif-atteint'));
});

test('chaque succès a un code unique, un nom et une astuce', () => {
  const codes = SUCCES.map(s => s.code);
  assert.equal(new Set(codes).size, codes.length, 'codes en double détectés');
  SUCCES.forEach(s => {
    assert.ok(s.nom && s.emoji && s.astuce, `succès ${s.code} incomplet`);
    assert.equal(typeof s.test, 'function');
  });
});
