// Petit outil de contrôle : montre ce que devient un texte après normalisation.
// Sert à écrire correctement les motifs de scoring dans profile/profile.json,
// car un motif écrit avec sa ponctuation d'origine échoue EN SILENCE.
//
// Usage : npm run normaliser -- "M&A" "droit de l'environnement"
import { normaliser } from '../src/hash.js';

const textes = process.argv.slice(2);

if (textes.length === 0) {
  console.log('Usage : npm run normaliser -- "M&A" "diplôme d\'ingénieur"');
  process.exit(1);
}

for (const texte of textes) {
  console.log(`  « ${texte} »  ->  « ${normaliser(texte)} »`);
}
