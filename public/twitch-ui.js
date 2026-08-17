// Le panneau Twitch du lecteur flottant.
//
// LA CONNEXION SE FAIT PAR UN CODE, ET C'EST LE SEUL CHEMIN PRATICABLE
// ---------------------------------------------------------------------
// Deux autres ont été essayés. Se connecter DANS le cadre est impossible :
// Twitch sert sa page de connexion avec un en-tête qui interdit l'affichage en
// `<iframe>`, et on obtient un rectangle noir sans message. Le flux implicite,
// lui, exige une URL de redirection — et **le formulaire de Twitch refuse
// toute adresse en `http://`**, ce qui condamne une application servie en
// local.
//
// Reste le « code d'appareil » : Twitch donne un code à huit caractères, on le
// tape sur twitch.tv/activate, et c'est fini. Aucune redirection à déclarer,
// aucun secret, et le jeton ne traverse jamais la page.
//
// ON NAVIGUE ICI, PAS SUR LE SITE
// -------------------------------
// Le panneau ne montrait que les chaînes suivies en direct. Tout le reste —
// une catégorie, une chaîne qu'on ne suit pas, une rediffusion — obligeait à
// ouvrir twitch.tv, c'est-à-dire à sortir de l'application. Or `twitch.tv`
// refuse d'être mis en cadre : seul `player.twitch.tv` l'accepte, et il ne
// montre qu'un flux, jamais de quoi parcourir quoi que ce soit.
//
// La navigation est donc reconstruite ici, sur l'API officielle : accueil,
// catégories, page de chaîne avec ses rediffusions, recherche des deux à la
// fois. Quatre vues et une pile de retour — c'est ce qu'il faut pour ne plus
// avoir de raison d'aller sur le site.
import { API } from './api.js';
import { echapper } from './format.js';
import { destinationTwitch, sansDemarrageAuto } from './media.js';

let etat = { configure: false, connecte: false, login: '' };
let vue = { nom: 'accueil' };
let pile = [];
let contenu = { directs: [], categories: [], charge: false };
let jouer = () => {};
let signaler = () => {};
let montrerPanneau = () => {};

/** La connexion en cours : le code à taper, et la surveillance. */
let attente = null;
let guet = null;

const zone = () => document.getElementById('twitchPanneau');

const nombre = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace('.0', '')} k` : String(n ?? 0));

/** « 3h20m10s » tel que Twitch l'écrit, en quelque chose qui se lit. */
const duree = (d) => String(d ?? '').replace('h', ' h ').replace('m', ' min ').replace('s', ' s').trim();

const parent = () => encodeURIComponent(location.hostname);

// ────────────────────────────────────────────── états sans compte

function rendreNonConfigure() {
  return `<div class="sp-vide">
    <p><strong>Lier ton compte Twitch</strong> — pour retrouver tes chaînes
      suivies, parcourir les catégories et regarder sans quitter l'application.</p>
    <ol class="sp-etapes">
      <li>Sur <a href="https://dev.twitch.tv/console/apps" target="_blank"
        rel="noopener">dev.twitch.tv/console/apps</a>, enregistre une application.
        Le nom est libre.</li>
      <li><strong>URL de redirection : mets n'importe quelle adresse en
        <code>https://</code></strong>, par exemple <code>https://localhost/</code>.
        Elle ne sert à RIEN ici — la connexion se fait par un code, sans
        redirection. Le formulaire exige juste que le champ soit rempli et
        commence par <code>https</code> : c'est la seule raison de la poser.</li>
      <li>Catégorie : au choix. Type de client : <strong>Publique</strong> —
        « Confidentiel » suppose un <em>Client Secret</em> gardé côté serveur,
        et il n'y en a pas ici.</li>
      <li>Copie le <strong>Client ID</strong> — il est public — et colle-le dans
        ton fichier <code>.env</code> :<br><code>TWITCH_CLIENT_ID=…</code></li>
      <li>Redémarre l'application.</li>
    </ol>
    <p class="sp-note">Il y a DEUX fichiers <code>.env</code> : celui du projet
      et celui de <code>Application\\</code>. C'est le second que lit
      l'exécutable — et c'est le piège classique, la clé est renseignée mais
      dans le mauvais fichier. <code>npm run installer</code> complète
      désormais ce qui manque tout seul.</p>
  </div>`;
}

function rendreDeconnecte() {
  if (attente) return rendreCode();
  return `<div class="sp-vide">
    <p>Ton <code>TWITCH_CLIENT_ID</code> est en place.</p>
    <button class="btn btn-primary" data-tw="connexion">Se connecter à Twitch</button>
    <p class="sp-note">Twitch te donnera un code à recopier sur son site — c'est
      là que tu tapes ton mot de passe, jamais ici. L'application ne reçoit
      qu'une autorisation de lecture de tes chaînes suivies.</p>
  </div>`;
}

/**
 * LE CODE, EN GRAND ET EN CHASSE FIXE.
 *
 * C'est le seul moment où l'utilisateur doit recopier quelque chose, et un
 * code à huit caractères mal lu — un 0 pour un O, un 1 pour un I — se solde
 * par un refus sans explication. Il est donc affiché à taille lisible, espacé,
 * et surtout déjà copié dans le presse-papiers.
 */
function rendreCode() {
  return `<div class="sp-vide tw-activation">
    <p><strong>Recopie ce code sur Twitch :</strong></p>
    <button class="tw-code" data-tw="copier" title="Cliquer pour copier"
      >${echapper(attente.code ?? '')}</button>
    <p class="tw-etat" id="twEtat">Le code est dans ton presse-papiers.
      L'onglet Twitch s'est ouvert — colle-le, autorise, et reviens ici.</p>
    <div class="chill-portes">
      <button class="btn" data-tw="ouvrir-activation">Rouvrir la page Twitch</button>
      <button class="btn" data-tw="annuler">Annuler</button>
    </div>
    <p class="sp-note">Cette fenêtre se met à jour toute seule dès que tu as
      autorisé. Le code expire au bout de trente minutes.</p>
  </div>`;
}

// ────────────────────────────────────────────── les briques d'affichage

function rendreDirect(s) {
  return `<li>
    <button data-chaine="${echapper(s.login)}" title="${echapper(s.titre)}">
      ${s.vignette
    ? `<img class="tw-vignette" src="${echapper(s.vignette)}" alt="" loading="lazy">`
    : '<span class="sp-vignette"></span>'}
      <span class="tw-infos">
        <span class="tw-nom">${echapper(s.nom)}</span>
        <span class="tw-jeu">${echapper(s.jeu || s.titre)}</span>
      </span>
      <span class="tw-vus">● ${nombre(s.spectateurs)}</span>
    </button></li>`;
}

function rendreCategorie(c) {
  return `<li>
    <button class="tw-carte" data-categorie="${echapper(c.id)}" title="${echapper(c.nom)}">
      ${c.jaquette
    ? `<img class="tw-jaquette" src="${echapper(c.jaquette)}" alt="" loading="lazy">`
    : '<span class="tw-jaquette tw-jaquette-vide"></span>'}
      <span class="tw-carte-nom">${echapper(c.nom)}</span>
    </button></li>`;
}

// L'attribut porte un nom À LUI. `data-video` est déjà celui de l'onglet
// YouTube, et les deux panneaux écoutent le même conteneur : une rediffusion
// Twitch partait alors dans un lecteur YouTube, avec un identifiant qui n'y
// désigne rien.
function rendreVideo(v) {
  return `<li>
    <button data-tw-video="${echapper(v.id)}" title="${echapper(v.titre)}">
      ${v.vignette
    ? `<img class="tw-vignette" src="${echapper(v.vignette)}" alt="" loading="lazy">`
    : '<span class="sp-vignette"></span>'}
      <span class="tw-infos">
        <span class="tw-nom">${echapper(v.titre)}</span>
        <span class="tw-jeu">${echapper(duree(v.duree))} · ${nombre(v.vues)} vues</span>
      </span>
    </button></li>`;
}

/** La barre de navigation : d'où l'on vient, et où l'on est. */
function rendreFil(titre) {
  return `<div class="tw-fil">
    ${pile.length ? '<button class="tw-retour" data-tw="retour">‹ Retour</button>' : ''}
    <button class="tw-retour" data-tw="accueil">Accueil</button>
    <span class="tw-fil-titre">${echapper(titre)}</span>
  </div>`;
}

const enChargement = (quoi) => `<div class="sp-rien">${contenu.charge
  ? quoi : 'Chargement…'}</div>`;

// ────────────────────────────────────────────── les quatre vues

function rendreAccueil() {
  return `
    ${contenu.directs?.length
    ? `<div class="tw-titre">Tes chaînes, en direct maintenant</div>
       <ul class="sp-liste tw-liste">${contenu.directs.map(rendreDirect).join('')}</ul>`
    : `<div class="tw-titre">Tes chaînes, en direct maintenant</div>
       ${enChargement('Aucune des chaînes que tu suis n\'émet en ce moment.')}`}

    <div class="tw-titre">Parcourir les catégories</div>
    ${contenu.categories?.length
    ? `<ul class="tw-grille">${contenu.categories.map(rendreCategorie).join('')}</ul>`
    : enChargement('Catégories indisponibles.')}`;
}

function rendreVueCategorie() {
  return `${rendreFil(contenu.categorie?.nom ?? 'Catégorie')}
    ${contenu.directs?.length
    ? `<ul class="sp-liste tw-liste">${contenu.directs.map(rendreDirect).join('')}</ul>`
    : enChargement('Personne n\'émet dans cette catégorie.')}`;
}

/**
 * LA PAGE D'UNE CHAÎNE — ET SES REDIFFUSIONS.
 *
 * Une chaîne hors ligne n'est pas une chaîne vide. Sans ses archives, cliquer
 * sur une chaîne éteinte donnait un lecteur noir, et la seule suite possible
 * était d'aller voir sur le site.
 */
function rendreVueChaine() {
  const c = contenu.chaine;
  if (!c) return `${rendreFil('Chaîne')}${enChargement('Chaîne introuvable.')}`;

  return `${rendreFil(c.nom)}
    <div class="tw-entete">
      ${c.avatar ? `<img class="tw-avatar-grand" src="${echapper(c.avatar)}" alt="">` : ''}
      <div class="tw-entete-infos">
        <div class="tw-nom">${echapper(c.nom)}</div>
        <div class="tw-jeu">${echapper(c.description || '—')}</div>
      </div>
      ${contenu.direct
    ? `<button class="btn btn-primary" data-chaine="${echapper(c.login)}"
         >● Regarder le direct</button>`
    : '<span class="tw-vus hors">hors ligne</span>'}
    </div>

    ${contenu.direct ? `<div class="tw-titre">${echapper(contenu.direct.titre)}</div>
      <p class="sp-note">${echapper(contenu.direct.jeu)} ·
        ${nombre(contenu.direct.spectateurs)} spectateurs</p>` : ''}

    <div class="tw-titre">Rediffusions</div>
    ${contenu.videos?.length
    ? `<ul class="sp-liste tw-liste">${contenu.videos.map(rendreVideo).join('')}</ul>`
    : enChargement('Cette chaîne n\'a pas de rediffusion publique.')}`;
}

function rendreVueRecherche() {
  return `${rendreFil(`« ${vue.q} »`)}
    ${contenu.categories?.length
    ? `<div class="tw-titre">Catégories</div>
       <ul class="tw-grille">${contenu.categories.map(rendreCategorie).join('')}</ul>` : ''}
    <div class="tw-titre">Chaînes</div>
    ${contenu.resultats?.length
    ? `<ul class="sp-liste tw-liste">${contenu.resultats.map(r => `<li>
        <button data-chaine="${echapper(r.login)}">
          ${r.vignette ? `<img class="tw-avatar" src="${echapper(r.vignette)}" alt="" loading="lazy">`
    : '<span class="sp-vignette"></span>'}
          <span class="tw-infos">
            <span class="tw-nom">${echapper(r.nom)}</span>
            <span class="tw-jeu">${echapper(r.jeu || '—')}</span>
          </span>
          <span class="tw-vus ${r.enDirect ? 'direct' : 'hors'}">${r.enDirect ? '● direct' : 'hors ligne'}</span>
        </button></li>`).join('')}</ul>`
    : enChargement('Aucune chaîne à ce nom.')}`;
}

export function rendreTwitch() {
  const z = zone();
  if (!z) return;

  if (!etat.configure) { z.innerHTML = rendreNonConfigure(); return; }
  if (!etat.connecte) { z.innerHTML = rendreDeconnecte(); return; }

  const corps = {
    accueil: rendreAccueil,
    categorie: rendreVueCategorie,
    chaine: rendreVueChaine,
    recherche: rendreVueRecherche,
  }[vue.nom] ?? rendreAccueil;

  z.innerHTML = `
    <div class="sp-tete">
      <span class="sp-lie">${echapper(etat.login || 'compte lié')}</span>
      <button class="chill-vider" data-tw="rafraichir">Actualiser</button>
      <button class="chill-vider" data-tw="deconnexion">Délier</button>
    </div>

    <form class="sp-chercher" id="twForm">
      <input id="twQ" placeholder="Chaîne, catégorie, ou lien twitch.tv…" autocomplete="off">
      <button class="btn" type="submit">Chercher</button>
    </form>

    ${corps()}`;
}

// ────────────────────────────────────────────── naviguer

/**
 * Change de vue et charge ce qu'elle montre.
 *
 * La pile de retour ne garde QUE les vues qu'on a réellement quittées : sans
 * ça, revenir en arrière depuis une chaîne ouverte depuis l'accueil ramenait
 * sur l'accueil… puis sur l'accueil, puis sur l'accueil.
 */
async function aller(destination, { empiler = true } = {}) {
  if (empiler && vue.nom !== destination.nom) pile.push(vue);
  vue = destination;
  contenu = { charge: false };
  rendreTwitch();

  try {
    if (destination.nom === 'accueil') {
      pile = [];
      const [d, c] = await Promise.all([
        API.twitchDirects().catch(() => ({ directs: [] })),
        API.twitchCategories().catch(() => ({ categories: [] })),
      ]);
      contenu = { directs: d.directs ?? [], categories: c.categories ?? [] };
    } else if (destination.nom === 'categorie') {
      contenu = await API.twitchCategorie(destination.id);
    } else if (destination.nom === 'chaine') {
      contenu = await API.twitchChaine(destination.login);
    } else if (destination.nom === 'recherche') {
      contenu = await API.twitchRecherche(destination.q);
    }
  } catch (e) {
    contenu = {};
    signaler(e.message, 'erreur');
  }
  contenu.charge = true;
  rendreTwitch();
}

const revenir = () => aller(pile.pop() ?? { nom: 'accueil' }, { empiler: false });

// ────────────────────────────────────────────── le cadre, ICI et pas ailleurs

/**
 * ON REGARDE TWITCH DANS L'ONGLET TWITCH.
 *
 * Cliquer sur un direct basculait sur l'onglet nommé « YouTube », parce que
 * le lecteur était unique et partagé. On quittait donc Twitch pour regarder
 * Twitch, en perdant au passage la liste où l'on était en train de choisir.
 *
 * Le cadre est posé dans le balisage (`#twitchCadre`), HORS du panneau que
 * `rendreTwitch()` réécrit. C'est la même règle que pour le dock entier :
 * réécrire le HTML autour d'une `<iframe>` la recharge, et le direct
 * repartirait de zéro à chaque rafraîchissement de la liste.
 */
const CLE_MEDIA_TW = 'jc.twitch.media';
const cadre = () => document.getElementById('twitchCadre');

/**
 * LES LIENS DU LECTEUR TWITCH, ET CE QU'ON PEUT VRAIMENT EN FAIRE.
 *
 * Le bandeau du lecteur porte le nom de la chaîne, « Gérer votre abonnement »,
 * un bouton de partage. Ces liens sont DANS le cadre, donc sur le domaine de
 * Twitch : aucun script d'ici ne peut savoir qu'on a cliqué, ni sur quoi. La
 * spécification l'interdit, et c'est exactement ce qui empêche Twitch de lire
 * le tableau de bord derrière. Les « ouvrir dans l'onglet » est donc
 * impossible, et il vaut mieux le dire que le promettre.
 *
 * Ce qui est possible : les EMPÊCHER d'éjecter hors de l'application. Un cadre
 * `sandbox` sans `allow-popups` ni `allow-top-navigation` ne peut ouvrir
 * aucune fenêtre et ne peut pas emporter la page avec lui. Le clic ne fait
 * alors rien du tout, au lieu de faire surgir le navigateur.
 *
 * Les quatre permissions gardées sont celles sans lesquelles le lecteur ne
 * joue pas : ses scripts, son propre stockage (`allow-same-origin` ne donne
 * aucun accès ici — le cadre reste sur l'origine de Twitch), ses formulaires
 * et la diffusion vers un écran externe.
 */
const BAC_A_SABLE = 'allow-scripts allow-same-origin allow-forms allow-presentation';

function poserCadre(url, { titre = 'Twitch' } = {}) {
  const boite = cadre();
  if (!boite) return;
  boite.hidden = false;
  boite.innerHTML = `<div class="dock-cadre-boite">
      <iframe class="dock-cadre" src="${echapper(url)}"
        title="Lecteur ${echapper(titre)}" sandbox="${BAC_A_SABLE}"
        allow="autoplay; encrypted-media; picture-in-picture; clipboard-write; fullscreen"
        allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
      <button class="tw-fermer-cadre" data-tw="fermer-cadre" title="Arrêter">×</button>
    </div>
    <p class="sp-note tw-note-cadre">Les liens du bandeau Twitch ci-dessus sont
      inertes : ils sont dans le cadre, donc chez Twitch, et rien d'ici ne peut
      les détourner. Pour ouvrir une chaîne, clique-la dans la liste en
      dessous — ou colle son adresse dans la recherche.</p>`;
}

/**
 * DEUX CADRES QUI PARLENT EN MÊME TEMPS, ÇA N'ARRIVE PAS.
 *
 * L'onglet YouTube et l'onglet Twitch ont maintenant chacun le leur, et tous
 * deux continuent de jouer quand on regarde ailleurs — c'est voulu, c'est ce
 * qui permet de garder le son en travaillant. Sauf que lancer un direct
 * par-dessus une vidéo donnait deux bandes-son superposées, et il fallait
 * aller couper la première à la main.
 *
 * L'annonce passe par un évènement plutôt que par un appel direct : `dock.js`
 * importe déjà ce module, l'inverse formerait un cycle.
 */
const annoncerLecture = (source) =>
  document.dispatchEvent(new CustomEvent('jc:media', { detail: { source } }));

/** Joue un média Twitch dans l'onglet Twitch. Point d'entrée depuis le dock. */
export function lireTwitch(media) {
  if (!media?.url) return false;
  montrerPanneau();
  poserCadre(media.url);
  localStorage.setItem(CLE_MEDIA_TW, media.url);
  annoncerLecture('twitch');
  return true;
}

function fermerCadre() {
  const boite = cadre();
  if (boite) { boite.innerHTML = ''; boite.hidden = true; }
  localStorage.removeItem(CLE_MEDIA_TW);
}

/** Lance un direct dans le cadre. `autoplay` : on vient de cliquer dessus. */
const regarderChaine = (login) => lireTwitch({ type: 'Twitch',
  url: `https://player.twitch.tv/?channel=${encodeURIComponent(login)}`
    + `&parent=${parent()}&autoplay=true` });

const regarderVideo = (id) => lireTwitch({ type: 'Twitch',
  url: `https://player.twitch.tv/?video=${encodeURIComponent(id)}`
    + `&parent=${parent()}&autoplay=true` });

/**
 * UNE ADRESSE TWITCH OUVRE LA BONNE VUE, PAS LE SITE.
 *
 * C'est le point d'entrée de l'interception des liens : coller une adresse
 * dans le champ de recherche, ou cliquer un lien `twitch.tv` ailleurs dans
 * l'application, mène ici. Une catégorie n'a pas d'identifiant dans son
 * adresse — seulement son nom — d'où la recherche préalable.
 */
export async function ouvrirLienTwitch(url) {
  const d = destinationTwitch(url);
  if (!d) return false;
  montrerPanneau();

  if (d.type === 'video') { regarderVideo(d.id); return true; }
  if (d.type === 'chaine') { aller({ nom: 'chaine', login: d.login }); return true; }
  if (d.type === 'accueil') { aller({ nom: 'accueil' }); return true; }

  try {
    const r = await API.twitchRecherche(d.nom);
    const exacte = (r.categories ?? []).find(c =>
      c.nom.toLowerCase() === d.nom.toLowerCase()) ?? r.categories?.[0];
    if (exacte) aller({ nom: 'categorie', id: exacte.id });
    else aller({ nom: 'recherche', q: d.nom });
  } catch (e) { signaler(e.message, 'erreur'); }
  return true;
}

// ────────────────────────────────────────────── connexion et cycle de vie

async function rafraichirEtat(toast) {
  try {
    const d = await API.twitchEtat();
    etat = { configure: d.configure, connecte: d.connecte, login: d.login ?? '' };
  } catch (e) {
    etat = { ...etat, connecte: false };
    if (toast) toast(e.message, 'erreur');
  }
  rendreTwitch();
  if (etat.connecte && !contenu.charge) aller({ nom: 'accueil' }, { empiler: false });
}

/** Redemande l'état : appelé à chaque fois que l'onglet Twitch revient devant. */
export async function ouvrirTwitch(toast) {
  await rafraichirEtat(toast);
}

/**
 * Demande un code, l'affiche, et surveille jusqu'à validation.
 *
 * ON INTERROGE LE SERVEUR, PAS L'ONGLET TWITCH. Celui-ci est sur un autre
 * domaine : tout ce qu'il contient nous est inaccessible. Le serveur, lui,
 * présente le `device_code` à Twitch en boucle — et Twitch répond « en
 * attente » jusqu'à ce que l'accord soit donné.
 *
 * LA CADENCE VIENT DE TWITCH. Interroger plus vite que l'intervalle annoncé
 * fait répondre `slow_down`, et on perd du temps au lieu d'en gagner.
 */
async function connecter() {
  let d;
  try { d = await API.twitchConnexion(); }
  catch (e) { return signaler(e.message, 'erreur'); }

  attente = d;
  rendreTwitch();

  // Copié AVANT d'ouvrir l'onglet : l'écriture dans le presse-papiers exige
  // que la page ait le focus, et elle vient de le perdre au profit de Twitch.
  await copierCode();
  window.open(d.url, '_blank');

  clearInterval(guet);
  guet = setInterval(async () => {
    if (!attente || Date.now() > attente.expireLe) {
      clearInterval(guet);
      attente = null;
      rendreTwitch();
      return signaler('Le code a expiré — recommence.', 'erreur');
    }
    try {
      const r = await API.twitchVerifier();
      if (r.statut !== 'ok') return;
      clearInterval(guet);
      attente = null;
      etat = { configure: true, connecte: true, login: r.login ?? '' };
      signaler(`Compte Twitch lié : ${r.login}.`);
      aller({ nom: 'accueil' }, { empiler: false });
    } catch (e) {
      clearInterval(guet);
      attente = null;
      rendreTwitch();
      signaler(e.message, 'erreur');
    }
  }, d.cadence ?? 5000);
}

async function copierCode() {
  if (!attente?.code) return false;
  try {
    await navigator.clipboard.writeText(attente.code);
    return true;
  } catch {
    // Le presse-papiers peut être refusé — page sans focus, permission niée.
    // Ce n'est pas une panne : le code est écrit en grand juste au-dessus.
    const e = document.getElementById('twEtat');
    if (e) e.textContent = 'Recopie le code à la main — le presse-papiers a été refusé.';
    return false;
  }
}

function annuler() {
  clearInterval(guet);
  attente = null;
  rendreTwitch();
}

export function installerTwitch(toast, lancer, montrer) {
  signaler = toast ?? (() => {});
  jouer = lancer ?? (() => {});
  montrerPanneau = montrer ?? (() => {});

  // Sur le CONTENEUR, jamais sur le panneau : celui-ci est reconstruit à
  // chaque rendu, et des écouteurs posés dessus ne survivraient pas au
  // premier rafraîchissement.
  const z = document.getElementById('dock');
  if (!z) return;

  z.addEventListener('click', async (e) => {
    const chaine = e.target.closest('[data-chaine]');
    if (chaine) return regarderChaine(chaine.dataset.chaine);

    const video = e.target.closest('[data-tw-video]');
    if (video) return regarderVideo(video.dataset.twVideo);

    const categorie = e.target.closest('[data-categorie]');
    if (categorie) return aller({ nom: 'categorie', id: categorie.dataset.categorie });

    const b = e.target.closest('[data-tw]');
    if (!b) return;
    if (b.dataset.tw === 'connexion') return connecter();
    if (b.dataset.tw === 'annuler') return annuler();
    if (b.dataset.tw === 'retour') return revenir();
    if (b.dataset.tw === 'fermer-cadre') return fermerCadre();
    if (b.dataset.tw === 'accueil') return aller({ nom: 'accueil' }, { empiler: false });
    if (b.dataset.tw === 'copier') {
      const ok = await copierCode();
      if (ok) signaler('Code copié.');
      return;
    }
    if (b.dataset.tw === 'ouvrir-activation') {
      await copierCode();
      window.open(attente?.url ?? 'https://www.twitch.tv/activate', '_blank');
      return;
    }
    if (b.dataset.tw === 'rafraichir') return aller(vue, { empiler: false });
    if (b.dataset.tw === 'deconnexion') {
      try { await API.twitchDeconnexion(); } catch (err) { signaler(err.message, 'erreur'); }
      contenu = { charge: false };
      pile = [];
      return rafraichirEtat(signaler);
    }
  });

  z.addEventListener('submit', async (e) => {
    if (e.target.id !== 'twForm') return;
    e.preventDefault();
    const q = document.getElementById('twQ')?.value.trim();
    if (!q) return;
    // Un lien collé n'est pas une recherche : il désigne quelque chose de
    // précis, et chercher son adresse comme du texte ne rendrait rien.
    if (await ouvrirLienTwitch(q)) return;
    aller({ nom: 'recherche', q });
  });

  // SUR LE DOCUMENT, ET C'EST VOULU.
  //
  // Un lien `twitch.tv` peut se trouver n'importe où dans l'application — une
  // note de candidature, la conversation Chill. Le comportement par défaut
  // d'un lien est de quitter l'application, ce qui est précisément ce qu'on
  // veut éviter ici : on l'intercepte pour ouvrir la vue correspondante.
  //
  // CE QUI RESTE HORS DE PORTÉE, ET IL FAUT LE SAVOIR : les liens à
  // l'intérieur du cadre du lecteur. Ce cadre est sur le domaine de Twitch,
  // aucun script d'ici ne peut ni les lire ni les intercepter — la
  // spécification l'interdit, et c'est ce qui protège le tableau de bord.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href*="twitch.tv"]');
    if (!a || !destinationTwitch(a.href)) return;
    e.preventDefault();
    ouvrirLienTwitch(a.href);
  });

  // Quelqu'un d'autre s'est mis à jouer : on se tait.
  document.addEventListener('jc:media', (e) => {
    if (e.detail?.source !== 'twitch') fermerCadre();
  });

  // ROUVRIR NE DOIT RIEN LANCER. On restaure ce qu'on regardait, sans le
  // `autoplay=true` posé par le clic d'origine : retrouver sa place le
  // lendemain matin est utile, se faire parler dessus ne l'est pas.
  const garde = localStorage.getItem(CLE_MEDIA_TW);
  if (garde) poserCadre(sansDemarrageAuto(garde));
}
