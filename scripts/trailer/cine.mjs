// Caméra : Edge sans interface piloté par CDP, qui ENREGISTRE l'écran
// (Page.startScreencast) en 1920×1080. Chaque séquence devient un dossier de
// JPEG horodatés + liste.json ; le montage (monter.mjs) les rééchantillonne
// à 30 i/s. Usage : node cine.mjs scenario.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9334;
const PROFIL = join(ICI, 'profil-cine');
const FRAMES = join(ICI, 'frames');
const W = 1920, H = 1080;

const edge = spawn(EDGE, [
  '--headless', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--force-device-scale-factor=1', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFIL}`, `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });

const attendre = (ms) => new Promise(r => setTimeout(r, ms));
async function versionNavigateur() {
  for (let i = 0; i < 60; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await attendre(200); }
  }
  throw new Error('Edge ne répond pas');
}

let id = 0; const enAttente = new Map(); const ecouteurs = []; let ws;
function envoyer(method, params = {}, sessionId) {
  const n = ++id;
  return new Promise((res, rej) => { enAttente.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params, sessionId })); });
}

async function principal() {
  const v = await versionNavigateur();
  ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && enAttente.has(msg.id)) {
      const { res, rej } = enAttente.get(msg.id); enAttente.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) for (const e of ecouteurs) e(msg);
  };
  const { targetId } = await envoyer('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await envoyer('Target.attachToTarget', { targetId, flatten: true });
  const s = (method, params) => envoyer(method, params, sessionId);
  await s('Page.enable'); await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await s('Emulation.setFocusEmulationEnabled', { enabled: true });

  const consoleJournal = [];
  ecouteurs.push((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') consoleJournal.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleJournal.push(msg.params.args.map(a => a.value ?? a.description).join(' '));
  });

  // ── l'enregistreur ──
  let enCours = null;   // { nom, dossier, frames: [], debut }
  const ecrivains = [];
  ecouteurs.push((msg) => {
    if (msg.sessionId !== sessionId || msg.method !== 'Page.screencastFrame') return;
    const { data, metadata, sessionId: sid } = msg.params;
    s('Page.screencastFrameAck', { sessionId: sid }).catch(() => {});
    if (!enCours) return;
    const i = enCours.frames.length;
    const fichier = `f${String(i).padStart(5, '0')}.jpg`;
    enCours.frames.push({ fichier, t: metadata.timestamp });
    const chemin = join(enCours.dossier, fichier);
    const buf = Buffer.from(data, 'base64');
    ecrivains.push(new Promise(r => { writeFileSync(chemin, buf); r(); }));
  });

  const p = {
    console: consoleJournal,
    async goto(url, delai = 1000) {
      const charge = new Promise(r => {
        const e = (msg) => { if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') { ecouteurs.splice(ecouteurs.indexOf(e), 1); r(); } };
        ecouteurs.push(e);
      });
      await s('Page.navigate', { url });
      await Promise.race([charge, attendre(8000)]);
      await attendre(delai);
    },
    async eval(expression) {
      const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('eval : ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
      return r.result.value;
    },
    async rect(sel) {
      return p.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
    },
    async mouse(type, x, y, extra = {}) {
      // Le chemin du curseur est consigné avec la même horloge que les images
      // (secondes depuis l'époque) : le montage pourra le redessiner.
      if (enCours) enCours.pointeur.push({ t: Date.now() / 1000, x, y, type });
      await s('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
    },
    /** Déplace le pointeur en douceur (courbe en S), pour que ça se voie. */
    async glisserVers(x1, y1, x0, y0, dur = 600, boutons = 0) {
      const pas = Math.max(8, Math.round(dur / 16));
      for (let i = 1; i <= pas; i++) {
        const u = i / pas, e = u < .5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2;
        await p.mouse('mouseMoved', x0 + (x1 - x0) * e, y0 + (y1 - y0) * e, { buttons: boutons });
        await attendre(16);
      }
    },
    souris: { x: W / 2, y: H / 2 },
    async bouger(sel, dur = 600) {
      const r = await p.rect(sel); if (!r) throw new Error('introuvable : ' + sel);
      await p.glisserVers(r.x, r.y, p.souris.x, p.souris.y, dur);
      p.souris = { x: r.x, y: r.y };
    },
    async click(sel, delai = 400, dur = 500) {
      await p.bouger(sel, dur);
      await p.mouse('mousePressed', p.souris.x, p.souris.y);
      await attendre(60);
      await p.mouse('mouseReleased', p.souris.x, p.souris.y);
      await attendre(delai);
    },
    async drag(deSel, versSel, dur = 1100) {
      await p.bouger(deSel, 500);
      await p.mouse('mousePressed', p.souris.x, p.souris.y);
      await attendre(120);
      const b = await p.rect(versSel);
      await p.glisserVers(b.x, b.y, p.souris.x, p.souris.y, dur, 1);
      p.souris = { x: b.x, y: b.y };
    },
    async drop(delai = 600) { await p.mouse('mouseReleased', p.souris.x, p.souris.y); await attendre(delai); },
    async type(texte, cadence = 70) {
      for (const c of texte) {
        await s('Input.dispatchKeyEvent', { type: 'keyDown', text: c, key: c });
        await s('Input.dispatchKeyEvent', { type: 'keyUp', key: c });
        await attendre(cadence + Math.random() * 40);
      }
    },
    async key(key, delai = 300, modifiers = 0) {
      const codes = { Escape: 27, Enter: 13, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, ' ': 32, Tab: 9 };
      const code = codes[key] ?? key.toUpperCase().charCodeAt(0);
      const base = { key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers };
      if (enCours) enCours.touches.push({ t: Date.now() / 1000, key, modifiers });
      await s('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: key.length === 1 && !modifiers ? key : undefined });
      await s('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await attendre(delai);
    },
    async enregistrer(nom) {
      const dossier = join(FRAMES, nom);
      rmSync(dossier, { recursive: true, force: true }); mkdirSync(dossier, { recursive: true });
      enCours = { nom, dossier, frames: [], pointeur: [], touches: [] };
      await s('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
      // Un premier repaint pour amorcer.
      await p.eval(`document.documentElement.style.setProperty('--amorce', Math.random()); 1`);
    },
    async couper() {
      if (!enCours) return;
      // Force une dernière image : l'écran figé n'émet rien.
      await p.eval(`document.body.style.setProperty('--fin', Math.random()); 1`);
      await attendre(120);
      await s('Page.stopScreencast');
      await Promise.all(ecrivains); ecrivains.length = 0;
      const t0 = enCours.frames[0]?.t ?? 0;
      const liste = enCours.frames.map(f => ({ fichier: f.fichier, t: f.t - t0 }));
      writeFileSync(join(enCours.dossier, 'liste.json'), JSON.stringify(liste));
      writeFileSync(join(enCours.dossier, 'pointeur.json'),
        JSON.stringify(enCours.pointeur.map(e => ({ ...e, t: e.t - t0 }))));
      writeFileSync(join(enCours.dossier, 'touches.json'),
        JSON.stringify(enCours.touches.map(e => ({ ...e, t: e.t - t0 }))));
      console.log(`séquence ${enCours.nom} : ${liste.length} images, ${(liste.at(-1)?.t ?? 0).toFixed(1)} s`);
      enCours = null;
    },
    wait: attendre,
  };

  const scenario = (await import(pathToFileURL(resolve(process.argv[2])).href)).default;
  try { await scenario(p); } catch (e) { console.error('SCÉNARIO EN ÉCHEC :', e.stack); }
  await p.couper();
  if (consoleJournal.length) console.log('CONSOLE :\n  ' + consoleJournal.join('\n  '));
  ws.close(); edge.kill();
}
principal().catch(e => { console.error(e); edge.kill(); process.exit(1); });
