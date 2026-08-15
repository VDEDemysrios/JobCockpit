// Amorce la base au tout premier démarrage en ligne.
//
// Le volume Fly arrive vide. Sans ce script, la première visite afficherait
// un cockpit désert, et il faudrait attendre la première collecte. L'image
// embarque une copie de `data.db` : on la recopie sur le volume, une seule
// fois, si rien n'y est encore.
//
// C'est aussi le filet de sécurité si le volume est un jour perdu : le
// déploiement repart de la dernière base emportée dans l'image, plutôt que de
// zéro.
//
// Idempotent : une base déjà présente n'est JAMAIS écrasée. C'est la règle la
// plus importante ici — le suivi de candidatures ne se recollecte pas.
import { existsSync, copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINATION = process.env.DB_PATH ?? join(RACINE, 'data.db');
const AMORCE = join(RACINE, 'data.db');

// En local, source et destination sont le même fichier : il n'y a rien à faire.
if (DESTINATION === AMORCE) {
  process.exit(0);
}

if (existsSync(DESTINATION)) {
  const taille = Math.round(statSync(DESTINATION).size / 1024);
  console.log(`📦 Base déjà présente sur le volume (${taille} Ko) — amorçage ignoré.`);
  process.exit(0);
}

if (!existsSync(AMORCE)) {
  console.log('📦 Aucune base d\'amorce dans l\'image — la première collecte remplira le volume.');
  process.exit(0);
}

mkdirSync(dirname(DESTINATION), { recursive: true });
copyFileSync(AMORCE, DESTINATION);
console.log(`📦 Base amorcée depuis l'image → ${DESTINATION} (${Math.round(statSync(DESTINATION).size / 1024)} Ko)`);
