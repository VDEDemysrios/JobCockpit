// CV adapté à une offre, et écart honnête avec ce qu'elle demande.
//
// L'application analysait déjà l'offre au regard du CV (`analyze.js`) : ce que
// l'employeur exige, ce que le candidat peut prouver, ce qu'il ne peut pas.
// Elle rédigeait la lettre. Restait le CV lui-même — envoyé tel quel, le même
// pour tous les postes.
//
// Ce module fait deux choses :
//   · L'ÉCART. Ce que l'offre exige et que le CV ne montre pas, plus les
//     mots-clés de l'offre absents du CV. Ce n'est pas un nouvel appel au
//     modèle : c'est déjà dans l'analyse, on le met en avant. Savoir ce qui
//     manque avant d'envoyer, c'est pouvoir le combler — ou l'assumer.
//   · LE CV ADAPTÉ. Une accroche et des points RÉORDONNÉS pour CETTE offre,
//     tirés du CV réel. On réordonne et on reformule ce qui matche ; on
//     n'invente rien. C'est ce qui fait passer un dossier de « correct » à
//     « taillé pour le poste ».
//
// La règle est la même que partout : rien qui ne soit dans le CV. Un CV adapté
// qui invente une expérience se démonte au premier entretien.
import { demander, estConfigure, extraireJson } from './gemini.js';

/**
 * L'ÉCART, tiré de l'analyse existante — sans nouvel appel au modèle.
 *
 * Deux sources : ce que l'offre EXIGE et que le candidat ne peut PAS prouver,
 * et les mots-clés de l'offre marqués absents du CV. On dédoublonne, on ignore
 * les mots-clés jugés « partiels » (à moitié couverts, pas vraiment un
 * manque).
 */
export function calculerEcart(analyse) {
  if (!analyse) return { manques: [], motsCles: [] };
  const nonprouvable = new Set((analyse.nonprouvable ?? []).map(x => x.trim()).filter(Boolean));
  const motsCles = (analyse.kw ?? [])
    .filter(k => String(k[1]).toLowerCase() === 'non')
    .map(k => k[0])
    .filter(Boolean);
  return { manques: [...nonprouvable], motsCles };
}

export function construirePromptCvAdapte({ offre, analyse, cv }) {
  const liste = (v) => (v ?? []).map(x => `  - ${x}`).join('\n') || '  —';
  const rappel = analyse ? `
# CE QUE L'ANALYSE A DÉJÀ ÉTABLI
Ce que l'employeur EXIGE :
${liste(analyse.exige)}
Ce que le candidat peut PROUVER avec son CV :
${liste(analyse.prouvable)}
` : '';

  return `Tu adaptes un CV existant à UNE offre précise, en français.

# LE CV DU CANDIDAT (source unique — rien n'existe en dehors)
${cv}

# L'OFFRE
Poste : ${offre.titre ?? '—'}
Entreprise : ${offre.entreprise || 'non précisée'}
Ville : ${offre.ville || '—'}

Description :
${offre.description ?? ''}
${rappel}
# TA MISSION
Produire une version du CV TAILLÉE pour cette offre. Tu ne récris pas tout le
CV : tu mets en avant ce qui compte pour CE poste, dans l'ordre où cet
employeur veut le lire.

Réponds UNIQUEMENT par un objet JSON, sans texte avant ni après :
{
  "accroche": "2 à 3 phrases de tête de CV, positionnant le candidat pour CE poste précis, à partir de son expérience réelle",
  "points": ["4 à 6 lignes d'expérience/compétence tirées du CV, réordonnées et reformulées pour matcher l'offre — la plus pertinente d'abord"],
  "forces": ["3 à 5 atouts courts à faire ressortir, mots-clés de l'offre que le candidat peut RÉELLEMENT revendiquer"]
}

# RÈGLES IMPÉRATIVES
- N'utilise QUE ce qui figure dans le CV ci-dessus. Aucune expérience,
  aucun diplôme, aucun chiffre, aucun employeur inventé ou gonflé.
- Réordonner et reformuler est permis ; fabriquer est interdit. Un CV adapté
  qui invente se démonte au premier entretien.
- Chaque "point" doit renvoyer à un élément réel du CV.
- "forces" ne contient que des mots-clés que le candidat peut assumer :
  s'ils ne sont pas dans le CV, ils ne vont pas là.
- Concis, orienté résultat, sans emphase creuse. Réponds en français.`;
}

/**
 * Adapte le CV à l'offre. Ne lève jamais : renvoie `{ accroche, points,
 * forces }` ou null.
 */
export async function genererCvAdapte({ offre, analyse, cv }) {
  if (!estConfigure()) return null;
  if (!cv || cv.length < 100) return null;
  try {
    const data = extraireJson(await demander(construirePromptCvAdapte({ offre, analyse, cv })));
    if (!data || typeof data.accroche !== 'string') return null;
    const textes = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : []);
    const points = textes(data.points);
    if (!points.length) return null;
    return {
      accroche: data.accroche.trim(),
      points,
      forces: textes(data.forces),
    };
  } catch (erreur) {
    console.warn(`  ⚠ CV adapté impossible pour « ${offre.titre} » : ${erreur.message}`);
    return null;
  }
}
