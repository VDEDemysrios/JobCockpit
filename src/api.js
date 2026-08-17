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
import { peutRediger, noterAppel, etatQuota, LETTRE, ENTRETIEN } from './quota.js';
import { estConfigure, construireProfil, rendreEnv, CLES_ENV } from './configuration.js';
import { validerVilles, decrireVille, DEPARTEMENTS, VILLES_MAX } from './villes.js';
import { verifierOffres, aVerifier } from './liens.js';
import {
  promptQuestion, promptDebrief, promptFiche, promptNotions,
  TYPES_NOTIONS, QUESTIONS_PAR_SEANCE,
} from './entretien.js';
import { demander, demanderAncre, estConfigure as geminiPret, extraireJson } from './gemini.js';
import { enregistrerCv } from './cv.js';
import {
  lireMeta, ecrireMeta, upsertOffre, transaction, noterActivite,
  journaliser, SANS_ACTIVITE, supprimerOffres, oublierRejets, restaurerRejet,
} from './db.js';
import { calculerStats, isoLocal } from './stats.js';
import { offreId } from './hash.js';
import { scorer } from './scoring.js';
import { genererLettre, extraireCoordonnees } from './letter.js';
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

export function creerRoutes({ db, collecter, sources, profil }) {
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
