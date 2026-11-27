// Affiche la timeline du plan et les instants de coupe (pour IMPACTS).
import { readFileSync } from 'node:fs';
const w = {}; new Function('window', readFileSync(new URL('./plan.js', import.meta.url), 'utf8'))(w);
let t = 0; const coupes = [];
for (const c of w.PLAN.clips) {
  const d = c.entree?.d ?? 0; const deb = Math.max(0, t - d); t = deb + c.duree;
  if (deb > 0) coupes.push(deb + d / 2);
  console.log(c.id.padEnd(12), deb.toFixed(2), '->', t.toFixed(2));
}
console.log('TOTAL', t.toFixed(2));
console.log('COUPES', coupes.map(x => x.toFixed(2)).join(','));
