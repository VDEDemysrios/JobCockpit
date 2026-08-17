// Connexion Spotify, par le flux PKCE — sans le moindre secret.
//
// POURQUOI PKCE, ET PAS LE FLUX CLASSIQUE
// ---------------------------------------
// Le flux « code d'autorisation » ordinaire exige un `client_secret`, qu'il
// faudrait stocker, transmettre et protéger. PKCE le remplace par un secret
// JETABLE, fabriqué à chaque connexion et jamais réutilisé : l'application
// tire une chaîne aléatoire (le « vérificateur »), en envoie l'empreinte à
// Spotify, puis prouve son identité en révélant la chaîne d'origine.
//
// Résultat : le seul identifiant à fournir est le `client_id`, qui est PUBLIC
// par conception. Rien à confier, rien à faire fuiter.
//
// POURQUOI L'ÉCHANGE SE FAIT CÔTÉ SERVEUR
// ---------------------------------------
// PKCE fonctionnerait depuis le navigateur. On ne le fait pas :
//   · les jetons resteraient dans le `localStorage`, lisible par tout script
//     de la page — et un jeton Spotify donne accès à la bibliothèque entière ;
//   · il faudrait ouvrir `connect-src` vers Spotify, donc autoriser la page à
//     parler à un tiers.
// Ici le serveur détient les jetons et sert de relais. La page ne parle qu'à
// `localhost`, et la politique de sécurité reste inchangée.
import { createHash, randomBytes } from 'node:crypto';

const AUTORISATION = 'https://accounts.spotify.com/authorize';
const JETON = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

/**
 * Ce qu'on demande à Spotify. Le minimum nécessaire, et rien de plus : on ne
 * demande ni les adresses e-mail, ni la modification des playlists, ni le
 * suivi social. Une autorisation qu'on ne sait pas justifier ne se demande
 * pas.
 */
export const PORTEES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'user-library-read',
  'user-read-recently-played',
  // LES TROIS SUIVANTES SONT LE PRIX DU LECTEUR INTÉGRÉ, et il faut le dire.
  //
  // `streaming` donne le droit de jouer la musique DANS la page — c'est elle
  // qui transforme l'application en appareil Spotify Connect, au lieu d'une
  // télécommande qui exige que Spotify tourne ailleurs.
  //
  // Les deux autres ne servent à RIEN ici : le SDK de Spotify refuse de
  // s'initialiser sans elles, point. On demande donc une adresse e-mail qu'on
  // ne lit jamais et un profil qu'on n'utilise pas. C'est contraire à la règle
  // du projet — ne pas demander ce qu'on ne sait pas justifier — et c'est une
  // exigence de Spotify, pas un choix. Elles ne sont demandées que parce que
  // le lecteur intégré a été explicitement voulu.
  'streaming',
  'user-read-email',
  'user-read-private',
].join(' ');

/** Ce que le lecteur intégré exige, et sans quoi il refuse de démarrer. */
export const PORTEES_LECTEUR = ['streaming', 'user-read-email', 'user-read-private'];

/**
 * Les portées manquantes d'un jeton déjà obtenu.
 *
 * Un compte lié AVANT l'arrivée du lecteur intégré porte un jeton sans
 * `streaming`. Il continue de piloter un appareil distant très bien — mais le
 * SDK, lui, échoue en `authentication_error`, un message que personne ne peut
 * relier à « ton autorisation date d'avant ». Sans ce contrôle, la seule
 * issue visible serait de délier et relier au hasard.
 */
export function porteesManquantes(accordees, requises = PORTEES_LECTEUR) {
  const eues = new Set(String(accordees ?? '').split(/\s+/).filter(Boolean));
  return requises.filter(p => !eues.has(p));
}

/** Base64 « URL-safe » : le format imposé par PKCE. */
function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Fabrique un couple vérificateur / défi.
 *
 * Le vérificateur ne quitte JAMAIS le serveur avant l'échange final : c'est
 * tout l'intérêt. Spotify ne voit d'abord que son empreinte SHA-256, et un
 * code d'autorisation intercepté ne sert donc à rien sans lui.
 */
export function fabriquerDefi(aleatoire = randomBytes) {
  const verificateur = base64url(aleatoire(48));
  const defi = base64url(createHash('sha256').update(verificateur).digest());
  return { verificateur, defi };
}

/** L'adresse vers laquelle envoyer l'utilisateur pour qu'il autorise. */
export function urlAutorisation({ clientId, redirection, defi, etat }) {
  const p = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirection,
    code_challenge_method: 'S256',
    code_challenge: defi,
    scope: PORTEES,
    state: etat,
  });
  return `${AUTORISATION}?${p}`;
}

/** Échange le code contre des jetons. Aucun secret : le vérificateur suffit. */
export async function echangerCode({ clientId, redirection, code, verificateur }, recuperer = fetch) {
  const r = await recuperer(JETON, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirection,
      code_verifier: verificateur,
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error_description ?? d.error ?? `Spotify ${r.status}`);
  return normaliser(d);
}

/** Renouvelle un jeton expiré. Spotify ne renvoie pas toujours un nouveau
 *  jeton de rafraîchissement : on garde l'ancien quand il manque. */
export async function rafraichir({ clientId, refresh }, recuperer = fetch) {
  const r = await recuperer(JETON, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refresh,
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error_description ?? d.error ?? `Spotify ${r.status}`);
  return { ...normaliser(d), refresh: d.refresh_token ?? refresh };
}

/** Le rafraîchissement ne renvoie pas toujours les portées : on garde les
 *  anciennes plutôt que d'annoncer un jeton dépourvu de tout. */
export const fusionnerPortees = (neuf, ancien) => (neuf?.portees ? neuf : {
  ...neuf, portees: ancien?.portees ?? '',
});

function normaliser(d) {
  return {
    acces: d.access_token,
    refresh: d.refresh_token ?? null,
    // Les portées RÉELLEMENT accordées, telles que Spotify les renvoie. Ce
    // n'est pas forcément ce qu'on a demandé : un compte lié avant l'arrivée
    // du lecteur intégré n'a pas `streaming`, et c'est la seule façon de le
    // savoir avant que le SDK n'échoue.
    portees: d.scope ?? '',
    // On retranche une minute : un jeton qui expire pendant le trajet de la
    // requête produit un 401 qu'on aurait pu éviter.
    expireLe: Date.now() + Math.max(0, (Number(d.expires_in) || 3600) - 60) * 1000,
  };
}

export const estExpire = (jetons) => !jetons?.acces || Date.now() >= (jetons.expireLe ?? 0);

/**
 * Appelle l'API Spotify. Rend `null` sur 204 — c'est la réponse normale de
 * « lecture en cours » quand rien ne joue, et la traiter comme une erreur
 * ferait clignoter un message d'échec sur un état parfaitement ordinaire.
 */
export async function appeler(chemin, { acces, methode = 'GET', corps } = {}, recuperer = fetch) {
  const r = await recuperer(`${API}${chemin}`, {
    method: methode,
    headers: {
      Authorization: `Bearer ${acces}`,
      ...(corps ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  });

  if (r.status === 204 || r.status === 202) return null;
  if (r.status === 401) throw Object.assign(new Error('Jeton expiré.'), { expire: true });
  if (r.ok) return r.json().catch(() => null);

  // ON LIT CE QUE SPOTIFY DIT, AU LIEU DE LE DEVINER — ET ÇA A COÛTÉ CHER.
  //
  // Les deux refus étaient traduits en dur : 403 « il faut Premium », 404
  // « aucun appareil actif ». C'est vrai pour les commandes du lecteur, et
  // faux partout ailleurs. Le jour où Spotify a renommé
  // `/playlists/{id}/tracks` en `/playlists/{id}/items`, l'ancien chemin s'est
  // mis à répondre 403 : l'application annonçait donc « cette action demande
  // un compte Premium » à quelqu'un qui EST abonné Premium, sur un simple clic
  // pour ouvrir une playlist. Un message faux envoie chercher la panne là où
  // elle n'est pas — ici, du côté de l'abonnement.
  //
  // Le corps de la réponse porte la vraie raison. On la lit, et on ne traduit
  // que ce qu'on reconnaît formellement.
  const d = await r.json().catch(() => ({}));
  const message = String(d?.error?.message ?? '');
  const raison = String(d?.error?.reason ?? '');
  const commandeLecteur = String(chemin).startsWith('/me/player');

  if (r.status === 403) {
    if (raison === 'PREMIUM_REQUIRED' || /premium/i.test(message)) {
      throw new Error('Spotify refuse : cette action demande un compte Premium.');
    }
    throw new Error(message
      ? `Spotify refuse l'accès : ${message}`
      : 'Spotify refuse l\'accès à cette ressource (403).');
  }

  if (r.status === 404) {
    // « Aucun appareil actif » n'a de sens que sur une commande du lecteur.
    // Sur une playlist introuvable, c'était une fausse piste pure et simple.
    if (raison === 'NO_ACTIVE_DEVICE' || /no active device/i.test(message)
      || (commandeLecteur && !message)) {
      throw new Error('Aucun appareil actif. Ouvre Spotify quelque part, puis réessaie.');
    }
    throw new Error(message
      ? `Spotify : ${message}`
      : 'Spotify ne trouve pas cette ressource (404).');
  }

  throw new Error(message || `Spotify ${r.status}`);
}

/**
 * LE RENOMMAGE QUI A VIDÉ TOUTES LES PLAYLISTS.
 *
 * Spotify a renommé, sans préavis et sans changer de version d'API :
 *
 *   playlist.tracks          → playlist.items
 *   /playlists/{id}/tracks   → /playlists/{id}/items
 *   une entrée : { track }   → une entrée : { item }
 *
 * Chacun des trois casse en silence, et différemment : le compteur affichait
 * « 0 titre » sous chaque playlist (`tracks.total` valant `undefined`),
 * l'ancien point d'accès répondait 403, et — le pire — `fields=items(track(…))`
 * appliqué au nouveau renvoie `{"items":[{},{}]}` : une réponse 200, des
 * entrées vides, aucune erreur nulle part.
 *
 * Ces deux lectures acceptent les deux noms. Elles restent justes quel que
 * soit celui que Spotify sert, hier comme demain.
 */
export const nombreDePistes = (p) => p?.items?.total ?? p?.tracks?.total ?? 0;
export const pisteDeLEntree = (e) => e?.item ?? e?.track ?? null;

/**
 * Ce que l'interface affiche : le morceau en cours, réduit à l'essentiel.
 *
 * LES TROIS RÉGLAGES SONT DANS LA MÊME RÉPONSE, ET C'EST IMPORTANT. Volume,
 * lecture aléatoire et répétition ne s'interrogent pas séparément : Spotify
 * les livre avec l'état du lecteur. Les afficher revient donc gratuitement —
 * les omettre obligeait l'interface à SUPPOSER leur valeur, et un curseur de
 * volume qui affiche 50 % pendant que l'enceinte est à 20 % ment à chaque
 * regard.
 *
 * Le volume vaut `null`, jamais 0, quand l'appareil ne sait pas le régler
 * (une télévision, une console). Zéro voudrait dire « coupé », ce qui est une
 * autre affirmation.
 */
export function resumeLecture(d) {
  const reglages = {
    aleatoire: Boolean(d?.shuffle_state),
    repetition: d?.repeat_state ?? 'off',
    volume: typeof d?.device?.volume_percent === 'number' ? d.device.volume_percent : null,
    appareil: d?.device?.name ?? '',
    appareilId: d?.device?.id ?? null,
  };
  if (!d?.item) return { joue: false, ...reglages };
  return {
    joue: Boolean(d.is_playing),
    titre: d.item.name ?? '',
    artistes: (d.item.artists ?? []).map(a => a.name).join(', '),
    album: d.item.album?.name ?? '',
    pochette: d.item.album?.images?.[0]?.url ?? null,
    duree: d.item.duration_ms ?? 0,
    position: d.progress_ms ?? 0,
    uri: d.item.uri ?? null,
    ...reglages,
  };
}

/**
 * LE DÉFAUT QUI EMPÊCHAIT DE LANCER UNE PLAYLIST.
 *
 * `/me/player/play` prend DEUX corps qui ne sont pas interchangeables :
 *
 *   { uris: ["spotify:track:…"] }        une poignée de morceaux, à la suite
 *   { context_uri: "spotify:playlist:…" } un contexte, qu'on parcourt
 *
 * Le panneau envoyait `uris` pour tout. Un morceau partait donc très bien —
 * et une playlist était refusée par Spotify, en 400, sans que rien à l'écran
 * n'explique pourquoi l'un marchait et l'autre non.
 *
 * `offset` n'a de sens que dans un contexte : c'est le rang du morceau par
 * lequel commencer. Combiné à la lecture aléatoire, c'est ce qui fait qu'une
 * playlist ne redémarre pas trois fois de suite sur le même titre.
 */
export function corpsDeLecture({ uri, depart } = {}) {
  if (!uri) return undefined;
  if (uri.startsWith('spotify:track:')) return { uris: [uri] };
  const corps = { context_uri: uri };
  if (Number.isInteger(depart) && depart > 0) corps.offset = { position: depart };
  return corps;
}

/**
 * LA FILE QUI RÉPÈTE DIX FOIS LE MÊME MORCEAU.
 *
 * Quand un morceau est lancé SEUL — sans playlist, sans album, donc sans
 * contexte — Spotify n'a rien à annoncer après lui. Son API ne répond pas une
 * file vide pour autant : elle renvoie **dix fois le morceau en cours**.
 * Constaté tel quel, `queue` de longueur 10 pour une seule URI distincte,
 * pendant que `context` valait `null`.
 *
 * Affiché brut, ça donne « Ce qui vient : le même titre, dix fois » — ce qui
 * est faux, et ce qui a l'air d'un défaut d'affichage alors que la donnée
 * arrive comme ça.
 *
 * La règle est volontairement étroite : on ne conclut que si TOUTES les
 * entrées valent le morceau en cours. Une file où l'on a glissé deux fois le
 * même titre parmi d'autres reste affichée telle quelle — c'est un choix de
 * l'utilisateur, pas un artefact.
 */
export function resumeFile(d) {
  const courant = d?.currently_playing?.uri ?? null;
  const pistes = (d?.queue ?? []).filter(t => t?.uri);
  const boucle = Boolean(courant && pistes.length
    && pistes.every(t => t.uri === courant));
  return { boucle, pistes: boucle ? [] : pistes };
}

/** Les appareils joignables. Sans l'un d'eux actif, Spotify refuse tout ordre. */
export function resumeAppareils(d) {
  return (d?.devices ?? []).map(a => ({
    id: a.id,
    nom: a.name ?? 'Appareil',
    type: a.type ?? '',
    actif: Boolean(a.is_active),
    volume: typeof a.volume_percent === 'number' ? a.volume_percent : null,
  }));
}
