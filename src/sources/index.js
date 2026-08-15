// Orchestration des sources d'offres.
//
// Deux garanties :
//  - une source en panne est journalisée et ignorée, les autres continuent ;
//  - une source non configurée (clé absente du .env) est sautée sans bruit.
// L'application fonctionne donc avec une seule clé sur quatre.
import { offreId } from '../hash.js';
import { villeDeRattachement } from '../zone.js';

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
    offres: fusionner(brutes, villes),
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
export function fusionner(brutes, villesPrioritaires = []) {
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

  return regrouperRepublications([...parId.values()], villesPrioritaires);
}

/**
 * Regroupe la MÊME annonce republiée ville par ville.
 *
 * LE PROBLÈME, MESURÉ SUR LA BASE RÉELLE.
 * Les cabinets de recrutement diffusent une annonce unique sur toute la
 * France, une ligne par ville. « h/f Chargé d'affaires photovoltaïque — LTd »
 * apparaissait DIX fois : La Rochelle, Pau, Grenoble, Annecy,
 * Clermont-Ferrand, Bourg-en-Bresse, Toulouse, Savoie, Var, Bouches-du-Rhône.
 * Sur 386 offres, 55 étaient de ce type — 14 % de la base.
 *
 * Le coût n'était pas seulement le tri : Gemini analysait chaque copie
 * séparément. 28 analyses dépensées deux fois ou plus, sur un budget
 * quotidien de 200 dont 40 réservées aux lettres.
 *
 * LE CRITÈRE EST LA DESCRIPTION, PAS LA VILLE.
 * Deux postes réellement distincts dans deux villes ont deux descriptions
 * différentes ; une annonce republiée a exactement le même texte — vérifié
 * par empreinte, les dix copies partageaient la même au caractère près. On ne
 * regroupe donc que sur description identique : un employeur qui ouvre
 * vraiment deux postes garde ses deux lignes.
 *
 * L'IDENTIFIANT DES OFFRES NORMALES NE BOUGE PAS. Seules les annonces
 * réellement republiées reçoivent un identifiant sans ville — sinon toutes
 * les offres déjà en base changeraient d'identité, et le suivi de candidature
 * comme les lettres, qui s'y rattachent, seraient orphelins.
 */
function regrouperRepublications(offres, villesPrioritaires) {
  const groupes = new Map();
  for (const o of offres) {
    // La description EST la clé : c'est elle qui distingue une republication
    // d'un poste distinct portant le même intitulé.
    const cle = offreId(o.titre, o.entreprise, o.description ?? '');
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(o);
  }

  const sortie = [];
  for (const [cle, lot] of groupes) {
    if (lot.length === 1) { sortie.push(lot[0]); continue; }

    // La ville retenue est celle qui sert à quelque chose : si l'annonce
    // touche l'une des villes visées, c'est celle-là qu'il faut voir. Sinon,
    // la première par ordre alphabétique — un choix arbitraire mais STABLE,
    // pour que l'offre garde le même identifiant d'une collecte à l'autre.
    const dansLaZone = lot.filter(o => villeDeRattachement(o, villesPrioritaires));
    const candidats = (dansLaZone.length ? dansLaZone : lot)
      .slice()
      .sort((a, b) => String(a.ville ?? '').localeCompare(String(b.ville ?? ''), 'fr'));
    const retenue = candidats[0];

    sortie.push({
      ...retenue,
      // Identifiant sans ville : il ne dépend plus de la liste de villes
      // renvoyée ce jour-là, qui varie d'une collecte à l'autre.
      id: cle,
      sourcesAll: [...new Set(lot.flatMap(o => o.sourcesAll ?? [o.source]))],
      villesRepubliees: lot.length,
      salaireSource: lot.find(o => o.salaireSource)?.salaireSource ?? null,
      lien: retenue.lien || lot.find(o => o.lien)?.lien || '',
    });
  }
  return sortie;
}
