// Source « Adzuna » — https://developer.adzuna.com
// Agrégateur. Quota gratuit : 1000 appels/mois (consommation prévue ~375).
// Attention : les descriptions sont souvent TRONQUÉES par Adzuna. Le
// dédoublonnage (sources/index.js) privilégie donc la version France Travail
// quand la même offre est vue des deux côtés.

const URL_BASE = 'https://api.adzuna.com/v1/api/jobs/fr/search/1';

// Adzuna utilise un vocabulaire anglophone pour les types de contrat.
const CONTRATS = { permanent: 'CDI', contract: 'CDD', part_time: 'Temps partiel', internship: 'Stage' };

/** Convertit une offre Adzuna vers le format commun du projet. */
export function normaliserOffre(brute) {
  // location.area = ['France', 'Grand Est', 'Bas-Rhin', 'Strasbourg']
  // Le dernier élément est le plus précis.
  const zones = brute.location?.area ?? [];
  const ville = zones.length > 0
    ? zones[zones.length - 1]
    : (brute.location?.display_name ?? '').split(',')[0].trim();

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
