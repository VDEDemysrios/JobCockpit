// Rend le montage image par image : ouvre montage.html dans Edge sans
// interface, appelle rendre(k/30), capture, écrit frames/montage/fNNNNN.jpg.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9335, FPS = 30;
const SORTIE = join(ICI, 'frames', 'montage');
rmSync(SORTIE, { recursive: true, force: true }); mkdirSync(SORTIE, { recursive: true });

const edge = spawn(EDGE, ['--headless', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--force-device-scale-factor=1',
  '--allow-file-access-from-files', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(ICI, 'profil-rendu')}`,
  '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
const attendre = (ms) => new Promise(r => setTimeout(r, ms));
let id = 0; const enAttente = new Map(); let ws;
const envoyer = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const n = ++id; enAttente.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params, sessionId }));
});

async function principal() {
  let v;
  for (let i = 0; i < 60; i++) { try { v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); break; } catch { await attendre(200); } }
  ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const erreurs = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && enAttente.has(msg.id)) { const { res, rej } = enAttente.get(msg.id); enAttente.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else if (msg.method === 'Runtime.exceptionThrown') erreurs.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  };
  const { targetId } = await envoyer('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await envoyer('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => envoyer(method, params, sessionId);
  await s('Page.enable'); await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await s('Page.navigate', { url: pathToFileURL(join(ICI, 'montage.html')).href });
  for (let i = 0; i < 50; i++) { const r = await s('Runtime.evaluate', { expression: '!!window.pret', returnByValue: true }); if (r.result.value) break; await attendre(100); }
  await s('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => 1)', awaitPromise: true });
  const duree = (await s('Runtime.evaluate', { expression: 'window.DUREE_TOTALE', returnByValue: true })).result.value;
  const n = Math.round(duree * FPS);
  // APERCU="1.5,12,30" : ne rend que ces instants, dans frames/apercu/.
  const apercu = process.env.APERCU ? process.env.APERCU.split(',').map(Number) : null;
  const dossier = apercu ? join(ICI, 'frames', 'apercu') : SORTIE;
  if (apercu) { rmSync(dossier, { recursive: true, force: true }); mkdirSync(dossier, { recursive: true }); }
  const instants = apercu ?? Array.from({ length: n }, (_, k) => k / FPS);
  console.log(`durée ${duree.toFixed(2)} s → ${instants.length} images`);
  const t0 = Date.now();
  for (let k = 0; k < instants.length; k++) {
    const r = await s('Runtime.evaluate', { expression: `window.rendre(${instants[k].toFixed(5)})`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) { console.error('rendu :', r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); break; }
    const shot = await s('Page.captureScreenshot', { format: 'jpeg', quality: 93 });
    const nom = apercu ? `t${instants[k].toFixed(2).replace('.', '_')}.jpg` : `f${String(k).padStart(5, '0')}.jpg`;
    writeFileSync(join(dossier, nom), Buffer.from(shot.data, 'base64'));
    if (k % 150 === 0) console.log(`  ${k}/${instants.length}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  console.log(`terminé en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (erreurs.length) console.log('ERREURS :\n  ' + erreurs.join('\n  '));
  ws.close(); edge.kill();
}
principal().catch(e => { console.error(e); edge.kill(); process.exit(1); });
