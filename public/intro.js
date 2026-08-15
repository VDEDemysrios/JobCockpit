// L'ouverture : un balayage radar.
//
// POURQUOI UN RADAR, ET PAS UN LOGO QUI APPARAÎT
// ----------------------------------------------
// Une animation d'ouverture qui ne dit rien du produit est une politesse
// coûteuse : on la subit chaque jour sans rien y gagner. Celle-ci montre le
// travail de l'application, littéralement.
//
// Le balayage passe sur une centaine de points — les offres du marché. La
// plupart s'allument une seconde puis s'éteignent : collectées, examinées,
// écartées. Quelques-unes restent et pulsent : celles qui te correspondent.
// C'est exactement ce que fait une collecte, et c'est ce que raconte l'écran.
//
// « Cockpit » n'est pas un nom décoratif non plus — un tableau de bord, des
// instruments, un radar. L'ouverture rejoint enfin le nom.
//
// TROIS RÈGLES, INCHANGÉES
// ------------------------
// · une fois par ouverture (`sessionStorage`) — un F5 en pleine session ne
//   rejoue rien ;
// · sautable au clic, à la touche, par le bouton ;
// · muette si les animations sont coupées ou si le système demande moins de
//   mouvement.

const CLE_SESSION = 'bp_intro_jouee';

/** Durée totale, en millisecondes. Le CSS suit la même horloge. */
const DUREE = 3400;

/** Nombre de points balayés. Assez pour faire foule, pas assez pour ramer. */
const POINTS = 96;

/**
 * Combien de points restent allumés à la fin.
 *
 * Trois, comme la sélection du jour. Ce n'est pas une coïncidence : c'est la
 * promesse de l'outil, montrée avant même qu'il s'ouvre.
 */
const RETENUS = 3;

/**
 * Dispose les points sur le disque du radar.
 *
 * La racine carrée du tirage donne une densité UNIFORME : sans elle, un
 * simple tirage du rayon entasse les points au centre, et le radar a l'air
 * d'avoir un trou sur les bords.
 */
function semerPoints(alea) {
  const points = [];
  for (let i = 0; i < POINTS; i++) {
    const angle = alea() * 360;
    const rayon = Math.sqrt(alea()) * 46 + 3;   // en % du demi-côté
    points.push({
      angle,
      x: 50 + Math.cos(angle * Math.PI / 180) * rayon,
      y: 50 + Math.sin(angle * Math.PI / 180) * rayon,
      // Le point s'allume quand le faisceau l'atteint : son retard est donc
      // sa position angulaire. C'est ce qui rend le balayage crédible — un
      // décalage au hasard donnerait des lucioles, pas un radar.
      retard: (angle / 360) * (DUREE * 0.62),
      taille: 2 + alea() * 2,
    });
  }
  return points;
}

/** Générateur reproductible : la même ouverture d'un lancement à l'autre. */
function tirage(graine) {
  let e = graine;
  return () => {
    e = (e * 1103515245 + 12345) & 0x7fffffff;
    return e / 0x7fffffff;
  };
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

  const scene = document.createElement('div');
  scene.className = 'intro-radar';
  scene.innerHTML = `
    <div class="intro-cercle" style="--taille:32%"></div>
    <div class="intro-cercle" style="--taille:62%;--retard:.08s"></div>
    <div class="intro-cercle" style="--taille:92%;--retard:.16s"></div>
    <div class="intro-croix" aria-hidden="true"></div>
    <div class="intro-faisceau"></div>`;

  const alea = tirage(20260815);
  const points = semerPoints(alea);
  // Les points retenus sont les DERNIERS balayés : ils restent seuls à
  // l'écran quand le faisceau s'achève, et le regard n'a nulle part ailleurs
  // où aller au moment où le titre arrive.
  const retenus = new Set(points
    .map((p, i) => ({ i, angle: p.angle }))
    .sort((a, b) => b.angle - a.angle)
    .slice(0, RETENUS)
    .map(x => x.i));

  for (const [i, p] of points.entries()) {
    const el = document.createElement('span');
    el.className = 'intro-point' + (retenus.has(i) ? ' retenu' : '');
    el.style.cssText = `left:${p.x}%;top:${p.y}%;--r:${p.retard}ms;--d:${p.taille}px`;
    scene.appendChild(el);
  }

  const titre = document.createElement('div');
  titre.className = 'intro-titre';
  titre.innerHTML = '<span class="intro-nom">Job Cockpit</span>'
    + '<span class="intro-baseline">Le marché, filtré pour toi</span>';

  const passer = document.createElement('button');
  passer.className = 'intro-passer';
  passer.type = 'button';
  passer.textContent = 'Passer';

  ecran.append(scene, titre, passer);
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
      // On attend la fin du fondu : retirer l'élément aussitôt ferait
      // disparaître l'écran d'un coup, ce qui se voit.
      setTimeout(() => { ecran.remove(); resoudre(); }, 420);
    };

    const minuteur = setTimeout(terminer, DUREE);
    window.addEventListener('keydown', terminer, true);
    window.addEventListener('pointerdown', terminer, true);
  });
}
