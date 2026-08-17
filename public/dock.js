// Le lecteur flottant : une fenêtre qu'on pose où l'on veut, et qui reste.
//
// CE QUI NE MARCHAIT PAS, ET POURQUOI
// -----------------------------------
// Le lecteur vivait DANS la vue « Chill ». Trois conséquences, toutes
// mauvaises :
//
//   · changer d'onglet reconstruisait la vue, donc le cadre, donc la lecture
//     repartait de zéro — on ne pouvait pas écouter quelque chose en triant
//     ses offres, c'est-à-dire pendant exactement les seuls moments où on en
//     avait envie ;
//   · le panneau était posé dans une grille : il ne se déplaçait pas, ne se
//     mettait pas dans un coin, ne se réduisait pas ;
//   · il occupait une demi-colonne en permanence, même éteint.
//
// LE MÉCANISME : ÊTRE FRÈRE DE `.app`, JAMAIS SON ENFANT
// -------------------------------------------------------
// C'est toute l'astuce, et elle est structurelle plutôt qu'astucieuse. Le
// balisage du dock est un frère de `.app` dans la page — comme les surcouches.
// `rendreTout()` ne le touche donc jamais : le cadre n'est ni détruit, ni
// déplacé, ni re-parenté. Or **re-parenter une `<iframe>` la recharge** — la
// spécification l'impose, et c'est ce qui condamnait toute tentative de « le
// déplacer dans le bon conteneur ».
//
// Deuxième conséquence, gratuite : `ouvrirSurcouche` rend `.app` inerte. Un
// dock posé dedans deviendrait inerte avec elle, et on ne pourrait plus
// mettre en pause pendant qu'une boîte de dialogue est ouverte.
//
// POURQUOI LES ONGLETS NE SONT PAS EN `display:none`
// ---------------------------------------------------
// Passer une page inactive en `display:none` détache son rendu, et un cadre
// détaché n'est plus tenu de continuer à jouer. Les pages sont donc
// superposées et l'inactive passe en `opacity:0` : elle reste rendue, le son
// continue. C'est la même raison qui fait que « réduire » masque le corps en
// `visibility:hidden` plutôt qu'en `display:none` — réduire doit garder le
// son, c'est tout son intérêt. Seul « fermer » arrête vraiment.
import { versLecteur, sansDemarrageAuto } from './media.js';
import { echapper } from './format.js';
import { installerSpotify, ouvrirSpotify } from './spotify-ui.js';
import { installerTwitch, ouvrirTwitch, lireTwitch } from './twitch-ui.js';
import { installerYoutube, ouvrirYoutube } from './youtube-ui.js';

const CLE_CADRE = 'bp_dock_cadre';     // position et taille
const CLE_OUVERT = 'bp_dock_ouvert';
const CLE_REDUIT = 'bp_dock_reduit';
const CLE_PAGE = 'bp_dock_page';
const CLE_MEDIA = 'bp_dock_media';
const CLE_COMPTE = 'bp_dock_compte';   // session YouTube plutôt que -nocookie

const MARGE = 8;
/** En deçà, le bord se colle : poser une fenêtre à 3 px du bord est pénible. */
const AIMANT = 18;
const MIN_L = 300;
/** En deçà, le cadre, le champ de lien et la bascule ne tiennent plus : la
 *  page se met à défiler et le lecteur devient un timbre-poste. */
const MIN_H = 300;
const DEFAUT = { l: 400, h: 480 };

let dock = null;
let signaler = () => {};

const el = (id) => document.getElementById(id);
const lire = (cle, defaut = null) => {
  try { return JSON.parse(localStorage.getItem(cle) ?? 'null') ?? defaut; } catch { return defaut; }
};
const ecrire = (cle, valeur) => localStorage.setItem(cle, JSON.stringify(valeur));

/** La session YouTube est un choix de l'utilisateur, pas un défaut du code. */
const avecCompte = () => localStorage.getItem(CLE_COMPTE) === '1';

// ─────────────────────────────────────────────────── position et taille

const borner = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));

/**
 * Pose la fenêtre, en la gardant entièrement à l'écran.
 *
 * Le bornage n'est pas de la coquetterie : une fenêtre posée en bas d'un grand
 * écran puis rouverte sur un portable se retrouverait hors du champ, sans
 * aucun moyen de la rattraper à la souris.
 */
function poser(x, y) {
  const l = dock.offsetWidth;
  const h = dock.offsetHeight;
  const aimanter = (v, bord) => (Math.abs(v - bord) < AIMANT ? bord : v);

  x = aimanter(x, MARGE); x = aimanter(x, window.innerWidth - l - MARGE);
  y = aimanter(y, MARGE); y = aimanter(y, window.innerHeight - h - MARGE);

  dock.style.left = `${borner(x, MARGE, window.innerWidth - l - MARGE)}px`;
  dock.style.top = `${borner(y, MARGE, window.innerHeight - h - MARGE)}px`;
}

function dimensionner(l, h) {
  const r = dock.getBoundingClientRect();
  dock.style.width = `${borner(l, MIN_L, window.innerWidth - r.left - MARGE)}px`;
  dock.style.height = `${borner(h, MIN_H, window.innerHeight - r.top - MARGE)}px`;
}

function memoriser() {
  const r = dock.getBoundingClientRect();
  const garde = lire(CLE_CADRE, {});
  ecrire(CLE_CADRE, {
    x: Math.round(r.left), y: Math.round(r.top),
    // Réduit, la hauteur mesurée est celle du bandeau : l'enregistrer
    // écraserait la taille dépliée, et rouvrir donnerait une fenêtre plate.
    l: Math.round(r.width),
    h: dock.classList.contains('reduit') ? (garde.h ?? DEFAUT.h) : Math.round(r.height),
  });
}

function restaurerCadre() {
  const c = lire(CLE_CADRE, null);
  const l = c?.l ?? DEFAUT.l;
  const h = c?.h ?? DEFAUT.h;
  dock.style.width = `${borner(l, MIN_L, window.innerWidth - 2 * MARGE)}px`;
  dock.style.height = `${borner(h, MIN_H, window.innerHeight - 2 * MARGE)}px`;
  poser(c?.x ?? window.innerWidth - l - 24, c?.y ?? window.innerHeight - h - 24);
}

/**
 * Le déplacement et le redimensionnement, sur le même moteur.
 *
 * LE VOILE N'EST PAS DÉCORATIF. Un cadre est un document étranger : dès que le
 * pointeur passe au-dessus, c'est LUI qui reçoit les évènements, et la fenêtre
 * se décroche en plein glissement — le défaut classique de toute boîte
 * déplaçable qui contient une vidéo. `dock-glisse` neutralise les cadres le
 * temps du geste.
 */
function suivre(cible, depart, bouger) {
  depart.preventDefault();

  // La capture est un CONFORT, pas le mécanisme. Elle lève une exception dès
  // que le pointeur n'est plus actif au moment de l'appel — et une exception
  // ici avortait le geste entier, sans rien laisser derrière : la fenêtre
  // refusait simplement de bouger, une fois sur deux, sans erreur visible.
  try { cible.setPointerCapture?.(depart.pointerId); } catch { /* on suivra sans */ }

  // Les écouteurs vivent sur la FENÊTRE, jamais sur la poignée : sans capture,
  // un pointeur qui sort de la poignée cesserait d'être suivi — et lâcher le
  // bouton dehors laisserait la fenêtre collée au curseur.
  document.body.classList.add('dock-glisse');
  const fin = () => {
    try { cible.releasePointerCapture?.(depart.pointerId); } catch { /* déjà rendue */ }
    window.removeEventListener('pointermove', bouger);
    window.removeEventListener('pointerup', fin);
    window.removeEventListener('pointercancel', fin);
    document.body.classList.remove('dock-glisse');
    memoriser();
  };
  window.addEventListener('pointermove', bouger);
  window.addEventListener('pointerup', fin);
  window.addEventListener('pointercancel', fin);
}

function installerDeplacement() {
  const tete = el('dockTete');
  tete.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // Les onglets et les boutons de la barre de titre restent cliquables : un
    // bandeau entièrement « poignée » rend ses propres commandes inutilisables.
    if (e.target.closest('button, a, input, select')) return;
    const r = dock.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    suivre(tete, e, (ev) => poser(ev.clientX - dx, ev.clientY - dy));
  });

  const prise = el('dockPoignee');
  prise.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = dock.getBoundingClientRect();
    const ox = e.clientX;
    const oy = e.clientY;
    suivre(prise, e, (ev) =>
      dimensionner(r.width + (ev.clientX - ox), r.height + (ev.clientY - oy)));
  });

  // Un écran qui rétrécit — fenêtre réduite, second moniteur débranché — ne
  // doit pas emporter le lecteur hors du champ.
  window.addEventListener('resize', () => {
    if (dock.hidden) return;
    const r = dock.getBoundingClientRect();
    dimensionner(r.width, r.height);
    poser(r.left, r.top);
  });
}

// ─────────────────────────────────────────────────────────── le média

const mediaCourant = () => lire(CLE_MEDIA, null);

function rendreCadre({ auto = true } = {}) {
  const boite = el('dockCadre');
  const media = mediaCourant();
  if (!media) {
    boite.innerHTML = `<div class="dock-vide">
      <p>Colle un lien <strong>YouTube</strong>, <strong>Twitch</strong> ou
        <strong>Spotify</strong> — ou juste un nom de chaîne Twitch.</p>
      <p class="dock-note">Le lecteur reste ouvert quand tu changes d'onglet.
        <strong>Réduire</strong> le range dans un bandeau sans couper le son ;
        <strong>fermer</strong> arrête la lecture.</p>
    </div>`;
    return;
  }
  const url = auto ? media.url : sansDemarrageAuto(media.url);
  boite.innerHTML = `<iframe class="dock-cadre" src="${echapper(url)}"
    title="Lecteur ${echapper(media.type)}" allow="autoplay; encrypted-media;
    picture-in-picture; clipboard-write; fullscreen"
    allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  el('dockResume').textContent = media.type;
}

/**
 * Charge un média dans le lecteur, et montre la page qui l'affiche.
 *
 * C'est le point d'entrée depuis l'extérieur : le panneau Twitch s'en sert
 * pour lancer une chaîne, la vue Chill pour ouvrir un lien collé ailleurs.
 */
export function jouerMedia(saisie) {
  const media = typeof saisie === 'string'
    ? versLecteur(saisie, location.hostname, avecCompte())
    : saisie;
  if (!media) {
    signaler('Lien non reconnu — YouTube, Twitch ou Spotify.', 'erreur');
    return false;
  }

  // TWITCH SE REGARDE DANS L'ONGLET TWITCH. Ce cadre-ci est celui de l'onglet
  // YouTube : y envoyer un direct faisait basculer d'onglet pour rien, et
  // laissait la liste des chaînes derrière soi au moment précis où l'on
  // hésitait entre deux. L'onglet Twitch a le sien depuis.
  if (media.type === 'Twitch') return lireTwitch(media);

  ecrire(CLE_MEDIA, media);
  document.dispatchEvent(new CustomEvent('jc:media', { detail: { source: 'lecteur' } }));
  ouvrirDock('lecteur');
  rendreCadre();
  return true;
}

function rendreSession() {
  const zone = el('dockSession');
  zone.innerHTML = `
    <label class="dock-bascule">
      <input type="checkbox" id="dockCompte" ${avecCompte() ? 'checked' : ''}>
      Utiliser ma session YouTube
    </label>
    <button type="button" class="dock-lien-txt" data-dock="youtube">Se connecter à YouTube</button>
    <p class="dock-note" id="dockSessionNote">${avecCompte()
      ? `Les vidéos passent par <code>youtube.com</code> : ton compte, tes
         abonnements et les vidéos réservées aux connectés fonctionnent — les
         traceurs de YouTube aussi.`
      : `Les vidéos passent par <code>youtube-nocookie.com</code> : rien ne te
         suit, mais une vidéo réservée aux connectés restera noire.`}</p>`;
}

// ────────────────────────────────────────────────── ouvrir, réduire, fermer

/** L'onglet visible. Les autres restent rendus, sans quoi le son s'arrêterait. */
function montrer(page) {
  for (const p of dock.querySelectorAll('.dock-page')) {
    p.classList.toggle('actif', p.dataset.page === page);
  }
  for (const b of dock.querySelectorAll('[data-dock-page]')) {
    b.classList.toggle('actif', b.dataset.dockPage === page);
    b.setAttribute('aria-selected', String(b.dataset.dockPage === page));
  }
  localStorage.setItem(CLE_PAGE, page);

  // On redemande l'état à l'ouverture d'un panneau, jamais en boucle : le
  // morceau a pu changer pendant qu'on était ailleurs, et afficher un titre
  // périmé est pire que de n'afficher rien.
  if (page === 'spotify') ouvrirSpotify(signaler);
  if (page === 'twitch') ouvrirTwitch(signaler);
  if (page === 'lecteur') ouvrirYoutube(signaler);
}

export function ouvrirDock(page) {
  const premiere = dock.hidden;
  dock.hidden = false;
  localStorage.setItem(CLE_OUVERT, '1');
  if (premiere) {
    restaurerCadre();
    // Rouvrir après un « fermer » reconstruit le cadre — mais sans démarrage
    // automatique : on rouvre pour reprendre la main, pas pour se faire
    // surprendre par le son.
    if (!el('dockCadre').firstElementChild) rendreCadre({ auto: false });
  }
  deplier();
  montrer(page ?? localStorage.getItem(CLE_PAGE) ?? 'lecteur');
}

function deplier() {
  // On ne redimensionne QUE si l'on revient d'un état réduit. Rétablir la
  // taille mémorisée à chaque changement d'onglet annulerait, sans prévenir,
  // le redimensionnement qu'on vient de faire à la souris.
  const revient = dock.classList.contains('reduit');
  dock.classList.remove('reduit');
  localStorage.setItem(CLE_REDUIT, '0');
  el('dockReduire').textContent = '–';
  el('dockReduire').title = 'Réduire — le son continue';
  if (!revient) return;
  const c = lire(CLE_CADRE, null);
  if (c?.h) dimensionner(c.l ?? DEFAUT.l, c.h);
}

function reduire() {
  memoriser();
  dock.classList.add('reduit');
  localStorage.setItem(CLE_REDUIT, '1');
  dock.style.height = 'auto';
  el('dockReduire').textContent = '▢';
  el('dockReduire').title = 'Agrandir';
  // Réduit, le bandeau devient plus étroit que la fenêtre dépliée : sans
  // repositionnement il pourrait dépasser en bas de l'écran.
  const r = dock.getBoundingClientRect();
  poser(r.left, r.top);
}

/**
 * Fermer ARRÊTE la lecture, et c'est délibéré.
 *
 * Une fenêtre fermée qui continue de chanter est le pire des deux mondes : on
 * cherche d'où vient le son sans rien trouver à l'écran. Le cadre est donc
 * détruit — le lien, lui, est gardé, et repart d'un clic.
 */
export function fermerDock() {
  el('dockCadre').innerHTML = '';
  dock.hidden = true;
  localStorage.setItem(CLE_OUVERT, '0');
  signaler('Lecteur fermé. La lecture est arrêtée.');
}

export function basculerDock(page) {
  if (dock.hidden) return ouvrirDock(page);
  if (page && !dock.querySelector(`.dock-page[data-page="${page}"]`)?.classList.contains('actif')) {
    deplier();
    return montrer(page);
  }
  if (dock.classList.contains('reduit')) return deplier();
  reduire();
}

// ────────────────────────────────────────────────────────────── câblage

export function installerDock(toast) {
  dock = el('dock');
  if (!dock) return;
  signaler = toast ?? (() => {});

  rendreSession();
  installerDeplacement();

  installerSpotify(signaler);
  // Le troisième argument permet au panneau Twitch de se montrer lui-même
  // quand un lien `twitch.tv` est cliqué ailleurs dans l'application. Passé en
  // rappel plutôt qu'importé : `dock.js` importe déjà `twitch-ui.js`, et
  // l'inverse en plus formerait un cycle.
  installerTwitch(signaler, jouerMedia, () => ouvrirDock('twitch'));
  installerYoutube(signaler, jouerMedia);

  dock.addEventListener('click', (e) => {
    const onglet = e.target.closest('[data-dock-page]');
    if (onglet) { deplier(); return montrer(onglet.dataset.dockPage); }

    const b = e.target.closest('[data-dock]');
    if (!b) return;
    if (b.dataset.dock === 'fermer') return fermerDock();
    if (b.dataset.dock === 'reduire') {
      return dock.classList.contains('reduit') ? deplier() : reduire();
    }
    if (b.dataset.dock === 'youtube') return connexionYouTube();
  });

  // Double-clic sur le bandeau : le geste attendu de toute fenêtre.
  el('dockTete').addEventListener('dblclick', (e) => {
    if (e.target.closest('button, a, input')) return;
    dock.classList.contains('reduit') ? deplier() : reduire();
  });

  dock.addEventListener('change', (e) => {
    if (e.target.id !== 'dockCompte') return;
    localStorage.setItem(CLE_COMPTE, e.target.checked ? '1' : '0');
    rendreSession();
    // Le cadre déjà ouvert garde son ancien domaine : sans ce rechargement le
    // réglage ne prendrait effet qu'au lien suivant, et donnerait
    // l'impression de ne rien faire.
    const media = mediaCourant();
    if (media?.type === 'YouTube') {
      localStorage.removeItem(CLE_MEDIA);
      el('dockCadre').innerHTML = '';
      rendreCadre();
      signaler('Domaine YouTube changé — recolle le lien.');
    }
  });

  // L'onglet Twitch s'est mis à jouer : ce cadre-ci se tait. Deux bandes-son
  // superposées obligeaient à aller couper la première à la main, sur un
  // onglet qu'on venait justement de quitter.
  document.addEventListener('jc:media', (e) => {
    if (e.detail?.source === 'lecteur') return;
    localStorage.removeItem(CLE_MEDIA);
    el('dockCadre').innerHTML = '';
    el('dockResume').textContent = '';
    rendreCadre();
  });

  dock.addEventListener('submit', (e) => {
    if (e.target.id !== 'dockLienForm') return;
    e.preventDefault();
    const champ = el('dockLien');
    if (jouerMedia(champ.value)) champ.value = '';
  });

  // Le lecteur se rouvre là où il était, avec son lien — mais à l'arrêt.
  if (localStorage.getItem(CLE_OUVERT) === '1') {
    dock.hidden = false;
    restaurerCadre();
    rendreCadre({ auto: false });
    montrer(localStorage.getItem(CLE_PAGE) ?? 'lecteur');
    if (localStorage.getItem(CLE_REDUIT) === '1') reduire();
  }
}

/**
 * LA VRAIE FENÊTRE DE CONNEXION.
 *
 * Google refuse d'afficher sa page de connexion dans un cadre : elle répond
 * avec un en-tête qui l'interdit, et le navigateur montre un rectangle vide,
 * sans message. « Se connecter dans le lecteur », ce que l'application
 * conseillait, était donc impossible — pas difficile, impossible.
 *
 * Une fenêtre à part n'a pas cette contrainte : c'est une page ordinaire, sur
 * le domaine de Google, avec la barre d'adresse visible — de quoi vérifier
 * qu'on tape son mot de passe au bon endroit. Une fois connecté, ce sont les
 * cookies du navigateur qui font le travail : les cadres `youtube.com`
 * emportent la session sans que l'application n'ait jamais rien à en savoir.
 */
function connexionYouTube() {
  // UN ONGLET, PAS UNE FENÊTRE DÉTACHÉE.
  //
  // Passer une liste de dimensions à `window.open` demande une VRAIE fenêtre :
  // le navigateur en détache une, minuscule, à côté de l'application, avec sa
  // propre barre de titre. C'est ce qui donnait l'impression d'être expulsé du
  // logiciel. Sans liste de dimensions, la même fonction ouvre un onglet
  // ordinaire dans la fenêtre courante — on revient d'un clic.
  //
  // Ce qui reste impossible : afficher la connexion Google DANS l'application.
  // Google sert sa page avec un en-tête qui interdit l'affichage en cadre, et
  // aucun réglage de notre côté n'y change quoi que ce soit.
  //
  // `noopener` est volontairement absent : présent, `window.open` rend `null`
  // même quand l'onglet s'est parfaitement ouvert — et on afficherait
  // « bloqué par le navigateur » à chaque connexion réussie.
  const onglet = window.open(
    'https://accounts.google.com/ServiceLogin?service=youtube&continue='
      + encodeURIComponent('https://www.youtube.com/'),
    '_blank');
  if (!onglet) {
    return signaler('Le navigateur a bloqué l\'ouverture — autorise les fenêtres '
      + 'surgissantes pour ce site.', 'erreur');
  }
  // Se connecter puis rester sur `youtube-nocookie.com` n'aurait servi à rien :
  // ce domaine n'emporte pas la session. La bascule suit donc la connexion.
  if (!avecCompte()) {
    localStorage.setItem(CLE_COMPTE, '1');
    rendreSession();
    signaler('Session YouTube activée : les vidéos passeront par youtube.com.');
  }
}
