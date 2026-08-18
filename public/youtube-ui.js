// L'onglet YouTube du lecteur flottant.
//
// POURQUOI L'ACCUEIL DE YOUTUBE N'EST PAS DANS UN CADRE
// ------------------------------------------------------
// Parce que YouTube l'interdit, et ce n'est pas contournable de notre côté.
// `youtube.com` répond `X-Frame-Options: SAMEORIGIN` sur l'accueil, sur les
// résultats de recherche, et jusque sur son interface téléviseur `/tv`.
// Seules les adresses `/embed/` s'affichent — et elles ne montrent qu'une
// vidéo, jamais de quoi parcourir le catalogue.
//
// LA NAVIGATION SE FAIT DONC ICI. On dresse les listes par l'API officielle, et
// un clic charge la vidéo dans le cadre `/embed/`, qui lui fonctionne très
// bien. Trois vues, toutes chez nous : l'accueil (les tendances du pays), la
// recherche, et LA CHAÎNE D'UN YOUTUBER — sa fiche et ses dernières vidéos.
// Cliquer le nom d'un YouTuber ouvre sa chaîne ici, pas sur le site.
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

// La vue courante. 'liste' = accueil ou recherche (dans `videos`) ; 'chaine' =
// la page d'un YouTuber (dans `chaine`). Le retour ramène à la liste, qui n'est
// jamais effacée en ouvrant une chaîne.
let vue = 'liste';
let chaine = { fiche: null, videos: [], charge: false };

let jouer = () => {};
let signaler = () => {};

const zone = () => document.getElementById('youtubePanneau');

const nombre = (n) => {
  if (!n) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.0', '')} M vues`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} k vues`;
  return `${n} vues`;
};

const abonnesTexte = (n) => {
  if (!n) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.0', '')} M abonnés`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} k abonnés`;
  return `${n} abonnés`;
};

const minutes = (s) => (s
  ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  : '');

function rendreNonConfigure() {
  return `<div class="sp-vide">
    ${etat.aide ? `<div class="sp-alerte"><p>${echapper(etat.aide)}</p></div>` : ''}
    <p><strong>Naviguer dans YouTube depuis l'application</strong> — l'accueil,
      la recherche, les chaînes, et la lecture dans le cadre.</p>
    <p class="sp-note">Sans cette clé, l'onglet reste vide : c'est l'API qui
      fournit l'accueil, la recherche et les chaînes.</p>
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
      valent que pour Gemini. Il faut une clé créée dans Google Cloud, qui
      commence par <code>AIza</code>.</p>
  </div>`;
}

/**
 * UNE VIGNETTE, PAS UNE LIGNE DE TEXTE — ET UN NOM DE CHAÎNE CLIQUABLE.
 *
 * La grille reprend la forme que tout le monde connaît : image large, titre
 * sur deux lignes, chaîne et vues en dessous. Le nom de la chaîne est un
 * BOUTON à part, sous la zone vidéo — un bouton ne peut pas être imbriqué dans
 * un autre bouton, la vignette et le nom sont donc deux cibles distinctes :
 * l'une lance la vidéo, l'autre ouvre la chaîne.
 */
function rendreVideo(v) {
  const meta = v.chaineId
    ? `<button class="yt-lien-chaine" data-chaine-yt="${echapper(v.chaineId)}"
        title="Ouvrir la chaîne">${echapper(v.chaine)}</button>${
  v.vues ? ` · ${nombre(v.vues)}` : ''}`
    : `${echapper(v.chaine)}${v.vues ? ` · ${nombre(v.vues)}` : ''}`;

  return `<li>
    <div class="yt-carte">
      <button class="yt-lien-video" data-video="${echapper(v.id)}" title="${echapper(v.titre)}">
        <span class="yt-cadre-vignette">
          ${v.vignette
    ? `<img class="yt-vignette" src="${echapper(v.vignette)}" alt="" loading="lazy">`
    : '<span class="yt-vignette"></span>'}
          ${v.secondes ? `<span class="yt-duree">${minutes(v.secondes)}</span>` : ''}
        </span>
        <span class="yt-carte-titre">${echapper(v.titre)}</span>
      </button>
      <span class="yt-carte-meta">${meta}</span>
    </div>
  </li>`;
}

const grille = (liste, vide) => (liste.length
  ? `<ul class="yt-grille">${liste.map(rendreVideo).join('')}</ul>`
  : `<div class="sp-rien">${vide}</div>`);

/** La barre de recherche, commune à l'accueil et aux résultats. */
function rendreListe() {
  return `
    <form class="sp-chercher yt-chercher" id="ytForm">
      <input id="ytQ" placeholder="Rechercher une vidéo, une chaîne, un sujet…"
        autocomplete="off" value="${echapper(recherche)}">
      <button class="btn" type="submit">Chercher</button>
      ${recherche ? '<button class="btn" type="button" data-yt="accueil">Accueil</button>' : ''}
    </form>

    <div class="tw-titre">${recherche
    ? `Résultats pour « ${echapper(recherche)} »`
    : `Tendances · ${echapper(etat.pays)}`}</div>

    ${panne ? `<div class="sp-alerte"><p>${echapper(panne)}</p></div>` : ''}
    ${grille(videos, charge ? 'Rien à afficher.' : 'Chargement…')}`;
}

/** La page d'une chaîne : sa fiche, puis ses dernières vidéos. */
function rendreChaine() {
  const c = chaine.fiche;
  return `
    <div class="tw-fil">
      <button class="tw-retour" data-yt="retour">‹ Retour</button>
      <span class="tw-fil-titre">${echapper(c?.nom ?? 'Chaîne')}</span>
    </div>
    ${c ? `<div class="tw-entete">
      ${c.avatar ? `<img class="tw-avatar-grand" src="${echapper(c.avatar)}" alt="">` : ''}
      <div class="tw-entete-infos">
        <div class="tw-nom">${echapper(c.nom)}</div>
        <div class="tw-jeu">${echapper(abonnesTexte(c.abonnes) || c.description || '')}</div>
      </div>
    </div>` : ''}
    <div class="tw-titre">Dernières vidéos</div>
    ${grille(chaine.videos, chaine.charge ? 'Aucune vidéo publique.' : 'Chargement…')}`;
}

export function rendreYoutube() {
  const z = zone();
  if (!z) return;

  if (!etat.configure) { z.innerHTML = rendreNonConfigure(); return; }
  // Une clé au format inattendu n'empêche pas d'essayer : on prévient, et on
  // laisse la navigation en place. C'est un doute, pas un verdict.
  const doute = etat.aide
    ? `<div class="sp-alerte"><p>${echapper(etat.aide)}</p></div>` : '';

  const corps = vue === 'chaine' ? rendreChaine() : rendreListe();

  z.innerHTML = `${doute}${corps}
    <p class="sp-note yt-pourquoi">L'accueil de YouTube lui-même ne peut pas
      s'afficher ici : le site refuse d'être mis en cadre. Ces vignettes
      viennent de l'API officielle, et la lecture, elle, se fait bien dans le
      cadre ci-dessus.</p>`;
}

async function charger(quoi) {
  vue = 'liste';
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

/** Ouvre la chaîne d'un YouTuber : sa fiche et ses dernières vidéos. */
async function ouvrirChaine(id) {
  vue = 'chaine';
  chaine = { fiche: null, videos: [], charge: false };
  rendreYoutube();
  try {
    const d = await API.youtubeChaine(id);
    chaine = { fiche: d.chaine, videos: d.videos ?? [], charge: true };
  } catch (e) {
    chaine = { fiche: null, videos: [], charge: true };
    signaler(e.message, 'erreur');
  }
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
    // Le nom d'une chaîne AVANT la vidéo : le bouton chaîne est distinct, mais
    // les deux portent des attributs `data-…`, et tester la vidéo d'abord
    // l'emporterait sur un clic pourtant destiné à la chaîne.
    const c = e.target.closest('[data-chaine-yt]');
    if (c) return ouvrirChaine(c.dataset.chaineYt);

    const v = e.target.closest('[data-video]');
    if (v) {
      // On passe par `versLecteur` du côté du dock, qui choisit le domaine.
      jouer(`https://www.youtube.com/watch?v=${v.dataset.video}`);
      return;
    }

    const b = e.target.closest('[data-yt]');
    if (!b) return;
    if (b.dataset.yt === 'accueil') { recherche = ''; return charger('accueil'); }
    if (b.dataset.yt === 'retour') { vue = 'liste'; return rendreYoutube(); }
  });

  z.addEventListener('submit', (e) => {
    if (e.target.id !== 'ytForm') return;
    e.preventDefault();
    recherche = document.getElementById('ytQ')?.value.trim() ?? '';
    charger(recherche ? 'recherche' : 'accueil');
  });
}
