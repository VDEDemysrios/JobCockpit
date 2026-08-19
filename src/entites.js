// Décoder les entités HTML et XML.
//
// POURQUOI UN MODULE À PART
// -------------------------
// Ce décodeur vivait dans l'adaptateur RSS, parce que c'est là qu'on en avait
// eu besoin en premier. Il n'a pourtant rien de propre aux flux : **l'API de
// YouTube renvoie ses titres déjà encodés**, et l'accent de « Café » ou les
// guillemets de « "All About It" » ressortaient à l'écran en `&quot;` et
// `&#233;`.
//
// Le mécanisme de la panne mérite d'être compris, parce qu'il se reproduira
// avec la prochaine API : le titre arrive encodé, l'interface l'échappe une
// SECONDE fois avant de l'insérer — c'est la règle, et elle est juste —, donc
// `&quot;` devient `&amp;quot;`, et le navigateur affiche `&quot;`. Le
// coupable n'est jamais l'échappement : c'est l'absence de décodage à
// l'entrée.
//
// LA RÈGLE : on décode À LA SOURCE, une seule fois, au moment où la donnée
// entre dans l'application. Tout ce qui circule ensuite est du texte, et
// l'échappement à l'affichage fait son travail sans rien casser.

const ENTITES = {
  nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
  agrave: 'à', acirc: 'â', ccedil: 'ç', ugrave: 'ù', ucirc: 'û', uuml: 'ü',
  ocirc: 'ô', ouml: 'ö', icirc: 'î', iuml: 'ï', ntilde: 'ñ',
  aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', atilde: 'ã', otilde: 'õ',
  auml: 'ä', aring: 'å', oslash: 'ø', szlig: 'ß',
  laquo: '«', raquo: '»', hellip: '…', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', deg: '°', euro: '€',
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'',
  copy: '©', reg: '®', trade: '™', middot: '·', bull: '•',
};

/**
 * Décode les entités HTML et XML les plus courantes.
 *
 * UN SEUL PASSAGE, ET C'EST TOUT L'ENJEU. Décoder `&lt;` puis `&amp;` en deux
 * temps fait que `&amp;lt;` — qui veut dire le TEXTE « &lt; » — devient `<`,
 * c'est-à-dire une balise. La version précédente s'en tirait en traitant
 * `&amp;` en dernier ; une expression unique qui consomme chaque entité une
 * fois s'en tire sans avoir à y penser, et ne se cassera pas si quelqu'un
 * réordonne les lignes.
 */
export function decoderEntites(texte) {
  return String(texte ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z][a-z0-9]*));/gi, (tout, hex, dec, nom) => {
      if (hex) return sur(parseInt(hex, 16), tout);
      if (dec) return sur(Number(dec), tout);
      return ENTITES[nom.toLowerCase()] ?? tout;
    });
}

/**
 * Un point de code hors des bornes fait lever `String.fromCodePoint`.
 *
 * Une entité malformée dans un titre ne doit pas faire tomber une collecte
 * entière : on rend le texte d'origine, qui est au pire illisible.
 */
function sur(point, brut) {
  if (!Number.isFinite(point) || point < 0 || point > 0x10ffff) return brut;
  try { return String.fromCodePoint(point); } catch { return brut; }
}

/** Décode ET rogne. C'est ce que veulent les adaptateurs de flux. */
export const decoder = (texte) => decoderEntites(texte).trim();
