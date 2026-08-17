// Préparation d'entretien : la simulation, le débriefing, et la fiche.
//
// POURQUOI CE MODULE EXISTE
// -------------------------
// L'application menait jusqu'à la candidature, puis s'arrêtait. Or c'est
// l'entretien qui décide, et c'est le moment où l'on est le plus seul : on
// relit son CV, on se dit que ça ira, et on découvre en séance la question à
// laquelle on n'avait pas pensé.
//
// TROIS CHOSES DISTINCTES, QU'IL NE FAUT PAS MÉLANGER
// ---------------------------------------------------
// 1. LA SIMULATION — un jury pose une question, on répond, il rebondit. Sa
//    valeur tient à une seule chose : qu'il pose les questions qui FÂCHENT,
//    celles qui visent les manques déjà identifiés par l'analyse. Un jury
//    complaisant ne prépare à rien.
//
// 2. LE DÉBRIEFING — ce qui a tenu, ce qui s'est effondré, et quoi faire d'ici
//    l'entretien. Honnête, donc parfois désagréable : une répétition qui
//    flatte coûte le poste.
//
// 3. LA FICHE — ce qu'il faut SAVOIR avant d'y aller, et que le CV n'apprend
//    pas : le métier, l'employeur, le cadre juridique ou technique du poste.
//
// LA RÈGLE QUI PRIME SUR TOUT
// ---------------------------
// Le modèle ne doit JAMAIS inventer une règle, un article, une procédure ou
// un chiffre. Sur un poste juridique — contrôle de légalité, urbanisme,
// marchés publics — une procédure inventée récitée en entretien ne se
// rattrape pas : elle disqualifie devant les seules personnes qui la
// connaissent par cœur. Chaque élément de la fiche est donc soit donné comme
// certain, soit explicitement marqué « à vérifier », avec la source où aller
// voir.

/** Combien d'échanges avant de proposer le débriefing. */
export const QUESTIONS_PAR_SEANCE = 8;

/**
 * Les notions à réviser, en cartes.
 *
 * POURQUOI DES CARTES ET PAS UN COURS
 * -----------------------------------
 * La fiche de révision se lit une fois et ne tient pas : on la parcourt, on
 * se sent prêt, et en séance le mot ne revient pas. Ce qui fait tenir une
 * notion, c'est de tenter de la restituer AVANT de lire la réponse. D'où des
 * cartes, retournées une à une.
 *
 * LE DANGER PROPRE À CE MODULE
 * ----------------------------
 * Apprendre du faux droit avec confiance est pire que ne rien savoir : on ne
 * vérifie pas ce dont on est sûr, et on le récite. Chaque carte porte donc sa
 * SOURCE — l'article, le code, le site officiel — et un drapeau `sur` qui dit
 * si le modèle en répond. Ce qui n'est pas sûr est affiché comme tel, et se
 * vérifie avant d'être appris.
 */
export const TYPES_NOTIONS = {
  jargon: {
    libelle: 'Le jargon',
    aide: 'Les mots que tout le monde emploie sans les expliquer',
    recto: 'le mot ou le sigle, tel qu\'un professionnel le dit',
    verso: 'ce que ça veut dire, en deux phrases, sans jargon non expliqué',
    consigne: `Prends les termes SANS LESQUELS on ne comprend pas une phrase du
métier — ceux qu'un professionnel emploie sans jamais les définir, parce qu'il
suppose qu'on les connaît. Sigles compris.`,
  },
  metier: {
    libelle: 'Le métier',
    aide: 'Ce que la personne fait vraiment, au quotidien',
    recto: 'une question sur le métier réel',
    verso: 'la réponse, concrète, telle qu\'un titulaire du poste la donnerait',
    consigne: `Décris le métier RÉEL, pas la fiche de poste reformulée : à quoi
ressemble une semaine, avec qui on travaille, ce qui prend le plus de temps, ce
qui coince, comment on sait qu'on a bien fait son travail. Ce qu'un candidat ne
peut pas deviner depuis l'annonce.`,
  },
  situation: {
    libelle: 'Mises en situation',
    aide: 'Un cas concret, et ce qu\'il faut faire',
    recto: 'une situation concrète que le poste rencontre vraiment, en deux ou trois phrases',
    verso: 'ce qu\'il faut faire, dans quel ordre, avec les délais si applicable',
    consigne: `Écris des cas que ce poste rencontre pour de vrai, du plus
courant au plus délicat. Ce sont les questions que les jurys adorent : « un
dossier arrive dans tel état, que faites-vous ? ». La réponse doit être une
MARCHE À SUIVRE, avec l'ordre des étapes et les délais quand il y en a.`,
  },
  consequence: {
    libelle: 'Ce que ça induit',
    aide: 'Les conséquences d\'une décision, ou d\'une absence de décision',
    recto: 'une décision, un choix ou une omission propre à ce poste',
    verso: 'ce qu\'elle entraîne — juridiquement, pour l\'usager, pour le service',
    consigne: `Montre les CONSÉQUENCES. Que se passe-t-il si on laisse passer un
délai, si on valide un acte irrégulier, si on refuse à tort ? Qui en pâtit, qui
est engagé, qu'est-ce qui devient contestable et par qui. C'est ce qui
distingue quelqu'un qui a compris l'enjeu de quelqu'un qui récite une
procédure.`,
  },
  texte: {
    libelle: 'Les textes',
    aide: 'Les références à connaître, et ce qu\'elles disent',
    recto: 'la référence exacte — code, article, loi, décret',
    verso: 'ce qu\'il dit, en une ou deux phrases, et ce qu\'il change en pratique',
    consigne: `Les textes qu'on cite dans ce métier. Pour chacun : la référence
exacte en recto, et en verso ce qu'il dit ET ce qu'il change concrètement.
C'est ici que l'exactitude compte le plus : un numéro d'article faux cité
devant un jury juridique est pire que de dire qu'on ne le connaît pas.`,
  },
};

export function promptNotions(offre, analyse, dejaVues = [], type = 'jargon') {
  const t = TYPES_NOTIONS[type] ?? TYPES_NOTIONS.jargon;
  const eviter = dejaVues.length
    ? `\n\nNE REPRENDS PAS ces cartes, déjà produites :\n${dejaVues.map(x => `- ${x}`).join('\n')}`
    : '';

  return `Tu prépares des cartes de révision pour un candidat convoqué en
entretien sur le poste ci-dessous. Il part de ZÉRO sur le domaine : il faut
lui donner le socle qu'un professionnel du métier tient pour évident.

# LE TYPE DE CARTES DEMANDÉ : ${t.libelle.toUpperCase()}
${t.consigne}

# LE POSTE
Intitulé : ${offre.titre ?? ''}
Employeur : ${offre.entreprise || '(non précisé)'}

Annonce :
"""
${String(offre.description ?? '').slice(0, 5000)}
"""
${(analyse?.exige?.length ? `\nCE QUE L'ANNONCE EXIGE :\n${analyse.exige.map(x => `- ${x}`).join('\n')}` : '')}${eviter}

# CE QU'IL FAUT PRODUIRE
Un tableau JSON de 10 cartes, et RIEN d'autre — pas de texte avant ou après.

Chaque carte :
{
  "terme": "${t.recto}",
  "definition": "${t.verso}",
  "pourquoi": "une phrase : pourquoi ça compte POUR CE POSTE précisément",
  "source": "où vérifier — article de code, nom du texte, ou site officiel",
  "sur": true ou false
}

Comment choisir les dix :
- Va du général au particulier : d'abord ce qui cadre, ensuite le détail.
- Chaque carte doit être RÉELLEMENT utile en entretien pour ce poste. Pas de
  culture générale administrative.
- Le recto doit pouvoir être lu SEUL, et donner envie de chercher la réponse
  avant de retourner la carte.

LE CHAMP "sur" EST LE PLUS IMPORTANT :
- true seulement si tu réponds de l'exactitude de la définition ET de la
  source, telles qu'un professionnel du domaine les validerait.
- false dès qu'il y a le moindre doute — un délai, un seuil, un numéro
  d'article, une compétence d'organisme, une réforme récente.

Un candidat qui récite une procédure fausse devant des gens dont c'est le
métier ne se rattrape pas. Mieux vaut dix cartes dont trois marquées à
vérifier, que dix cartes fausses et sûres d'elles.`;
}

/** Le cadre commun : qui est le candidat, quel poste, ce que dit l'analyse. */
function contexte(offre, analyse, cv) {
  const a = analyse ?? {};
  const bloc = (titre, liste) => (liste?.length
    ? `\n${titre} :\n` + liste.map(x => `- ${x}`).join('\n')
    : '');

  return `# LE POSTE
Intitulé : ${offre.titre ?? '(inconnu)'}
Employeur : ${offre.entreprise || '(non précisé)'}
Lieu : ${offre.ville || '(non précisé)'}
Contrat : ${offre.contrat || '(non précisé)'}

Annonce intégrale :
"""
${String(offre.description ?? '').slice(0, 6000)}
"""
${bloc('CE QUE L\'ANNONCE EXIGE', a.exige)}${bloc('CE QUE LE CANDIDAT PEUT PROUVER AVEC SON CV', a.prouvable)}${bloc('CE QU\'IL NE PEUT PAS PROUVER — LES ANGLES D\'ATTAQUE DU JURY', a.nonprouvable)}${bloc('CE QUI EST CONTOURNABLE', a.compensable)}

# LE CV DU CANDIDAT
"""
${String(cv ?? '').slice(0, 5000)}
"""`;
}

/** L'historique, mis en forme pour être relu par le modèle. */
function transcription(echanges) {
  if (!echanges?.length) return '(la séance commence)';
  return echanges
    .map(e => (e.role === 'jury' ? `JURY : ${e.texte}` : `CANDIDAT : ${e.texte}`))
    .join('\n\n');
}

/**
 * La question suivante du jury.
 *
 * UNE SEULE QUESTION À LA FOIS. Un jury qui en enchaîne trois laisse choisir
 * celle à laquelle on répond — c'est-à-dire la plus facile. En entretien, on
 * n'a pas ce choix.
 */
export function promptQuestion(offre, analyse, cv, echanges) {
  const numero = (echanges ?? []).filter(e => e.role === 'jury').length + 1;

  return `Tu conduis un entretien de recrutement RÉEL. Tu es le jury, pas un
assistant : tu ne commentes pas, tu ne félicites pas, tu ne donnes aucun
conseil pendant la séance. Tu poses des questions.

${contexte(offre, analyse, cv)}

# LA SÉANCE JUSQU'ICI
${transcription(echanges)}

# TA TÂCHE
Pose la question ${numero} sur ${QUESTIONS_PAR_SEANCE}. UNE SEULE question.

Comment la choisir :
- Les premières portent sur le parcours et la motivation, telles que les
  poserait vraiment un recruteur de ce secteur.
- Ensuite, va CHERCHER LES MANQUES listés plus haut. Ce sont eux qui feront
  échouer l'entretien réel ; les éviter ici serait rendre la répétition
  inutile.
- Si la réponse précédente est vague, creuse-la au lieu de passer à autre
  chose. « Vous dites avoir piloté ce projet — qui décidait, concrètement ? »
  Un jury relance ; il ne coche pas des cases.
- Si l'annonce vient de la fonction publique, adopte le registre d'un jury
  administratif : sobre, précis, attaché aux procédures et au cadre statutaire.
- Adapte-toi au poste. Un poste juridique appelle des mises en situation
  concrètes (« un acte vous paraît illégal, que faites-vous, dans quel
  délai ? »), pas des généralités.

Écris UNIQUEMENT la question, telle que le jury la prononcerait. Pas de
préambule, pas de numérotation, pas de guillemets.`;
}

/**
 * Le débriefing, à la fin de la séance.
 *
 * Il doit être utilisable le soir même : ce qui a tenu, ce qui s'est
 * effondré, et quoi réviser d'ici l'entretien.
 */
export function promptDebrief(offre, analyse, cv, echanges) {
  return `Tu viens de conduire l'entretien blanc ci-dessous. Rédige le
débriefing que tu donnerais au candidat, en français.

${contexte(offre, analyse, cv)}

# LA SÉANCE
${transcription(echanges)}

# CE QU'IL FAUT ÉCRIRE
Sois HONNÊTE, y compris quand c'est désagréable. Une répétition qui flatte
coûte le poste : c'est le seul moment où une critique ne coûte rien.

Structure, avec ces titres exacts en markdown :

## Ce qui a tenu
Les réponses solides, et POURQUOI elles l'étaient — pour que le candidat
puisse les refaire. Cite ses formulations. S'il n'y en a aucune, dis-le.

## Ce qui s'est effondré
Les réponses vagues, les affirmations non étayées, les questions esquivées.
Cite la question et ce qui manquait. Pour chacune, écris la réponse que tu
aurais voulu entendre, appuyée sur ce que le CV démontre réellement — jamais
sur une expérience inventée.

## Les trois questions à retravailler en priorité
Celles qui reviendront certainement, et qui ne sont pas prêtes.

## D'ici l'entretien
Trois actions concrètes, faisables en quelques jours. Pas « approfondir le
droit de l'urbanisme » : « relire les articles L.2131-1 à L.2131-6 du CGCT et
savoir dire en deux phrases ce qu'est un déféré préfectoral ».

RÈGLES :
- N'invente aucune expérience, aucun chiffre, aucun diplôme que le CV ne porte pas.
- Si tu cites une règle, un article ou un délai dont tu n'es pas certain,
  écris-le suivi de « (à vérifier) ». Sur un poste juridique, une procédure
  inventée et récitée en entretien disqualifie devant les seules personnes
  qui la connaissent par cœur.`;
}

/**
 * La fiche de connaissances : ce qu'il faut savoir, et que le CV n'apprend pas.
 *
 * C'est la partie la plus exposée à l'invention, et la plus coûteuse si elle
 * se trompe. D'où la séparation explicite entre ce qui est sûr et ce qui doit
 * être vérifié à la source.
 */
export function promptFiche(offre, analyse, cv) {
  return `Prépare la fiche de révision d'un candidat convoqué en entretien
pour le poste ci-dessous. En français.

${contexte(offre, analyse, cv)}

# CE QU'IL FAUT ÉCRIRE
Ce que le candidat doit SAVOIR avant d'entrer, et que son CV ne lui apprend
pas. Structure, avec ces titres exacts en markdown :

## Le métier, en pratique
Ce que fait vraiment quelqu'un à ce poste, une journée type, ce qui l'occupe
le plus. Pas la fiche de poste reformulée : ce qu'elle ne dit pas.

## L'employeur et son cadre
Qui il est, de qui il dépend, dans quel ensemble il s'inscrit. Ce qu'un
candidat sérieux est censé connaître de son organisation.

## Les notions à maîtriser
Le vocabulaire, les procédures, les délais, les textes de référence propres à
ce poste. Pour chacun : ce que c'est, en deux phrases, et pourquoi ça compte
ici. C'est la section qui décide de l'entretien.

## Les questions à poser au jury
Trois questions qui montrent qu'on a compris le poste. Pas « quelles sont les
perspectives d'évolution ».

## Les pièges de cet entretien
Ce sur quoi ce candidat précis va être attendu, compte tenu de ses manques
listés plus haut.

RÈGLES ABSOLUES :
- Distingue SYSTÉMATIQUEMENT ce qui est certain de ce qui ne l'est pas. Tout
  élément dont tu n'es pas sûr — un article, un délai, un seuil, un chiffre,
  une compétence d'organisme — s'écrit suivi de « (à vérifier : <où aller
  voir>) ».
- N'invente jamais une procédure ni un texte pour compléter une section. Une
  section courte et sûre vaut mieux qu'une section fournie et fausse : ici,
  l'erreur se récite en entretien devant des gens dont c'est le métier.
- Reste sur CE poste et CE cadre. Pas de généralités sur la recherche d'emploi.`;
}
