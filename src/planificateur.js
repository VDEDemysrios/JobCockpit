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
  db, collecter, sources, profil, cv, actif, intervalleMs = SIX_HEURES_MS,
}) {
  if (!actif) return null;

  let enCours = false;

  async function tour(raison) {
    // Le bouton « Collecter » du tableau de bord peut tomber au même moment :
    // deux collectes concurrentes gaspilleraient le quota et entrelaceraient
    // leurs écritures.
    if (enCours) {
      console.warn('⏸  Collecte déjà en cours — passage suivant ignoré.');
      return;
    }
    enCours = true;
    try {
      console.log(`\n⏰ Collecte automatique (${raison})`);
      const r = await collecter({ db, profil, sources, cv, analyser: true });
      console.log(`   ${r.nouvelles} nouvelle(s), ${r.analysees} analysée(s), ${r.dureeSecondes} s`);
    } catch (erreur) {
      // Une collecte ratée ne doit jamais faire tomber le serveur : le
      // tableau de bord doit rester consultable même si les sources sont
      // injoignables.
      console.error('   ❌ Collecte automatique en échec :', erreur.message);
    } finally {
      enCours = false;
    }
  }

  // Un premier tour peu après le démarrage : un redéploiement ne doit pas
  // faire attendre six heures avant la première moisson.
  const amorce = setTimeout(() => tour('démarrage'), 60_000);
  const minuterie = setInterval(() => tour('périodique'), intervalleMs);

  console.log(`⏰ Collecte automatique activée — toutes les ${Math.round(intervalleMs / 3600000)} h`);

  return {
    arreter() {
      clearTimeout(amorce);
      clearInterval(minuterie);
    },
  };
}
