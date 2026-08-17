// Connexion Twitch — un Client ID, et AUCUNE URL de redirection.
//
// POURQUOI LE FLUX « CODE D'APPAREIL », APRÈS DEUX AUTRES ESSAIS
// ---------------------------------------------------------------
// Twitch ne connaît pas PKCE. Il ne propose que trois flux, et les deux
// premiers ont été essayés puis abandonnés pour de bonnes raisons :
//
//   · CODE D'AUTORISATION — exige un `client_secret`. Un secret à stocker, à
//     protéger, à ne jamais pousser sur GitHub. Refusé.
//   · IMPLICITE — sans secret, mais il renvoie le jeton dans le FRAGMENT
//     d'une URL de redirection. Deux défauts, et le second est rédhibitoire :
//     le jeton transite par la page, et surtout **le formulaire de Twitch
//     refuse une redirection en `http://`**. Le message parle d'un champ vide,
//     mais il s'affiche aussi sur un champ rempli d'une adresse `localhost` :
//     il n'y a pas d'échappatoire sans servir l'application en HTTPS, avec un
//     certificat auto-signé et l'avertissement de navigateur qui va avec.
//   · CODE D'APPAREIL — celui-ci. **Aucune URL de redirection n'est demandée**,
//     puisqu'il a été conçu pour les décodeurs et les consoles, qui n'ont pas
//     de navigateur où revenir.
//
// Et il se trouve qu'en plus d'être le seul praticable, c'est le plus PROPRE
// des trois :
//   · le jeton ne traverse jamais la page — il va de Twitch à notre serveur ;
//   · il s'accompagne d'un jeton de rafraîchissement, donc la liaison survit
//     indéfiniment, là où un jeton implicite meurt au bout de deux mois ;
//   · il n'y a rien à faire correspondre entre deux réglages, donc rien à
//     rater dans un formulaire.
//
// Son seul coût est un code à huit caractères à recopier sur twitch.tv/activate.
// C'est une fois, et l'interface ouvre la page et colle le code toute seule.
//
// CE QU'ON DEMANDE, ET RIEN DE PLUS
// ---------------------------------
// Une seule portée : la liste des chaînes suivies. Ni la lecture du chat, ni
// l'envoi de messages, ni les abonnements payants, ni l'adresse e-mail. Une
// autorisation qu'on ne sait pas justifier ne se demande pas.

const APPAREIL = 'https://id.twitch.tv/oauth2/device';
const JETON = 'https://id.twitch.tv/oauth2/token';
const VALIDATION = 'https://id.twitch.tv/oauth2/validate';
const REVOCATION = 'https://id.twitch.tv/oauth2/revoke';
const HELIX = 'https://api.twitch.tv/helix';

export const PORTEES = ['user:read:follows'].join(' ');

/**
 * Demande un code d'appareil.
 *
 * Twitch rend le code à MONTRER (`user_code`), l'adresse où le taper, et un
 * `device_code` qui reste ici : c'est lui qu'on présente en boucle jusqu'à ce
 * que l'utilisateur ait validé. `interval` est la cadence minimale que Twitch
 * autorise — interroger plus vite fait répondre `slow_down`.
 */
export async function demanderCode({ clientId }, recuperer = fetch) {
  const r = await recuperer(APPAREIL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scopes: PORTEES }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message ?? `Twitch ${r.status}`);
  return {
    code: d.user_code,
    appareil: d.device_code,
    url: d.verification_uri ?? 'https://www.twitch.tv/activate',
    expireLe: Date.now() + (Number(d.expires_in) || 1800) * 1000,
    cadence: Math.max(5, Number(d.interval) || 5) * 1000,
  };
}

/**
 * Réclame le jeton une fois. Rend `null` tant que l'utilisateur n'a pas validé.
 *
 * `authorization_pending` N'EST PAS UNE ERREUR : c'est la réponse normale
 * pendant toute la durée où l'on attend, c'est-à-dire la quasi-totalité des
 * appels. La traiter comme une panne ferait clignoter un message d'échec dix
 * fois par minute sur un déroulement parfaitement ordinaire.
 */
export async function reclamerJeton({ clientId, appareil }, recuperer = fetch) {
  const r = await recuperer(JETON, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      scopes: PORTEES,
      device_code: appareil,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (r.ok && d.access_token) return normaliser(d);

  const message = String(d.message ?? d.error ?? '');
  if (/authorization_pending|pending/i.test(message)) return null;
  if (/slow_down/i.test(message)) return null;
  if (/expired/i.test(message)) throw new Error('Le code a expiré — recommence.');
  throw new Error(message || `Twitch ${r.status}`);
}

/** Renouvelle un jeton expiré. Sans secret : le client est public. */
export async function rafraichirJeton({ clientId, refresh }, recuperer = fetch) {
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
  if (!r.ok || !d.access_token) throw new Error(d.message ?? `Twitch ${r.status}`);
  return { ...normaliser(d), refresh: d.refresh_token ?? refresh };
}

function normaliser(d) {
  return {
    acces: d.access_token,
    refresh: d.refresh_token ?? null,
    // Une minute de marge : un jeton qui expire pendant le trajet de la
    // requête produit un 401 qu'on aurait pu éviter.
    expireLe: Date.now() + Math.max(0, (Number(d.expires_in) || 14400) - 60) * 1000,
  };
}

export const estExpire = (j) => !j?.acces || Date.now() >= (j.expireLe ?? 0);

/**
 * Vérifie qu'un jeton est encore bon, et dit à qui il appartient.
 *
 * Un jeton implicite ne se renouvelle pas : il vit une soixantaine de jours,
 * puis meurt. Sans cette vérification, l'interface annoncerait « compte lié »
 * jusqu'au premier appel en échec — c'est-à-dire au pire moment.
 */
export async function validerJeton(acces, recuperer = fetch) {
  const r = await recuperer(VALIDATION, { headers: { Authorization: `OAuth ${acces}` } });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(`Twitch ${r.status}`);
  const d = await r.json().catch(() => null);
  if (!d?.user_id) return null;
  return { id: d.user_id, login: d.login, portees: d.scopes ?? [], expireDans: d.expires_in ?? 0 };
}

/** Rend le jeton inutilisable côté Twitch, pas seulement chez nous. */
export async function revoquer({ clientId, acces }, recuperer = fetch) {
  await recuperer(`${REVOCATION}?${new URLSearchParams({ client_id: clientId, token: acces })}`,
    { method: 'POST' }).catch(() => null);
}

/**
 * Appelle l'API Helix.
 *
 * Twitch exige DEUX en-têtes, pas un : le jeton ET le Client ID. Oublier le
 * second donne un 401 identique à celui d'un jeton périmé — on croit alors à
 * une session expirée, et on refait la connexion pour rien.
 */
export async function appeler(chemin, { acces, clientId }, recuperer = fetch) {
  const r = await recuperer(`${HELIX}${chemin}`, {
    headers: { Authorization: `Bearer ${acces}`, 'Client-Id': clientId },
  });
  if (r.status === 401) throw Object.assign(new Error('Jeton Twitch expiré.'), { expire: true });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.message ?? `Twitch ${r.status}`);
  }
  return r.json().catch(() => null);
}

/**
 * Les directs en cours, réduits à ce qu'une vignette affiche.
 *
 * `thumbnail_url` arrive avec des gabarits `{width}` et `{height}` littéraux
 * dans l'adresse. Servie telle quelle, l'image est un 404 — et une liste de
 * cadres gris ne dit pas pourquoi.
 */
export function resumeDirects(d, { largeur = 320, hauteur = 180 } = {}) {
  return (d?.data ?? []).map(s => ({
    login: s.user_login,
    nom: s.user_name,
    titre: s.title ?? '',
    jeu: s.game_name ?? '',
    jeuId: s.game_id ?? null,
    spectateurs: s.viewer_count ?? 0,
    depuis: s.started_at ?? null,
    vignette: dimensionner(s.thumbnail_url, largeur, hauteur),
  }));
}

/** Les chaînes suivies, en direct ou non — pour lancer une rediffusion. */
export function resumeSuivies(d) {
  return (d?.data ?? []).map(c => ({
    login: c.broadcaster_login,
    nom: c.broadcaster_name,
  }));
}

/**
 * LES GABARITS DANS LES ADRESSES D'IMAGES, ET LEURS DEUX ÉCRITURES.
 *
 * Twitch livre ses vignettes avec la taille à trous. Servie telle quelle,
 * l'adresse est un 404 — et une grille de rectangles gris ne dit pas pourquoi.
 * Le piège est qu'il y a DEUX écritures selon le point d'accès : `{width}`
 * pour les directs et les jaquettes, `%{width}` pour les rediffusions. Traiter
 * la première seulement laisse les rediffusions sans image, ce qui ressemble à
 * une panne de l'onglet et pas à une histoire de pourcentage.
 */
export function dimensionner(url, largeur, hauteur) {
  return String(url ?? '')
    .replace(/%?\{width\}/g, String(largeur))
    .replace(/%?\{height\}/g, String(hauteur));
}

/** Les catégories — ce que Twitch appelle « jeux », y compris IRL et musique. */
export function resumeCategories(d) {
  return (d?.data ?? []).map(g => ({
    id: g.id,
    nom: g.name ?? '',
    jaquette: dimensionner(g.box_art_url, 144, 192),
  }));
}

/** Une chaîne : de quoi coiffer sa page. */
export function resumeChaines(d) {
  return (d?.data ?? []).map(u => ({
    id: u.id,
    login: u.login,
    nom: u.display_name ?? u.login,
    avatar: u.profile_image_url ?? null,
    banniere: u.offline_image_url ?? null,
    description: u.description ?? '',
  }));
}

/**
 * Les rediffusions d'une chaîne.
 *
 * C'est ce qui manquait pour se passer du site : une chaîne hors ligne n'est
 * pas une chaîne vide, elle a des heures d'archives — et c'est souvent ce
 * qu'on vient chercher.
 */
export function resumeVideos(d) {
  return (d?.data ?? []).map(v => ({
    id: v.id,
    titre: v.title ?? '',
    duree: v.duration ?? '',
    vues: v.view_count ?? 0,
    publie: v.published_at ?? null,
    vignette: dimensionner(v.thumbnail_url, 320, 180),
  }));
}

/** Une recherche de chaînes. `is_live` distingue le direct de la vitrine. */
export function resumeRecherche(d) {
  return (d?.data ?? []).map(c => ({
    login: c.broadcaster_login,
    nom: c.display_name,
    jeu: c.game_name ?? '',
    titre: c.title ?? '',
    enDirect: Boolean(c.is_live),
    vignette: c.thumbnail_url ?? null,
  }));
}
