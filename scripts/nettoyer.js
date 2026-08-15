// Nettoyage des offres qui ne correspondent pas au profil.
//
// Une collecte ratisse large exprès : mieux vaut une offre de trop qu'une
// offre manquée. Le revers, c'est que la base accumule des postes que
// l'auteur n'ouvrira jamais. Ce script les enlève.
//
// SIMULATION PAR DÉFAUT. Sans `--appliquer`, rien n'est supprimé : le script
// se contente d'afficher ce qu'il ferait. Une suppression est irrécupérable,
// elle ne doit jamais être le comportement d'une commande lancée par erreur.
//
// Usage :
//   npm run nettoyer                 -> liste ce qui partirait
//   npm run nettoyer -- --appliquer  -> supprime pour de bon
//   npm run nettoyer -- --ecartees   -> ignore les verdicts, ne garde que le groupe 3
import { ouvrirBase, offresHorsProfil, supprimerOffres } from '../src/db.js';
import { fileURLToPath } from 'node:url';

const MOTIFS = {
  ecartee: { emoji: '🔴', titre: 'Classées « à écarter »' },
  verdict: { emoji: '⚖️', titre: 'Refusées par l\'analyse du contenu' },
};

/** Tronque proprement, pour que les colonnes du tableau restent alignées. */
function couper(texte, taille) {
  const t = String(texte ?? '');
  return t.length <= taille ? t.padEnd(taille) : t.slice(0, taille - 1) + '…';
}

export function principal(argv = process.argv.slice(2)) {
  const appliquer = argv.includes('--appliquer');
  const ecarteesSeules = argv.includes('--ecartees');

  const db = ouvrirBase('data.db');
  try {
    const total = db.prepare('SELECT COUNT(*) n FROM offers').get().n;
    let hors = offresHorsProfil(db);
    if (ecarteesSeules) hors = hors.filter(o => o.motif === 'ecartee');

    console.log(`\n🧹 Nettoyage — ${total} offre(s) en base`);

    if (hors.length === 0) {
      console.log('\n✅ Rien à enlever : aucune offre hors profil sans trace de suivi.\n');
      return 0;
    }

    for (const [motif, entete] of Object.entries(MOTIFS)) {
      const lot = hors.filter(o => o.motif === motif);
      if (!lot.length) continue;

      console.log(`\n${entete.emoji} ${entete.titre} — ${lot.length}`);
      for (const o of lot) {
        const score = o.score === null ? '  ·' : String(o.score).padStart(3);
        console.log(`  ${score}  ${couper(o.titre, 52)}  ${couper(o.ville, 22)}  ${o.detail}`);
      }
    }

    const restantes = total - hors.length;
    console.log(`\n  ${hors.length} offre(s) à enlever · ${restantes} conservée(s)`);
    console.log('  Épinglées, annotées, envoyées, avec lettre ou saisies à la main : jamais touchées.');

    if (!appliquer) {
      console.log('\n👉 Simulation. Pour supprimer pour de bon :');
      console.log('     npm run nettoyer -- --appliquer\n');
      return 0;
    }

    // Le motif inscrit ces offres parmi les « écartées ». Sans lui, la source
    // les republiant, elles reviendraient à la collecte suivante — c'est ce
    // qui a rendu les premiers nettoyages inutiles : 415 offres enlevées,
    // 276 revenues six heures plus tard.
    const supprimees = supprimerOffres(db, hors.map(o => o.id), 'hors-profil');
    console.log(`\n✅ ${supprimees} offre(s) écartée(s). Il en reste ${restantes}.`);
    console.log('   Elles ne reviendront pas aux prochaines collectes.');
    console.log('   Pour revenir en arrière : Options > Offres écartées > Tout remettre.\n');
    return supprimees;
  } finally {
    db.close();
  }
}

// Ne s'exécute que si le fichier est lancé directement (pas à l'import par les tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    principal();
  } catch (erreur) {
    console.error('❌ Nettoyage interrompu :', erreur.message);
    process.exitCode = 1;
  }
}
