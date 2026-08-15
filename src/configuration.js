// Premier lancement : transformer quelques réponses en profil utilisable.
//
// LE VRAI OBSTACLE N'ÉTAIT PAS L'INSTALLATION.
// Cloner le dépôt et lancer une commande, beaucoup savent faire. Éditer à la
// main un `profile.json` de 250 lignes contenant des expressions régulières
// appliquées à du texte normalisé — personne, sauf celui qui l'a écrit.
//
// Ce module ne demande donc que ce qu'on ne peut pas deviner : qui tu es, ce
// que tu cherches, et où. Tout le reste est DÉRIVÉ ou repose sur des valeurs
// mesurées sur des données réelles. Un profil de départ imparfait mais
// cohérent vaut mieux qu'un formulaire de trente champs qu'on abandonne.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { normaliser } from './hash.js';
import { construireVille, VILLES_MAX, departementDuCode } from './villes.js';

/** Seuils éprouvés sur une base réelle. Voir profile.example.json. */
const SEUILS = { prioritaire: 6, possible: 3, aVerifier: 3, descriptionMiniCaracteres: 200 };

/**
 * Motifs de titre à écarter quand on cherche un poste établi.
 *
 * Ils valent pour presque tout le monde, et c'est pourquoi ils sont proposés
 * plutôt que demandés : une question de plus dans un assistant, c'est une
 * personne de moins qui va au bout.
 */
const HORS_TRAJECTOIRE = [
  { motif: 'alternance|alternant|apprenti|apprentissage|contrat de professionnalisation',
    note: 'alternance' },
  { motif: '\\bstage\\b|\\bstagiaire\\b', note: 'stage' },
  { motif: '\\binterim', note: 'intérim' },
];

/** Une offre est-elle exploitable ? Sert à décider d'afficher l'assistant. */
export function estConfigure(profil) {
  if (!profil || typeof profil !== 'object') return false;
  const intitules = Array.isArray(profil.intitules) ? profil.intitules : [];
  const villes = Array.isArray(profil.villesPrioritaires) ? profil.villesPrioritaires : [];
  // Le fichier d'exemple est syntaxiquement valide mais ne cherche rien : ses
  // intitulés sont des libellés à remplacer. Le prendre pour une
  // configuration ferait lancer des collectes sur « intitulé de poste 1 ».
  const vraisIntitules = intitules.filter(i => i && !/^intitul[ée]\s*de\s*poste/i.test(i));
  return vraisIntitules.length > 0 && villes.length > 0;
}

/**
 * Charge le profil d'un dossier, SANS EXIGER QU'IL EXISTE.
 *
 * LE BUG QUE CETTE FONCTION REMPLACE.
 * Le serveur lisait `profile/profile.json` sans filet, à la ligne qui suivait
 * les contrôles de sécurité. Or quelqu'un qui télécharge l'application et
 * double-clique l'exécutable n'a pas de profil : il n'a rien fait d'autre que
 * double-cliquer. Le programme mourait donc avant d'avoir servi le moindre
 * octet, sur une trace d'erreur Node.
 *
 * L'assistant de première configuration existait pourtant — page, garde-fou,
 * redirection — mais il était INATTEIGNABLE : rien ne tenait debout assez
 * longtemps pour le montrer. Toute la promesse « clé en main » s'arrêtait au
 * premier double-clic, sur un message que personne ne peut comprendre.
 *
 * On repart donc de l'exemple livré. Ce n'est pas une configuration valable,
 * et c'est exactement l'intérêt : `estConfigure()` la refuse, ce qui déclenche
 * la redirection vers l'assistant. Rien n'est écrit sur le disque — c'est
 * l'assistant qui écrira, avec de vraies réponses.
 *
 * @param {string} racine  le dossier de l'application
 * @returns {{profil: object, erreur: {chemin: string, message: string}|null}}
 */
export function chargerProfil(racine) {
  const chemin = join(racine, 'profile/profile.json');
  const exemple = join(racine, 'profile/profile.example.json');

  for (const candidat of [chemin, exemple]) {
    if (!existsSync(candidat)) continue;
    try {
      return { profil: JSON.parse(readFileSync(candidat, 'utf8')), erreur: null };
    } catch (erreur) {
      return { profil: {}, erreur: { chemin: candidat, message: erreur.message } };
    }
  }

  // Ni profil ni exemple : l'assistant se chargera de tout.
  return { profil: {}, erreur: null };
}

/**
 * « Strasbourg 67000 » ou « 67000 » → « 67 ». Null si illisible.
 *
 * Délègue à `villes.js` : l'assistant de première configuration et l'éditeur
 * des Options doivent lire un code postal de la même façon, sinon la même
 * saisie donnerait deux départements selon l'endroit où on l'a tapée.
 */
export function departementDe(codePostal) {
  return departementDuCode(codePostal);
}

/**
 * Construit un profil complet à partir des réponses de l'assistant.
 *
 * @param {object} r
 * @param {string} r.nom            prénom et nom, pour les lettres
 * @param {string} [r.villeCandidat] où l'on habite
 * @param {string[]} r.intitules    ce qu'on cherche
 * @param {{nom:string, codePostal:string}[]} r.villes  où l'on veut travailler
 * @param {boolean} [r.ecarterDebutants]  écarter alternance, stage, intérim
 * @returns {object} un profil prêt à l'emploi
 */
export function construireProfil(r) {
  const intitules = (r.intitules ?? [])
    .map(i => String(i).trim())
    .filter(Boolean)
    // Chaque intitulé est interrogé pour chaque ville ET en national, sur
    // chaque source. Six intitulés × cinq zones, c'est déjà 30 requêtes par
    // collecte et par source — les quotas gratuits ne suivent pas au-delà.
    .slice(0, 6);

  // Au départ, l'onglet et la collecte couvrent le même département. On ne
  // devine pas les limitrophes : élargir se fait en connaissance de cause,
  // rétrécir après coup fait disparaître des offres qu'on avait vues, ce qui
  // est bien plus déroutant. Les Options permettent de le faire ensuite.
  //
  // La fabrication passe par `construireVille` — la même que l'éditeur des
  // Options : deux chemins vers le même fichier qui n'écriraient pas la même
  // structure finiraient par diverger, et le second réglage casserait le
  // premier sans prévenir.
  const villes = (r.villes ?? [])
    .slice(0, VILLES_MAX)
    .map(v => construireVille({ nom: v.nom, codePostal: v.codePostal }))
    .filter(Boolean);

  // Ce qu'on cherche EST le premier signal de pertinence. Repartir de zéro
  // laisserait toutes les offres à un score nul, donc toutes dans le même
  // groupe — et le classement ne servirait à rien le premier jour.
  const positifs = intitules.map(i => ({
    motif: normaliser(i),
    poids: 3,
    note: 'intitulé recherché — ajusté au fil de l\'usage',
  }));

  return {
    _lisezMoi: [
      'Profil créé par l\'assistant de premier lancement.',
      '',
      'Les motifs de scoring sont des expressions régulières appliquées à du',
      'texte NORMALISÉ : minuscules, sans accents, ponctuation remplacée par',
      'des espaces. « agrivoltaïque » devient « agrivoltaique », « M&A » devient',
      '« m a ». Un motif écrit avec sa ponctuation ne correspondra jamais, et',
      'l\'échec est silencieux.',
      '',
      'Pour vérifier : npm run normaliser -- "M&A"',
      'Après avoir changé les seuils : npm run reclasser -- --appliquer',
    ],
    candidat: {
      nom: String(r.nom ?? '').trim(),
      email: '',
      telephone: '',
      ville: String(r.villeCandidat ?? '').trim(),
    },
    villesPrioritaires: villes,
    flux: [],
    rayonKm: 30,
    intitules,
    fraicheurJours: 7,
    // Désactivé au départ, comme partout ailleurs : une suppression est
    // irrécupérable, et personne ne devrait la découvrir le premier jour.
    nettoyageAutomatique: false,
    gemini: { quotaJournalier: 200, reserveLettres: 40 },
    scoring: {
      positifs,
      negatifs: [],
      eliminatoires: [],
      eliminatoiresTitre: r.ecarterDebutants === false ? [] : HORS_TRAJECTOIRE,
      seuils: SEUILS,
    },
  };
}

/** Les clés acceptées dans .env, et rien d'autre. */
export const CLES_ENV = [
  'GEMINI_API_KEY',
  'ADZUNA_APP_ID', 'ADZUNA_APP_KEY',
  'FRANCE_TRAVAIL_CLIENT_ID', 'FRANCE_TRAVAIL_CLIENT_SECRET',
  'JOOBLE_API_KEY',
];

/**
 * Rend le contenu d'un fichier .env à partir des clés fournies.
 *
 * LES VALEURS SONT NETTOYÉES, PAS SEULEMENT COPIÉES. Un retour à la ligne
 * dans une valeur permettrait d'écrire une variable supplémentaire — par
 * exemple un chemin de base de données ou un mot de passe — depuis un simple
 * champ de formulaire. On retire donc tout ce qui pourrait terminer la ligne.
 */
export function rendreEnv(cles, existant = {}) {
  const lignes = ['# Clés créées par l\'assistant de premier lancement.',
    '# Ne partage jamais ce fichier : il donne accès à tes comptes.', ''];
  for (const cle of CLES_ENV) {
    const brute = cles?.[cle] ?? existant?.[cle] ?? '';
    const valeur = String(brute).replace(/[\r\n]+/g, ' ').trim();
    lignes.push(`${cle}=${valeur}`);
  }
  lignes.push('', '# Décommente pour exiger un mot de passe (obligatoire si tu héberges en ligne).',
    '# COCKPIT_MOT_DE_PASSE=', '');
  return lignes.join('\n');
}
