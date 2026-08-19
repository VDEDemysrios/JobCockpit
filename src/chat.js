// Le compagnon de la vue « Chill » : on discute, de tout, y compris du reste.
//
// POURQUOI UN CHATBOT DANS UN OUTIL DE RECHERCHE D'EMPLOI
// -------------------------------------------------------
// Chercher un emploi est long et solitaire. On ouvre l'application, on regarde
// deux cents lignes, on referme. Le reste de l'outil pousse à agir — cette
// vue-ci ne pousse à rien : on y parle, et si la conversation dérive sur les
// offres, il sait de quoi il s'agit.
//
// CE QUI LE DISTINGUE DU JURY D'ENTRETIEN
// ---------------------------------------
// Le jury de `entretien.js` est là pour mettre en difficulté. Celui-ci fait
// l'inverse : il écoute, il relance, et il ne transforme pas une remarque en
// plan d'action. Confondre les deux registres donnerait un coach qui ramène
// tout à la candidature — exactement ce qu'on fuit en ouvrant cette vue.
//
// CE QU'IL SAIT
// -------------
// Un résumé de l'état réel : combien d'offres, combien de candidatures, la
// prochaine échéance. Assez pour répondre « il te reste 9 jours » sans qu'on
// ait à le lui dire, jamais assez pour lui faire réciter la base.

/** Longueur d'historique transmise. Au-delà, on paie des jetons pour du vieux. */
const NL = '\n';

export const TOURS_MAX = 24;

/**
 * Le contexte : ce que le compagnon sait de la situation.
 *
 * VOLONTAIREMENT MAIGRE. Lui verser deux cents offres coûterait cher à chaque
 * message et le ferait répondre en catalogue. On lui donne des ORDRES DE
 * GRANDEUR, plus le détail de ce qui a une échéance — le reste, il peut le
 * demander.
 */
export function resumeEtat({ offres = [], candidatures = 0, entretiens = [] } = {}) {
  const parGroupe = offres.reduce((a, o) => {
    a[o.groupe] = (a[o.groupe] ?? 0) + 1;
    return a;
  }, {});

  const lignes = [
    `- ${offres.length} offres en base (${parGroupe[1] ?? 0} prioritaires, `
      + `${parGroupe[2] ?? 0} possibles)`,
    `- ${candidatures} candidature(s) envoyée(s)`,
  ];

  for (const e of entretiens) {
    lignes.push(`- ENTRETIEN : « ${e.titre} »${e.entreprise ? ` chez ${e.entreprise}` : ''}`
      + (e.jours !== null ? ` dans ${e.jours} jour(s)` : ' (date non renseignée)'));
  }

  return lignes.join('\n');
}

/**
 * Le prompt d'un tour de conversation.
 *
 * L'historique repart en entier à chaque appel : `demander()` ne tient pas de
 * fil. C'est plus coûteux en jetons, mais c'est ce qui permet de revenir sur
 * ce qui a été dit trois messages plus tôt — sans quoi ce n'est plus une
 * conversation, juste une suite de réponses.
 */
/**
 * Le prompt du compagnon.
 *
 * @param {object} [o]
 * @param {string} [o.candidat]   son prénom, pour qu'il ne parle pas à « LUI »
 * @param {string} [o.pieces]     ce qu'il a sous les yeux, en clair : « une image »
 * @param {Array}  [o.documents]  le texte extrait des documents joints
 */
export function promptChat(messages, contexte, { candidat, pieces, documents } = {}) {
  const fil = (messages ?? []).slice(-TOURS_MAX)
    .map(m => (m.role === 'moi' ? `${candidat || 'LUI'} : ${m.texte}` : `TOI : ${m.texte}`))
    .join('\n\n');
  // CE QU'IL A SOUS LES YEUX. Sans cette annonce, le modele recoit bien les
  // donnees mais ne sait pas qu'on lui parle d'ELLES : il decrit poliment une
  // capture au lieu de repondre a la question posee dessus.
  const notePieces = pieces
    ? `

# TU AS SOUS LES YEUX : ${pieces.toUpperCase()}
Ce sont des pieces que ton interlocuteur t'a envoyees — souvent une capture
d'ecran, une annonce, un document. Regarde-les et reponds a SON propos, pas
en les decrivant ligne par ligne.

Elles peuvent venir d'un tour PRECEDENT : s'il dit « et la date ? » sans rien
joindre, c'est de la derniere piece qu'il parle. Ne reponds jamais que tu n'y
as pas acces — tu les as.`
    : '';

  // Le texte extrait des documents de bureau. Word et consorts ne sont pas
  // lus nativement par le modèle : ce sont des archives ZIP. On les convertit
  // côté serveur, et on le dit — la mise en page, elle, est perdue.
  const noteDocuments = documents?.length
    ? NL + NL + '# LE TEXTE DES DOCUMENTS JOINTS' + NL
      + documents.map(d => '--- ' + d.nom + ' ---' + NL + d.contenu).join(NL + NL)
    : '';
  return `Tu discutes avec ${candidat || 'quelqu\'un'}, qui cherche un emploi et
utilise Job Cockpit — un tableau de bord qui collecte des offres, les classe,
les analyse au regard de son CV et rédige des lettres.

# CE QUE TU SAIS DE SA SITUATION
${contexte || '(rien de particulier)'}${notePieces}${noteDocuments}

# LE TON
Tu es un interlocuteur, pas un assistant. Concrètement :

- Tu parles de CE DONT IL PARLE. S'il parle d'un film, tu parles du film. Tu
  ne ramènes pas la conversation à sa recherche d'emploi — c'est précisément
  ce qu'il fuit en venant ici.
- Tu RELANCES : une question, une remarque, un désaccord. Une réponse qui se
  termine sur elle-même arrête la conversation.
- Tu as le droit d'avoir un avis et de le dire. Un interlocuteur qui approuve
  tout n'est pas de compagnie, c'est un miroir.
- Court. Deux ou trois phrases le plus souvent. On discute, on ne lit pas.
- Pas de listes à puces, pas de titres, pas de gras : on ne parle pas en
  rapport. Du texte, comme un message.
- Pas de « en tant qu'IA », pas de rappel de ce que tu es.

# QUAND ÇA TOUCHE À SON TRAVAIL
S'il aborde ses offres, ses candidatures, son entretien ou l'application, tu
réponds pour de vrai, avec ce que tu sais ci-dessus. Mais :
- tu ne le pousses PAS à candidater s'il ne l'a pas demandé ;
- tu ne transformes pas une remarque en plan d'action ;
- s'il dit que c'est difficile, tu l'écoutes avant de proposer quoi que ce soit.
Il a déjà un tableau de bord qui lui rappelle ce qu'il doit faire. Ce n'est
pas ton rôle.

# CE QUE TU N'INVENTES JAMAIS
Une offre, une entreprise, une date, un chiffre qui ne serait pas ci-dessus.
Si tu ne sais pas, tu le dis et tu demandes.

# LA CONVERSATION
${fil || '(elle commence)'}

Réponds, en français, sans préfixe ni nom de rôle.`;
}
