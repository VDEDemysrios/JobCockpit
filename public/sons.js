// Les sons de l'interface — synthétisés, doux, premium.
//
// AUCUN FICHIER. Tout est généré par l'API Web Audio : rien à télécharger,
// rien sous licence, rien qui alourdisse l'exécutable. Des sinus purs et une
// enveloppe douce suffisent à un son « premium » — c'est la sécheresse d'une
// attaque, pas la richesse d'un échantillon, qui fait un son d'interface
// désagréable.
//
// TROIS RÈGLES
// ------------
//  · l'AudioContext ne naît qu'au PREMIER geste : les navigateurs interdisent
//    le son avant une interaction, et le créer trop tôt le laisse « suspendu »,
//    muet, sans erreur ;
//  · volume bas, attaques et chutes exponentielles — jamais de « clic » sec,
//    jamais envahissant ;
//  · un interrupteur coupe tout (Options → Sons). Par défaut activé, puisqu'on
//    les a demandés — mais à un geste de distance.

const CLE = 'bp_sons';
let ctx = null;
let maitre = null;

export const sonsActifs = () => localStorage.getItem(CLE) !== '0';
export function reglerSons(actif) { localStorage.setItem(CLE, actif ? '1' : '0'); }

/** L'AudioContext partagé, créé et réveillé à la demande. Null si indisponible. */
function contexte() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  maitre = ctx.createGain();
  maitre.gain.value = 0.5;   // plafond général : les sons restent en sourdine
  maitre.connect(ctx.destination);
  return ctx;
}

// On débloque le son au tout premier geste, quel qu'il soit : dès lors, un
// clic sur un onglet ou une touche pourra sonner.
if (typeof window !== 'undefined') {
  const deverrou = () => contexte();
  window.addEventListener('pointerdown', deverrou, { once: true, capture: true });
  window.addEventListener('keydown', deverrou, { once: true, capture: true });
}

/**
 * Une note douce : un oscillateur, une enveloppe exponentielle qui monte vite
 * et retombe en fondu. `exponentialRampToValueAtTime` ne sait pas viser zéro —
 * on vise donc un quasi-silence (0.0001), le seuil d'audibilité.
 */
function note(freq, { duree = 0.14, gain = 0.12, type = 'sine', retard = 0, glissVers = null } = {}) {
  const c = contexte();
  if (!c || !sonsActifs()) return;
  const t0 = c.currentTime + retard;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glissVers) osc.frequency.exponentialRampToValueAtTime(glissVers, t0 + duree);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duree);
  osc.connect(g); g.connect(maitre);
  osc.start(t0); osc.stop(t0 + duree + 0.03);
}

/** Un tic d'interface, très court et feutré. */
export function sonClic() { note(760, { duree: 0.05, gain: 0.045, type: 'triangle' }); }

/** Changement de vue : deux notes qui montent, chaleureuses. */
export function sonNav() {
  note(523.25, { duree: 0.11, gain: 0.06 });
  note(783.99, { duree: 0.15, gain: 0.05, retard: 0.055 });
}

/**
 * L'ouverture : un accord qui monte, le carillon de mise en marche. Ne sonne
 * qu'à un lancement DÉBLOQUÉ (après un geste) — sur un tout premier chargement,
 * le navigateur le tait, et c'est normal.
 */
export function sonIntro() {
  [392, 523.25, 659.25, 783.99].forEach((f, i) =>   // Sol – Do – Mi – Sol
    note(f, { duree: 1.15, gain: 0.08, type: 'sine', retard: i * 0.085 }));
  note(1046.5, { duree: 1.5, gain: 0.045, type: 'sine', retard: 0.42 });
}
