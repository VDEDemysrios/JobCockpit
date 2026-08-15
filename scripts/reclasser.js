// Rejoue le classement sur les offres DÉJÀ en base.
//
// POURQUOI CE SCRIPT EXISTE
// -------------------------
// Le groupe et le score sont calculés à la collecte, puis stockés. Modifier
// un seuil ou un motif dans profile.json ne change donc RIEN aux offres déjà
// ramenées : elles gardent le classement qu'elles avaient au moment où elles
// sont arrivées. On ajustait les règles sans rien voir bouger.
//
// Ce script relit chaque offre et lui réapplique le scoring courant.
//
// Il n'écrit QUE dans les colonnes de classement de la table `offers` :
// ni statut, ni note, ni relance, ni épingle, ni lettre. Une offre déjà
// suivie change éventuellement de couleur, jamais d'état.
//
// Usage :
//   npm run reclasser                 -> montre ce qui bougerait
//   npm run reclasser -- --appliquer  -> écrit les nouveaux classements
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ouvrirBase, transaction } from '../src/db.js';
import { scorer } from '../src/scoring.js';

const LABEL = { 1: '🟢 prioritaire', 2: '🟡 possible', 0: '⚪ à vérifier', 3: '🔴 à écarter' };

export function principal(argv = process.argv.slice(2)) {
  const appliquer = argv.includes('--appliquer');
  const profil = JSON.parse(readFileSync('profile/profile.json', 'utf8'));
  const db = ouvrirBase('data.db');

  try {
    const offres = db.prepare('SELECT id, titre, description, groupe, score FROM offers').all();
    const mouvements = [];

    for (const o of offres) {
      const r = scorer({ titre: o.titre, description: o.description }, profil);
      if (r.groupe !== o.groupe || r.score !== o.score) {
        mouvements.push({ ...o, versGroupe: r.groupe, versScore: r.score, detail: r.detail });
      }
    }

    console.log(`\n🔄 Reclassement — ${offres.length} offre(s) en base`);

    if (mouvements.length === 0) {
      console.log('\n✅ Aucun changement : le classement stocké correspond déjà aux règles.\n');
      return 0;
    }

    // Résumé par transition, du plus fréquent au plus rare.
    const transitions = {};
    for (const m of mouvements) {
      const cle = `${LABEL[m.groupe]} → ${LABEL[m.versGroupe]}`;
      (transitions[cle] ??= []).push(m);
    }

    for (const [cle, lot] of Object.entries(transitions).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n  ${String(lot.length).padStart(4)}  ${cle}`);
      for (const m of lot.slice(0, 5)) {
        console.log(`        ${String(m.score).padStart(2)} → ${String(m.versScore).padStart(2)}  ${m.titre.slice(0, 62)}`);
      }
      if (lot.length > 5) console.log(`        … et ${lot.length - 5} autres`);
    }

    // Les offres qui MONTENT méritent d'être vues en entier : ce sont des
    // occasions qu'on avait écartées à tort.
    const promues = mouvements.filter(m => m.versGroupe === 1 && m.groupe !== 1);
    if (promues.length) {
      console.log(`\n  ⬆ ${promues.length} offre(s) deviennent prioritaires :`);
      for (const m of promues) console.log(`        ${m.titre.slice(0, 70)}`);
    }

    console.log(`\n  ${mouvements.length} offre(s) changeraient de classement.`);

    if (!appliquer) {
      console.log('\n👉 Simulation. Pour écrire les nouveaux classements :');
      console.log('     npm run reclasser -- --appliquer\n');
      return 0;
    }

    const maj = db.prepare('UPDATE offers SET groupe = ?, score = ?, score_detail = ? WHERE id = ?');
    transaction(db, () => {
      for (const m of mouvements) maj.run(m.versGroupe, m.versScore, JSON.stringify(m.detail), m.id);
    });

    console.log(`\n✅ ${mouvements.length} offre(s) reclassée(s). Suivi, notes et lettres intacts.\n`);
    return mouvements.length;
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    principal();
  } catch (erreur) {
    console.error('❌ Reclassement interrompu :', erreur.message);
    process.exitCode = 1;
  }
}
