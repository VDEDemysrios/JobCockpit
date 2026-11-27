// Les rappels : ce qui demande une action, du plus urgent au moins urgent.
//
// POURQUOI UN CALCUL SERVEUR
// --------------------------
// Les échéances étaient éparpillées : la relance dans l'agenda, l'entretien
// dans sa carte, les candidatures restées sans réponse nulle part. Pour savoir
// quoi faire ce matin, il fallait ouvrir trois vues et faire le tri de tête.
// Cette liste les réunit et les ORDONNE — un badge d'onglet, une notification
// et un centre de rappels s'en nourrissent sans refaire le calcul chacun.
//
// QUATRE TYPES, UNE ÉCHELLE
// -------------------------
//   entretien     — la seule échéance qu'on ne peut ni décaler ni rattraper ;
//   relance       — planifiée par l'auteur, en retard ou toute proche ;
//   sans-reponse  — envoyée il y a plus de 14 jours, sans que rien ne bouge ;
//   offre-fraiche — prioritaire apparue depuis moins de 48 h : les premières
//                   candidatures sont celles qu'on lit.
// `poids` les range sur une seule échelle : plus il est haut, plus c'est
// urgent. Les dates sont en heure LOCALE, comme partout dans le projet.
import { isoLocal } from './stats.js';

const JOUR_MS = 86400000;

/** Seuil au-delà duquel une candidature est dite « sans réponse ». */
export const SANS_REPONSE_JOURS = 14;
/** Une relance est rappelée si elle tombe dans ce délai, ou est passée. */
const HORIZON_RELANCE_JOURS = 3;
/** Une offre prioritaire reste « fraîche » ce nombre d'heures. */
const FRAICHEUR_HEURES = 48;

/** Écart en jours entre deux dates ISO, à midi local pour enjamber l'heure d'été. */
function ecartJours(de, a) {
  const midi = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00`).getTime();
  return Math.round((midi(a) - midi(de)) / JOUR_MS);
}

const dateValide = (iso) => /^\d{4}-\d{2}-\d{2}/.test(String(iso ?? ''));

/**
 * @param {object} db
 * @param {object} [options] { maintenant } pour les tests
 * @returns {object[]} triés par `poids` décroissant
 */
export function calculerRappels(db, { maintenant = new Date() } = {}) {
  const aujourdhui = isoLocal(maintenant);
  const rappels = [];

  const suivis = db.prepare(`
    SELECT o.id, o.titre, o.entreprise,
           t.status, t.sent_date, t.relance_date, t.entretien_date
    FROM tracking t JOIN offers o ON o.id = t.offer_id
  `).all();

  // Dernier changement de statut connu, par offre : c'est lui qui dit si une
  // candidature « bouge » encore. `updated_at` ne suffit pas — il change à
  // chaque note, et une note n'est pas une réponse de l'employeur.
  const derniersStatuts = new Map(db.prepare(`
    SELECT offer_id, MAX(jour) jour FROM evenements
    WHERE offer_id IS NOT NULL AND type IN ('candidature', 'relance', 'entretien', 'refus', 'statut')
    GROUP BY offer_id
  `).all().map(r => [r.offer_id, r.jour]));

  for (const s of suivis) {
    const base = { offerId: s.id, titre: s.titre, entreprise: s.entreprise ?? '' };
    const enAttente = s.status === 'Envoyé' || s.status === 'Relancé';

    // ENTRETIEN — aujourd'hui ou plus tard. Passé, il n'y a plus rien à faire.
    if (dateValide(s.entretien_date) && s.status !== 'Refus') {
      const dans = ecartJours(aujourdhui, s.entretien_date);
      if (dans >= 0) {
        rappels.push({ ...base, type: 'entretien', date: s.entretien_date.slice(0, 10),
          dansJours: dans, retardJours: 0, poids: Math.max(60, 100 - dans * 3) });
      }
    }

    // RELANCE — en retard, ou dans les trois jours.
    let relancePrevue = false;
    if (enAttente && dateValide(s.relance_date)) {
      const dans = ecartJours(aujourdhui, s.relance_date);
      relancePrevue = dans >= 0;
      if (dans <= HORIZON_RELANCE_JOURS) {
        const retard = Math.max(0, -dans);
        rappels.push({ ...base, type: 'relance', date: s.relance_date.slice(0, 10),
          dansJours: dans, retardJours: retard,
          poids: dans < 0 ? Math.min(95, 80 + retard) : 70 - dans * 5 });
      }
    }

    // SANS RÉPONSE — envoyée il y a plus de 14 jours, rien n'a bougé depuis,
    // et aucune relance n'est déjà prévue (elle aurait son propre rappel).
    if (enAttente && !relancePrevue && dateValide(s.sent_date)) {
      const depuisEnvoi = ecartJours(s.sent_date, aujourdhui);
      const dernier = derniersStatuts.get(s.id) ?? s.sent_date;
      const depuisMouvement = ecartJours(dernier, aujourdhui);
      if (depuisEnvoi > SANS_REPONSE_JOURS && depuisMouvement > SANS_REPONSE_JOURS) {
        rappels.push({ ...base, type: 'sans-reponse', date: s.sent_date.slice(0, 10),
          dansJours: -depuisEnvoi, retardJours: depuisEnvoi - SANS_REPONSE_JOURS,
          poids: Math.min(55, 40 + Math.floor((depuisEnvoi - SANS_REPONSE_JOURS) / 2)) });
      }
    }
  }

  // OFFRES FRAÎCHES — prioritaires, encore à postuler.
  const limite = new Date(maintenant.getTime() - FRAICHEUR_HEURES * 3600000).toISOString();
  const fraiches = db.prepare(`
    SELECT o.id, o.titre, o.entreprise, o.first_seen
    FROM offers o LEFT JOIN tracking t ON t.offer_id = o.id
    WHERE o.groupe = 1 AND o.first_seen >= ?
      AND COALESCE(t.status, 'À postuler') = 'À postuler'
    ORDER BY o.score DESC LIMIT 20
  `).all(limite);
  for (const o of fraiches) {
    const vue = isoLocal(new Date(o.first_seen));
    rappels.push({ offerId: o.id, titre: o.titre, entreprise: o.entreprise ?? '',
      type: 'offre-fraiche', date: vue, dansJours: -ecartJours(vue, aujourdhui),
      retardJours: 0, poids: 30 });
  }

  // Urgence d'abord ; à poids égal, l'échéance la plus proche.
  return rappels.sort((a, b) => b.poids - a.poids || a.dansJours - b.dansJours);
}
