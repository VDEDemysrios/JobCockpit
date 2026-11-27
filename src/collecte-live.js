// La collecte EN DIRECT : un journal d'événements qu'on peut suivre.
//
// POURQUOI
// --------
// Une collecte dure de deux à quarante minutes. Jusqu'ici, le bouton tournait
// en silence pendant tout ce temps, et la seule information arrivait à la
// fin, d'un bloc : « 12 nouvelles ». On ne savait ni quelle source répondait,
// ni si l'analyse avançait, ni même si quelque chose se passait encore.
//
// Ce module tient le journal de la collecte en cours (ou de la dernière) et le
// diffuse : `collecter()` lui envoie un événement à chaque étape, la route SSE
// le relaie au navigateur, et une page rechargée en pleine collecte se
// raccroche en relisant le journal depuis le début.
//
// UN SEUL CHEMIN D'EXÉCUTION
// --------------------------
// Le bouton (`/collecte/demarrer`), l'ancien `/refresh` et le planificateur
// passent TOUS par `executer()`. C'est ce qui garantit qu'ils partagent le
// même verrou, et qu'une collecte automatique se voit dans le radar exactement
// comme une collecte demandée.
import { EventEmitter } from 'node:events';
import { creerVerrou } from './verrou.js';

/** Taille du journal rejoué à la connexion : de quoi tout revoir, pas plus. */
export const TAILLE_JOURNAL = 200;

/** Les noms d'événements du contrat 3.1 — rien d'autre ne part sur le flux. */
export const EVENEMENTS = ['debut', 'source', 'etape', 'offre', 'analyse', 'fin', 'erreur'];

/** Identifiant court et lisible : c-20261113-143005-ab12. */
function nouvelId(quand = new Date()) {
  const p = (v) => String(v).padStart(2, '0');
  return `c-${quand.getFullYear()}${p(quand.getMonth() + 1)}${p(quand.getDate())}`
    + `-${p(quand.getHours())}${p(quand.getMinutes())}${p(quand.getSeconds())}`
    + `-${Math.random().toString(16).slice(2, 6)}`;
}

/**
 * Normalise l'option `progres` de `collecter()`.
 *
 * Elle est FACULTATIVE : la tâche Windows et les tests existants appellent
 * `collecter()` sans elle, et ne doivent rien remarquer. On accepte une
 * fonction `(nom, donnees)` ou n'importe quel objet doté d'un `emit` (un
 * EventEmitter) ; tout le reste devient un no-op. Une erreur levée par
 * l'écouteur ne remonte JAMAIS dans la collecte : un radar cassé ne doit pas
 * coûter la moisson.
 */
export function emetteur(progres) {
  let brut = () => {};
  if (typeof progres === 'function') brut = progres;
  else if (progres && typeof progres.emit === 'function') brut = (n, d) => progres.emit(n, d);
  return (nom, donnees = {}) => {
    try { brut(nom, donnees); } catch { /* l'observateur ne commande pas la collecte */ }
  };
}

/**
 * @param {object} o
 * @param {object} [o.db]       la base, pour le verrou partagé avec les autres processus
 * @param {object} [o.verrou]   un verrou existant (sinon, un neuf sur `db`)
 */
export function creerCollecteLive({ db = null, verrou = creerVerrou({ db }), tailleJournal = TAILLE_JOURNAL } = {}) {
  const bus = new EventEmitter();
  // Chaque client SSE est un écouteur : au-delà de dix, Node avertit d'une
  // fuite probable. Ici, ce n'est pas une fuite — c'est plusieurs onglets.
  bus.setMaxListeners(0);

  let courante = null;   // { id, debut, origine, enCours, evenements, sequence }

  function consigner(nom, donnees) {
    if (!courante) return;
    const evt = { seq: ++courante.sequence, nom, donnees, t: new Date().toISOString() };
    courante.evenements.push(evt);
    if (courante.evenements.length > tailleJournal) courante.evenements.shift();
    bus.emit('evenement', { id: courante.id, ...evt });
  }

  return {
    verrou,
    bus,

    /** État lisible pour `/collecte/etat` et pour `/meta`. */
    etat() {
      const v = verrou.etat();
      return {
        enCours: Boolean(courante?.enCours) || v.pris,
        externe: v.pris && !v.local,
        id: courante?.id ?? null,
        debut: courante?.debut ?? null,
        origine: courante?.origine ?? null,
        evenements: courante ? courante.evenements.slice() : [],
      };
    },

    /**
     * Lance une collecte sous le verrou, et journalise ses événements.
     *
     * @param {(progres: Function) => Promise<object>} travail  appelle `collecter`
     *   en lui passant `progres`
     * @returns {{ok: true, id: string, promesse: Promise<object>}
     *          |{ok: false, id: string|null, error: string}}
     *   `promesse` ne rejette JAMAIS : elle rend `{ ok, resume }` ou `{ ok: false, erreur }`.
     */
    executer(travail, { origine = 'bouton' } = {}) {
      const id = nouvelId();
      const pris = verrou.prendre({ id, origine });
      if (!pris.ok) return { ok: false, id: pris.id ?? courante?.id ?? null, error: pris.error };

      courante = { id, debut: new Date().toISOString(), origine, enCours: true, evenements: [], sequence: 0 };
      const progres = (nom, donnees) => {
        if (!EVENEMENTS.includes(nom) || nom === 'fin' || nom === 'erreur') return;
        // L'identifiant est ajouté à `debut` ici : `collecter()` ne le connaît pas.
        consigner(nom, nom === 'debut' ? { id, debut: courante.debut, ...donnees } : donnees);
      };

      const promesse = (async () => {
        try {
          const resume = await travail(progres);
          consigner('fin', { resume });
          return { ok: true, resume };
        } catch (erreur) {
          consigner('erreur', { message: erreur?.message ?? String(erreur) });
          return { ok: false, erreur };
        } finally {
          courante.enCours = false;
          verrou.rendre();
        }
      })();

      return { ok: true, id, promesse };
    },

    /**
     * S'abonne au flux en direct.
     * @returns {() => void} de quoi se désabonner
     */
    ecouter(rappel) {
      bus.on('evenement', rappel);
      return () => bus.off('evenement', rappel);
    },
  };
}
