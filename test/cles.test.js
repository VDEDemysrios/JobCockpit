// LES DEUX `.env`, ET LE PIÈGE QU'ILS TENDENT.
//
// `JobCockpit\.env` est celui du projet, `Application\.env` le seul que lit
// l'exécutable. Une clé ajoutée pendant le développement n'arrive donc pas
// dans l'application, et RIEN ne le signale : l'interface annonce « non
// configuré » pour une clé qui est bel et bien renseignée, dans l'autre
// fichier. Le symptôme ne ressemble jamais à un problème de fichier — il a
// coûté une session sur Spotify, puis une autre sur Twitch.
//
// La règle testée ici tient en une phrase : on complète ce qui manque, on
// n'écrase jamais ce qui est rempli.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireEnv, completer } from '../scripts/cles.js';

test('un fichier .env se lit malgré les commentaires et les espaces', () => {
  const e = lireEnv(`# un commentaire
GEMINI_API_KEY=abc
  PORT = 3000
VIDE=
pas une ligne de clé`);
  assert.equal(e.GEMINI_API_KEY, 'abc');
  assert.equal(e.PORT, '3000');
  assert.equal(e.VIDE, '');
});

test('une clé absente est reprise du projet', () => {
  const { manquantes, texte } = completer('GEMINI_API_KEY=a\n', 'GEMINI_API_KEY=a\nTWITCH_CLIENT_ID=t\n');
  assert.deepEqual(manquantes, ['TWITCH_CLIENT_ID']);
  assert.match(texte, /^TWITCH_CLIENT_ID=t$/m);
  assert.match(texte, /^GEMINI_API_KEY=a$/m);
});

/**
 * LE CAS RÉEL, ET C'EST LE PLUS TRAÎTRE : la clé est PRÉSENTE côté
 * application, mais vide — parce que le `.env` d'exemple la déclare. Une
 * simple concaténation écrirait la clé deux fois, et `dotenv` garde la
 * PREMIÈRE, c'est-à-dire la vide. Le fichier aurait l'air corrigé et
 * l'application continuerait de dire « non configuré ».
 */
test('une clé présente mais vide est remplacée, pas doublée', () => {
  const { manquantes, texte } = completer(
    'PORT=3000\nTWITCH_CLIENT_ID=\nSPOTIFY_CLIENT_ID=s\n',
    'TWITCH_CLIENT_ID=vraie\n');
  assert.deepEqual(manquantes, ['TWITCH_CLIENT_ID']);
  assert.equal(texte.match(/^TWITCH_CLIENT_ID=/gm).length, 1, 'une seule fois, sinon dotenv lit la vide');
  assert.match(texte, /^TWITCH_CLIENT_ID=vraie$/m);
  assert.match(texte, /^SPOTIFY_CLIENT_ID=s$/m, 'le reste du fichier est intact');
});

/**
 * ON N'ÉCRASE JAMAIS UNE VALEUR. L'application peut légitimement avoir la
 * sienne — un port différent, une clé dédiée. Une synchronisation qui écrase
 * serait pire que le problème qu'elle règle : elle casserait une installation
 * qui marchait, sans que personne ne l'ait demandé.
 */
test('une clé déjà renseignée n\'est jamais touchée', () => {
  const { manquantes, texte } = completer('PORT=4000\n', 'PORT=3000\n');
  assert.deepEqual(manquantes, []);
  assert.equal(texte, 'PORT=4000\n');
});

test('une clé vide des deux côtés ne fait rien apparaître', () => {
  assert.deepEqual(completer('A=\n', 'A=\nB=\n').manquantes, [],
    'recopier du vide ferait croire à une correction');
});
