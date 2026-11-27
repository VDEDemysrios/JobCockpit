// Constantes partagées et petits utilitaires d'affichage.

export const GM = {
  1: { key: 'b1', vd: 'vd1', label: 'Prioritaire', emoji: '🟢', couleur: 'var(--g1)', fond: 'var(--g1b)' },
  2: { key: 'b2', vd: 'vd2', label: 'Possible',    emoji: '🟡', couleur: 'var(--g2)', fond: 'var(--g2b)' },
  3: { key: 'b3', vd: 'vd3', label: 'À écarter',   emoji: '🔴', couleur: 'var(--g3)', fond: 'var(--g3b)' },
  0: { key: 'b0', vd: 'vd0', label: 'À vérifier',  emoji: '⚪', couleur: 'var(--g0)', fond: 'var(--g0b)' },
};

export const STATUSES = ['À postuler', 'Envoyé', 'Relancé', 'Entretien', 'Refus'];

export const STATUS_EMOJI = {
  'À postuler': '📋', 'Envoyé': '📨', 'Relancé': '🔔', 'Entretien': '🤝', 'Refus': '🙅',
};

export const STATUS_COL = {
  'À postuler': 'var(--g0)', 'Envoyé': 'var(--info)', 'Relancé': 'var(--accent)',
  'Entretien': 'var(--g2)', 'Refus': 'var(--g3)',
};

export const STATUS_PROG = {
  'À postuler': 10, 'Envoyé': 40, 'Relancé': 60, 'Entretien': 90, 'Refus': 100,
};

export const STATUS_BG = {
  'À postuler': 'var(--g0b)', 'Envoyé': 'var(--infob)', 'Relancé': 'var(--accent-bg)',
  'Entretien': 'var(--g2b)', 'Refus': 'var(--g3b)',
};

export const KWCOLOR = {
  oui: ['var(--g1b)', 'var(--g1)', 'Oui'],
  non: ['var(--g3b)', 'var(--g3)', 'Non'],
  partiel: ['var(--g2b)', 'var(--g2)', 'Partiel'],
};

/** Palette des graphiques : lisible sur les trois thèmes, distincte à l'œil. */
export const PALETTE = [
  'var(--accent)', 'var(--g1)', 'var(--g2)', 'var(--info)',
  'var(--pink)', 'var(--accent2)', 'var(--g3)', 'var(--g0)',
];

export const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const MOIS_COURT = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin',
  'juil', 'août', 'sep', 'oct', 'nov', 'déc'];
export const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

export const SOURCE_LABEL = {
  'france-travail': 'France Travail', adzuna: 'Adzuna', jooble: 'Jooble',
  flux: 'Flux RSS', indeed: 'Indeed',
  collage: 'collée', manuel: 'saisie', historique: 'archive', inconnue: 'inconnue',
  // « careerjet » reste connu : des offres collectées avant son retrait
  // portent encore cette source, et une étiquette vide vaut moins qu'un nom.
  careerjet: 'Careerjet (retiré)',
};

// (`EVENEMENT` et `etiquetteFraicheur` — emoji du journal et des badges de
// fraîcheur — ont été retirés en 4.0 : dashboard.js et render.js dessinent
// désormais ces deux mobiliers en icônes SVG. `STATUS_EMOJI` reste : le PDF
// de suivi (impression.js) s'en sert, et c'est du contenu imprimé.)

export const todayISO = () => {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Nombre de jours écoulés depuis une date ISO (négatif si future). */
export const joursDepuis = (iso) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

/** Âge d'une offre en jours, ou null si sa date est inconnue. */
export function ageOffre(dateISO) {
  if (!dateISO) return null;
  const t = new Date(dateISO).getTime();
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
}

/**
 * Âge compact et lisible d'une date : « hier », « il y a 3 j », « il y a
 * 2 sem. », « il y a 5 mois », « il y a 2 ans ».
 *
 * C'est le format des vidéos — YouTube comme Twitch. Sans lui, on ne savait
 * pas si une vidéo datait d'hier ou de trois ans, et une liste d'archives sans
 * âge ne se trie pas de l'œil. Une date FUTURE ne rend rien plutôt qu'un
 * « il y a -1 j » : mieux vaut le silence qu'un chiffre faux.
 */
export function depuisRelatif(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const j = Math.floor((Date.now() - t) / 86400000);
  if (j < 0) return '';
  if (j === 0) return "aujourd'hui";
  if (j === 1) return 'hier';
  if (j < 7) return `il y a ${j} j`;
  if (j < 30) return `il y a ${Math.floor(j / 7)} sem.`;
  if (j < 365) return `il y a ${Math.floor(j / 30)} mois`;
  const a = Math.floor(j / 365);
  return `il y a ${a} an${a > 1 ? 's' : ''}`;
}

/** Date lisible : « 28 juillet 2026 ». */
export function dateLisible(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Date courte : « 28 juil. ». */
export function dateCourte(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getDate()} ${MOIS_COURT[d.getMonth()]}`;
}

/** Écart lisible : « il y a 2 h », « hier », « il y a 5 jours ». */
export function ilYA(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const minutes = Math.floor((Date.now() - t) / 60000);
  if (minutes < 1) return 'à l\'instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  const jours = Math.floor(heures / 24);
  if (jours === 1) return 'hier';
  if (jours < 30) return `il y a ${jours} jours`;
  const mois = Math.floor(jours / 30);
  return mois === 1 ? 'il y a un mois' : `il y a ${mois} mois`;
}

/** Accord du pluriel, sans répéter la même ternaire partout. */
export const pluriel = (n, singulier, pluriel_ = singulier + 's') =>
  `${n} ${n > 1 ? pluriel_ : singulier}`;

/**
 * Minuscules, sans accents ni ligatures : la forme qu'on compare.
 *
 * « Chargé de mission » doit se trouver en tapant « charge mission », et
 * « Œuvre » en tapant « oeuvre ». Sert à la recherche floue de la palette et
 * aux adresses des onglets de ville.
 */
export function normaliser(texte) {
  return String(texte ?? '').toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ------------------------------------------------- TITRES ET NOMS LISIBLES
//
// CE QUI NE MARCHAIT PAS
// ----------------------
// Une offre sur dix arrive EN CAPITALES : « CHARGE DE PROJET URBAIN ET
// URBANISME OPERATIONNEL (H/F) », employeur « MAIRIE », ville « ALENCON ».
// C'est la saisie des collectivités sur France Travail, recopiée telle quelle.
// Dans une liste, ces lignes crient plus fort que les autres sans rien dire de
// plus — et c'est le regard, pas le score, qui se mettait à trier.
//
// On ne touche QU'À L'AFFICHAGE : la base garde le texte d'origine (c'est lui
// qui sert d'empreinte pour reconnaître une offre déjà vue), et un titre
// correctement saisi n'est jamais modifié — la règle ne se déclenche que sur
// un texte presque entièrement en capitales.

/** Sigles qu'on garde debout dans un titre remis en minuscules. */
const SIGLES = new Set([
  'ENR', 'PV', 'BESS', 'PLU', 'SIG', 'RH', 'ADV', 'QSE', 'HSE', 'QHSE', 'BTP', 'VRD', 'CVC', 'SAV',
  'MOA', 'MOE', 'AMO', 'IT', 'SI', 'RSE', 'PCAET', 'SCOT', 'ZAC', 'ICPE', 'EPC', 'HTA', 'HTB', 'BT',
  'CEE', 'DGA', 'DGS', 'DST', 'CDI', 'CDD', 'BIM', 'CAO', 'DAO', 'ERP', 'PME', 'ETI', 'IRVE', 'PPA',
  'AO', 'DSP', 'EPCI', 'UE', 'RGPD', 'DAF', 'DRH', 'PMO', 'EHS', 'ESG', 'HQE', 'SNCF', 'EDF', 'RTE',
  'GRDF', 'ADS', 'ZAN', 'OAP', 'PADD', 'GPEC', 'TP', 'GC', 'VEFA', 'CDC', 'SEM', 'SPL', 'EPL',
  'CCAS', 'CNRS', 'INRAE', 'ADEME', 'DREAL', 'DDT', 'ONF', 'OFB', 'SDIS', 'CAUE',
]);

/** Petits mots qui restent en minuscules au milieu d'un nom propre. */
const PETITS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'en', 'et', 'au', 'aux', 'sur', 'sous',
  'd', 'l', 'à', 'a']);

/**
 * LES ACCENTS PERDUS AVEC LES CAPITALES.
 *
 * Qui saisit en majuscules saisit aussi sans accents : « CHARGE D'ETUDES EN
 * AMENAGEMENT ». Remis en minuscules tel quel, cela donnait « charge d'etudes
 * en amenagement » — lisible, mais fautif à chaque mot. Ce lexique rend leur
 * accent aux mots du métier qui n'ont QU'UNE écriture possible ; un mot
 * ambigu n'y figure pas (« charge » est traité à part : il ne devient
 * « chargé » que devant « de »).
 */
const ACCENTS = {
  etude: 'étude', etudes: 'études', energie: 'énergie', energies: 'énergies',
  energetique: 'énergétique', energetiques: 'énergétiques', amenagement: 'aménagement',
  operationnel: 'opérationnel', operationnelle: 'opérationnelle', operations: 'opérations',
  developpement: 'développement', photovoltaique: 'photovoltaïque', photovoltaiques: 'photovoltaïques',
  interim: 'intérim', communaute: 'communauté', agglomeration: 'agglomération', metropole: 'métropole',
  eurometropole: 'eurométropole', region: 'région', departement: 'département', delegue: 'délégué',
  secretaire: 'secrétaire', maitrise: 'maîtrise', general: 'général', generale: 'générale',
  genie: 'génie', electrique: 'électrique', electricite: 'électricité', reseau: 'réseau', reseaux: 'réseaux',
  renovation: 'rénovation', batiment: 'bâtiment', batiments: 'bâtiments', securite: 'sécurité',
  qualite: 'qualité', ecologique: 'écologique', ecologie: 'écologie', biodiversite: 'biodiversité',
  collectivite: 'collectivité', collectivites: 'collectivités', accessibilite: 'accessibilité',
  mobilite: 'mobilité', strategie: 'stratégie', prevention: 'prévention', attractivite: 'attractivité',
  pole: 'pôle', controle: 'contrôle', legalite: 'légalité', reglementaire: 'réglementaire',
  reglementation: 'réglementation', conformite: 'conformité', equipe: 'équipe', equipes: 'équipes',
  ingenieur: 'ingénieur', ingenieure: 'ingénieure', ingenierie: 'ingénierie', chargee: 'chargée',
  manoeuvre: 'manœuvre', societe: 'société', universite: 'université', specialise: 'spécialisé',
  specialiste: 'spécialiste', methanisation: 'méthanisation', eolien: 'éolien', eoliens: 'éoliens',
  eolienne: 'éolienne', redacteur: 'rédacteur', negociateur: 'négociateur', geomaticien: 'géomaticien',
  geometre: 'géomètre', debutant: 'débutant', confirme: 'confirmé', experimente: 'expérimenté',
  prefecture: 'préfecture', tresorerie: 'trésorerie', comptabilite: 'comptabilité', ruralite: 'ruralité',
  elu: 'élu', elus: 'élus', frere: 'frère', freres: 'frères',
};

const LETTRE = /\p{L}/gu;

/** Part des lettres en capitales, de 0 à 1 (0 s'il n'y a presque pas de lettres). */
function partCapitales(texte) {
  const lettres = texte.match(LETTRE) ?? [];
  if (lettres.length < 6) return 0;
  return lettres.filter(l => l === l.toUpperCase() && l !== l.toLowerCase()).length / lettres.length;
}

const capitale = (mot) => mot.charAt(0).toLocaleUpperCase('fr') + mot.slice(1);

/**
 * Un titre d'offre tout en capitales, rendu en casse de phrase.
 *
 * « CHARGE DE PROJET PLUI (H/F) » → « Charge de projet PLUi (H/F) ».
 * Les sigles du métier restent debout, « H/F » aussi, et les noms propres
 * connus (`propres` : la ville, l'employeur, les villes du profil) gardent
 * leur majuscule — sans quoi « STRASBOURG CAPITALE EUROPÉENNE » finissait en
 * « strasbourg ». Un titre déjà en casse normale est rendu TEL QUEL.
 *
 * @param {string} titre
 * @param {string[]} [propres]  noms propres à garder capitalisés
 */
export function titreLisible(titre, propres = []) {
  const t = String(titre ?? '').replace(/\s+/g, ' ').trim();
  if (partCapitales(t) < 0.8) return t;

  const connus = new Set();
  for (const p of propres) {
    for (const mot of normaliser(p).split(/[^a-z0-9]+/)) if (mot.length > 3) connus.add(mot);
  }

  const mots = t.split(/([\s\-/()&:,.;'’«»]+)/);
  const rendu = mots.map((mot, i) => {
    if (i % 2) return mot;                       // un séparateur
    if (!mot) return mot;
    if (/\d/.test(mot)) return mot;              // « A2P », « 2026 »
    if (mot === 'PLUI') return 'PLUi';
    if (SIGLES.has(mot)) return mot;
    const bas = mot.toLocaleLowerCase('fr');
    const juste = ACCENTS[bas] ?? bas;
    return connus.has(normaliser(mot)) ? capitale(juste) : juste;
  }).join('')
    // « charge de mission », « charge(e) d'études » : devant « de », c'est
    // un participe. Ailleurs (« une charge de travail »), on ne touche pas.
    .replace(/(^|[\s\-/(])charge(?=(?:\(e\)|-e)?\s+d[eu'’])/g, '$1chargé')
    // « (H/F) », « F/H », « H/F/X » : la mention légale reste en capitales.
    .replace(/(^|[\s(])([hfmx])\/([hfmx])(\/[hfmx])?(?=$|[\s),.])/gi, (m) => m.toUpperCase());

  return capitale(rendu);
}

/**
 * Un nom d'employeur ou de ville tout en capitales, rendu en casse de nom.
 *
 * « COMMUNAUTE DE COMMUNES DU PAYS DE MAURIAC » → « Communaute de Communes du
 * Pays de Mauriac » ; « CA ARCHE AGGLO » → « CA Arche Agglo » ; « ADEIS RH »
 * → « Adeis RH ». Les mots de trois lettres sans voyelle et ceux de deux
 * lettres sont pris pour des sigles et laissés debout : mieux vaut « BTP » que
 * « Btp ». Un nom déjà en casse normale est rendu tel quel.
 */
export function nomLisible(nom) {
  const n = String(nom ?? '').replace(/\s+/g, ' ').trim();
  const lettres = n.match(LETTRE) ?? [];
  if (lettres.length < 4) return n;
  if (lettres.some(l => l !== l.toUpperCase())) return n;   // déjà mixte

  let premier = true;
  return n.split(/([\s\-'’.()/&,]+)/).map((mot, i) => {
    if (i % 2 || !mot) return mot;
    const estPremier = premier;
    premier = false;
    if (/\d/.test(mot)) return mot;
    const bas = mot.toLocaleLowerCase('fr');
    if (PETITS.has(bas)) return estPremier ? capitale(bas) : bas;
    if (SIGLES.has(mot) || mot.length <= 2) return mot;
    if (mot.length === 3 && !/[AEIOUYÀÂÉÈÊÎÔÙÛ]/.test(mot)) return mot;
    return capitale(ACCENTS[bas] ?? bas);
  }).join('');
}

// ------------------------------------------------------------------ SALAIRE
//
// Les sources annoncent le salaire chacune à sa façon : « Mensuel de 2700.0
// Euros à 2900.0 Euros », « 38000 – 42000 € brut annuel », « 50k € a 55k
// €/an », « Horaire de 15.0 Euros ». Ce texte n'était montré qu'au fond de la
// carte dépliée, à côté de l'extrait — c'est-à-dire après avoir déjà décidé
// de s'intéresser à l'offre. Or le salaire est justement un critère de TRI.

/** Les nombres d'un libellé de salaire, « k » compris. */
function nombresDe(texte) {
  const trouves = [];
  const re = /(\d{1,3}(?:[\s  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(k)?/gi;
  let m;
  while ((m = re.exec(texte)) && trouves.length < 2) {
    let n = Number(m[1].replace(/[\s  ]/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) continue;
    if (m[2]) n *= 1000;
    trouves.push(n);
  }
  return trouves;
}

/**
 * Lit un libellé de salaire.
 *
 * @returns {{min: number, max: number, periode: 'an'|'mois'|'h'}|null}
 */
export function lireSalaire(libelle) {
  const texte = String(libelle ?? '');
  const n = nombresDe(texte).filter(x => x > 0);
  if (!n.length) return null;
  const [min, max] = n.length > 1 ? [Math.min(n[0], n[1]), Math.max(n[0], n[1])] : [n[0], n[0]];

  let periode = /horaire|\/\s*h\b|heure/i.test(texte) ? 'h'
    : /mensuel|mois/i.test(texte) ? 'mois'
      : /annuel|\ban\b|\/\s*an|année/i.test(texte) ? 'an'
        : max >= 10000 ? 'an' : max >= 500 ? 'mois' : 'h';
  // « Mensuel de 26000.0 Euros à 30000.0 Euros » : une saisie annuelle rangée
  // dans la mauvaise case par l'employeur. Aucun de ces postes ne paie trente
  // mille euros par mois.
  if (periode === 'mois' && min >= 12000) periode = 'an';
  if (periode === 'h' && min >= 500) periode = min >= 10000 ? 'an' : 'mois';
  return { min, max, periode };
}

/** « 38–42 k€/an », « 2 700–2 900 €/mois », « 15 €/h » — ou '' si illisible. */
export function salaireCourt(libelle) {
  const s = lireSalaire(libelle);
  if (!s) return '';
  const milliers = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const k = (v) => String(Math.round(v / 100) / 10).replace('.', ',');
  const plage = (f) => (s.min === s.max ? f(s.min) : `${f(s.min)}–${f(s.max)}`);
  if (s.periode === 'an') return `${plage(k)} k€/an`;
  if (s.periode === 'mois') return `${plage(milliers)} €/mois`;
  return `${plage((v) => String(Math.round(v * 100) / 100).replace('.', ','))} €/h`;
}

/**
 * Le salaire ramené à l'année (milieu de la fourchette), pour TRIER.
 * Un mois vaut douze, une heure 1 607 (la durée légale annuelle). null si
 * l'offre n'annonce rien : elle passe alors après toutes celles qui annoncent.
 */
export function salaireAnnuel(libelle) {
  const s = lireSalaire(libelle);
  if (!s) return null;
  const milieu = (s.min + s.max) / 2;
  return Math.round(s.periode === 'an' ? milieu : s.periode === 'mois' ? milieu * 12 : milieu * 1607);
}

/** Les types de contrat tels que les sources les codent → tels qu'on les lit. */
export function contratLisible(contrat) {
  const c = String(contrat ?? '').trim();
  return ({ MIS: 'Intérim', 'Intérimaire': 'Intérim', LIB: 'Indépendant', SAI: 'Saisonnier' })[c] ?? c;
}

/** Assemble des morceaux de texte en sautant les vides : plus de « · · ». */
export const enLigne = (...morceaux) =>
  morceaux.map(m => String(m ?? '').trim()).filter(Boolean).join(' · ');

/** La date locale dans `n` jours, en AAAA-MM-JJ. */
export function dansNJours(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Échappe le HTML : les titres et descriptions viennent de sources externes. */
export function echapper(texte) {
  return String(texte ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
