// Source « flux RSS / Atom » — générique et pilotée par profile.json.
//
// POURQUOI CETTE SOURCE
// ---------------------
// La plupart des sites d'emploi français n'ouvrent pas d'API en libre-service
// (APEC, HelloWork, Welcome to the Jungle, Talent.com…), mais presque tous
// publient des flux RSS : alertes de recherche enregistrée, page « nos offres »
// d'un employeur, agrégateurs régionaux. Un flux public est fait pour être lu
// par un programme — c'est même son unique raison d'être.
//
// Résultat : ajouter un site ne demande plus d'écrire du code. Il suffit de
// coller son URL de flux dans `flux` (profile/profile.json) :
//
//   "flux": [
//     { "nom": "APEC — chef de projet EnR",
//       "url": "https://www.apec.fr/.../rss?motsCles={intitule}" },
//     { "nom": "Carrières Voltalia", "url": "https://…/jobs.rss",
//       "entreprise": "Voltalia" }
//   ]
//
// `{intitule}` est remplacé par chacun de tes intitulés de recherche, encodé
// pour l'URL. Sans ce jeton, le flux est lu tel quel, une seule fois.
//
// L'analyse XML est volontairement faite à la main : ajouter une dépendance
// pour lire une poignée de balises serait disproportionné, et un flux
// malformé ne doit jamais faire tomber la collecte entière.

// Un même flux relu pour chacun des 5 intitulés serait 5 fois le même appel.
// Le cache est volontairement court : il ne survit pas à une collecte suivante.
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

/**
 * Le décodeur d'entités a DÉMÉNAGÉ dans `src/entites.js`.
 *
 * Il n'avait rien de propre aux flux : l'API de YouTube renvoie elle aussi
 * ses titres encodés, et une seconde copie aurait fini par diverger.
 *
 * On l'IMPORTE et on le réexporte : une réexportation seule ne crée pas la
 * liaison locale, et ce fichier s'en sert lui-même à six endroits.
 */
import { decoder } from '../entites.js';

export { decoder };
/** Retire le balisage HTML d'une description de flux. */
export function sansHtml(texte) {
  return decoder(texte)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    // Les balises retirées laissent des espaces autour des sauts de ligne :
    // sans ce nettoyage, chaque paragraphe démarrerait par une espace.
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Contenu de la première balise `nom` trouvée dans un fragment XML. */
function balise(fragment, ...noms) {
  for (const nom of noms) {
    const m = fragment.match(new RegExp(`<${nom}(?:\\s[^>]*)?>([\\s\\S]*?)</${nom}>`, 'i'));
    if (m) return decoder(m[1]);
  }
  return '';
}

/** Lien d'une entrée : balise `link` en RSS, attribut `href` en Atom. */
function lien(fragment) {
  const atom = fragment.match(/<link[^>]*\shref=["']([^"']+)["'][^>]*\/?>/i);
  if (atom) return decoder(atom[1]);
  return balise(fragment, 'link', 'guid');
}

/** Date d'une entrée, ramenée au format AAAA-MM-JJ. */
export function dateEntree(fragment) {
  const brute = balise(fragment, 'pubDate', 'published', 'updated', 'dc:date', 'date');
  if (!brute) return null;
  const d = new Date(brute);
  if (Number.isNaN(d.getTime())) return null;
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Sépare un titre de flux en poste / entreprise / ville.
 *
 * Les flux d'emploi français suivent presque tous la même forme :
 *   « Chef de projet EnR H/F - Société X - Strasbourg (67) »
 *   « Juriste droit public chez Cabinet Y | Lyon »
 * On coupe donc sur les séparateurs usuels. Quand la découpe échoue, on
 * garde le titre entier plutôt que d'inventer : une offre mal étiquetée
 * reste exploitable, une offre inventée non.
 */
export function decouperTitre(titre) {
  let morceaux = String(titre ?? '')
    .split(/\s+[-–—|·]\s+|\s+chez\s+/i)
    .map(x => x.trim())
    .filter(Boolean);

  // Référence de publication puis code du service s'empilent parfois :
  // on dépile tant qu'il reste de quoi nommer le poste.
  while (morceaux.length >= 2 && estUneReference(morceaux[0])) morceaux = morceaux.slice(1);

  if (morceaux.length >= 3) {
    return { titre: morceaux[0], entreprise: morceaux[1], ville: morceaux.slice(2).join(' ') };
  }
  if (morceaux.length === 2) {
    // Deux morceaux : le second est une ville s'il porte un code postal ou
    // ressemble à un nom de lieu court, sinon c'est l'entreprise.
    const ressembleAUneVille = /\(\d{2,5}\)|^\d{2,5}\s/.test(morceaux[1]) || morceaux[1].split(' ').length <= 2;
    return ressembleAUneVille
      ? { titre: morceaux[0], entreprise: '', ville: morceaux[1] }
      : { titre: morceaux[0], entreprise: morceaux[1], ville: '' };
  }
  return { titre: morceaux[0] ?? String(titre ?? '').trim(), entreprise: '', ville: '' };
}

/** Convertit un flux XML complet en offres au format commun du projet. */
export function analyserFlux(xml, config = {}) {
  const entrees = String(xml ?? '').match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) ?? [];

  return entrees.map(entree => {
    const titreBrut = balise(entree, 'title');
    const decoupe = decouperTitre(titreBrut);
    const description = sansHtml(
      balise(entree, 'content:encoded', 'description', 'summary', 'content'));

    // L'adresse postale d'une entrée est plus fiable que la ville devinée
    // d'après le titre : c'est elle qui permet de situer l'offre dans la zone.
    const adresse = adressePostale(entree);
    const ville = config.ville || adresse.ville || decoupe.ville || '';

    return {
      externalId: lien(entree) || titreBrut,
      titre: decoupe.titre || titreBrut,
      // `nom` est l'étiquette du flux dans les journaux, pas un employeur :
      // s'en servir ici inventerait des sociétés qui n'existent pas.
      entreprise: config.entreprise || decoupe.entreprise || '',
      ville,
      // Un flux filtré par département sait où sont ses offres, même quand
      // l'entrée ne le répète pas : `zone` évite qu'elles soient écartées.
      zone: ville || config.zone || '',
      codePostal: adresse.codePostal,
      contrat: '',
      dateOffre: dateEntree(entree),
      lien: lien(entree),
      description,
      salaireSource: null,
    };
  }).filter(o => o.titre);
}

/**
 * Transforme les octets reçus en texte, selon l'encodage annoncé.
 *
 * Une partie des flux d'emploi français est encore en ISO-8859-1 et ne
 * l'annonce que dans le prologue XML, jamais dans l'en-tête HTTP. Décodés
 * d'office en UTF-8, tous leurs accents deviennent « � » — et une offre
 * illisible fait travailler l'analyse Gemini à l'aveugle.
 */
export function decoderReponse(octets, contentType = '') {
  const buffer = Buffer.from(octets);
  const annonceHttp = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  // Le prologue est en ASCII pur quel que soit l'encodage du corps : le lire
  // en latin1 sur les premiers octets est sûr.
  const annonceXml = /encoding=["']([\w-]+)["']/i.exec(buffer.subarray(0, 200).toString('latin1'))?.[1];

  for (const encodage of [annonceHttp, annonceXml, 'utf-8']) {
    if (!encodage) continue;
    try {
      return new TextDecoder(encodage).decode(buffer);
    } catch {
      // Encodage exotique ou mal orthographié : on essaie le suivant plutôt
      // que de faire tomber la collecte entière pour un flux mal étiqueté.
    }
  }
  return buffer.toString('utf8');
}

/**
 * Reconnaît une référence d'offre placée en tête de titre.
 *
 * Les flux institutionnels préfixent leur titre de la référence interne
 * (« DEF_14-00069057 - CHARGE DE CLIENTELE »). Un intitulé de poste est fait
 * de mots séparés par des espaces : un segment d'un seul tenant qui contient
 * un chiffre n'en est pas un.
 */
function estUneReference(segment) {
  return /^[A-Za-z0-9][A-Za-z0-9_/-]*$/.test(segment) && /\d/.test(segment);
}

/** Ville et code postal lus dans l'adresse postale d'une entrée. */
function adressePostale(fragment) {
  for (const m of fragment.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)) {
    const adresse = decoder(m[1]);
    // Le nom de commune qui suit est ce qui distingue un code postal d'un
    // numéro de boîte postale (« CS 10205 : 75588 Paris »).
    const ligne = /\b(\d{5})\s+([A-Za-zÀ-ÿ][^\n,]*)/.exec(adresse);
    if (ligne) return { codePostal: ligne[1], ville: ligne[2].trim() };
  }
  return { codePostal: '', ville: '' };
}

async function lireFlux(url) {
  const enCache = cache.get(url);
  if (enCache && Date.now() - enCache.a < CACHE_MS) return enCache.xml;

  const reponse = await fetch(url, {
    headers: { 'User-Agent': 'JobCockpit/1.0 (lecteur de flux personnel)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
  });
  if (!reponse.ok) throw new Error(`flux injoignable (HTTP ${reponse.status})`);

  const xml = decoderReponse(await reponse.arrayBuffer(), reponse.headers.get('content-type') ?? '');
  cache.set(url, { a: Date.now(), xml });
  return xml;
}

export default {
  nom: 'flux',

  // Le profil est passé par sources/index.js : la configuration de cette
  // source ne vit pas dans .env mais dans profile.json, à côté des villes
  // et des intitulés qu'elle accompagne.
  estConfiguree(profil) {
    return Array.isArray(profil?.flux) && profil.flux.length > 0;
  },

  async chercher({ intitule, ville, depuisDate, profil }) {
    // Un flux est une URL fixe : le relire pour chacune des 4 villes
    // renverrait 4 fois la même chose. On ne le lit qu'à la passe nationale.
    if (ville) return [];

    const offres = [];
    const echecs = [];

    for (const config of profil?.flux ?? []) {
      if (!config?.url) continue;
      const url = config.url.replace(/\{intitule\}/g, encodeURIComponent(intitule));

      try {
        const xml = await lireFlux(url);
        for (const offre of analyserFlux(xml, config)) {
          // Beaucoup de flux ne datent pas leurs entrées : on les garde, le
          // scoring les classera « à vérifier ».
          if (offre.dateOffre && offre.dateOffre < depuisDate) continue;
          offres.push(offre);
        }
      } catch (erreur) {
        echecs.push(`${config.nom ?? url} : ${erreur.message}`);
      }
    }

    // Un flux mort ne doit pas masquer les autres : on ne lève que si TOUS
    // ont échoué, auquel cas la source est marquée « en échec » dans le
    // résumé de collecte.
    if (offres.length === 0 && echecs.length > 0) {
      throw new Error(`aucun flux lisible — ${echecs.join(' ; ')}`);
    }
    return offres;
  },
};
