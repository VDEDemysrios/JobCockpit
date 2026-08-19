// Routes de l'API REST.
//
// Toutes les réponses d'erreur suivent la forme { ok: false, error: "..." }
// avec un message en français directement affichable par le dashboard.
import express from 'express';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normaliser } from './hash.js';
import { villeDeRattachement } from './zone.js';
import { peutRediger, noterAppel, etatQuota, LETTRE, ENTRETIEN, CHAT } from './quota.js';
import { estConfigure, construireProfil, rendreEnv, CLES_ENV } from './configuration.js';
import { validerVilles, decrireVille, DEPARTEMENTS, VILLES_MAX } from './villes.js';
import { verifierOffres, aVerifier } from './liens.js';
import {
  promptQuestion, promptDebrief, promptFiche, promptNotions,
  TYPES_NOTIONS, QUESTIONS_PAR_SEANCE,
} from './entretien.js';
import { demander, demanderAncre, estConfigure as geminiPret, extraireJson } from './gemini.js';
import { promptChat, resumeEtat, validerImages } from './chat.js';
import {
  fabriquerDefi, urlAutorisation, echangerCode, rafraichir, estExpire,
  appeler as appelerSpotify, resumeLecture, corpsDeLecture, resumeAppareils,
  porteesManquantes, fusionnerPortees, nombreDePistes, pisteDeLEntree, resumeFile,
} from './spotify.js';
import { chercherParoles, resumeParoles } from './paroles.js';
import {
  populaires as ytPopulaires, chercher as ytChercher, chaine as ytChaine, dureeIso,
} from './youtube.js';
import {
  demanderCode, reclamerJeton, rafraichirJeton, estExpire as twitchExpire,
  validerJeton, revoquer as revoquerTwitch,
  appeler as appelerTwitch, resumeDirects, resumeSuivies, resumeRecherche,
  resumeCategories, resumeChaines, resumeVideos,
} from './twitch.js';
import { enregistrerCv } from './cv.js';
import {
  lireMeta, ecrireMeta, upsertOffre, transaction, noterActivite,
  journaliser, SANS_ACTIVITE, supprimerOffres, oublierRejets, restaurerRejet,
} from './db.js';
import { calculerStats, isoLocal } from './stats.js';
import { offreId } from './hash.js';
import { scorer } from './scoring.js';
import { genererLettre, extraireCoordonnees } from './letter.js';
import { genererRelance } from './relance.js';
import { genererCvAdapte, calculerEcart } from './cvadapte.js';
import { construireDocx, nomFichier } from './letterDocx.js';
import { construireDossier, nomDossier } from './dossier.js';
import { extraireOffreCollee } from './paste.js';
import { analyserOffre } from './analyze.js';

// Les fichiers du profil sont repérés depuis la racine du projet, jamais
// depuis le dossier courant : le serveur doit pouvoir être lancé d'ailleurs
// (raccourci, service, outil de prévisualisation) sans perdre le CV.
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const CV_TEXTE = join(RACINE, 'profile/cv.txt');
const CHEMIN_PROFIL = join(RACINE, 'profile/profile.json');

/** Chemins possibles du CV d'origine, dans l'ordre de préférence. */
const SOURCES_CV = [join(RACINE, 'profile/cv-source.docx'), join(RACINE, 'profile/cv-source.pdf')];

/** Objectif de candidatures envoyées par semaine, tant qu'il n'est pas réglé. */
const OBJECTIF_DEFAUT = 5;

/** Une description entière alourdirait chaque chargement du dashboard. */
const EXTRAIT_MAX = 1400;

/**
 * @param {object} o
 * @param {() => boolean} [o.lecteurLocalActif]  le lecteur Spotify intégré est-il
 *   demandé ? C'est lui qui décide de l'ouverture de `script-src` — le serveur
 *   a besoin de le savoir à chaque réponse, pas seulement au démarrage.
 * @param {(actif: boolean) => void} [o.majLecteurLocal]  prévient le serveur
 *   qu'on vient de basculer l'option, pour qu'il n'ait pas à relire la base.
 */
export function creerRoutes({ db, collecter, sources, profil,
  lecteurLocalActif = () => false, majLecteurLocal = null }) {
  const routes = express.Router();

  // Une seule collecte à la fois : deux collectes concurrentes se marcheraient
  // dessus (quota LLM gaspillé, écritures entrelacées).
  let collecteEnCours = false;

  const cv = () => (existsSync(CV_TEXTE) ? readFileSync(CV_TEXTE, 'utf8') : '');

  /**
   * Le CV d'origine, tel qu'il sera joint à une candidature.
   *
   * Le nom du fichier envoyé à l'employeur ne doit pas être « cv-source.docx » :
   * il porte le nom du candidat, comme n'importe quel CV joint à un mail.
   */
  function cvSource() {
    const chemin = SOURCES_CV.find(existsSync);
    if (!chemin) return null;

    const nomPropre = String(profil.candidat?.nom ?? 'CV')
      .normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    return {
      nom: `CV_${nomPropre}${chemin.slice(chemin.lastIndexOf('.'))}`,
      contenu: readFileSync(chemin),
    };
  }

  /** Assemble une offre avec son suivi, pour le dashboard. */
  function lireOffres() {
    return db.prepare(`
      SELECT o.*,
             t.status, t.sent_date, t.entretien_date, t.relance_date, t.notes, t.pinned,
             CASE WHEN l.offer_id IS NULL THEN 0 ELSE 1 END AS a_lettre,
             COALESCE(l.edited, 0) AS lettre_editee
      FROM offers o
      LEFT JOIN tracking t ON t.offer_id = o.id
      LEFT JOIN letters  l ON l.offer_id = o.id
      ORDER BY o.groupe, o.score DESC
    `).all().map(o => ({
      id: o.id,
      titre: o.titre,
      entreprise: o.entreprise,
      ville: o.ville,
      contrat: o.contrat,
      dateOffre: o.date_offre,
      lien: o.lien,
      groupe: o.groupe,
      score: o.score,
      scoreDetail: o.score_detail ? JSON.parse(o.score_detail) : null,
      horsZone: Boolean(o.hors_zone),
      // Calculé à la lecture plutôt que stocké : les 264 offres déjà en base
      // se rangent ainsi dans leur onglet sans attendre une nouvelle collecte,
      // et changer une zone limitrophe dans profile.json prend effet aussitôt.
      villePrio: villeDeRattachement({
        ville: o.ville, departement: o.departement,
      }, profil.villesPrioritaires ?? []),
      sources: o.sources_all ? JSON.parse(o.sources_all) : [],
      source: o.source,
      isManual: Boolean(o.is_manual),
      salaireSource: o.salaire_source,
      villesRepubliees: o.villes_republiees ?? 1,
      // Le lien a été sondé et répond 404 : l'annonce a été retirée. Signalé
      // AVANT le clic — c'est tout l'intérêt.
      lienMort: Boolean(o.lien_mort),
      extrait: o.description ? String(o.description).slice(0, EXTRAIT_MAX) : '',
      analyse: o.analysis_json ? JSON.parse(o.analysis_json) : null,
      aLettre: Boolean(o.a_lettre),
      lettreEditee: Boolean(o.lettre_editee),
      vueLe: o.first_seen,
      suivi: {
        status: o.status ?? 'À postuler',
        sent: o.sent_date ?? '',
        relance: o.relance_date ?? '',
        entretien: o.entretien_date ?? '',
        notes: o.notes ?? '',
        pinned: Boolean(o.pinned),
      },
    }));
  }

  routes.get('/offers', (req, res) => {
    res.json({ ok: true, offres: lireOffres() });
  });

  routes.get('/meta', (req, res) => {
    const resume = lireMeta(db, 'last_collect_summary');
    res.json({
      ok: true,
      derniereCollecte: lireMeta(db, 'last_collect_at'),
      statut: lireMeta(db, 'last_collect_status'),
      resume: resume ? JSON.parse(resume) : null,
      collecteEnCours,
      migre: Boolean(lireMeta(db, 'migrated_from_localstorage')),
      // Le profil est nécessaire : la source « flux » se configure dans
      // profile.json, pas dans .env, et se déclarerait inactive sans lui.
      sources: sources.map(s => ({ nom: s.nom, configuree: s.estConfiguree(profil) })),
      villes: (profil.villesPrioritaires ?? []).map(v => v.nom),
      intitules: profil.intitules ?? [],
      // Le nom en-tête des exports. Servi depuis le profil plutôt que codé
      // dans l'interface : c'est déjà lui qui nomme les lettres Word.
      candidat: profil.candidat?.nom ?? '',
      objectifHebdo: Number(lireMeta(db, 'objectif_hebdo') ?? OBJECTIF_DEFAUT),
      // Le quota conditionne ce qui est faisable dans la journée : le savoir
      // AVANT de cliquer « Rédiger la lettre » évite de le découvrir par un
      // échec.
      quota: etatQuota(db, profil),
    });
  });

  // --- CV ------------------------------------------------------------------

  /** Le CV d'origine, à ouvrir ou à télécharger depuis la vue « Mon CV ». */
  routes.get('/cv/fichier', (req, res) => {
    const fichier = cvSource();
    if (!fichier) {
      return res.status(404).json({ ok: false, error: 'Aucun CV source. Lance : npm run extract-cv -- "chemin/vers/CV.docx"' });
    }
    res.setHeader('Content-Disposition', `attachment; filename="${fichier.nom}"`);
    res.send(fichier.contenu);
  });

  /**
   * La fiche du CV : le document joint, et la couverture des mots-clés.
   *
   * Chaque motif « positif » du scoring valorise une offre parce qu'elle
   * mentionne une compétence. Si le CV ne la porte pas, le classement
   * récompense quelque chose que l'auteur ne peut pas prouver — et
   * l'entretien le découvrira à sa place.
   */
  routes.get('/cv', (req, res) => {
    const chemin = CV_TEXTE;

    if (!existsSync(chemin)) {
      return res.json({
        ok: true, present: false,
        aide: 'Lance : npm run extract-cv -- "chemin/vers/CV.docx"',
      });
    }

    const texte = readFileSync(chemin, 'utf8');
    const infos = statSync(chemin);
    const normalise = normaliser(texte);

    const couverture = (profil.scoring?.positifs ?? []).map(regle => ({
      motif: regle.motif,
      note: regle.note ?? '',
      poids: regle.poids,
      present: new RegExp(regle.motif, 'i').test(normalise),
    }));

    // La source .docx sert à savoir si l'extraction est en retard sur elle.
    const sources = SOURCES_CV
      .filter(existsSync)
      .map(c => ({ chemin: c, modifieLe: statSync(c).mtime.toISOString() }));

    // C'est CE fichier qui part en pièce jointe : la vue doit pouvoir
    // l'annoncer par son nom et son poids, comme le verra l'employeur.
    const joint = cvSource();
    const fichier = joint && {
      nom: joint.nom,
      octets: joint.contenu.length,
      modifieLe: sources[0]?.modifieLe ?? null,
    };

    res.json({
      ok: true,
      present: true,
      texte,
      candidat: profil.candidat ?? {},
      extraitLe: infos.mtime.toISOString(),
      octets: infos.size,
      mots: texte.split(/\s+/).filter(Boolean).length,
      lignes: texte.split('\n').length,
      couverture,
      sources,
      fichier,
      // Le CV part chez Gemini à chaque analyse : le dire ici, à l'endroit
      // exact où on le consulte, vaut mieux qu'une note perdue dans le README.
      perimee: sources.some(s => new Date(s.modifieLe) > infos.mtime),
    });
  });

  // --- Suivi personnel -----------------------------------------------------

  const CHAMPS_SUIVI = {
    status: 'status', sent: 'sent_date', relance: 'relance_date',
    notes: 'notes', pinned: 'pinned',
    // LA DATE D'ENTRETIEN.
    //
    // Le statut « Entretien » existait, mais sans date : l'application savait
    // qu'on en était là, jamais QUAND. Or c'est la seule échéance d'une
    // recherche d'emploi qu'on ne peut ni décaler ni rattraper — et la seule
    // qui mérite de passer devant tout le reste du tableau de bord.
    entretien: 'entretien_date',
  };

  /**
   * Type d'événement à journaliser pour un changement de statut.
   * Un même statut atteint deux fois de suite ne rejournalise rien : sans
   * cela, corriger une faute de frappe gonflerait les quêtes du jour.
   */
  function typeDeTransition(ancien, nouveau) {
    if (ancien === nouveau) return null;
    if (nouveau === 'Envoyé') return 'candidature';
    if (nouveau === 'Relancé') return 'relance';
    if (nouveau === 'Entretien') return 'entretien';
    if (nouveau === 'Refus') return 'refus';
    return 'statut';
  }

  routes.patch('/track/:id', (req, res) => {
    const offre = db.prepare('SELECT id FROM offers WHERE id = ?').get(req.params.id);
    if (!offre) return res.status(404).json({ ok: false, error: 'Offre introuvable.' });

    const maj = Object.entries(req.body ?? {}).filter(([cle]) => cle in CHAMPS_SUIVI);

    // UNE DATE DOIT ÊTRE UNE DATE.
    //
    // Sans ce contrôle, n'importe quelle chaîne entrait dans la base : le
    // décompte avant entretien la lisait comme « invalide » et n'affichait
    // rien, donc l'échéance disparaissait de l'écran sans qu'aucune erreur ne
    // le dise. Une saisie refusée se corrige ; une échéance muette s'oublie.
    for (const [cle, valeur] of maj) {
      if (!['sent', 'relance', 'entretien'].includes(cle)) continue;
      if (valeur === '' || valeur === null || valeur === undefined) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valeur))
          || Number.isNaN(new Date(`${valeur}T00:00:00`).getTime())) {
        return res.status(400).json({ ok: false,
          error: `Date invalide pour « ${cle} » : format attendu AAAA-MM-JJ.` });
      }
    }

    if (maj.length === 0) {
      return res.status(400).json({ ok: false, error: 'Aucun champ de suivi valide fourni.' });
    }

    // La ligne de suivi peut ne pas exister encore.
    db.prepare(`INSERT INTO tracking (offer_id) VALUES (?) ON CONFLICT(offer_id) DO NOTHING`)
      .run(req.params.id);

    const avant = db.prepare('SELECT status, notes, pinned FROM tracking WHERE offer_id = ?')
      .get(req.params.id) ?? {};

    for (const [cle, valeur] of maj) {
      const colonne = CHAMPS_SUIVI[cle];
      // node:sqlite refuse les booléens et undefined.
      const v = cle === 'pinned' ? (valeur ? 1 : 0) : (valeur ?? '');
      db.prepare(`UPDATE tracking SET ${colonne} = ?, updated_at = ? WHERE offer_id = ?`)
        .run(v, new Date().toISOString(), req.params.id);
    }

    const champs = Object.fromEntries(maj);

    // Cohérence : « À postuler » signifie « pas encore envoyé ». Une date
    // d'envoi laissée derrière soi ferait mentir l'objectif de la semaine, la
    // courbe d'activité et les records — l'offre resterait comptée comme
    // envoyée alors qu'elle ne l'est plus. Et une relance planifiée pour une
    // candidature jamais partie n'a aucun sens dans l'agenda.
    //
    // On ne touche QUE les champs que l'appelant n'a pas fournis lui-même :
    // une saisie explicite reste souveraine.
    if (champs.status === 'À postuler') {
      const effacer = (cle, colonne) => {
        if (cle in champs) return;
        db.prepare(`UPDATE tracking SET ${colonne} = '' WHERE offer_id = ?`).run(req.params.id);
      };
      effacer('sent', 'sent_date');
      effacer('relance', 'relance_date');
    }

    const evenements = [];

    if ('status' in champs) {
      const type = typeDeTransition(avant.status ?? 'À postuler', champs.status);
      if (type) evenements.push(type);
    }
    // Annoter compte comme une action, mais seulement quand la note passe de
    // vide à remplie : chaque frappe de clavier ne doit pas créer un événement.
    if ('notes' in champs && String(champs.notes).trim() && !String(avant.notes ?? '').trim()) {
      evenements.push('note');
    }
    if ('pinned' in champs && champs.pinned && !avant.pinned) evenements.push('epingle');

    for (const type of evenements) {
      journaliser(db, type, { offerId: req.params.id, sansActivite: SANS_ACTIVITE.has(type) });
    }

    // On renvoie le suivi tel qu'il est RÉELLEMENT en base, pas les champs
    // demandés : le serveur peut en avoir nettoyé d'autres, et le navigateur
    // doit refléter l'état réel plutôt que de le deviner.
    const apres = db.prepare(
      'SELECT status, sent_date, relance_date, notes, pinned FROM tracking WHERE offer_id = ?'
    ).get(req.params.id) ?? {};

    res.json({
      ok: true,
      suivi: {
        status: apres.status ?? 'À postuler',
        sent: apres.sent_date ?? '',
        relance: apres.relance_date ?? '',
        notes: apres.notes ?? '',
        pinned: Boolean(apres.pinned),
      },
    });
  });

  // --- Offres ajoutées à la main -------------------------------------------

  routes.post('/offers', (req, res) => {
    const { titre, entreprise, ville, date, contrat, groupe, lien, verdict } = req.body ?? {};
    if (!titre || !entreprise) {
      return res.status(400).json({ ok: false, error: 'Titre et entreprise sont obligatoires.' });
    }

    const id = offreId(titre, entreprise, ville ?? '');
    upsertOffre(db, {
      id, source: 'manuel', sourcesAll: ['manuel'], externalId: null,
      titre, entreprise, ville: ville || '—', contrat: contrat || null,
      dateOffre: date || new Date().toISOString().slice(0, 10),
      lien: lien || null, description: verdict || null,
      groupe: Number(groupe ?? 0), score: null, scoreDetail: null,
      analysisJson: verdict ? { verdict, exige: [], souhaite: [], decoratif: [], prouvable: [],
        nonprouvable: [], compensable: [], formul: [], budget: [], kw: [],
        fourchette: null, fnote: null } : null,
      isManual: 1, horsZone: 0, departement: null, salaireSource: null,
    });

    journaliser(db, 'ajout', { offerId: id });
    res.json({ ok: true, id });
  });

  /**
   * Supprime une offre, collectée ou non.
   *
   * Une offre COLLECTÉE est en plus inscrite dans `rejetees`. Sans cela, la
   * suppression serait une illusion : l'identifiant est un hash stable du
   * contenu, et la source la republiant toujours, elle reviendrait à
   * l'identique à la collecte suivante — c'est ce qui rendait le geste
   * inutile, et pourquoi il était interdit jusqu'ici.
   *
   * Une offre saisie à la main n'a besoin d'aucun rejet : aucune source ne
   * la republiera.
   */
  routes.delete('/offers/:id', (req, res) => {
    const offre = db.prepare('SELECT is_manual, titre FROM offers WHERE id = ?').get(req.params.id);
    if (!offre) return res.status(404).json({ ok: false, error: 'Offre introuvable.' });

    supprimerOffres(db, [req.params.id], offre.is_manual ? null : 'manuel');
    journaliser(db, 'ecarte', { offerId: req.params.id, meta: { titre: offre.titre }, sansActivite: true });

    // `annulable` dit à l'interface si elle peut proposer un retour en arrière.
    // Une offre saisie à la main n'a pas de sauvegarde : elle n'est pas
    // « écartée » mais supprimée, et rien ne la reconstituerait.
    res.json({ ok: true, definitif: !offre.is_manual, annulable: !offre.is_manual });
  });

  /**
   * Remet une offre écartée exactement là où elle était.
   *
   * Écarter se fait en un clic ; se tromper aussi. Sans ce retour, la seule
   * issue était « Tout remettre », qui ramène des milliers d'offres du ménage
   * automatique avec la seule qu'on visait.
   */
  routes.post('/offers/:id/restaurer', (req, res) => {
    const restauree = restaurerRejet(db, req.params.id);
    if (!restauree) {
      return res.status(410).json({ ok: false,
        error: 'Cette offre ne peut plus être remise : aucune sauvegarde ne lui est attachée.' });
    }
    res.json({ ok: true });
  });

  /**
   * Dépôt d'un CV, par glisser-déposer ou par le sélecteur de fichier.
   *
   * Le corps arrive BRUT plutôt qu'en multipart : le multipart demanderait une
   * dépendance de plus pour un seul point d'entrée, et l'analyse d'un formulaire
   * en plusieurs parties est exactement le genre de code où l'on se trompe.
   * Un fichier, une requête, le nom dans un en-tête.
   */
  routes.post('/cv',
    express.raw({ type: () => true, limit: '10mb' }),
    async (req, res) => {
      const nom = decodeURIComponent(String(req.get('X-Nom-Fichier') ?? '')).trim();
      if (!nom) {
        return res.status(400).json({ ok: false, error: 'Nom de fichier manquant.' });
      }
      try {
        const r = await enregistrerCv(req.body, nom, RACINE);
        journaliser(db, 'cv', { meta: { caracteres: r.caracteres }, sansActivite: true });
        res.json({ ok: true, caracteres: r.caracteres });
      } catch (erreur) {
        // Les refus sont des messages écrits pour être lus : on les rend tels
        // quels plutôt que de les remplacer par « erreur interne ».
        res.status(400).json({ ok: false, error: erreur.message });
      }
    });

  // --- Premier lancement --------------------------------------------------

  /**
   * L'état RÉEL de la configuration, lu sur le disque.
   *
   * `profil` est l'objet chargé au démarrage du serveur : il ne bouge plus
   * ensuite. S'y fier ici laissait l'assistant se soumettre autant de fois
   * qu'on voulait après la première — chaque envoi écrasant le précédent,
   * puisque le serveur croyait toujours n'être pas configuré. Trouvé en
   * essayant de forcer le garde-fou, pas en le relisant.
   */
  function profilSurDisque() {
    try {
      return JSON.parse(readFileSync(CHEMIN_PROFIL, 'utf8'));
    } catch {
      return null;
    }
  }

  /** L'assistant a-t-il encore quelque chose à faire ? */
  routes.get('/configuration', (req, res) => {
    const surDisque = profilSurDisque();
    res.json({
      ok: true,
      configure: estConfigure(surDisque),
      candidat: surDisque?.candidat?.nom ?? '',
      // Le serveur tourne-t-il encore avec l'ancien profil ? L'assistant s'en
      // sert pour dire « redémarre » plutôt que de laisser croire à un échec.
      chargeEnMemoire: estConfigure(profil),
    });
  });

  /**
   * Écrit le profil et les clés d'après les réponses de l'assistant.
   *
   * REFUSE SI L'APPLICATION EST DÉJÀ CONFIGURÉE. Sans ce garde-fou, la route
   * réécrirait un profil existant — villes, intitulés, scoring ajusté au fil
   * des semaines — sur un simple appel. Reconfigurer se fait en éditant le
   * fichier, geste qui a le mérite d'être délibéré.
   */
  routes.post('/configuration', (req, res) => {
    // Sur le DISQUE, pas en mémoire : le profil chargé au démarrage ne change
    // pas quand l'assistant écrit le fichier, et le garde-fou ne gardait donc
    // rien après le premier envoi.
    if (estConfigure(profilSurDisque())) {
      return res.status(409).json({ ok: false,
        error: 'Déjà configuré. Tes villes et tes réglages se modifient dans les Options.' });
    }

    const r = req.body ?? {};
    if (!String(r.nom ?? '').trim()) {
      return res.status(400).json({ ok: false, error: 'Le nom est nécessaire : il signe tes lettres.' });
    }
    const nouveau = construireProfil(r);
    if (!nouveau.intitules.length) {
      return res.status(400).json({ ok: false, error: 'Indique au moins un intitulé de poste recherché.' });
    }
    if (!nouveau.villesPrioritaires.length) {
      return res.status(400).json({ ok: false,
        error: 'Indique au moins une ville, avec son code postal — c\'est lui qui donne le département.' });
    }

    try {
      writeFileSync(CHEMIN_PROFIL, JSON.stringify(nouveau, null, 2) + '\n');
      writeFileSync(join(RACINE, '.env'), rendreEnv(r.cles, process.env));
    } catch (erreur) {
      return res.status(500).json({ ok: false, error: `Écriture impossible : ${erreur.message}` });
    }

    // LE PROFIL EN MÉMOIRE SUIT, EN PLACE.
    //
    // Il fallait auparavant relancer l'application pour que la configuration
    // s'applique — sur un outil qu'on vient de télécharger, finir l'assistant
    // pour s'entendre dire « maintenant, redémarre » est le pire moment pour
    // demander un effort.
    //
    // `profil` est le même objet que celui tenu par le planificateur de
    // collecte : on le vide et on le remplit, plutôt que de le remplacer, sans
    // quoi la collecte tournerait encore sur l'ancien — ou sur le profil
    // d'exemple, ce qui est pire, car il a l'air valable.
    for (const cle of Object.keys(profil)) delete profil[cle];
    Object.assign(profil, nouveau);

    // LES CLÉS AUSSI, SINON LA RÉPONSE MENTIRAIT.
    //
    // Écrire `.env` ne recharge pas `process.env` : les sources continueraient
    // de se déclarer non configurées, et la première collecte ne ramènerait
    // rien — l'utilisateur croirait avoir mal saisi ses clés alors qu'elles
    // étaient bonnes.
    //
    // Seuls les noms connus sont posés, et nettoyés comme pour le fichier :
    // on ne laisse pas une saisie choisir quelle variable d'environnement
    // écrire.
    for (const cle of CLES_ENV) {
      const valeur = String(r.cles?.[cle] ?? '').replace(/[\r\n]+/g, ' ').trim();
      if (valeur) process.env[cle] = valeur;
    }

    res.json({ ok: true, redemarrageRequis: false });
  });

  /**
   * LES VILLES, APRÈS COUP.
   *
   * L'assistant de première configuration ne passe qu'une fois, et jusqu'ici
   * changer de villes voulait dire éditer `profile/profile.json` à la main.
   * C'était tenable pour celui qui avait écrit le fichier ; ça ne l'est pour
   * personne d'autre. Un déménagement, une ville qu'on abandonne, une qu'on
   * ajoute — ce sont des évènements ordinaires d'une recherche d'emploi, pas
   * des reconfigurations.
   */
  /**
   * VÉRIFIER QUE LES LIENS MÈNENT ENCORE QUELQUE PART.
   *
   * Une offre reste listée après avoir été retirée du site qui la publiait.
   * On la lit, on la juge intéressante, on clique — « cette offre n'est plus
   * disponible ». Le temps perdu compte peu ; l'élan, beaucoup : c'est
   * exactement le moment où l'on décidait de postuler.
   *
   * Voir `src/liens.js` pour ce qui a été mesuré, et pourquoi seul un 404 ou
   * un 410 conclut. Dans le doute, l'offre reste : une offre morte laissée
   * coûte un clic, une offre vivante supprimée ne se retrouve jamais.
   */
  routes.post('/liens/verifier', async (req, res) => {
    const maximum = Math.min(Number(req.body?.maximum) || 40, 120);
    const derniere = lireMeta(db, 'last_collect_at') ?? new Date().toISOString();

    const candidates = aVerifier(
      db.prepare('SELECT id, lien, last_seen, lien_verifie_le, lien_mort FROM offers').all(),
      derniere);

    if (!candidates.length) {
      return res.json({ ok: true, verifiees: 0, mortes: 0, restantes: 0,
        message: 'Toutes les offres ont été revues à la dernière collecte : rien à vérifier.' });
    }

    const resultats = await verifierOffres(candidates, { maximum });

    const marquer = db.prepare(
      'UPDATE offers SET lien_verifie_le = ?, lien_mort = ? WHERE id = ?');
    const maintenant = new Date().toISOString();
    let mortes = 0;
    transaction(db, () => {
      for (const r of resultats) {
        // Seul « morte » écrit un drapeau. « indetermine » note seulement le
        // passage, pour ne pas re-sonder dans la foulée un site qui nous
        // refuse l'entrée.
        const mort = r.etat === 'morte' ? 1 : 0;
        if (mort) mortes++;
        marquer.run(maintenant, mort, r.id);
      }
    });

    // `sansActivite` : une vérification automatique n'est pas une action de
    // candidature. La compter gonflerait le calendrier d'assiduité d'un
    // travail que personne n'a fait.
    journaliser(db, 'liens-verifies', {
      sansActivite: true,
      meta: { verifiees: resultats.length, mortes },
    });
    res.json({ ok: true,
      verifiees: resultats.length,
      mortes,
      indetermines: resultats.filter(r => r.etat === 'indetermine').length,
      restantes: Math.max(0, candidates.length - resultats.length) });
  });

  // --- Préparation d'entretien -----------------------------------------
  //
  // L'application menait jusqu'à la candidature, puis s'arrêtait. Or c'est
  // l'entretien qui décide, et c'est là qu'on est le plus seul.

  /** La séance en cours pour une offre, ou une séance vide. */
  function lireEntretien(id) {
    const l = db.prepare('SELECT * FROM entretiens WHERE offer_id = ?').get(id);
    return {
      echanges: l?.echanges ? JSON.parse(l.echanges) : [],
      debrief: l?.debrief ?? null,
      fiche: l?.fiche ?? null,
      notions: l?.notions ? JSON.parse(l.notions) : [],
      liens: l?.liens ? JSON.parse(l.liens) : [],
    };
  }

  function ecrireEntretien(id, { echanges, debrief, fiche, notions, liens }) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO entretiens (offer_id, echanges, debrief, fiche, notions, liens, cree_le, maj_le)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(offer_id) DO UPDATE SET
        echanges = excluded.echanges, debrief = excluded.debrief,
        fiche = excluded.fiche, notions = excluded.notions,
        liens = excluded.liens, maj_le = excluded.maj_le
    `).run(id, JSON.stringify(echanges ?? []), debrief ?? null, fiche ?? null,
           JSON.stringify(notions ?? []), JSON.stringify(liens ?? []), now, now);
  }

  /** L'offre et son analyse, telles que les prompts les attendent. */
  function offrePourEntretien(id) {
    const o = db.prepare('SELECT * FROM offers WHERE id = ?').get(id);
    if (!o) return null;
    return { offre: o, analyse: o.analysis_json ? JSON.parse(o.analysis_json) : null };
  }

  // --- Spotify -------------------------------------------------------------
  //
  // Flux PKCE : aucun `client_secret`, seulement un `client_id` qui est public
  // par conception. L'échange et les appels passent par LE SERVEUR — les
  // jetons ne descendent jamais dans la page, et la politique de sécurité
  // n'a pas à s'ouvrir vers un tiers.

  /** Le vérificateur en attente, entre la redirection et le retour. */
  let attenteSpotify = null;

  const clientSpotify = () => process.env.SPOTIFY_CLIENT_ID ?? '';
  const REDIRECTION = 'http://127.0.0.1:3000/spotify/retour';

  const lireJetons = () => {
    const brut = lireMeta(db, 'spotify_jetons');
    try { return brut ? JSON.parse(brut) : null; } catch { return null; }
  };
  const ecrireJetons = (j) => ecrireMeta(db, 'spotify_jetons', j ? JSON.stringify(j) : '');

  /** Un jeton valide, renouvelé si besoin. Null si non connecté. */
  async function jetonValide() {
    let j = lireJetons();
    if (!j?.acces) return null;
    if (!estExpire(j)) return j.acces;
    if (!j.refresh) return null;
    const neuf = await rafraichir({ clientId: clientSpotify(), refresh: j.refresh });
    ecrireJetons(fusionnerPortees(neuf, j));
    return neuf.acces;
  }

  /** Le jeton entier, renouvelé si besoin — pour ce qui a besoin de sa date. */
  async function jetonComplet() {
    await jetonValide();
    return lireJetons();
  }

  /**
   * 401 EST RÉSERVÉ À LA SESSION DE JOB COCKPIT. Un service tiers déconnecté
   * répond 409.
   *
   * Le code 401 déclenche, côté navigateur, un renvoi immédiat vers la page de
   * connexion : c'est la bonne réaction quand c'est NOTRE cookie qui a expiré,
   * puisque plus rien ne fonctionnera. Rendu pour un jeton Spotify mort, il
   * éjectait l'utilisateur de son tableau de bord — offres, suivi, lettres —
   * parce qu'il venait de cliquer sur « pause ». La panne était ailleurs, et
   * la sanction totale.
   */
  const NON_LIE = 409;

  /** Appel relayé, avec UNE reprise si le jeton vient d'expirer. */
  async function spotify(chemin, options = {}) {
    const acces = await jetonValide();
    if (!acces) throw Object.assign(new Error('Spotify non connecté.'), { statut: NON_LIE });
    try {
      return await appelerSpotify(chemin, { ...options, acces });
    } catch (e) {
      if (!e.expire) throw e;
      ecrireJetons(null);
      throw Object.assign(new Error('Session Spotify expirée — reconnecte-toi.'),
        { statut: NON_LIE });
    }
  }

  routes.get('/spotify/etat', async (req, res) => {
    if (!clientSpotify()) {
      return res.json({ ok: true, configure: false, connecte: false,
        aide: 'Ajoute SPOTIFY_CLIENT_ID dans .env — il est public, pas de secret à fournir.' });
    }
    const j = lireJetons();
    if (!j?.acces) return res.json({ ok: true, configure: true, connecte: false });

    // Ce que l'interface a besoin de savoir sur le lecteur intégré : est-il
    // demandé, et l'autorisation en cours le permet-elle ? Un compte lié avant
    // son arrivée n'a pas la portée `streaming` — le SDK échouerait sur un
    // message que personne ne peut relier à « ton autorisation date d'avant ».
    const lecteur = {
      actif: lecteurLocalActif(),
      manque: porteesManquantes(j.portees),
    };

    try {
      const d = await spotify('/me/player');
      res.json({ ok: true, configure: true, connecte: true, lecteur, lecture: resumeLecture(d) });
    } catch (e) {
      res.json({ ok: true, configure: true, connecte: e.statut !== NON_LIE,
        lecteur, erreur: e.message });
    }
  });

  /**
   * LE JETON, REMIS À LA PAGE — et c'est la seule route du projet qui le fait.
   *
   * Tout le reste du code Spotify existe pour que ce jeton NE DESCENDE JAMAIS
   * dans le navigateur : le serveur le détient et sert de relais. Le SDK de
   * Spotify, lui, n'a pas d'autre moyen de fonctionner — il joue dans la page,
   * donc il lui faut un jeton dans la page.
   *
   * Trois garde-fous, puisqu'on ne peut pas éviter le principe :
   *   · la route REFUSE tant que le lecteur intégré n'est pas activé. Sans
   *     l'option, ce jeton reste inaccessible depuis le navigateur ;
   *   · elle ne rend que le jeton d'accès, jamais celui de rafraîchissement —
   *     un jeton volé meurt en une heure, il ne se renouvelle pas ;
   *   · côté page, il vit dans une fermeture et n'est jamais écrit dans le
   *     `localStorage`.
   */
  routes.get('/spotify/jeton-lecteur', async (req, res) => {
    if (!lecteurLocalActif()) {
      return res.status(NON_LIE).json({ ok: false,
        error: 'Le lecteur intégré n\'est pas activé.' });
    }
    try {
      const j = await jetonComplet();
      if (!j?.acces) throw Object.assign(new Error('Spotify non connecté.'), { statut: NON_LIE });
      const manque = porteesManquantes(j.portees);
      if (manque.length) {
        return res.status(NON_LIE).json({ ok: false,
          error: `Autorisation incomplète (${manque.join(', ')}) — délie puis relie ton compte.` });
      }
      res.json({ ok: true, acces: j.acces, expireLe: j.expireLe });
    } catch (e) { res.status(e.statut ?? 502).json({ ok: false, error: e.message }); }
  });

  /**
   * L'INTERRUPTEUR DU LECTEUR INTÉGRÉ — ET DE LA POLITIQUE DE SÉCURITÉ.
   *
   * Jouer dans la page exige de charger un script de Spotify, donc d'ouvrir
   * `script-src`. Le projet a tenu cette porte fermée depuis le début, et il
   * n'y a pas de raison de l'ouvrir pour quelqu'un qui ne s'en sert pas : le
   * serveur n'élargit la politique QUE si cette option est posée. Par défaut,
   * une installation neuve garde `script-src 'self'`.
   *
   * L'en-tête étant calculé à chaque réponse, il faut recharger la page pour
   * que le changement prenne — l'interface le dit.
   */
  routes.post('/spotify/lecteur-local', (req, res) => {
    const actif = Boolean(req.body?.actif);
    ecrireMeta(db, 'spotify_lecteur_local', actif ? '1' : '');
    majLecteurLocal?.(actif);
    res.json({ ok: true, actif });
  });

  /** L'adresse d'autorisation. Le vérificateur reste ici, c'est tout l'intérêt. */
  routes.post('/spotify/connexion', (req, res) => {
    if (!clientSpotify()) {
      return res.status(400).json({ ok: false,
        error: 'SPOTIFY_CLIENT_ID absent du .env.' });
    }
    const { verificateur, defi } = fabriquerDefi();
    const etat = Math.random().toString(36).slice(2);

    // ON RETIENT D'OÙ VIENT LA DEMANDE, POUR Y RAMENER.
    //
    // Spotify n'accepte pas `localhost` comme adresse de retour : il exige la
    // boucle locale, `127.0.0.1`. Or c'est sur `localhost:3000` qu'on ouvre
    // l'application. Pour le navigateur, ce sont DEUX ORIGINES DIFFÉRENTES :
    // renvoyer bêtement vers « / » déposait l'utilisateur sur une copie de
    // l'application au `localStorage` vide — lecteur refermé, fenêtre
    // repositionnée, conversation Chill envolée. Tout était toujours là, sur
    // l'autre adresse, ce qui est le pire des symptômes : on croit avoir perdu
    // ses données en liant son compte Spotify.
    //
    // L'origine est VÉRIFIÉE avant d'être réutilisée : une redirection vers
    // une valeur d'en-tête non contrôlée est une porte ouverte.
    const origine = String(req.headers.origin ?? '');
    const retour = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origine) ? origine : '';
    attenteSpotify = { verificateur, etat, retour };

    res.json({ ok: true, url: urlAutorisation({
      clientId: clientSpotify(), redirection: REDIRECTION, defi, etat }) });
  });

  routes.post('/spotify/deconnexion', (req, res) => {
    ecrireJetons(null);
    res.json({ ok: true });
  });

  routes.get('/spotify/lecture', async (req, res) => {
    try { res.json({ ok: true, lecture: resumeLecture(await spotify('/me/player')) }); }
    catch (e) { res.status(e.statut ?? 502).json({ ok: false, error: e.message }); }
  });

  /** Borne un nombre reçu du client : une valeur folle vaut un refus Spotify. */
  const borner = (v, min, max, defaut) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : defaut;
  };

  /**
   * TOUTES LES COMMANDES DU LECTEUR, Y COMPRIS CELLES QUI MANQUAIENT.
   *
   * Le panneau ne savait faire que quatre choses : lire, mettre en pause,
   * avancer, reculer. On pouvait donc lancer un morceau — et rien d'autre :
   * ni monter le son, ni activer la lecture aléatoire, ni se placer dans un
   * morceau, ni changer d'enceinte.
   *
   * Chaque entrée rend le chemin à appeler ; celles qui prennent une valeur la
   * reçoivent en paramètre. Spotify attend ces réglages en QUERY, pas dans un
   * corps JSON — envoyés dans le corps, ils sont ignorés en silence et la
   * requête répond 204 comme si tout allait bien.
   */
  const ACTIONS_SPOTIFY = {
    lire:       { chemin: () => '/me/player/play', methode: 'PUT' },
    pause:      { chemin: () => '/me/player/pause', methode: 'PUT' },
    suivant:    { chemin: () => '/me/player/next', methode: 'POST' },
    precedent:  { chemin: () => '/me/player/previous', methode: 'POST' },
    volume:     { chemin: v => `/me/player/volume?volume_percent=${borner(v, 0, 100, 50)}`,
      methode: 'PUT' },
    position:   { chemin: v => `/me/player/seek?position_ms=${borner(v, 0, 86400000, 0)}`,
      methode: 'PUT' },
    aleatoire:  { chemin: v => `/me/player/shuffle?state=${v ? 'true' : 'false'}`, methode: 'PUT' },
    repetition: { chemin: v => `/me/player/repeat?state=`
      + (['off', 'context', 'track'].includes(v) ? v : 'off'), methode: 'PUT' },
  };

  routes.post('/spotify/commande', async (req, res) => {
    const { action, uri, depart, contexte, valeur, aleatoire } = req.body ?? {};
    const a = ACTIONS_SPOTIFY[action];
    if (!a) return res.status(400).json({ ok: false, error: 'Action inconnue.' });

    try {
      // « Lancer en aléatoire » est DEUX ordres, et l'ordre compte : le
      // brassage doit être armé AVANT que le contexte démarre, sinon Spotify
      // enchaîne la playlist dans l'ordre jusqu'au morceau suivant.
      if (action === 'lire' && aleatoire) {
        await spotify(ACTIONS_SPOTIFY.aleatoire.chemin(true), { methode: 'PUT' });
      }
      await spotify(a.chemin(valeur), {
        methode: a.methode,
        // `contexte` : l'album du morceau, pour que « suivant » existe. Voir
        // `corpsDeLecture`.
        corps: action === 'lire' ? corpsDeLecture({ uri, depart, contexte }) : undefined,
      });
      res.json({ ok: true });
    } catch (e) { res.status(e.statut ?? 502).json({ ok: false, error: e.message }); }
  });

  /**
   * Les appareils joignables, et de quoi déplacer la lecture sur l'un d'eux.
   *
   * C'EST LA RÉPONSE AU 404 LE PLUS DÉROUTANT DE SPOTIFY. « Aucun appareil
   * actif » n'apprend rien à qui a justement Spotify ouvert sur son téléphone :
   * l'appareil existe, il n'est simplement pas CELUI que l'API pilote. Sans
   * cette liste, la seule issue était d'aller lancer un morceau à la main
   * ailleurs — et l'application avait l'air cassée.
   */
  routes.get('/spotify/appareils', async (req, res) => {
    try {
      res.json({ ok: true, appareils: resumeAppareils(await spotify('/me/player/devices')) });
    } catch (e) { res.status(e.statut ?? 502).json({ ok: false, error: e.message }); }
  });

  routes.post('/spotify/appareil', async (req, res) => {
    const id = String(req.body?.id ?? '');
    if (!id) return res.status(400).json({ ok: false, error: 'Appareil non précisé.' });
    try {
      // `play: true` reprend la lecture sur la nouvelle enceinte. Sans lui, le
      // transfert réussit et tout reste silencieux : on croit à un échec.
      await spotify('/me/player', { methode: 'PUT', corps: { device_ids: [id], play: true } });
      res.json({ ok: true });
    } catch (e) { res.status(e.statut ?? 502).json({ ok: false, error: e.message }); }
  });

  /** Une pochette, dans la plus grande taille disponible. */
  const grandePochette = (images) => (images ?? [])
    .slice().sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null;

  routes.get('/spotify/recherche', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json({ ok: true, resultats: [], playlists: [], albums: [], artistes: [] });
    // On cherche les QUATRE. Chercher « lofi » et ne recevoir que des morceaux
    // isolés, alors que l'intention était de mettre un album ou une playlist en
    // fond sonore, obligeait à repasser par l'application Spotify.
    try {
      const d = await spotify(
        `/search?q=${encodeURIComponent(q)}&type=track,playlist,album,artist&limit=8`);
      res.json({ ok: true,
        resultats: (d?.tracks?.items ?? []).filter(Boolean).map(t => ({
          uri: t.uri, titre: t.name,
          artistes: (t.artists ?? []).map(a => a.name).join(', '),
          album: t.album?.name ?? '',
          // L'album SERT DE CONTEXTE : lancé dans son album, un titre garde un
          // « suivant ». Voir `corpsDeLecture`.
          albumUri: t.album?.uri ?? null,
          duree: t.duration_ms ?? 0,
          pochette: grandePochette(t.album?.images),
        })),
        // Spotify glisse des `null` dans ses listes de playlists depuis 2024 :
        // sans le filtre, la page tombe sur `p.name` d'un objet absent.
        playlists: (d?.playlists?.items ?? []).filter(Boolean).map(p => ({
          uri: p.uri, nom: p.name, pistes: nombreDePistes(p),
          pochette: grandePochette(p.images),
        })),
        albums: (d?.albums?.items ?? []).filter(Boolean).map(a => ({
          uri: a.uri, nom: a.name, pistes: a.total_tracks ?? 0,
          artistes: (a.artists ?? []).map(x => x.name).join(', '),
          pochette: grandePochette(a.images),
        })),
        artistes: (d?.artists?.items ?? []).filter(Boolean).map(a => ({
          uri: a.uri, nom: a.name, pochette: grandePochette(a.images),
        })) });
    } catch (e) { res.status(e.statut ?? 502).json({ ok: false, error: e.message }); }
  });

  /**
   * LA FILE D'ATTENTE. C'est ce qui distingue un lecteur d'une télécommande :
   * savoir ce qui vient APRÈS, et pouvoir y glisser un morceau sans casser ce
   * qui joue.
   */
  routes.get('/spotify/file', async (req, res) => {
    try {
      // `boucle` : Spotify a renvoyé dix fois le morceau en cours, faute
      // d'avoir quoi que ce soit à annoncer après lui. Voir `resumeFile`.
      const { boucle, pistes } = resumeFile(await spotify('/me/player/queue'));
      res.json({ ok: true, boucle, file: pistes.slice(0, 12).map(t => ({
        uri: t.uri, titre: t.name ?? '',
        artistes: (t.artists ?? []).map(a => a.name).join(', '),
        pochette: grandePochette(t.album?.images),
      })) });
    } catch (e) { res.status(e.statut ?? 502).json({ ok: false, error: e.message }); }
  });

  routes.post('/spotify/file', async (req, res) => {
    const uri = String(req.body?.uri ?? '');
    if (!uri.startsWith('spotify:track:')) {
      return res.status(400).json({ ok: false, error: 'Seul un morceau se met en file.' });
    }
    try {
      await spotify(`/me/player/queue?uri=${encodeURIComponent(uri)}`, { methode: 'POST' });
      res.json({ ok: true });
    } catch (e) { res.status(e.statut ?? 502).json({ ok: false, error: e.message }); }
  });

  /** Ce qu'on écoutait hier — la façon la plus rapide de relancer un fond. */
  routes.get('/spotify/recents', async (req, res) => {
    try {
      const d = await spotify('/me/player/recently-played?limit=20');
      const vus = new Set();
      const recents = [];
      for (const e of d?.items ?? []) {
        const t = e?.track;
        if (!t?.uri || vus.has(t.uri)) continue;
        vus.add(t.uri);
        recents.push({ uri: t.uri, titre: t.name ?? '',
          artistes: (t.artists ?? []).map(a => a.name).join(', '),
          albumUri: t.album?.uri ?? null,
          pochette: grandePochette(t.album?.images) });
      }
      res.json({ ok: true, recents: recents.slice(0, 10) });
    } catch (e) { res.status(e.statut ?? 502).json({ ok: false, error: e.message }); }
  });

  /**
   * LE CONTENU D'UNE PLAYLIST, D'UN ALBUM OU D'UN ARTISTE.
   *
   * Sans cette route, une playlist ne pouvait qu'être LANCÉE : quatre-vingts
   * titres derrière un seul bouton, sans moyen de voir ce qu'il y avait dedans
   * ni d'aller au morceau qu'on cherchait. C'est la différence entre une
   * télécommande et une bibliothèque.
   *
   * `offset` est ce qui permet ensuite de démarrer AU BON RANG : lancer la
   * piste 40 d'une playlist n'est pas jouer ce morceau seul, c'est jouer la
   * playlist à partir de là — la suite doit continuer.
   */
  routes.get('/spotify/contenu', async (req, res) => {
    const uri = String(req.query.uri ?? '');
    const m = uri.match(/^spotify:(playlist|album|artist):([A-Za-z0-9]+)$/);
    if (!m) return res.status(400).json({ ok: false, error: 'Contenu non reconnu.' });
    const [, type, id] = m;

    try {
      if (type === 'artist') {
        const d = await spotify(`/artists/${id}/top-tracks?market=from_token`);
        return res.json({ ok: true, type, contexte: null,
          pistes: (d?.tracks ?? []).filter(Boolean).map((t, i) => piste(t, i)) });
      }
      if (type === 'album') {
        const [info, d] = await Promise.all([
          spotify(`/albums/${id}`),
          spotify(`/albums/${id}/tracks?limit=50`),
        ]);
        return res.json({ ok: true, type, contexte: uri,
          nom: info?.name ?? '', pochette: grandePochette(info?.images),
          pistes: (d?.items ?? []).filter(Boolean).map((t, i) => piste(
            { ...t, album: info }, i)) });
      }
      const [info, d] = await Promise.all([
        spotify(`/playlists/${id}?fields=name,images`),
        // UN REFUS SUR LE CONTENU N'EST PAS UN REFUS SUR LA PLAYLIST.
        //
        // Mesuré sur les 36 playlists du compte : les 12 qui lui appartiennent
        // répondent, 23 des 24 suivies sont refusées en 403. Et pourtant
        // toutes SE LANCENT — la lecture passe par `context_uri`, qui ne
        // demande rien à ce point d'accès. Rendre une erreur ici rendait donc
        // injouable, depuis l'application, une playlist que Spotify accepte
        // parfaitement de jouer.
        pistesDePlaylist(id).catch(e => {
          if (e.statut === NON_LIE) throw e;
          return { refuse: e.message };
        }),
      ]);
      res.json({ ok: true, type, contexte: uri,
        nom: info?.name ?? '', pochette: grandePochette(info?.images),
        // Le drapeau vaut mieux qu'une liste vide : « aucune piste » et « on
        // n'a pas le droit de les lire » ne se disent pas pareil à l'écran.
        restreint: Boolean(d?.refuse),
        pistes: (d?.items ?? []).map(pisteDeLEntree).filter(t => t?.uri)
          .map((t, i) => piste(t, i)) });
    } catch (e) { res.status(e.statut ?? 502).json({ ok: false, error: e.message }); }
  });

  /**
   * Les pistes d'une playlist, sur le point d'accès qui existe.
   *
   * `/tracks` a été renommé `/items` — voir `nombreDePistes` dans
   * `src/spotify.js` pour le détail du renommage et de ses trois pièges. On
   * demande le nouveau, on retombe sur l'ancien : une installation qui parle
   * encore à l'ancienne forme continue de marcher, et on n'aura rien à
   * reprendre le jour où le vieux chemin disparaîtra pour de bon.
   *
   * Les champs sont demandés SOUS LES DEUX NOMS sur le nouveau chemin. Ce
   * n'est pas de la superstition : `fields=items(track(…))` y répond 200 avec
   * des entrées vides. Une playlist paraissait alors vide sans qu'aucune
   * erreur ne soit levée nulle part.
   */
  const CHAMPS_PISTE = 'uri,name,duration_ms,artists(name),album(images,name)';
  async function pistesDePlaylist(id) {
    try {
      return await spotify(`/playlists/${id}/items?limit=100`
        + `&fields=items(item(${CHAMPS_PISTE}),track(${CHAMPS_PISTE}))`);
    } catch (e) {
      if (e.statut === NON_LIE) throw e;
      return spotify(`/playlists/${id}/tracks?limit=100&fields=items(track(${CHAMPS_PISTE}))`);
    }
  }

  const piste = (t, rang) => ({
    uri: t.uri, titre: t.name ?? '', rang,
    artistes: (t.artists ?? []).map(a => a.name).join(', '),
    duree: t.duration_ms ?? 0,
    pochette: grandePochette(t.album?.images),
  });

  /**
   * LES PAROLES DU MORCEAU EN COURS.
   *
   * Spotify n'expose les siennes dans aucune API publique : son lecteur web
   * tape un point d'accès interne avec un jeton qui n'est pas celui d'OAuth.
   * S'en servir demanderait d'imiter son client — le contournement que ce
   * projet s'interdit ailleurs. LRCLIB est ouvert, sans clé, et rend souvent
   * des paroles SYNCHRONISÉES : voir `src/paroles.js`.
   *
   * L'appel part D'ICI et pas du navigateur : `connect-src` reste fermé, et le
   * titre écouté ne quitte pas la machine par un chemin qu'on ne contrôle pas.
   */
  routes.get('/spotify/paroles', async (req, res) => {
    const { titre, artistes, album, duree } = req.query;
    if (!titre || !artistes) return res.json({ ok: true, paroles: { trouve: false } });
    try {
      const d = await chercherParoles({
        titre: String(titre), artistes: String(artistes),
        album: album ? String(album) : '', duree: Number(duree) || 0,
      });
      res.json({ ok: true, paroles: resumeParoles(d) });
    } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
  });

  /** Les playlists de l'utilisateur, pour lancer sans chercher. */
  routes.get('/spotify/playlists', async (req, res) => {
    try {
      const d = await spotify('/me/playlists?limit=50');
      res.json({ ok: true, playlists: (d?.items ?? []).filter(Boolean).map(p => ({
        uri: p.uri, nom: p.name, pistes: nombreDePistes(p),
        pochette: grandePochette(p.images),
      })) });
    } catch (e) { res.status(e.statut ?? 502).json({ ok: false, error: e.message }); }
  });

  // Le retour d'autorisation. Hors de `/api` : c'est Spotify qui envoie le
  // navigateur ici, pas notre code.
  routes.retourSpotify = async (req, res) => {
    const { code, state, error } = req.query;
    // Vers l'adresse d'où l'on est parti, pas vers « / » — voir le commentaire
    // de /spotify/connexion : `127.0.0.1` et `localhost` sont deux origines,
    // et le navigateur y range deux `localStorage` distincts.
    const chez = (suite) => res.redirect(`${attenteSpotify?.retour ?? ''}/?${suite}`);

    if (error) return chez('spotify=refus');
    if (!code || !attenteSpotify || state !== attenteSpotify.etat) {
      return chez('spotify=invalide');
    }
    try {
      const jetons = await echangerCode({
        clientId: clientSpotify(), redirection: REDIRECTION,
        code, verificateur: attenteSpotify.verificateur,
      });
      ecrireJetons(jetons);
      chez('spotify=ok');
      attenteSpotify = null;
    } catch (e) {
      chez(`spotify=echec&m=${encodeURIComponent(e.message)}`);
    }
  };

  // --- Twitch --------------------------------------------------------------
  //
  // Flux « code d'appareil » : un `client_id` public, aucun secret, et surtout
  // AUCUNE URL DE REDIRECTION. Voir l'en-tête de `src/twitch.js` pour les deux
  // flux essayés avant celui-ci et pourquoi ils ont été abandonnés — le
  // formulaire de Twitch refuse toute redirection en `http://`, ce qui
  // condamne le flux implicite sur une application servie en local.
  //
  // Bénéfice inattendu : c'est aussi le plus propre. Le jeton ne traverse
  // jamais la page, et il s'accompagne d'un jeton de rafraîchissement — la
  // liaison survit indéfiniment.

  const clientTwitch = () => process.env.TWITCH_CLIENT_ID ?? '';

  /** Le code d'appareil en attente, entre la demande et la validation. */
  let attenteTwitch = null;

  const lireTwitch = () => {
    const brut = lireMeta(db, 'twitch_jeton');
    try { return brut ? JSON.parse(brut) : null; } catch { return null; }
  };
  const ecrireTwitch = (j) => ecrireMeta(db, 'twitch_jeton', j ? JSON.stringify(j) : '');

  /** Un jeton Twitch valide, renouvelé si besoin. Null si non lié. */
  async function jetonTwitch() {
    const j = lireTwitch();
    if (!j?.acces) return null;
    if (!twitchExpire(j)) return j;
    if (!j.refresh) { ecrireTwitch(null); return null; }
    try {
      const neuf = await rafraichirJeton({ clientId: clientTwitch(), refresh: j.refresh });
      const suite = { ...j, ...neuf };
      ecrireTwitch(suite);
      return suite;
    } catch { ecrireTwitch(null); return null; }
  }

  /** Appel Helix, avec renouvellement si le jeton vient d'expirer. */
  async function twitch(chemin) {
    const j = await jetonTwitch();
    // 409, jamais 401 : voir NON_LIE plus haut — un jeton Twitch mort ne doit
    // pas renvoyer l'utilisateur à la page de connexion de Job Cockpit.
    if (!j?.acces) throw Object.assign(new Error('Twitch non connecté.'), { statut: NON_LIE });
    try {
      return await appelerTwitch(chemin, { acces: j.acces, clientId: clientTwitch() });
    } catch (e) {
      if (!e.expire) throw e;
      ecrireTwitch(null);
      throw Object.assign(new Error('Session Twitch expirée — reconnecte-toi.'),
        { statut: NON_LIE });
    }
  }

  routes.get('/twitch/etat', async (req, res) => {
    if (!clientTwitch()) {
      return res.json({ ok: true, configure: false, connecte: false,
        aide: 'Ajoute TWITCH_CLIENT_ID dans .env — il est public, pas de secret à fournir.' });
    }
    const j = await jetonTwitch();
    if (!j?.acces) return res.json({ ok: true, configure: true, connecte: false });

    // On VALIDE plutôt que de faire confiance au fichier : un jeton révoqué
    // depuis le compte Twitch n'a aucun moyen de nous prévenir. Sans ce
    // contrôle, l'interface annoncerait « compte lié » jusqu'au premier appel
    // en échec, c'est-à-dire au moment où l'on veut s'en servir.
    try {
      const v = await validerJeton(j.acces);
      if (!v) { ecrireTwitch(null); return res.json({ ok: true, configure: true, connecte: false }); }
      res.json({ ok: true, configure: true, connecte: true, login: v.login });
    } catch (e) {
      res.json({ ok: true, configure: true, connecte: true, login: j.login, erreur: e.message });
    }
  });

  /**
   * Demande un code d'appareil. C'est tout ce qu'il y a à faire côté serveur :
   * l'utilisateur va taper ce code sur twitch.tv/activate, et c'est
   * `/twitch/verifier` qui constatera son accord.
   */
  routes.post('/twitch/connexion', async (req, res) => {
    if (!clientTwitch()) {
      return res.status(400).json({ ok: false, error: 'TWITCH_CLIENT_ID absent du .env.' });
    }
    try {
      const d = await demanderCode({ clientId: clientTwitch() });
      attenteTwitch = d;
      // Le `device_code` NE PART PAS vers la page : c'est lui qui vaut preuve,
      // et la page n'a besoin que de ce qu'elle doit afficher.
      res.json({ ok: true, code: d.code, url: d.url,
        expireLe: d.expireLe, cadence: d.cadence });
    } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
  });

  /**
   * Un tour de guet. La page rappelle jusqu'à ce que ce soit fait.
   *
   * L'ATTENTE N'EST PAS UNE ERREUR : `authorization_pending` est la réponse
   * normale pendant tout le temps où l'utilisateur tape son code, c'est-à-dire
   * la quasi-totalité des appels. Rendue en erreur, elle ferait clignoter un
   * message d'échec dix fois par minute sur un déroulement parfaitement
   * ordinaire.
   */
  routes.post('/twitch/verifier', async (req, res) => {
    if (!attenteTwitch) {
      return res.status(400).json({ ok: false, error: 'Aucune connexion en cours.' });
    }
    if (Date.now() > attenteTwitch.expireLe) {
      attenteTwitch = null;
      return res.status(400).json({ ok: false, error: 'Le code a expiré — recommence.' });
    }
    try {
      const jetons = await reclamerJeton({
        clientId: clientTwitch(), appareil: attenteTwitch.appareil });
      if (!jetons) return res.json({ ok: true, statut: 'attente' });

      const v = await validerJeton(jetons.acces);
      if (!v) return res.status(502).json({ ok: false, error: 'Jeton refusé par Twitch.' });
      ecrireTwitch({ ...jetons, id: v.id, login: v.login });
      attenteTwitch = null;
      res.json({ ok: true, statut: 'ok', login: v.login });
    } catch (e) {
      attenteTwitch = null;
      res.status(502).json({ ok: false, error: e.message });
    }
  });

  routes.post('/twitch/deconnexion', async (req, res) => {
    const j = lireTwitch();
    // On révoque CHEZ TWITCH, pas seulement ici. Effacer notre copie laisserait
    // un jeton vivant pendant deux mois, autorisé sur un compte, et que plus
    // personne ne surveille.
    if (j?.acces) await revoquerTwitch({ clientId: clientTwitch(), acces: j.acces });
    ecrireTwitch(null);
    res.json({ ok: true });
  });

  /** Les chaînes suivies qui émettent EN CE MOMENT. */
  routes.get('/twitch/directs', async (req, res) => {
    const j = lireTwitch();
    if (!j?.id) return res.status(NON_LIE).json({ ok: false, error: 'Twitch non connecté.' });
    try {
      const d = await twitch(`/streams/followed?user_id=${encodeURIComponent(j.id)}&first=40`);
      res.json({ ok: true, directs: resumeDirects(d) });
    } catch (e) { res.status(e.statut ?? 502).json({ ok: false, error: e.message }); }
  });

  /** Toutes les chaînes suivies — hors ligne comprises, pour les rediffusions. */
  routes.get('/twitch/suivies', async (req, res) => {
    const j = lireTwitch();
    if (!j?.id) return res.status(NON_LIE).json({ ok: false, error: 'Twitch non connecté.' });
    try {
      const d = await twitch(`/channels/followed?user_id=${encodeURIComponent(j.id)}&first=100`);
      res.json({ ok: true, chaines: resumeSuivies(d) });
    } catch (e) { res.status(e.statut ?? 502).json({ ok: false, error: e.message }); }
  });

  routes.get('/twitch/recherche', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json({ ok: true, resultats: [], categories: [] });
    // On cherche les DEUX. Taper « minecraft » et ne recevoir que des chaînes
    // dont c'est le nom, alors qu'on cherchait la catégorie, renvoyait sur le
    // site — exactement ce que cet onglet doit éviter.
    try {
      const [c, g] = await Promise.all([
        twitch(`/search/channels?query=${encodeURIComponent(q)}&first=20`),
        twitch(`/search/categories?query=${encodeURIComponent(q)}&first=12`).catch(() => null),
      ]);
      res.json({ ok: true, resultats: resumeRecherche(c), categories: resumeCategories(g) });
    } catch (e) { res.status(e.statut ?? 502).json({ ok: false, error: e.message }); }
  });

  // --- NAVIGUER DANS TWITCH SANS ALLER SUR TWITCH ---------------------------
  //
  // Même contrainte que YouTube, et même réponse : `twitch.tv` refuse d'être
  // mis en cadre, seul `player.twitch.tv` l'accepte — et il ne montre qu'un
  // direct ou une rediffusion, jamais de quoi parcourir quoi que ce soit. Le
  // panneau se limitait donc aux chaînes suivies en direct : dès qu'on voulait
  // autre chose, il fallait sortir de l'application.
  //
  // Les trois routes qui suivent reconstruisent la navigation chez nous : les
  // catégories, une catégorie, une chaîne. C'est ce que l'API Helix expose
  // officiellement — pas de page analysée à la main.

  /** L'accueil : ce qui est le plus regardé en ce moment, toutes chaînes. */
  routes.get('/twitch/categories', async (req, res) => {
    try {
      res.json({ ok: true, categories: resumeCategories(await twitch('/games/top?first=30')) });
    } catch (e) { res.status(e.statut ?? 502).json({ ok: false, error: e.message }); }
  });

  /** Les directs d'une catégorie, et le nom de la catégorie pour l'entête. */
  routes.get('/twitch/categorie', async (req, res) => {
    const id = String(req.query.id ?? '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'Catégorie non précisée.' });
    try {
      const [jeu, flux] = await Promise.all([
        twitch(`/games?id=${encodeURIComponent(id)}`),
        twitch(`/streams?game_id=${encodeURIComponent(id)}&first=30`),
      ]);
      res.json({ ok: true,
        categorie: resumeCategories(jeu)[0] ?? { id, nom: '' },
        directs: resumeDirects(flux) });
    } catch (e) { res.status(e.statut ?? 502).json({ ok: false, error: e.message }); }
  });

  /**
   * UNE CHAÎNE, EN DIRECT OU NON.
   *
   * Une chaîne hors ligne n'est pas une chaîne vide : ses rediffusions sont
   * souvent ce qu'on vient chercher. Sans elles, cliquer sur une chaîne
   * éteinte donnait un lecteur noir, et la seule issue était le site.
   *
   * `/videos` veut un identifiant numérique, pas un pseudo : il faut d'abord
   * passer par `/users`. C'est l'appel en plus qu'on ne peut pas éviter.
   */
  routes.get('/twitch/chaine', async (req, res) => {
    const login = String(req.query.login ?? '').trim().toLowerCase();
    if (!login) return res.status(400).json({ ok: false, error: 'Chaîne non précisée.' });
    try {
      const u = resumeChaines(await twitch(`/users?login=${encodeURIComponent(login)}`))[0];
      if (!u) return res.status(404).json({ ok: false, error: `Chaîne « ${login} » introuvable.` });

      const [flux, videos] = await Promise.all([
        twitch(`/streams?user_id=${encodeURIComponent(u.id)}`),
        twitch(`/videos?user_id=${encodeURIComponent(u.id)}&type=archive&first=20`).catch(() => null),
      ]);
      res.json({ ok: true, chaine: u,
        direct: resumeDirects(flux)[0] ?? null,
        videos: resumeVideos(videos) });
    } catch (e) { res.status(e.statut ?? 502).json({ ok: false, error: e.message }); }
  });

  // --- YouTube -------------------------------------------------------------
  //
  // ON NE PEUT PAS METTRE YOUTUBE DANS UN CADRE, et ce n'est pas faute
  // d'avoir cherché : `youtube.com` répond `X-Frame-Options: SAMEORIGIN` sur
  // l'accueil, sur les résultats de recherche et jusque sur son interface
  // téléviseur. Seules les adresses `/embed/` s'affichent, et elles ne
  // montrent qu'une vidéo — jamais de quoi parcourir le catalogue.
  //
  // La navigation se fait donc CHEZ NOUS : on dresse la liste par l'API
  // officielle, et un clic charge la vidéo dans le cadre `/embed/`. Voir
  // `src/youtube.js` pour le détail, y compris pourquoi ce n'est pas du
  // scraping — décision déjà prise pour Indeed.

  const cleYoutube = () => process.env.YOUTUBE_API_KEY ?? '';
  const paysYoutube = () => process.env.YOUTUBE_PAYS ?? 'FR';

  routes.get('/youtube/etat', (req, res) => {
    // LA MÊME CLÉ QUE GEMINI, ET ÇA NE SE VOIT PAS.
    //
    // Les deux sont des « clés d'API Google », les deux se collent dans le
    // même fichier, et activer « YouTube Data API v3 » sur le projet de la
    // clé Gemini donne toutes les raisons de croire que c'est réglé. Ça ne
    // l'est pas : mesuré, la clé d'AI Studio répond 200 sur Gemini et 401 sur
    // YouTube. Sans ce contrôle, l'onglet s'annonce configuré puis échoue à
    // chaque appel — et l'erreur, elle, parle d'OAuth.
    if (cleYoutube() && cleYoutube() === (process.env.GEMINI_API_KEY ?? '')) {
      return res.json({ ok: true, configure: false, pays: paysYoutube(),
        aide: 'YOUTUBE_API_KEY porte la même valeur que GEMINI_API_KEY. Une clé '
          + 'd\'AI Studio ne vaut que pour Gemini : il en faut une créée dans '
          + 'Google Cloud, sur un projet où « YouTube Data API v3 » est activée.' });
    }

    // LE PRÉFIXE, PARCE QU'IL SE VÉRIFIE D'UN COUP D'ŒIL.
    //
    // Une clé d'API Google Cloud commence par `AIza`. Les clés d'AI Studio,
    // elles, commencent par `AQ.` — deux objets différents que rien ne
    // distingue une fois collés dans un fichier, et qui échouent à cent lignes
    // de là sur « API keys are not supported by this API ». On le dit AVANT
    // le premier appel, pas après.
    //
    // C'est un AVERTISSEMENT, pas un refus : le jour où Google change de
    // préfixe, une clé valide ne doit pas être déclarée fausse par nous.
    if (cleYoutube() && !cleYoutube().startsWith('AIza')) {
      return res.json({ ok: true, configure: true, pays: paysYoutube(),
        aide: 'Cette clé ne ressemble pas à une clé d\'API Google Cloud — elles '
          + 'commencent par « AIza ». Si l\'accueil échoue, c\'est probablement ça.' });
    }
    res.json({ ok: true, configure: Boolean(cleYoutube()), pays: paysYoutube() });
  });

  /**
   * L'accueil. Les vidéos populaires du pays, c'est-à-dire ce que voit un
   * visiteur NON CONNECTÉ sur youtube.com — et ça coûte une unité de quota
   * là où une recherche en coûte cent.
   */
  routes.get('/youtube/accueil', async (req, res) => {
    if (!cleYoutube()) {
      return res.status(400).json({ ok: false, error: 'YOUTUBE_API_KEY absente du .env.' });
    }
    try {
      const v = await ytPopulaires({ cle: cleYoutube(), pays: paysYoutube() });
      res.json({ ok: true, videos: v.map(x => ({ ...x, secondes: dureeIso(x.duree) })) });
    } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
  });

  routes.get('/youtube/recherche', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json({ ok: true, videos: [] });
    if (!cleYoutube()) {
      return res.status(400).json({ ok: false, error: 'YOUTUBE_API_KEY absente du .env.' });
    }
    try {
      const v = await ytChercher({ cle: cleYoutube(), requete: q });
      res.json({ ok: true, videos: v.map(x => ({ ...x, secondes: dureeIso(x.duree) })) });
    } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
  });

  /**
   * UNE CHAÎNE ET SES VIDÉOS, DANS L'ONGLET.
   *
   * Cliquer le nom d'un YouTuber ouvrait le champ vide : le nom seul ne mène
   * nulle part, l'API veut l'identifiant de la chaîne. La vignette le porte
   * désormais (`chaineId`), et cette route rend la fiche + les dernières
   * vidéos — de quoi rester dans l'application au lieu d'aller sur le site.
   */
  routes.get('/youtube/chaine', async (req, res) => {
    const id = String(req.query.id ?? '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'Chaîne non précisée.' });
    if (!cleYoutube()) {
      return res.status(400).json({ ok: false, error: 'YOUTUBE_API_KEY absente du .env.' });
    }
    try {
      const d = await ytChaine({ cle: cleYoutube(), id });
      if (!d) return res.status(404).json({ ok: false, error: 'Chaîne introuvable.' });
      res.json({ ok: true, chaine: d.chaine,
        videos: d.videos.map(x => ({ ...x, secondes: dureeIso(x.duree) })) });
    } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
  });

  /**
   * LA DISCUSSION DE LA VUE « CHILL ».
   *
   * Chercher un emploi est long et solitaire. Le reste de l'application pousse
   * à agir ; cette route-ci ne pousse à rien. On y parle, et si la
   * conversation dérive sur les offres, le compagnon sait de quoi il s'agit.
   *
   * L'historique vit CHEZ LE CLIENT et repart à chaque message : une
   * discussion informelle n'a pas à laisser de trace dans la base, et ce qu'on
   * dit un soir de découragement n'a pas à être relu six mois plus tard.
   */
  routes.post('/chat', async (req, res) => {
    if (!geminiPret()) {
      return res.status(400).json({ ok: false,
        error: 'La clé Gemini est nécessaire pour discuter.' });
    }

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (!messages.length) {
      return res.status(400).json({ ok: false, error: 'Aucun message.' });
    }

    // L'état réel, en ordres de grandeur. Lui verser deux cents offres
    // coûterait cher à chaque message et le ferait répondre en catalogue.
    const offres = db.prepare('SELECT groupe FROM offers').all();
    const candidatures = db.prepare(
      "SELECT COUNT(*) n FROM tracking WHERE status IS NOT NULL AND status != 'À postuler'").get().n;

    const aujourdhui = new Date(); aujourdhui.setHours(0, 0, 0, 0);
    const entretiens = db.prepare(`
      SELECT o.titre, o.entreprise, t.entretien_date
      FROM tracking t JOIN offers o ON o.id = t.offer_id
      WHERE t.entretien_date IS NOT NULL AND t.entretien_date != ''
    `).all().map(e => ({
      titre: e.titre, entreprise: e.entreprise,
      jours: Math.round((new Date(`${e.entretien_date}T00:00:00`) - aujourdhui) / 86400000),
    })).filter(e => Number.isFinite(e.jours) && e.jours >= 0);

    const contexte = resumeEtat({ offres, candidatures, entretiens });

    // Une image jointe au dernier message — une capture d'écran, en général.
    // On la valide sommairement (type image, taille bornée) : un `data:` mal
    // formé ou énorme ne doit pas partir chez Gemini ni saturer la mémoire.
    const images = validerImages(req.body?.image);

    let texte;
    try {
      texte = await demander(promptChat(messages, contexte, {
        candidat: (profil.candidat?.nom ?? '').split(' ')[0],
        avecImage: images.length > 0,
      }), images);
    } catch (erreur) {
      return res.status(502).json({ ok: false, error: `Gemini : ${erreur.message}` });
    }
    noterAppel(db, CHAT);

    res.json({ ok: true, reponse: String(texte).trim() });
  });

  /**
   * L'ÉTAT DE PRÉPARATION DE CHAQUE DOSSIER.
   *
   * La préparation était enfouie dans le dépliant d'une carte : il fallait
   * retrouver l'offre parmi deux cents pour reprendre là où on s'était
   * arrêté. Elle a désormais sa vue, et cette route lui donne de quoi
   * répondre à la seule question qui se pose en l'ouvrant : « où j'en suis,
   * et sur quel dossier ? »
   */
  routes.get('/entretiens', (req, res) => {
    const lignes = db.prepare(`
      SELECT o.id, o.titre, o.entreprise, o.ville, o.date_offre,
             t.status, t.sent_date, t.entretien_date,
             e.echanges, e.debrief, e.fiche, e.notions, e.maj_le
      FROM offers o
      LEFT JOIN tracking t   ON t.offer_id = o.id
      LEFT JOIN entretiens e ON e.offer_id = o.id
      WHERE t.status IS NOT NULL AND t.status != 'À postuler'
         OR e.offer_id IS NOT NULL
      ORDER BY COALESCE(e.maj_le, t.sent_date, o.date_offre) DESC
    `).all();

    res.json({ ok: true, geminiPret: geminiPret(), dossiers: lignes.map(l => {
      const echanges = l.echanges ? JSON.parse(l.echanges) : [];
      const notions = l.notions ? JSON.parse(l.notions) : [];
      return {
        id: l.id, titre: l.titre, entreprise: l.entreprise, ville: l.ville,
        statut: l.status ?? 'À postuler', envoyeLe: l.sent_date ?? '',
        entretienLe: l.entretien_date ?? '',
        questions: echanges.filter(x => x.role === 'jury').length,
        total: QUESTIONS_PAR_SEANCE,
        cartes: notions.length,
        cartesSues: notions.filter(n => n.su).length,
        debrief: Boolean(l.debrief),
        fiche: Boolean(l.fiche),
        majLe: l.maj_le ?? null,
      };
    }) });
  });

  routes.get('/entretien/:id', (req, res) => {
    const o = offrePourEntretien(req.params.id);
    if (!o) return res.status(404).json({ ok: false, error: 'Offre introuvable.' });
    const e = lireEntretien(req.params.id);
    res.json({ ok: true, ...e,
      titre: o.offre.titre, entreprise: o.offre.entreprise,
      questionsParSeance: QUESTIONS_PAR_SEANCE,
      typesNotions: Object.fromEntries(
        Object.entries(TYPES_NOTIONS).map(([k, v]) => [k, { libelle: v.libelle, aide: v.aide }])),
      geminiPret: geminiPret(),
      // Sans analyse, le jury n'a pas les manques à viser : la séance
      // resterait polie et n'apprendrait rien. On le dit plutôt que de la
      // laisser se dérouler à vide.
      analysePresente: Boolean(o.analyse),
    });
  });

  /**
   * Le tour suivant : on enregistre la réponse du candidat, le jury relance.
   *
   * L'historique complet repart à chaque appel — `demander()` ne tient pas de
   * conversation. C'est plus coûteux en jetons, mais c'est ce qui permet au
   * jury de creuser une réponse évasive donnée trois questions plus tôt.
   */
  routes.post('/entretien/:id/repondre', async (req, res) => {
    if (!geminiPret()) {
      return res.status(400).json({ ok: false,
        error: 'La clé Gemini est nécessaire pour la préparation d\'entretien.' });
    }
    const o = offrePourEntretien(req.params.id);
    if (!o) return res.status(404).json({ ok: false, error: 'Offre introuvable.' });

    const e = lireEntretien(req.params.id);
    const reponse = String(req.body?.reponse ?? '').trim();
    if (reponse) e.echanges.push({ role: 'candidat', texte: reponse.slice(0, 4000) });

    let question;
    try {
      question = await demander(promptQuestion(o.offre, o.analyse, cv(), e.echanges));
    } catch (erreur) {
      return res.status(502).json({ ok: false, error: `Gemini : ${erreur.message}` });
    }
    noterAppel(db, ENTRETIEN);

    e.echanges.push({ role: 'jury', texte: String(question).trim() });
    ecrireEntretien(req.params.id, e);

    const posees = e.echanges.filter(x => x.role === 'jury').length;
    res.json({ ok: true, echanges: e.echanges, posees,
      terminee: posees >= QUESTIONS_PAR_SEANCE });
  });

  /** Le débriefing : ce qui a tenu, ce qui s'est effondré, quoi réviser. */
  routes.post('/entretien/:id/debrief', async (req, res) => {
    if (!geminiPret()) {
      return res.status(400).json({ ok: false, error: 'La clé Gemini est nécessaire.' });
    }
    const o = offrePourEntretien(req.params.id);
    if (!o) return res.status(404).json({ ok: false, error: 'Offre introuvable.' });

    const e = lireEntretien(req.params.id);
    if (e.echanges.filter(x => x.role === 'candidat').length < 2) {
      return res.status(400).json({ ok: false,
        error: 'Réponds à deux questions au moins : il n\'y a rien à débriefer avant.' });
    }

    let texte;
    try {
      texte = await demander(promptDebrief(o.offre, o.analyse, cv(), e.echanges));
    } catch (erreur) {
      return res.status(502).json({ ok: false, error: `Gemini : ${erreur.message}` });
    }
    noterAppel(db, ENTRETIEN);

    e.debrief = String(texte).trim();
    ecrireEntretien(req.params.id, e);
    journaliser(db, 'entretien-debrief', { offerId: req.params.id });
    res.json({ ok: true, debrief: e.debrief });
  });

  /** La fiche : ce qu'il faut savoir, et que le CV n'apprend pas. */
  routes.post('/entretien/:id/fiche', async (req, res) => {
    if (!geminiPret()) {
      return res.status(400).json({ ok: false, error: 'La clé Gemini est nécessaire.' });
    }
    const o = offrePourEntretien(req.params.id);
    if (!o) return res.status(404).json({ ok: false, error: 'Offre introuvable.' });

    let texte;
    try {
      texte = await demander(promptFiche(o.offre, o.analyse, cv()));
    } catch (erreur) {
      return res.status(502).json({ ok: false, error: `Gemini : ${erreur.message}` });
    }
    noterAppel(db, ENTRETIEN);

    const e = lireEntretien(req.params.id);
    e.fiche = String(texte).trim();
    ecrireEntretien(req.params.id, e);
    res.json({ ok: true, fiche: e.fiche });
  });

  /**
   * LES CARTES À RÉVISER.
   *
   * Sur un domaine qu'on ne connaît pas, la fiche se lit une fois et ne tient
   * pas : on la parcourt, on se sent prêt, et en séance le mot ne revient pas.
   * Ce qui fait tenir une notion, c'est de tenter de la restituer avant de
   * lire la réponse.
   *
   * Chaque appel ajoute dix cartes sans reprendre les précédentes : on révise
   * sur plusieurs jours, et le stock grossit.
   */
  routes.post('/entretien/:id/notions', async (req, res) => {
    if (!geminiPret()) {
      return res.status(400).json({ ok: false, error: 'La clé Gemini est nécessaire.' });
    }
    const o = offrePourEntretien(req.params.id);
    if (!o) return res.status(404).json({ ok: false, error: 'Offre introuvable.' });

    const type = TYPES_NOTIONS[req.body?.type] ? req.body.type : 'jargon';
    const e = lireEntretien(req.params.id);
    // On n'évite que les doublons DU MÊME TYPE : « déféré préfectoral » a sa
    // place à la fois dans le jargon et dans les textes, vu sous deux angles.
    const deja = e.notions.filter(n => (n.type ?? 'jargon') === type).map(n => n.terme);

    // ANCRÉ dans une recherche web : sans cela, le modèle produit des numéros
    // d'article plausibles et se déclare sûr de lui. Pour réviser du droit
    // avant un entretien, c'est le pire des cas.
    let brut, sources;
    try {
      const r = await demanderAncre(promptNotions(o.offre, o.analyse, deja, type));
      brut = r.texte;
      sources = r.sources;
    } catch (erreur) {
      return res.status(502).json({ ok: false, error: `Gemini : ${erreur.message}` });
    }
    noterAppel(db, ENTRETIEN);

    const liste = extraireJson(brut);
    if (!Array.isArray(liste) || !liste.length) {
      return res.status(502).json({ ok: false,
        error: 'Réponse illisible du modèle. Réessaie dans un instant.' });
    }

    // `su` est l'avancement de RÉVISION du candidat, distinct de `sur` qui dit
    // si le modèle répond de l'exactitude. Confondre les deux ferait passer
    // pour acquis ce qui n'est même pas vérifié.
    const nouvelles = liste
      .filter(c => c?.terme && c?.definition)
      .map(c => ({
        terme: String(c.terme).slice(0, 300),
        definition: String(c.definition).slice(0, 900),
        // La phrase à ressortir telle quelle en séance. C'est elle qu'on
        // révise en dernier, dans le train.
        memo: String(c.memo ?? '').slice(0, 300),
        // Ce que les candidats confondent : c'est souvent ce qui départage.
        piege: String(c.piege ?? '').slice(0, 400),
        pourquoi: String(c.pourquoi ?? '').slice(0, 400),
        source: String(c.source ?? '').slice(0, 200),
        sur: c.sur !== false,
        su: false,
        type,
      }));

    // Les pages réellement consultées par le modèle, communes au lot. Elles
    // permettent d'aller lire le texte au lieu de croire une définition.
    const liens = (sources ?? []).slice(0, 8);

    e.notions = [...e.notions, ...nouvelles];
    e.liens = [...(e.liens ?? []), ...liens]
      .filter((l, i, t) => t.findIndex(x => x.url === l.url) === i)
      .slice(0, 30);
    ecrireEntretien(req.params.id, e);
    res.json({ ok: true, ajoutees: nouvelles.length, notions: e.notions,
      liens: e.liens, ancre: liens.length > 0 });
  });

  /** L'avancement de révision d'une carte : su, ou à revoir. */
  routes.patch('/entretien/:id/notions/:index', (req, res) => {
    const e = lireEntretien(req.params.id);
    const i = Number(req.params.index);
    if (!e.notions[i]) return res.status(404).json({ ok: false, error: 'Carte introuvable.' });
    e.notions[i].su = Boolean(req.body?.su);
    ecrireEntretien(req.params.id, e);
    res.json({ ok: true, su: e.notions[i].su });
  });

  /** Repartir de zéro, en gardant la fiche : elle ne dépend pas de la séance. */
  routes.delete('/entretien/:id', (req, res) => {
    const e = lireEntretien(req.params.id);
    // La fiche et les cartes SURVIVENT : elles décrivent le poste, pas la
    // séance. Les effacer obligerait à repayer des appels pour retrouver ce
    // qu'on savait déjà.
    ecrireEntretien(req.params.id, {
      echanges: [], debrief: null, fiche: e.fiche, notions: e.notions, liens: e.liens,
    });
    res.json({ ok: true });
  });

  routes.get('/villes', (req, res) => {
    res.json({
      ok: true,
      villes: (profil.villesPrioritaires ?? []).map(decrireVille),
      departements: DEPARTEMENTS,
      maximum: VILLES_MAX,
    });
  });

  routes.put('/villes', (req, res) => {
    const { villes, erreur } = validerVilles(req.body?.villes);
    if (erreur) return res.status(400).json({ ok: false, error: erreur });

    let surDisque;
    try {
      surDisque = JSON.parse(readFileSync(CHEMIN_PROFIL, 'utf8'));
    } catch (e) {
      return res.status(500).json({ ok: false, error: `Profil illisible : ${e.message}` });
    }

    try {
      // Une copie horodatée avant d'écrire : le reste du profil — scoring
      // ajusté au fil des semaines, intitulés, coordonnées — vaut bien plus
      // que ce réglage-ci, et une erreur de ma part ne doit pas l'emporter.
      writeFileSync(`${CHEMIN_PROFIL}.sauvegarde-${Date.now()}`,
        JSON.stringify(surDisque, null, 2) + '\n');
      writeFileSync(CHEMIN_PROFIL,
        JSON.stringify({ ...surDisque, villesPrioritaires: villes }, null, 2) + '\n');
    } catch (e) {
      return res.status(500).json({ ok: false, error: `Écriture impossible : ${e.message}` });
    }

    // EN PLACE, pas une réaffectation : `profil` est le même objet que celui
    // tenu par le planificateur de collecte (server.js). Le remplacer ici ne
    // changerait que la vue de l'API, et la collecte continuerait des heures
    // durant à chercher dans les anciennes villes — sans que rien ne le dise.
    profil.villesPrioritaires = villes;

    res.json({ ok: true, villes: villes.map(decrireVille) });
  });

  /** Remet en circulation ce qui a été écarté — le filet de sécurité. */
  routes.post('/offers/rejetees/oublier', (req, res) => {
    const motif = req.body?.motif ?? null;
    const oubliees = oublierRejets(db, motif);
    res.json({ ok: true, oubliees });
  });

  /** Ce qui a été écarté, pour pouvoir le relire. */
  routes.get('/offers/rejetees', (req, res) => {
    const lignes = db.prepare(
      'SELECT offer_id, motif, titre, rejete_le FROM rejetees ORDER BY rejete_le DESC LIMIT 500'
    ).all();
    res.json({ ok: true, rejetees: lignes });
  });

  // --- Collecte à la demande -----------------------------------------------

  routes.post('/refresh', async (req, res) => {
    if (collecteEnCours) {
      return res.status(409).json({ ok: false, error: 'Une collecte est déjà en cours.' });
    }
    collecteEnCours = true;
    try {
      const resume = await collecter({ db, profil, sources, cv: cv(), analyser: true });
      // Déclencher une collecte est une décision de l'auteur : ça vaut une
      // quête. Mais pas une journée de série — c'est le robot qui travaille.
      journaliser(db, 'collecte', { sansActivite: true, meta: { nouvelles: resume.nouvelles } });
      res.json({ ok: true, resume });
    } catch (erreur) {
      // Une collecte ratée ne doit jamais casser le dashboard : les offres
      // déjà en base restent intactes.
      res.status(500).json({ ok: false, error: `Collecte impossible : ${erreur.message}` });
    } finally {
      collecteEnCours = false;
    }
  });

  /** Toutes les statistiques du tableau de bord, calculées côté serveur. */
  routes.get('/stats', (req, res) => {
    res.json({ ok: true, stats: calculerStats(db) });
  });

  /** Frise des dernières actions, pour le journal d'activité. */
  routes.get('/timeline', (req, res) => {
    const limite = Math.min(200, Math.max(1, Number(req.query.limite) || 60));
    const lignes = db.prepare(`
      SELECT e.type, e.jour, e.heure, e.cree_le, e.offer_id,
             o.titre, o.entreprise
      FROM evenements e
      LEFT JOIN offers o ON o.id = e.offer_id
      ORDER BY e.id DESC LIMIT ?`).all(limite);

    res.json({ ok: true, evenements: lignes });
  });

  /**
   * Efface l'historique d'activité : le journal des actions et les jours
   * actifs. Les offres, le suivi et les lettres ne sont pas touchés — c'est
   * la seule raison pour laquelle cette remise à zéro est sans danger.
   */
  routes.post('/historique/reinitialiser', (req, res) => {
    transaction(db, () => {
      db.exec('DELETE FROM activite');
      db.exec('DELETE FROM evenements');
    });

    res.json({ ok: true });
  });

  routes.put('/objectif', (req, res) => {
    const valeur = Number(req.body?.objectif);
    if (!Number.isInteger(valeur) || valeur < 1 || valeur > 50) {
      return res.status(400).json({ ok: false, error: 'L\'objectif doit être un nombre entre 1 et 50.' });
    }
    ecrireMeta(db, 'objectif_hebdo', valeur);
    res.json({ ok: true, objectif: valeur });
  });

  // --- Import d'une offre par collage --------------------------------------

  routes.post('/offers/paste', async (req, res) => {
    try {
      const brute = await extraireOffreCollee(req.body?.texte);
      const id = offreId(brute.titre, brute.entreprise, brute.ville);

      const { groupe, score, detail } = scorer(brute, profil);
      const analyse = groupe === 3 ? null : await analyserOffre(brute, cv());

      upsertOffre(db, {
        ...brute,
        id, source: 'collage', sourcesAll: ['collage'],
        groupe, score, scoreDetail: detail, analysisJson: analyse,
        isManual: 0, horsZone: 0, departement: null,
      });

      journaliser(db, 'ajout', { offerId: id });
      res.json({ ok: true, id, titre: brute.titre, groupe });
    } catch (erreur) {
      res.status(400).json({ ok: false, error: erreur.message });
    }
  });

  // --- Lettres de motivation -----------------------------------------------

  function lireOffreComplete(id) {
    return db.prepare('SELECT * FROM offers WHERE id = ?').get(id);
  }

  routes.get('/letter/:id', (req, res) => {
    const lettre = db.prepare('SELECT * FROM letters WHERE offer_id = ?').get(req.params.id);
    if (!lettre) return res.status(404).json({ ok: false, error: 'Aucune lettre pour cette offre.' });
    res.json({ ok: true, contenu: lettre.content, editee: Boolean(lettre.edited), generee: lettre.generated_at });
  });

  routes.post('/letter/:id', async (req, res) => {
    const offre = lireOffreComplete(req.params.id);
    if (!offre) return res.status(404).json({ ok: false, error: 'Offre introuvable.' });

    const existante = db.prepare('SELECT * FROM letters WHERE offer_id = ?').get(req.params.id);

    // Une lettre déjà écrite n'est jamais régénérée sans demande explicite :
    // cela gaspillerait du quota et écraserait d'éventuelles retouches.
    if (existante && !req.body?.regenerer) {
      return res.json({ ok: true, contenu: existante.content, editee: Boolean(existante.edited), reutilisee: true });
    }
    if (existante?.edited && !req.body?.confirmerEcrasement) {
      return res.status(409).json({
        ok: false,
        error: 'Cette lettre a été retouchée à la main. Régénérer effacera tes modifications.',
        besoinConfirmation: true,
      });
    }

    const texteCv = cv();
    if (!texteCv) {
      return res.status(400).json({ ok: false, error: 'CV absent. Lancer : npm run extract-cv -- "chemin/vers/CV.docx"' });
    }

    // La rédaction a accès à TOUT le quota, réserve comprise : c'est ce que
    // la réserve protège. On vérifie quand même qu'il en reste.
    const feuVert = peutRediger(db, profil);
    if (!feuVert.ok) {
      return res.status(503).json({ ok: false, error: feuVert.raison });
    }

    // UNE LETTRE SANS ANALYSE EST UNE LETTRE À L'AVEUGLE.
    //
    // Le prompt s'appuie sur ce que le candidat peut prouver, ce qu'il ne
    // peut pas, et ce qui est contournable. Sans analyse, il rédige sur la
    // seule annonce et retombe dans le passe-partout — précisément ce que
    // toute la structure du prompt cherche à éviter.
    //
    // On l'analyse donc à la demande. Cet appel est prélevé sur la réserve,
    // ce qui est son usage exact : il sert cette lettre-ci.
    let analyse = offre.analysis_json ? JSON.parse(offre.analysis_json) : null;
    if (!analyse) {
      try {
        analyse = await analyserOffre(offre, texteCv);
        if (analyse) {
          noterAppel(db, LETTRE);
          db.prepare('UPDATE offers SET analysis_json = ?, analysis_at = ? WHERE id = ?')
            .run(JSON.stringify(analyse), new Date().toISOString(), req.params.id);
        }
      } catch {
        // Analyse impossible : on rédige quand même sur la seule annonce,
        // plutôt que de refuser la lettre. Moins bonne, mais pas absente.
      }
    }

    const contenu = await genererLettre(offre, analyse, texteCv);
    if (contenu) noterAppel(db, LETTRE);

    if (!contenu) {
      return res.status(503).json({
        ok: false,
        error: 'La rédaction a échoué (quota Gemini atteint ou service indisponible). Réessaie dans quelques minutes.',
      });
    }

    db.prepare(`
      INSERT INTO letters (offer_id, content, generated_at, edited) VALUES (?, ?, ?, 0)
      ON CONFLICT(offer_id) DO UPDATE SET content = excluded.content,
        generated_at = excluded.generated_at, edited = 0
    `).run(req.params.id, contenu, new Date().toISOString());

    // Une régénération n'est pas une nouvelle lettre : elle ne doit pas
    // regonfler la quête « rédiger une lettre » à chaque clic.
    if (!existante) journaliser(db, 'lettre', { offerId: req.params.id });
    else noterActivite(db);

    res.json({ ok: true, contenu, editee: false });
  });

  /**
   * RÉDIGER LA RELANCE D'UNE CANDIDATURE.
   *
   * L'application repérait déjà les candidatures sans réponse « à relancer » —
   * elle s'arrêtait à l'alerte. Ici elle rédige le courriel : court, adossé à
   * l'offre et au délai écoulé, prêt à copier. Pas d'enregistrement en base :
   * une relance se copie, s'envoie depuis SA messagerie, et n'a pas à laisser
   * de brouillon derrière elle.
   */
  routes.post('/relance/:id', async (req, res) => {
    const offre = lireOffreComplete(req.params.id);
    if (!offre) return res.status(404).json({ ok: false, error: 'Offre introuvable.' });

    const suivi = db.prepare('SELECT status, sent_date FROM tracking WHERE offer_id = ?')
      .get(req.params.id);
    if (!suivi?.sent_date) {
      return res.status(400).json({ ok: false,
        error: 'Cette candidature n\'a pas de date d\'envoi — rien à relancer.' });
    }

    const feuVert = peutRediger(db, profil);
    if (!feuVert.ok) return res.status(503).json({ ok: false, error: feuVert.raison });

    const jours = Math.max(0,
      Math.floor((Date.now() - new Date(suivi.sent_date + 'T12:00:00').getTime()) / 86400000));
    const coordonnees = extraireCoordonnees(cv(), profil.candidat ?? {});

    let relance;
    try {
      relance = await genererRelance({ offre, coordonnees, jours, statut: suivi.status });
    } catch { relance = null; }

    if (!relance) {
      return res.status(503).json({ ok: false,
        error: 'La rédaction a échoué (quota Gemini atteint ou service indisponible). Réessaie dans quelques minutes.' });
    }
    noterAppel(db, LETTRE);
    res.json({ ok: true, ...relance, jours });
  });

  /**
   * CV ADAPTÉ À L'OFFRE, ET ÉCART HONNÊTE.
   *
   * Deux choses en une réponse :
   *   · l'ÉCART — ce que l'offre exige et que le CV ne montre pas, plus les
   *     mots-clés absents. Tiré de l'analyse EXISTANTE, sans nouvel appel ;
   *   · le CV ADAPTÉ — accroche et points réordonnés pour cette offre, du CV
   *     réel. Là, un appel au modèle.
   *
   * Comme la lettre, une offre sans analyse est analysée à la demande : sans
   * elle, l'adaptation retombe sur l'annonce seule.
   */
  routes.post('/cv-adapte/:id', async (req, res) => {
    const offre = lireOffreComplete(req.params.id);
    if (!offre) return res.status(404).json({ ok: false, error: 'Offre introuvable.' });

    const texteCv = cv();
    if (!texteCv) {
      return res.status(400).json({ ok: false,
        error: 'CV absent. Lancer : npm run extract-cv -- "chemin/vers/CV.docx"' });
    }
    const feuVert = peutRediger(db, profil);
    if (!feuVert.ok) return res.status(503).json({ ok: false, error: feuVert.raison });

    let analyse = offre.analysis_json ? JSON.parse(offre.analysis_json) : null;
    if (!analyse) {
      try {
        analyse = await analyserOffre(offre, texteCv);
        if (analyse) {
          noterAppel(db, LETTRE);
          db.prepare('UPDATE offers SET analysis_json = ?, analysis_at = ? WHERE id = ?')
            .run(JSON.stringify(analyse), new Date().toISOString(), req.params.id);
        }
      } catch { /* on adapte sur la seule annonce, moins bien mais pas rien */ }
    }

    let adapte;
    try { adapte = await genererCvAdapte({ offre, analyse, cv: texteCv }); }
    catch { adapte = null; }

    if (!adapte) {
      return res.status(503).json({ ok: false,
        error: 'L\'adaptation a échoué (quota Gemini atteint ou service indisponible). Réessaie dans quelques minutes.' });
    }
    noterAppel(db, LETTRE);
    res.json({ ok: true, adapte, ecart: calculerEcart(analyse) });
  });

  routes.patch('/letter/:id', (req, res) => {
    const contenu = req.body?.contenu;
    if (typeof contenu !== 'string') {
      return res.status(400).json({ ok: false, error: 'Contenu de lettre manquant.' });
    }
    const avant = db.prepare('SELECT edited FROM letters WHERE offer_id = ?').get(req.params.id);

    db.prepare(`
      INSERT INTO letters (offer_id, content, generated_at, edited) VALUES (?, ?, ?, 1)
      ON CONFLICT(offer_id) DO UPDATE SET content = excluded.content, edited = 1
    `).run(req.params.id, contenu, new Date().toISOString());

    if (!avant?.edited) journaliser(db, 'retouche', { offerId: req.params.id });

    res.json({ ok: true });
  });

  routes.get('/letter/:id/docx', async (req, res) => {
    const offre = lireOffreComplete(req.params.id);
    const lettre = db.prepare('SELECT content FROM letters WHERE offer_id = ?').get(req.params.id);

    if (!offre || !lettre) {
      return res.status(404).json({ ok: false, error: 'Lettre introuvable. Génère-la d\'abord.' });
    }

    const buffer = await construireDocx(offre, lettre.content, extraireCoordonnees(cv(), profil.candidat));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${nomFichier(offre)}"`);
    res.send(buffer);
  });

  /**
   * Dossier complet : la lettre et le CV, prêts à joindre à un mail.
   *
   * Le CV part dans sa version d'origine — c'est le document que l'employeur
   * doit lire, pas le texte aplati que le programme envoie à Gemini.
   */
  routes.get('/letter/:id/dossier', async (req, res) => {
    const offre = lireOffreComplete(req.params.id);
    const lettre = db.prepare('SELECT content FROM letters WHERE offer_id = ?').get(req.params.id);

    if (!offre || !lettre) {
      return res.status(404).json({ ok: false, error: 'Lettre introuvable. Génère-la d\'abord.' });
    }

    const buffer = await construireDossier({
      offre,
      contenu: lettre.content,
      coordonnees: extraireCoordonnees(cv(), profil.candidat),
      cv: cvSource(),
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${nomDossier(offre)}"`);
    res.send(buffer);
  });

  // --- Migration depuis localStorage (une seule fois) ----------------------

  routes.post('/migrate', (req, res) => {
    if (lireMeta(db, 'migrated_from_localstorage')) {
      return res.json({ ok: true, deja: true });
    }

    const { track = {}, offers = [], pins = [], seed = [] } = req.body ?? {};

    // Table de correspondance : ancien id numérique -> hash stable.
    const correspondance = new Map();
    for (const o of seed) {
      correspondance.set(String(o.id), offreId(o.titre, o.entreprise, o.ville));
    }

    let suivisImportes = 0;
    let offresImportees = 0;

    transaction(db, () => {
      // Offres ajoutées à la main dans l'ancienne version.
      for (const o of offers) {
        const id = offreId(o.titre, o.entreprise, o.ville ?? '');
        correspondance.set(String(o.id), id);
        upsertOffre(db, {
          id, source: 'manuel', sourcesAll: ['manuel'], externalId: null,
          titre: o.titre, entreprise: o.entreprise, ville: o.ville || '—',
          contrat: o.contrat || null, dateOffre: null, lien: o.lien || null,
          description: o.verdict || null, groupe: Number(o.groupe ?? 0),
          score: null, scoreDetail: null, isManual: 1, horsZone: 0,
          departement: null, salaireSource: null,
          analysisJson: o.verdict ? { verdict: o.verdict, exige: [], souhaite: [], decoratif: [],
            prouvable: [], nonprouvable: [], compensable: [], formul: [], budget: [],
            kw: [], fourchette: null, fnote: null } : null,
        });
        offresImportees++;
      }

      // Offres du SEED d'origine : on les recrée pour ne pas perdre le suivi
      // associé, même si elles ne remonteront plus des sources.
      for (const o of seed) {
        const id = correspondance.get(String(o.id));
        if (db.prepare('SELECT id FROM offers WHERE id = ?').get(id)) continue;
        upsertOffre(db, {
          id, source: 'historique', sourcesAll: ['historique'], externalId: null,
          titre: o.titre, entreprise: o.entreprise, ville: o.ville,
          contrat: o.contrat || null, dateOffre: null, lien: o.lien || null,
          description: null, groupe: Number(o.groupe ?? 0), score: null,
          scoreDetail: null, isManual: 1, horsZone: 0, departement: null,
          salaireSource: null,
          analysisJson: o.analyse ?? null,
        });
        offresImportees++;
      }

      // Suivi personnel : statuts, dates, notes.
      for (const [ancienId, suivi] of Object.entries(track)) {
        const id = correspondance.get(String(ancienId));
        if (!id) continue;
        db.prepare(`
          INSERT INTO tracking (offer_id, status, sent_date, relance_date, notes, pinned, updated_at)
          VALUES (@id, @status, @sent, @relance, @notes, 0, @maintenant)
          ON CONFLICT(offer_id) DO UPDATE SET
            status = excluded.status, sent_date = excluded.sent_date,
            relance_date = excluded.relance_date, notes = excluded.notes
        `).run({
          id,
          status: suivi.status ?? 'À postuler',
          sent: suivi.sent ?? '',
          relance: suivi.relance ?? '',
          notes: suivi.notes ?? '',
          maintenant: new Date().toISOString(),
        });
        suivisImportes++;
      }

      // Épingles.
      for (const ancienId of pins) {
        const id = correspondance.get(String(ancienId));
        if (!id) continue;
        db.prepare(`INSERT INTO tracking (offer_id, pinned) VALUES (?, 1)
                    ON CONFLICT(offer_id) DO UPDATE SET pinned = 1`).run(id);
      }

      ecrireMeta(db, 'migrated_from_localstorage', new Date().toISOString());
    });

    res.json({ ok: true, suivisImportes, offresImportees });
  });

  return routes;
}
