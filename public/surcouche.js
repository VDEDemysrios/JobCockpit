// Ouverture et fermeture des surcouches : palette, aide clavier, entretien
// blanc, dialogues, radar de collecte.
//
// CE QUE CE MODULE CORRIGE
// ------------------------
// Les surcouches s'ouvraient par un simple `classList.add('show')`. À
// l'écran, c'était juste ; au clavier, non :
//
//   · une seule chose était focusable DANS la palette, contre vingt-sept
//     derrière elle. Une tabulation depuis le champ de recherche emmenait donc
//     dans la page masquée — on continuait à taper dans le vide ;
//   · la page derrière restait lisible aux lecteurs d'écran ;
//   · à la fermeture, le focus retombait sur `<body>`.
//
// LA PILE (4.0)
// -------------
// Il manquait encore deux choses, et elles venaient du même trou : personne
// ne savait QUELLE surcouche était ouverte.
//
//   · Échap ne fermait pas l'entretien blanc. Seules la palette et l'aide
//     avaient leur ligne dans le gestionnaire de raccourcis ; l'entretien,
//     ouvert depuis un autre module, n'y figurait pas. On restait coincé
//     devant le jury, à chercher le bouton « Fermer » en haut d'une page qui
//     défile.
//   · Les raccourcis agissaient DERRIÈRE les surcouches. Taper « r » dans la
//     boîte de l'entretien (hors du champ) lançait une collecte ; « t »
//     changeait le thème sous la boîte de dialogue.
//
// Les surcouches sont désormais EMPILÉES. Celle du dessus reçoit le clavier,
// Échap ferme celle du dessus et elle seule, et `surcoucheOuverte()` dit au
// gestionnaire de raccourcis de se taire. Une boîte de confirmation ouverte
// par-dessus l'entretien rend l'entretien inerte à son tour : la pile vaut
// pour le pointeur aussi.
//
// LE MÉCANISME : `inert` PLUTÔT QU'UN PIÈGE À TABULATION
// ------------------------------------------------------
// Rendre `.app` inerte retire d'un coup TOUS ses éléments de l'ordre de
// tabulation, du pointeur et de l'arbre d'accessibilité. C'est le navigateur
// qui tient la contrainte. Les surcouches sont des frères de `.app`, jamais
// des enfants : c'est ce qui rend cette approche possible.
//
// Sous Node (tests), le module s'importe sans rien toucher : tout accès au
// document est différé à l'appel.

/** Ce qui avait le focus avant l'ouverture, pour le lui rendre. */
const focusPrecedent = new WeakMap();

/** La pile, du dessous vers le dessus : `{ el, surFermeture, echap }`. */
const pile = [];

/** Vrai si le navigateur sait rendre une sous-arborescence inerte. */
const SAIT_INERTER = typeof HTMLElement !== 'undefined' && 'inert' in HTMLElement.prototype;

const focusablesDe = (racine) => [...racine.querySelectorAll(
  'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
  .filter(e => e.offsetParent !== null && !e.disabled);

/** Le piège à tabulation, uniquement là où `inert` manque. */
function bouclerTabulation(evenement) {
  if (evenement.key !== 'Tab') return;
  const boite = evenement.currentTarget;
  const cibles = focusablesDe(boite);
  if (cibles.length === 0) { evenement.preventDefault(); return; }
  const premier = cibles[0];
  const dernier = cibles[cibles.length - 1];
  if (evenement.shiftKey && document.activeElement === premier) {
    evenement.preventDefault(); dernier.focus();
  } else if (!evenement.shiftKey && document.activeElement === dernier) {
    evenement.preventDefault(); premier.focus();
  }
}

/** Rend inerte tout ce qui n'est pas le dessus de la pile. */
function majInertie() {
  const app = typeof document !== 'undefined' ? document.querySelector('.app') : null;
  const ouverte = pile.length > 0;
  if (app) {
    if (SAIT_INERTER) app.inert = ouverte;
    if (ouverte) app.setAttribute('aria-hidden', 'true');
    else app.removeAttribute('aria-hidden');
  }
  pile.forEach((entree, i) => {
    const dessus = i === pile.length - 1;
    if (SAIT_INERTER) entree.el.inert = !dessus;
  });
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('surcouche-ouverte', ouverte);
  }
}

/**
 * ÉCHAP, POUR TOUTES LES SURCOUCHES, À UN SEUL ENDROIT.
 *
 * Posé en phase de CAPTURE sur le document : il passe avant le gestionnaire
 * de raccourcis d'app.js, et `stopPropagation` l'empêche d'agir derrière.
 *
 * Exception : une saisie EN COURS. Échap dans le champ de réponse de
 * l'entretien, avec trois paragraphes écrits, fermait tout — et la réponse
 * repartait avec la surcouche reconstruite. Le premier Échap quitte le champ,
 * le second ferme.
 */
let ecouteInstallee = false;
function installerEcoute() {
  if (ecouteInstallee || typeof document === 'undefined') return;
  ecouteInstallee = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !pile.length) return;
    const dessus = pile[pile.length - 1];
    if (dessus.echap === false) return;          // la surcouche gère elle-même
    const cible = e.target;
    if (cible instanceof Element && cible.matches('textarea, input[type="text"], input:not([type])')
      && cible.value && dessus.el.contains(cible) && cible !== dessus.focusInitial) {
      e.preventDefault();
      e.stopPropagation();
      cible.blur();
      dessus.el.querySelector('[tabindex="-1"]')?.focus?.();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    fermerSurcouche(dessus.el);
  }, true);
}

/**
 * Ouvre une surcouche et lui confie le clavier.
 *
 * @param {HTMLElement} surcouche
 * @param {object} [o]
 * @param {HTMLElement} [o.focus]        ce qui doit recevoir le focus
 * @param {string} [o.titre]             nom annoncé de la boîte de dialogue
 * @param {() => void} [o.surFermeture]  appelé à la fermeture, quelle qu'en soit la voie
 * @param {boolean} [o.echap]            false : Échap est laissé à la surcouche
 */
export function ouvrirSurcouche(surcouche, { focus, titre, surFermeture, echap = true } = {}) {
  if (!surcouche || surcouche.classList.contains('show')) return;
  installerEcoute();

  focusPrecedent.set(surcouche, document.activeElement);

  // Le rôle est posé ici et non dans le balisage : une boîte de dialogue
  // annoncée en permanence, même fermée, encombre la page pour rien.
  surcouche.setAttribute('role', 'dialog');
  surcouche.setAttribute('aria-modal', 'true');
  if (titre) surcouche.setAttribute('aria-label', titre);

  pile.push({ el: surcouche, surFermeture, echap, focusInitial: focus ?? null });
  majInertie();
  if (!SAIT_INERTER) surcouche.addEventListener('keydown', bouclerTabulation);

  surcouche.classList.add('show');

  // La boîte peut n'avoir aucun élément focusable — l'aide clavier n'est
  // qu'un tableau. On la rend alors focusable elle-même.
  const boite = surcouche.firstElementChild ?? surcouche;
  const cible = focus ?? focusablesDe(surcouche)[0] ?? boite;
  if (cible === boite && !boite.hasAttribute('tabindex')) boite.setAttribute('tabindex', '-1');
  cible.focus?.({ preventScroll: true });
}

/** Referme une surcouche et rend le focus à sa place. */
export function fermerSurcouche(surcouche) {
  if (!surcouche || !surcouche.classList.contains('show')) return;

  const i = pile.findIndex(x => x.el === surcouche);
  const entree = i >= 0 ? pile.splice(i, 1)[0] : null;

  surcouche.classList.remove('show');
  surcouche.removeAttribute('role');
  surcouche.removeAttribute('aria-modal');
  if (SAIT_INERTER) surcouche.inert = false;
  if (!SAIT_INERTER) surcouche.removeEventListener('keydown', bouclerTabulation);
  majInertie();

  // Rendre le focus là où il était : c'est ce qui fait qu'un aller-retour
  // dans la palette ne coûte pas sa place dans la liste.
  const precedent = focusPrecedent.get(surcouche);
  focusPrecedent.delete(surcouche);
  if (precedent && precedent.isConnected && precedent !== document.body) {
    precedent.focus?.({ preventScroll: true });
  }

  try { entree?.surFermeture?.(); } catch { /* un rappel fautif ne bloque pas la fermeture */ }
}

/** Une surcouche est-elle ouverte ? Le gestionnaire de raccourcis se tait alors. */
export function surcoucheOuverte() { return pile.length > 0; }

/** La surcouche qui reçoit le clavier, ou null. */
export function surcoucheDuDessus() { return pile.length ? pile[pile.length - 1].el : null; }

/** Ferme celle du dessus. Rend vrai si quelque chose a été fermé. */
export function fermerDuDessus() {
  const el = surcoucheDuDessus();
  if (!el) return false;
  fermerSurcouche(el);
  return true;
}

/** Nombre de surcouches empilées (tests et diagnostic). */
export function profondeurPile() { return pile.length; }
