import { test } from 'node:test';
import assert from 'node:assert/strict';
import franceTravail, { normaliserOffre } from '../src/sources/franceTravail.js';

const REPONSE_FT = {
  id: '196MXKT',
  intitule: 'Chef de projet énergies renouvelables (H/F)',
  description: 'Vous piloterez le développement de projets photovoltaïques...',
  dateCreation: '2026-07-25T09:12:00.000Z',
  lieuTravail: { libelle: '54 - NANCY', codePostal: '54000' },
  entreprise: { nom: 'ACME ENERGIES' },
  typeContrat: 'CDI',
  salaire: { libelle: 'Annuel de 38000 à 45000 Euros' },
  origineOffre: { urlOrigine: 'https://candidat.francetravail.fr/offres/196MXKT' },
};

test('normaliserOffre extrait les champs au format commun', () => {
  const o = normaliserOffre(REPONSE_FT);
  assert.equal(o.externalId, '196MXKT');
  assert.equal(o.titre, 'Chef de projet énergies renouvelables (H/F)');
  assert.equal(o.entreprise, 'ACME ENERGIES');
  assert.equal(o.contrat, 'CDI');
  assert.equal(o.dateOffre, '2026-07-25');
  assert.equal(o.codePostal, '54000');
  assert.equal(o.salaireSource, 'Annuel de 38000 à 45000 Euros');
  assert.ok(o.lien.includes('196MXKT'));
});

test('normaliserOffre nettoie le préfixe département du lieu', () => {
  assert.equal(normaliserOffre(REPONSE_FT).ville, 'NANCY');
});

test('normaliserOffre construit un lien de repli si urlOrigine manque', () => {
  const o = normaliserOffre({ ...REPONSE_FT, origineOffre: undefined });
  assert.ok(o.lien.includes('196MXKT'));
});

test('normaliserOffre tolère les champs absents sans planter', () => {
  const o = normaliserOffre({ id: 'X1', intitule: 'Juriste' });
  assert.equal(o.entreprise, '');
  assert.equal(o.ville, '');
  assert.equal(o.description, '');
  assert.equal(o.salaireSource, null);
});

// ------------------------------------------------- construction de la requête

/**
 * Remplace `fetch` le temps d'un appel et rend les URL demandées.
 * La première réponse est le jeton, les suivantes une recherche vide.
 */
async function urlsDemandees(options) {
  const vraiFetch = globalThis.fetch;
  const vraiId = process.env.FRANCE_TRAVAIL_CLIENT_ID;
  const vraiSecret = process.env.FRANCE_TRAVAIL_CLIENT_SECRET;
  const urls = [];

  process.env.FRANCE_TRAVAIL_CLIENT_ID = 'test-id';
  process.env.FRANCE_TRAVAIL_CLIENT_SECRET = 'test-secret';
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes('access_token')) {
      return { ok: true, json: async () => ({ access_token: 'jeton', expires_in: 1499 }) };
    }
    return { ok: true, status: 200, json: async () => ({ resultats: [] }) };
  };

  try {
    await franceTravail.chercher(options);
    return urls.filter(u => u.includes('/offres/search'));
  } finally {
    globalThis.fetch = vraiFetch;
    if (vraiId === undefined) delete process.env.FRANCE_TRAVAIL_CLIENT_ID;
    else process.env.FRANCE_TRAVAIL_CLIENT_ID = vraiId;
    if (vraiSecret === undefined) delete process.env.FRANCE_TRAVAIL_CLIENT_SECRET;
    else process.env.FRANCE_TRAVAIL_CLIENT_SECRET = vraiSecret;
  }
}

// L'API répond « les paramètres minCreationDate et maxCreationDate sont
// dépendants et doivent être renseignés ensemble ». Envoyer la borne basse
// seule renvoyait un HTTP 400 sur CHAQUE requête : la source n'a jamais rien
// remonté, sans que rien ne le signale — aucun test ne regardait l'URL.
test('la recherche envoie les DEUX bornes de date, jamais une seule', async () => {
  const [url] = await urlsDemandees({
    intitule: 'chef de projet', ville: null, rayonKm: 30, depuisDate: '2026-07-22',
  });
  const p = new URL(url).searchParams;

  assert.equal(p.get('minCreationDate'), '2026-07-22T00:00:00Z');
  assert.ok(p.get('maxCreationDate'), 'maxCreationDate doit être présent');
  assert.match(p.get('maxCreationDate'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    'format sans millisecondes, comme l\'exige l\'API');
  assert.ok(p.get('maxCreationDate') > p.get('minCreationDate'));
});

test('une ville ajoute la commune et le rayon, le national ne les met pas', async () => {
  const [avecVille] = await urlsDemandees({
    intitule: 'juriste', ville: { nom: 'Nancy', codeInsee: '54395' },
    rayonKm: 30, depuisDate: '2026-07-22',
  });
  const p1 = new URL(avecVille).searchParams;
  assert.equal(p1.get('commune'), '54395');
  assert.equal(p1.get('distance'), '30');

  const [national] = await urlsDemandees({
    intitule: 'juriste', ville: null, rayonKm: 30, depuisDate: '2026-07-22',
  });
  const p2 = new URL(national).searchParams;
  assert.equal(p2.get('commune'), null);
  assert.equal(p2.get('distance'), null);
});
