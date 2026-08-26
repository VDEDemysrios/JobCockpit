// LA PRÉPARATION D'ENTRETIEN : CE QUI CASSERAIT EN SILENCE.
//
// Ces prompts ne lèvent jamais d'erreur quand ils se dégradent : ils
// produisent simplement un jury complaisant, ou des fiches qui décrivent
// quelqu'un d'autre. Rien ne le signale — sauf en entretien réel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  promptQuestion, promptDebrief, promptFiche, promptNotions,
  TYPES_NOTIONS, QUESTIONS_PAR_SEANCE, couper,
} from '../src/entretien.js';

const OFFRE = {
  titre: 'Chargé du contrôle de légalité urbanisme',
  entreprise: 'Préfecture',
  description: 'Contrôle des actes des collectivités en matière d\'urbanisme.'.padEnd(300, ' .'),
};
const ANALYSE = {
  exige: ['Master 2 Droit'],
  prouvable: ['Veille juridique continue'],
  nonprouvable: ['Expérience directe du contrôle de légalité en préfecture'],
};

/**
 * UN JURY COMPLAISANT NE PRÉPARE À RIEN.
 *
 * Toute la valeur de la simulation tient à ce qu'elle pose les questions qui
 * fâchent. Les manques repérés par l'analyse doivent donc atteindre le
 * prompt : sans eux, la séance reste polie, on la termine rassuré, et on
 * découvre la vraie question le jour J.
 */
test('les manques du candidat arrivent jusqu\'au jury', () => {
  const p = promptQuestion(OFFRE, ANALYSE, 'CV', []);
  assert.match(p, /Expérience directe du contrôle de légalité en préfecture/,
    'le manque doit être transmis mot pour mot');
  assert.match(p, /ANGLES D'ATTAQUE DU JURY/,
    'et désigné comme ce qu\'il faut aller chercher');
});

/**
 * C'EST UNE CONVERSATION, PAS UN QUESTIONNAIRE.
 *
 * Un jury qui enchaîne des questions sans réagir à la réponse précédente ne
 * ressemble à rien : en séance réelle, c'est la relance qui déstabilise, pas
 * la question initiale.
 */
test('le jury rebondit sur ce qui vient d\'être dit', () => {
  const p = promptQuestion(OFFRE, ANALYSE, 'CV', [
    { role: 'jury', texte: 'Présentez-vous.' },
    { role: 'candidat', texte: 'Je suis rigoureux.' },
  ]);
  assert.match(p, /CONVERSATION, PAS UN QUESTIONNAIRE/);
  assert.match(p, /CREUSE-LA/, 'une réponse vague doit être creusée, pas contournée');
  assert.match(p, /Je suis rigoureux/, 'la séance complète doit être relue par le jury');
});

/** Une seule question à la fois : sinon on répond à la plus facile. */
test('le jury ne pose qu\'une question à la fois', () => {
  const p = promptQuestion(OFFRE, ANALYSE, 'CV', []);
  assert.match(p, /UNE SEULE question/);
});

/** Le débriefing doit être utilisable : honnête, et adossé au CV réel. */
test('le débriefing est honnête et n\'invente rien', () => {
  const p = promptDebrief(OFFRE, ANALYSE, 'CV', [{ role: 'candidat', texte: 'R' }]);
  assert.match(p, /HONNÊTE/);
  assert.match(p, /Ce qui s'est effondré/);
  assert.match(p, /N'invente aucune expérience/);
});

/**
 * UNE RÉPONSE SUGGÉRÉE N'EST PAS UNE PHRASE DU CANDIDAT.
 *
 * Le débriefing proposait des réponses modèles à la première personne, avec
 * des détails inventés — un volume de projets, une mission jamais exercée. Le
 * candidat les relit comme des citations de lui-même : « ce n'est pas moi qui
 * ai écrit ça ». Une seule phrase de ce genre décrédibilise tout le document,
 * et le pire des cas est qu'il la récite en séance.
 *
 * La trame doit donc s'annoncer comme trame, ne porter aucun fait absent du
 * CV, et laisser un BLANC là où il faudrait un exemple.
 */
test('les réponses suggérées s\'annoncent comme des trames, et laissent les blancs vides', () => {
  const p = promptDebrief(OFFRE, ANALYSE, 'CV', [{ role: 'candidat', texte: 'R' }]);
  assert.match(p, /Trame à t'approprier/,
    'une réponse suggérée doit être étiquetée, sans quoi elle passe pour une citation');
  assert.match(p, /AUCUN fait que le CV ne porte pas/);
  assert.match(p, /ni chiffre, ni volume/,
    'c\'est le chiffre inventé qui trahit le plus vite');
  assert.match(p, /\[ton exemple/,
    'le blanc explicite est le seul substitut honnête à l\'exemple inventé');
  assert.match(p, /reprends ses mots\s+EXACTS/,
    'reformuler en mieux ce que le candidat a dit lui fait croire qu\'il l\'a dit');
});

/**
 * LA FICHE ET LES CARTES SONT LE PLUS EXPOSÉ À L'INVENTION.
 *
 * Un candidat qui récite un article inventé devant un jury juridique ne se
 * rattrape pas. Ce qui n'est pas certain doit donc être marqué comme tel.
 */
test('la fiche impose de distinguer le certain de l\'incertain', () => {
  const p = promptFiche(OFFRE, ANALYSE, 'CV');
  assert.match(p, /à vérifier/);
  assert.match(p, /N'invente jamais/);
});

test('chaque type de carte demande sa propre forme', () => {
  for (const [cle, t] of Object.entries(TYPES_NOTIONS)) {
    const p = promptNotions(OFFRE, ANALYSE, [], cle);
    // Comparaison littérale : les libellés portent apostrophes et accents,
    // qu'une expression régulière obligerait à échapper pour rien.
    assert.ok(p.includes(t.libelle.toUpperCase()),
      `le type ${cle} doit être annoncé au modèle`);
    assert.match(p, /"sur": true ou false/, 'le drapeau de certitude est toujours demandé');
    assert.match(p, /trois phrases MAXIMUM|MAXIMUM/,
      'la brièveté est imposée : au-delà on ne mémorise plus, on lit');
  }
});

/** Les cartes déjà produites ne doivent pas revenir à l'identique. */
test('les doublons déjà vus sont exclus du prompt', () => {
  const p = promptNotions(OFFRE, ANALYSE, ['Déféré préfectoral'], 'jargon');
  assert.match(p, /NE REPRENDS PAS/);
  assert.match(p, /Déféré préfectoral/);
});

/** Le compte de questions sert à l'interface autant qu'au prompt. */
test('la séance a une longueur annoncée', () => {
  assert.ok(QUESTIONS_PAR_SEANCE >= 5 && QUESTIONS_PAR_SEANCE <= 15);
  assert.match(promptQuestion(OFFRE, ANALYSE, 'CV', []),
    new RegExp(`sur ${QUESTIONS_PAR_SEANCE}`));
});

/**
 * LES RECTOS ARRIVAIENT COUPÉS EN PLEIN MOT.
 *
 * Une limite de 120 caractères, tranchée AU CARACTÈRE, sur des « mises en
 * situation » dont le prompt demande deux ou trois phrases :
 *
 *     « …le délai de transmission de 2 mois touche à sa fin ce soir min »
 *     « …contraire au Plan Local d'Urbanisme (PLU) intercommunal da »
 *
 * Deux fautes, et la seconde survit à la première : élargir la limite ne
 * suffit pas, il y aura toujours une carte qui la dépasse et elle sera aussi
 * laide. Rien ne le signale — le texte a juste l'air corrompu.
 */
test('une coupe se voit comme une coupe, pas comme un texte cassé', () => {
  const long = 'Un dossier de permis de construire arrive en préfecture : le délai '
    + 'de transmission de deux mois touche à sa fin ce soir minuit. Que faites-vous ?';

  const r = couper(long, 120);
  assert.ok(r.length <= 120, `${r.length} caractères, la limite est 120`);
  assert.ok(r.endsWith('…'), 'une troncature doit se voir');
  assert.ok(!/\s…$/.test(r), 'pas d\'espace avant les points de suspension');

  // LE POINT CENTRAL : on ne coupe pas au milieu d'un mot.
  const dernier = r.slice(0, -1).trim().split(' ').at(-1);
  assert.ok(long.split(/[\s.,;:]+/).includes(dernier),
    `« ${dernier} » n'est pas un mot entier du texte d'origine`);
});

test('ce qui tient dans la limite n\'est pas touché', () => {
  assert.equal(couper('Court', 120), 'Court');
  assert.equal(couper('  des espaces autour  ', 120), 'des espaces autour');
  assert.equal(couper('', 120), '');
  assert.equal(couper(null, 120), '');
  assert.equal(couper(undefined, 120), '');
});

/** La ponctuation de fin ferait « mot,… », qui se lit comme une faute. */
test('la ponctuation qui précède la coupe est retirée', () => {
  const r = couper('Une phrase qui se termine par une virgule pile ici, et la suite', 52);
  assert.ok(!/[,;:.\s]…$/.test(r), `« ${r.slice(-6)} » garde une ponctuation avant la coupe`);
});

/** Un mot unique plus long que la limite n'a pas d'espace où couper. */
test('un mot interminable est tranché plutôt que rendu entier', () => {
  const r = couper('Motsuperlongsansaucunespacequidepasselalimite', 30);
  assert.ok(r.length <= 30);
  assert.ok(r.endsWith('…'));
});
