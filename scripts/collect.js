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
import { dirname, join } from 'node:path';
import {
  ouvrirBase, upsertOffre, ecrireMeta, transaction, purgerOffresPerimees, enregistrerAnalyse,
  offresHorsProfil, supprimerOffres, idsRejetes, purgerSansReponse,
} from '../src/db.js';
import { peutAnalyser, noterAppel, fermerAnalyse, etatQuota, ANALYSE } from '../src/quota.js';
import { sauvegarder } from '../src/sauvegarde.js';
import { corrigerBase } from './corriger-departements.js';
import { consoliderBase } from './fusionner-republications.js';

/** Racine du projet — la sauvegarde y prend le profil, le CV et les clés. */
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
import { collecterDepuisSources } from '../src/sources/index.js';
import { scorer } from '../src/scoring.js';
import { analyserOffre } from '../src/analyze.js';
import { deduireDepartement, estDansZonePrioritaire } from '../src/zone.js';

// Le rattachement géographique vit dans src/zone.js : l'interface en a besoin
// pour ranger les offres par ville, et une seconde implémentation finirait par
// diverger de celle-ci. Réexporté ici pour les appelants historiques.
export { estDansZonePrioritaire } from '../src/zone.js';

import franceTravail from '../src/sources/franceTravail.js';
import adzuna from '../src/sources/adzuna.js';
import jooble from '../src/sources/jooble.js';
import flux from '../src/sources/rss.js';
import indeed from '../src/sources/indeed.js';

export const SOURCES = [franceTravail, adzuna, jooble, flux, indeed];

/**
 * Nombre d'offres analysées par collecte, tant que `profile.json` n'en décide
 * pas autrement (clé `analysesParCollecte`).
 *
 * 25 × 4 collectes par jour = 100 analyses, ce qui laisse de la marge sur le
 * quota gratuit pour les lettres — de loin le meilleur usage de ce quota.
 */
const ANALYSES_PAR_COLLECTE = 25;

/** Date ISO d'il y a N jours — borne de fraîcheur. */
function ilYaNJours(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
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

  // Ce que Benjamin a écarté pour de bon ne doit pas revenir. L'identifiant
  // étant un hash stable du contenu, une offre supprimée reviendrait à
  // l'identique tant que la source la publie — et supprimer ne servirait
  // strictement à rien.
  const rejetees = idsRejetes(db);
  let ignorees = 0;

  for (const offre of offres) {
    if (rejetees.has(offre.id)) { ignorees++; continue; }

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
  if (ignorees > 0) console.log(`  🚫 ${ignorees} offre(s) déjà écartée(s) par toi, ignorée(s)`);

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

    // BUDGET. Le quota Gemini est JOURNALIER et PARTAGÉ entre l'analyse des
    // offres et la rédaction des lettres. Une collecte toutes les 6 heures qui
    // analyse tout ce qu'elle peut le vide entièrement — et il ne reste plus
    // rien pour écrire une lettre au moment où Benjamin en veut une.
    //
    // Or une lettre vaut bien plus qu'un verdict sur une offre qu'il ne lira
    // peut-être jamais. On plafonne donc l'analyse pour lui en garder.
    const budget = Number(profil.analysesParCollecte ?? ANALYSES_PAR_COLLECTE);

    // ORDRE DE PASSAGE. Le groupe ne suffit pas à départager : avec des
    // centaines d'offres pour 25 analyses, une prioritaire à Mamoudzou
    // passait avant une prioritaire à Strasbourg, uniquement parce qu'elle
    // arrivait plus tôt dans la liste. Le quota partait dans des offres que
    // Benjamin n'ouvrira jamais.
    //
    // On départage donc, dans l'ordre : le groupe, puis la ZONE — une offre
    // hors des villes prioritaires attend son tour — puis le score.
    const candidates = retenues.filter(o => o.groupe !== 3 && !dejaAnalysees.has(o.id));

    const aAnalyser = candidates
      .sort((a, b) =>
        RANG[a.groupe] - RANG[b.groupe]
        || (a.horsZone ? 1 : 0) - (b.horsZone ? 1 : 0)
        || (b.score ?? 0) - (a.score ?? 0))
      .slice(0, budget);

    if (candidates.length > budget) {
      const dansLaZone = aAnalyser.filter(o => !o.horsZone).length;
      console.log(`  ⏳ ${budget} analyses ce tour-ci sur ${candidates.length} en attente — ${dansLaZone} dans tes villes.`);
    }

    // S'acharner après plusieurs refus d'affilée ne fait que rallonger la
    // collecte : le quota est journalier, il ne se rouvrira pas dans la minute.
    const ECHECS_AVANT_ABANDON = 5;
    let echecsConsecutifs = 0;

    for (const offre of aAnalyser) {
      // LA RÉSERVE. Vérifiée avant CHAQUE appel, pas une fois pour toutes :
      // une lettre rédigée pendant la collecte consomme du quota elle aussi.
      const feuVert = peutAnalyser(db, profil);
      if (!feuVert.ok) {
        console.log(`  🛑 Analyse arrêtée — ${feuVert.raison}`);
        break;
      }

      let resultat = null;
      try {
        resultat = await analyse(offre, cv);
      } catch (erreur) {
        console.warn(`  ⚠ Analyse impossible pour « ${offre.titre} » : ${erreur.message}`);
      }

      if (resultat) {
        noterAppel(db, ANALYSE);
        enregistrerAnalyse(db, offre.id, resultat);
        analysees++;
        echecsConsecutifs = 0;
        console.log(`  ✓ analysée : ${offre.titre}`);
      } else if (++echecsConsecutifs >= ECHECS_AVANT_ABANDON) {
        // Cinq refus d'affilée : le plafond du jour est atteint, quel que
        // soit le compte qu'on tenait. On ferme l'analyse pour la journée,
        // ce qui préserve les modèles encore disponibles pour les lettres.
        fermerAnalyse(db);
        console.warn(`  ⏸ Analyse fermée pour aujourd'hui après ${ECHECS_AVANT_ABANDON} refus d'affilée.`);
        console.warn('    Le quota restant est gardé pour les lettres de motivation.');
        break;
      }
    }
  }

  // Nettoyage : offres disparues depuis 30 jours sur lesquelles rien n'a été fait.
  const purgees = purgerOffresPerimees(db, 30);
  if (purgees > 0) console.log(`  🧹 ${purgees} offre(s) périmée(s) purgée(s)`);

  // Nettoyage des offres hors profil, si le profil le demande.
  //
  // Une collecte ratisse large exprès, et en ramène donc beaucoup à écarter :
  // une seule passe a remis 300 offres du groupe 3 dans une base qu'on venait
  // de nettoyer. Sans ce balayage, `npm run nettoyer` devient une corvée
  // manuelle à répéter indéfiniment.
  //
  // DÉSACTIVÉ PAR DÉFAUT : une suppression est irrécupérable, et l'activer
  // sans le savoir viderait l'onglet « 🔴 À écarter » de son contenu. Les
  // protections restent les mêmes que partout ailleurs — statut, envoi,
  // relance, note, épingle, lettre ou saisie manuelle mettent une offre à
  // l'abri.
  let horsProfil = 0;
  if (profil.nettoyageAutomatique) {
    const aEnlever = offresHorsProfil(db);
    horsProfil = supprimerOffres(db, aEnlever.map(o => o.id), 'hors-profil');
    if (horsProfil > 0) {
      const ecartees = aEnlever.filter(o => o.motif === 'ecartee').length;
      console.log(`  🧹 ${horsProfil} offre(s) hors profil enlevée(s) — ${ecartees} écartées au score, ${horsProfil - ecartees} refusées par l'analyse`);
    }
  }

  // Cohérence des départements, à CHAQUE tour.
  //
  // Une correction ponctuelle ne tient pas : la source qui a produit le
  // mauvais département le reproduit au passage suivant. Constaté sur une
  // offre à Metz étiquetée 67 — remise à 57 à la main, revenue à 67 dès la
  // collecte d'après, et de nouveau affichée dans l'onglet Strasbourg. Une
  // erreur qui repousse doit être traitée là où elle repousse.
  //
  // La passe ne corrige que ce dont elle est sûre : majorité NETTE d'une
  // commune sur son département, ou numéro d'arrondissement pris pour un
  // département. Le reste est laissé tel quel.
  const departementsCorriges = corrigerBase(db);
  if (departementsCorriges > 0) {
    console.log(`  📍 ${departementsCorriges} département(s) incohérent(s) corrigé(s)`);
  }

  // Republications : la même annonce diffusée ville par ville. La fusion à la
  // collecte les empêche d'ENTRER en double ; cette passe referme le cas des
  // lignes déjà présentes sous un ancien identifiant. Elle ne touche jamais à
  // une offre portant une candidature, une lettre ou une note.
  const copiesRetirees = consoliderBase(db, profil.villesPrioritaires ?? []);
  if (copiesRetirees > 0) {
    console.log(`  🧷 ${copiesRetirees} copie(s) d'annonces republiées regroupée(s)`);
  }

  // Offres restées « À postuler » trop longtemps. Réglé par `sansReponseJours`
  // dans profile.json ; absent, rien ne se passe.
  const sansReponse = purgerSansReponse(db, Number(profil.sansReponseJours ?? 0));
  if (sansReponse > 0) {
    console.log(`  🧹 ${sansReponse} offre(s) sans suite depuis ${profil.sansReponseJours} jours, écartée(s)`);
  }

  // Sauvegarde. En DERNIER, une fois la base dans son état définitif du tour.
  //
  // Ici plutôt que dans une tâche à part : une sauvegarde qu'il faut penser à
  // déclencher n'est pas une sauvegarde. La collecte tourne déjà quatre fois
  // par jour — elle est le bon moment.
  //
  // Elle ne peut pas faire échouer la collecte : `sauvegarder` ne lève jamais.
  const sauvegarde = sauvegarder(db, { racine: RACINE, profil });
  if (sauvegarde.ok) {
    const mo = (sauvegarde.octets / 1048576).toFixed(1);
    console.log(`  💾 Sauvegarde : ${sauvegarde.chemin} (${mo} Mo)${sauvegarde.supprimees ? `, ${sauvegarde.supprimees} ancienne(s) retirée(s)` : ''}`);
  } else if (sauvegarde.erreur !== 'sauvegarde désactivée dans profile.json') {
    console.warn(`  ⚠ Sauvegarde impossible : ${sauvegarde.erreur}`);
  }

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
    horsProfil,
    sansReponse,
    ignorees,
    quota: etatQuota(db, profil),
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
