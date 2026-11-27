// Les messages de l'application — les « toasts ».
//
// CE QUI NE MARCHAIT PAS
// ----------------------
// · Une trentaine d'appels passaient `'erreur'` alors que seul `'err'` était
//   stylé : une erreur Spotify, un entretien impossible, une ville refusée
//   s'affichaient dans le noir neutre d'un simple « c'est fait », préfixés
//   d'une étincelle. On lisait « tout va bien » sur un échec.
// · Les préfixes étaient des emoji (⚠️ 🎉 ✨) : rendus différemment sur chaque
//   système, et au milieu d'un mobilier dessiné en SVG partout ailleurs.
// · Rien n'était annoncé aux lecteurs d'écran, et un message ne se fermait
//   pas : on attendait qu'il parte. Dix messages d'affilée (une collecte qui
//   échoue source par source) recouvraient la moitié de l'écran.
//
// LE CONTRAT, DÉSORMAIS
// ---------------------
// `toast(message, type, action)` garde sa signature historique — les modules
// l'appellent depuis des années — et `type` est NORMALISÉ ici : 'erreur',
// 'error', 'echec' deviennent 'err' ; 'succes', 'ok', 'reussite' deviennent
// 'win'. Une faute de frappe dans un appelant ne peut plus faire mentir la
// couleur.
//
// Le module ne touche au DOM qu'à l'appel : il s'importe sous Node.

import { icone } from './icons.js';

/** Combien de messages à la fois. Au-delà, le plus ancien part. */
export const PILE_MAX = 4;

/** Durées d'affichage, en millisecondes. */
export const DUREES = { '': 3200, info: 3200, win: 3600, err: 6000, action: 7000 };

/**
 * Ramène n'importe quel type d'appelant à l'un des quatre connus.
 * Exportée pour être testée : c'est elle qui empêche une erreur de passer
 * pour une confirmation.
 */
export function normaliserType(type) {
  const t = String(type ?? '').trim().toLowerCase();
  if (['err', 'erreur', 'error', 'echec', 'échec', 'danger'].includes(t)) return 'err';
  if (['win', 'succes', 'succès', 'ok', 'reussite', 'réussite', 'bravo'].includes(t)) return 'win';
  if (['info', 'note'].includes(t)) return 'info';
  return '';
}

const ICONE = { err: 'alerte', win: 'coche', info: 'info', '': 'info' };

/** Le mouvement est-il coupé ? (Options ou réglage système) */
function sobre() {
  return document.documentElement.dataset.anim === 'off'
    || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function zone() {
  const z = document.getElementById('toastZone');
  if (z && !z.hasAttribute('role')) {
    // La zone est une RÉGION annoncée poliment ; chaque erreur, elle, porte
    // `role="alert"` et passe devant ce qui était en cours de lecture.
    z.setAttribute('role', 'region');
    z.setAttribute('aria-label', 'Messages');
  }
  return z;
}

/**
 * Affiche un message.
 *
 * @param {string} message
 * @param {string} [type]      '', 'info', 'win', 'err' (ou leurs synonymes)
 * @param {{libelle: string, faire: () => any}} [action]  bouton « Annuler »…
 * @param {{duree?: number}} [options]
 * @returns {{fermer: () => void}}
 */
export function toast(message, type = '', action = null, options = {}) {
  const z = typeof document !== 'undefined' ? zone() : null;
  if (!z) return { fermer() {} };
  const genre = normaliserType(type);
  const texte = String(message ?? '');

  // LE MÊME MESSAGE DEUX FOIS NE FAIT PAS DEUX LIGNES. Une collecte qui
  // échoue sur trois villes disait trois fois la même chose : on relance le
  // minuteur du message déjà là, et un compteur dit combien.
  const doublon = [...z.children].find(t => t._texte === texte && t._genre === genre && !t._part);
  if (doublon && !action) {
    doublon._compte = (doublon._compte ?? 1) + 1;
    const c = doublon.querySelector('.toast-compte');
    if (c) { c.textContent = `×${doublon._compte}`; c.hidden = false; }
    doublon._relancer?.();
    return { fermer: () => doublon._fermer?.() };
  }

  const t = document.createElement('div');
  t.className = 'toast' + (genre ? ' ' + genre : '');
  t._texte = texte;
  t._genre = genre;
  t.setAttribute('role', genre === 'err' ? 'alert' : 'status');
  t.setAttribute('aria-live', genre === 'err' ? 'assertive' : 'polite');

  const duree = options.duree ?? (action ? DUREES.action : DUREES[genre] ?? DUREES['']);
  t.style.setProperty('--toast-duree', `${duree}ms`);

  t.innerHTML = `<span class="toast-ic" aria-hidden="true">${icone(ICONE[genre], 16)}</span>
    <span class="toast-texte"></span>
    <span class="toast-compte" hidden></span>
    <button type="button" class="toast-fermer" aria-label="Fermer le message">${icone('croix', 14)}</button>
    <span class="toast-temps" aria-hidden="true"></span>`;
  t.querySelector('.toast-texte').textContent = texte;

  // ── Le minuteur, qui sait se suspendre ──────────────────────────────────
  // Survoler un message pour le lire ne doit pas le voir partir sous le
  // curseur. Le temps restant est donc COMPTÉ, pas seulement relancé : une
  // pause de dix secondes ne remet pas le compteur à zéro.
  let restant = duree;
  let depart = 0;
  let minuteur = null;
  const lancer = () => {
    clearTimeout(minuteur);
    depart = Date.now();
    minuteur = setTimeout(fermer, restant);
    t.classList.remove('pause');
  };
  const suspendre = () => {
    clearTimeout(minuteur);
    restant = Math.max(600, restant - (Date.now() - depart));
    t.classList.add('pause');
  };
  t._relancer = () => {
    restant = duree;
    // La barre de temps repart de plein : on retire puis remet l'animation.
    const barre = t.querySelector('.toast-temps');
    barre.style.animation = 'none';
    void barre.offsetWidth;
    barre.style.animation = '';
    lancer();
  };

  function fermer() {
    if (t._part) return;
    t._part = true;
    clearTimeout(minuteur);
    if (sobre()) { t.remove(); return; }
    t.classList.add('sort');
    // `animationend` peut ne jamais venir (onglet caché) : un filet de sûreté.
    const retirer = () => t.remove();
    t.addEventListener('animationend', retirer, { once: true });
    setTimeout(retirer, 400);
  }
  t._fermer = fermer;

  t.querySelector('.toast-fermer').addEventListener('click', fermer);
  t.addEventListener('mouseenter', suspendre);
  t.addEventListener('mouseleave', lancer);
  t.addEventListener('focusin', suspendre);
  t.addEventListener('focusout', lancer);

  // UN MESSAGE PEUT PORTER UNE ISSUE.
  // « Offre écartée » sans retour possible oblige à passer par les Options et
  // à tout remettre — des milliers d'offres pour en récupérer une. Le geste
  // de réparation appartient au moment de l'erreur.
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.type = 'button';
    b.textContent = action.libelle;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await action.faire(); } finally { fermer(); }
    });
    t.querySelector('.toast-compte').before(b);
  }

  z.appendChild(t);

  // La pile est bornée : le plus ancien message encore affiché s'en va.
  const vivants = [...z.children].filter(x => !x._part);
  vivants.slice(0, Math.max(0, vivants.length - PILE_MAX)).forEach(x => x._fermer?.());

  lancer();
  return { fermer };
}
