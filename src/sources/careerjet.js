// Source « Careerjet » — https://www.careerjet.com/partners/api
//
// Méta-moteur présent dans ~90 pays. Sa couverture française ratisse APEC,
// HelloWork, Meteojob, Jobijoba et une longue traîne de sites carrière : c'est
// aujourd'hui le complément le plus rentable à France Travail et Adzuna, pour
// une seule clé à créer.
//
// Deux singularités de cette API, sources de 400 si on les oublie :
//  · `user_ip` et `user_agent` sont OBLIGATOIRES. Careerjet s'en sert pour
//    localiser et tracer l'appel. Un appel serveur n'a pas d'IP d'utilisateur :
//    on envoie celle de la machine, ce qui est la pratique documentée.
//  · l'API ne sait pas filtrer par date. Comme Jooble, on filtre côté client.
//
// La clé s'obtient en ouvrant un compte partenaire (gratuit) ; elle sert
// d'identifiant HTTP Basic, mot de passe vide.

const URL_BASE = 'https://search.api.careerjet.net/v4/query';

// Careerjet renvoie une IP factice acceptée pour les appels serveur à serveur.
const IP_PAR_DEFAUT = '127.0.0.1';
const AGENT = 'JobCockpit/1.0 (+usage personnel)';

/** Convertit une offre Careerjet vers le format commun du projet. */
export function normaliserOffre(brute) {
  // `locations` arrive sous la forme « Strasbourg, Bas-Rhin » ou « Paris ».
  const lieu = String(brute.locations ?? '').trim();
  const ville = lieu.split(',')[0].trim();

  // `date` est au format « 2026-07-24 12:33:00 » ou parfois « 2026-07-24 ».
  const dateOffre = typeof brute.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(brute.date)
    ? brute.date.slice(0, 10)
    : null;

  return {
    externalId: String(brute.url ?? brute.title ?? ''),
    titre: brute.title ?? '',
    entreprise: brute.company ?? '',
    ville,
    // Le libellé complet porte souvent le département : utile au repérage
    // de zone quand la commune seule n'est pas reconnue.
    zone: lieu,
    codePostal: '',
    contrat: '',
    dateOffre,
    lien: brute.url ?? '',
    description: brute.description ?? '',
    salaireSource: brute.salary || null,
  };
}

/**
 * Écarte les offres publiées avant `depuisDate`.
 * Une offre SANS date est conservée : mieux vaut la faire remonter et laisser
 * le scoring la classer « à vérifier » que la perdre silencieusement.
 */
export function filtrerParDate(offres, depuisDate) {
  return offres.filter(o => !o.dateOffre || o.dateOffre >= depuisDate);
}

export default {
  nom: 'careerjet',

  estConfiguree() {
    return Boolean(process.env.CAREERJET_API_KEY);
  },

  async chercher({ intitule, ville, rayonKm, depuisDate }) {
    const params = new URLSearchParams({
      keywords: intitule,
      locale_code: 'fr_FR',
      pagesize: '50',
      page: '1',
      sort: 'date',
      user_ip: process.env.CAREERJET_USER_IP || IP_PAR_DEFAUT,
      user_agent: AGENT,
    });
    if (ville) {
      params.set('location', ville.nom);
      params.set('radius', String(rayonKm));
    } else {
      params.set('location', 'France');
    }

    // HTTP Basic : la clé sert de nom d'utilisateur, le mot de passe est vide.
    const autorisation = Buffer.from(`${process.env.CAREERJET_API_KEY}:`).toString('base64');

    const reponse = await fetch(`${URL_BASE}?${params}`, {
      headers: { Authorization: `Basic ${autorisation}`, Accept: 'application/json' },
    });

    if (reponse.status === 401 || reponse.status === 403) {
      throw new Error('clé Careerjet refusée — vérifier CAREERJET_API_KEY dans .env');
    }
    if (reponse.status === 429) {
      throw new Error('quota Careerjet atteint — réessayer plus tard');
    }
    if (!reponse.ok) {
      throw new Error(`recherche Careerjet en échec (HTTP ${reponse.status})`);
    }

    const donnees = await reponse.json();
    return filtrerParDate((donnees.jobs ?? []).map(normaliserOffre), depuisDate);
  },
};
