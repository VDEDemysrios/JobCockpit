// Le moteur de montage : `window.rendre(t)` dessine l'état exact du film à
// l'instant t (secondes), de façon déterministe. Le rendu (rendu.mjs) appelle
// rendre(k/30) puis capture l'écran, image par image.
(() => {
  const W = 1920, H = 1080;
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const dom = document.getElementById('dom');

  // ───────── courbes ─────────
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, u) => a + (b - a) * u;
  const easeOut = (u) => 1 - Math.pow(1 - clamp(u), 3);
  const easeInOut = (u) => { u = clamp(u); return u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
  const easeOutExpo = (u) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(u)));

  // ───────── timeline ─────────
  // Chaque clip commence à la fin du précédent, moins le chevauchement de sa
  // transition d'entrée.
  const clips = PLAN.clips.map(c => ({ ...c }));
  let t = 0;
  for (const c of clips) {
    const chev = c.entree?.d ?? 0;
    c.debutGlobal = Math.max(0, t - chev);
    c.finGlobal = c.debutGlobal + c.duree;
    t = c.finGlobal;
  }
  window.DUREE_TOTALE = t;

  // ───────── images ─────────
  const cache = new Map();
  async function image(url) {
    if (cache.has(url)) return cache.get(url);
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {});
    cache.set(url, img);
    if (cache.size > 80) { const k = cache.keys().next().value; cache.delete(k); }
    return img;
  }
  function imageDe(seq, tSeq) {
    const d = DONNEES[seq];
    const liste = d.liste;
    let lo = 0, hi = liste.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (liste[mid].t <= tSeq) lo = mid; else hi = mid - 1; }
    return d.base + liste[lo].fichier;
  }

  // ───────── curseur ─────────
  function pointeurA(seq, tSeq) {
    const ev = DONNEES[seq].pointeur;
    if (!ev.length) return null;
    let i = 0;
    while (i + 1 < ev.length && ev[i + 1].t <= tSeq) i++;
    if (ev[i].t > tSeq) return null;
    const a = ev[i], b = ev[i + 1];
    let x = a.x, y = a.y;
    if (b && b.t > a.t && b.type === 'mouseMoved') {
      const u = clamp((tSeq - a.t) / (b.t - a.t));
      x = lerp(a.x, b.x, u); y = lerp(a.y, b.y, u);
    }
    let presse = false, depuisClic = Infinity, depuisRelache = Infinity;
    for (let k = 0; k <= i; k++) {
      if (ev[k].type === 'mousePressed') { presse = true; depuisClic = tSeq - ev[k].t; }
      if (ev[k].type === 'mouseReleased') { presse = false; depuisRelache = tSeq - ev[k].t; }
    }
    return { x, y, presse, depuisClic, depuisRelache };
  }
  function dessinerCurseur(p, cam) {
    const [sx, sy] = projeter(p.x, p.y, cam);
    const r = p.presse ? 15 : 19;
    ctx.save();
    // ondes de clic
    for (const [d, teinte] of [[p.depuisClic, '240,160,32'], [p.depuisRelache, '56,189,248']]) {
      if (d >= 0 && d < .6) {
        const u = d / .6;
        ctx.beginPath(); ctx.arc(sx, sy, 18 + 70 * easeOut(u), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${teinte},${(1 - u) * .9})`; ctx.lineWidth = 4 * (1 - u) + 1; ctx.stroke();
      }
    }
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = p.presse ? 'rgba(240,160,32,.92)' : 'rgba(255,255,255,.88)'; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,11,16,.75)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(8,11,16,.8)'; ctx.fill();
    ctx.restore();
  }

  // ───────── caméra ─────────
  function cameraA(clip, tLocal, tSeq) {
    const kfs = clip.camera ?? [{ t: 0, s: 1, x: W / 2, y: H / 2 }];
    let cam;
    if (kfs.length === 1) cam = { ...kfs[0] };
    else {
      let i = 0;
      while (i + 1 < kfs.length - 1 && kfs[i + 1].t <= tLocal) i++;
      const a = kfs[i], b = kfs[i + 1];
      const u = b.t > a.t ? easeInOut((tLocal - a.t) / (b.t - a.t)) : 1;
      cam = { s: lerp(a.s, b.s, u), x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) };
    }
    // Suivi du curseur : la caméra vise le pointeur, avec un retard doux.
    if (clip.suivre === 'curseur') {
      const p = pointeurA(clip.seq, tSeq);
      if (p) {
        const prec = pointeurA(clip.seq, Math.max(0, tSeq - .35)) ?? p;
        cam.x = lerp(prec.x, p.x, .6) + (clip.decalage?.x ?? 0);
        cam.y = lerp(prec.y, p.y, .6) + (clip.decalage?.y ?? 0);
      }
    }
    // Ne jamais montrer hors du cadre : on borne le centre.
    const demiW = W / 2 / cam.s, demiH = H / 2 / cam.s;
    cam.x = clamp(cam.x, demiW, W - demiW); cam.y = clamp(cam.y, demiH, H - demiH);
    return cam;
  }
  const projeter = (x, y, cam) => [W / 2 + (x - cam.x) * cam.s, H / 2 + (y - cam.y) * cam.s];

  // ───────── dessin d'un clip de prise ─────────
  async function dessinerPrise(clip, tLocal, alpha, zoomExtra = 1) {
    const tSeq = clip.debut + tLocal * (clip.vitesse ?? 1);
    const url = imageDe(clip.seq, tSeq);
    const img = await image(url);
    const cam = cameraA(clip, tLocal, tSeq);
    const s = cam.s * zoomExtra;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.setTransform(s, 0, 0, s, W / 2 - cam.x * s, H / 2 - cam.y * s);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, W, H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (clip.curseur !== false) {
      const p = pointeurA(clip.seq, tSeq);
      if (p && p.x < 1800) dessinerCurseur(p, { ...cam, s });
    }
    ctx.restore();
    return { ...cam, s };
  }

  // ───────── légendes (DOM) ─────────
  function poserLegendes(clip, tLocal, cam, alphaClip) {
    for (const l of clip.legendes ?? []) {
      const duree = (l.t1 ?? clip.duree) - l.t0;
      const uIn = easeOut((tLocal - l.t0) / .38);
      const uOut = 1 - easeOut((tLocal - (l.t0 + duree - .3)) / .3);
      const a = clamp(Math.min(uIn, uOut)) * alphaClip;
      if (a <= 0) continue;
      const [sx, sy] = l.ecran ? [l.x, l.y] : projeter(l.x, l.y, cam);
      const el = document.createElement('div');
      el.className = 'legende' + (l.touche ? ' touche' : '');
      el.innerHTML = l.touche ? l.texte.split(' ').map(k => `<kbd>${k}</kbd>`).join('') : `<i></i>${l.texte}`;
      const dx = l.ancre === 'droite' ? -1 : 0;
      el.style.left = sx + 'px'; el.style.top = sy + 'px';
      el.style.opacity = a;
      el.style.transform = `translate(${dx * 100}%, -50%) translateY(${(1 - uIn) * 14}px) scale(${lerp(.96, 1, uIn)})`;
      dom.appendChild(el);
    }
  }

  // ───────── cartons (DOM, pilotés par t) ─────────
  function carton(clip, tLocal, alpha) {
    const el = document.createElement('div');
    el.className = 'carton';
    const fin = clip.duree;
    const aOut = 1 - easeOut((tLocal - (fin - .45)) / .45);
    el.style.opacity = clamp(alpha * Math.min(1, aOut));
    const derive = tLocal * 6;
    const mots = (texte, retard, pas = .09) => texte.split(' ').map((m, i) => {
      const u = easeOut((tLocal - retard - i * pas) / .7);
      return `<span class="mot" style="opacity:${u};transform:translateY(${(1 - u) * 44}px) rotate(${(1 - u) * 2}deg);filter:blur(${(1 - u) * 8}px)">${m}</span>`;
    }).join(' ');
    const ondes = [0, .5, 1].map(r => {
      const u = clamp((tLocal - r * .45) / 3.2);
      return `<div class="onde" style="transform:translate(-50%,-50%) scale(${lerp(.55, 1.5, u)});opacity:${(1 - u) * .9 * easeOut(u * 6)}"></div>`;
    }).join('');
    const monte = (retard, d = .7) => { const u = easeOut((tLocal - retard) / d); return `opacity:${u};transform:translateY(${(1 - u) * 20}px)`; };
    let corps;
    if (clip.carton.type === 'fin') {
      const pts = clip.carton.points ?? [];
      corps = `<div class="logo" style="${monte(.15)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/></svg><b>Job Cockpit</b></div>
        <h1>${mots(clip.carton.titre, .45)}</h1>
        ${clip.carton.sous ? `<div class="sous" style="${monte(1.1)}">${clip.carton.sous}</div>` : ''}
        <div class="points">${pts.map((p, i) => `<span style="${monte(1.5 + i * .2)}">${p}</span>`).join('')}</div>`;
    } else {
      const uTrait = easeOut((tLocal - .8) / 1.1);
      corps = `${clip.carton.sur ? `<div class="sur" style="${monte(.1)}">${clip.carton.sur}</div>` : ''}
        <h1>${mots(clip.carton.titre, .3)}</h1>
        ${clip.carton.sous ? `<div class="sous" style="${monte(1.0)}">${clip.carton.sous}</div>` : ''}
        <div class="trait" style="width:${uTrait * 380}px"></div>`;
    }
    el.innerHTML = `<div class="nappe" style="transform:translate(${Math.sin(tLocal * .4) * 30}px,${Math.cos(tLocal * .3) * 20}px) scale(${1 + tLocal * .01})"></div>
      <div class="grille" style="background-position:${derive}px ${derive}px"></div>${ondes}<div class="texte">${corps}</div>`;
    dom.appendChild(el);
  }

  // ───────── chiffres ─────────
  const formater = (n) => Math.round(n).toLocaleString('fr-FR').replace(/ /g, ' ');
  function chiffres(clip, tLocal, alpha) {
    const el = document.createElement('div');
    el.className = 'chiffres';
    const aOut = 1 - easeOut((tLocal - (clip.duree - .4)) / .4);
    el.style.opacity = clamp(alpha * Math.min(1, aOut));
    el.innerHTML = `<div class="nappe" style="filter:blur(50px);background:radial-gradient(circle at 30% 40%,rgba(240,160,32,.14),transparent 45%),radial-gradient(circle at 70% 60%,rgba(56,189,248,.12),transparent 45%)"></div>
      <div class="grille" style="background-image:linear-gradient(rgba(56,189,248,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(56,189,248,.07) 1px,transparent 1px);background-size:64px 64px;-webkit-mask:radial-gradient(ellipse at center,#000 25%,transparent 72%);mask:radial-gradient(ellipse at center,#000 25%,transparent 72%)"></div>` +
      clip.chiffres.map((c, i) => {
        const retard = .15 + i * .55;
        const u = easeOutExpo((tLocal - retard) / 1.4);
        const uIn = easeOut((tLocal - retard) / .5);
        const v = c.valeur * u;
        return `<div class="chiffre" style="opacity:${uIn};transform:translateY(${(1 - uIn) * 30}px) scale(${lerp(.9, 1, uIn)})">
          <b class="${c.accent ? 'accent' : ''}">${formater(v)}</b><span>${c.libelle}</span></div>`;
      }).join('');
    dom.appendChild(el);
  }

  // ───────── rendu d'un clip à alpha donné ─────────
  async function dessinerClip(clip, tGlobal, alpha) {
    const tLocal = tGlobal - clip.debutGlobal;
    if (clip.type === 'carton') { carton(clip, tLocal, alpha); return; }
    if (clip.type === 'chiffres') { chiffres(clip, tLocal, alpha); return; }
    // Transition « zoom » : le clip entrant arrive légèrement plus grand.
    let zoomExtra = 1;
    if (clip.entree?.type === 'zoom') {
      const u = easeOut(tLocal / clip.entree.d);
      zoomExtra = lerp(1.08, 1, u);
    }
    const cam = await dessinerPrise(clip, tLocal, alpha, zoomExtra);
    poserLegendes(clip, tLocal, cam, alpha);
  }

  window.rendre = async function (tGlobal) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#080b10'; ctx.fillRect(0, 0, W, H);
    dom.innerHTML = '';
    const actifs = clips.filter(c => tGlobal >= c.debutGlobal && tGlobal < c.finGlobal);
    if (!actifs.length) return true;
    // Le plus ancien dessous, le plus récent dessus avec son fondu d'entrée.
    actifs.sort((a, b) => a.debutGlobal - b.debutGlobal);
    for (let i = 0; i < actifs.length; i++) {
      const c = actifs[i];
      let alpha = 1;
      if (i > 0 || (c.entree?.d && c.debutGlobal > 0)) {
        const d = c.entree?.d ?? 0;
        alpha = d > 0 ? easeInOut((tGlobal - c.debutGlobal) / d) : 1;
      }
      await dessinerClip(c, tGlobal, alpha);
    }
    return true;
  };
  window.pret = true;
})();
