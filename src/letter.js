// Génération de lettres de motivation.
//
// Structure imposée : la lettre française classique « vous – moi – nous »,
// avec un paragraphe pivot « pourquoi moi et pas un autre ».
import { demander, estConfigure } from './gemini.js';

/** Construit le prompt de rédaction. */
export function construirePrompt(offre, analyse, cv) {
  // L'analyse a déjà fait le travail de lecture : ce que l'employeur EXIGE,
  // ce qu'il souhaite, ce qui n'est que décoratif, et où le candidat tient ou
  // ne tient pas. La lui redonner en entier évite au modèle de refaire ce
  // tri — mal, et différemment de ce que la fiche affiche à l'écran.
  //
  // Ne transmettre que « prouvable / non prouvable » revenait à jeter la
  // hiérarchie des exigences, qui est précisément ce sur quoi les trois
  // paragraphes centraux doivent s'appuyer.
  const liste = (v) => (v ?? []).join(' ; ') || '—';
  const rappelAnalyse = analyse ? `
# ANALYSE DÉJÀ RÉALISÉE DE CETTE OFFRE — utilise-la, ne la refais pas

Ce que l'employeur EXIGE : ${liste(analyse.exige)}
Ce qu'il souhaite sans l'exiger : ${liste(analyse.souhaite)}
Ce qui n'est que décoratif (ne pas y consacrer de paragraphe) : ${liste(analyse.decoratif)}

Ce que le candidat peut PROUVER : ${liste(analyse.prouvable)}
Ce qu'il ne peut PAS prouver : ${liste(analyse.nonprouvable)}
Ce qui est CONTOURNABLE, et comment : ${liste(analyse.compensable)}

Mots-clés de l'offre absents du CV, à replacer avec prudence :
${(analyse.kw ?? []).map(k => `  - ${k[0]} (revendicable : ${k[1]}) — ${k[2]}`).join('\n') || '  —'}
${analyse.verdict ? `\nVerdict porté sur cette candidature : ${analyse.verdict}` : ''}

CE QUE TU EN FAIS :
- les TROIS paragraphes centraux traitent les exigences de la liste « EXIGE »,
  en priorité celles qui figurent aussi dans « PROUVABLE » ;
- ce qui est « NON PROUVABLE » ne doit JAMAIS être affirmé — ni contourné par
  une formule vague qui laisserait croire le contraire ;
- ce qui est « CONTOURNABLE » s'aborde par le contournement indiqué, sans
  s'excuser ni inventer ;
- ce qui est « décoratif » ne mérite pas une ligne : l'espace est compté.
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
   du CV. Chiffre dès que le CV le permet — un nombre de projets, de dossiers,
   de personnes encadrées, un budget, une durée. N'invente aucun chiffre qui
   n'y figure pas. Un paragraphe qui n'apporte aucune preuve vérifiable ne
   sert à rien : supprime-le plutôt que de le remplir.

6. POURQUOI MOI ET PAS UN AUTRE — le paragraphe pivot. Repère dans le CV
   DEUX OU TROIS traits qui distinguent réellement ce candidat des autres
   postulants : une combinaison de compétences rare, un secteur où il a
   accumulé plus d'expérience qu'un profil moyen, une capacité charnière
   entre plusieurs métiers. Développe celui qui parle le plus à cette offre.
   Sois concret, pas incantatoire. Si le CV ne fournit aucun trait saillant,
   ne fabrique pas : appuie-toi sur ce qu'il démontre vraiment.

7. LA MOTIVATION, ADOSSÉE AU PARCOURS — en quoi ce poste s'inscrit dans la
   trajectoire que dessine le CV : formation, puis expériences, puis ce
   poste. Pas un intérêt déclaré sans fondement.

8. CLÔTURE — disponibilité, souhait d'entretien, formule de politesse
   française complète.

# LE SECTEUR D'EXERCICE N'EST PAS UNE COMPÉTENCE TECHNIQUE
C'est l'erreur la plus fréquente et la plus coûteuse.

Travailler DANS un domaine ne rend expert d'AUCUNE de ses disciplines
techniques. Un juriste qui monte des projets agrivoltaïques n'est pas
agronome. Un chef de projet en santé n'est pas médecin. Un chargé de mission
en cybersécurité n'est pas ingénieur réseau.

Repère donc dans le CV la frontière exacte entre le SECTEUR où le candidat
exerce et le MÉTIER qu'il y exerce, et n'écris jamais rien qui la franchisse.
Ce qu'il faut écrire à la place, c'est ce que ce métier fait avec les
spécialistes : « cadrer », « coordonner », « traduire », « faire dialoguer ».

Fais figurer le secteur explicitement dès que l'offre s'y prête. Quand
l'offre en est étrangère, ne le plaque pas : traduis plutôt ce que ce secteur
a construit comme savoir-faire transposable.

# CE QUE LE CANDIDAT N'EST PAS
Le CV ci-dessus est la SEULE source de ce que le candidat sait faire.

Ne lui attribue jamais un diplôme, une certification, une spécialité
technique ou une expérience qui n'y figure pas — même si l'offre les réclame,
même si cela rendrait la lettre plus convaincante, même sous une formulation
prudente. Une lettre qui promet moins mais tient est meilleure qu'une lettre
qui promet ce qui s'effondrera.

Une compétence inventée ne tient pas dix secondes en entretien, et coûte plus
cher que le poste qu'elle prétend décrocher.

# SI L'OFFRE VIENT DE LA FONCTION PUBLIQUE
Beaucoup de ces annonces sont des offres de la fonction publique (mention d'un
statut, d'une catégorie A ou B, d'un versant État / territorial / hospitalier,
d'une direction ou d'une préfecture). Dans ce cas :
- adopte le registre administratif, plus sobre, sans vocabulaire commercial ;
- adresse-toi à l'entité nommée dans l'annonce, jamais à « votre entreprise » ;
- si l'offre est ouverte aux contractuels et que le CV ne mentionne aucun
  statut de fonctionnaire, présente-toi comme contractuel sans t'en excuser ;
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
- Les niveaux de langue se recopient du CV À LA LETTRE. « Professionnel » ne
  devient jamais « courant », ni « courant » « bilingue » : c'est la
  surévaluation la plus facile à vérifier, et la première testée en entretien.
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
