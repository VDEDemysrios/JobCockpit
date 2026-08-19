// LA VUE CHILL : reconnaissance des liens, et registre du compagnon.
//
// Ces deux-là se dégradent sans rien signaler : un lien mal reconnu ouvre un
// cadre vide, et un compagnon qui glisse vers le coaching transforme la seule
// vue où l'on ne se fait pas houspiller en énième rappel à l'ordre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptChat, resumeEtat, TOURS_MAX, validerImages } from '../src/chat.js';

/**
 * LE COMPAGNON N'EST PAS LE JURY D'ENTRETIEN.
 *
 * Le jury est là pour mettre en difficulté ; celui-ci écoute. Confondre les
 * deux registres donnerait un coach qui ramène tout à la candidature —
 * exactement ce qu'on fuit en ouvrant cette vue.
 */
test('le compagnon ne ramène pas la conversation au travail', () => {
  const p = promptChat([{ role: 'moi', texte: 'J\'ai vu un bon film hier.' }], '', {});
  assert.match(p, /Tu parles de CE DONT IL PARLE/);
  assert.match(p, /ne ramènes pas la conversation à sa recherche d'emploi/);
  assert.match(p, /tu ne le pousses PAS à candidater/i);
});

/** Une réponse qui se termine sur elle-même arrête la conversation. */
test('le compagnon relance', () => {
  const p = promptChat([{ role: 'moi', texte: 'Salut' }], '', {});
  assert.match(p, /Tu RELANCES/);
  assert.match(p, /avis/);
});

/** Court, sans mise en forme : on discute, on ne lit pas un rapport. */
test('le registre est celui d\'un message, pas d\'un rapport', () => {
  const p = promptChat([{ role: 'moi', texte: 'Salut' }], '', {});
  assert.match(p, /Pas de listes à puces/);
  assert.match(p, /Deux ou trois phrases/);
});

/**
 * IL SAIT, MAIS IL N'INVENTE PAS. Le contexte lui donne des ordres de
 * grandeur ; tout le reste doit être demandé plutôt que fabriqué.
 */
test('le contexte transmet la situation sans inventer', () => {
  const c = resumeEtat({
    offres: [{ groupe: 1 }, { groupe: 1 }, { groupe: 2 }],
    candidatures: 3,
    entretiens: [{ titre: 'Chargé de mission', entreprise: 'Préfecture', jours: 9 }],
  });
  assert.match(c, /3 offres/);
  assert.match(c, /2 prioritaires/);
  assert.match(c, /3 candidature/);
  assert.match(c, /ENTRETIEN.*Chargé de mission.*9 jour/);

  const p = promptChat([{ role: 'moi', texte: 'ça va ?' }], c, {});
  assert.match(p, /Chargé de mission/, 'le contexte doit atteindre le prompt');
  assert.match(p, /N'INVENTES JAMAIS|n'inventes jamais|CE QUE TU N'INVENTES JAMAIS/);
});

/** L'historique est borné : au-delà on paie des jetons pour du vieux. */
test('l\'historique transmis est borné', () => {
  const longs = Array.from({ length: TOURS_MAX + 20 },
    (_, i) => ({ role: 'moi', texte: `message numéro ${i}` }));
  const p = promptChat(longs, '', {});
  assert.ok(!p.includes('message numéro 0'), 'les plus vieux tours doivent tomber');
  assert.ok(p.includes(`message numéro ${longs.length - 1}`), 'le dernier tour doit rester');
});

/** Une conversation qui commence ne doit pas ressembler à une erreur. */
test('une conversation vide est annoncée comme telle', () => {
  assert.match(promptChat([], '', {}), /elle commence/);
});

// ─────────────────────────── L'image jointe ───────────────────────────
//
// On peut enfin coller une capture (offre, mail) dans le chat. La validation
// vit côté serveur : une image mal formée ne doit ni partir chez Gemini ni
// saturer la mémoire — mais elle ne doit pas non plus faire échouer le
// message, on la laisse tomber et la conversation continue en texte.

test('une image bien formée est acceptée', () => {
  const im = validerImages({ mimeType: 'image/png', data: 'iVBORw0KGgoAAAANS' });
  assert.equal(im.length, 1);
  assert.equal(im[0].mimeType, 'image/png');
});

test('ce qui n\'est pas une image propre est écarté, sans lever', () => {
  assert.deepEqual(validerImages(null), []);
  assert.deepEqual(validerImages('pas un objet'), []);
  assert.deepEqual(validerImages({ mimeType: 'application/pdf', data: 'abc' }), [],
    'un PDF n\'est pas une image');
  assert.deepEqual(validerImages({ mimeType: 'image/png', data: '' }), [], 'donnée vide');
  assert.deepEqual(validerImages({ mimeType: 'image/png', data: 'a b!' }), [],
    'du base64 avec espace ou caractère interdit est refusé');
  assert.deepEqual(validerImages({ mimeType: 'image/png', data: 'x'.repeat(9_000_000) }), [],
    'trop lourde : au-delà de la borne, on refuse d\'envoyer');
});

/**
 * QUAND UNE IMAGE EST JOINTE, LE MODÈLE DOIT LE SAVOIR — sinon il reçoit des
 * pixels sans consigne de les regarder, et répond parfois comme s'il n'y avait
 * rien.
 */
test('le prompt signale la présence d\'une image', () => {
  const avec = promptChat([{ role: 'moi', texte: 'regarde' }], '', { avecImage: true });
  const sans = promptChat([{ role: 'moi', texte: 'salut' }], '', { avecImage: false });
  assert.match(avec, /UNE IMAGE EST JOINTE/);
  assert.ok(!/UNE IMAGE EST JOINTE/.test(sans));
});
