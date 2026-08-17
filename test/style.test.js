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

/** Les jeux ont été retirés : leur habillage ne doit pas survivre au code. */
test('plus une règle des jeux retirés', () => {
  for (const reste of ['.ec-plateau', '.dm-case', '.cb-carte', '.jeu-carte', '#cbCanevas']) {
    assert.ok(!css.includes(reste), `« ${reste} » traîne encore dans la feuille de style`);
  }
});

/**
 * TROIS RÈGLES PORTENT À ELLES SEULES LE COMPORTEMENT DU LECTEUR FLOTTANT.
 *
 * Aucune des trois ne se manifeste par une erreur si elle disparaît — on
 * obtient simplement un lecteur qui se tait, ou qui refuse de bouger, et rien
 * ne dit pourquoi. C'est exactement le profil de panne que ce fichier existe
 * pour attraper.
 *
 *   1. Une page inactive s'EFFACE, elle ne se masque pas. `display:none`
 *      détacherait son rendu, et un cadre détaché n'est plus tenu de
 *      continuer à jouer : changer d'onglet couperait la musique.
 *   2. Réduit, le corps passe en `visibility:hidden` pour la même raison —
 *      ranger le lecteur sans couper le son est TOUT l'intérêt du bouton.
 *   3. Les cadres sont neutralisés pendant un glissement. Sans ça, le
 *      pointeur entre dans l'iframe, l'évènement part chez elle, et la
 *      fenêtre se décroche en plein geste.
 */
test('le lecteur flottant garde ce qui le fait jouer et bouger', () => {
  const inactive = css.match(/\.dock-page\{[^}]*\}/s);
  assert.ok(inactive, 'la règle .dock-page a disparu');
  assert.match(inactive[0], /opacity:0/,
    'une page inactive s\'efface : la masquer en display:none couperait le son');
  assert.ok(!/\.dock-page\{[^}]*display:none/s.test(css),
    'display:none sur une page du lecteur arrête la lecture en changeant d\'onglet');

  const reduit = css.match(/\.dock\.reduit \.dock-corps\{[^}]*\}/s);
  assert.ok(reduit, 'la règle du lecteur réduit a disparu');
  assert.match(reduit[0], /visibility:hidden/,
    'réduire doit garder le son : c\'est ce qui le distingue de fermer');
  assert.ok(!/display:\s*none/.test(reduit[0]),
    'display:none ferait taire la musique — c\'est le travail du bouton fermer');

  assert.match(css, /body\.dock-glisse iframe\{[^}]*pointer-events:none/,
    'sans ça, la fenêtre se décroche dès que le pointeur passe sur le cadre');
});

/**
 * LE LECTEUR PASSE SOUS LES SURCOUCHES, JAMAIS DEVANT.
 *
 * Une palette de commandes ou une boîte de dialogue doit pouvoir s'ouvrir
 * par-dessus le lecteur. L'inverse est un piège : on ne verrait plus le champ
 * dans lequel on tape.
 */
test('le lecteur reste sous les surcouches', () => {
  const zDe = (motif) => {
    const r = css.match(motif);
    return r ? Number(r[1]) : null;
  };
  const dock = zDe(/\.dock\{[^}]*z-index:(\d+)/s);
  const overlay = zDe(/\.overlay\{[^}]*z-index:(\d+)/s);
  assert.ok(dock !== null, 'le lecteur n\'a plus de plan');
  assert.ok(overlay !== null, 'les surcouches n\'ont plus de plan');
  assert.ok(dock < overlay,
    `le lecteur (${dock}) passerait devant les surcouches (${overlay})`);
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

/**
 * ON REGARDE TWITCH DANS L'ONGLET TWITCH.
 *
 * Deux règles portent ça, et aucune ne se signale par une erreur si elle
 * saute.
 *
 * 1. Le cadre est posé DANS la page Twitch et HORS de `#twitchPanneau`. Ce
 *    panneau est réécrit à chaque rendu — au retour d'une catégorie, à chaque
 *    actualisation de la liste — et réécrire le HTML autour d'une `<iframe>`
 *    la recharge. Le direct repartirait de zéro sans que rien ne l'explique.
 * 2. Un média Twitch ne part pas dans le cadre partagé. Il y allait, ce qui
 *    faisait basculer sur l'onglet nommé « YouTube » pour regarder Twitch, en
 *    abandonnant la liste où l'on était en train de choisir.
 */
test('Twitch se regarde dans son onglet, et son cadre survit aux rendus', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const page = html.match(/<div class="dock-page" data-page="twitch">[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(page, 'la page Twitch du lecteur a disparu');
  assert.match(page[0], /id="twitchCadre"/, 'l\'onglet Twitch doit avoir son propre cadre');
  assert.ok(page[0].indexOf('twitchCadre') < page[0].indexOf('twitchPanneau'),
    'le cadre est hors du panneau redessiné, sinon chaque rendu recharge la lecture');

  const dock = readFileSync(new URL('../public/dock.js', import.meta.url), 'utf8');
  assert.match(dock, /media\.type === 'Twitch'[\s\S]{0,80}lireTwitch/,
    'un média Twitch part dans l\'onglet Twitch, pas dans le cadre partagé');

  const tw = readFileSync(new URL('../public/twitch-ui.js', import.meta.url), 'utf8');
  const corps = tw.match(/export function rendreTwitch\(\)[\s\S]*?\n}/);
  assert.ok(corps, 'rendreTwitch a disparu');
  assert.ok(!corps[0].includes('twitchCadre') && !corps[0].includes('cadre()'),
    'rendreTwitch ne doit jamais toucher au cadre : il le rechargerait');
  assert.equal((tw.match(/getElementById\('twitchCadre'\)/g) ?? []).length, 1,
    'un seul point d\'accès au cadre — plusieurs finissent par diverger');
});

/**
 * DEUX CADRES NE PARLENT PAS EN MÊME TEMPS. Chacun garde sa lecture en
 * changeant d'onglet — c'est tout l'intérêt du lecteur — mais lancer un direct
 * par-dessus une vidéo donnait deux bandes-son superposées, à couper à la main
 * sur un onglet qu'on venait de quitter.
 */
test('lancer d\'un côté fait taire l\'autre', () => {
  const dock = readFileSync(new URL('../public/dock.js', import.meta.url), 'utf8');
  const tw = readFileSync(new URL('../public/twitch-ui.js', import.meta.url), 'utf8');
  for (const [nom, source] of [['dock.js', dock], ['twitch-ui.js', tw]]) {
    assert.match(source, /addEventListener\('jc:media'/, `${nom} n'écoute plus l'annonce`);
    assert.match(source, /CustomEvent\('jc:media'/, `${nom} n'annonce plus sa lecture`);
  }
});

/**
 * LES LIENS DU LECTEUR TWITCH NE DOIVENT PAS ÉJECTER DE L'APPLICATION.
 *
 * Le bandeau du cadre porte le nom de la chaîne et des boutons d'abonnement.
 * Ces liens sont chez Twitch : rien d'ici ne peut savoir qu'on a cliqué, ni
 * sur quoi — la spécification l'interdit, et c'est ce qui empêche aussi Twitch
 * de lire le tableau de bord. Les rediriger est donc impossible ; les empêcher
 * d'ouvrir le navigateur ne l'est pas.
 *
 * `allow-popups` rouvrirait la porte, `allow-top-navigation` emporterait la
 * page entière. Les quatre gardées sont celles sans lesquelles le lecteur ne
 * joue pas.
 */
test('le cadre Twitch ne peut ni ouvrir de fenêtre ni emporter la page', () => {
  const tw = readFileSync(new URL('../public/twitch-ui.js', import.meta.url), 'utf8');
  const bac = tw.match(/const BAC_A_SABLE = '([^']*)'/);
  assert.ok(bac, 'le bac à sable du cadre Twitch a disparu');

  const permissions = bac[1].split(/\s+/);
  for (const interdite of ['allow-popups', 'allow-top-navigation',
    'allow-popups-to-escape-sandbox', 'allow-top-navigation-by-user-activation']) {
    assert.ok(!permissions.includes(interdite),
      `« ${interdite} » remettrait les liens du bandeau en état d'éjecter hors de l'app`);
  }
  for (const requise of ['allow-scripts', 'allow-same-origin']) {
    assert.ok(permissions.includes(requise), `sans « ${requise} » le lecteur ne joue pas`);
  }
  assert.match(tw, /sandbox="\$\{BAC_A_SABLE\}"/, 'le cadre doit porter le bac à sable');
});

/**
 * LE BANDEAU EST À NOUS, ET IL SE REMPLIT SANS TOUCHER AU CADRE.
 *
 * Le bandeau de Twitch est dans l'iframe : ses liens ne peuvent être ni
 * détournés ni supprimés, seulement rendus inertes — ce qui ne rend pas le
 * geste. Le nôtre porte les mêmes informations une rangée plus haut, avec des
 * boutons qui ouvrent nos vues.
 *
 * Il est FRÈRE de l'iframe, jamais son parent : le remplir doit écrire dans
 * `#twitchBandeau` seul. Repasser par `#twitchCadre` rechargerait la lecture à
 * chaque fois qu'une chaîne se renseigne, c'est-à-dire juste après l'avoir
 * lancée.
 */
test('le bandeau du lecteur Twitch ouvre nos vues, sans recharger le cadre', () => {
  const tw = readFileSync(new URL('../public/twitch-ui.js', import.meta.url), 'utf8');

  const remplir = tw.match(/async function chargerBandeau\([\s\S]*?\n}/);
  assert.ok(remplir, 'chargerBandeau a disparu');
  assert.ok(!remplir[0].includes('twitchCadre'),
    'le bandeau se remplit seul : toucher au cadre relancerait la lecture');
  assert.match(remplir[0], /data-page-chaine=/,
    'le nom de la chaîne doit ouvrir sa page chez nous');
  assert.match(remplir[0], /data-categorie=/,
    'la catégorie doit être parcourable chez nous');

  assert.match(tw, /data-page-chaine[\s\S]{0,200}aller\(\{ nom: 'chaine'/,
    'le clic sur le nom doit mener à la vue chaîne, pas relancer le direct');
});
