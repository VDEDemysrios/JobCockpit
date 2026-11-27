// Analyse qualitative d'une offre au regard du CV du candidat.
// Produit exactement les champs que le dashboard sait déjà afficher.
import { demander, extraireJson, estConfigure } from './gemini.js';

const VALEURS_KW = new Set(['oui', 'non', 'partiel']);

/** Construit le prompt d'analyse. */
export function construirePrompt(offre, cv) {
  return `Tu es un conseiller en recrutement français, direct et sans complaisance.
Tu analyses une offre d'emploi au regard d'un CV précis.

# CV DU CANDIDAT
${cv}

# OFFRE À ANALYSER
Titre : ${offre.titre}
Entreprise : ${offre.entreprise || 'non précisée'}
Ville : ${offre.ville || 'non précisée'}
Salaire annoncé par l'employeur : ${offre.salaireSource || 'non annoncé'}

Description :
${offre.description}

# TA MISSION
Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après,
respectant exactement cette structure :

{
  "exige":        ["ce qui est RÉDHIBITOIRE si absent — cite l'offre"],
  "souhaite":     ["ce qui est souhaité mais négociable"],
  "decoratif":    ["le marketing employeur sans portée réelle"],
  "prouvable":    ["ce que le candidat peut prouver AVEC SON CV — cite l'élément du CV"],
  "nonprouvable": ["ce qu'il ne peut pas prouver — sois honnête"],
  "compensable":  ["ce qui est contournable, et comment"],
  "verdict":      "2 phrases maximum, tranchées. Exemples de ton : « Oui, c'est pour toi. Meilleure offre du lot. » ou « Non. L'exigence 5 ans M&A est éliminatoire. »",
  "kw":           [["mot-clé de l'offre absent du CV", "oui|non|partiel", "pourquoi c'est revendicable ou non"]],
  "fourchette":   "fourchette salariale réaliste, ex. « 36 000 – 44 000 € brut annuel »",
  "fnote":        "une phrase justifiant la fourchette (marché, séniorité, rareté du profil)",
  "formul":       ["3 formulations à l'oral pour annoncer ses prétentions, entre guillemets"],
  "budget":       ["3 réponses si l'employeur dit « c'est au-dessus de notre budget »"]
}

# RÈGLES IMPÉRATIVES
- Ne déclare "prouvable" QUE ce qui figure réellement dans le CV ci-dessus. Cite-le.
- N'invente jamais une expérience, un diplôme, un chiffre ou un employeur.
- Le verdict est direct : pas de langue de bois, pas de « ce poste pourrait être intéressant ».
- Pour "fourchette" : si l'employeur annonce un salaire, appuie-toi dessus.
  Sinon, estime d'après le marché français du secteur et dis-le dans "fnote".
- Tutoie le candidat dans "verdict", "formul" et "budget" (il lit ses propres notes).
- Réponds en français.`;
}

/**
 * Valide la forme de l'analyse renvoyée par le LLM.
 * Retourne null si inexploitable — l'offre sera affichée sans analyse
 * plutôt que de faire échouer la collecte.
 */
export function validerAnalyse(brute) {
  if (!brute || typeof brute !== 'object' || Array.isArray(brute)) return null;
  if (typeof brute.verdict !== 'string' || brute.verdict.trim() === '') return null;

  // UNE PHRASE SEULE VAUT UNE LISTE D'UNE PHRASE.
  //
  // La règle était « un champ mal typé invalide tout ». Elle visait les
  // réponses franchement cassées — et elle jetait aussi l'analyse entière
  // quand le modèle écrivait `"compensable": "Aucun point bloquant."` au lieu
  // d'un tableau d'une ligne. Onze champs justes perdus pour un crochet
  // manquant, et un appel compté dans le quota du jour pour rien : le journal
  // disait « analyse illisible » sur des offres parfaitement analysées.
  // Un nombre ou un objet à la place d'une liste, eux, restent refusés : là,
  // on ne sait pas ce que le modèle a voulu dire.
  const listeDeTextes = (valeur) => {
    if (valeur === undefined || valeur === null) return [];
    if (typeof valeur === 'string') return valeur.trim() ? [valeur.trim()] : [];
    if (!Array.isArray(valeur)) return undefined; // signale un type incorrect
    return valeur.filter(x => typeof x === 'string');
  };

  const champs = ['exige', 'souhaite', 'decoratif', 'prouvable', 'nonprouvable', 'compensable', 'formul', 'budget'];
  const resultat = { verdict: brute.verdict.trim() };

  for (const champ of champs) {
    const valeur = listeDeTextes(brute[champ]);
    if (valeur === undefined) return null; // un champ présent mais mal typé invalide tout
    resultat[champ] = valeur;
  }

  // kw : uniquement les triplets bien formés, les autres lignes sont écartées.
  resultat.kw = Array.isArray(brute.kw)
    ? brute.kw.filter(l => Array.isArray(l) && l.length === 3
        && typeof l[0] === 'string' && typeof l[2] === 'string'
        && VALEURS_KW.has(String(l[1]).toLowerCase()))
    : [];

  resultat.fourchette = typeof brute.fourchette === 'string' ? brute.fourchette : null;
  resultat.fnote = typeof brute.fnote === 'string' ? brute.fnote : null;

  return resultat;
}

/**
 * Pourquoi une réponse a été refusée, en une ligne pour le journal.
 *
 * « Analyse illisible » ne disait pas QUOI : une réponse coupée en plein
 * milieu (limite de longueur), un verdict oublié et un champ mal typé
 * finissaient dans la même phrase. Savoir lequel dit quoi corriger — le
 * prompt, la limite, ou rien du tout. Pure, exportée pour les tests.
 */
export function raisonDuRefus(reponse, brute) {
  const texte = String(reponse ?? '').trim();
  if (!texte) return 'réponse vide';
  if (brute === null || brute === undefined) {
    const fin = texte.slice(-1);
    return fin === '}' || fin === ']' || fin === '`'
      ? `JSON invalide (${texte.length} caractères)`
      : `réponse coupée après ${texte.length} caractères`;
  }
  if (typeof brute !== 'object' || Array.isArray(brute)) return 'un tableau au lieu d\'un objet';
  if (typeof brute.verdict !== 'string' || !brute.verdict.trim()) return 'verdict absent';
  const fautif = ['exige', 'souhaite', 'decoratif', 'prouvable', 'nonprouvable', 'compensable', 'formul', 'budget']
    .find(c => brute[c] !== undefined && brute[c] !== null && typeof brute[c] !== 'string' && !Array.isArray(brute[c]));
  return fautif ? `champ « ${fautif} » mal typé` : 'forme inattendue';
}

/**
 * Analyse une offre. Ne lève JAMAIS d'exception : en cas de problème
 * (quota, panne, réponse illisible) elle renvoie null et la collecte continue.
 * @returns {Promise<object|null>}
 */
export async function analyserOffre(offre, cv) {
  if (!estConfigure()) return null;
  if (!cv || cv.length < 100) {
    console.warn('  ⚠ CV absent ou trop court — analyse ignorée. Lancer : npm run extract-cv');
    return null;
  }

  try {
    const reponse = await demander(construirePrompt(offre, cv), [], { json: true });
    // Aucun modèle n'a répondu : `demander` l'a déjà écrit au journal. Dire en
    // plus « analyse illisible » faisait passer un quota épuisé pour une
    // réponse cassée — deux pannes qui ne se soignent pas pareil.
    if (reponse === null || reponse === undefined) return null;
    const brute = extraireJson(reponse);
    const analyse = validerAnalyse(brute);
    if (!analyse) {
      console.warn(`  ⚠ Analyse illisible pour « ${offre.titre} » — ${raisonDuRefus(reponse, brute)} — offre conservée sans analyse`);
    }
    return analyse;
  } catch (erreur) {
    console.warn(`  ⚠ Analyse impossible pour « ${offre.titre} » : ${erreur.message}`);
    return null;
  }
}
