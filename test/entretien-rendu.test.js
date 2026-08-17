// LE MARKDOWN DU DÉBRIEFING ET DE LA FICHE.
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Le rendu précédent enchaînait sept expressions régulières et ne connaissait
// que les titres, le gras et les puces. Or les prompts demandent aussi des
// citations `>`, des listes numérotées, de l'italique et des séparateurs
// `---`. Tout cela ressortait BRUT au milieu du texte :
//
//     > *« C'est exact, je n'ai pas exercé en préfecture… »*
//     ---
//     1. Relire les articles L.2131-1 à L.2131-6
//
// Rien ne plantait. On obtenait simplement un mur de ponctuation, et surtout
// la citation `>` — qui porte la RÉPONSE SUGGÉRÉE — ne se distinguait plus de
// ce que le candidat avait réellement dit. D'où « ce n'est pas moi qui ai
// écrit ça ».
//
// Un rendu de texte se dégrade toujours en silence : c'est ce qui rend le test
// nécessaire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendreTexte } from '../public/entretien.js';

test('les titres deviennent des titres, pas des dièses', () => {
  const h = rendreTexte('## Ce qui a tenu\n### Détail');
  assert.match(h, /<h3>Ce qui a tenu<\/h3>/);
  assert.match(h, /<h4>Détail<\/h4>/);
  assert.ok(!h.includes('##'), 'aucun dièse ne doit survivre');
});

/**
 * LA CITATION EST LE CAS LE PLUS IMPORTANT. C'est elle qui porte la trame de
 * réponse suggérée : rendue en texte courant, elle se lit comme une phrase du
 * candidat.
 */
test('une citation devient un bloc, et plusieurs lignes n\'en font qu\'un', () => {
  const h = rendreTexte('> première ligne\n> seconde ligne\n\nSuite.');
  assert.equal((h.match(/<blockquote>/g) ?? []).length, 1,
    'deux lignes de citation forment UN bloc, pas deux');
  assert.match(h, /<\/blockquote>/);
  assert.ok(!h.includes('&gt; '), 'le chevron ne doit pas rester dans le texte');
  assert.match(h, /<p>Suite\.<\/p>/, 'la ligne vide referme la citation');
});

test('les deux sortes de listes sont rendues', () => {
  const puces = rendreTexte('- un\n- deux');
  assert.match(puces, /<ul><li>un<\/li><li>deux<\/li><\/ul>/);

  const numeros = rendreTexte('1. un\n2. deux');
  assert.match(numeros, /<ol><li>un<\/li><li>deux<\/li><\/ol>/);
  assert.ok(!numeros.includes('1.'), 'la numérotation vient de la balise, pas du texte');
});

test('le séparateur devient un trait', () => {
  assert.match(rendreTexte('a\n\n---\n\nb'), /<hr>/);
  assert.ok(!rendreTexte('---').includes('---'));
});

/**
 * L'italique se pose APRÈS le gras et exige une étoile isolée. Écrit dans
 * l'autre ordre, `**gras**` se fait manger par le motif de l'italique et
 * ressort en `<em>*texte*</em>`.
 */
test('gras et italique cohabitent sans se manger', () => {
  assert.match(rendreTexte('**gras** et *penché*'),
    /<strong>gras<\/strong> et <em>penché<\/em>/);
  assert.match(rendreTexte('**gras seul**'), /<strong>gras seul<\/strong>/);
  assert.ok(!rendreTexte('**gras seul**').includes('<em>'),
    'le gras ne doit pas être coupé en italiques');
});

/**
 * LE TEXTE VIENT D'UN MODÈLE, DONC D'AILLEURS. Il est inséré en `innerHTML` :
 * une balise qui passe est une injection dans une page qui affiche des
 * candidatures et un CV.
 */
test('le contenu est échappé avant tout rendu', () => {
  const h = rendreTexte('## <script>alert(1)</script>\n- <img src=x onerror=alert(1)>');
  assert.ok(!h.includes('<script'), 'aucune balise du modèle ne doit survivre');
  assert.ok(!h.includes('<img'), 'ni image, ni gestionnaire d\'évènement');
  assert.match(h, /&lt;script&gt;/);
});

/** Un texte vide ou absent ne doit pas produire de balise orpheline. */
test('rien à rendre ne rend rien', () => {
  assert.equal(rendreTexte(''), '');
  assert.equal(rendreTexte(null), '');
  assert.equal(rendreTexte(undefined), '');
});

/** Tous les blocs se referment : un `<ul>` ouvert avale la suite de la page. */
test('chaque bloc ouvert est refermé', () => {
  const h = rendreTexte('## T\n- a\n1. b\n> c\ntexte\n\n## Fin');
  for (const balise of ['ul', 'ol', 'blockquote', 'p']) {
    const ouverts = (h.match(new RegExp(`<${balise}>`, 'g')) ?? []).length;
    const fermes = (h.match(new RegExp(`</${balise}>`, 'g')) ?? []).length;
    assert.equal(ouverts, fermes, `${balise} : ${ouverts} ouvert(s), ${fermes} fermé(s)`);
  }
});

/**
 * Le cas réel qui a motivé tout ceci : un extrait de débriefing, avec ses
 * quatre formes de balisage mélangées. Aucune marque de markdown ne doit
 * subsister à l'écran.
 */
test('un débriefing complet ne laisse aucune marque brute', () => {
  const h = rendreTexte([
    '## Ce qui s\'est effondré',
    '',
    '- **La question du jury** : *« Vous n\'avez pas d\'expérience… »*',
    '- **Trame à t\'approprier** :',
    '',
    '> « C\'est exact, je n\'ai pas exercé en préfecture. »',
    '> *À vérifier avant de la dire : les dates.*',
    '',
    '---',
    '',
    '1. Relire les articles L.2131-1 à L.2131-6',
    '2. Structurer un cas pratique',
  ].join('\n'));

  for (const brut of ['##', '**', '\n- ', '\n> ', '---', '\n1. ']) {
    assert.ok(!h.includes(brut), `« ${brut.trim()} » traîne encore dans le rendu`);
  }
  assert.match(h, /<h3>/);
  assert.match(h, /<blockquote>/);
  assert.match(h, /<hr>/);
  assert.match(h, /<ol>/);
  // L'apostrophe est échappée en `&#39;` : c'est justement ce qu'on veut, le
  // texte vient d'un modèle et part en `innerHTML`.
  assert.match(h, /<strong>Trame à t&#39;approprier<\/strong>/);
});
