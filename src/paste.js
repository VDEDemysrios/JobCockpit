// Import d'une offre par collage de texte brut.
//
// C'est le pont entre la collecte automatique et tout ce qu'elle ne couvre
// pas : une offre trouvée en conversation, sur LinkedIn, l'APEC, un site
// carrière… L'offre importée passe ensuite par EXACTEMENT le même pipeline
// que les offres collectées (hash, scoring, analyse).
import { demander, extraireJson, estConfigure } from './gemini.js';

const PROMPT = `Tu extrais les informations d'une annonce d'emploi collée en vrac.

Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après :

{
  "titre":       "intitulé exact du poste",
  "entreprise":  "nom de l'employeur, ou \\"\\" si absent",
  "ville":       "ville ou département, ou \\"\\" si absent",
  "contrat":     "CDI, CDD, stage, alternance… ou \\"\\" si absent",
  "dateOffre":   "date de publication au format AAAA-MM-JJ, ou null si absente",
  "lien":        "URL de l'annonce si présente dans le texte, sinon null",
  "description": "le texte de l'annonce, nettoyé de la navigation et des publicités, mais COMPLET sur le fond (missions, profil recherché, exigences)"
}

N'invente aucune information : si un champ est absent du texte, laisse-le vide ou null.
Ne résume pas la description : conserve les exigences et le profil recherché mot pour mot,
car ils servent ensuite à évaluer la candidature.

# TEXTE COLLÉ
`;

/**
 * Extrait une offre structurée depuis du texte brut.
 * @returns {Promise<object|null>} null si l'extraction échoue
 */
export async function extraireOffreCollee(texteBrut) {
  if (!estConfigure()) {
    throw new Error('L\'import par collage nécessite une clé GEMINI_API_KEY dans le fichier .env.');
  }
  if (!texteBrut || texteBrut.trim().length < 100) {
    throw new Error('Texte trop court : colle l\'annonce complète (au moins quelques lignes).');
  }

  const reponse = await demander(PROMPT + texteBrut.slice(0, 20000));
  const brut = extraireJson(reponse);

  if (!brut || typeof brut.titre !== 'string' || brut.titre.trim() === '') {
    throw new Error('Impossible d\'identifier un intitulé de poste dans ce texte.');
  }

  return {
    titre: brut.titre.trim(),
    entreprise: typeof brut.entreprise === 'string' ? brut.entreprise.trim() : '',
    ville: typeof brut.ville === 'string' ? brut.ville.trim() : '',
    zone: '',
    codePostal: '',
    contrat: typeof brut.contrat === 'string' ? brut.contrat.trim() : '',
    dateOffre: /^\d{4}-\d{2}-\d{2}$/.test(brut.dateOffre) ? brut.dateOffre : null,
    lien: typeof brut.lien === 'string' && brut.lien.startsWith('http') ? brut.lien : null,
    description: typeof brut.description === 'string' ? brut.description : texteBrut.slice(0, 8000),
    salaireSource: null,
    externalId: null,
  };
}
