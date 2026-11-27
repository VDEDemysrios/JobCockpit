// Le verrou de collecte : UNE collecte à la fois, quel que soit le déclencheur.
//
// CE QUI NE MARCHAIT PAS
// ----------------------
// Il y avait deux verrous, et ils ne se connaissaient pas : un booléen dans
// `api.js` pour le bouton, un autre dans `planificateur.js` pour la collecte
// automatique. Le bouton pressé pendant la collecte de six heures en lançait
// donc une seconde, en parallèle — quota Gemini dépensé deux fois pour les
// mêmes offres, écritures entrelacées dans la même base. Et la tâche Windows,
// qui tourne dans un AUTRE processus, échappait aux deux.
//
// CE QUI LE REMPLACE
// ------------------
// Un seul objet, créé une fois par `server.js` et passé au bouton, au
// planificateur et à `/refresh`. Il tient deux choses :
//   · le drapeau EN MÉMOIRE, pour ce processus-ci ;
//   · `meta.collecte_verrou`, un horodatage EN BASE, pour les autres
//     processus — c'est le seul endroit que le serveur et la tâche Windows
//     voient tous les deux.
//
// Un horodatage plutôt qu'un simple « oui » : un processus qui meurt en pleine
// collecte ne rend jamais son verrou. Au-delà de 30 minutes sans nouvelles, on
// le tient pour abandonné. Le détenteur le rafraîchit toutes les cinq minutes,
// pour qu'une longue collecte — quarante minutes, ça s'est vu — ne soit pas
// prise pour morte en cours de route.
import { lireMeta, ecrireMeta } from './db.js';

export const CLE_VERROU = 'collecte_verrou';

/** Au-delà, un verrou posé par un autre processus est tenu pour abandonné. */
export const VERROU_PERIME_MS = 30 * 60 * 1000;

/** Fréquence à laquelle le détenteur rafraîchit son horodatage. */
const BATTEMENT_MS = 5 * 60 * 1000;

/**
 * Le verrou posé en base est-il frais ?
 * @returns {{frais: boolean, depuis: string|null}}
 */
export function verrouExterne(db, maintenant = Date.now()) {
  let iso = null;
  try { iso = lireMeta(db, CLE_VERROU); } catch { return { frais: false, depuis: null }; }
  if (!iso) return { frais: false, depuis: null };
  const age = maintenant - new Date(iso).getTime();
  return { frais: Number.isFinite(age) && age >= 0 && age < VERROU_PERIME_MS, depuis: iso };
}

/** Pose l'horodatage en base. Sans effet si la base refuse (lecture seule). */
export function poserVerrouBase(db, quand = new Date()) {
  try { ecrireMeta(db, CLE_VERROU, quand.toISOString()); } catch { /* sans base, sans verrou externe */ }
}

/** Efface l'horodatage en base. */
export function leverVerrouBase(db) {
  try { db.prepare('DELETE FROM meta WHERE cle = ?').run(CLE_VERROU); } catch { /* idem */ }
}

/**
 * Crée le verrou d'un processus.
 * @param {object} o
 * @param {object} [o.db]  la base — sans elle, le verrou reste purement local
 */
export function creerVerrou({ db = null } = {}) {
  let detenu = null;     // { id, depuis, origine }
  let battement = null;

  return {
    /** Qui tient le verrou, dans ce processus ou ailleurs. */
    etat() {
      if (detenu) return { pris: true, local: true, ...detenu };
      if (db) {
        const ext = verrouExterne(db);
        if (ext.frais) return { pris: true, local: false, id: null, depuis: ext.depuis, origine: 'externe' };
      }
      return { pris: false };
    },

    /**
     * Tente de prendre le verrou.
     * @returns {{ok: true}|{ok: false, error: string, id: string|null}}
     */
    prendre({ id = null, origine = 'inconnue' } = {}) {
      if (detenu) {
        return { ok: false, id: detenu.id, error: 'Une collecte est déjà en cours.' };
      }
      if (db && verrouExterne(db).frais) {
        return { ok: false, id: null,
          error: 'Une collecte tourne déjà dans un autre processus (tâche planifiée). Réessaie dans quelques minutes.' };
      }
      detenu = { id, depuis: new Date().toISOString(), origine };
      if (db) {
        poserVerrouBase(db);
        battement = setInterval(() => poserVerrouBase(db), BATTEMENT_MS);
        // Le battement ne doit jamais, à lui seul, garder le processus en vie.
        battement.unref?.();
      }
      return { ok: true };
    },

    /** Rend le verrou. Idempotent. */
    rendre() {
      if (!detenu) return;
      detenu = null;
      clearInterval(battement);
      battement = null;
      if (db) leverVerrouBase(db);
    },
  };
}
