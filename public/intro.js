// L'ouverture, façon générique de studio.
//
// CE QUE ÇA JOUE
// --------------
// Le titre est là dès la première image, et les planches défilent À
// L'INTÉRIEUR DES LETTRES — le texte sert de fenêtre découpée sur la bande
// qui glisse derrière. Puis le défilement ralentit, les lettres se remplissent
// de rouge, un flash blanc, et l'application est là. Environ 3 secondes.
//
// La première version envoyait les cases voler à travers tout l'écran. C'est
// un autre effet, et pas celui-là : ce qui fait le générique, c'est que le
// mouvement soit CONTENU dans la typographie. Hors des lettres, il ne reste
// qu'un carrousel.
//
// COMMENT LE DÉCOUPAGE FONCTIONNE
// -------------------------------
// `background-clip:text` + `color:transparent` : le navigateur ne peint le
// fond que là où il y a du glyphe. Mais il ne clippe QUE le fond de
// l'élément — jamais un enfant du DOM. Une pile de <div> derrière le titre ne
// serait donc pas découpée du tout : elle passerait par-dessus.
//
// D'où la bande construite comme une IMAGE : un SVG en `data:` URI, empilant
// les cases et leurs mots. C'est un vrai `background-image`, donc clippable,
// donc défilable par `background-position` — et sans un seul élément de plus.
//
// Un doublon posé DESSOUS garde la couleur pleine, le cadre et l'ombre
// portée : le titre existe dès la première image, et reste là quand la bande
// s'efface.
//
// TROIS RÈGLES QUI COMPTENT PLUS QUE L'EFFET
// ------------------------------------------
// 1. UNE FOIS PAR OUVERTURE. `sessionStorage` retient que c'est joué : un F5
//    en pleine session de tri ne rejoue rien. C'est la différence entre une
//    intro et une punition.
// 2. TOUJOURS SAUTABLE. Clic, touche, bouton — n'importe quoi l'interrompt,
//    immédiatement. Une animation qu'on ne peut pas couper devient un péage.
// 3. JAMAIS IMPOSÉE. Coupée si les animations sont désactivées dans les
//    Options, ou si le système demande moins de mouvement.
//
// Elle ne bloque rien : l'application se charge DERRIÈRE pendant qu'elle
// joue. Quand elle se retire, tout est déjà prêt.

const CLE_SESSION = 'bp_intro_jouee';

/** Les cases de la bande qui défile derrière les lettres. */
const CASES = [
  { mot: 'OFFRES',      fond: '#d51f26' },
  { mot: 'STRASBOURG',  fond: '#1b4fd8' },
  { mot: 'PRIORITAIRE', fond: '#ffd21f', encre: '#14110d' },
  { mot: 'NANCY',       fond: '#0f7d3d' },
  { mot: 'RELANCE',     fond: '#14110d' },
  { mot: 'LYON',        fond: '#d51f26' },
  { mot: 'ENTRETIEN',   fond: '#1b4fd8' },
  { mot: 'PARIS',       fond: '#ffd21f', encre: '#14110d' },
  { mot: 'LETTRE',      fond: '#c2187f' },
  { mot: 'ÉNERGIE',     fond: '#0f7d3d' },
  { mot: 'CDI',         fond: '#14110d' },
  { mot: 'CANDIDATURE', fond: '#d51f26' },
];

/**
 * La bande dessinée qui défile dans les lettres, en `background-image`.
 *
 * Un SVG plutôt qu'une pile d'éléments : seul un fond peut être découpé par
 * `background-clip:text`. Le ruban se répète verticalement (`repeat-y` côté
 * CSS), donc sa hauteur totale est la seule chose qui doit tomber juste — le
 * raccord se fait tout seul.
 *
 * @returns {string} une valeur `url("data:image/svg+xml,…")`
 */
function bandeDessinee() {
  const L = 760;   // largeur du ruban
  const H = 132;   // hauteur d'une case
  const police = 'Impact,Haettenschweiler,\'Arial Narrow Bold\',sans-serif';

  const cases = CASES.map((c, i) => {
    const y = i * H;
    return `<rect x="0" y="${y}" width="${L}" height="${H}" fill="${c.fond}"/>`
      + `<text x="${L / 2}" y="${y + H * 0.68}" text-anchor="middle" `
      + `font-family="${police}" font-size="${Math.round(H * 0.5)}" `
      + `letter-spacing="2" fill="${c.encre ?? '#ffffff'}">${c.mot}</text>`
      + `<rect x="0" y="${y + H - 6}" width="${L}" height="6" fill="#fffdf4"/>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L}" `
    + `height="${CASES.length * H}" viewBox="0 0 ${L} ${CASES.length * H}">${cases}</svg>`;

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * Joue l'ouverture si les conditions sont réunies.
 *
 * @param {object} [o]
 * @param {boolean} [o.forcer]  rejoue même si déjà vue dans la session
 * @returns {Promise<void>}  résolue quand l'écran est rendu à l'application
 */
export function jouerIntro({ forcer = false } = {}) {
  const animationsCoupees = document.documentElement.dataset.anim === 'off';
  const systemeSobre = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const dejaVue = sessionStorage.getItem(CLE_SESSION) === '1';

  if (!forcer && (animationsCoupees || systemeSobre || dejaVue)) return Promise.resolve();
  sessionStorage.setItem(CLE_SESSION, '1');

  const ecran = document.createElement('div');
  ecran.className = 'intro';
  ecran.setAttribute('role', 'presentation');

  // Le titre en DEUX exemplaires superposés :
  //   · dessous, le bloc plein — couleur, cadre et ombre portée ;
  //   · dessus, le même texte, découpé sur la bande qui défile.
  // Un seul exemplaire obligerait à choisir entre « les planches défilent » et
  // « le titre existe » ; il en faut deux pour avoir les deux.
  const titre = document.createElement('div');
  titre.className = 'intro-titre';
  titre.innerHTML = `
    <div class="intro-plein"><span>JOB</span><span>COCKPIT</span></div>
    <div class="intro-decoupe" aria-hidden="true"><span>JOB</span><span>COCKPIT</span></div>`;
  titre.querySelector('.intro-decoupe').style.backgroundImage = bandeDessinee();

  const flash = document.createElement('div');
  flash.className = 'intro-flash';

  const passer = document.createElement('button');
  passer.className = 'intro-passer';
  passer.type = 'button';
  passer.textContent = 'Passer';

  ecran.append(titre, flash, passer);
  document.body.appendChild(ecran);

  return new Promise((resoudre) => {
    let fini = false;

    const terminer = () => {
      if (fini) return;
      fini = true;
      window.removeEventListener('keydown', terminer, true);
      window.removeEventListener('pointerdown', terminer, true);
      clearTimeout(minuteur);
      ecran.classList.add('intro-sortie');
      // On attend la fin du fondu pour retirer l'élément : le supprimer tout
      // de suite ferait disparaître l'écran d'un coup, ce qui se voit.
      setTimeout(() => { ecran.remove(); resoudre(); }, 460);
    };

    const minuteur = setTimeout(terminer, 3050);
    window.addEventListener('keydown', terminer, true);
    window.addEventListener('pointerdown', terminer, true);
  });
}
