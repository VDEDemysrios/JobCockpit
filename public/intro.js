// L'ouverture, façon générique de studio.
//
// CE QUE ÇA JOUE
// --------------
// Des cases de bande dessinée arrivent du fond et passent au ras de la
// caméra, de plus en plus vite ; elles s'effacent, le bloc-titre se pose, un
// flash blanc, et l'application est là. Environ 2,8 secondes.
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

/** Les mots des cases : le vocabulaire de l'application, pas du décor. */
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
];

/** Positions de départ : réparties autour du centre, jamais alignées. */
const TRAJETS = [
  [-38, -26, -14], [34, -20, 11], [-30, 24, 9], [40, 18, -12], [-8, -34, 6],
  [12, 32, -8], [-44, 4, 13], [46, -6, -10], [-16, 38, -7], [20, -40, 8],
];

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

  const scene = document.createElement('div');
  scene.className = 'intro-scene';

  CASES.forEach((c, i) => {
    const [dx, dy, rot] = TRAJETS[i];
    const el = document.createElement('div');
    el.className = 'intro-case';
    el.textContent = c.mot;
    el.style.background = c.fond;
    el.style.color = c.encre ?? '#fff';
    // Chaque case part d'un point différent et arrive à son tour : le décalage
    // est ce qui donne la sensation de traverser une pile de pages.
    el.style.setProperty('--dx', dx + 'vw');
    el.style.setProperty('--dy', dy + 'vh');
    el.style.setProperty('--rot', rot + 'deg');
    el.style.animationDelay = (i * 0.11).toFixed(2) + 's';
    scene.appendChild(el);
  });

  const logo = document.createElement('div');
  logo.className = 'intro-logo';
  logo.innerHTML = '<span>JOB</span><span>COCKPIT</span>';

  const flash = document.createElement('div');
  flash.className = 'intro-flash';

  const passer = document.createElement('button');
  passer.className = 'intro-passer';
  passer.type = 'button';
  passer.textContent = 'Passer';

  ecran.append(scene, logo, flash, passer);
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

    const minuteur = setTimeout(terminer, 2800);
    window.addEventListener('keydown', terminer, true);
    window.addEventListener('pointerdown', terminer, true);
  });
}
