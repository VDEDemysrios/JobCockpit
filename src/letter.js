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
# TRAVAIL PRÉALABLE, AVANT D'ÉCRIRE

Relis l'annonce et repère, en silence :
- les TROIS exigences que l'employeur met réellement en avant — celles qui
  reviennent, celles qui sont détaillées, pas celles de la liste type ;
- le contexte de l'organisation : ce qu'elle fait, où elle en est, ce que ce
  poste vient résoudre chez elle ;
- son vocabulaire propre (intitulés d'outils, de procédures, de missions).

Chacune de ces trois exigences devra recevoir, dans la lettre, une réponse
argumentée et adossée à une preuve du CV. C'est là que se joue la différence
entre une lettre écrite pour CETTE offre et une lettre passe-partout.

# STRUCTURE IMPOSÉE (7 à 8 paragraphes, 650 à 800 mots)

1. ACCROCHE — pourquoi CETTE organisation et CE poste. Appuie-toi sur un
   élément précis de l'annonce (une mission nommée, un contexte, un outil).
   Interdiction absolue des formules passe-partout du type « votre entreprise
   dynamique », « je suis vivement intéressé », « c'est avec grand intérêt que ».

2. « VOUS » — reformule le besoin réel de l'employeur, avec ses mots. Montre
   que l'annonce a été lue en entier et comprise, y compris ce qu'elle dit
   entre les lignes du poste.

3, 4 et 5. « MOI », UN PARAGRAPHE PAR EXIGENCE — pour chacune des trois
   exigences repérées : rappelle-la brièvement, puis apporte la preuve tirée
   du CV. Chiffre dès que le CV le permet (8 projets, une cinquantaine de
   projets mis en conformité, 40 fiches métiers, 3 dossiers contentieux, une
   vingtaine de notes de veille). Un paragraphe qui n'apporte aucune preuve
   vérifiable ne sert à rien : supprime-le plutôt que de le remplir.

6. POURQUOI MOI ET PAS UN AUTRE — le paragraphe pivot. Le différenciateur
   tient en trois traits : la double compétence droit public + gestion de
   projet, rare sur ce marché ; la spécialisation agrivoltaïque, qui
   représente 90 % de son portefeuille de projets ; la capacité à faire
   dialoguer bureaux d'études, collectivités et riverains autour d'un même
   projet. Développe celui des trois qui parle le plus à cette offre.
   Sois concret, pas incantatoire.

7. LA MOTIVATION, ADOSSÉE AU PARCOURS — en quoi ce poste s'inscrit dans une
   trajectoire cohérente (Master 2 Droit et Gestion des Énergies et du
   Développement Durable → développement de projets EnR → ce poste). Pas un
   intérêt déclaré sans fondement.

8. CLÔTURE — disponibilité, souhait d'entretien, formule de politesse
   française complète.

# LA SPÉCIALISATION AGRIVOLTAÏQUE — ET SA LIMITE EXACTE
90 % du portefeuille du candidat est agrivoltaïque. Fais-le figurer
explicitement dès que l'offre s'y prête — solaire, agrivoltaïsme, foncier
agricole, énergies renouvelables, aménagement rural. Quand l'offre est
étrangère à ce domaine (droit public pur, urbanisme, collectivité), ne le
plaque pas : traduis plutôt ce que cette spécialisation a construit comme
savoir-faire — concertation agricole, montage de dossiers complexes, dialogue
avec des exploitants et des élus.

ATTENTION, c'est l'erreur la plus fréquente et la plus coûteuse :
l'agrivoltaïsme est son **secteur d'exercice**, PAS une compétence
agronomique. Il pilote des projets agrivoltaïques en tant que **juriste et
chef de projet**.

# CE QUE LE CANDIDAT N'EST PAS
Ne lui attribue JAMAIS, sous aucune formulation :
- une expertise **agronomique** — il n'est ni agronome, ni ingénieur agricole,
  ni technicien des cultures ; son M2 est un diplôme de DROIT ;
- une compétence en **ingénierie électrique**, en raccordement réseau, en
  dimensionnement ou en conception technique d'installations ;
- une expérience d'**exploitant agricole**.

Il TRAVAILLE AVEC ces spécialistes : il cadre leurs études, traduit leurs
contraintes, fait dialoguer bureaux d'études, exploitants et élus. C'est cela
qu'il faut écrire — « faire dialoguer », « cadrer », « coordonner »,
« traduire » — jamais « mon expertise agronomique » ni « mes compétences
techniques en photovoltaïque ».

Une compétence inventée ne tient pas dix secondes en entretien, et coûte plus
cher que le poste qu'elle prétend décrocher.

# SI L'OFFRE VIENT DE LA FONCTION PUBLIQUE
Beaucoup de ces annonces sont des offres de la fonction publique (mention d'un
statut, d'une catégorie A ou B, d'un versant État / territorial / hospitalier,
d'une direction ou d'une préfecture). Dans ce cas :
- adopte le registre administratif, plus sobre, sans vocabulaire commercial ;
- adresse-toi à l'entité nommée dans l'annonce, jamais à « votre entreprise » ;
- si l'offre est ouverte aux contractuels, présente-toi comme tel sans t'en
  excuser : le candidat n'est pas fonctionnaire ;
- valorise ce qui compte dans ce cadre : conformité réglementaire, sécurité
  juridique des actes, veille, relation aux collectivités et aux élus.

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
- L'anglais du candidat est PROFESSIONNEL, pas courant : ne le surévalue jamais.
- Longueur : la lettre doit être fournie. En dessous de 650 mots, tu n'as pas
  assez développé les preuves — reprends les paragraphes 3 à 5.
- Vouvoiement, registre professionnel, première personne du singulier.
- Varie les débuts de paragraphe : jamais deux « Je » consécutifs en tête.

# FORMAT DE SORTIE
Uniquement le corps de la lettre, en commençant par « Madame, Monsieur, ».
Pas d'en-tête, pas d'adresse, pas de date, pas d'objet — ils sont ajoutés
automatiquement. Pas de titre de paragraphe, pas de numérotation apparente,
pas de commentaire avant ou après.`;
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
