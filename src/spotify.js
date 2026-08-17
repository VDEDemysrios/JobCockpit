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
].join(' ');

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

function normaliser(d) {
  return {
    acces: d.access_token,
    refresh: d.refresh_token ?? null,
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
  if (r.status === 403) {
    throw new Error('Spotify refuse : cette action demande un compte Premium.');
  }
  if (r.status === 404) {
    throw new Error('Aucun appareil actif. Ouvre Spotify quelque part, puis réessaie.');
  }
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.error?.message ?? `Spotify ${r.status}`);
  }
  return r.json().catch(() => null);
}

/** Ce que l'interface affiche : le morceau en cours, réduit à l'essentiel. */
export function resumeLecture(d) {
  if (!d?.item) return { joue: false };
  return {
    joue: Boolean(d.is_playing),
    titre: d.item.name ?? '',
    artistes: (d.item.artists ?? []).map(a => a.name).join(', '),
    album: d.item.album?.name ?? '',
    pochette: d.item.album?.images?.[0]?.url ?? null,
    duree: d.item.duration_ms ?? 0,
    position: d.progress_ms ?? 0,
    uri: d.item.uri ?? null,
    appareil: d.device?.name ?? '',
  };
}
