// Analyse d'un morceau : courbe d'énergie, tempo (autocorrélation des
// attaques), instant du drop (plus forte hausse d'énergie soutenue).
// Usage : node analyser.mjs <ffmpeg.exe> <morceau>
import { execFileSync } from 'node:child_process';
const [,, FFMPEG, FICHIER] = process.argv;
const SR = 22050;
const brut = execFileSync(FFMPEG, ['-v', 'error', '-i', FICHIER, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const x = new Float32Array(brut.buffer, brut.byteOffset, brut.byteLength / 4);
const duree = x.length / SR;

// Énergie par fenêtre de 10 ms
const H = Math.round(SR * 0.01);
const nb = Math.floor(x.length / H);
const rms = new Float32Array(nb);
for (let i = 0; i < nb; i++) { let s = 0; for (let j = 0; j < H; j++) { const v = x[i * H + j]; s += v * v; } rms[i] = Math.sqrt(s / H); }

// Courbe lissée par seconde (pour lire la structure)
const parSeconde = [];
for (let t = 0; t < Math.floor(duree); t++) { let s = 0; for (let i = t * 100; i < (t + 1) * 100 && i < nb; i++) s += rms[i]; parSeconde.push(s / 100); }
const max = Math.max(...parSeconde);
console.log('durée', duree.toFixed(1), 's');
console.log('énergie par seconde (0-9) :');
console.log(parSeconde.map((v, t) => (t % 10 === 0 ? `\n${String(t).padStart(3)}s ` : '') + Math.round(v / max * 9)).join(''));

// Attaques : hausse d'énergie
const onset = new Float32Array(nb);
for (let i = 1; i < nb; i++) onset[i] = Math.max(0, rms[i] - rms[i - 1]);
// Autocorrélation entre 70 et 150 BPM
let meilleur = { bpm: 0, score: -1 };
for (let bpm = 70; bpm <= 150; bpm += 0.5) {
  const lag = Math.round(60 / bpm * 100);
  let s = 0; for (let i = lag; i < nb; i++) s += onset[i] * onset[i - lag];
  // + la double période, pour préférer le tempo « ressenti »
  const lag2 = lag * 2; let s2 = 0; for (let i = lag2; i < nb; i++) s2 += onset[i] * onset[i - lag2];
  const score = s + 0.5 * s2;
  if (score > meilleur.score) meilleur = { bpm, score };
}
console.log('tempo estimé', meilleur.bpm, 'BPM — mesure', (240 / meilleur.bpm).toFixed(3), 's');

// Drop : plus grande différence entre l'énergie des 2 s qui suivent et des 2 s qui précèdent
let drop = { t: 0, gain: -1 };
for (let t = 4; t < Math.floor(duree) - 3; t++) {
  const avant = (parSeconde[t - 2] + parSeconde[t - 1]) / 2, apres = (parSeconde[t] + parSeconde[t + 1]) / 2;
  if (apres - avant > drop.gain) drop = { t, gain: apres - avant };
}
// Affinage à 10 ms autour de la seconde trouvée : la première attaque forte
let tFin = drop.t;
let pic = 0, iPic = drop.t * 100;
for (let i = Math.max(0, drop.t * 100 - 60); i < drop.t * 100 + 100 && i < nb; i++) if (onset[i] > pic) { pic = onset[i]; iPic = i; }
tFin = iPic / 100;
console.log('drop vers', tFin.toFixed(2), 's');

// Pulsation : phase du temps fort autour du drop
const lag = Math.round(60 / meilleur.bpm * 100);
let meilleurePhase = { p: 0, s: -1 };
for (let p = 0; p < lag; p++) { let s = 0; for (let i = p; i < nb; i += lag) s += onset[i]; if (s > meilleurePhase.s) meilleurePhase = { p, s }; }
console.log('phase des temps', (meilleurePhase.p / 100).toFixed(2), 's (premier temps détecté)');
