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

// Les cases : des DESSINS, pas des mots.
//
// La version précédente empilait des étiquettes typographiques — « OFFRES »,
// « NANCY » — dans des lettres elles-mêmes typographiques. Du texte dans du
// texte : à cette échelle et à cette vitesse, on ne lisait ni l'un ni
// l'autre. Des silhouettes tiennent la demi-seconde qu'on leur accorde, et
// disent le sujet sans qu'on ait à déchiffrer.
//
// Chaque case est un aplat, une trame de points, un dessin à l'encre. Le
// répertoire est celui du métier — éolien, solaire, réseau — et des quatre
// villes visées.

const CASE_L = 260;   // largeur d'une case, en unités SVG
const CASE_H = 340;   // hauteur d'une case

/**
 * Les dessins. Chacun tient dans un carré de 260 × 340, encre sur aplat.
 * Traits épais et formes pleines : à l'échelle où ils passent, un trait fin
 * disparaît.
 */
const CASES = [
  // Éolienne — le cœur du secteur visé.
  { fond: '#1b4fd8', dessin: `
    <path d="M126 330 L134 330 L131 168 L129 168 Z"/>
    <circle cx="130" cy="160" r="12"/>
    <path d="M130 152 L142 44 L124 40 Z"/>
    <path d="M137 166 L236 196 L240 178 Z"/>
    <path d="M122 166 L34 214 L46 228 Z"/>
    <path d="M60 300 h140" stroke-width="7" stroke-linecap="round"/>` },

  // Panneaux solaires sous le soleil.
  { fond: '#ffd21f', encre: '#14110d', dessin: `
    <circle cx="196" cy="86" r="34"/>
    <path d="M196 30 v-16 M196 158 v16 M140 86 h-16 M252 86 h16
             M156 46 l-12-12 M236 126 l12 12 M236 46 l12-12 M156 126 l-12 12"
          stroke-width="8" stroke-linecap="round"/>
    <path d="M44 268 L96 176 L232 176 L204 268 Z"/>
    <path d="M96 176 L70 268 M164 176 L146 268 M78 222 L218 222"
          stroke="#ffd21f" stroke-width="7"/>
    <path d="M40 292 h190" stroke-width="8" stroke-linecap="round"/>` },

  // Strasbourg — la flèche de la cathédrale.
  { fond: '#d51f26', dessin: `
    <path d="M118 40 L104 92 L104 330 L156 330 L156 92 L142 40 Z"/>
    <path d="M104 132 L44 156 L44 330 L104 330 Z"/>
    <path d="M156 132 L216 156 L216 330 L156 330 Z"/>
    <path d="M122 176 h16 v40 h-16 Z M60 200 h20 v34 h-20 Z M180 200 h20 v34 h-20 Z"
          fill="#d51f26"/>
    <path d="M130 40 v-22" stroke-width="6"/>` },

  // Paris — la tour, en silhouette pleine.
  { fond: '#14110d', dessin: `
    <path d="M130 26 L118 96 L88 220 L52 330 L88 330 L112 250 L148 250
             L172 330 L208 330 L172 220 L142 96 Z"/>
    <path d="M96 200 h68 M78 250 h104" stroke="#14110d" stroke-width="9"/>
    <path d="M118 132 h24" stroke="#14110d" stroke-width="7"/>` },

  // Lyon — Fourvière sur la colline.
  { fond: '#0f7d3d', dessin: `
    <path d="M24 330 C 70 250, 190 250, 236 330 Z"/>
    <path d="M96 268 L96 150 L164 150 L164 268 Z"/>
    <path d="M96 150 L130 108 L164 150 Z"/>
    <path d="M88 150 h84 M104 268 v-46 h20 v46 M136 268 v-46 h20 v46"
          stroke="#0f7d3d" stroke-width="8"/>
    <path d="M130 108 v-30" stroke-width="7"/>` },

  // Nancy — l'arc et la grille dorée de la place Stanislas.
  { fond: '#c2187f', dessin: `
    <path d="M40 330 L40 150 C 40 90, 220 90, 220 150 L220 330 L172 330
             L172 168 C 172 128, 88 128, 88 168 L88 330 Z"/>
    <path d="M56 118 h148" stroke-width="9" stroke-linecap="round"/>
    <path d="M72 96 v-30 M130 88 v-38 M188 96 v-30" stroke-width="7" stroke-linecap="round"/>
    <circle cx="130" cy="42" r="9"/>` },

  // Le réseau : un poste et ses lignes.
  { fond: '#14110d', dessin: `
    <path d="M104 330 L118 110 L142 110 L156 330 Z"/>
    <path d="M60 130 h140 M74 186 h112 M88 244 h84" stroke="#14110d" stroke-width="9"/>
    <path d="M46 96 L214 96" stroke-width="8" stroke-linecap="round"/>
    <path d="M46 96 C 90 138, 170 138, 214 96" stroke-width="6" fill="none"/>
    <circle cx="46" cy="96" r="11"/><circle cx="214" cy="96" r="11"/>
    <path d="M136 40 L112 84 L132 84 L120 122 L152 74 L132 74 Z"/>` },

  // La candidature : l'enveloppe qui part.
  { fond: '#1b4fd8', dessin: `
    <path d="M44 128 h172 v130 h-172 Z"/>
    <path d="M44 128 L130 200 L216 128" stroke="#1b4fd8" stroke-width="9" fill="none"/>
    <path d="M20 292 h96 M44 316 h72" stroke-width="8" stroke-linecap="round"/>
    <path d="M188 62 L206 92 L232 66 L222 104 L248 100 L214 122"
          stroke-width="7" stroke-linecap="round" fill="none"/>` },

  // L'entretien : deux mains qui se serrent.
  { fond: '#ffd21f', encre: '#14110d', dessin: `
    <path d="M24 196 L92 162 L130 186 L168 162 L236 196 L236 232 L168 214
             L130 236 L92 214 L24 232 Z"/>
    <path d="M92 162 v52 M168 162 v52" stroke="#ffd21f" stroke-width="7"/>
    <path d="M60 120 L84 96 M130 108 v-30 M200 120 L176 96"
          stroke-width="8" stroke-linecap="round"/>` },

  // La courbe qui monte.
  { fond: '#d51f26', dessin: `
    <path d="M40 300 h180" stroke-width="8" stroke-linecap="round"/>
    <path d="M40 300 v-190" stroke-width="8" stroke-linecap="round"/>
    <path d="M64 268 h30 v32 h-30 Z M110 216 h30 v84 h-30 Z M156 152 h30 v148 h-30 Z"/>
    <path d="M56 250 L102 200 L148 214 L214 120" stroke-width="9" fill="none"
          stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M186 116 L220 112 L214 148" stroke-width="9" fill="none"
          stroke-linecap="round" stroke-linejoin="round"/>` },
];

/**
 * La planche qui défile dans les lettres, en `background-image`.
 *
 * Un SVG plutôt qu'une pile d'éléments : seul un fond peut être découpé par
 * `background-clip:text`. La bande se répète horizontalement (`repeat-x` côté
 * CSS) — sa largeur totale est donc la seule chose qui doit tomber juste, le
 * raccord se fait tout seul.
 *
 * ELLE DÉFILE DE GAUCHE À DROITE, comme on tourne les pages d'un album. Le
 * sens vertical d'avant était celui d'un générique de fin ; l'horizontale est
 * celle de la lecture.
 *
 * @returns {string} une valeur `url("data:image/svg+xml,…")`
 */
export function bandeDessinee() {
  const total = CASES.length * CASE_L;

  const cases = CASES.map((c, i) => {
    const x = i * CASE_L;
    const encre = c.encre ?? '#fffdf4';
    return `<g transform="translate(${x} 0)">`
      // L'aplat, puis la trame de points par-dessus : c'est elle qui donne le
      // grain d'impression, et elle seule empêche les aplats de faire « à plat ».
      + `<rect width="${CASE_L}" height="${CASE_H}" fill="${c.fond}"/>`
      + `<rect width="${CASE_L}" height="${CASE_H}" fill="url(#trame)" opacity=".5"/>`
      + `<g fill="${encre}" stroke="${encre}" stroke-width="0">${c.dessin}</g>`
      // Le filet blanc qui sépare deux cases : sans lui, les aplats voisins se
      // touchent et la planche devient une bouillie de couleurs.
      + `<rect x="${CASE_L - 7}" width="7" height="${CASE_H}" fill="#fffdf4"/>`
      + `</g>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${CASE_H}" `
    + `viewBox="0 0 ${total} ${CASE_H}">`
    + `<defs><pattern id="trame" width="10" height="10" patternUnits="userSpaceOnUse">`
    + `<circle cx="3" cy="3" r="2.1" fill="#14110d" opacity=".26"/></pattern></defs>`
    + cases + `</svg>`;

  return { image: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, largeur: total };
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
  const bande = bandeDessinee();
  const decoupe = titre.querySelector('.intro-decoupe');
  decoupe.style.backgroundImage = bande.image;
  // La course est calculée d'après la LARGEUR RÉELLE de la planche, pas
  // recopiée à la main dans le CSS. Ajouter une case ne demande donc rien
  // d'autre que de l'ajouter : le défilement reste raccord tout seul.
  decoupe.style.setProperty('--course', `-${bande.largeur}px`);

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
