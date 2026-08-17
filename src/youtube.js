// YouTube — une clé simple, et pas d'OAuth.
//
// POURQUOI CE MODULE EXISTE
// -------------------------
// « Ouvre YouTube dans le lecteur pour naviguer » est IMPOSSIBLE, et il faut
// le dire clairement plutôt que de laisser chercher : `youtube.com` répond
// `X-Frame-Options: SAMEORIGIN`. L'accueil, les résultats de recherche et même
// l'interface téléviseur (`/tv`) refusent donc de s'afficher dans un cadre.
// Seules les adresses `/embed/` l'acceptent, et elles ne montrent qu'une
// vidéo ou une playlist — jamais de quoi parcourir le catalogue.
//
// Le paramètre `listType=search`, qui permettait autrefois de charger une
// recherche dans le lecteur intégré, a été retiré : l'adresse répond encore
// 200, et le lecteur affiche « Erreur 153 ». Vérifié, pas supposé.
//
// LA NAVIGATION SE FAIT DONC CHEZ NOUS. On interroge l'API officielle, on
// dresse la liste, et un clic charge la vidéo dans le cadre `/embed/` — qui,
// lui, marche très bien.
//
// PAS DE SCRAPING, ET C'EST UNE DÉCISION DÉJÀ PRISE. Lire la page de
// résultats de YouTube pour en extraire les vidéos serait plus simple et sans
// clé. Le projet se l'interdit — la même règle a fait laisser Indeed de côté —
// et une page qu'on analyse à la main casse au premier changement de balisage,
// sans prévenir.
//
// CE QUE ÇA DEMANDE : une clé d'API simple, pas un flux OAuth. Aucun écran de
// consentement, aucun compte à lier, aucune donnée personnelle. La clé sert
// uniquement à compter les appels.

const BASE = 'https://www.googleapis.com/youtube/v3';

/**
 * Le coût en quota, pour mémoire — le plafond gratuit est de 10 000 unités
 * par jour :
 *   · une recherche : 100 unités, soit une centaine par jour ;
 *   · les vidéos populaires : 1 unité, soit autant qu'on veut.
 * C'est pourquoi l'accueil n'est PAS une recherche à vide.
 */
export const COUT = { recherche: 100, populaires: 1 };

async function appeler(chemin, parametres, cle, recuperer = fetch) {
  const p = new URLSearchParams({ ...parametres, key: cle });
  const r = await recuperer(`${BASE}${chemin}?${p}`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const raison = d?.error?.errors?.[0]?.reason ?? '';
    const message = String(d?.error?.message ?? '');

    // UNE CLÉ GEMINI N'EST PAS UNE CLÉ YOUTUBE, ET LE MESSAGE DE GOOGLE LE DIT
    // TRÈS MAL. Les deux sont des « clés d'API Google », les deux se collent
    // dans un `.env`, et activer « YouTube Data API v3 » sur le même projet
    // paraît suffire. Mesuré : la clé d'AI Studio répond 200 sur Gemini et
    // 401 « API keys are not supported by this API » sur YouTube — une phrase
    // qui laisse croire que YouTube exige OAuth, alors qu'une clé simple créée
    // dans Google Cloud marche parfaitement.
    if (/API keys are not supported/i.test(message)) {
      throw new Error('Cette clé n\'ouvre pas YouTube — une clé Gemini d\'AI Studio ne vaut '
        + 'que pour Gemini. Crée une clé dans Google Cloud (API et services → '
        + 'Identifiants → Clé API), sur un projet où « YouTube Data API v3 » est activée.');
    }
    if (raison === 'accessNotConfigured' || /has not been used in project/i.test(message)) {
      throw new Error('« YouTube Data API v3 » n\'est pas activée sur le projet de cette clé — '
        + 'active-la dans Google Cloud, puis attends une minute.');
    }
    if (raison === 'quotaExceeded') {
      throw new Error('Quota YouTube épuisé pour aujourd\'hui — il repart à minuit '
        + '(heure du Pacifique).');
    }
    if (/keyInvalid|badRequest|forbidden/i.test(raison)) {
      throw new Error('Clé YouTube refusée — vérifie qu\'elle existe et que '
        + '« YouTube Data API v3 » est activée sur le projet.');
    }
    throw new Error(d?.error?.message ?? `YouTube ${r.status}`);
  }
  return d;
}

/**
 * L'ACCUEIL : les vidéos populaires du pays.
 *
 * C'est l'équivalent le plus proche de ce que voit un visiteur NON CONNECTÉ
 * sur youtube.com — et ça coûte une unité de quota au lieu de cent.
 */
export async function populaires({ cle, pays = 'FR', combien = 24 }, recuperer = fetch) {
  const d = await appeler('/videos', {
    part: 'snippet,contentDetails,statistics',
    chart: 'mostPopular',
    regionCode: pays,
    maxResults: String(Math.min(50, combien)),
  }, cle, recuperer);
  return resume(d?.items, (v) => v.id);
}

export async function chercher({ cle, requete, combien = 24 }, recuperer = fetch) {
  const d = await appeler('/search', {
    part: 'snippet',
    type: 'video',
    q: requete,
    maxResults: String(Math.min(50, combien)),
  }, cle, recuperer);
  return resume(d?.items, (v) => v.id?.videoId);
}

/**
 * Réduit une réponse à ce qu'une vignette affiche.
 *
 * L'identifiant ne se trouve PAS au même endroit selon le point d'accès :
 * `/videos` le met à la racine, `/search` dans `id.videoId`. C'est le genre
 * d'écart qui ne se voit qu'à l'exécution, sous la forme d'une liste de
 * vignettes qui ne lancent rien.
 */
function resume(items, identifiant) {
  return (items ?? []).map(v => {
    const id = identifiant(v);
    if (!id) return null;
    const s = v.snippet ?? {};
    return {
      id,
      titre: s.title ?? '',
      chaine: s.channelTitle ?? '',
      publie: s.publishedAt ?? null,
      vignette: s.thumbnails?.medium?.url ?? s.thumbnails?.default?.url ?? null,
      vues: Number(v.statistics?.viewCount ?? 0) || null,
      duree: v.contentDetails?.duration ?? null,
    };
  }).filter(Boolean);
}

/**
 * La durée ISO 8601 de YouTube (`PT4M13S`), en secondes.
 *
 * Servie telle quelle, elle s'affiche « PT4M13S » sous la vignette — ce qui
 * n'apprend rien à personne.
 */
export function dureeIso(iso) {
  const m = String(iso ?? '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [, j, h, min, s] = m.map(x => (x ? Number(x) : 0));
  return ((j * 24 + h) * 60 + min) * 60 + s || null;
}
