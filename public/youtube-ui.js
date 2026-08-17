// L'onglet YouTube du lecteur flottant.
//
// POURQUOI L'ACCUEIL DE YOUTUBE N'EST PAS DANS UN CADRE
// ------------------------------------------------------
// Parce que YouTube l'interdit, et ce n'est pas contournable de notre côté.
// `youtube.com` répond `X-Frame-Options: SAMEORIGIN` sur l'accueil, sur les
// résultats de recherche, et jusque sur son interface téléviseur `/tv`.
// Seules les adresses `/embed/` s'affichent — et elles ne montrent qu'une
// vidéo ou une playlist, jamais de quoi parcourir le catalogue.
//
// Le paramètre `listType=search`, qui chargeait autrefois une recherche dans
// le lecteur intégré, a été retiré : l'adresse répond encore 200, et le
// lecteur affiche « Erreur 153 ». Vérifié, pas supposé.
//
// LA NAVIGATION SE FAIT DONC ICI. On dresse la liste par l'API officielle, et
// un clic charge la vidéo dans le cadre `/embed/`, qui lui fonctionne très
// bien. L'accueil, ce sont les VIDÉOS POPULAIRES du pays — c'est-à-dire
// exactement ce que voit un visiteur non connecté sur youtube.com.
//
// PAS DE SCRAPING. Lire la page de résultats pour en extraire les vidéos
// serait plus simple et sans clé. Le projet se l'interdit — la même règle a
// fait laisser Indeed de côté — et une page qu'on analyse à la main casse au
// premier changement de balisage, sans prévenir.
import { API } from './api.js';
import { echapper } from './format.js';

let etat = { configure: false, pays: 'FR', aide: '' };
let videos = [];
let recherche = '';
let charge = false;
let panne = '';
let jouer = () => {};
let signaler = () => {};

const zone = () => document.getElementById('youtubePanneau');

const nombre = (n) => {
  if (!n) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.0', '')} M vues`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} k vues`;
  return `${n} vues`;
};

const minutes = (s) => (s
  ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  : '');

function rendreNonConfigure() {
  return `<div class="sp-vide">
    ${etat.aide ? `<div class="sp-alerte"><p>${echapper(etat.aide)}</p></div>` : ''}
    <p><strong>Naviguer dans YouTube depuis l'application</strong> — l'accueil,
      la recherche, et la lecture dans le cadre.</p>
    <p class="sp-note">Sans cette clé, l'onglet marche quand même : colle
      n'importe quel lien YouTube et il se lit. C'est la NAVIGATION qui a
      besoin de l'API.</p>
    <ol class="sp-etapes">
      <li>Sur <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
        target="_blank" rel="noopener">console.cloud.google.com</a>, crée un projet
        et active <strong>YouTube Data API v3</strong>.</li>
      <li>Dans <em>Identifiants</em>, crée une <strong>clé d'API</strong>. Pas
        d'OAuth, pas d'écran de consentement, pas de compte à lier : une clé
        simple suffit.</li>
      <li>Colle-la dans <code>.env</code> :<br><code>YOUTUBE_API_KEY=…</code>
        <br>Et si tu n'es pas en France : <code>YOUTUBE_PAYS=BE</code></li>
      <li>Redémarre l'application.</li>
    </ol>
    <p class="sp-note"><strong>La clé Gemini ne marche pas ici</strong>, même en
      activant YouTube Data API v3 sur le même projet — vérifié : elle répond
      « API keys are not supported by this API ». Les clés d'AI Studio ne
      valent que pour Gemini. Il faut une clé créée dans Google Cloud, et
      l'écrire sous son propre nom : activer l'API quelque part ne suffit
      jamais, c'est <code>YOUTUBE_API_KEY</code> que l'application lit.</p>
    <p class="sp-note">Le quota gratuit est de 10 000 unités par jour. L'accueil
      en coûte 1, une recherche 100 — soit une centaine de recherches
      quotidiennes.</p>
  </div>`;
}

/**
 * UNE VIGNETTE, PAS UNE LIGNE DE TEXTE.
 *
 * La liste rendait une vidéo en 78 pixels de large : à cette taille, une
 * vignette de YouTube ne montre rien, et on choisissait donc au titre — comme
 * dans un tableur. La grille reprend la forme que tout le monde connaît
 * (image large, titre sur deux lignes, chaîne et vues en dessous, durée dans
 * un coin), et les colonnes s'ajustent à la largeur du lecteur, qui est
 * redimensionnable.
 */
function rendreVideo(v) {
  return `<li>
    <button class="yt-carte" data-video="${echapper(v.id)}" title="${echapper(v.titre)}">
      <span class="yt-cadre-vignette">
        ${v.vignette
    ? `<img class="yt-vignette" src="${echapper(v.vignette)}" alt="" loading="lazy">`
    : '<span class="yt-vignette"></span>'}
        ${v.secondes ? `<span class="yt-duree">${minutes(v.secondes)}</span>` : ''}
      </span>
      <span class="yt-carte-titre">${echapper(v.titre)}</span>
      <span class="yt-carte-meta">${echapper(v.chaine)}${
  v.vues ? ` · ${nombre(v.vues)}` : ''}</span>
    </button>
  </li>`;
}

export function rendreYoutube() {
  const z = zone();
  if (!z) return;

  if (!etat.configure) { z.innerHTML = rendreNonConfigure(); return; }

  z.innerHTML = `
    <form class="sp-chercher yt-chercher" id="ytForm">
      <input id="ytQ" placeholder="Rechercher une vidéo, une chaîne, un sujet…"
        autocomplete="off" value="${echapper(recherche)}">
      <button class="btn" type="submit">Chercher</button>
      ${recherche ? '<button class="btn" type="button" data-yt="accueil">Accueil</button>' : ''}
    </form>

    <div class="tw-titre">${recherche
    ? `Résultats pour « ${echapper(recherche)} »`
    : `Tendances · ${echapper(etat.pays)}`}
      <button class="sp-lien-note" data-yt="ouvrir-site">ouvrir youtube.com</button>
    </div>

    ${panne ? `<div class="sp-alerte"><p>${echapper(panne)}</p></div>` : ''}
    ${videos.length
    ? `<ul class="yt-grille">${videos.map(rendreVideo).join('')}</ul>`
    : `<div class="sp-rien">${charge ? 'Rien à afficher.' : 'Chargement…'}</div>`}

    <p class="sp-note yt-pourquoi">L'accueil de YouTube lui-même ne peut pas
      s'afficher ici : le site refuse d'être mis en cadre. Ces vignettes
      viennent de l'API officielle — les tendances du pays, c'est-à-dire ce que
      voit un visiteur non connecté — et la lecture, elle, se fait bien dans le
      cadre ci-dessus.</p>`;
}

async function charger(quoi) {
  charge = false;
  panne = '';
  rendreYoutube();
  try {
    const d = quoi === 'recherche'
      ? await API.youtubeRecherche(recherche)
      : await API.youtubeAccueil();
    videos = d.videos ?? [];
  } catch (e) {
    videos = [];
    panne = e.message;
  }
  charge = true;
  rendreYoutube();
}

/** Redemande l'état chaque fois que l'onglet revient devant. */
export async function ouvrirYoutube(toast) {
  try {
    const d = await API.youtubeEtat();
    etat = { configure: d.configure, pays: d.pays ?? 'FR', aide: d.aide ?? '' };
  } catch (e) {
    etat = { ...etat, configure: false };
    if (toast) toast(e.message, 'erreur');
  }
  rendreYoutube();
  // On ne recharge pas à chaque passage : l'accueil ne coûte qu'une unité,
  // mais une recherche en coûte cent et l'utilisateur ne l'a pas redemandée.
  if (etat.configure && !videos.length && !panne) charger('accueil');
}

export function installerYoutube(toast, lancer) {
  signaler = toast ?? (() => {});
  jouer = lancer ?? (() => {});

  // Sur le CONTENEUR du lecteur, jamais sur le panneau : celui-ci est
  // reconstruit à chaque rendu.
  const z = document.getElementById('dock');
  if (!z) return;

  z.addEventListener('click', (e) => {
    const v = e.target.closest('[data-video]');
    if (v) {
      // On passe par `versLecteur` du côté du dock, qui décide du domaine —
      // `youtube.com` si la session est demandée, `-nocookie` sinon. Recopier
      // ce choix ici le ferait diverger au premier changement.
      jouer(`https://www.youtube.com/watch?v=${v.dataset.video}`);
      return;
    }
    const b = e.target.closest('[data-yt]');
    if (!b) return;
    if (b.dataset.yt === 'accueil') { recherche = ''; return charger('accueil'); }
    if (b.dataset.yt === 'ouvrir-site') {
      window.open('https://www.youtube.com/', '_blank');
      signaler('YouTube s\'ouvre dans un onglet : son accueil refuse le cadre.');
    }
  });

  z.addEventListener('submit', (e) => {
    if (e.target.id !== 'ytForm') return;
    e.preventDefault();
    recherche = document.getElementById('ytQ')?.value.trim() ?? '';
    charger(recherche ? 'recherche' : 'accueil');
  });
}
