// Les paroles du morceau en cours.
//
// POURQUOI LRCLIB ET PAS SPOTIFY
// ------------------------------
// Spotify AFFICHE des paroles, mais ne les expose dans aucune API publique :
// son lecteur web tape un point d'accès interne, avec un jeton de session qui
// n'est pas celui qu'on obtient par OAuth. S'en servir demanderait d'imiter
// son client — c'est-à-dire exactement le genre de contournement que ce projet
// s'interdit ailleurs (voir la décision sur Indeed : « pas de scraping »).
//
// LRCLIB est une base communautaire ouverte : pas de clé, pas de compte, pas
// de quota annoncé. Et elle rend souvent des paroles SYNCHRONISÉES, ce que
// Musixmatch réserve à ses offres payantes.
//
// LA SYNCHRONISATION EST TOUT L'INTÉRÊT. Des paroles en bloc, on les lit une
// fois ; une ligne qui s'allume au bon moment se suit sans y penser. C'est la
// différence entre un texte et un karaoké.
//
// LE FORMAT LRC : chaque ligne commence par son horodatage.
//
//     [00:26.31] I didn't want to be the one to forget
//
// Une même ligne peut porter PLUSIEURS horodatages — un refrain qui revient
// n'est écrit qu'une fois. Les ignorer ferait disparaître le refrain de la
// deuxième moitié du morceau.

const BASE = 'https://lrclib.net/api';

/** LRCLIB demande à savoir qui l'appelle. C'est la moindre des politesses. */
const AGENT = 'JobCockpit (https://github.com/VDEDemysrios/JobCockpit)';

/**
 * Analyse un fichier LRC.
 *
 * Rend une liste triée `{ t, texte }`, `t` en millisecondes. Les lignes sans
 * horodatage sont ignorées : ce sont les en-têtes du format (`[ar:]`, `[by:]`),
 * qui n'ont rien à faire au milieu d'un refrain.
 */
export function analyserLrc(lrc) {
  const lignes = [];
  for (const brute of String(lrc ?? '').split(/\r?\n/)) {
    const horodatages = [...brute.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!horodatages.length) continue;

    const texte = brute.replace(/\[[^\]]*\]/g, '').trim();
    for (const [, m, s, frac] of horodatages) {
      // Les centièmes s'écrivent sur deux chiffres, les millièmes sur trois :
      // lire « .31 » comme 31 millisecondes décalerait tout d'un tiers de
      // seconde, ce qui se voit à l'œil sur une ligne qui s'allume.
      const petit = frac ? Number(frac.padEnd(3, '0')) : 0;
      lignes.push({ t: Number(m) * 60000 + Number(s) * 1000 + petit, texte });
    }
  }
  return lignes.sort((a, b) => a.t - b.t);
}

/**
 * La ligne en cours, à un instant donné.
 *
 * Rend l'INDICE et non la ligne : l'interface a besoin de savoir laquelle
 * surligner ET où faire défiler, et deux lignes identiques (un refrain) ne se
 * distinguent que par leur rang.
 *
 * Recherche dichotomique : sur un morceau de dix minutes, on appelle ceci
 * quatre fois par seconde, et parcourir deux cents lignes à chaque fois pour
 * une réponse qui bouge rarement est du gaspillage pur.
 */
export function ligneCourante(lignes, position) {
  if (!lignes?.length) return -1;
  if (position < lignes[0].t) return -1;
  let bas = 0;
  let haut = lignes.length - 1;
  while (bas < haut) {
    const milieu = Math.ceil((bas + haut) / 2);
    if (lignes[milieu].t <= position) bas = milieu; else haut = milieu - 1;
  }
  return bas;
}

/** Normalise un titre pour la comparaison : LRCLIB est sensible aux mentions. */
const nettoyer = (s) => String(s ?? '').toLowerCase()
  .replace(/\((?:feat|ft|with)[^)]*\)/g, '')
  .replace(/\s*-\s*(?:remaster|remastered|radio edit|single version)[^-]*$/i, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

/**
 * Cherche les paroles d'un morceau.
 *
 * DEUX TENTATIVES, ET LA SECONDE COMPTE. La correspondance exacte suppose que
 * le titre d'album et la durée concordent au caractère près — or Spotify sert
 * « Album (Deluxe Edition) » là où LRCLIB a « Album », et les durées diffèrent
 * d'une seconde d'une édition à l'autre. Sans repli, la moitié des morceaux
 * n'auraient « pas de paroles » alors qu'elles existent.
 */
export async function chercherParoles({ titre, artistes, album, duree }, recuperer = fetch) {
  if (!titre || !artistes) return null;
  const artiste = String(artistes).split(',')[0].trim();

  const exact = new URLSearchParams({ artist_name: artiste, track_name: titre });
  if (album) exact.set('album_name', album);
  if (duree) exact.set('duration', String(Math.round(duree / 1000)));

  const direct = await lire(`${BASE}/get?${exact}`, recuperer);
  if (direct) return direct;

  const trouves = await lire(`${BASE}/search?${new URLSearchParams({
    track_name: titre, artist_name: artiste })}`, recuperer);
  if (!Array.isArray(trouves) || !trouves.length) return null;

  return choisir(trouves, { titre, artiste, duree });
}

async function lire(url, recuperer) {
  try {
    const r = await recuperer(url, { headers: { 'User-Agent': AGENT } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * Le meilleur candidat d'une recherche.
 *
 * La DURÉE tranche mieux que le titre : deux versions d'un même morceau
 * portent le même nom, et c'est la longueur qui distingue l'édition radio de
 * l'originale. À défaut, on préfère ce qui est synchronisé — une ligne qui
 * s'allume vaut mieux qu'un bloc de texte, même exact.
 */
export function choisir(candidats, { titre, artiste, duree }) {
  const t = nettoyer(titre);
  const a = nettoyer(artiste);
  const secondes = duree ? duree / 1000 : null;

  const note = (c) => {
    let n = 0;
    if (nettoyer(c.trackName) === t) n += 4;
    if (nettoyer(c.artistName) === a) n += 3;
    if (c.syncedLyrics) n += 2;
    if (secondes && Math.abs((c.duration ?? 0) - secondes) <= 3) n += 4;
    else if (secondes && Math.abs((c.duration ?? 0) - secondes) <= 10) n += 1;
    return n;
  };

  const meilleur = candidats
    .filter(c => c && (c.syncedLyrics || c.plainLyrics))
    .sort((x, y) => note(y) - note(x))[0];

  // En dessous de la moitié des points, on préfère ne rien dire : afficher les
  // paroles d'un autre morceau est pire que d'afficher « introuvable ».
  return meilleur && note(meilleur) >= 6 ? meilleur : null;
}

/** Ce que l'interface reçoit : des lignes prêtes, et rien de plus. */
export function resumeParoles(d) {
  if (!d) return { trouve: false };
  if (d.instrumental) return { trouve: true, instrumental: true, lignes: [], texte: '' };
  const lignes = analyserLrc(d.syncedLyrics);
  return {
    trouve: Boolean(lignes.length || d.plainLyrics),
    instrumental: false,
    synchro: lignes.length > 0,
    lignes,
    texte: String(d.plainLyrics ?? ''),
    source: [d.artistName, d.trackName].filter(Boolean).join(' — '),
  };
}
