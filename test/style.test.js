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
 * L'OUVERTURE : CE QUI LA REND CRÉDIBLE.
 *
 * Le balayage n'a l'air d'un radar que si chaque point s'allume AU MOMENT où
 * le faisceau l'atteint. C'est `--r`, le retard calculé en JS d'après la
 * position angulaire du point, qui l'assure. Sans lui, tous les points
 * clignotent ensemble ou au hasard : on obtient des lucioles, et l'animation
 * ne raconte plus rien.
 *
 * Le masque radial du faisceau est l'autre pièce fragile : sans lui, le
 * dégradé conique déborde en carré et le cadran cesse d'être un cadran.
 *
 * Aucune de ces pannes ne lève d'erreur — on obtient juste une autre
 * animation, moins bonne, sans savoir pourquoi.
 */
test('le balayage garde ce qui le rend crédible', () => {
  const point = css.match(/\.intro-point\{[^}]*\}/s);
  assert.ok(point, 'la règle .intro-point a disparu');
  assert.match(point[0], /animation:radarPoint[^;]*var\(--r\)/,
    'chaque point doit s\'allumer à son propre retard : sinon ils clignotent tous ensemble');

  const faisceau = css.match(/\.intro-faisceau\{[^}]*\}/s);
  assert.ok(faisceau, 'la règle .intro-faisceau a disparu');
  assert.match(faisceau[0], /conic-gradient/,
    'le faisceau est un dégradé conique — c\'est lui qui donne la rémanence');
  assert.match(faisceau[0], /-webkit-mask:radial-gradient|mask:radial-gradient/,
    'sans masque radial, le faisceau déborde en carré');
});

/**
 * Les offres retenues ne s'éteignent pas : elles restent, et c'est la
 * promesse de l'outil montrée avant même qu'il s'ouvre. Une animation
 * `forwards` est ce qui les fait tenir — en `backwards`, elles
 * disparaîtraient avec les autres et le radar ne dirait plus rien.
 */
test('les offres retenues restent allumées à la fin', () => {
  const retenu = css.match(/\.intro-point\.retenu\{[^}]*\}/s);
  assert.ok(retenu, 'la règle des points retenus a disparu');
  assert.match(retenu[0], /animation:radarRetenu[^;]*\bforwards\b/,
    'les points retenus doivent garder leur état final');
});

/** Plus aucune trace de l'ouverture précédente ni du thème comics. */
test('l\'ancienne ouverture et le thème comics ont bien disparu', () => {
  for (const reste of ['intro-decoupe', 'intro-plein', 'intro-case', 'intro-bande', 'data-theme="comics"']) {
    assert.ok(!css.includes(reste), `« ${reste} » traîne encore dans la feuille de style`);
  }
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

/**
 * LE MOUVEMENT CONTINU EST UNE EXCEPTION, ET IL SE PAIE.
 *
 * Le reste de la feuille réserve le mouvement à l'arrivée sur une vue. Ce qui
 * tourne en boucle tourne des heures durant, tous les jours : une animation
 * qui force le navigateur à recalculer la mise en page ou à repeindre une
 * grande surface transforme un tableau de bord en radiateur, sans que rien ne
 * le signale — l'interface reste juste un peu molle, partout.
 *
 * Seules `transform`, `opacity` et `box-shadow` sont admises. Les deux
 * premières sont traitées par le compositeur, sans repeindre ; la troisième
 * repeint, mais elle n'est utilisée que sur une pastille de quelques dizaines
 * de pixels.
 */
test('ce qui tourne en boucle ne fait pas repeindre la page', () => {
  const enBoucle = [...css.matchAll(/animation:\s*([a-zA-Z]+)[^;]*\binfinite\b/g)].map(m => m[1]);
  assert.ok(enBoucle.length > 0, 'plus aucune animation continue — le test ne protège plus rien');

  const ADMISES = new Set(['transform', 'opacity', 'box-shadow', 'background-position']);
  for (const nom of new Set(enBoucle)) {
    const corps = corpsDeKeyframes(nom);
    assert.ok(corps !== null, `@keyframes ${nom} est introuvable : l'animation ne joue pas`);
    for (const [, prop] of corps.matchAll(/[{;]\s*([a-z-]+)\s*:/g)) {
      assert.ok(ADMISES.has(prop),
        `« ${nom} » anime « ${prop} » en boucle : à réécrire en transform/opacity`);
    }
  }
});

/**
 * Extrait le corps d'un `@keyframes` en COMPTANT les accolades.
 *
 * Une expression régulière ne sait pas le faire : les images-clés sont des
 * blocs imbriqués, et la plupart tiennent ici sur une seule ligne. La première
 * version de ce test exigeait un saut de ligne avant l'accolade fermante — elle
 * ne trouvait donc presque aucun bloc, et laissait passer une infraction
 * introduite exprès pour la vérifier. Un test qui ne mord pas est pire que pas
 * de test : il occupe la place et rassure à tort.
 */
function corpsDeKeyframes(nom) {
  const debut = css.search(new RegExp(`@keyframes\\s+${nom}\\s*\\{`));
  if (debut < 0) return null;

  const ouvrante = css.indexOf('{', debut);
  let profondeur = 0;
  for (let i = ouvrante; i < css.length; i++) {
    if (css[i] === '{') profondeur++;
    else if (css[i] === '}' && --profondeur === 0) return css.slice(ouvrante, i + 1);
  }
  return null;
}

/**
 * L'interrupteur des Options doit tout couper, y compris ce qui tourne en
 * boucle. Sans cette règle, désactiver les animations en laisserait quatre
 * tourner — et l'option mentirait.
 */
test('l\'interrupteur des Options coupe aussi le mouvement continu', () => {
  const regle = css.match(/\[data-anim="off"\][^{]*\{[^}]*\}/s);
  assert.ok(regle, 'la règle de coupure a disparu');
  assert.match(regle[0], /animation:\s*none\s*!important/,
    'sans !important, une animation déclarée plus loin gagnerait');
});

/**
 * Le battement du bandeau de veille EST l'information : il s'arrête quand la
 * collecte est périmée. S'il continuait, l'absence de fraîcheur ne se lirait
 * plus que dans la date — et on aurait ajouté du mouvement pour rien.
 */
test('le battement de la veille s\'arrête quand la collecte est périmée', () => {
  assert.match(css, /\.veille-banner::before\{[^}]*animation:halo[^}]*infinite/,
    'le bandeau frais doit respirer');
  assert.match(css, /\.veille-banner\.stale::before\{[^}]*animation:\s*none/,
    'le bandeau périmé doit se figer : c\'est ce qui rend le battement informatif');
});

/** Animer un onglet que personne ne regarde ne coûte que de la batterie. */
test('les animations continues se suspendent quand l\'onglet est caché', () => {
  assert.match(css, /\[data-page="cachee"\][\s\S]{0,220}animation-play-state:\s*paused/,
    'la suspension en arrière-plan a disparu');
});
