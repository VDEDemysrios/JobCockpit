// Source « Indeed » — EMPLACEMENT RÉSERVÉ, INACTIF.
//
// POURQUOI CE FICHIER EXISTE SANS FONCTIONNER
// -------------------------------------------
// Indeed n'expose aujourd'hui aucune API publique en libre-service pour la
// recherche d'offres : l'ancienne « Publisher API » est fermée aux nouvelles
// inscriptions, et les conditions d'utilisation d'Indeed interdisent le
// scraping de ses pages.
//
// Ce fichier réserve la place. Le jour où un accès légitime s'ouvre, il suffit
// de compléter chercher() et de renseigner INDEED_API_KEY dans .env :
// AUCUN autre fichier du projet ne change. C'est exactement ce que la couche
// d'abstraction sources/index.js existe pour garantir.
//
// DEUX VOIES D'ACCÈS LÉGITIMES CONNUES
// ------------------------------------
//  1. Partenariat Indeed : accès commercial à leur API de recherche, sur
//     dossier. À implémenter comme franceTravail.js (jeton + requête + mapping).
//  2. Réouverture d'une API publique en libre-service.
//
// À NE PAS CONFONDRE
// ------------------
// Le connecteur Indeed utilisable en conversation avec Claude n'est PAS une
// voie d'accès ici : c'est un outil de session, pas une API. Un script lancé
// par une tâche planifiée ne peut pas l'invoquer, même quand il fonctionne.
// Pour récupérer une offre trouvée par ce biais, utiliser l'import par
// collage (voir spec §5.5, livré au plan 3).

export default {
  nom: 'indeed',

  // Retourne false tant que la clé est absente → la source est silencieusement
  // sautée par sources/index.js, sans erreur ni avertissement.
  estConfiguree() {
    return Boolean(process.env.INDEED_API_KEY);
  },

  async chercher() {
    throw new Error(
      "source Indeed pas encore implémentée : aucun accès API légitime disponible à ce jour (voir les commentaires de src/sources/indeed.js)"
    );
  },
};
