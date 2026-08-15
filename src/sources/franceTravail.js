// Source « France Travail — Offres d'emploi v2 ».
// API officielle, gratuite : https://francetravail.io
// Seule source exposant la description COMPLÈTE de l'offre — c'est elle
// qui alimente le mieux l'analyse LLM.

const URL_TOKEN = 'https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire';
const URL_RECHERCHE = 'https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search';

// Jeton conservé EN MÉMOIRE du processus uniquement — jamais écrit sur disque.
let jetonCache = { valeur: null, expireA: 0 };

async function obtenirJeton() {
  if (jetonCache.valeur && Date.now() < jetonCache.expireA) {
    return jetonCache.valeur;
  }

  const corps = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.FRANCE_TRAVAIL_CLIENT_ID,
    client_secret: process.env.FRANCE_TRAVAIL_CLIENT_SECRET,
    scope: 'api_offresdemploiv2 o2dsoffre',
  });

  const reponse = await fetch(URL_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corps,
  });

  if (!reponse.ok) {
    throw new Error(`authentification France Travail refusée (HTTP ${reponse.status}) — vérifier FRANCE_TRAVAIL_CLIENT_ID et FRANCE_TRAVAIL_CLIENT_SECRET dans .env`);
  }

  const donnees = await reponse.json();
  // On retire 60 s de marge pour ne jamais utiliser un jeton qui vient d'expirer.
  jetonCache = {
    valeur: donnees.access_token,
    expireA: Date.now() + (donnees.expires_in - 60) * 1000,
  };
  return jetonCache.valeur;
}

/**
 * Borne haute de la fenêtre de publication, au format attendu par l'API
 * (`AAAA-MM-JJThh:mm:ssZ`, sans millisecondes).
 *
 * Elle est posée un jour dans le futur, et non à l'instant présent : l'API
 * accepte une date à venir, et une horloge locale en retard de quelques
 * minutes sur celle de France Travail suffirait à faire disparaître les offres
 * les plus fraîches — précisément celles qu'on vient chercher.
 */
function borneHaute() {
  return new Date(Date.now() + 86400000).toISOString().slice(0, 19) + 'Z';
}

/** Convertit une offre France Travail vers le format commun du projet. */
export function normaliserOffre(brute) {
  const libelleLieu = brute.lieuTravail?.libelle ?? '';
  // Le libellé arrive sous la forme « 54 - NANCY » : on retire le préfixe.
  const ville = libelleLieu.replace(/^\d{2,3}\s*-\s*/, '').trim();

  return {
    externalId: brute.id,
    titre: brute.intitule ?? '',
    entreprise: brute.entreprise?.nom ?? '',
    ville,
    // Libellé complet « 54 - NANCY » : porte le code département, utile au
    // repérage de zone quand la commune seule ne suffit pas.
    zone: libelleLieu,
    codePostal: brute.lieuTravail?.codePostal ?? '',
    contrat: brute.typeContrat ?? '',
    dateOffre: brute.dateCreation ? brute.dateCreation.slice(0, 10) : null,
    lien: brute.origineOffre?.urlOrigine ?? `https://candidat.francetravail.fr/offres/recherche/detail/${brute.id}`,
    description: brute.description ?? '',
    salaireSource: brute.salaire?.libelle ?? null,
  };
}

export default {
  nom: 'france-travail',

  estConfiguree() {
    return Boolean(process.env.FRANCE_TRAVAIL_CLIENT_ID && process.env.FRANCE_TRAVAIL_CLIENT_SECRET);
  },

  async chercher({ intitule, ville, rayonKm, depuisDate }) {
    const jeton = await obtenirJeton();

    // `minCreationDate` et `maxCreationDate` sont DÉPENDANTS : l'API refuse
    // le premier sans le second, avec un HTTP 400 explicite. Envoyer la borne
    // basse seule faisait échouer TOUTES les requêtes — la source n'a jamais
    // rien remonté jusqu'au 29 juillet 2026. Verrouillé par un test.
    const params = new URLSearchParams({
      motsCles: intitule,
      minCreationDate: `${depuisDate}T00:00:00Z`,
      maxCreationDate: borneHaute(),
      range: '0-49',
    });
    // ville === null → passe nationale (aucun filtre géographique).
    if (ville) {
      params.set('commune', ville.codeInsee);
      params.set('distance', String(rayonKm));
    }

    const reponse = await fetch(`${URL_RECHERCHE}?${params}`, {
      headers: { Authorization: `Bearer ${jeton}`, Accept: 'application/json' },
    });

    // 204 = aucune offre pour ces critères : ce n'est pas une erreur.
    if (reponse.status === 204) return [];
    if (!reponse.ok) {
      throw new Error(`recherche France Travail en échec (HTTP ${reponse.status})`);
    }

    const donnees = await reponse.json();
    return (donnees.resultats ?? []).map(normaliserOffre);
  },
};
