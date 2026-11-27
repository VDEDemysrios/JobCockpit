import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase } from '../src/db.js';
import {
  noterAppel, fermerAnalyse, appelsDuJour, peutAnalyser, peutRediger,
  etatQuota, reglages, peutDiscuter, ANALYSE, LETTRE, ENTRETIEN, CHAT,
} from '../src/quota.js';

// reserveChat à 0 : ces tests-ci portent sur la réserve des LETTRES seule.
// La réserve du chat a les siens, plus bas.
const PROFIL = { gemini: { quotaJournalier: 100, reserveLettres: 20, reserveChat: 0 } };

test('les réglages sont bornés pour rester cohérents', () => {
  assert.deepEqual(reglages({}), { quotaJournalier: 200, reserveLettres: 40, reserveChat: 20 },
    'valeurs par défaut');

  // Une réserve plus grande que le quota interdirait toute analyse.
  const r = reglages({ gemini: { quotaJournalier: 50, reserveLettres: 90 } });
  assert.equal(r.reserveLettres, 25, 'bornée à la moitié du quota');

  assert.equal(reglages({ gemini: { reserveLettres: -5 } }).reserveLettres, 0,
    'jamais négative');
});

test('le comptage distingue les usages', () => {
  const db = ouvrirBase(':memory:');
  noterAppel(db, ANALYSE);
  noterAppel(db, ANALYSE);
  noterAppel(db, LETTRE);

  const a = appelsDuJour(db);
  assert.equal(a.analyse, 2);
  assert.equal(a.lettre, 1);
  assert.equal(a.total, 3);
});

// LE CŒUR DE LA PROTECTION. Sans elle, une journée de collectes vide le quota
// et la lettre qu'on veut écrire le soir est refusée.
test('l\'analyse s\'arrête avant d\'entamer la réserve', () => {
  const db = ouvrirBase(':memory:');

  // 79 appels : sous le plafond d'analyse (100 - 20 = 80).
  for (let i = 0; i < 79; i++) noterAppel(db, ANALYSE);
  assert.equal(peutAnalyser(db, PROFIL).ok, true);
  assert.equal(peutAnalyser(db, PROFIL).restant, 1);

  noterAppel(db, ANALYSE);
  const bloque = peutAnalyser(db, PROFIL);
  assert.equal(bloque.ok, false, 'la réserve est atteinte');
  assert.match(bloque.raison, /20 appels sont gardés/);

  // Et la rédaction, elle, dispose encore des 20 réservés.
  const lettre = peutRediger(db, PROFIL);
  assert.equal(lettre.ok, true);
  assert.equal(lettre.restant, 20);
});

test('la rédaction s\'arrête seulement quand TOUT le quota est épuisé', () => {
  const db = ouvrirBase(':memory:');
  for (let i = 0; i < 100; i++) noterAppel(db, LETTRE);

  assert.equal(peutRediger(db, PROFIL).ok, false);
  assert.match(peutRediger(db, PROFIL).raison, /épuisé/);
});

// La seconde protection : elle ne suppose aucun chiffre. Le plafond configuré
// n'est qu'une estimation ; le refus de Google, lui, est un fait.
test('cinq refus ferment l\'analyse sans toucher aux lettres', () => {
  const db = ouvrirBase(':memory:');
  noterAppel(db, ANALYSE);
  fermerAnalyse(db);

  const a = peutAnalyser(db, PROFIL);
  assert.equal(a.ok, false);
  assert.match(a.raison, /gardé pour les lettres/);

  assert.equal(peutRediger(db, PROFIL).ok, true,
    'les lettres restent possibles : c\'est tout l\'intérêt de fermer l\'analyse');
});

test('l\'état du quota est lisible pour l\'interface', () => {
  const db = ouvrirBase(':memory:');
  for (let i = 0; i < 30; i++) noterAppel(db, ANALYSE);
  for (let i = 0; i < 3; i++) noterAppel(db, LETTRE);

  const e = etatQuota(db, PROFIL);
  assert.equal(e.analyses, 30);
  assert.equal(e.lettres, 3);
  assert.equal(e.total, 33);
  assert.equal(e.restantAnalyse, 47, '80 - 33');
  assert.equal(e.restantLettres, 67, '100 - 33');
  assert.equal(e.analyseFermee, false);
  assert.match(e.jour, /^\d{4}-\d{2}-\d{2}$/);
});

test('le compteur repart à zéro le lendemain', () => {
  const db = ouvrirBase(':memory:');
  const hier = new Date(Date.now() - 86400000);
  for (let i = 0; i < 90; i++) noterAppel(db, ANALYSE, hier);
  fermerAnalyse(db, hier);

  assert.equal(appelsDuJour(db).total, 0, 'aujourd\'hui est vierge');
  assert.equal(peutAnalyser(db, PROFIL).ok, true, 'et l\'analyse rouvre');
});

// ─────────────────── Chantier 4.0 : tout ce qui part chez Google ───────────────────

// Régression : le total ne comptait que l'analyse et les lettres. Quinze
// questions d'entretien et cinquante messages de chat passaient sous le radar,
// et la lettre du soir tombait sur un 429 alors que la réserve la disait sûre.
test('le total compte aussi l\'entretien et le chat', () => {
  const db = ouvrirBase(':memory:');
  noterAppel(db, ANALYSE);
  noterAppel(db, LETTRE);
  for (let i = 0; i < 3; i++) noterAppel(db, ENTRETIEN);
  for (let i = 0; i < 5; i++) noterAppel(db, CHAT);

  const a = appelsDuJour(db);
  assert.equal(a.entretien, 3);
  assert.equal(a.chat, 5);
  assert.equal(a.total, 10, 'analyse + lettre + entretien + chat');

  const e = etatQuota(db, PROFIL);
  assert.equal(e.entretiens, 3);
  assert.equal(e.chat, 5);
  assert.equal(e.total, 10);
  assert.equal(e.restantLettres, 90);
});

test('un chat bavard réduit bien ce qui reste aux lettres', () => {
  const db = ouvrirBase(':memory:');
  for (let i = 0; i < 100; i++) noterAppel(db, CHAT);
  assert.equal(peutRediger(db, PROFIL).ok, false,
    'cent messages de chat ont vidé le quota : la lettre doit le savoir');
});

test('la réserve du chat est bornée et retenue sur l\'analyse', () => {
  assert.equal(reglages({ gemini: { quotaJournalier: 100, reserveLettres: 40, reserveChat: 50 } }).reserveChat, 10,
    'les deux réserves réunies ne dépassent pas la moitié du quota');
  assert.equal(reglages({ gemini: { reserveChat: -3 } }).reserveChat, 0, 'jamais négative');

  const db = ouvrirBase(':memory:');
  const profil = { gemini: { quotaJournalier: 100, reserveLettres: 20, reserveChat: 10 } };
  for (let i = 0; i < 70; i++) noterAppel(db, ANALYSE);
  const bloque = peutAnalyser(db, profil);
  assert.equal(bloque.ok, false, '100 - 20 - 10 = 70 : l\'analyse s\'arrête là');
  assert.match(bloque.raison, /chat/);

  // Le chat, lui, dispose encore de sa réserve, et s'arrête au seuil des lettres.
  assert.equal(peutDiscuter(db, profil).restant, 10);
  for (let i = 0; i < 10; i++) noterAppel(db, CHAT);
  assert.equal(peutDiscuter(db, profil).ok, false, 'la réserve des lettres reste intacte');
  assert.equal(peutRediger(db, profil).restant, 20);
  assert.equal(etatQuota(db, profil).reserveChat, 10);
});