// Classement déterministe d'une offre en 4 groupes.
// Fonction PURE : aucun appel réseau, aucune base, aucun effet de bord.
// Les règles vivent dans profile/profile.json — modifiables sans toucher au code.
import { normaliser } from './hash.js';

/**
 * @param {{titre: string, description?: string}} offre
 * @param {object} profil  contenu de profile/profile.json
 * @returns {{groupe: 0|1|2|3, score: number, detail: object}}
 */
export function scorer(offre, profil) {
  const regles = profil.scoring;
  const seuils = regles.seuils;

  const description = offre.description || '';
  const texte = normaliser(`${offre.titre || ''} ${description}`);

  const detail = { positifs: [], negatifs: [], eliminatoires: [] };
  let score = 0;

  // 1. Motifs éliminatoires — priment sur tout le reste.
  for (const regle of regles.eliminatoires) {
    if (new RegExp(regle.motif, 'i').test(texte)) {
      detail.eliminatoires.push({ motif: regle.motif, note: regle.note });
    }
  }
  if (detail.eliminatoires.length > 0) {
    return { groupe: 3, score: 0, detail };
  }

  // 2. Description absente ou trop courte : impossible de juger sérieusement.
  //    On ne classe pas « à écarter » par défaut — on demande une vérification.
  if (description.length < seuils.descriptionMiniCaracteres) {
    return { groupe: 0, score: 0, detail };
  }

  // 3. Cumul des motifs positifs et négatifs.
  for (const regle of regles.positifs) {
    if (new RegExp(regle.motif, 'i').test(texte)) {
      score += regle.poids;
      detail.positifs.push({ motif: regle.motif, poids: regle.poids, note: regle.note });
    }
  }
  for (const regle of regles.negatifs) {
    if (new RegExp(regle.motif, 'i').test(texte)) {
      score += regle.poids; // poids déjà négatif
      detail.negatifs.push({ motif: regle.motif, poids: regle.poids, note: regle.note });
    }
  }

  // 4. Application des seuils.
  let groupe;
  if (score >= seuils.prioritaire) groupe = 1;
  else if (score >= seuils.possible) groupe = 2;
  else if (score >= seuils.aVerifier) groupe = 0;
  else groupe = 3;

  return { groupe, score, detail };
}
