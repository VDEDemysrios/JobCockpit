// Rédaction des relances de candidature.
//
// L'application détectait déjà les candidatures « à relancer » — sans réponse
// après un délai. Elle s'arrêtait là : un rappel, pas une action. Or la relance
// est un moment délicat à écrire — trop tôt on est pressant, trop plat on est
// oublié — et c'est précisément le genre de courriel qu'on repousse.
//
// Ce module rédige ce courriel : court, courtois, adossé à l'offre et au délai
// écoulé, prêt à copier. Il ne réclame RIEN — il rappelle son intérêt et
// demande poliment où en est le dossier.
//
// DEUX GARDE-FOUS, les mêmes que pour la lettre :
//   · rien n'est inventé — pas d'expérience, pas de compétence que le CV ne
//     porte pas ;
//   · en cas d'échec, on renvoie null et l'interface affiche un message, elle
//     ne casse pas.
import { demander, estConfigure, extraireJson } from './gemini.js';

/** Formule le délai en clair : « il y a douze jours », « depuis trois semaines ». */
export function delaiEnMots(jours) {
  const j = Math.max(0, Math.round(jours ?? 0));
  if (j <= 0) return "aujourd'hui";
  if (j === 1) return 'hier';
  if (j < 14) return `il y a ${j} jours`;
  if (j < 60) return `il y a ${Math.round(j / 7)} semaines`;
  return `il y a environ ${Math.round(j / 30)} mois`;
}

export function construirePromptRelance({ offre, coordonnees, jours, statut }) {
  const nom = coordonnees?.nom || 'le candidat';
  const quand = delaiEnMots(jours);
  return `Tu écris une RELANCE de candidature, en français, pour ${nom}.

# LA CANDIDATURE
Poste : ${offre.titre ?? '—'}
Employeur : ${offre.entreprise || 'employeur non précisé'}
Lieu : ${offre.ville || '—'}
Candidature envoyée : ${quand}${statut === 'Relancé' ? ' (une première relance a déjà été faite)' : ''}
Aucune réponse à ce jour.

# CE QUE TU ÉCRIS
Un COURRIEL de relance, sobre et professionnel, qui :
  - rappelle en une phrase la candidature (poste + entreprise) et sa date ;
  - réaffirme l'intérêt pour le poste en UNE phrase, sans lyrisme ;
  - demande poliment où en est l'examen du dossier ;
  - se tient à disposition pour un entretien ou tout complément.

# CE QUE TU N'ÉCRIS JAMAIS
  - aucune expérience, compétence ou réussite qui ne serait pas déjà connue :
    une relance n'est pas une seconde lettre, elle ne réargumente pas ;
  - aucun reproche, aucune insistance (« je m'étonne », « dans l'attente
    IMPÉRATIVE »…), aucune flatterie excessive ;
  - pas de formule datée (« Dans l'attente de votre retour, je vous prie
    d'agréer… » reste correcte ; évite les tournures ampoulées).

# LONGUEUR ET TON
Corps de 90 à 150 mots. Courtois, direct, une formule de politesse simple.
Signé « ${nom} ».

# FORMAT DE SORTIE
Un objet JSON, et RIEN d'autre :
{
  "objet": "l'objet du courriel, clair et court",
  "corps": "le corps complet, de « Madame, Monsieur, » à la signature, avec des sauts de ligne \\n entre les paragraphes"
}`;
}

/**
 * Rédige une relance. Ne lève jamais : renvoie `{ objet, corps }` ou null.
 * @returns {Promise<{objet:string, corps:string}|null>}
 */
export async function genererRelance({ offre, coordonnees, jours, statut }) {
  if (!estConfigure()) return null;
  if (!offre?.titre) return null;
  try {
    const texte = await demander(
      construirePromptRelance({ offre, coordonnees, jours, statut }));
    const data = extraireJson(texte);
    if (!data?.corps || data.corps.length < 60) return null;
    return {
      objet: String(data.objet || `Relance — candidature ${offre.titre}`).trim(),
      corps: String(data.corps).trim(),
    };
  } catch (erreur) {
    console.warn(`  ⚠ Relance impossible pour « ${offre.titre} » : ${erreur.message}`);
    return null;
  }
}
