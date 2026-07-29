// Orchestration des sources d'offres.
//
// Deux garanties :
//  - une source en panne est journalisée et ignorée, les autres continuent ;
//  - une source non configurée (clé absente du .env) est sautée sans bruit.
// L'application fonctionne donc avec une seule clé sur quatre.
import { offreId } from '../hash.js';

/**
 * Interroge toutes les sources configurées, pour chaque intitulé,
 * sur chaque ville prioritaire puis au niveau national.
 *
 * @returns {Promise<{offres: object[], sourcesOk: string[], sourcesEnEchec: string[], sourcesIgnorees: string[]}>}
 */
export async function collecterDepuisSources(sources, { intitules, villes, rayonKm, depuisDate, profil }) {
  const brutes = [];
  const sourcesOk = new Set();
  const sourcesEnEchec = new Set();
  const sourcesIgnorees = [];

  for (const source of sources) {
    // Le profil est transmis à estConfiguree() : toutes les sources ne se
    // configurent pas dans .env. Les flux RSS, par exemple, se déclarent dans
    // profile.json — c'est là que vivent déjà les villes et les intitulés.
    if (!source.estConfiguree(profil)) {
      sourcesIgnorees.push(source.nom);
      console.log(`  ⏭  ${source.nom} : non configurée, ignorée`);
      continue;
    }

    for (const intitule of intitules) {
      // Passe prioritaire (une requête par ville) puis passe nationale (ville = null).
      for (const ville of [...villes, null]) {
        try {
          const resultats = await source.chercher({ intitule, ville, rayonKm, depuisDate, profil });
          for (const offre of resultats) {
            brutes.push({ ...offre, source: source.nom });
          }
          sourcesOk.add(source.nom);
        } catch (erreur) {
          // Une requête en échec ne compromet ni les autres requêtes ni les autres sources.
          sourcesEnEchec.add(source.nom);
          console.warn(`  ⚠  ${source.nom} [${intitule} / ${ville?.nom ?? 'France'}] : ${erreur.message}`);
        }
      }
    }
  }

  // Une source ayant réussi au moins une requête n'est pas comptée en échec.
  for (const nom of sourcesOk) sourcesEnEchec.delete(nom);

  return {
    offres: fusionner(brutes),
    sourcesOk: [...sourcesOk],
    sourcesEnEchec: [...sourcesEnEchec],
    sourcesIgnorees,
  };
}

/**
 * Dédoublonne par identifiant stable (titre + entreprise + ville).
 * Fusionne la même offre republiée sur plusieurs plateformes :
 * la description la plus longue gagne, les sources s'accumulent.
 */
export function fusionner(brutes) {
  const parId = new Map();

  for (const brute of brutes) {
    const id = offreId(brute.titre, brute.entreprise, brute.ville);
    const existante = parId.get(id);

    if (!existante) {
      parId.set(id, { ...brute, id, sourcesAll: [brute.source] });
      continue;
    }

    if (!existante.sourcesAll.includes(brute.source)) {
      existante.sourcesAll.push(brute.source);
    }
    // La description la plus longue est la plus utile pour l'analyse.
    if ((brute.description || '').length > (existante.description || '').length) {
      existante.description = brute.description;
      existante.source = brute.source;
      existante.externalId = brute.externalId;
    }
    existante.salaireSource = existante.salaireSource || brute.salaireSource;
    existante.lien = existante.lien || brute.lien;
  }

  return [...parId.values()];
}
