// LES PIÈCES JOINTES DE LA CONVERSATION.
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Le défaut qu'il verrouille avait une signature parfaite : le compagnon
// répondait « je n'ai pas accès aux images ». Ce n'était ni une hallucination
// ni une panne — l'ancienne version n'envoyait la pièce qu'avec le message où
// on la déposait, et l'historique repartait en texte. On joignait une capture,
// on posait sa question AU TOUR SUIVANT, et il n'avait effectivement plus rien.
//
// Rien ne le signalait côté serveur : la requête partait, Gemini répondait,
// le code 200. Le seul symptôme était une phrase polie qui donnait à croire
// que la fonction n'existait pas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validerPiece, preparerPieces, piecesRecentes, decrirePieces, genrePiece, LIMITES,
} from '../src/pieces.js';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const piece = (o = {}) => ({ nom: 'x.png', mimeType: 'image/png', data: b64('coucou'), ...o });

/**
 * L'INVARIANT CENTRAL : une pièce reste lisible quelques tours.
 *
 * C'est tout l'objet du module. Sans cette fenêtre, la question posée après
 * coup — « et la date, c'est quand ? » — arrivait sans son image.
 */
test('les pièces des tours précédents repartent avec le message', () => {
  const messages = [
    { role: 'moi', texte: 'regarde ça', pieces: [piece({ nom: 'capture.png' })] },
    { role: 'lui', texte: 'je vois' },
    { role: 'moi', texte: 'et la date ?' },
  ];
  const reprises = piecesRecentes(messages);
  assert.equal(reprises.length, 1, 'la capture doit repartir');
  assert.equal(reprises[0].nom, 'capture.png');
});

/** Bornée, sinon chaque tour renverrait toute la conversation. */
test('la fenêtre est bornée en tours et en nombre', () => {
  const vieux = Array.from({ length: 10 }, (_, i) => ({
    role: 'moi', texte: `t${i}`, pieces: [piece({ nom: `p${i}.png` })],
  }));
  const r = piecesRecentes(vieux);
  assert.ok(r.length <= LIMITES.piecesRenvoyees, `${r.length} pièces renvoyées, c'est trop`);
  // Ce sont les PLUS RÉCENTES qui comptent : c'est de la dernière qu'on parle.
  assert.equal(r.at(-1).nom, 'p9.png');
  assert.ok(!r.some(p => p.nom === 'p0.png'), 'les plus vieilles doivent tomber');
});

test('une conversation sans pièce ne renvoie rien', () => {
  assert.deepEqual(piecesRecentes([{ role: 'moi', texte: 'salut' }]), []);
  assert.deepEqual(piecesRecentes([]), []);
  assert.deepEqual(piecesRecentes(null), []);
});

// ─────────────────────────────────────────────────────── validation

test('les formats que Gemini lit nativement sont reconnus', () => {
  assert.equal(genrePiece('image/png'), 'image');
  assert.equal(genrePiece('image/jpeg'), 'image');
  assert.equal(genrePiece('application/pdf'), 'pdf');
  assert.equal(genrePiece('audio/mpeg'), 'son');
  assert.equal(genrePiece('video/mp4'), 'video');
  assert.equal(genrePiece('text/plain'), 'texte');
  assert.equal(genrePiece(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'document');
  assert.equal(genrePiece('application/x-msdownload'), 'inconnu');
});

/**
 * UNE PIÈCE REFUSÉE NE FAIT PAS ÉCHOUER LE MESSAGE.
 *
 * Refuser tout un envoi parce qu'un fichier sur cinq est trop lourd fait aussi
 * perdre le texte qu'on venait d'écrire. On écarte la pièce, on le dit, et la
 * conversation continue.
 */
test('une pièce trop lourde est écartée, pas fatale', async () => {
  const enorme = piece({ nom: 'gros.png', data: 'A'.repeat(LIMITES.parPiece + 10) });
  const { inline, refus } = await preparerPieces([enorme, piece({ nom: 'ok.png' })]);
  assert.equal(inline.length, 1, 'la pièce valide passe quand même');
  assert.equal(inline[0].nom, 'ok.png');
  assert.equal(refus.length, 1);
  assert.match(refus[0].raison, /trop lourd/);
});

test('un format non lu est nommé, pas avalé en silence', async () => {
  const { inline, refus } = await preparerPieces([
    piece({ nom: 'virus.exe', mimeType: 'application/x-msdownload' })]);
  assert.equal(inline.length, 0);
  assert.match(refus[0].raison, /format non lu/);
  assert.equal(refus[0].nom, 'virus.exe');
});

/**
 * LA SEULE BARRIÈRE AVANT UN ENVOI CHEZ UN TIERS. Une chaîne base64 n'a ni
 * espace ni en-tête `data:` ; ce qui n'en est pas ne part pas.
 */
test('ce qui n\'est pas du base64 ne part pas', () => {
  for (const mauvais of ['data:image/png;base64,AAAA', 'a b c', '<script>', '']) {
    const { ok } = validerPiece(piece({ data: mauvais }));
    assert.ok(!ok, `« ${mauvais.slice(0, 20)} » ne doit pas passer`);
  }
  assert.ok(validerPiece(piece()).ok, 'une pièce propre doit passer');
  assert.ok(!validerPiece(null).ok);
  assert.ok(!validerPiece('coucou').ok);
});

/** L'ensemble d'un message est borné, pas seulement chaque fichier. */
test('le total d\'un message est plafonné', async () => {
  const moyenne = () => piece({ data: 'A'.repeat(LIMITES.parPiece - 10) });
  const { inline, refus } = await preparerPieces([moyenne(), moyenne(), moyenne()]);
  assert.ok(inline.length < 3, 'trois pièces au plafond ne peuvent pas toutes passer');
  assert.ok(refus.some(r => /ensemble/.test(r.raison)));
});

// ─────────────────────────────────────────────────────── conversion

/**
 * Word n'est pas lu nativement : c'est une archive ZIP. Il passe par une
 * extraction de texte, et le résultat va dans le PROMPT, pas en `inlineData`.
 */
test('un document est converti en texte, pas envoyé tel quel', async () => {
  const docx = piece({
    nom: 'lettre.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    data: b64('peu importe'),
  });
  const { inline, textes } = await preparerPieces([docx], async () => 'Le contenu du Word.');
  assert.equal(inline.length, 0, 'le modèle ne sait pas lire un ZIP');
  assert.equal(textes.length, 1);
  assert.equal(textes[0].nom, 'lettre.docx');
  assert.match(textes[0].contenu, /contenu du Word/);
});

/** Un document illisible est signalé, il ne fait pas tomber l'envoi. */
test('une extraction en échec devient un refus', async () => {
  const docx = piece({
    nom: 'vide.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const { textes, refus } = await preparerPieces([docx], async () => {
    throw new Error('document vide');
  });
  assert.equal(textes.length, 0);
  assert.match(refus[0].raison, /illisible/);
});

test('un fichier texte est décodé, pas envoyé en base64', async () => {
  const { textes, inline } = await preparerPieces([
    piece({ nom: 'notes.txt', mimeType: 'text/plain', data: b64('Trois lignes de notes.') })]);
  assert.equal(inline.length, 0);
  assert.match(textes[0].contenu, /Trois lignes de notes/);
});

// ─────────────────────────────────────────────────────── l'annonce

/**
 * LE MODÈLE DOIT SAVOIR QU'IL A QUELQUE CHOSE SOUS LES YEUX.
 *
 * Recevoir les données ne suffit pas : sans annonce, il décrit poliment une
 * capture au lieu de répondre à la question posée dessus.
 */
test('les pièces sont annoncées en français, au bon nombre', () => {
  assert.equal(decrirePieces([{ genre: 'image' }]), 'une image');
  assert.equal(decrirePieces([{ genre: 'image' }, { genre: 'image' }]), '2 images');
  assert.equal(decrirePieces([{ genre: 'pdf' }, { genre: 'son' }]),
    'un PDF et un fichier audio');
  assert.equal(decrirePieces([{ genre: 'image' }, { genre: 'pdf' }, { genre: 'son' }]),
    'une image, un PDF et un fichier audio');
  assert.equal(decrirePieces([], [{ nom: 'a.docx' }]), 'un document');
  assert.equal(decrirePieces([], []), '', 'rien joint : aucune annonce');
});
