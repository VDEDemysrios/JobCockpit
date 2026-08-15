// Source « Adzuna » — https://developer.adzuna.com
// Agrégateur. Quota gratuit : 1000 appels/mois (consommation prévue ~375).
// Attention : les descriptions sont souvent TRONQUÉES par Adzuna. Le
// dédoublonnage (sources/index.js) privilégie donc la version France Travail
// quand la même offre est vue des deux côtés.

const URL_BASE = 'https://api.adzuna.com/v1/api/jobs/fr/search/1';

// Adzuna utilise un vocabulaire anglophone pour les types de contrat.
const CONTRATS = { permanent: 'CDI', contract: 'CDD', part_time: 'Temps partiel', internship: 'Stage' };

/**
 * « 8ème Arrondissement », « 1er-Arrondissement », « 13e arrondissement ».
 * Un quartier, jamais une commune.
 */
const EST_ARRONDISSEMENT = /^\s*\d{1,2}\s*(?:er|ère|re|e|ème|eme)?[-\s]*arrondissements?\b/i;

/** Convertit une offre Adzuna vers le format commun du projet. */
export function normaliserOffre(brute) {
  // location.area = ['France', 'Grand Est', 'Bas-Rhin', 'Strasbourg']
  // Le dernier élément est le plus précis.
  const zones = brute.location?.area ?? [];

  // SAUF DANS LES GRANDES VILLES, OÙ LE PLUS PRÉCIS N'EST PAS LE PLUS UTILE.
  // Adzuna descend d'un cran de plus : ['France', 'Île-de-France', 'Paris',
  // '8ème Arrondissement']. Ne garder que le dernier, c'était perdre « Paris »
  // en chemin — 13 offres parisiennes se retrouvaient sous un nom de quartier
  // que rien ne rattachait à une ville, donc dans l'onglet « Autre ».
  //
  // Pire : le numéro du quartier était ensuite lu comme un département.
  // « 13ème Arrondissement » devenait les Bouches-du-Rhône, « 17ème » la
  // Charente-Maritime, « 18ème » le Cher. Trois offres de Paris classées à
  // l'autre bout du pays, sans que rien ne le signale.
  const ville = (() => {
    if (zones.length === 0) return (brute.location?.display_name ?? '').split(',')[0].trim();
    const dernier = zones[zones.length - 1];
    if (zones.length >= 2 && EST_ARRONDISSEMENT.test(dernier)) {
      return `${zones[zones.length - 2]} ${dernier}`.trim();
    }
    return dernier;
  })();

  let salaireSource = null;
  if (brute.salary_min && brute.salary_max) {
    salaireSource = `${Math.round(brute.salary_min)} – ${Math.round(brute.salary_max)} € brut annuel`;
  } else if (brute.salary_min) {
    salaireSource = `à partir de ${Math.round(brute.salary_min)} € brut annuel`;
  }

  return {
    externalId: String(brute.id ?? ''),
    titre: brute.title ?? '',
    entreprise: brute.company?.display_name ?? '',
    ville,
    // Hiérarchie géographique complète : « France, Île-de-France,
    // Seine-et-Marne, Dammartin-en-Goële ». Indispensable pour reconnaître
    // qu'une commune de banlieue inconnue est bien dans la zone visée.
    zone: zones.join(', '),
    codePostal: '',
    contrat: CONTRATS[brute.contract_type] ?? '',
    dateOffre: brute.created ? brute.created.slice(0, 10) : null,
    lien: brute.redirect_url ?? '',
    description: brute.description ?? '',
    salaireSource,
  };
}

export default {
  nom: 'adzuna',

  estConfiguree() {
    return Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY);
  },

  async chercher({ intitule, ville, rayonKm, depuisDate }) {
    // Adzuna raisonne en « ancienneté maximale en jours », pas en date de début.
    const joursMax = Math.max(1, Math.ceil((Date.now() - new Date(depuisDate).getTime()) / 86400000));

    const params = new URLSearchParams({
      app_id: process.env.ADZUNA_APP_ID,
      app_key: process.env.ADZUNA_APP_KEY,
      what: intitule,
      max_days_old: String(joursMax),
      results_per_page: '50',
      'content-type': 'application/json',
    });
    if (ville) {
      params.set('where', ville.nom);
      params.set('distance', String(rayonKm));
    }

    const reponse = await fetch(`${URL_BASE}?${params}`);

    if (reponse.status === 429) {
      throw new Error('quota Adzuna atteint (1000 appels/mois) — réessayer le mois prochain');
    }
    if (!reponse.ok) {
      throw new Error(`recherche Adzuna en échec (HTTP ${reponse.status})`);
    }

    const donnees = await reponse.json();
    return (donnees.results ?? []).map(normaliserOffre);
  },
};
