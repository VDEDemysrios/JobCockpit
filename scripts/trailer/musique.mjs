// Musique du trailer, synthétisée : un WAV stéréo 44,1 kHz, 16 bits.
// Pas d'échantillon, pas de dépendance — des oscillateurs, un filtre, une
// enveloppe. Esprit : électro calme et déterminée, montée vers le radar,
// résolution finale. 104 BPM (une mesure = 2,308 s).
//
// Usage : node musique.mjs sortie.wav <secondes>
//   RISER_DEBUT / RISER_DUREE : la montée (secondes), impact à sa fin
//   IMPACTS : coups brefs aux coupes du montage, liste de secondes
import { writeFileSync } from 'node:fs';

const SR = 44100;
const BPM = 104;
const BEAT = 60 / BPM;
const MESURE = BEAT * 4;
const SECONDES = Number(process.argv[3] ?? 58);
const N = Math.floor(SR * SECONDES);
const G = new Float32Array(N), D = new Float32Array(N);

const note = (n) => 440 * 2 ** ((n - 69) / 12);
// Em – C – G – D ; puis Am – C – G – D pendant la montée.
const ACCORDS = [[52, 55, 59, 64], [48, 52, 55, 60], [55, 59, 62, 67], [50, 54, 57, 62]];
const ACCORDS_B = [[57, 60, 64, 69], [48, 52, 55, 60], [55, 59, 62, 67], [50, 54, 57, 62]];

const tRiser = Number(process.env.RISER_DEBUT ?? 24), dRiser = Number(process.env.RISER_DUREE ?? 4);
const MESURE_MONTEE_DEBUT = Math.floor(tRiser / MESURE);
const MESURE_MONTEE_FIN = MESURE_MONTEE_DEBUT + 2;
const nbMesures = Math.ceil(SECONDES / MESURE);
const estMontee = (m) => m >= MESURE_MONTEE_DEBUT && m < MESURE_MONTEE_FIN;

function env(t, a, d, s, r, dur) {
  if (t < 0) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < dur) return s;
  const x = (t - dur) / r;
  return x < 1 ? s * (1 - x) : 0;
}
function lowpass(buf, coupureHz) {
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    const fc = typeof coupureHz === 'function' ? coupureHz(i / SR) : coupureHz;
    const a = 1 - Math.exp(-2 * Math.PI * fc / SR);
    y += a * (buf[i] - y);
    buf[i] = y;
  }
}
function ajouter(cible, depart, dur, fn, gain = 1) {
  const i0 = Math.floor(depart * SR), n = Math.floor(dur * SR);
  for (let i = 0; i < n && i0 + i < N; i++) cible[i0 + i] += fn(i / SR) * gain;
}
const bruit = () => Math.random() * 2 - 1;

// 1. Nappe
const pad = new Float32Array(N);
for (let m = 0; m < nbMesures; m++) {
  const acc = (estMontee(m) ? ACCORDS_B : ACCORDS)[m % 4];
  const depart = m * MESURE;
  for (const n of acc) {
    const f = note(n - 12);
    ajouter(pad, depart, MESURE + 0.6, (t) => {
      const e = env(t, 0.5, 0.3, 0.8, 0.6, MESURE);
      const s1 = ((t * f * 1.003) % 1) * 2 - 1;
      const s2 = ((t * f * 0.997) % 1) * 2 - 1;
      return e * (0.5 * s1 + 0.5 * s2 + 0.35 * Math.sin(2 * Math.PI * f * 2 * t));
    }, 0.09);
  }
}
lowpass(pad, (t) => {
  const ouverture = Math.min(1, t / 28);
  const fin = t > SECONDES - 4 ? Math.max(0.15, (SECONDES - t) / 4) : 1;
  return (320 + 2400 * ouverture) * fin;
});
for (let i = 0; i < N; i++) { G[i] += pad[i]; D[i] += pad[i] * 0.92; }

// 2. Arpège
const arpG = new Float32Array(N), arpD = new Float32Array(N);
for (let m = 2; m < nbMesures; m++) {
  const acc = (estMontee(m) ? ACCORDS_B : ACCORDS)[m % 4];
  const dense = m >= 8;
  const pas = dense ? BEAT / 4 : BEAT / 2;
  const nbNotes = Math.round(MESURE / pas);
  for (let k = 0; k < nbNotes; k++) {
    const n = acc[(k * 2) % acc.length] + (k % 3 === 2 ? 12 : 0);
    const f = note(n + 12);
    const depart = m * MESURE + k * pas;
    const pan = 0.5 + 0.4 * Math.sin(k * 1.7);
    const son = (t) => env(t, 0.004, 0.12, 0.0, 0.08, 0.12) * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2 * t + 0.4));
    ajouter(arpG, depart, 0.3, son, 0.11 * (1 - pan));
    ajouter(arpD, depart, 0.3, son, 0.11 * pan);
  }
}
for (let i = 0; i < N; i++) { G[i] += arpG[i]; D[i] += arpD[i]; }

// 3. Basse
for (let m = 4; m < nbMesures - 1; m++) {
  const fond = (estMontee(m) ? ACCORDS_B : ACCORDS)[m % 4][0] - 24;
  const f = note(fond);
  for (let k = 0; k < 8; k++) {
    const depart = m * MESURE + k * BEAT / 2;
    const accent = k % 2 === 0 ? 1 : 0.6;
    const son = (t) => env(t, 0.005, 0.15, 0.4, 0.05, 0.22) * (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * f * 2 * t));
    ajouter(G, depart, 0.3, son, 0.22 * accent);
    ajouter(D, depart, 0.3, son, 0.22 * accent);
  }
}

// 4. Percussions
for (let m = 4; m < nbMesures - 1; m++) {
  for (let k = 0; k < 4; k++) {
    const depart = m * MESURE + k * BEAT;
    const kick = (t) => env(t, 0.002, 0.18, 0, 0.05, 0.18) * Math.sin(2 * Math.PI * (48 + 110 * Math.exp(-t * 28)) * t);
    ajouter(G, depart, 0.25, kick, 0.5); ajouter(D, depart, 0.25, kick, 0.5);
    for (const dec of [BEAT / 2, BEAT / 4 * 3]) {
      if (m < 8 && dec !== BEAT / 2) continue;
      const hat = (t) => env(t, 0.001, 0.03, 0, 0.02, 0.03) * bruit();
      ajouter(G, depart + dec, 0.06, hat, 0.07); ajouter(D, depart + dec, 0.06, hat, 0.07);
    }
    if (m >= 8 && (k === 1 || k === 3)) {
      const snare = (t) => env(t, 0.001, 0.12, 0, 0.06, 0.12) * (0.6 * bruit() + 0.4 * Math.sin(2 * Math.PI * 190 * t));
      ajouter(G, depart, 0.2, snare, 0.22); ajouter(D, depart, 0.2, snare, 0.22);
    }
  }
}

// 5. Montée et impact
const riser = (t) => { const p = t / dRiser; return env(t, 0.5, 0.1, 1, 0.3, dRiser) * p * p * bruit(); };
const rG = new Float32Array(N), rD = new Float32Array(N);
ajouter(rG, tRiser, dRiser + 0.3, riser, 0.28); ajouter(rD, tRiser, dRiser + 0.3, riser, 0.28);
lowpass(rG, (t) => 200 + 6000 * Math.max(0, Math.min(1, (t - tRiser) / dRiser)) ** 2);
lowpass(rD, (t) => 200 + 6000 * Math.max(0, Math.min(1, (t - tRiser) / dRiser)) ** 2);
for (let i = 0; i < N; i++) { G[i] += rG[i]; D[i] += rD[i]; }
const tImpact = tRiser + dRiser;
const impact = (t) => env(t, 0.003, 0.6, 0, 0.4, 0.6) * (Math.sin(2 * Math.PI * (40 + 60 * Math.exp(-t * 6)) * t) + 0.3 * bruit() * Math.exp(-t * 10));
ajouter(G, tImpact, 1.2, impact, 0.7); ajouter(D, tImpact, 1.2, impact, 0.7);

// 5 bis. Coups sur les coupes : l'image et le son changent ensemble.
for (const tc of String(process.env.IMPACTS ?? '').split(',').map(Number).filter(x => x > 0)) {
  const coup = (t) => env(t, 0.002, 0.3, 0, 0.2, 0.3) * (Math.sin(2 * Math.PI * (55 + 80 * Math.exp(-t * 9)) * t) + 0.25 * bruit() * Math.exp(-t * 14));
  ajouter(G, tc, 0.6, coup, 0.42); ajouter(D, tc, 0.6, coup, 0.42);
}

// 6. Fin : accord tenu et fondu
const tFin = SECONDES - 3.2;
for (const n of [52, 59, 64, 71]) {
  const f = note(n - 12);
  const son = (t) => env(t, 0.2, 0.5, 0.7, 2.2, 1.0) * Math.sin(2 * Math.PI * f * t) * (1 + 0.1 * Math.sin(2 * Math.PI * 5 * t));
  ajouter(G, tFin, 3.2, son, 0.12); ajouter(D, tFin, 3.2, son, 0.12);
}
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fondu = t < 1.5 ? t / 1.5 : t > SECONDES - 2.5 ? Math.max(0, (SECONDES - t) / 2.5) : 1;
  G[i] *= fondu; D[i] *= fondu;
}

// 7. Limiteur doux et écriture
function limiter(x) { return Math.tanh(x * 1.4) / Math.tanh(1.4); }
const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, limiter(G[i]))) * 32767), i * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, limiter(D[i]))) * 32767), i * 4 + 2);
}
const entete = Buffer.alloc(44);
entete.write('RIFF', 0); entete.writeUInt32LE(36 + data.length, 4); entete.write('WAVE', 8);
entete.write('fmt ', 12); entete.writeUInt32LE(16, 16); entete.writeUInt16LE(1, 20); entete.writeUInt16LE(2, 22);
entete.writeUInt32LE(SR, 24); entete.writeUInt32LE(SR * 4, 28); entete.writeUInt16LE(4, 32); entete.writeUInt16LE(16, 34);
entete.write('data', 36); entete.writeUInt32LE(data.length, 40);
writeFileSync(process.argv[2], Buffer.concat([entete, data]));
console.log('musique :', process.argv[2], SECONDES, 's');
