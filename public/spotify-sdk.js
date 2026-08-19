// LE LECTEUR SPOTIFY INTÉGRÉ — l'application devient un appareil.
//
// CE QUE ÇA CHANGE, ET POURQUOI ÇA VALAIT LE PRIX
// -----------------------------------------------
// Sans lui, l'API Spotify n'est qu'une TÉLÉCOMMANDE : elle pilote un lecteur
// ouvert ailleurs, et sans ce lecteur tout revient en 404 « aucun appareil
// actif ». C'est le mur contre lequel on butait — le panneau semblait cassé
// alors qu'il n'avait simplement rien à commander.
//
// Le SDK inverse ça : la page s'inscrit elle-même comme appareil Spotify
// Connect. Elle apparaît dans la liste des appareils du téléphone, elle joue
// le son, et volume, aléatoire, avance et playlists répondent enfin depuis la
// fenêtre où l'on travaille.
//
// CE QUE ÇA COÛTE, ET IL FAUT LE DIRE EN FACE
// -------------------------------------------
//   · un SCRIPT ÉTRANGER s'exécute dans la page qui affiche le CV, les
//     candidatures et les lettres. C'est la seule entorse de tout le projet à
//     `script-src 'self'`, et elle n'est appliquée que si l'option est posée —
//     voir la politique calculée dans `src/server.js` ;
//   · le JETON descend dans le navigateur. Tout le reste du code Spotify
//     existe pour l'éviter ; le SDK, lui, joue dans la page et ne peut pas
//     s'en passer. Il est donc demandé À LA DEMANDE, gardé dans une fermeture,
//     jamais écrit dans le `localStorage`, et le serveur ne rend que le jeton
//     d'accès — celui de rafraîchissement ne quitte jamais la machine ;
//   · SPOTIFY PREMIUM est exigé. Un compte gratuit obtient `account_error`.
//
// LE PIÈGE DE L'AUTOMATISME : le SDK ne prend PAS la main tout seul. Il
// s'inscrit comme appareil disponible, et rien ne joue tant qu'on ne lui a pas
// transféré la lecture. Sans ce transfert explicite, on voit « prêt » et on
// n'entend rien — la panne la plus déroutante de cette intégration.

const SOURCE = 'https://sdk.scdn.co/spotify-player.js';

let lecteur = null;
let appareil = null;
let chargement = null;

/** Le jeton ne vit QUE là, le temps d'un appel du SDK. */
async function jeton() {
  const r = await fetch('/api/spotify/jeton-lecteur');
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw new Error(d.error ?? `Erreur ${r.status}`);
  return d.acces;
}

/**
 * Charge le SDK, une fois.
 *
 * Le script appelle `window.onSpotifyWebPlaybackSDKReady` quand il est prêt :
 * c'est un rendez-vous global, imposé par Spotify. On l'installe AVANT
 * d'insérer la balise — posé après, le script peut avoir fini de charger et
 * l'avoir déjà cherché en vain, ce qui donne une attente qui ne finit jamais.
 */
function chargerSdk() {
  if (window.Spotify) return Promise.resolve();
  if (chargement) return chargement;

  chargement = new Promise((resoudre, rejeter) => {
    const minuteur = setTimeout(() => rejeter(new Error(
      'Le SDK de Spotify n\'a pas répondu. La politique de sécurité vient '
      + 'peut-être d\'être élargie : recharge la page (Ctrl+R).')), 12000);

    window.onSpotifyWebPlaybackSDKReady = () => { clearTimeout(minuteur); resoudre(); };

    const s = document.createElement('script');
    s.src = SOURCE;
    s.async = true;
    s.onerror = () => {
      clearTimeout(minuteur);
      rejeter(new Error('Le SDK de Spotify a été bloqué. Active le lecteur '
        + 'intégré puis recharge la page.'));
    };
    document.head.appendChild(s);
  });
  return chargement;
}

/** Les refus du SDK, traduits. Bruts, ils ne veulent rien dire. */
const EXPLICATIONS = {
  authentication_error: 'Autorisation Spotify refusée — délie puis relie ton compte '
    + 'pour accorder la portée « streaming ».',
  account_error: 'Le lecteur intégré exige Spotify Premium. Avec un compte gratuit, '
    + 'l\'application reste une télécommande : ouvre Spotify ailleurs.',
  initialization_error: 'Ce navigateur ne sait pas lire le flux protégé de Spotify. '
    + 'Chrome, Edge et Opera le font ; Firefox demande d\'activer la lecture DRM.',
};

/**
 * Démarre le lecteur intégré et rend son identifiant d'appareil.
 *
 * @param {object} o
 * @param {(etat: object|null) => void} o.surEtat  appelé à chaque changement
 * @param {(message: string) => void} o.surErreur
 * @returns {Promise<string>} l'identifiant de l'appareil
 */
export async function demarrerLecteurLocal({ surEtat, surErreur, nom = 'Job Cockpit' }) {
  if (appareil) return appareil;
  await chargerSdk();

  return new Promise((resoudre, rejeter) => {
    lecteur = new window.Spotify.Player({
      name: nom,
      getOAuthToken: (donner) => { jeton().then(donner).catch(e => surErreur?.(e.message)); },
      volume: 0.6,
    });

    for (const panne of Object.keys(EXPLICATIONS)) {
      lecteur.addListener(panne, ({ message }) => {
        const dit = EXPLICATIONS[panne] ?? message;
        surErreur?.(dit);
        rejeter(new Error(dit));
      });
    }
    // Une panne de lecture n'est pas une panne d'initialisation : elle se
    // signale, mais elle ne doit pas faire échouer la promesse — le lecteur
    // reste utilisable pour le morceau suivant.
    lecteur.addListener('playback_error', ({ message }) => surErreur?.(message));

    lecteur.addListener('player_state_changed', (etat) => surEtat?.(etat));
    lecteur.addListener('not_ready', () => { surEtat?.(null); });

    lecteur.addListener('ready', ({ device_id: id }) => { appareil = id; resoudre(id); });

    lecteur.connect().then(ok => {
      if (!ok) rejeter(new Error('Spotify a refusé la connexion du lecteur.'));
    });
  });
}


/**
 * DÉVERROUILLE LE SON, ET C'EST CE QUI MANQUAIT POUR JOUER SEUL.
 *
 * Les navigateurs refusent qu'une page émette du son sans qu'on ait cliqué
 * dedans. Le SDK de Spotify s'inscrit très bien comme appareil sans ce
 * déverrouillage — il apparaît dans la liste, il accepte les ordres, l'API
 * répond 204 — mais **aucun son ne sort**. C'est la panne la plus déroutante
 * de cette intégration : tout dit que ça marche, et on n'entend rien.
 *
 * `activateElement` existe pour ça : appelée DANS un gestionnaire de clic,
 * elle lance un extrait muet qui déverrouille la balise audio pour de bon.
 * Une seule fois par session suffit.
 */
let deverrouille = false;

export async function deverrouillerSon() {
  if (deverrouille || !lecteur?.activateElement) return deverrouille;
  try {
    await lecteur.activateElement();
    deverrouille = true;
  } catch { /* le geste n'était pas assez direct : on retentera au prochain clic */ }
  return deverrouille;
}

export function arreterLecteurLocal() {
  lecteur?.disconnect();
  lecteur = null;
  appareil = null;
  deverrouille = false;
}

export const appareilLocal = () => appareil;

/**
 * Le volume, réglé DANS LE SDK plutôt que par l'API.
 *
 * L'API met une bonne seconde à répondre et repasse par les serveurs de
 * Spotify ; le SDK agit sur le son de la page, immédiatement. Sur un curseur
 * qu'on tire, la différence est celle entre un réglage et une télécommande de
 * télévision à piles usées.
 */
export async function volumeLocal(pourcent) {
  if (!lecteur) return false;
  await lecteur.setVolume(Math.min(1, Math.max(0, pourcent / 100)));
  return true;
}

/** Idem pour la lecture, la pause et le saut : le SDK répond sans aller-retour. */
export async function commandeLocale(quoi) {
  if (!lecteur) return false;
  const actions = {
    lire: () => lecteur.resume(),
    pause: () => lecteur.pause(),
    suivant: () => lecteur.nextTrack(),
    precedent: () => lecteur.previousTrack(),
  };
  if (!actions[quoi]) return false;
  await actions[quoi]();
  return true;
}

export async function positionLocale(ms) {
  if (!lecteur) return false;
  await lecteur.seek(Math.max(0, Math.round(ms)));
  return true;
}

/**
 * L'état du SDK, ramené à la forme que le serveur renvoie.
 *
 * Les deux sources doivent produire le MÊME objet, sans quoi l'interface
 * devrait savoir laquelle l'a produit — et se tromperait un jour sur deux.
 */
export function resumeEtatSdk(etat) {
  if (!etat) return null;
  const t = etat.track_window?.current_track;
  return {
    joue: !etat.paused,
    titre: t?.name ?? '',
    artistes: (t?.artists ?? []).map(a => a.name).join(', '),
    album: t?.album?.name ?? '',
    pochette: t?.album?.images?.slice()
      .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null,
    duree: etat.duration ?? 0,
    position: etat.position ?? 0,
    uri: t?.uri ?? null,
    aleatoire: Boolean(etat.shuffle),
    repetition: ['off', 'context', 'track'][etat.repeat_mode] ?? 'off',
    appareil: 'Job Cockpit',
    appareilId: appareil,
    // Le SDK ne rapporte pas le volume dans son état : il se lit à part, et le
    // panneau garde donc sa dernière valeur connue plutôt que d'afficher zéro.
    volume: null,
    local: true,
    suivant: (etat.track_window?.next_tracks ?? []).slice(0, 5).map(x => ({
      uri: x.uri, titre: x.name ?? '',
      artistes: (x.artists ?? []).map(a => a.name).join(', '),
      pochette: x.album?.images?.at(-1)?.url ?? null,
    })),
  };
}
