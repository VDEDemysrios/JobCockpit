// Les effets de bande dessinée : onomatopées et bulles.
//
// TOUT CE FICHIER NE S'ACTIVE QU'EN THÈME COMICS.
// Les autres thèmes visent la sobriété d'un outil ; y faire éclater des
// « BADABOUM ! » serait une contradiction. Le garde-fou est unique et placé
// au seul point d'entrée : `onomatopee()` sort immédiatement si le thème
// n'est pas comics ou si les animations sont coupées.
//
// POURQUOI DES ONOMATOPÉES SUR UN OUTIL DE RECHERCHE D'EMPLOI
// -----------------------------------------------------------
// Parce qu'elles ne se déclenchent QUE sur des actes accomplis : une
// candidature envoyée, une lettre écrite, une collecte terminée. Jamais sur
// un affichage, jamais sur un survol, jamais deux fois pour le même geste.
// Une récompense qui se déclenche toute seule cesse d'en être une.

/** Ce qui éclate, et sur quel acte. Une seule entrée par geste réel. */
const MOTS = {
  collecte:    ['BADABOUM !', 'BOUM !', 'TCHAAAC !'],
  candidature: ['PAF !', 'VLAN !', 'SBAM !'],
  lettre:      ['SCRATCH !', 'TCHAC !', 'ZIOU !'],
  ecartee:     ['CRAC !', 'SPLATCH !', 'VLOP !'],
  epingle:     ['TCHIN !', 'PLOC !'],
};

/** Teintes de fond, tirées de la palette comics du thème. */
const TEINTES = ['#ffd21f', '#d51f26', '#1b4fd8', '#0f7d3d'];

const hasard = (liste) => liste[Math.floor(Math.random() * liste.length)];

/**
 * Fait éclater une onomatopée au centre de l'écran.
 *
 * @param {keyof MOTS} acte   le geste accompli
 * @param {string} [precision] petite ligne sous le mot (« 12 nouvelles »)
 */
export function onomatopee(acte, precision = '') {
  const racine = document.documentElement;
  if (racine.dataset.theme !== 'comics') return;
  if (racine.dataset.anim === 'off') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const mots = MOTS[acte];
  if (!mots) return;

  const el = document.createElement('div');
  el.className = 'onoma';
  el.setAttribute('aria-hidden', 'true');   // c'est du décor : rien à annoncer
  el.style.setProperty('--teinte', hasard(TEINTES));
  // L'inclinaison change à chaque fois : deux éclats identiques de suite se
  // remarquent comme une répétition, et l'effet retombe.
  el.style.setProperty('--pivot', (Math.random() * 16 - 8).toFixed(1) + 'deg');
  el.innerHTML = `<span class="onoma-mot">${hasard(mots)}</span>`
    + (precision ? `<span class="onoma-sous">${precision}</span>` : '');

  document.body.appendChild(el);
  // On se raccroche à la fin réelle de l'animation plutôt qu'à un délai
  // recopié à la main : la durée reste définie une seule fois, dans le CSS.
  el.addEventListener('animationend', () => el.remove(), { once: true });
}
