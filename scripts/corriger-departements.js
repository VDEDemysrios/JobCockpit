// Répare les départements faux déjà enregistrés.
//
// POURQUOI UN SCRIPT PLUTÔT QU'UNE POIGNÉE D'« UPDATE »
// -----------------------------------------------------
// Ces lignes ont été écrites par des versions antérieures de la collecte.
// Corriger le code empêche de NOUVELLES erreurs, mais ne touche pas à ce qui
// est déjà en base : sans cette passe, trois offres parisiennes resteraient
// indéfiniment classées dans les Bouches-du-Rhône. Un script se relit, se
// rejoue, et dit ce qu'il a fait — trois qualités qu'une commande tapée à la
// main dans un terminal n'a pas.
//
// DEUX FAMILLES D'ERREURS, ET AUCUNE INVENTION
// --------------------------------------------
//   1. Le numéro d'ARRONDISSEMENT lu comme un département : « 13ème
//      Arrondissement » rangé dans les Bouches-du-Rhône. On remet le champ à
//      vide : la ville n'étant pas connue, prétendre le contraire serait
//      refaire l'erreur dans l'autre sens.
//   2. Une commune dont le département CONTREDIT celui que la même commune
//      porte partout ailleurs en base. Metz apparaît huit fois : sept en 57,
//      une en 67. La majorité tranche, et seulement si elle est nette.
//
// Usage :  node scripts/corriger-departements.js [--appliquer]
// Sans `--appliquer`, le script montre ce qu'il ferait et ne touche à rien.
import { DatabaseSync } from 'node:sqlite';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

/** « 8ème Arrondissement », « 1er-Arrondissement »… un quartier, pas une ville. */
const ARRONDISSEMENT = /\b\d{1,2}\s*(?:er|ère|re|e|ème|eme)?[-\s]*arrondissements?\b/i;

const normaliserCommune = (v) => String(v ?? '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\bcedex\b.*$/, '')
  .replace(/[^a-z]+/g, ' ')
  .trim();

/**
 * Liste les corrections à faire, sans rien modifier.
 * Fonction PURE : elle reçoit les lignes et rend des décisions, ce qui la
 * rend testable sans base.
 *
 * @param {{id:string, ville:string, departement:string|null}[]} lignes
 * @returns {{id:string, ville:string, avant:string, apres:string|null, motif:string}[]}
 */
export function corrections(lignes) {
  // Département dominant par commune, pour arbitrer les contradictions.
  const parCommune = new Map();
  for (const l of lignes) {
    if (!l.departement || ARRONDISSEMENT.test(l.ville ?? '')) continue;
    const c = normaliserCommune(l.ville);
    if (!c) continue;
    if (!parCommune.has(c)) parCommune.set(c, new Map());
    const m = parCommune.get(c);
    m.set(l.departement, (m.get(l.departement) ?? 0) + 1);
  }

  const sortie = [];
  for (const l of lignes) {
    if (!l.departement) continue;

    // 1. Le département vient d'un numéro d'arrondissement.
    if (ARRONDISSEMENT.test(l.ville ?? '')) {
      // Le numéro est pris DANS le motif « 18e Arrondissement » : un simple
      // `\b(\d{1,2})\b` ne trouvait rien, parce qu'il n'y a pas de frontière
      // de mot entre « 18 » et le « e » qui le suit. Le script ne corrigeait
      // donc jamais cette famille-là, en silence.
      const numero = (l.ville.match(/(\d{1,2})\s*(?:er|ère|re|e|ème|eme)?[-\s]*arrondissement/i) ?? [])[1];
      if (numero && String(l.departement) === numero.padStart(2, '0')) {
        sortie.push({ id: l.id, ville: l.ville, avant: l.departement, apres: null,
          motif: 'numéro d\'arrondissement lu comme un département' });
      }
      continue;
    }

    // 2. La commune porte un autre département partout ailleurs.
    const votes = parCommune.get(normaliserCommune(l.ville));
    if (!votes || votes.size < 2) continue;
    const tri = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const [gagnant, voix] = tri[0];
    // Une majorité NETTE seulement : à 1 contre 1, on ne sait pas, et le
    // hasard de l'ordre de tri n'est pas un arbitre.
    if (gagnant === l.departement || voix <= tri[1][1]) continue;
    sortie.push({ id: l.id, ville: l.ville, avant: l.departement, apres: gagnant,
      motif: `${voix} autres offres à ${l.ville} portent le ${gagnant}` });
  }
  return sortie;
}

/**
 * Applique la passe de cohérence sur une base ouverte.
 *
 * Appelée à la fin de chaque collecte, et pas seulement à la main : une
 * correction ponctuelle ne tient pas. La source qui a produit le mauvais
 * département le reproduit au passage suivant, et l'offre repart dans le
 * mauvais onglet — constaté sur une offre à Metz étiquetée 67, remise à 57,
 * puis revenue à 67 dès la collecte d'après.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {number} nombre d'offres corrigées
 */
export function corrigerBase(db) {
  const aFaire = corrections(db.prepare('SELECT id, ville, departement FROM offers').all());
  if (!aFaire.length) return 0;
  const maj = db.prepare('UPDATE offers SET departement = ? WHERE id = ?');
  for (const c of aFaire) maj.run(c.apres, c.id);
  return aFaire.length;
}

export function principal(argv = process.argv.slice(2)) {
  const appliquer = argv.includes('--appliquer');
  const chemin = argv.find(a => !a.startsWith('--'))
    ?? (existsSync(join(RACINE, 'data.db'))
      ? join(RACINE, 'data.db')
      : join(RACINE, '..', 'Application', 'data.db'));

  if (!existsSync(chemin)) {
    console.error(`\n❌ Base introuvable : ${chemin}\n`);
    return 1;
  }

  const db = new DatabaseSync(chemin, { readOnly: !appliquer });
  try {
    const lignes = db.prepare('SELECT id, ville, departement FROM offers').all();
    const aFaire = corrections(lignes);

    console.log(`\n🔎 ${chemin}`);
    console.log(`   ${lignes.length} offres examinées, ${aFaire.length} à corriger\n`);
    for (const c of aFaire) {
      const apres = c.apres ?? '(vide)';
      console.log(`   ${c.ville} : ${c.avant} → ${apres}`);
      console.log(`      ${c.motif}`);
    }

    if (!aFaire.length) { console.log('   Rien à faire.\n'); return 0; }

    if (!appliquer) {
      console.log('\n   Rien n\'a été modifié. Pour appliquer :');
      console.log('     node scripts/corriger-departements.js --appliquer\n');
      return 0;
    }

    const maj = db.prepare('UPDATE offers SET departement = ? WHERE id = ?');
    for (const c of aFaire) maj.run(c.apres, c.id);
    console.log(`\n✅ ${aFaire.length} offre(s) corrigée(s).\n`);
    return 0;
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = principal();
}
