// Les pièces jointes d'une conversation : images, PDF, sons, documents.
//
// POURQUOI CE MODULE EXISTE
// -------------------------
// Le chat n'acceptait qu'UNE image, et seulement sur le tour où on l'envoyait.
// Le commentaire d'alors l'assumait — « l'historique reste en texte, sinon
// chaque tour renverrait toutes les images déjà vues ». C'était raisonner sur
// le coût et oublier l'usage : on joint une capture, puis on pose sa question
// AU TOUR SUIVANT. Le modèle répondait alors « je n'ai pas accès aux images »,
// ce qui est faux, incompréhensible, et donne l'impression que la fonction
// n'existe pas.
//
// Une fenêtre BORNÉE règle les deux : les pièces des derniers tours repartent,
// les plus anciennes tombent. On paie quelques tours de relecture, pas
// l'intégralité de la conversation.
//
// CE QUE GEMINI SAIT LIRE, ET CE QU'IL FAUT TRADUIRE
// ---------------------------------------------------
// Images, PDF, sons et vidéos partent TELS QUELS en `inlineData` : le modèle
// est multimodal, il les lit nativement. Un PDF n'a donc pas à être converti,
// et c'est heureux — l'extraction de texte perd la mise en page, les tableaux
// et les colonnes, c'est-à-dire souvent l'information.
//
// Word et les formats de bureau, eux, ne sont PAS compris : ce sont des
// archives ZIP. Ils passent par une extraction de texte, et on le dit plutôt
// que de laisser croire que la mise en forme a été vue.

/** Ce qui part tel quel chez Gemini. */
const NATIFS = {
  image: /^image\/(png|jpe?g|webp|gif|heic|heif)$/i,
  pdf: /^application\/pdf$/i,
  son: /^audio\/(mpeg|mp3|wav|x-wav|ogg|webm|aac|flac|mp4|m4a|x-m4a)$/i,
  video: /^video\/(mp4|mpeg|webm|quicktime)$/i,
};

/** Ce qui se lit comme du texte brut, sans conversion. */
const TEXTES = [/^text\//i, /^application\/(json|xml|x-ndjson|csv)$/i, /^application\/x-subrip$/i];

/** Ce qu'il faut convertir avant de l'envoyer. */
const BUREAU = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

/**
 * Les plafonds.
 *
 * Gemini accepte une vingtaine de méga-octets par requête, tout compris. On
 * reste en dessous : une requête au plafond met une minute à partir sur une
 * connexion ordinaire, et l'utilisateur croit que l'application a planté.
 * Refuser clairement vaut mieux que faire attendre sans rien dire.
 */
export const LIMITES = {
  parPiece: 12 * 1024 * 1024,     // en base64, soit ~9 Mo de fichier
  total: 20 * 1024 * 1024,        // pour l'ensemble d'un message
  parMessage: 6,
  toursAvecPieces: 4,             // combien de tours en arrière gardent leurs pièces
  piecesRenvoyees: 4,             // et combien de pièces au total repartent
};

export function genrePiece(mime) {
  for (const [g, motif] of Object.entries(NATIFS)) if (motif.test(mime)) return g;
  if (BUREAU[mime]) return 'document';
  if (TEXTES.some(r => r.test(mime))) return 'texte';
  return 'inconnu';
}

const lisible = (octets) => (octets >= 1048576
  ? `${(octets / 1048576).toFixed(1)} Mo`
  : `${Math.max(1, Math.round(octets / 1024))} Ko`);

/**
 * Valide une pièce reçue du navigateur.
 *
 * Rend `{ ok }` ou `{ refus }`. Une pièce refusée ne fait PAS échouer le
 * message : on l'écarte, on le dit, et la conversation continue. Refuser tout
 * un message parce qu'un fichier sur cinq est trop lourd est la pire des
 * réactions — on perd aussi le texte qu'on venait d'écrire.
 */
export function validerPiece(p) {
  if (!p || typeof p !== 'object') return { refus: { nom: '?', raison: 'pièce illisible' } };
  const nom = String(p.nom ?? 'fichier').slice(0, 120);
  const mime = String(p.mimeType ?? '');
  const data = typeof p.data === 'string' ? p.data : '';

  if (!data) return { refus: { nom, raison: 'contenu vide' } };
  // Une chaîne base64 n'a ni espace ni en-tête `data:` : ce qui n'en est pas
  // ne part pas. C'est la seule barrière avant l'envoi chez un tiers.
  if (/[^A-Za-z0-9+/=]/.test(data)) return { refus: { nom, raison: 'encodage invalide' } };
  if (data.length > LIMITES.parPiece) {
    return { refus: { nom, raison: `trop lourd (${lisible(data.length * 0.75)}, 9 Mo maximum)` } };
  }

  const genre = genrePiece(mime);
  if (genre === 'inconnu') {
    return { refus: { nom, raison: `format non lu (${mime || 'type inconnu'})` } };
  }
  return { ok: { nom, mimeType: mime, data, genre, taille: Math.round(data.length * 0.75) } };
}

/**
 * Prépare les pièces d'un message pour l'envoi.
 *
 * @param {Array} brutes  ce que le navigateur a envoyé
 * @param {(p: object) => Promise<string>} [extraire]  conversion des documents
 */
export async function preparerPieces(brutes, extraire = extraireDocument) {
  const inline = [];
  const textes = [];
  const refus = [];
  let total = 0;

  for (const b of (Array.isArray(brutes) ? brutes : []).slice(0, LIMITES.parMessage)) {
    const { ok, refus: r } = validerPiece(b);
    if (r) { refus.push(r); continue; }

    if (total + ok.data.length > LIMITES.total) {
      refus.push({ nom: ok.nom, raison: 'l\'ensemble dépasse la taille d\'un envoi' });
      continue;
    }
    total += ok.data.length;

    if (ok.genre === 'texte') {
      textes.push({ nom: ok.nom, contenu: decoder(ok.data).slice(0, 40000) });
    } else if (ok.genre === 'document') {
      try {
        textes.push({ nom: ok.nom, contenu: (await extraire(ok)).slice(0, 40000) });
      } catch (e) {
        refus.push({ nom: ok.nom, raison: `illisible (${e.message})` });
      }
    } else {
      inline.push({ mimeType: ok.mimeType, data: ok.data, nom: ok.nom, genre: ok.genre });
    }
  }
  return { inline, textes, refus };
}

const decoder = (base64) => Buffer.from(base64, 'base64').toString('utf8');

/**
 * Extrait le texte d'un document de bureau.
 *
 * `mammoth` est déjà là pour le CV : même bibliothèque, même format, rien de
 * neuf à installer. L'import est TARDIF — il ne coûte rien tant que personne
 * ne joint de document, et le serveur démarre sans l'attendre.
 */
async function extraireDocument(piece) {
  if (BUREAU[piece.mimeType] !== 'docx') throw new Error('format non pris en charge');
  const { default: mammoth } = await import('mammoth');
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(piece.data, 'base64') });
  const texte = String(value ?? '').trim();
  if (!texte) throw new Error('document vide');
  return texte;
}

/**
 * Les pièces des derniers tours, pour que le modèle puisse encore en parler.
 *
 * C'EST LE DÉFAUT QUE CE MODULE CORRIGE. Sans cette fenêtre, joindre une
 * capture puis demander « et l'entretien, il est quand ? » au tour suivant
 * faisait répondre « je n'ai pas accès aux images » — le modèle disait vrai,
 * on ne lui avait rien donné.
 *
 * On remonte du plus RÉCENT au plus ancien : la dernière pièce jointe compte
 * plus que la première, et c'est presque toujours celle dont on parle.
 */
export function piecesRecentes(messages, { tours = LIMITES.toursAvecPieces,
  maximum = LIMITES.piecesRenvoyees } = {}) {
  const retenues = [];
  const derniers = (messages ?? []).slice(-tours);

  for (let i = derniers.length - 1; i >= 0 && retenues.length < maximum; i--) {
    const pieces = derniers[i]?.pieces;
    if (!Array.isArray(pieces)) continue;
    for (let k = pieces.length - 1; k >= 0 && retenues.length < maximum; k--) {
      retenues.unshift(pieces[k]);
    }
  }
  return retenues;
}

/** Ce que le prompt dit des pièces jointes, en une phrase. */
export function decrirePieces(inline = [], textes = []) {
  const compte = {};
  for (const p of inline) compte[p.genre] = (compte[p.genre] ?? 0) + 1;
  if (textes.length) compte.document = (compte.document ?? 0) + textes.length;

  const mots = {
    image: ['une image', 'images'],
    pdf: ['un PDF', 'PDF'],
    son: ['un fichier audio', 'fichiers audio'],
    video: ['une vidéo', 'vidéos'],
    document: ['un document', 'documents'],
  };
  const bouts = Object.entries(compte).map(([g, n]) => (n === 1
    ? mots[g]?.[0] ?? 'un fichier'
    : `${n} ${mots[g]?.[1] ?? 'fichiers'}`));
  if (!bouts.length) return '';

  return bouts.length === 1 ? bouts[0]
    : `${bouts.slice(0, -1).join(', ')} et ${bouts.at(-1)}`;
}
