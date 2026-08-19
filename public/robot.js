// Le compagnon a une tête.
//
// POURQUOI CE MODULE EXISTE
// -------------------------
// Le seul signe qu'il travaillait était trois points gris dans une bulle. Sur
// un appel qui prend cinq à quinze secondes, ça ne dit ni qu'il a reçu, ni
// qu'il lit, ni qu'il écrit — on relit sa propre phrase en se demandant si le
// bouton a marché. Une attente sans retour est une attente qui paraît cassée.
//
// UNE TÊTE PLUTÔT QU'UNE BARRE DE PROGRESSION. Une barre annonce une durée
// qu'on ne connaît pas ; un visage dit un ÉTAT, ce qui est la seule chose
// qu'on sache vraiment. Et il se trouve qu'on lit un état sur un visage sans
// l'apprendre : yeux fermés, il dort ; yeux qui balaient, il lit.
//
// TOUT EST EN SVG ET EN CSS. Aucune image, aucune police, rien à charger, et
// l'ensemble se recolore avec le thème. Les animations ne touchent que
// `transform` et `opacity` — le compositeur s'en charge, et l'interrupteur des
// Options les coupe toutes d'un coup.
//
// LES TICS SONT LE POINT DÉLICAT. Une tête parfaitement immobile au repos
// ressemble à une icône ; une tête qui s'agite en permanence est insupportable
// au bout de dix minutes. D'où des micro-gestes RARES et COURTS, espacés au
// hasard, et jamais pendant qu'il travaille — à ce moment-là, l'état qu'on
// affiche est une information, pas une décoration.

const CLE_VOIX = 'bp_robot_voix';

/** Les états, du plus calme au plus actif. */
export const ETATS = ['dort', 'repos', 'ecoute', 'lit', 'ecrit', 'parle'];

/** Après ce délai sans rien, il s'endort. */
const AVANT_SOMMEIL = 75000;

let racine = null;
let etat = 'repos';
let minuteurSommeil = null;
let minuteurTic = null;
let diction = null;

/**
 * La tête, en SVG.
 *
 * Chaque pièce porte une classe : c'est le CSS qui décide de ce qu'elle fait
 * dans chaque état, pas le JavaScript. Le module ne pose qu'un attribut
 * `data-etat` — un seul point de vérité, et rien à désynchroniser.
 */
const DESSIN = `
<svg class="rb-svg" viewBox="0 0 120 116" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <!-- Les antennes. La gauche porte les étincelles, la droite le petit
       clignotant : deux signaux distincts valent mieux qu'un symétrique. -->
  <g class="rb-antennes">
    <path class="rb-tige" d="M42 30 L34 12" />
    <circle class="rb-boule rb-boule-g" cx="33" cy="10" r="5" />
    <circle class="rb-plein rb-plein-g" cx="33" cy="10" r="3.4" />
    <path class="rb-tige" d="M78 30 L86 12" />
    <circle class="rb-boule rb-boule-d" cx="87" cy="10" r="5" />
    <circle class="rb-plein rb-plein-d" cx="87" cy="10" r="3.4" />
    <g class="rb-eclairs">
      <path d="M33 10 l-7 -6 m7 6 l8 -5 m-8 5 l-2 -9" />
      <path d="M87 10 l7 -6 m-7 6 l-8 -5 m8 5 l2 -9" />
    </g>
  </g>

  <!-- Les oreilles, qui servent surtout à donner une largeur à la tête. -->
  <rect class="rb-oreille" x="8" y="52" width="10" height="22" rx="5" />
  <rect class="rb-oreille" x="102" y="52" width="10" height="22" rx="5" />

  <g class="rb-tete">
    <rect class="rb-boitier" x="18" y="28" width="84" height="72" rx="20" />
    <rect class="rb-visiere" x="27" y="40" width="66" height="42" rx="14" />

    <!-- Le balayage de lecture : une bande claire qui traverse la visière. -->
    <g clip-path="url(#rb-clip)">
      <rect class="rb-scan" x="27" y="40" width="66" height="10" />
    </g>
    <clipPath id="rb-clip"><rect x="27" y="40" width="66" height="42" rx="14" /></clipPath>

    <!-- Les yeux. Deux formes seulement : un rond ouvert, un trait fermé.
         Le passage de l'un à l'autre EST le clignement. -->
    <g class="rb-yeux">
      <g class="rb-oeil rb-oeil-g">
        <circle class="rb-iris" cx="45" cy="60" r="8" />
        <circle class="rb-reflet" cx="42.5" cy="57.5" r="2.4" />
        <rect class="rb-paupiere" x="36" y="58" width="18" height="4" rx="2" />
      </g>
      <g class="rb-oeil rb-oeil-d">
        <circle class="rb-iris" cx="75" cy="60" r="8" />
        <circle class="rb-reflet" cx="72.5" cy="57.5" r="2.4" />
        <rect class="rb-paupiere" x="66" y="58" width="18" height="4" rx="2" />
      </g>
    </g>

    <!-- La bouche. Au repos un trait ; il parle, elle s'ouvre et se referme. -->
    <rect class="rb-bouche" x="52" y="88" width="16" height="4" rx="2" />
  </g>

  <!-- Le sommeil. Trois Z qui montent, et rien d'autre à l'écran. -->
  <g class="rb-zzz">
    <text x="92" y="34" class="rb-z rb-z1">Z</text>
    <text x="100" y="24" class="rb-z rb-z2">z</text>
    <text x="106" y="16" class="rb-z rb-z3">z</text>
  </g>
</svg>`;

/**
 * Installe la tête dans un conteneur.
 *
 * @param {HTMLElement} hote
 */
export function installerRobot(hote) {
  if (!hote) return null;
  hote.innerHTML = `<div class="rb" data-etat="repos" role="img"
    aria-label="Le compagnon">${DESSIN}<span class="rb-bulle" hidden></span></div>`;
  racine = hote.querySelector('.rb');
  poser('repos');
  return racine;
}

/**
 * Change d'état.
 *
 * `parle` et `ecrit` ARRÊTENT le compte à rebours du sommeil : s'endormir au
 * milieu d'une réponse serait le comble.
 */
export function poser(nouvel, { bulle = '' } = {}) {
  if (!racine || !ETATS.includes(nouvel)) return;
  etat = nouvel;
  racine.dataset.etat = nouvel;

  // UN TIC EN COURS DOIT TOMBER. `.rb.tic-bipbop .rb-bouche` et
  // `.rb[data-etat="ecrit"] .rb-bouche` ont la MÊME spécificité : c'est
  // l'ordre du fichier qui tranche, et les tics y sont écrits en dernier. Un
  // clin d'œil déclenché une seconde plus tôt gagnait donc contre l'état
  // réel — on envoyait un message, et la tête continuait de faire bip-bop au
  // lieu de montrer qu'elle écrivait.
  for (const c of [...racine.classList]) {
    if (c.startsWith('tic-')) racine.classList.remove(c);
  }

  const b = racine.querySelector('.rb-bulle');
  if (b) { b.textContent = bulle; b.hidden = !bulle; }

  clearTimeout(minuteurSommeil);
  clearTimeout(minuteurTic);

  if (nouvel === 'repos') { programmerSommeil(); programmerTic(); }
}

export const etatRobot = () => etat;

/** Le réveil : tout geste de l'utilisateur le sort du sommeil. */
export function reveiller() {
  if (etat === 'dort') poser('repos');
  else if (etat === 'repos') { clearTimeout(minuteurSommeil); programmerSommeil(); }
}

function programmerSommeil() {
  clearTimeout(minuteurSommeil);
  minuteurSommeil = setTimeout(() => poser('dort'), AVANT_SOMMEIL);
}

/**
 * LES TICS, ET POURQUOI ILS SONT RARES.
 *
 * Une tête immobile ressemble à une icône ; une tête qui bouge sans arrêt est
 * insupportable au bout de dix minutes. Un geste toutes les huit à vingt-deux
 * secondes, qui dure une seconde : assez pour qu'on la sente vivante du coin
 * de l'œil, pas assez pour qu'elle réclame l'attention.
 *
 * Ils ne se produisent QU'AU REPOS. Pendant qu'il lit ou qu'il écrit, ce qui
 * s'affiche est une information — la brouiller avec du décor serait perdre les
 * deux.
 */
const TICS = ['tic-clin', 'tic-bipbop', 'tic-etincelle', 'tic-penche', 'tic-regarde'];

function programmerTic() {
  clearTimeout(minuteurTic);
  const attente = 8000 + Math.random() * 14000;
  minuteurTic = setTimeout(() => {
    if (etat !== 'repos' || !racine) return;
    const tic = TICS[Math.floor(Math.random() * TICS.length)];
    racine.classList.add(tic);
    setTimeout(() => racine?.classList.remove(tic), 1400);
    programmerTic();
  }, attente);
}

// ─────────────────────────────────────────────────────────── la voix

/**
 * LA VOIX EST DANS LE NAVIGATEUR, PAS DANS LE NUAGE.
 *
 * `speechSynthesis` est une API standard : aucune clé, aucun quota, aucun
 * octet qui part chez qui que ce soit. Ce qu'il dit ne quitte pas la machine,
 * ce qui compte pour une conversation où l'on parle de son moral un soir de
 * découragement.
 *
 * Le prix est la qualité : ce sont les voix du système. Sur Windows, Hortense
 * et Julie sont correctes ; ailleurs, ça peut sonner robotique — ce qui,
 * pour le coup, n'est pas hors sujet.
 */
export const voixActive = () => localStorage.getItem(CLE_VOIX) === '1';

export function basculerVoix() {
  const neuf = !voixActive();
  localStorage.setItem(CLE_VOIX, neuf ? '1' : '0');
  if (!neuf) taire();
  return neuf;
}

export const voixDisponible = () => typeof window !== 'undefined'
  && typeof window.speechSynthesis !== 'undefined';

/**
 * La meilleure voix française installée.
 *
 * LE PIÈGE : `getVoices()` rend une liste VIDE au premier appel, tant que le
 * navigateur n'a pas fini de charger ses voix. Interrogée trop tôt, elle
 * laisse le navigateur choisir sa voix par défaut — anglaise sur la plupart
 * des installations, ce qui rend le français incompréhensible.
 */
function choisirVoix() {
  const voix = window.speechSynthesis.getVoices() ?? [];
  const fr = voix.filter(v => /^fr/i.test(v.lang));
  if (!fr.length) return null;
  // Les voix « en ligne » de Microsoft (Natural) sonnent nettement mieux que
  // les locales : on les préfère quand elles sont là.
  return fr.find(v => /natural|naturelle/i.test(v.name))
    ?? fr.find(v => /denise|hortense|julie|paul/i.test(v.name))
    ?? fr[0];
}

/**
 * Lit une réponse à voix haute, et anime la bouche pendant ce temps.
 *
 * Le texte est NETTOYÉ avant : les emoji et la ponctuation décorative se
 * prononcent, et « deux-points tiret » au milieu d'une phrase casse tout.
 */
export function dire(texte, { surFin } = {}) {
  if (!voixActive() || !voixDisponible()) { surFin?.(); return; }
  const propre = String(texte ?? '')
    .replace(/[*_`#>]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!propre) { surFin?.(); return; }

  taire();
  diction = new SpeechSynthesisUtterance(propre);
  diction.lang = 'fr-FR';
  diction.rate = 1.03;
  diction.pitch = 1.0;

  const voix = choisirVoix();
  if (voix) diction.voice = voix;

  diction.onstart = () => poser('parle');
  diction.onend = () => { diction = null; poser('repos'); surFin?.(); };
  diction.onerror = () => { diction = null; poser('repos'); surFin?.(); };

  // Les voix arrivent parfois APRÈS le premier appel : si la liste était vide,
  // on attend l'évènement plutôt que de parler anglais.
  if (!voix && window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      const tardive = choisirVoix();
      if (tardive && diction) diction.voice = tardive;
    }, { once: true });
  }
  window.speechSynthesis.speak(diction);
}

export function taire() {
  if (!voixDisponible()) return;
  window.speechSynthesis.cancel();
  diction = null;
  if (etat === 'parle') poser('repos');
}

export const enTrainDeParler = () => Boolean(diction);
