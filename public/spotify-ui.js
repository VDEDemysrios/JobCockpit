// Le panneau Spotify de la vue « Chill ».
//
// CE QUI CHANGE PAR RAPPORT AU LECTEUR INTÉGRÉ
// --------------------------------------------
// Le cadre `<iframe>` joue ce qu'on lui colle et rien d'autre. Ici, le compte
// est lié : on cherche dans le catalogue, on retrouve ses playlists, et on
// pilote la lecture — pause, morceau suivant — sans quitter l'application.
//
// AUCUN SECRET N'A ÉTÉ DEMANDÉ. Le flux PKCE ne réclame qu'un `client_id`,
// public par conception. Les jetons restent sur le serveur : la page ne les
// voit jamais, et la politique de sécurité n'a pas eu à s'ouvrir vers
// Spotify.
//
// CE QUI EXIGE PREMIUM, ET POURQUOI ON LE DIT
// -------------------------------------------
// Spotify réserve le pilotage de la lecture aux comptes Premium, et refuse
// toute commande s'il n'y a pas d'appareil actif quelque part. Ces deux
// refus arrivent en 403 et 404 — deux codes qui ne veulent rien dire pour
// qui les reçoit. On les traduit.
import { API } from './api.js';
import { echapper } from './format.js';

let etat = { configure: false, connecte: false, lecture: null };
let resultats = [];
let playlists = [];
let minuteur = null;

const zone = () => document.getElementById('spotifyPanneau');

function duree(ms) {
  const s = Math.floor((ms ?? 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function rendreNonConfigure() {
  return `<div class="sp-vide">
    <p><strong>Lier ton compte Spotify</strong> — pour chercher, lancer tes
      playlists et piloter la lecture sans quitter l'application.</p>
    <ol class="sp-etapes">
      <li>Sur <a href="https://developer.spotify.com/dashboard" target="_blank"
        rel="noopener">developer.spotify.com/dashboard</a>, crée une application.</li>
      <li>Dans ses réglages, ajoute exactement cette adresse de redirection :
        <code>http://127.0.0.1:3000/spotify/retour</code></li>
      <li>Copie le <strong>Client ID</strong> — il est public, il n'y a
        <em>aucun secret</em> à fournir — et colle-le dans ton fichier
        <code>.env</code> :<br><code>SPOTIFY_CLIENT_ID=…</code></li>
      <li>Redémarre l'application.</li>
    </ol>
    <p class="sp-note">Le <em>Client Secret</em> proposé par Spotify ne sert
      pas ici et ne doit être collé nulle part : le flux PKCE s'en passe.</p>
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

function rendreLecture(l) {
  if (!l || !l.titre) {
    return `<div class="sp-rien">Rien en cours. Lance un morceau ci-dessous,
      ou depuis Spotify sur n'importe quel appareil.</div>`;
  }
  const avance = l.duree ? Math.min(100, (l.position / l.duree) * 100) : 0;
  return `
    <div class="sp-piste">
      ${l.pochette ? `<img class="sp-pochette" src="${echapper(l.pochette)}" alt="">` : ''}
      <div class="sp-infos">
        <div class="sp-titre">${echapper(l.titre)}</div>
        <div class="sp-artistes">${echapper(l.artistes)}</div>
        ${l.appareil ? `<div class="sp-appareil">sur ${echapper(l.appareil)}</div>` : ''}
        <div class="sp-jauge"><span style="width:${avance}%"></span></div>
        <div class="sp-temps">${duree(l.position)} / ${duree(l.duree)}</div>
      </div>
    </div>
    <div class="sp-commandes">
      <button class="sp-cmd" data-sp="precedent" title="Précédent">⏮</button>
      <button class="sp-cmd sp-grand" data-sp="${l.joue ? 'pause' : 'lire'}"
        title="${l.joue ? 'Pause' : 'Lecture'}">${l.joue ? '⏸' : '▶'}</button>
      <button class="sp-cmd" data-sp="suivant" title="Suivant">⏭</button>
    </div>`;
}

/** Redemande l'état : appelé à chaque ouverture de la vue. */
export async function ouvrirSpotify(toast) {
  await rafraichirEtat(toast);
  suivre();
}

export function rendreSpotify() {
  const z = zone();
  if (!z) return;

  if (!etat.configure) { z.innerHTML = rendreNonConfigure(); return; }
  if (!etat.connecte) { z.innerHTML = rendreDeconnecte(); return; }

  z.innerHTML = `
    <div class="sp-tete">
      <span class="sp-lie">Compte lié</span>
      <button class="chill-vider" data-sp="deconnexion">Délier</button>
    </div>

    ${rendreLecture(etat.lecture)}

    <form class="sp-chercher" id="spForm">
      <input id="spQ" placeholder="Chercher un morceau…" autocomplete="off">
      <button class="btn" type="submit">Chercher</button>
      <button class="btn" type="button" data-sp="playlists">Mes playlists</button>
    </form>

    ${resultats.length ? `<ul class="sp-liste">
      ${resultats.map(t => `<li>
        <button data-uri="${echapper(t.uri)}">
          ${t.pochette ? `<img src="${echapper(t.pochette)}" alt="">` : '<span class="sp-vignette"></span>'}
          <span class="sp-l-titre">${echapper(t.titre)}</span>
          <span class="sp-l-artiste">${echapper(t.artistes)}</span>
        </button></li>`).join('')}
    </ul>` : ''}

    ${playlists.length ? `<ul class="sp-liste">
      ${playlists.map(p => `<li>
        <button data-uri="${echapper(p.uri)}">
          ${p.pochette ? `<img src="${echapper(p.pochette)}" alt="">` : '<span class="sp-vignette"></span>'}
          <span class="sp-l-titre">${echapper(p.nom)}</span>
          <span class="sp-l-artiste">${p.pistes} titres</span>
        </button></li>`).join('')}
    </ul>` : ''}`;
}

async function rafraichirEtat(toast) {
  try {
    const d = await API.spotifyEtat();
    etat = { configure: d.configure, connecte: d.connecte, lecture: d.lecture ?? null };
  } catch (e) {
    etat = { ...etat, connecte: false };
    if (toast) toast(e.message, 'erreur');
  }
  rendreSpotify();
}

/**
 * Le morceau en cours avance tout seul : sans rafraîchissement, la barre de
 * progression resterait figée et donnerait l'impression que rien ne joue.
 * Cinq secondes suffisent — on n'a pas besoin d'une horloge, juste d'un
 * panneau qui ne ment pas.
 */
function suivre() {
  clearInterval(minuteur);
  minuteur = setInterval(async () => {
    if (!etat.connecte || document.hidden) return;
    if (!document.getElementById('spotifyPanneau')) { clearInterval(minuteur); return; }
    try {
      const d = await API.spotifyLecture();
      etat.lecture = d.lecture;
      rendreSpotify();
    } catch { /* l'appareil s'est peut-être endormi : on réessaiera */ }
  }, 5000);
}

export function installerSpotify(toast) {
  // Sur le CONTENEUR de la vue, pas sur le panneau : celui-ci est recréé à
  // chaque rendu, et n'existe même pas au chargement de la page. Des
  // écouteurs posés dessus ne s'attacheraient à rien.
  const z = document.getElementById('chillZone');
  if (!z) return;

  z.addEventListener('click', async (e) => {
    const piste = e.target.closest('[data-uri]');
    if (piste) {
      try {
        await API.spotifyCommande('lire', piste.dataset.uri);
        setTimeout(() => rafraichirEtat(), 600);
      } catch (err) { toast(err.message, 'erreur'); }
      return;
    }

    const b = e.target.closest('[data-sp]');
    if (!b) return;
    const quoi = b.dataset.sp;

    if (quoi === 'connexion') {
      try {
        const d = await API.spotifyConnexion();
        // On QUITTE la page pour autoriser, puis Spotify nous ramène. Une
        // fenêtre surgissante serait bloquée une fois sur deux.
        window.location.href = d.url;
      } catch (err) { toast(err.message, 'erreur'); }
      return;
    }
    if (quoi === 'deconnexion') {
      await API.spotifyDeconnexion();
      resultats = []; playlists = [];
      return rafraichirEtat(toast);
    }
    if (quoi === 'playlists') {
      try {
        const d = await API.spotifyPlaylists();
        playlists = d.playlists; resultats = [];
        return rendreSpotify();
      } catch (err) { return toast(err.message, 'erreur'); }
    }
    if (['lire', 'pause', 'suivant', 'precedent'].includes(quoi)) {
      try {
        await API.spotifyCommande(quoi);
        setTimeout(() => rafraichirEtat(), 500);
      } catch (err) { toast(err.message, 'erreur'); }
    }
  });

  z.addEventListener('submit', async (e) => {
    if (e.target.id !== 'spForm') return;
    e.preventDefault();
    const q = document.getElementById('spQ')?.value.trim();
    if (!q) return;
    try {
      const d = await API.spotifyRecherche(q);
      resultats = d.resultats; playlists = [];
      rendreSpotify();
    } catch (err) { toast(err.message, 'erreur'); }
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
    if (m) toast(m, type);
    history.replaceState({}, '', location.pathname);
  }

  rafraichirEtat(toast);
  suivre();
}
