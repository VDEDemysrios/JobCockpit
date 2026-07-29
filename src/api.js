// Routes de l'API REST.
//
// Toutes les réponses d'erreur suivent la forme { ok: false, error: "..." }
// avec un message en français directement affichable par le dashboard.
import express from 'express';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normaliser } from './hash.js';
import {
  lireMeta, ecrireMeta, upsertOffre, transaction, noterActivite,
  journaliser, SANS_ACTIVITE,
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
             t.status, t.sent_date, t.relance_date, t.notes, t.pinned,
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
      sources: o.sources_all ? JSON.parse(o.sources_all) : [],
      source: o.source,
      isManual: Boolean(o.is_manual),
      salaireSource: o.salaire_source,
      extrait: o.description ? String(o.description).slice(0, EXTRAIT_MAX) : '',
      analyse: o.analysis_json ? JSON.parse(o.analysis_json) : null,
      aLettre: Boolean(o.a_lettre),
      lettreEditee: Boolean(o.lettre_editee),
      vueLe: o.first_seen,
      suivi: {
        status: o.status ?? 'À postuler',
        sent: o.sent_date ?? '',
        relance: o.relance_date ?? '',
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
      objectifHebdo: Number(lireMeta(db, 'objectif_hebdo') ?? OBJECTIF_DEFAUT),
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
   * récompense quelque chose que Benjamin ne peut pas prouver — et
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

  routes.delete('/offers/:id', (req, res) => {
    const offre = db.prepare('SELECT is_manual FROM offers WHERE id = ?').get(req.params.id);
    if (!offre) return res.status(404).json({ ok: false, error: 'Offre introuvable.' });
    if (!offre.is_manual) {
      return res.status(400).json({
        ok: false,
        error: 'Seules les offres ajoutées à la main peuvent être supprimées. Les offres collectées disparaissent d\'elles-mêmes après 30 jours.',
      });
    }

    transaction(db, () => {
      db.prepare('DELETE FROM letters  WHERE offer_id = ?').run(req.params.id);
      db.prepare('DELETE FROM tracking WHERE offer_id = ?').run(req.params.id);
      db.prepare('DELETE FROM offers   WHERE id = ?').run(req.params.id);
    });

    res.json({ ok: true });
  });

  // --- Collecte à la demande -----------------------------------------------

  routes.post('/refresh', async (req, res) => {
    if (collecteEnCours) {
      return res.status(409).json({ ok: false, error: 'Une collecte est déjà en cours.' });
    }
    collecteEnCours = true;
    try {
      const resume = await collecter({ db, profil, sources, cv: cv(), analyser: true });
      // Déclencher une collecte est une décision de Benjamin : ça vaut une
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

    const analyse = offre.analysis_json ? JSON.parse(offre.analysis_json) : null;
    const contenu = await genererLettre(offre, analyse, texteCv);

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
