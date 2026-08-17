// Le panneau Spotify du lecteur flottant.
//
// DEUX MODES, ET C'EST LA CLÉ DE TOUT CE FICHIER
// -----------------------------------------------
// TÉLÉCOMMANDE — le serveur relaie les ordres vers un lecteur Spotify ouvert
// ailleurs. Aucun script étranger, aucun jeton dans la page. En échange, il
// faut que Spotify tourne quelque part, sinon tout revient en 404.
//
// LECTEUR INTÉGRÉ — la page s'inscrit elle-même comme appareil Spotify
// Connect et joue le son. Plus de 404, réponse instantanée, mais un script de
// Spotify s'exécute dans la page et le jeton y descend. Exige Premium, et se
// demande explicitement (voir `spotify-sdk.js` et la politique calculée dans
// `src/server.js`).
//
// L'INTERFACE EST LA MÊME DANS LES DEUX CAS. C'est délibéré : `resumeEtatSdk`
// produit exactement la forme que renvoie le serveur, et les commandes
// choisissent leur chemin au dernier moment. Sans cette symétrie, chaque
// affichage devrait savoir d'où vient son état — et se tromperait un jour sur
// deux.
//
// LE PANNEAU SE RAFRAÎCHIT SANS SE RECONSTRUIRE. Repeindre tout le panneau
// volait le focus du champ de recherche au milieu d'un mot et faisait sauter
// un curseur qu'on tirait. Seule la scène est redessinée — et même elle se
// fige le temps d'un geste.
import { API } from './api.js';
import { echapper } from './format.js';
import {
  demarrerLecteurLocal, arreterLecteurLocal, appareilLocal,
  volumeLocal, commandeLocale, positionLocale, resumeEtatSdk,
} from './spotify-sdk.js';

let etat = { configure: false, connecte: false, lecture: null, lecteur: null };
let resultats = { morceaux: [], playlists: [], albums: [], artistes: [] };
let playlists = [];
let appareils = [];
let file = [];
let recents = [];
let recherche = '';
let onglet = 'playlists';
let minuteur = null;
let horloge = null;

/** L'état du lecteur intégré. `volume` est gardé ici : le SDK ne le rapporte pas. */
const local = { pret: false, volume: 60, erreur: '' };

/** Tant que ce moment n'est pas passé, le rafraîchissement automatique se tait. */
let gele = 0;
const figer = (ms = 2500) => { gele = Date.now() + ms; };

const zone = () => document.getElementById('spotifyPanneau');
const actif = () => document.querySelector('.dock-page[data-page="spotify"].actif');

function duree(ms) {
  const s = Math.floor((ms ?? 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ────────────────────────────────────────────── états sans compte

function rendreNonConfigure() {
  return `<div class="sp-vide">
    <p><strong>Lier ton compte Spotify</strong> — pour chercher, lancer tes
      playlists et piloter la lecture sans quitter l'application.</p>
    <ol class="sp-etapes">
      <li>Sur <a href="https://developer.spotify.com/dashboard" target="_blank"
        rel="noopener">developer.spotify.com/dashboard</a>, crée une application.</li>
      <li>Dans ses réglages, ajoute exactement cette adresse de redirection :
        <code>http://127.0.0.1:3000/spotify/retour</code>
        <br><span class="sp-note">Spotify refuse « localhost » : il exige la
        boucle locale.</span></li>
      <li>Copie le <strong>Client ID</strong> — il est public, il n'y a
        <em>aucun secret</em> à fournir — et colle-le dans ton fichier
        <code>.env</code> :<br><code>SPOTIFY_CLIENT_ID=…</code></li>
      <li>Redémarre l'application.</li>
    </ol>
    <p class="sp-note">Il y a DEUX fichiers <code>.env</code> : celui du projet
      et celui de <code>Application\\</code>. C'est le second que lit
      l'exécutable.</p>
  </div>`;
}

function rendreDeconnecte() {
  return `<div class="sp-vide">
    <p>Ton <code>SPOTIFY_CLIENT_ID</code> est en place.</p>
    <button class="btn btn-primary" data-sp="connexion">Lier mon compte Spotify</button>
    <p class="sp-note">Tu seras envoyé sur Spotify pour autoriser, puis ramené
      ici. L'application ne voit jamais ton mot de passe.</p>
  </div>`;
}

// ────────────────────────────────────────────── la scène

const REPETITION = { off: 'context', context: 'track', track: 'off' };
const SIGNE_REPETITION = { off: '↻', context: '↻', track: '↻¹' };
const NOM_REPETITION = {
  off: 'Répétition : aucune', context: 'Répétition : la playlist',
  track: 'Répétition : ce morceau',
};

/**
 * LA SCÈNE : la pochette EST le fond.
 *
 * La même image sert deux fois — nette au premier plan, et derrière, agrandie
 * et floutée à outrance. C'est ce qui donne l'ambiance colorée du morceau sans
 * lire un seul pixel : extraire une couleur dominante demanderait un canevas,
 * donc une image de même origine, donc un relais côté serveur pour contourner
 * le cloisonnement. Un flou de quarante pixels fait le même travail, en une
 * ligne de CSS et sans requête supplémentaire.
 */
function rendreScene(l) {
  if (!l) return '<div class="sp-scene sp-scene-vide"><div class="sp-rien">Chargement…</div></div>';

  const sansAppareil = !l.appareil;
  const fond = l.pochette
    ? `style="background-image:url('${echapper(l.pochette)}')"` : '';
  const avance = l.duree ? Math.min(100, (l.position / l.duree) * 100) : 0;
  const volume = l.volume ?? (l.local ? local.volume : null);

  if (!l.titre) {
    return `<div class="sp-scene sp-scene-vide">
      <div class="sp-rien">Rien en cours. Lance un morceau ci-dessous, ou
        depuis Spotify sur n'importe quel appareil.</div>
      ${sansAppareil ? rendreSansAppareil() : ''}
    </div>`;
  }

  return `<div class="sp-scene${l.joue ? ' joue' : ''}">
    <div class="sp-ambiance" ${fond} aria-hidden="true"></div>
    <div class="sp-scene-corps">
      ${l.pochette
    ? `<img class="sp-pochette" src="${echapper(l.pochette)}" alt="" draggable="false">`
    : '<div class="sp-pochette sp-pochette-vide" aria-hidden="true">♪</div>'}
      <div class="sp-infos">
        <div class="sp-titre" title="${echapper(l.titre)}">${echapper(l.titre)}</div>
        <div class="sp-artistes">${echapper(l.artistes)}</div>
        ${l.album ? `<div class="sp-album">${echapper(l.album)}</div>` : ''}
      </div>

      <div class="sp-avance">
        <span class="sp-temps">${duree(l.position)}</span>
        <input type="range" class="sp-curseur sp-position" data-sp-champ="position"
          min="0" max="${l.duree || 1}" value="${l.position ?? 0}" step="1000"
          style="--avance:${avance}%" aria-label="Position dans le morceau">
        <span class="sp-temps">-${duree(Math.max(0, (l.duree ?? 0) - (l.position ?? 0)))}</span>
      </div>

      <div class="sp-commandes">
        <button class="sp-cmd ${l.aleatoire ? 'allume' : ''}" data-sp="aleatoire"
          title="Lecture aléatoire${l.aleatoire ? ' (activée)' : ''}">⤨</button>
        <button class="sp-cmd" data-sp="precedent" title="Précédent">⏮</button>
        <button class="sp-cmd sp-grand" data-sp="${l.joue ? 'pause' : 'lire'}"
          title="${l.joue ? 'Pause' : 'Lecture'}">${l.joue ? '⏸' : '▶'}</button>
        <button class="sp-cmd" data-sp="suivant" title="Suivant">⏭</button>
        <button class="sp-cmd ${l.repetition !== 'off' ? 'allume' : ''}" data-sp="repetition"
          title="${NOM_REPETITION[l.repetition] ?? NOM_REPETITION.off}"
          >${SIGNE_REPETITION[l.repetition] ?? '↻'}</button>
      </div>

      <div class="sp-pied-scene">
        ${volume === null
    ? '<span class="sp-note">Volume non réglable sur cet appareil</span>'
    : `<span class="sp-vol-signe" aria-hidden="true">${volume === 0 ? '🔇' : '🔊'}</span>
          <input type="range" class="sp-curseur sp-vol" data-sp-champ="volume"
            min="0" max="100" value="${volume}" style="--avance:${volume}%"
            aria-label="Volume">`}
        <span class="sp-ou ${l.local ? 'ici' : ''}"
          title="${l.local ? 'Le son sort de cette fenêtre' : 'Le son sort d\'un autre appareil'}"
          >${l.local ? '● ici' : echapper(l.appareil || '—')}</span>
        <button class="sp-cmd sp-petit" data-sp="plein-ecran" title="Plein écran">⤢</button>
      </div>
    </div>
    ${sansAppareil ? rendreSansAppareil() : ''}
  </div>`;
}

/**
 * L'ABSENCE D'APPAREIL EST LA PANNE LA PLUS DÉROUTANTE DE SPOTIFY.
 *
 * L'API ne joue rien elle-même : elle télécommande un lecteur ouvert ailleurs.
 * Sans lecteur, toute commande revient en 404 — « aucun appareil actif » —, ce
 * qui n'apprend rien à qui a justement Spotify ouvert sur son téléphone.
 *
 * Le lecteur intégré est la vraie réponse, et il est proposé en premier.
 */
function rendreSansAppareil() {
  return `<div class="sp-alerte">
    <p><strong>Aucun appareil Spotify actif.</strong> L'application ne joue pas
      elle-même : elle télécommande un lecteur ouvert ailleurs.</p>
    ${etat.lecteur?.actif
    ? '<p class="sp-note">Le lecteur intégré est activé mais pas encore prêt — '
      + 'un instant, ou recharge la page.</p>'
    : `<button class="btn btn-primary" data-sp="activer-local">Jouer ici, dans l'application</button>`}
    <button class="btn" data-sp="spotify-web">Ouvrir Spotify dans un onglet</button>
  </div>`;
}

// ────────────────────────────────────────────── la bibliothèque

const ONGLETS = {
  playlists: 'Playlists',
  recherche: 'Recherche',
  paroles: 'Paroles',
  file: 'À suivre',
  recents: 'Récents',
};

/**
 * Le contenu ouvert : une playlist, un album, un artiste — ou rien.
 *
 * SANS ÇA, UNE PLAYLIST NE POUVAIT QU'ÊTRE LANCÉE. Quatre-vingts titres
 * derrière un seul bouton, sans voir ce qu'il y avait dedans ni pouvoir aller
 * au morceau qu'on cherchait. C'est la différence entre une télécommande et
 * une bibliothèque.
 */
let ouvert = null;

/** Les paroles du morceau en cours, et l'uri pour laquelle on les a demandées. */
let paroles = { pour: null, etat: 'vide', data: null };

function vignette(i, classe = '') {
  return i.pochette
    ? `<img class="${classe}" src="${echapper(i.pochette)}" alt="" loading="lazy">`
    : `<span class="sp-vignette ${classe}"></span>`;
}

/**
 * Une liste de lignes.
 *
 * `ouvrable` change ce que fait le CLIC PRINCIPAL : sur un morceau il lance,
 * sur une playlist il ouvre. C'est la convention de tous les lecteurs, et
 * l'inverse rendait le contenu d'une playlist inatteignable — le seul geste
 * possible était de lancer les quatre-vingts titres.
 */
function rendreListe(items, { melange = false, enfiler = false, ouvrable = false,
  contexte = null } = {}) {
  if (!items.length) return '';
  return `<ul class="sp-liste">${items.map(i => `<li>
    <button ${ouvrable ? `data-ouvrir="${echapper(i.uri)}"`
    : `data-uri="${echapper(contexte ?? i.uri)}"`}
      ${contexte ? `data-depart="${i.rang ?? 0}"` : ''}
      ${i.pistes ? `data-pistes="${i.pistes}"` : ''}>
      ${vignette(i)}
      <span class="sp-l-infos">
        <span class="sp-l-titre">${echapper(i.titre ?? i.nom)}</span>
        <span class="sp-l-artiste">${echapper(i.artistes ?? (i.pistes !== undefined
    ? `${i.pistes} titre${i.pistes > 1 ? 's' : ''}` : ''))}</span>
      </span>
      ${i.duree ? `<span class="sp-temps">${duree(i.duree)}</span>` : ''}
    </button>
    ${enfiler ? `<button class="sp-action" data-enfiler="${echapper(i.uri)}"
      title="Mettre à la suite">＋</button>` : ''}
    ${ouvrable ? `<button class="sp-action" data-uri="${echapper(i.uri)}"
      title="Tout lancer">▶</button>` : ''}
    ${melange ? `<button class="sp-action" data-uri="${echapper(i.uri)}"
      data-pistes="${i.pistes ?? 0}" data-melanger="1"
      title="Lancer en aléatoire">⤨</button>` : ''}
  </li>`).join('')}</ul>`;
}

/**
 * Le contenu ouvert : son en-tête, et ses pistes.
 *
 * Chaque piste garde son RANG et lance le contexte à partir de là. Jouer le
 * quarantième titre d'une playlist n'est pas jouer ce morceau seul : la suite
 * doit continuer, sinon le silence tombe trois minutes plus tard.
 */
function rendreOuvert() {
  return `
    <div class="sp-fil">
      <button class="sp-retour" data-sp="fermer-contenu">← Retour</button>
      ${ouvert.pochette
    ? `<img class="sp-fil-pochette" src="${echapper(ouvert.pochette)}" alt="">` : ''}
      <span class="sp-fil-nom">${echapper(ouvert.nom || 'Contenu')}</span>
      ${ouvert.contexte ? `<button class="sp-action" data-uri="${echapper(ouvert.contexte)}"
        title="Tout lancer">▶</button>
        <button class="sp-action" data-uri="${echapper(ouvert.contexte)}"
        data-pistes="${ouvert.pistes.length}" data-melanger="1"
        title="Lancer en aléatoire">⤨</button>` : ''}
    </div>
    ${ouvert.pistes.length
    ? rendreListe(ouvert.pistes, { enfiler: true, contexte: ouvert.contexte })
    : (ouvert.restreint ? rendreRestreinte() : '<div class="sp-rien">Chargement…</div>')}`;
}

/**
 * QUAND SPOTIFY REFUSE LA LISTE MAIS ACCEPTE LA LECTURE.
 *
 * Mesuré sur ce compte : les 12 playlists qui lui appartiennent s'ouvrent, 23
 * des 24 qu'il suit sont refusées — et toutes se lancent. C'est une
 * restriction de l'API sur les playlists d'autrui, pas une panne, et surtout
 * pas une histoire d'abonnement : l'ancien message annonçait « il faut
 * Premium » à un abonné Premium.
 *
 * On le dit, et on laisse le bouton qui marche. Une liste vide sans phrase
 * aurait l'air d'un chargement qui n'aboutit jamais.
 */
function rendreRestreinte() {
  return `<div class="sp-vide">
    <p>Spotify n'ouvre pas le détail des playlists qui ne t'appartiennent pas —
      c'est une limite de son API, pas de ton abonnement.</p>
    <p class="sp-note"><strong>La lecture, elle, marche</strong> : le bouton ▶
      ci-dessus la lance, et ⤨ la lance en aléatoire. Tes propres playlists
      s'ouvrent normalement.</p>
  </div>`;
}

/**
 * LES PAROLES, ET POURQUOI ELLES DÉFILENT.
 *
 * Un bloc de texte, on le lit une fois ; une ligne qui s'allume au bon moment
 * se suit sans y penser. Quand LRCLIB rend des paroles synchronisées, la ligne
 * courante est surlignée et amenée au centre — sinon on affiche le texte, ce
 * qui vaut toujours mieux que rien.
 */
function rendreParoles() {
  if (!etat.lecture?.titre) {
    return '<div class="sp-rien">Lance un morceau : les paroles suivront.</div>';
  }
  if (paroles.etat === 'charge') return '<div class="sp-rien">Recherche des paroles…</div>';
  if (paroles.etat === 'panne') {
    return `<div class="sp-rien">Paroles indisponibles.<br>
      <span class="sp-note">${echapper(paroles.data ?? '')}</span></div>`;
  }
  const p = paroles.data;
  if (!p?.trouve) {
    return `<div class="sp-rien">Aucunes paroles trouvées pour ce morceau.
      <br><span class="sp-note">La base est communautaire : les titres récents
      ou peu écoutés y manquent souvent.</span></div>`;
  }
  if (p.instrumental) return '<div class="sp-rien">Morceau instrumental.</div>';

  if (!p.synchro) {
    return `<div class="sp-paroles sp-paroles-plates">
      <p class="sp-note">Paroles non synchronisées — elles ne défileront pas.</p>
      ${echapper(p.texte).replace(/\n/g, '<br>')}</div>`;
  }
  return `<div class="sp-paroles" id="spParoles">
    ${p.lignes.map((l, i) => `<p class="sp-parole" data-t="${l.t}" data-i="${i}"
      >${echapper(l.texte) || '♪'}</p>`).join('')}
    ${p.source ? `<p class="sp-note sp-paroles-src">LRCLIB · ${echapper(p.source)}</p>` : ''}
  </div>`;
}

function rendreSection(titre, contenu, aide = '') {
  if (!contenu) return '';
  return `<div class="tw-titre">${echapper(titre)}
    ${aide ? `<span class="sp-note">${echapper(aide)}</span>` : ''}</div>${contenu}`;
}

function rendreBibliotheque() {
  const barre = `<nav class="sp-onglets">${Object.entries(ONGLETS).map(([c, l]) => `
    <button data-sp-onglet="${c}" class="${onglet === c ? 'actif' : ''}">${l}</button>`)
    .join('')}</nav>`;

  let corps = '';
  if (ouvert && onglet !== 'paroles') {
    corps = rendreOuvert();
  } else if (onglet === 'paroles') {
    corps = rendreParoles();
  } else if (onglet === 'recherche') {
    corps = `
      <form class="sp-chercher" id="spForm">
        <input id="spQ" placeholder="Morceau, album, artiste, playlist…"
          autocomplete="off" value="${echapper(recherche)}">
        <button class="btn" type="submit">Chercher</button>
      </form>
      ${rendreSection('Morceaux', rendreListe(resultats.morceaux, { enfiler: true }))}
      ${rendreSection('Albums', rendreListe(resultats.albums,
    { ouvrable: true, melange: true }), 'clique pour ouvrir')}
      ${rendreSection('Artistes', rendreListe(resultats.artistes, { ouvrable: true }))}
      ${rendreSection('Playlists', rendreListe(resultats.playlists,
    { ouvrable: true, melange: true }), 'clique pour ouvrir')}
      ${recherche && !resultats.morceaux.length && !resultats.albums.length
    ? '<div class="sp-rien">Rien trouvé.</div>' : ''}`;
  } else if (onglet === 'playlists') {
    corps = playlists.length
      ? rendreSection('Mes playlists', rendreListe(playlists,
        { ouvrable: true, melange: true }), 'clique pour ouvrir · ⤨ aléatoire')
      : '<div class="sp-rien">Chargement…</div>';
  } else if (onglet === 'file') {
    corps = file.length
      ? rendreSection('Ce qui vient', rendreListe(file))
      : '<div class="sp-rien">La file est vide — ou l\'appareil ne la partage pas.</div>';
  } else {
    corps = recents.length
      ? rendreSection('Écoutés récemment', rendreListe(recents, { enfiler: true }))
      : '<div class="sp-rien">Chargement…</div>';
  }
  return barre + `<div class="sp-biblio">${corps}</div>`;
}

// ────────────────────────────────────────────── le panneau

function rendreLecteurLocal() {
  const l = etat.lecteur;
  if (!l) return '';
  if (!l.actif) {
    return `<button class="chill-vider" data-sp="activer-local"
      title="La page devient elle-même un appareil Spotify. Exige Premium.">Jouer ici</button>`;
  }
  if (local.erreur) {
    return `<button class="chill-vider sp-panne" data-sp="desactiver-local"
      title="${echapper(local.erreur)}">Lecteur en panne</button>`;
  }
  return `<button class="chill-vider ${local.pret ? 'sp-allume' : ''}" data-sp="desactiver-local"
    title="${local.pret ? 'Le son sort de cette fenêtre. Cliquer pour revenir en télécommande.'
    : 'Démarrage du lecteur…'}">${local.pret ? '● Joue ici' : 'Démarrage…'}</button>`;
}

export function rendreSpotify() {
  const z = zone();
  if (!z) return;

  if (!etat.configure) { z.innerHTML = rendreNonConfigure(); return; }
  if (!etat.connecte) { z.innerHTML = rendreDeconnecte(); return; }

  const manque = etat.lecteur?.manque ?? [];

  z.innerHTML = `
    <div class="sp-tete">
      ${rendreLecteurLocal()}
      <button class="chill-vider" data-sp="appareils">Appareils</button>
      <button class="chill-vider" data-sp="deconnexion">Délier</button>
    </div>

    ${etat.lecteur?.actif && manque.length ? `<div class="sp-alerte">
      <p><strong>Ton autorisation date d'avant le lecteur intégré.</strong>
      Il manque : <code>${echapper(manque.join(', '))}</code>.</p>
      <p class="sp-note">Délie puis relie ton compte — Spotify redemandera
        l'accord, cette fois avec la permission de jouer ici.</p>
    </div>` : ''}

    <div id="spLecture">${rendreScene(etat.lecture)}</div>
    ${appareils.length ? `<label class="sp-appareils">Écouter sur
      <select data-sp-champ="appareil">
        ${appareils.map(a => `<option value="${echapper(a.id)}" ${a.actif ? 'selected' : ''}>
          ${echapper(a.nom)}${a.type ? ` · ${echapper(a.type)}` : ''}</option>`).join('')}
      </select></label>` : ''}
    ${rendreBibliotheque()}`;
}

/** Ne repeint QUE la scène : le reste garde son focus et sa saisie. */
function rendreSceneSeule() {
  const c = document.getElementById('spLecture');
  if (c) c.innerHTML = rendreScene(etat.lecture);
}

// ────────────────────────────────────────────── l'état

async function rafraichirEtat(toast) {
  try {
    const d = await API.spotifyEtat();
    etat = {
      configure: d.configure, connecte: d.connecte,
      lecture: d.lecture ?? null, lecteur: d.lecteur ?? null,
    };
  } catch (e) {
    etat = { ...etat, connecte: false };
    if (toast) toast(e.message, 'erreur');
  }
  rendreSpotify();
  if (etat.connecte && etat.lecteur?.actif && !local.pret && !local.erreur) brancherLocal();
}

async function rafraichirLecture() {
  try {
    const d = await API.spotifyLecture();
    etat.lecture = d.lecture;
    rendreSceneSeule();
    if (onglet === 'paroles') chargerParoles();
  } catch (e) {
    // UN COMPTE DÉLIÉ NE SE REDEMANDE PAS TOUTES LES CINQ SECONDES. Le serveur
    // répond 409 quand le jeton est mort ; sans cette sortie, le panneau
    // continuait d'interroger indéfiniment une session qui n'existe plus, en
    // affichant un morceau figé qui ne jouait nulle part.
    if (e.statut === 409) {
      etat.connecte = false;
      clearInterval(minuteur);
      rendreSpotify();
    }
    // Toute autre panne est passagère — un appareil qui s'endort, le réseau :
    // on réessaiera au tour suivant.
  }
}

/**
 * LA BARRE AVANCE SANS RIEN DEMANDER À PERSONNE.
 *
 * Interroger Spotify chaque seconde pour faire bouger un curseur serait un
 * appel réseau par seconde pour une information qu'on peut déduire : le temps
 * passe tout seul. On n'appelle donc que toutes les cinq secondes pour se
 * recaler, et entre deux on avance l'horloge localement.
 */
function battre() {
  clearInterval(horloge);
  horloge = setInterval(() => {
    const l = etat.lecture;
    if (!l?.joue || !l.duree || document.hidden || !actif()) return;
    if (Date.now() < gele) return;
    l.position = Math.min(l.duree, (l.position ?? 0) + 1000);
    const barre = document.querySelector('.sp-position');
    if (barre) {
      barre.value = String(l.position);
      barre.style.setProperty('--avance', `${(l.position / l.duree) * 100}%`);
      const temps = barre.parentElement.querySelectorAll('.sp-temps');
      if (temps[0]) temps[0].textContent = duree(l.position);
      if (temps[1]) temps[1].textContent = `-${duree(l.duree - l.position)}`;
    }
    suivreParoles();
  }, 1000);
}

/**
 * Surligne la ligne de paroles en cours et l'amène au centre.
 *
 * ON NE REDESSINE RIEN : les lignes sont déjà là, seule la classe bouge. Un
 * `innerHTML` par seconde sur deux cents lignes ferait sauter le défilement à
 * chaque battement, et rendrait le texte impossible à lire à la souris.
 *
 * `nearest` et pas `center` sur le défilement : ramener brutalement au milieu
 * empêcherait de faire défiler soi-même pour lire plus loin.
 */
function suivreParoles() {
  if (onglet !== 'paroles' || !paroles.data?.synchro) return;
  const zone = document.getElementById('spParoles');
  if (!zone) return;

  const position = (etat.lecture?.position ?? 0) + 300;   // un peu d'avance : on lit avant
  const lignes = paroles.data.lignes;
  let i = -1;
  for (let k = 0; k < lignes.length; k++) {
    if (lignes[k].t <= position) i = k; else break;
  }
  const dejaLa = zone.querySelector('.sp-parole.ici');
  if (Number(dejaLa?.dataset.i ?? -1) === i) return;

  dejaLa?.classList.remove('ici');
  if (i < 0) return;
  const cible = zone.querySelector(`.sp-parole[data-i="${i}"]`);
  if (!cible) return;
  cible.classList.add('ici');
  cible.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/**
 * Demande les paroles, une fois par morceau.
 *
 * `paroles.pour` retient l'URI : sans elle, chaque battement d'horloge
 * relancerait une recherche pour le même titre — quatre requêtes par seconde
 * vers un service communautaire gratuit.
 */
async function chargerParoles(force = false) {
  const l = etat.lecture;
  if (!l?.titre) { paroles = { pour: null, etat: 'vide', data: null }; return; }
  if (!force && paroles.pour === l.uri) return;

  paroles = { pour: l.uri, etat: 'charge', data: null };
  if (onglet === 'paroles') rendreSpotify();
  try {
    const d = await API.spotifyParoles(l);
    paroles = { pour: l.uri, etat: 'ok', data: d.paroles };
  } catch (e) {
    paroles = { pour: l.uri, etat: 'panne', data: e.message };
  }
  if (onglet === 'paroles') { rendreSpotify(); suivreParoles(); }
}

/**
 * Le recalage périodique. Il se tait dans quatre cas : rien de connecté,
 * onglet du navigateur caché, panneau derrière un autre, ou geste en cours —
 * sinon une réponse en retard remettrait l'ancien volume une seconde après
 * qu'on l'ait changé.
 *
 * En lecteur intégré, il devient presque inutile : le SDK PRÉVIENT à chaque
 * changement. On le garde plus lent, pour le volume et l'appareil.
 */
function suivre() {
  clearInterval(minuteur);
  minuteur = setInterval(() => {
    if (!etat.connecte || document.hidden || !actif()) return;
    if (!zone()) { clearInterval(minuteur); clearInterval(horloge); return; }
    if (Date.now() < gele) return;
    if (local.pret) return;
    rafraichirLecture();
  }, 5000);
}

// ────────────────────────────────────────────── le lecteur intégré

let signaler = () => {};

async function brancherLocal() {
  try {
    const id = await demarrerLecteurLocal({
      surEtat: (brut) => {
        const e = resumeEtatSdk(brut);
        if (!e) return;
        // Le volume n'est pas dans l'état du SDK : on garde le nôtre, sinon le
        // curseur retomberait à sa valeur par défaut à chaque morceau.
        etat.lecture = { ...e, volume: local.volume };
        if (Date.now() >= gele) rendreSceneSeule();
        if (onglet === 'paroles') chargerParoles();
      },
      surErreur: (m) => {
        local.erreur = m; local.pret = false;
        signaler(m, 'erreur');
        rendreSpotify();
      },
    });
    local.pret = true;
    local.erreur = '';
    // LE TRANSFERT EST OBLIGATOIRE. Le SDK s'inscrit comme appareil DISPONIBLE
    // et rien ne joue tant qu'on ne lui a pas donné la main : on voit « prêt »
    // et on n'entend rien. C'est la panne la plus déroutante de tout ceci.
    await API.spotifyAppareil(id).catch(() => {});
    await volumeLocal(local.volume);
    rendreSpotify();
    signaler('Le son sort maintenant de cette fenêtre.');
  } catch (e) {
    local.erreur = e.message;
    local.pret = false;
    rendreSpotify();
  }
}

async function activerLocal() {
  try {
    await API.spotifyLecteurLocal(true);
  } catch (e) { return signaler(e.message, 'erreur'); }
  // LA POLITIQUE DE SÉCURITÉ EST UN EN-TÊTE, posé à chaque réponse. Elle ne
  // change donc pas pour une page déjà chargée : sans rechargement, le SDK
  // serait bloqué et l'option aurait l'air de ne rien faire.
  signaler('Lecteur intégré activé — la page se recharge.');
  setTimeout(() => location.reload(), 700);
}

async function desactiverLocal() {
  arreterLecteurLocal();
  local.pret = false; local.erreur = '';
  try { await API.spotifyLecteurLocal(false); } catch { /* on recharge quand même */ }
  signaler('Retour en télécommande — la page se recharge.');
  setTimeout(() => location.reload(), 700);
}

// ────────────────────────────────────────────── câblage

/** Le rang de départ : c'est lui qui évite de réentendre le même premier titre
 *  chaque fois qu'on relance une playlist « au hasard ». */
const depart = (pistes) => (pistes > 1 ? Math.floor(Math.random() * Math.min(pistes, 500)) : 0);

/**
 * Remplit l'onglet courant.
 *
 * LE DÉFAUT QUE ÇA CORRIGE : les données n'étaient demandées qu'au CLIC sur un
 * onglet. Or « Playlists » est celui qui s'ouvre par défaut — il affichait donc
 * « Chargement… » indéfiniment à qui ne pensait pas à cliquer sur l'onglet
 * déjà actif. Un panneau qui prétend charger sans rien attendre est pire qu'un
 * panneau vide : on patiente.
 */
async function charger(quoi = onglet) {
  try {
    if (quoi === 'playlists') playlists = (await API.spotifyPlaylists()).playlists;
    else if (quoi === 'file') file = (await API.spotifyFile()).file;
    else if (quoi === 'recents') recents = (await API.spotifyRecents()).recents;
    else if (quoi === 'paroles') return chargerParoles();
    else return;
    rendreSpotify();
  } catch (err) { signaler(err.message, 'erreur'); }
  return undefined;
}

/** Ouvre une playlist, un album ou un artiste, et montre ses pistes. */
async function ouvrirContenu(uri) {
  ouvert = { nom: '', pochette: null, contexte: null, pistes: [], restreint: false };
  rendreSpotify();
  try {
    const d = await API.spotifyContenu(uri);
    ouvert = { nom: d.nom ?? '', pochette: d.pochette ?? null,
      contexte: d.contexte, pistes: d.pistes ?? [], restreint: Boolean(d.restreint) };
  } catch (err) {
    ouvert = null;
    signaler(err.message, 'erreur');
  }
  rendreSpotify();
}

/** Redemande l'état : appelé chaque fois que l'onglet Spotify revient devant. */
export async function ouvrirSpotify(toast) {
  await rafraichirEtat(toast);
  if (etat.connecte) charger();
  suivre();
  battre();
}

export function installerSpotify(toast) {
  signaler = toast ?? (() => {});

  const z = document.getElementById('dock');
  if (!z) return;

  /**
   * Toute commande gèle le rafraîchissement puis redemande l'état.
   *
   * Sans le gel, la réponse d'un appel parti AVANT le geste arrive après lui
   * et écrase ce qu'on vient de faire : on monte le son, et une seconde plus
   * tard le curseur redescend tout seul.
   *
   * LE CHEMIN COURT D'ABORD : quand le son sort d'ici, le SDK agit sans
   * aller-retour réseau. Sur un curseur qu'on tire, c'est la différence entre
   * un réglage et une télécommande à piles usées.
   */
  const commander = async (action, options = {}) => {
    figer();
    try {
      const court = local.pret && await raccourci(action, options);
      if (!court) await API.spotifyCommande(action, options);
      setTimeout(() => { gele = 0; if (!local.pret) rafraichirLecture(); }, 500);
    } catch (err) { gele = 0; signaler(err.message, 'erreur'); }
  };

  const raccourci = async (action, o) => {
    if (action === 'volume') { local.volume = o.valeur; return volumeLocal(o.valeur); }
    if (action === 'position') return positionLocale(o.valeur);
    if (action === 'lire' && !o.uri) return commandeLocale('lire');
    if (['pause', 'suivant', 'precedent'].includes(action)) return commandeLocale(action);
    return false;   // aléatoire, répétition et lancement d'un contexte passent par l'API
  };

  const changerAppareil = async (id) => {
    figer();
    try {
      await API.spotifyAppareil(id);
      setTimeout(() => { gele = 0; rafraichirLecture(); }, 800);
    } catch (err) { gele = 0; signaler(err.message, 'erreur'); }
  };

  z.addEventListener('click', async (e) => {
    const cible = e.target.closest('[data-ouvrir]');
    if (cible) return ouvrirContenu(cible.dataset.ouvrir);

    // Cliquer une ligne de paroles y emmène : c'est le geste qu'on fait quand
    // on veut réécouter le passage qu'on vient de lire.
    const parole = e.target.closest('.sp-parole');
    if (parole) return commander('position', { valeur: Number(parole.dataset.t) });

    const enfiler = e.target.closest('[data-enfiler]');
    if (enfiler) {
      try {
        await API.spotifyEnfiler(enfiler.dataset.enfiler);
        signaler('Mis à la suite.');
        if (onglet === 'file') charger('file');
      } catch (err) { signaler(err.message, 'erreur'); }
      return;
    }

    const piste = e.target.closest('[data-uri]');
    if (piste) {
      const melanger = piste.dataset.melanger === '1';
      // `data-depart` vient d'une piste DANS un contexte ouvert : on lance la
      // playlist à ce rang, pas le morceau tout seul — sinon le silence tombe
      // à la fin du titre.
      const rang = piste.dataset.depart !== undefined ? Number(piste.dataset.depart) : null;
      return commander('lire', {
        uri: piste.dataset.uri,
        aleatoire: melanger,
        depart: melanger ? depart(Number(piste.dataset.pistes)) : (rang ?? 0),
      });
    }

    const tab = e.target.closest('[data-sp-onglet]');
    if (tab) {
      onglet = tab.dataset.spOnglet;
      // Changer d'onglet referme le contenu ouvert : y revenir plus tard, sur
      // une playlist dont on ne se souvient plus, désoriente plus que ça n'aide.
      if (onglet !== 'paroles') ouvert = null;
      rendreSpotify();
      if (onglet === 'playlists' && !playlists.length) charger('playlists');
      if (onglet === 'file') charger('file');
      if (onglet === 'recents' && !recents.length) charger('recents');
      if (onglet === 'recherche') document.getElementById('spQ')?.focus();
      if (onglet === 'paroles') { await chargerParoles(); suivreParoles(); }
      return;
    }

    const b = e.target.closest('[data-sp]');
    if (!b) return;
    const quoi = b.dataset.sp;

    if (quoi === 'connexion') {
      try {
        const d = await API.spotifyConnexion();
        // On QUITTE la page pour autoriser, puis Spotify nous ramène là d'où
        // l'on vient — le serveur retient l'origine, voir /spotify/connexion.
        window.location.href = d.url;
      } catch (err) { signaler(err.message, 'erreur'); }
      return;
    }
    if (quoi === 'deconnexion') {
      arreterLecteurLocal();
      local.pret = false;
      await API.spotifyDeconnexion();
      resultats = { morceaux: [], playlists: [], albums: [], artistes: [] };
      playlists = []; appareils = []; file = []; recents = [];
      return rafraichirEtat(signaler);
    }
    if (quoi === 'fermer-contenu') { ouvert = null; return rendreSpotify(); }
    if (quoi === 'activer-local') return activerLocal();
    if (quoi === 'desactiver-local') return desactiverLocal();
    if (quoi === 'spotify-web') {
      window.open('https://open.spotify.com/', '_blank');
      return signaler('Lance un morceau dans cet onglet : il devient l\'appareil '
        + 'que l\'application pilote.');
    }
    if (quoi === 'plein-ecran') {
      const dock = document.getElementById('dock');
      if (document.fullscreenElement) document.exitFullscreen();
      else dock.requestFullscreen?.().catch(err => signaler(err.message, 'erreur'));
      return;
    }
    if (quoi === 'appareils') {
      try {
        appareils = (await API.spotifyAppareils()).appareils;
        rendreSpotify();
        if (!appareils.length) signaler('Aucun appareil Spotify joignable.', 'erreur');
      } catch (err) { signaler(err.message, 'erreur'); }
      return;
    }
    if (quoi === 'aleatoire') return commander('aleatoire', { valeur: !etat.lecture?.aleatoire });
    if (quoi === 'repetition') {
      return commander('repetition',
        { valeur: REPETITION[etat.lecture?.repetition ?? 'off'] ?? 'context' });
    }
    if (['lire', 'pause', 'suivant', 'precedent'].includes(quoi)) return commander(quoi);
  });

  // Tirer un curseur produit un `input` à chaque pixel : n'envoyer la commande
  // qu'au relâchement évite trois cents appels pour un geste. Le gel commence
  // dès le premier mouvement, sinon le rafraîchissement remettrait le curseur
  // à sa place pendant qu'on le tient.
  z.addEventListener('input', (e) => {
    const c = e.target.closest('.sp-curseur');
    if (!c) return;
    figer(15000);
    c.style.setProperty('--avance', `${(c.value / (c.max || 1)) * 100}%`);
  });

  z.addEventListener('change', (e) => {
    const champ = e.target.dataset?.spChamp;
    if (!champ) return;
    if (champ === 'appareil') return changerAppareil(e.target.value);
    if (champ === 'volume') return commander('volume', { valeur: Number(e.target.value) });
    if (champ === 'position') return commander('position', { valeur: Number(e.target.value) });
  });

  z.addEventListener('submit', async (e) => {
    if (e.target.id !== 'spForm') return;
    e.preventDefault();
    recherche = document.getElementById('spQ')?.value.trim() ?? '';
    if (!recherche) return;
    try {
      const d = await API.spotifyRecherche(recherche);
      resultats = {
        morceaux: d.resultats ?? [], playlists: d.playlists ?? [],
        albums: d.albums ?? [], artistes: d.artistes ?? [],
      };
      rendreSpotify();
    } catch (err) { signaler(err.message, 'erreur'); }
  });

  // Le plein écran change la mise en page du lecteur : sans ce rendu, on
  // resterait sur une scène dimensionnée pour une fenêtre de 400 px.
  document.addEventListener('fullscreenchange', () => {
    document.getElementById('dock')?.classList.toggle('plein', Boolean(document.fullscreenElement));
  });

  // Le retour d'autorisation revient avec `?spotify=…` : on le dit, puis on
  // nettoie l'adresse — un paramètre qui traîne réapparaît à chaque
  // rechargement et refait surgir le message.
  const p = new URLSearchParams(location.search);
  const s = p.get('spotify');
  if (s) {
    const messages = {
      ok: ['Compte Spotify lié.', ''],
      refus: ['Autorisation refusée.', 'erreur'],
      invalide: ['Retour Spotify invalide — recommence.', 'erreur'],
      echec: [`Échec de la liaison : ${p.get('m') ?? ''}`, 'erreur'],
    };
    const [m, type] = messages[s] ?? ['', ''];
    if (m) signaler(m, type);
    history.replaceState({}, '', location.pathname);
  }
}
