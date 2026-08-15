// Ouverture et fermeture des surcouches : palette de commandes, aide clavier.
//
// CE QUE CE MODULE CORRIGE
// ------------------------
// Les deux surcouches s'ouvraient par un simple `classList.add('show')`. À
// l'écran, c'était juste ; au clavier, non :
//
//   · une seule chose était focusable DANS la palette, contre vingt-sept
//     derrière elle. Une tabulation depuis le champ de recherche emmenait donc
//     dans la page masquée — on continuait à taper dans le vide, sans rien
//     comprendre ;
//   · la page derrière restait entièrement lisible aux lecteurs d'écran, qui
//     annonçaient une liste d'offres invisible par-dessus la boîte de dialogue ;
//   · à la fermeture, le focus retombait sur `<body>` au lieu de revenir là
//     où on l'avait laissé. Un aller-retour dans la palette faisait perdre sa
//     place dans la liste.
//
// LE MÉCANISME : `inert` PLUTÔT QU'UN PIÈGE À TABULATION
// ------------------------------------------------------
// Rendre `.app` inerte retire d'un coup TOUS ses éléments de l'ordre de
// tabulation, du pointeur et de l'arbre d'accessibilité. C'est le navigateur
// qui tient la contrainte, pas une boucle de rattrapage sur `Tab` — laquelle
// oublie toujours un cas (les liens dans une carte dépliée, les champs d'un
// formulaire ouvert, une iframe).
//
// Les surcouches sont des frères de `.app` dans le balisage, jamais des
// enfants : c'est ce qui rend cette approche possible. Les déplacer dedans
// les rendrait inertes elles aussi.

/** Ce qui avait le focus avant l'ouverture, pour le lui rendre. */
const focusPrecedent = new WeakMap();

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

/**
 * Ouvre une surcouche et lui confie le clavier.
 *
 * @param {HTMLElement} surcouche
 * @param {object} [o]
 * @param {HTMLElement} [o.focus]  ce qui doit recevoir le focus ; à défaut, le
 *                                 premier élément focusable, sinon la boîte.
 * @param {string} [o.titre]       nom annoncé de la boîte de dialogue
 */
export function ouvrirSurcouche(surcouche, { focus, titre } = {}) {
  if (!surcouche || surcouche.classList.contains('show')) return;

  focusPrecedent.set(surcouche, document.activeElement);

  // Le rôle est posé ici et non dans le balisage : une boîte de dialogue
  // annoncée en permanence, même fermée, encombre la page pour rien.
  surcouche.setAttribute('role', 'dialog');
  surcouche.setAttribute('aria-modal', 'true');
  if (titre) surcouche.setAttribute('aria-label', titre);

  const app = document.querySelector('.app');
  if (app) {
    if (SAIT_INERTER) app.inert = true;
    app.setAttribute('aria-hidden', 'true');
  }
  if (!SAIT_INERTER) surcouche.addEventListener('keydown', bouclerTabulation);

  surcouche.classList.add('show');

  // La boîte peut n'avoir aucun élément focusable — l'aide clavier n'est
  // qu'un tableau. On la rend alors focusable elle-même, sinon le focus
  // resterait dans la page inerte et le clavier ne répondrait plus.
  const boite = surcouche.firstElementChild ?? surcouche;
  const cible = focus ?? focusablesDe(surcouche)[0] ?? boite;
  if (cible === boite && !boite.hasAttribute('tabindex')) boite.setAttribute('tabindex', '-1');
  cible.focus?.();
}

/** Referme une surcouche et rend le focus à sa place. */
export function fermerSurcouche(surcouche) {
  if (!surcouche || !surcouche.classList.contains('show')) return;

  surcouche.classList.remove('show');
  surcouche.removeAttribute('role');
  surcouche.removeAttribute('aria-modal');
  if (!SAIT_INERTER) surcouche.removeEventListener('keydown', bouclerTabulation);

  const app = document.querySelector('.app');
  if (app) {
    if (SAIT_INERTER) app.inert = false;
    app.removeAttribute('aria-hidden');
  }

  // Rendre le focus là où il était : c'est ce qui fait qu'un aller-retour
  // dans la palette ne coûte pas sa place dans la liste.
  const precedent = focusPrecedent.get(surcouche);
  focusPrecedent.delete(surcouche);
  if (precedent && precedent.isConnected && precedent !== document.body) precedent.focus?.();
}
