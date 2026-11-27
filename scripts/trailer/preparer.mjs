// Écrit donnees.js : les listes d'images et les chemins de curseur de chaque
// prise, en JS (une page file:// ne peut pas faire fetch() d'un JSON local).
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ICI = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(ICI, 'frames');
const seqs = {};
for (const d of readdirSync(FRAMES)) {
  const liste = join(FRAMES, d, 'liste.json');
  if (!existsSync(liste)) continue;
  seqs[d] = {
    base: pathToFileURL(join(FRAMES, d)).href + '/',
    liste: JSON.parse(readFileSync(liste, 'utf8')),
    pointeur: existsSync(join(FRAMES, d, 'pointeur.json')) ? JSON.parse(readFileSync(join(FRAMES, d, 'pointeur.json'), 'utf8')) : [],
    touches: existsSync(join(FRAMES, d, 'touches.json')) ? JSON.parse(readFileSync(join(FRAMES, d, 'touches.json'), 'utf8')) : [],
  };
}
writeFileSync(join(ICI, 'donnees.js'), 'window.DONNEES = ' + JSON.stringify(seqs) + ';\n');
console.log('prises :', Object.keys(seqs).join(', '));
