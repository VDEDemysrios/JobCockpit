// Source « Jooble » — https://fr.jooble.org/api/about
// Méta-agrégateur : c'est la source dont la couverture ressemble le plus
// à celle d'Indeed (elle ratisse APEC, sites carrière, job boards…).
// Particularité : l'API ne propose PAS de filtre de date → filtrage côté client.

/** Convertit une offre Jooble vers le format commun du projet. */
export function normaliserOffre(brute) {
  // location arrive sous la forme « Strasbourg, 67 »
  const ville = (brute.location ?? '').split(',')[0].trim();

  return {
    externalId: String(brute.id ?? ''),
    titre: brute.title ?? '',
    entreprise: brute.company ?? '',
    ville,
    codePostal: '',
    contrat: brute.type ?? '',
    dateOffre: brute.updated ? brute.updated.slice(0, 10) : null,
    lien: brute.link ?? '',
    description: brute.snippet ?? '',
    salaireSource: brute.salary || null,
  };
}

/**
 * Filtre les offres publiées avant `depuisDate`.
 * Une offre SANS date est conservée : mieux vaut la faire remonter et laisser
 * le scoring la classer « à vérifier » que la perdre silencieusement.
 */
export function filtrerParDate(offres, depuisDate) {
  return offres.filter(o => !o.dateOffre || o.dateOffre >= depuisDate);
}

export default {
  nom: 'jooble',

  estConfiguree() {
    return Boolean(process.env.JOOBLE_API_KEY);
  },

  async chercher({ intitule, ville, rayonKm, depuisDate }) {
    const corps = { keywords: intitule, page: '1' };
    if (ville) {
      corps.location = ville.nom;
      corps.radius = String(rayonKm);
    }

    const reponse = await fetch(`https://jooble.org/api/${process.env.JOOBLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
    });

    if (!reponse.ok) {
      throw new Error(`recherche Jooble en échec (HTTP ${reponse.status})`);
    }

    const donnees = await reponse.json();
    return filtrerParDate((donnees.jobs ?? []).map(normaliserOffre), depuisDate);
  },
};
