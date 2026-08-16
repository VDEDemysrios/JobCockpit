// Vérification des liens : une offre encore listée mène-t-elle quelque part ?
//
// LE PROBLÈME
// -----------
// Une offre reste dans la liste bien après avoir été retirée du site qui la
// publiait. On la lit, on la juge intéressante, on clique — et on tombe sur
// « cette offre d'emploi n'est plus disponible ». Le temps est perdu, mais
// surtout l'élan : c'est exactement le moment où l'on décide de postuler.
//
// CE QUI NE MARCHE PAS, ET POURQUOI
// ---------------------------------
// 1. CHERCHER UN MESSAGE DANS LA PAGE. Mesuré sur les offres réelles : les
//    pages France Travail contiennent toutes « n'existe plus », y compris
//    celles collectées le matin même et dont le titre est bien celui de
//    l'offre. Le texte est dans un gabarit d'erreur que la page n'affiche
//    pas. Huit offres vivantes sur huit auraient été déclarées mortes.
//
// 2. SE FIER À LA DISPARITION DES COLLECTES. Le signal existe — sur douze
//    offres revues à la dernière collecte, zéro morte ; sur douze disparues,
//    cinq mortes — mais sept de ces douze étaient bien vivantes : les sources
//    ne renvoient qu'une page de résultats, et les offres tournent. Écarter
//    sur ce seul critère jetterait la majorité d'offres valides.
//
// CE QUI MARCHE
// -------------
// Les deux ensemble, dans cet ordre : la disparition des collectes désigne
// QUI vérifier, le code HTTP tranche. Et seul un 404 ou un 410 tranche — un
// 403 ne dit rien (Jooble refuse tout robot), un délai dépassé encore moins.
//
// Dans le doute, l'offre reste. Une offre morte laissée dans la liste coûte
// un clic ; une offre vivante supprimée par erreur ne se retrouve jamais.

/** Codes qui prouvent la disparition. Aucun autre ne prouve quoi que ce soit. */
const CODES_MORTS = new Set([404, 410]);

/** Au-delà, on considère qu'on n'a pas de réponse — pas que l'offre est morte. */
const DELAI_MS = 12000;

/**
 * Un navigateur ordinaire. Sans en-tête crédible, plusieurs sites répondent
 * 403 — ce qui, dans notre logique, ne conclut rien, mais fait perdre le
 * bénéfice de la vérification.
 */
const NAVIGATEUR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/128.0 Safari/537.36';

/**
 * Interroge une URL et conclut.
 *
 * @param {string} lien
 * @param {typeof fetch} [recuperer]  injectable pour les tests
 * @returns {Promise<{etat: 'morte'|'vivante'|'indetermine', code: number|null, raison: string}>}
 */
export async function verifierLien(lien, recuperer = fetch) {
  if (!lien || !/^https?:\/\//i.test(lien)) {
    return { etat: 'indetermine', code: null, raison: 'lien absent ou non http' };
  }

  let reponse;
  try {
    reponse = await recuperer(lien, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(DELAI_MS),
      headers: { 'User-Agent': NAVIGATEUR, 'Accept-Language': 'fr-FR,fr;q=0.9' },
    });
  } catch (erreur) {
    // Réseau coupé, DNS, délai dépassé : on ne sait pas. Surtout pas « morte ».
    return { etat: 'indetermine', code: null, raison: erreur?.name ?? 'échec réseau' };
  }

  if (CODES_MORTS.has(reponse.status)) {
    return { etat: 'morte', code: reponse.status, raison: `HTTP ${reponse.status}` };
  }
  if (reponse.status >= 200 && reponse.status < 300) {
    return { etat: 'vivante', code: reponse.status, raison: `HTTP ${reponse.status}` };
  }
  // 403 (Jooble), 429, 5xx : le site se protège ou tombe. L'offre, elle, n'en
  // sait rien.
  return { etat: 'indetermine', code: reponse.status, raison: `HTTP ${reponse.status}` };
}

/**
 * Vérifie une liste d'offres, doucement.
 *
 * SÉQUENTIEL ET ESPACÉ, à dessein. Ces sites ne nous doivent rien : lancer
 * cent requêtes simultanées est le meilleur moyen de se faire bloquer — et de
 * transformer des offres vivantes en « indéterminé » pour tout le monde.
 *
 * @param {{id: number|string, lien: string}[]} offres
 * @param {object} [o]
 * @param {number} [o.pauseMs]     entre deux requêtes
 * @param {number} [o.maximum]     plafond par passe
 * @param {typeof fetch} [o.recuperer]
 * @param {(fait: number, total: number) => void} [o.progres]
 * @returns {Promise<{id: any, etat: string, code: number|null, raison: string}[]>}
 */
export async function verifierOffres(offres, o = {}) {
  const { pauseMs = 300, maximum = 80, recuperer = fetch, progres } = o;
  const lot = offres.slice(0, maximum);
  const resultats = [];

  for (const [i, offre] of lot.entries()) {
    const r = await verifierLien(offre.lien, recuperer);
    resultats.push({ id: offre.id, ...r });
    progres?.(i + 1, lot.length);
    if (i < lot.length - 1 && pauseMs) {
      await new Promise(resoudre => setTimeout(resoudre, pauseMs));
    }
  }
  return resultats;
}

/**
 * QUI vérifier, et dans quel ordre.
 *
 * Les offres revues à la dernière collecte sont vivantes — zéro morte sur
 * douze sondées. Les vérifier serait dépenser des requêtes pour confirmer ce
 * qu'on sait déjà. On ne regarde donc que celles qui ont cessé d'apparaître,
 * les plus anciennement vues d'abord : ce sont les plus suspectes, et si le
 * plafond coupe la passe, il coupe au bon endroit.
 *
 * Une offre déjà vérifiée récemment est laissée tranquille — un site qui
 * répond 404 aujourd'hui répondra 404 demain.
 *
 * @param {object[]} offres        avec last_seen, lien, lien_verifie_le, lien_mort
 * @param {string} derniereCollecte  ISO
 * @param {number} [revalidationJours]
 */
export function aVerifier(offres, derniereCollecte, revalidationJours = 3) {
  const seuil = String(derniereCollecte ?? '').slice(0, 10);
  const limite = Date.now() - revalidationJours * 86400000;

  return offres
    .filter(o => o.lien && /^https?:\/\//i.test(o.lien))
    .filter(o => !o.lien_mort)
    .filter(o => String(o.last_seen ?? '').slice(0, 10) < seuil)
    .filter(o => !o.lien_verifie_le || new Date(o.lien_verifie_le).getTime() < limite)
    .sort((a, b) => String(a.last_seen).localeCompare(String(b.last_seen)));
}
