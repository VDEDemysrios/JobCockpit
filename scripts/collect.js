// Collecteur d'offres — script autonome.
//
// Appelé de façon IDENTIQUE par la tâche planifiée et par le bouton
// « Rafraîchir maintenant » du dashboard (plan 2) : un seul chemin de code,
// donc aucune divergence de comportement entre les deux déclencheurs.
//
// Usage : npm run collect
import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ouvrirBase, upsertOffre, ecrireMeta, transaction, purgerOffresPerimees, enregistrerAnalyse,
} from '../src/db.js';
import { collecterDepuisSources } from '../src/sources/index.js';
import { scorer } from '../src/scoring.js';
import { analyserOffre } from '../src/analyze.js';
import { normaliser } from '../src/hash.js';

import franceTravail from '../src/sources/franceTravail.js';
import adzuna from '../src/sources/adzuna.js';
import jooble from '../src/sources/jooble.js';
import careerjet from '../src/sources/careerjet.js';
import flux from '../src/sources/rss.js';
import indeed from '../src/sources/indeed.js';

export const SOURCES = [franceTravail, adzuna, jooble, careerjet, flux, indeed];

/** Date ISO d'il y a N jours — borne de fraîcheur. */
function ilYaNJours(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

/**
 * true si l'offre se situe dans (ou près d')une ville prioritaire.
 *
 * Les sources ne renvoient pas toutes une commune : Adzuna a renvoyé
 * « Hauts-de-Seine » (un département) et « Dammartin-en-Goële » (une commune
 * de banlieue). Un simple test sur le nom de la ville les classait « hors
 * zone » alors qu'elles sont en Île-de-France. On accepte donc aussi les
 * zones et départements limitrophes déclarés dans profile.json.
 *
 * @param {object} offre  doit porter `ville` et éventuellement `codePostal`
 */
export function estDansZonePrioritaire(offre, villesPrioritaires) {
  // Le libellé géographique est découpé en SEGMENTS (« France », « Île-de-France »,
  // « Seine-et-Marne », « Dammartin-en-Goële »), comparés entiers.
  //
  // Comparer par sous-chaîne serait piégeux : « Bouches-du-Rhône » (13)
  // contient « Rhône » (69) et Fuveau se retrouvait classé près de Lyon.
  const segments = [offre.ville ?? '', ...String(offre.zone ?? '').split(',')]
    .map(normaliser)
    .filter(Boolean);

  const departement = deduireDepartement(offre);

  return villesPrioritaires.some(v => {
    // Le nom de la ville prioritaire est distinctif : une inclusion suffit
    // (« Eurométropole de Strasbourg » doit correspondre à Strasbourg).
    const nomVille = normaliser(v.nom);
    if (segments.some(s => s.includes(nomVille))) return true;

    // Les zones limitrophes, elles, exigent une correspondance EXACTE.
    const proches = (v.zonesProches ?? []).map(normaliser);
    if (segments.some(s => proches.includes(s))) return true;

    const deps = v.departementsProches ?? [v.departement];
    return Boolean(departement) && deps.includes(departement);
  });
}

/**
 * Déduit le département depuis un code postal, une ville « X (67) »,
 * ou un libellé de zone « 54 - NANCY » / « Strasbourg, 67 ».
 */
function deduireDepartement(offre) {
  // On balaie les trois champs : le code postal est absent chez Adzuna, et
  // « 54 - NANCY » (France Travail) ou « Strasbourg, 67 » (Jooble) ne portent
  // le code que dans le libellé de zone.
  const source = `${offre.codePostal ?? ''} ${offre.ville ?? ''} ${offre.zone ?? ''}`;
  const trouve = source.match(/\b(\d{2})\d{0,3}\b/);
  return trouve ? trouve[1] : null;
}

/**
 * Exécute une collecte complète.
 * @param {object} options
 * @param {object} options.db        base ouverte via ouvrirBase()
 * @param {object} options.profil    contenu de profile/profile.json
 * @param {object[]} options.sources adaptateurs de sources
 * @param {string} options.cv        texte du CV
 * @param {boolean} options.analyser lancer l'analyse LLM (false dans les tests)
 * @param {Function} [options.analyserOffre] injectable pour les tests
 * @returns {Promise<object>} résumé de la collecte
 */
export async function collecter({
  db, profil, sources, cv, analyser = true, analyserOffre: analyse = analyserOffre,
}) {
  const debut = Date.now();
  const depuisDate = ilYaNJours(profil.fraicheurJours);

  console.log(`\n🔎 Collecte — offres publiées depuis le ${depuisDate}`);

  // 1-3. Requêtes, isolation des pannes, dédoublonnage.
  const { offres, sourcesOk, sourcesEnEchec, sourcesIgnorees } =
    await collecterDepuisSources(sources, {
      intitules: profil.intitules,
      villes: profil.villesPrioritaires,
      rayonKm: profil.rayonKm,
      depuisDate,
      profil,
    });

  console.log(`  ${offres.length} offre(s) distincte(s) après dédoublonnage`);

  const retenues = [];

  for (const offre of offres) {
    // 4. Filtre de fraîcheur (certaines sources ne savent pas filtrer côté API).
    if (offre.dateOffre && offre.dateOffre < depuisDate) continue;

    // 5. Scoring déterministe.
    const { groupe, score, detail } = scorer(offre, profil);
    const horsZone = !estDansZonePrioritaire(offre, profil.villesPrioritaires);

    // 6. Filtre hors zone : hors des villes prioritaires, on ne garde que
    //    les groupes 1 (Prioritaire) et 2 (Possible).
    if (horsZone && groupe !== 1 && groupe !== 2) continue;

    retenues.push({
      ...offre,
      groupe,
      score,
      scoreDetail: detail,
      horsZone: horsZone ? 1 : 0,
      departement: deduireDepartement(offre),
    });
  }

  console.log(`  ${retenues.length} offre(s) retenue(s) après filtres`);

  // 7. Écriture en base — AVANT l'analyse, en transaction, et UNIQUEMENT
  //    dans `offers`.
  //
  //    L'ordre compte. L'analyse durait quarante minutes le jour où le quota
  //    Gemini s'est épuisé en cours de route : la collecte s'est arrêtée avant
  //    l'écriture, et la moisson entière a été perdue. La récolte est un
  //    résultat en soi — elle ne doit dépendre d'aucun service extérieur.
  let nouvelles = 0;
  transaction(db, () => {
    for (const offre of retenues) {
      if (upsertOffre(db, offre).nouvelle) nouvelles++;
    }
  });

  // 8. Analyse LLM — groupes 1, 2 et 0 seulement, jamais deux fois la même
  //    offre, et les prioritaires d'abord.
  let analysees = 0;
  if (analyser) {
    const dejaAnalysees = new Set(
      db.prepare('SELECT id FROM offers WHERE analysis_json IS NOT NULL').all().map(r => r.id)
    );

    // Le quota gratuit ne couvre pas plusieurs centaines d'offres. À budget
    // limité, on analyse d'abord celles que Benjamin va réellement ouvrir :
    // groupe 1, puis 2, puis les « à vérifier ».
    const RANG = { 1: 0, 2: 1, 0: 2 };
    const aAnalyser = retenues
      .filter(o => o.groupe !== 3 && !dejaAnalysees.has(o.id))
      .sort((a, b) => RANG[a.groupe] - RANG[b.groupe]);

    // S'acharner après plusieurs refus d'affilée ne fait que rallonger la
    // collecte : le quota est journalier, il ne se rouvrira pas dans la minute.
    const ECHECS_AVANT_ABANDON = 5;
    let echecsConsecutifs = 0;

    for (const offre of aAnalyser) {
      let resultat = null;
      try {
        resultat = await analyse(offre, cv);
      } catch (erreur) {
        console.warn(`  ⚠ Analyse impossible pour « ${offre.titre} » : ${erreur.message}`);
      }

      if (resultat) {
        enregistrerAnalyse(db, offre.id, resultat);
        analysees++;
        echecsConsecutifs = 0;
        console.log(`  ✓ analysée : ${offre.titre}`);
      } else if (++echecsConsecutifs >= ECHECS_AVANT_ABANDON) {
        console.warn(`  ⏸ Analyse interrompue après ${ECHECS_AVANT_ABANDON} échecs d'affilée.`);
        console.warn('    Les offres sont bien enregistrées ; la prochaine collecte reprendra.');
        break;
      }
    }
  }

  // Nettoyage : offres disparues depuis 30 jours sur lesquelles rien n'a été fait.
  const purgees = purgerOffresPerimees(db, 30);
  if (purgees > 0) console.log(`  🧹 ${purgees} offre(s) périmée(s) purgée(s)`);

  // 9. Journal.
  //    « non-configure » se distingue de « ok » : sans clé d'API, une collecte
  //    ne remonte rien mais n'échoue pas non plus. Le dashboard doit dire
  //    « aucune source configurée » et non « à jour ».
  let statut;
  if (sourcesOk.length === 0 && sourcesEnEchec.length > 0) statut = 'echec';
  else if (sourcesOk.length === 0 && sourcesIgnorees.length > 0) statut = 'non-configure';
  else if (sourcesEnEchec.length > 0) statut = 'partiel';
  else statut = 'ok';

  const resume = {
    statut,
    vues: offres.length,
    retenues: retenues.length,
    nouvelles,
    analysees,
    purgees,
    sourcesOk,
    sourcesEnEchec,
    sourcesIgnorees,
    dureeSecondes: Math.round((Date.now() - debut) / 1000),
  };

  ecrireMeta(db, 'last_collect_at', new Date().toISOString());
  ecrireMeta(db, 'last_collect_status', statut);
  ecrireMeta(db, 'last_collect_summary', JSON.stringify(resume));

  return resume;
}

/** Point d'entrée en ligne de commande. */
async function principal() {
  const profil = JSON.parse(readFileSync('profile/profile.json', 'utf8'));
  const cv = existsSync('profile/cv.txt') ? readFileSync('profile/cv.txt', 'utf8') : '';

  if (!cv) {
    console.warn('⚠ profile/cv.txt absent — les offres seront collectées et scorées, mais PAS analysées.');
    console.warn('  Pour l\'ajouter : npm run extract-cv -- "chemin/vers/CV.docx"');
  }

  const db = ouvrirBase('data.db');
  try {
    const resume = await collecter({ db, profil, sources: SOURCES, cv, analyser: true });

    console.log('\n📊 Résumé');
    console.log(`  Statut          : ${resume.statut}`);
    console.log(`  Offres vues     : ${resume.vues}`);
    console.log(`  Retenues        : ${resume.retenues}`);
    console.log(`  Nouvelles       : ${resume.nouvelles}`);
    console.log(`  Analysées       : ${resume.analysees}`);
    console.log(`  Sources OK      : ${resume.sourcesOk.join(', ') || 'aucune'}`);
    if (resume.sourcesEnEchec.length) console.log(`  Sources en échec : ${resume.sourcesEnEchec.join(', ')}`);
    if (resume.sourcesIgnorees.length) console.log(`  Non configurées : ${resume.sourcesIgnorees.join(', ')}`);
    console.log(`  Durée           : ${resume.dureeSecondes} s\n`);

    if (resume.statut === 'non-configure') {
      console.warn('⚠ Aucune source configurée : rien n\'a pu être collecté.');
      console.warn('  Renseigne au moins une clé d\'API dans .env (voir .env.example).\n');
    }

    if (resume.statut === 'echec') process.exitCode = 1;
  } finally {
    db.close();
  }
}

// Ne s'exécute que si le fichier est lancé directement (pas à l'import par les tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  principal().catch(erreur => {
    console.error('❌ Collecte interrompue :', erreur.message);
    process.exitCode = 1;
  });
}
