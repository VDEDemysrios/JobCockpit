import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

/**
 * Retire les commentaires et rend la liste des lignes utiles, avec leur
 * numéro d'origine — un rapport d'erreur sans numéro de ligne dans un fichier
 * de 1 000 lignes ne sert à rien.
 */
function lignesUtiles() {
  const brutes = css.split(/\r?\n/);
  const out = [];
  let dansCommentaire = false;

  brutes.forEach((brute, i) => {
    let t = brute;
    if (dansCommentaire) {
      if (!t.includes('*/')) return;
      t = t.slice(t.indexOf('*/') + 2);
      dansCommentaire = false;
    }
    t = t.replace(/\/\*[\s\S]*?\*\//g, '');
    if (t.includes('/*')) { dansCommentaire = true; t = t.slice(0, t.indexOf('/*')); }
    if (t.trim()) out.push({ n: i + 1, t });
  });

  return out;
}

/**
 * LE BUG QUE CE TEST EXISTE POUR ATTRAPER.
 *
 * Le retrait de la gamification a supprimé des sélecteurs en laissant leur
 * CORPS derrière : « text-shadow:…; animation:flotte…; } » orphelin après une
 * règle déjà fermée.
 *
 * Ces déclarations ne sont PAS inertes. Le parseur CSS, ne pouvant pas les
 * rattacher, les recolle au sélecteur SUIVANT — qui devient invalide et est
 * jeté avec elles. C'est ainsi que la règle `.overlay` a disparu : la palette
 * de commandes et l'aide clavier, privées de `position:fixed` et de
 * `display:none`, s'affichaient en permanence au milieu de la page.
 *
 * Rien ne le signalait : pas d'erreur console, pas de test en échec, et le
 * reste de la feuille continuait de fonctionner.
 */
test('aucune accolade fermante en trop dans style.css', () => {
  let profondeur = 0;
  const fautes = [];

  for (const { n, t } of lignesUtiles()) {
    for (const c of t) {
      if (c === '{') profondeur++;
      else if (c === '}') {
        profondeur--;
        if (profondeur < 0) { fautes.push(n); profondeur = 0; }
      }
    }
  }

  assert.deepEqual(fautes, [],
    `Accolade fermante sans ouvrante — un corps de règle a survécu à son sélecteur.\n`
    + `Le parseur avalera le sélecteur suivant. Lignes : ${fautes.join(', ')}`);
  assert.equal(profondeur, 0, `${profondeur} accolade(s) jamais refermée(s)`);
});

test('aucune déclaration hors de toute règle', () => {
  let profondeur = 0;
  const orphelines = [];

  for (const { n, t } of lignesUtiles()) {
    const avant = profondeur;
    profondeur += (t.match(/\{/g) ?? []).length;
    profondeur -= (t.match(/\}/g) ?? []).length;
    if (profondeur < 0) profondeur = 0;

    // Au niveau zéro, une ligne « propriete: valeur » sans accolade ouvrante
    // est le corps d'une règle dont le sélecteur a disparu.
    if (avant === 0 && !t.includes('{') && /^\s*[-a-z]+\s*:/i.test(t)) {
      orphelines.push(`${n}: ${t.trim().slice(0, 70)}`);
    }
  }

  assert.deepEqual(orphelines, [],
    `Déclaration(s) orpheline(s) :\n  ${orphelines.join('\n  ')}`);
});

// Ces trois règles portent à elles seules le comportement des surcouches.
// Perdre l'une d'elles laisse la palette ou l'aide clavier affichées en
// permanence, ce qui rend l'application inutilisable sans rien casser
// d'assez visible pour qu'on cherche la cause au bon endroit.
test('les règles vitales des surcouches sont présentes', () => {
  for (const [nom, motif] of [
    ['.overlay (base)', /\.overlay\{[^}]*position:fixed[^}]*display:none/],
    ['.overlay.show',   /\.overlay\.show\{[^}]*display:flex/],
    ['.palette-box',    /\.palette-box\{/],
  ]) {
    assert.match(css, motif, `règle manquante ou altérée : ${nom}`);
  }
});

/**
 * LE CADRE NE DOIT JAMAIS SE METTRE À GRANDIR.
 *
 * Trois zones grandissent avec les données : la file du focus, les colonnes du
 * Kanban, et la vue active. Sans plafond, elles poussent la page — c'est ce
 * qui donnait un tableau de bord de 4 200 px et un Kanban « qui descend super
 * bas ». Chacune doit donc défiler CHEZ ELLE.
 *
 * `min-height:0` est la moitié qu'on oublie : sans lui un enfant de flex
 * refuse de rétrécir sous son contenu, et `overflow` ne sert à rien.
 */
/**
 * LE DÉCOUPAGE TYPOGRAPHIQUE DE L'OUVERTURE.
 *
 * Le générique tient à ce que les planches défilent DANS les lettres. Trois
 * déclarations le portent, et chacune casse l'effet d'une manière différente
 * et silencieuse si elle disparaît :
 *
 *   · `background-clip:text` — sans lui, la bande s'affiche en plein rectangle
 *     et recouvre le titre.
 *   · `color:transparent` — sans lui, les lettres restent pleines et la bande
 *     n'apparaît nulle part.
 *   · `repeat-y` — sans lui, le ruban se termine à mi-course et les lettres
 *     deviennent vides pendant la seconde moitié du défilement.
 *
 * Aucune de ces pannes ne produit d'erreur : on obtient juste une autre
 * animation, moins bonne, sans savoir pourquoi.
 */
test('l\'ouverture découpe bien la bande dans les lettres', () => {
  // `.intro-decoupe` apparaît dans plusieurs règles, dont une partagée avec
  // `.intro-plein`. On réunit tous les corps qui la ciblent : chercher la
  // « première » attrapait la règle de mise en page et concluait à tort que
  // le découpage avait disparu.
  const corps = [...css.matchAll(/([^{}]*\.intro-decoupe[^{}]*)\{([^}]*)\}/g)]
    .map(m => m[2]).join(';');
  assert.ok(corps, 'aucune règle ne cible .intro-decoupe');
  const regle = [corps];
  for (const [nom, motif] of [
    ['background-clip:text', /background-clip:text/],
    ['color:transparent',    /color:transparent/],
    ['repeat-x',             /background-repeat:repeat-x/],
  ]) {
    assert.match(regle[0], motif, `.intro-decoupe a perdu ${nom}`);
  }
  // Le bloc plein posé DESSOUS : c'est lui qui reste quand la couche découpée
  // s'efface. Sans lui, le générique se termine sur un titre invisible.
  assert.match(css, /\.intro-plein\{[^}]*background:#d51f26/,
    'le bloc-titre plein doit subsister sous la couche découpée');
});

test('le thème comics est défini et reste isolé', () => {
  assert.match(css, /\[data-theme="comics"\]\{[^}]*--line:#14110d/,
    'le thème comics doit poser une couleur d\'encre comme trait');
  // La titraille change de police ; le corps de texte, jamais. Une liste de
  // 282 offres en Impact serait illisible.
  assert.doesNotMatch(css, /\[data-theme="comics"\]\s+body\{[^}]*font-family/,
    'le thème comics ne doit pas changer la police du corps de texte');
});

test('les zones qui grandissent avec les données sont bornées', () => {
  for (const [nom, motif] of [
    ['html,body sans défilement', /html,\s*body\{[^}]*overflow:hidden/],
    ['.main peut rétrécir',       /\.main\{[^}]*min-height:0/],
    ['.view défile chez elle',    /\.view\{[^}]*min-height:0[^}]*overflow-y:auto/],
    ['#focusList borné',          /#focusList\{[^}]*max-height:[^}]*overflow-y:auto/],
    ['.kcol-liste défile',        /\.kcol-liste\{[^}]*overflow-y:auto/],
  ]) {
    assert.match(css, motif, `garde-fou de hauteur perdu : ${nom}`);
  }
});
