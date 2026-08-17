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

/**
 * LE BALAYAGE — UNE SEULE HORLOGE, ET C'EST TOUT L'ENJEU.
 *
 * LE DÉFAUT QUE CE BLOC CORRIGE. Le faisceau et les points tournaient sur deux
 * horloges séparées. Le faisceau partait de `rotate(-90deg)` à 250 ms, avec un
 * assouplissement ; les points, eux, s'allumaient à `(angle / 360) × 2108 ms`,
 * c'est-à-dire comme si le faisceau démarrait à zéro degré, à zéro seconde, à
 * vitesse constante. Rien ne correspondait : mesuré, **jusqu'à 1,3 seconde
 * d'écart** entre le passage du faisceau et l'allumage du point.
 *
 * La conséquence la plus visible était sur les trois points retenus. Ils
 * étaient choisis comme « les derniers balayés » d'après leur angle — mais
 * dans l'horloge des points, pas dans celle du faisceau. Ils étaient en
 * réalité survolés au milieu du balayage et ne s'allumaient qu'une seconde
 * plus tard, seuls, sans rien pour les désigner. **Le faisceau ne s'arrêtait
 * pas dessus.**
 *
 * Désormais tout descend d'ici : le retard de chaque point est CALCULÉ comme
 * le moment où le bord d'attaque le croise, et ces quatre nombres partent
 * aussi dans le CSS en variables. Une horloge, une source.
 *
 * L'assouplissement du faisceau a disparu au passage, et c'est un gain :
 * une antenne radar tourne à vitesse constante. Une rotation qui accélère
 * puis freine n'était pas seulement fausse à l'œil, elle rendait le retard
 * d'un point impossible à calculer sans inverser une courbe de Bézier.
 */
export const BALAYAGE = {
  debut: 260,      // ms — le temps que les cercles de portée se dessinent
  duree: 2100,     // ms — le tour complet, à vitesse constante
  depart: -90,     // rotation initiale du cadran, en degrés
  // UN TOUR EXACT, PAS 362 DEGRÉS. Les deux degrés de rabiot semblaient
  // anodins : ils faisaient repasser le faisceau sur la zone de départ, si
  // bien qu'un point balayé à la première fraction de seconde se retrouvait
  // pile là où le faisceau s'immobilise — éteint depuis longtemps, et donc
  // ignoré par le second passage. Un tour rond fait correspondre exactement
  // « position sur le cadran » et « moment du balayage ».
  arrivee: 270,
};

/** Durée totale de l'ouverture, en millisecondes. */
const DUREE = 3400;

/** Nombre de points sur le cadran. Assez pour faire foule, pas pour ramer. */
const POINTS = 96;

/**
 * Combien de points restent allumés à la fin.
 *
 * Trois, comme la sélection du jour. Ce n'est pas une coïncidence : c'est la
 * promesse de l'outil, montrée avant même qu'il s'ouvre.
 */
const RETENUS = 3;

/**
 * Le bord d'attaque du faisceau, en degrés « point ».
 *
 * Un dégradé conique part de MIDI et tourne dans le sens horaire ; les points,
 * eux, sont placés en coordonnées ordinaires où zéro degré pointe à DROITE.
 * Les deux repères sont décalés d'un quart de tour, et c'est précisément le
 * genre d'écart qu'on ne voit pas dans le code — seulement à l'écran, sous la
 * forme de points qui s'allument à côté du faisceau.
 */
export const capFaisceau = (rotation) => rotation - 90;

const CAP_DEBUT = capFaisceau(BALAYAGE.depart);
const CAP_FIN = capFaisceau(BALAYAGE.arrivee);
const AMPLITUDE = CAP_FIN - CAP_DEBUT;

/** Combien de degrés de balayage avant que le faisceau atteigne cet angle. */
function ecartDepuisDepart(angle) {
  const e = (angle - CAP_DEBUT) % 360;
  return e < 0 ? e + 360 : e;
}

/** Le moment EXACT où le bord d'attaque croise un point, en millisecondes. */
export function momentBalaye(angle) {
  return BALAYAGE.debut + (ecartDepuisDepart(angle) / AMPLITUDE) * BALAYAGE.duree;
}

/**
 * La fin du balayage est RÉSERVÉE aux trois retenues.
 *
 * Sans cette zone franche, un point ordinaire peut se trouver là où le
 * faisceau s'immobilise. Il s'allume au même instant, de la même façon, et la
 * chute de l'animation — trois points, et trois seulement — se lit comme
 * quatre ou cinq taches.
 */
const RESERVE = 30;

/**
 * Les trois retenues sont POSÉES, pas tirées au sort.
 *
 * Elles sont la chute : le faisceau doit s'arrêter dessus. Aucun tirage ne le
 * garantit, et c'est bien ce qui manquait — les laisser au hasard, c'était
 * accepter qu'une ouverture sur deux ne raconte rien.
 *
 * Chacune est placée juste AVANT l'arrêt, à quelques degrés en arrière du bord
 * d'attaque : elles finissent donc sous la traîne lumineuse, éclairées par le
 * faisceau immobile. Des rayons distincts les empêchent de s'aligner en un
 * trait.
 */
const RETENUES = [
  { recul: 17, rayon: 21 },
  { recul: 10, rayon: 41 },
  { recul: 3, rayon: 31 },
];

const surLeCadran = (angle, rayon) => ({
  x: 50 + Math.cos(angle * Math.PI / 180) * rayon,
  y: 50 + Math.sin(angle * Math.PI / 180) * rayon,
});

/**
 * Dispose les points sur le disque du radar.
 *
 * La racine carrée du tirage donne une densité UNIFORME : sans elle, un
 * simple tirage du rayon entasse les points au centre, et le radar a l'air
 * d'avoir un trou sur les bords.
 */
export function semerPoints(alea) {
  const points = [];

  while (points.length < POINTS - RETENUS) {
    const angle = alea() * 360;
    const rayon = Math.sqrt(alea()) * 46 + 3;   // en % du demi-côté
    // Le tirage est reproductible : cette boucle termine toujours, et elle
    // écarte moins d'un tirage sur douze.
    if (ecartDepuisDepart(angle) > AMPLITUDE - RESERVE) continue;
    points.push({
      angle, retenu: false, taille: 2 + alea() * 2,
      retard: momentBalaye(angle),
      ...surLeCadran(angle, rayon),
    });
  }

  for (const { recul, rayon } of RETENUES) {
    const angle = (CAP_FIN - recul + 360) % 360;
    points.push({
      angle, retenu: true, taille: 3.4,
      retard: momentBalaye(angle),
      ...surLeCadran(angle, rayon),
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

  // L'HORLOGE DU BALAYAGE DESCEND EN CSS, elle n'y est pas recopiée. Les mêmes
  // quatre nombres servent au calcul des retards et à l'animation du faisceau :
  // c'est leur duplication qui avait laissé les deux dériver l'une de l'autre.
  for (const [nom, valeur] of [
    ['--balai-debut', `${BALAYAGE.debut}ms`],
    ['--balai-duree', `${BALAYAGE.duree}ms`],
    ['--balai-depart', `${BALAYAGE.depart}deg`],
    ['--balai-arrivee', `${BALAYAGE.arrivee}deg`],
    // Le titre n'arrive qu'une fois le faisceau à l'arrêt. Pendant le
    // balayage, il partageait l'écran avec ce qu'on est censé regarder.
    ['--titre-retard', `${BALAYAGE.debut + BALAYAGE.duree + 150}ms`],
  ]) ecran.style.setProperty(nom, valeur);

  const scene = document.createElement('div');
  scene.className = 'intro-radar';
  scene.innerHTML = `
    <div class="intro-cercle" style="--taille:32%"></div>
    <div class="intro-cercle" style="--taille:62%;--retard:.08s"></div>
    <div class="intro-cercle" style="--taille:92%;--retard:.16s"></div>
    <div class="intro-croix" aria-hidden="true"></div>
    <div class="intro-faisceau"></div>`;

  for (const p of semerPoints(tirage(20260815))) {
    const el = document.createElement('span');
    el.className = 'intro-point' + (p.retenu ? ' retenu' : '');
    el.style.cssText = `left:${p.x.toFixed(2)}%;top:${p.y.toFixed(2)}%;`
      + `--r:${Math.round(p.retard)}ms;--d:${p.taille.toFixed(1)}px`;
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
