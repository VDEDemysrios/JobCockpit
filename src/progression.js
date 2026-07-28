// Moteur de progression : expérience, niveaux, série, objectif, succès.
//
// PRINCIPE DE CONCEPTION
// ----------------------
// On récompense l'EFFORT (postuler, relancer, écrire), pas le RÉSULTAT
// (décrocher un entretien). Chercher un emploi expose déjà à beaucoup de
// refus : un système qui noterait Benjamin sur des réponses qu'il ne maîtrise
// pas serait démoralisant au pire moment. Les entretiens rapportent un bonus,
// mais aucun palier n'en dépend.
//
// L'expérience est RECALCULÉE à partir de l'état réel de la base, jamais
// accumulée dans un compteur. Conséquence : rien ne se double si une action
// est refaite, et corriger une erreur de saisie corrige aussi le score.

/** Ce que rapporte chaque action. */
export const POINTS = {
  candidatureEnvoyee: 25,
  relanceEffectuee: 15,
  lettreRedigee: 10,
  offreAjouteeMain: 5,
  entretienDecroche: 100,  // bonus, jamais une condition de palier
  offreAnalysee: 1,
};

/** Paliers. Les titres suivent une trajectoire de carrière dans les EnR. */
export const NIVEAUX = [
  { seuil: 0,    titre: 'Prospecteur',              embleme: '🌱' },
  { seuil: 120,  titre: 'Porteur de projet',        embleme: '🌿' },
  { seuil: 320,  titre: 'Développeur junior',       embleme: '☀️' },
  { seuil: 650,  titre: 'Chef de projet',           embleme: '⚡' },
  { seuil: 1100, titre: 'Chef de projet confirmé',  embleme: '🔆' },
  { seuil: 1700, titre: 'Responsable de portefeuille', embleme: '🏔️' },
  { seuil: 2500, titre: 'Directeur du développement', embleme: '👑' },
];

/**
 * Catalogue des succès.
 * `test` reçoit un état agrégé et dit si le succès est atteint.
 */
export const SUCCES = [
  { code: 'premier-envoi',    nom: 'Premier dépôt',      emoji: '📨', astuce: 'Envoyer une première candidature.',
    test: e => e.envoyees >= 1 },
  { code: 'cinq-envois',      nom: 'En campagne',        emoji: '🚀', astuce: 'Envoyer 5 candidatures.',
    test: e => e.envoyees >= 5 },
  { code: 'quinze-envois',    nom: 'Machine de guerre',  emoji: '🏭', astuce: 'Envoyer 15 candidatures.',
    test: e => e.envoyees >= 15 },
  { code: 'premiere-lettre',  nom: 'Plume affûtée',      emoji: '✒️', astuce: 'Rédiger une première lettre de motivation.',
    test: e => e.lettres >= 1 },
  { code: 'dix-lettres',      nom: 'Écrivain public',    emoji: '📚', astuce: 'Rédiger 10 lettres.',
    test: e => e.lettres >= 10 },
  { code: 'premiere-relance', nom: 'Persévérant',        emoji: '🔔', astuce: 'Effectuer une première relance.',
    test: e => e.relances >= 1 },
  { code: 'cinq-relances',    nom: 'Tenace',             emoji: '🥊', astuce: 'Effectuer 5 relances.',
    test: e => e.relances >= 5 },
  { code: 'premier-entretien', nom: 'Porte ouverte',     emoji: '🚪', astuce: 'Décrocher un entretien.',
    test: e => e.entretiens >= 1 },
  { code: 'serie-3',          nom: 'Sur la lancée',      emoji: '🔥', astuce: 'Être actif 3 jours ouvrés d\'affilée.',
    test: e => e.serie >= 3 },
  { code: 'serie-7',          nom: 'Discipline',         emoji: '💎', astuce: 'Être actif 7 jours ouvrés d\'affilée.',
    test: e => e.serie >= 7 },
  { code: 'objectif-atteint', nom: 'Contrat rempli',     emoji: '🎯', astuce: 'Atteindre ton objectif hebdomadaire.',
    test: e => e.objectifHebdo > 0 && e.faitCetteSemaine >= e.objectifHebdo },
  { code: 'boite-vide',       nom: 'Boîte vide',         emoji: '🧘', astuce: 'N\'avoir plus aucune action urgente en attente.',
    test: e => e.envoyees >= 3 && e.urgencesEnAttente === 0 },
  { code: 'agrivoltaique',    nom: 'Terrain de jeu',     emoji: '🌾', astuce: 'Postuler à une offre agrivoltaïque — ta spécialité.',
    test: e => e.agrivoltaique },
  { code: 'quatre-villes',    nom: 'Ratisse large',      emoji: '🗺️', astuce: 'Suivre des offres dans 3 villes différentes.',
    test: e => e.villesDistinctes >= 3 },
  { code: 'collectionneur',   nom: 'Veilleur',           emoji: '📡', astuce: 'Avoir 25 offres analysées au compteur.',
    test: e => e.analysees >= 25 },
];

/** Niveau correspondant à un total d'expérience. */
export function niveauPour(xp) {
  let index = 0;
  for (let i = 0; i < NIVEAUX.length; i++) {
    if (xp >= NIVEAUX[i].seuil) index = i;
  }
  const actuel = NIVEAUX[index];
  const suivant = NIVEAUX[index + 1] ?? null;

  const base = actuel.seuil;
  const cible = suivant ? suivant.seuil : actuel.seuil;
  const progression = suivant
    ? Math.round((xp - base) / (cible - base) * 100)
    : 100;

  return {
    rang: index + 1,
    titre: actuel.titre,
    embleme: actuel.embleme,
    seuilActuel: base,
    seuilSuivant: suivant ? cible : null,
    titreSuivant: suivant ? suivant.titre : null,
    manquant: suivant ? cible - xp : 0,
    progression: Math.max(0, Math.min(100, progression)),
  };
}

/** Total d'expérience déduit de l'état réel. */
export function calculerXp(e) {
  return e.envoyees * POINTS.candidatureEnvoyee
    + e.relances * POINTS.relanceEffectuee
    + e.lettres * POINTS.lettreRedigee
    + e.ajoutsManuels * POINTS.offreAjouteeMain
    + e.entretiens * POINTS.entretienDecroche
    + e.analysees * POINTS.offreAnalysee;
}

/**
 * Série de jours ouvrés consécutifs avec au moins une action.
 *
 * Les week-ends sont IGNORÉS, pas comptés comme des ruptures : ne pas
 * postuler un dimanche ne doit pas casser une série. C'est la même règle
 * que dans Méridien.
 *
 * @param {string[]} joursActifs  dates ISO, ordre indifférent
 * @param {string} aujourdhui     date ISO de référence
 */
export function calculerSerie(joursActifs, aujourdhui) {
  const actifs = new Set(joursActifs);
  const estWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
  const iso = (d) => d.toISOString().slice(0, 10);

  let serie = 0;
  const curseur = new Date(aujourdhui + 'T12:00:00Z');

  // Une série reste vivante si l'action a eu lieu aujourd'hui OU lors du
  // dernier jour ouvré. Sinon, elle est rompue.
  if (!actifs.has(iso(curseur))) {
    do { curseur.setUTCDate(curseur.getUTCDate() - 1); } while (estWeekend(curseur));
    if (!actifs.has(iso(curseur))) return 0;
  }

  // Remontée jour ouvré par jour ouvré.
  while (true) {
    if (estWeekend(curseur)) {
      curseur.setUTCDate(curseur.getUTCDate() - 1);
      continue;
    }
    if (!actifs.has(iso(curseur))) break;
    serie++;
    curseur.setUTCDate(curseur.getUTCDate() - 1);
  }

  return serie;
}

/** Lundi de la semaine en cours, au format ISO. */
export function debutDeSemaine(aujourdhui) {
  const d = new Date(aujourdhui + 'T12:00:00Z');
  const jour = d.getUTCDay();
  const recul = jour === 0 ? 6 : jour - 1; // lundi = début de semaine
  d.setUTCDate(d.getUTCDate() - recul);
  return d.toISOString().slice(0, 10);
}

/** Succès atteints pour un état donné. */
export function succesAtteints(etat) {
  return SUCCES.filter(s => s.test(etat)).map(s => s.code);
}
