// Routes de l'API REST.
//
// Toutes les réponses d'erreur suivent la forme { ok: false, error: "..." }
// avec un message en français directement affichable par le dashboard.
import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { lireMeta, ecrireMeta, upsertOffre, transaction, noterActivite, lireJoursActifs } from './db.js';
import {
  SUCCES, niveauPour, calculerXp, calculerSerie, debutDeSemaine, succesAtteints,
} from './progression.js';
import { offreId } from './hash.js';
import { scorer } from './scoring.js';
import { genererLettre, extraireCoordonnees } from './letter.js';
import { construireDocx, nomFichier } from './letterDocx.js';
import { extraireOffreCollee } from './paste.js';
import { analyserOffre } from './analyze.js';

export function creerRoutes({ db, collecter, sources, profil }) {
  const routes = express.Router();

  // Une seule collecte à la fois : deux collectes concurrentes se marcheraient
  // dessus (quota LLM gaspillé, écritures entrelacées).
  let collecteEnCours = false;

  const cv = () => (existsSync('profile/cv.txt') ? readFileSync('profile/cv.txt', 'utf8') : '');

  /** Assemble une offre avec son suivi, pour le dashboard. */
  function lireOffres() {
    return db.prepare(`
      SELECT o.*,
             t.status, t.sent_date, t.relance_date, t.notes, t.pinned,
             CASE WHEN l.offer_id IS NULL THEN 0 ELSE 1 END AS a_lettre
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
      isManual: Boolean(o.is_manual),
      analyse: o.analysis_json ? JSON.parse(o.analysis_json) : null,
      aLettre: Boolean(o.a_lettre),
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
    });
  });

  // --- Suivi personnel -----------------------------------------------------

  const CHAMPS_SUIVI = {
    status: 'status', sent: 'sent_date', relance: 'relance_date',
    notes: 'notes', pinned: 'pinned',
  };

  routes.patch('/track/:id', (req, res) => {
    const offre = db.prepare('SELECT id FROM offers WHERE id = ?').get(req.params.id);
    if (!offre) return res.status(404).json({ ok: false, error: 'Offre introuvable.' });

    const maj = Object.entries(req.body ?? {})
      .filter(([cle]) => cle in CHAMPS_SUIVI);

    if (maj.length === 0) {
      return res.status(400).json({ ok: false, error: 'Aucun champ de suivi valide fourni.' });
    }

    // La ligne de suivi peut ne pas exister encore.
    db.prepare(`INSERT INTO tracking (offer_id) VALUES (?) ON CONFLICT(offer_id) DO NOTHING`)
      .run(req.params.id);

    for (const [cle, valeur] of maj) {
      const colonne = CHAMPS_SUIVI[cle];
      // node:sqlite refuse les booléens et undefined.
      const v = cle === 'pinned' ? (valeur ? 1 : 0) : (valeur ?? '');
      db.prepare(`UPDATE tracking SET ${colonne} = ?, updated_at = ? WHERE offer_id = ?`)
        .run(v, new Date().toISOString(), req.params.id);
    }

    // Épingler ou annoter n'est pas « avancer » : seul un changement de
    // statut compte pour la série, sinon elle se maintiendrait toute seule.
    if (maj.some(([cle]) => cle === 'status')) noterActivite(db);

    res.json({ ok: true, progression: construireProgression() });
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
      res.json({ ok: true, resume });
    } catch (erreur) {
      // Une collecte ratée ne doit jamais casser le dashboard : les offres
      // déjà en base restent intactes.
      res.status(500).json({ ok: false, error: `Collecte impossible : ${erreur.message}` });
    } finally {
      collecteEnCours = false;
    }
  });

  // --- Progression : expérience, niveau, série, succès ---------------------

  const OBJECTIF_DEFAUT = 5;

  /**
   * Agrège l'état réel de la base. L'expérience est TOUJOURS recalculée
   * d'ici, jamais accumulée : refaire une action ne double pas les points,
   * et corriger une erreur de saisie corrige aussi le score.
   */
  function agregerEtat() {
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const lundi = debutDeSemaine(aujourdhui);

    const n = (sql, params = []) => db.prepare(sql).get(...params)?.n ?? 0;

    const envoyees = n(`SELECT COUNT(*) n FROM tracking WHERE status <> 'À postuler'`);
    const relances = n(`SELECT COUNT(*) n FROM tracking WHERE status IN ('Relancé','Entretien','Refus')`);
    const entretiens = n(`SELECT COUNT(*) n FROM tracking WHERE status = 'Entretien'`);
    const lettres = n(`SELECT COUNT(*) n FROM letters`);
    const ajoutsManuels = n(`SELECT COUNT(*) n FROM offers WHERE is_manual = 1 OR source = 'collage'`);
    const analysees = n(`SELECT COUNT(*) n FROM offers WHERE analysis_json IS NOT NULL`);
    const faitCetteSemaine = n(`SELECT COUNT(*) n FROM tracking WHERE sent_date >= ?`, [lundi]);

    const villesDistinctes = n(`
      SELECT COUNT(DISTINCT o.ville) n FROM offers o
      JOIN tracking t ON t.offer_id = o.id
      WHERE t.status <> 'À postuler'`);

    const agrivoltaique = n(`
      SELECT COUNT(*) n FROM offers o
      JOIN tracking t ON t.offer_id = o.id
      WHERE t.status <> 'À postuler'
        AND (lower(o.titre) LIKE '%agrivolta%' OR lower(o.description) LIKE '%agrivolta%')`) > 0;

    // Urgences : relances échues et entretiens en cours (mêmes règles que
    // la vue « Focus du jour » côté navigateur).
    const urgencesEnAttente = n(`
      SELECT COUNT(*) n FROM tracking
      WHERE (relance_date <> '' AND relance_date <= ? AND status NOT IN ('Refus','Entretien'))
         OR status = 'Entretien'`, [aujourdhui]);

    const serie = calculerSerie(lireJoursActifs(db), aujourdhui);
    const objectifHebdo = Number(lireMeta(db, 'objectif_hebdo') ?? OBJECTIF_DEFAUT);

    return {
      envoyees, relances, entretiens, lettres, ajoutsManuels, analysees,
      faitCetteSemaine, villesDistinctes, agrivoltaique, urgencesEnAttente,
      serie, objectifHebdo,
    };
  }

  /**
   * Enregistre les succès nouvellement atteints et renvoie leur liste.
   * Un succès obtenu ne se reperd jamais, même si l'état redescend :
   * reprendre un badge parce qu'on a corrigé un statut serait vexant et
   * absurde.
   */
  function debloquerSucces(etat) {
    const atteints = succesAtteints(etat);
    const dejaObtenus = new Set(db.prepare('SELECT code FROM succes').all().map(r => r.code));
    const nouveaux = atteints.filter(c => !dejaObtenus.has(c));

    if (nouveaux.length) {
      const maintenant = new Date().toISOString();
      const ins = db.prepare('INSERT INTO succes (code, obtenu_le) VALUES (?, ?) ON CONFLICT(code) DO NOTHING');
      for (const code of nouveaux) ins.run(code, maintenant);
    }
    return nouveaux;
  }

  function construireProgression() {
    const etat = agregerEtat();
    const nouveaux = debloquerSucces(etat);

    const xp = calculerXp(etat);
    const niveau = niveauPour(xp);

    const obtenus = new Map(
      db.prepare('SELECT code, obtenu_le FROM succes').all().map(r => [r.code, r.obtenu_le])
    );

    return {
      xp,
      niveau,
      serie: etat.serie,
      objectifHebdo: etat.objectifHebdo,
      faitCetteSemaine: etat.faitCetteSemaine,
      stats: etat,
      nouveauxSucces: nouveaux,
      succes: SUCCES.map(s => ({
        code: s.code, nom: s.nom, emoji: s.emoji, astuce: s.astuce,
        obtenu: obtenus.has(s.code),
        obtenuLe: obtenus.get(s.code) ?? null,
      })),
    };
  }

  routes.get('/progression', (req, res) => {
    res.json({ ok: true, ...construireProgression() });
  });

  routes.put('/progression/objectif', (req, res) => {
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

    noterActivite(db);
    res.json({ ok: true, contenu, editee: false, progression: construireProgression() });
  });

  routes.patch('/letter/:id', (req, res) => {
    const contenu = req.body?.contenu;
    if (typeof contenu !== 'string') {
      return res.status(400).json({ ok: false, error: 'Contenu de lettre manquant.' });
    }
    db.prepare(`
      INSERT INTO letters (offer_id, content, generated_at, edited) VALUES (?, ?, ?, 1)
      ON CONFLICT(offer_id) DO UPDATE SET content = excluded.content, edited = 1
    `).run(req.params.id, contenu, new Date().toISOString());

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
