// Génération de lettres de motivation.
//
// Structure imposée : la lettre française classique « vous – moi – nous »,
// avec un paragraphe pivot « pourquoi moi et pas un autre ».
import { demander, estConfigure } from './gemini.js';

/** Construit le prompt de rédaction. */
export function construirePrompt(offre, analyse, cv) {
  const rappelAnalyse = analyse ? `
# ANALYSE DÉJÀ RÉALISÉE DE CETTE OFFRE
Ce que le candidat peut prouver : ${(analyse.prouvable ?? []).join(' ; ') || '—'}
Ce qu'il ne peut pas prouver : ${(analyse.nonprouvable ?? []).join(' ; ') || '—'}
Ce qui est contournable : ${(analyse.compensable ?? []).join(' ; ') || '—'}
Mots-clés à replacer : ${(analyse.kw ?? []).map(k => k[0]).join(', ') || '—'}
` : '';

  return `Tu rédiges une lettre de motivation en français, pour une candidature réelle.

# CV DU CANDIDAT
${cv}

# OFFRE VISÉE
Poste : ${offre.titre}
Entreprise : ${offre.entreprise || 'non précisée'}
Ville : ${offre.ville || 'non précisée'}

Description de l'offre :
${offre.description || '(description non disponible)'}
${rappelAnalyse}
# STRUCTURE IMPOSÉE (5 à 6 paragraphes, 350 à 400 mots)

1. ACCROCHE — pourquoi CETTE entreprise et CE poste. Cite un élément concret
   de l'offre. Interdiction absolue des formules passe-partout du type
   « votre entreprise dynamique », « je suis vivement intéressé »,
   « c'est avec grand intérêt que ».

2. « VOUS » — reformule le besoin réel de l'employeur à partir des exigences
   de l'annonce. Montre que l'offre a été lue attentivement.

3. « MOI » — les preuves tirées du CV qui répondent point par point à ces
   exigences. Chiffre dès que le CV le permet.

4. POURQUOI MOI ET PAS UN AUTRE — le paragraphe pivot. Le différenciateur :
   la double compétence droit + gestion de projet, la spécialisation
   agrivoltaïque, la capacité à faire dialoguer bureaux d'études,
   collectivités et riverains. Sois concret, pas incantatoire.

5. LA MOTIVATION, ADOSSÉE AU PARCOURS — en quoi ce poste s'inscrit dans une
   trajectoire cohérente (Master 2 Droit et Gestion des Énergies →
   développement EnR → ce poste). Pas un intérêt déclaré sans fondement.

6. CLÔTURE — disponibilité, souhait d'entretien, formule de politesse
   française complète.

# RÈGLES IMPÉRATIVES
- Chaque affirmation doit être adossée à un fait présent dans le CV ci-dessus.
- N'INVENTE JAMAIS une expérience, un chiffre, un diplôme, un employeur, une
  date. C'est une candidature réelle : une invention se retournerait contre
  le candidat en entretien.
- Reprends le vocabulaire de l'offre (les logiciels de tri lisent ces mots-clés),
  sans recopier ses phrases.
- Si un point faible a été identifié comme contournable, aborde-le par le
  contournement plutôt que par le silence. N'invente pas de compétence pour
  le masquer.
- Vouvoiement, registre professionnel, première personne du singulier.

# FORMAT DE SORTIE
Uniquement le corps de la lettre, en commençant par « Madame, Monsieur, ».
Pas d'en-tête, pas d'adresse, pas de date, pas d'objet — ils sont ajoutés
automatiquement. Pas de commentaire avant ou après.`;
}

/**
 * Génère une lettre. Ne lève jamais d'exception : renvoie null en cas
 * d'échec, et l'interface affiche un message plutôt que de casser.
 * @returns {Promise<string|null>}
 */
export async function genererLettre(offre, analyse, cv) {
  if (!estConfigure()) return null;
  if (!cv || cv.length < 100) return null;

  try {
    const texte = await demander(construirePrompt(offre, analyse, cv));
    if (!texte) return null;

    // Le modèle encadre parfois la lettre dans un bloc de code markdown.
    const propre = texte.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/, '').trim();
    return propre.length > 200 ? propre : null;
  } catch (erreur) {
    console.warn(`  ⚠ Lettre impossible pour « ${offre.titre} » : ${erreur.message}`);
    return null;
  }
}

/**
 * Coordonnées du candidat pour l'en-tête du document Word.
 *
 * La source de vérité est `profile.json` : le nom n'est PAS deviné dans le CV.
 * L'ordre d'extraction du texte d'un .docx est imprévisible — la première
 * version de cette fonction avait retenu « Projets agrivoltaïques » comme nom,
 * parce que mammoth livre les zones de texte dans un ordre arbitraire.
 *
 * L'e-mail et le téléphone, eux, ont un format reconnaissable : on accepte de
 * les repêcher dans le CV si profile.json ne les précise pas.
 *
 * @param {string} cv        texte du CV
 * @param {object} candidat  bloc `candidat` de profile.json
 */
export function extraireCoordonnees(cv, candidat = {}) {
  const texte = cv ?? '';

  return {
    nom: candidat.nom || '',
    email: candidat.email || texte.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] || '',
    tel: candidat.telephone || texte.match(/(?:\+33|0)\s?[1-9](?:[\s.-]?\d{2}){4}/)?.[0] || '',
    ville: candidat.ville || '',
  };
}
