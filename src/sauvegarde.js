// Sauvegarde automatique, à la fin de chaque collecte.
//
// POURQUOI PAS UN COPIER-COLLER
// -----------------------------
// SQLite tourne en mode WAL : les écritures récentes vivent dans `data.db-wal`
// tant qu'elles ne sont pas intégrées. Copier le seul `data.db` d'une base
// vivante donne un état périmé de plusieurs heures — SANS le moindre
// avertissement. C'est arrivé le 1er août 2026 : 881 offres au lieu de 279.
//
// `VACUUM INTO` est la réponse de SQLite à ce problème : il écrit une copie
// complète et cohérente, WAL compris, en un seul fichier — 1,4 Mo là où le
// trio en pèse 9. Il fonctionne sur une base ouverte, même en lecture seule.
//
// POURQUOI HORS DU DOSSIER DU PROJET
// ----------------------------------
// Le risque réel n'est pas la panne de disque : c'est le dossier remplacé,
// déplacé ou supprimé. C'est déjà arrivé une fois à ce projet. Une sauvegarde
// rangée dans le dossier qu'elle protège ne protège de rien.
//
// Cela reste une sauvegarde LOCALE : elle ne survit pas à un disque mort.
// Pour ça, il faudrait un dossier synchronisé — c'est ce que règle `dossier`.
import {
  mkdirSync, copyFileSync, existsSync, readdirSync, rmSync, statSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Documents\JobCockpit-sauvegardes — hors du projet, dans un endroit connu. */
export function dossierParDefaut() {
  const documents = join(homedir(), 'Documents');
  return join(existsSync(documents) ? documents : homedir(), 'JobCockpit-sauvegardes');
}

export function reglages(profil = {}) {
  const s = profil.sauvegarde ?? {};
  return {
    active: s.active !== false,                       // activée sauf refus explicite
    dossier: s.dossier || dossierParDefaut(),
    garderJours: Math.max(1, Number(s.garderJours ?? 30)),
    joursComplets: Math.max(0, Number(s.joursComplets ?? 2)),
  };
}

/** Horodatage triable et lisible : 2026-08-01_21h45. */
function horodatage(quand = new Date()) {
  const p = (v) => String(v).padStart(2, '0');
  return `${quand.getFullYear()}-${p(quand.getMonth() + 1)}-${p(quand.getDate())}`
    + `_${p(quand.getHours())}h${p(quand.getMinutes())}`;
}

const estUneSauvegarde = (nom) => /^\d{4}-\d{2}-\d{2}_\d{2}h\d{2}$/.test(nom);
const jourDe = (nom) => nom.slice(0, 10);

/**
 * Le fichier derrière une base ouverte, ou '' si elle vit en mémoire.
 * `PRAGMA database_list` rend un chemin vide pour « :memory: ».
 */
function fichierDeLaBase(db) {
  try {
    const principale = db.prepare('PRAGMA database_list').all()
      .find(l => l.name === 'main');
    return principale?.file ?? '';
  } catch {
    return '';
  }
}

/**
 * Décide ce qui reste et ce qui part.
 *
 * Fonction PURE, pour être testable sans toucher au disque.
 *
 * On garde TOUT des derniers jours — c'est là qu'on revient quand on vient de
 * faire une bêtise — puis seulement la dernière de chaque jour au-delà. Un
 * simple « garder les 30 dernières » aurait couvert une semaine à raison de
 * quatre collectes par jour ; ce tri-là couvre un mois pour la même place.
 *
 * @param {string[]} noms       dossiers présents
 * @param {object} r            réglages
 * @param {Date} maintenant
 * @returns {{garder: string[], supprimer: string[]}}
 */
export function trier(noms, r, maintenant = new Date()) {
  const valides = noms.filter(estUneSauvegarde).sort();
  const jourMoins = (n) => new Date(maintenant.getTime() - n * 86400000)
    .toISOString().slice(0, 10);

  const limiteJour = jourMoins(r.garderJours);
  // `joursComplets` compte AUJOURD'HUI comme le premier : à 2, ce sont
  // aujourd'hui et hier, donc on remonte d'un seul jour. Sans ce « -1 », le
  // réglage gardait toujours un jour de trop.
  const seuilComplet = jourMoins(Math.max(0, r.joursComplets - 1));

  const derniereDuJour = new Map();
  for (const n of valides) derniereDuJour.set(jourDe(n), n);

  const garder = valides.filter(n => {
    const j = jourDe(n);
    if (j < limiteJour) return false;              // trop vieux
    if (j >= seuilComplet) return true;            // jours récents : tout
    return derniereDuJour.get(j) === n;            // au-delà : une par jour
  });

  const aGarder = new Set(garder);
  return { garder, supprimer: valides.filter(n => !aGarder.has(n)) };
}

/**
 * Écrit une sauvegarde et applique la rotation.
 *
 * Ne lève JAMAIS : une sauvegarde impossible ne doit pas faire échouer la
 * collecte qu'elle accompagne. Elle le dit, et la collecte continue.
 *
 * @returns {{ok: boolean, chemin?: string, octets?: number, supprimees?: number, erreur?: string}}
 */
export function sauvegarder(db, { racine, profil = {}, quand = new Date() }) {
  const r = reglages(profil);
  if (!r.active) return { ok: false, erreur: 'sauvegarde désactivée dans profile.json' };

  // Une base EN MÉMOIRE n'a pas de fichier à protéger : la sauvegarder n'a
  // aucun sens, et la sauvegarder QUAND MÊME est un vrai danger — les tests
  // en ouvrent à la douzaine, et sans ce garde-fou ils écrivaient de fausses
  // sauvegardes d'une offre dans les Documents de l'utilisateur, poussant les
  // vraies hors de la rotation. Constaté le 1er août 2026.
  if (!fichierDeLaBase(db)) {
    return { ok: false, erreur: 'base en mémoire — rien à sauvegarder' };
  }

  try {
    const cible = join(r.dossier, horodatage(quand));
    mkdirSync(cible, { recursive: true });

    // La base d'abord : c'est elle qui ne se reconstruit pas.
    // VACUUM INTO REFUSE d'écrire sur un fichier existant : deux collectes
    // dans la même minute échoueraient sans ce nettoyage préalable.
    const baseCopie = join(cible, 'data.db');
    rmSync(baseCopie, { force: true });
    db.exec(`VACUUM INTO '${baseCopie.replace(/\\/g, '/').replace(/'/g, "''")}'`);

    // Puis ce qui se règle à la main et se reperd aussi vite.
    for (const [source, nom] of [
      [join(racine, 'profile/profile.json'), 'profile.json'],
      [join(racine, '.env'), '.env'],
      [join(racine, 'profile/cv.txt'), 'cv.txt'],
      [join(racine, 'profile/cv-source.docx'), 'cv-source.docx'],
    ]) {
      if (existsSync(source)) copyFileSync(source, join(cible, nom));
    }

    const { supprimer } = trier(readdirSync(r.dossier), r, quand);
    for (const n of supprimer) rmSync(join(r.dossier, n), { recursive: true, force: true });

    return {
      ok: true,
      chemin: cible,
      octets: statSync(baseCopie).size,
      supprimees: supprimer.length,
    };
  } catch (erreur) {
    return { ok: false, erreur: erreur.message };
  }
}

/** Les sauvegardes présentes, de la plus récente à la plus ancienne. */
export function lister(profil = {}) {
  const r = reglages(profil);
  if (!existsSync(r.dossier)) return [];
  return readdirSync(r.dossier)
    .filter(estUneSauvegarde)
    .sort()
    .reverse()
    .map(nom => {
      const base = join(r.dossier, nom, 'data.db');
      return {
        nom,
        chemin: join(r.dossier, nom),
        octets: existsSync(base) ? statSync(base).size : 0,
      };
    });
}
