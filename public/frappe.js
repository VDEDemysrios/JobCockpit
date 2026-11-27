// LA FRAPPE ANIMÉE : le texte rédigé se révèle au lieu de tomber d'un bloc.
//
// POURQUOI
// --------
// Une lettre arrivait en une fois, quatre cents mots apparus d'un coup après
// dix secondes d'attente. L'œil ne sait pas par où commencer, et rien ne dit
// que le texte vient d'être écrit POUR cette offre plutôt que tiré d'un
// tiroir. Révélé en une seconde, de haut en bas, il se lit dans l'ordre où il
// arrive — et l'attente qui précède prend un sens.
//
// TROIS RÈGLES
// ------------
// · DURÉE BORNÉE, PAS VITESSE FIXE. À vingt caractères par image, une lettre
//   de 2 500 signes prendrait deux secondes, une fiche de révision quinze. On
//   vise une durée (1,1 s par défaut, 2,4 s au plus) et on en déduit le pas.
// · LE TEXTE EST LÀ DÈS LE DÉPART pour qui ne regarde pas : un champ révélé
//   porte sa valeur finale dès qu'on y met le curseur, et une copie pendant la
//   révélation copie TOUT. L'animation embellit, elle n'informe pas.
// · `[data-anim="off"]` et `prefers-reduced-motion` : tout, tout de suite.
//
// Une seule fonction pour un champ (`<textarea>`) et pour du HTML : dans le
// second cas, on vide les nœuds texte et on les remplit dans l'ordre du
// document. Le balisage (gras, listes, titres) est posé d'emblée ; seules les
// lettres arrivent.

/** Le mouvement est-il coupé ? */
export function mouvementCoupe() {
  if (typeof document === 'undefined') return true;
  // Onglet caché : `requestAnimationFrame` n'y tourne pas, la frappe resterait
  // suspendue à mi-mot jusqu'au retour. Autant tout poser d'un coup.
  return document.hidden || document.documentElement.dataset.anim === 'off'
    || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/**
 * Nombre de caractères à ajouter par image pour tenir dans la durée visée.
 * Exportée pour les tests : c'est elle qui empêche une fiche de quinze
 * secondes.
 */
export function pasDeFrappe(longueur, dureeMs = 1100, image = 16) {
  const images = Math.max(1, Math.round(Math.min(dureeMs, 2400) / image));
  return Math.max(1, Math.ceil(longueur / images));
}

/**
 * Révèle `texte` dans un `<textarea>` ou un `<input>`.
 * @returns {Promise<void>} résolue quand tout est affiché
 */
export function taperChamp(champ, texte, { duree = 1100 } = {}) {
  const final = String(texte ?? '');
  if (!champ) return Promise.resolve();
  if (mouvementCoupe() || final.length < 40) { champ.value = final; return Promise.resolve(); }

  return new Promise((resoudre) => {
    const pas = pasDeFrappe(final.length, duree);
    let i = 0;
    let fini = false;
    const terminer = () => {
      if (fini) return;
      fini = true;
      champ.value = final;
      champ.classList.remove('frappe-en-cours');
      champ.removeEventListener('focus', terminer);
      resoudre();
    };
    // Mettre le curseur dans le champ, c'est vouloir le texte entier, tout de suite.
    champ.addEventListener('focus', terminer, { once: true });
    champ.classList.add('frappe-en-cours');
    const image = () => {
      if (fini) return;
      if (!champ.isConnected) return terminer();
      i = Math.min(final.length, i + pas);
      champ.value = final.slice(0, i);
      champ.scrollTop = champ.scrollHeight;
      if (i >= final.length) terminer();
      else requestAnimationFrame(image);
    };
    requestAnimationFrame(image);
  });
}

/**
 * Révèle le contenu texte d'un élément déjà rempli (HTML compris).
 * @returns {Promise<void>}
 */
export function revelerNoeud(el, { duree = 1100 } = {}) {
  if (!el || mouvementCoupe()) return Promise.resolve();
  const marcheur = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const noeuds = [];
  let total = 0;
  for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
    if (!n.nodeValue) continue;
    noeuds.push({ n, texte: n.nodeValue });
    total += n.nodeValue.length;
  }
  if (total < 40) return Promise.resolve();

  noeuds.forEach(x => { x.n.nodeValue = ''; });
  el.classList.add('frappe-en-cours');
  // Annoncé d'un bloc aux lecteurs d'écran : lettre par lettre, ce serait
  // une torture.
  el.setAttribute('aria-busy', 'true');

  return new Promise((resoudre) => {
    const pas = pasDeFrappe(total, duree);
    let k = 0;          // nœud en cours
    let fini = false;
    const terminer = () => {
      if (fini) return;
      fini = true;
      noeuds.forEach(x => { x.n.nodeValue = x.texte; });
      el.classList.remove('frappe-en-cours');
      el.removeAttribute('aria-busy');
      el.removeEventListener('pointerdown', terminer);
      resoudre();
    };
    // Un clic dans le texte en cours de frappe : on veut le lire, pas attendre.
    el.addEventListener('pointerdown', terminer, { once: true });
    const image = () => {
      if (fini) return;
      if (!el.isConnected) return terminer();
      let reste = pas;
      while (reste > 0 && k < noeuds.length) {
        const x = noeuds[k];
        const deja = x.n.nodeValue.length;
        const ajout = Math.min(reste, x.texte.length - deja);
        x.n.nodeValue = x.texte.slice(0, deja + ajout);
        reste -= ajout;
        if (x.n.nodeValue.length >= x.texte.length) k++;
      }
      if (k >= noeuds.length) terminer();
      else requestAnimationFrame(image);
    };
    requestAnimationFrame(image);
  });
}
