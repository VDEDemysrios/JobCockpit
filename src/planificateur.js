// Collecte périodique déclenchée depuis le processus serveur.
//
// POURQUOI ICI PLUTÔT QU'UNE TÂCHE PLANIFIÉE
// ------------------------------------------
// En local, c'est la tâche Windows qui réveille `scripts/collect.js` toutes
// les 6 heures. En ligne, il n'y a pas de planificateur du système : le
// serveur tourne déjà en permanence, autant qu'il s'en charge. Cela évite
// d'ajouter une machine programmée, donc un second déploiement à maintenir.
//
// DEUX BASES, C'EST LE PIÈGE
// --------------------------
// Ce planificateur ne s'active QUE si COLLECTE_AUTO=1. Sans ce garde-fou, un
// serveur lancé en local pendant que la tâche Windows tourne encore ferait
// deux collectes concurrentes ; et surtout, une fois l'application en ligne,
// la tâche Windows continuerait de remplir une base LOCALE que plus personne
// ne regarde. Le suivi de candidatures se scinderait en deux sans prévenir.

import { lireMeta } from './db.js';

const SIX_HEURES_MS = 6 * 60 * 60 * 1000;

/**
 * Démarre la collecte périodique si elle est demandée.
 *
 * @param {object} options
 * @param {object} options.db
 * @param {Function} options.collecter
 * @param {object[]} options.sources
 * @param {object} options.profil
 * @param {string} options.cv
 * @param {boolean} options.actif
 * @param {number} [options.intervalleMs]
 * @returns {{arreter: Function}|null}
 */
export function demarrerPlanificateur({
  db, collecter, sources, profil, cv, actif,
  intervalleMs = SIX_HEURES_MS,
  // Assez court pour que la moisson soit là quand on ouvre le tableau de
  // bord, assez long pour que l'interface réponde d'abord.
  delaiAmorceMs = 20_000,
  // En deçà, la collecte du démarrage est jugée inutile.
  fraicheurMinutes = 60,
  // Injectable, et pas seulement pour la commodité : le lanceur de tests de
  // Node communique avec ses fichiers par le flux de sortie, et une écriture
  // console pendant un test le corrompt — « Unable to deserialize cloned
  // data ». Les tests passent donc un journal muet.
  journal = console,
}) {
  if (!actif) return null;

  let enCours = false;

  async function tour(raison) {
    // Le bouton « Collecter » du tableau de bord peut tomber au même moment :
    // deux collectes concurrentes gaspilleraient le quota et entrelaceraient
    // leurs écritures.
    if (enCours) {
      journal.warn('⏸  Collecte déjà en cours — passage suivant ignoré.');
      return;
    }
    enCours = true;
    try {
      journal.log(`\n⏰ Collecte automatique (${raison})`);
      const r = await collecter({ db, profil, sources, cv, analyser: true });
      journal.log(`   ${r.nouvelles} nouvelle(s), ${r.analysees} analysée(s), ${r.dureeSecondes} s`);
    } catch (erreur) {
      // Une collecte ratée ne doit jamais faire tomber le serveur : le
      // tableau de bord doit rester consultable même si les sources sont
      // injoignables.
      journal.error('   ❌ Collecte automatique en échec :', erreur.message);
    } finally {
      enCours = false;
    }
  }

  /**
   * Une collecte vient-elle de tourner ?
   *
   * Sans cette question, chaque démarrage en relance une : trois
   * redémarrages d'affilée — après une mise à jour, un plantage, un essai —
   * coûteraient trois fois le quota Gemini et vingt-cinq minutes, pour
   * ramener les mêmes offres. Le déclencheur est « à l'ouverture de session »
   * et non « une fois par jour » : le cas est ordinaire, pas exceptionnel.
   */
  function collecteTouteFraiche() {
    const iso = lireMeta(db, 'last_collect_at');
    if (!iso) return false;
    const minutes = (Date.now() - new Date(iso).getTime()) / 60000;
    return Number.isFinite(minutes) && minutes >= 0 && minutes < fraicheurMinutes;
  }

  // Un tour au démarrage : ouvrir l'application doit donner des offres du
  // jour, pas celles d'hier soir.
  const amorce = setTimeout(() => {
    if (collecteTouteFraiche()) {
      journal.log(`⏰ Collecte au démarrage ignorée — une vient de tourner (moins de ${fraicheurMinutes} min).`);
      return;
    }
    tour('démarrage');
  }, delaiAmorceMs);

  const minuterie = setInterval(() => tour('périodique'), intervalleMs);

  journal.log(`⏰ Collecte automatique activée — au démarrage, puis toutes les ${Math.round(intervalleMs / 3600000)} h`);

  return {
    arreter() {
      clearTimeout(amorce);
      clearInterval(minuterie);
    },
  };
}
