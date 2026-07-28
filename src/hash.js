// Identifiant stable d'une offre.
// Cet identifiant relie une offre au suivi personnel (statut, notes, relances).
// Il doit rester IDENTIQUE quand la même offre est republiée ou vue sur une
// autre plateforme, sinon le suivi est perdu.
import { createHash } from 'node:crypto';

// Retire les variantes de la mention « homme/femme » : H/F, (H/F), F/H, M/F…
const MENTION_HF = /\(?\s*[hfm]\s*\/\s*[hfm]\s*\)?/gi;

// Retire un code postal ou département entre parenthèses : « Strasbourg (67) »
const CODE_POSTAL = /\(\s*\d{2,5}\s*\)/g;

/**
 * Normalise une chaîne pour la rendre comparable :
 * minuscules, sans accents, sans ponctuation, espaces compressés.
 */
export function normaliser(texte) {
  if (!texte) return '';
  return String(texte)
    .normalize('NFD')                      // décompose les caractères accentués
    .replace(/[\u0300-\u036f]/g, '')       // retire les diacritiques
    .toLowerCase()
    .replace(CODE_POSTAL, ' ')
    .replace(MENTION_HF, ' ')
    .replace(/[^a-z0-9]+/g, ' ')           // toute ponctuation devient espace
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Identifiant stable calculé sur titre + entreprise + ville normalisés.
 * 16 caractères : suffisant pour éviter toute collision à cette échelle
 * (quelques milliers d'offres), et lisible dans les URL et les logs.
 */
export function offreId(titre, entreprise, ville) {
  const cle = [normaliser(titre), normaliser(entreprise), normaliser(ville)].join('|');
  return createHash('sha1').update(cle, 'utf8').digest('hex').slice(0, 16);
}
