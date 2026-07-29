// Graphiques SVG, écrits à la main.
//
// POURQUOI PAS UNE BIBLIOTHÈQUE
// -----------------------------
// Chart.js pèse 200 ko, impose ses polices, ses couleurs et ses info-bulles,
// et ne sait pas suivre trois thèmes déclarés en variables CSS. Ici chaque
// tracé est un `<svg>` qui hérite de `currentColor` et des variables du thème :
// changer de thème redessine tout, sans une ligne de JavaScript.
//
// Toutes les fonctions renvoient une CHAÎNE de balisage. Elles ne touchent
// jamais au DOM : l'appelant décide où poser le résultat, ce qui les rend
// testables et réutilisables dans n'importe quelle vue.

import { echapper } from './format.js';

/** Arrondi court : un SVG lisible pèse moins lourd et se relit. */
const r = (v) => Math.round(v * 100) / 100;

/** Identifiant unique par graphique — deux dégradés ne doivent pas se marcher dessus. */
let compteur = 0;
const uid = (prefixe) => `${prefixe}-${++compteur}`;

/**
 * Courbe en aire, avec dégradé, grille et points survolables.
 *
 * @param {{etiquette: string, valeur: number}[]} points
 * @param {object} [options] { hauteur, couleur, couleur2, lisser, unite, graduations }
 */
export function aire(points, options = {}) {
  const {
    hauteur = 180, largeur = 1000, couleur = 'var(--accent)', couleur2 = 'var(--accent2)',
    unite = '', graduations = 4, remplir = true,
  } = options;

  if (!points.length) return vide('Pas encore de données');

  const max = Math.max(1, ...points.map(p => p.valeur));
  const padH = 26, padB = 22, padG = 34, padD = 8;
  const l = largeur - padG - padD;
  const h = hauteur - padH - padB;

  const x = (i) => padG + (points.length === 1 ? l / 2 : i * l / (points.length - 1));
  const y = (v) => padH + h - (v / max) * h;

  // Courbe lissée par des Bézier cubiques : une ligne brisée sur 90 points
  // donne un effet « sismographe » qui masque la tendance.
  let chemin = `M ${r(x(0))} ${r(y(points[0].valeur))}`;
  for (let i = 1; i < points.length; i++) {
    const x0 = x(i - 1), y0 = y(points[i - 1].valeur);
    const x1 = x(i), y1 = y(points[i].valeur);
    const mx = (x0 + x1) / 2;
    chemin += ` C ${r(mx)} ${r(y0)}, ${r(mx)} ${r(y1)}, ${r(x1)} ${r(y1)}`;
  }

  const idDegrade = uid('aire');
  // La surface pousse depuis la ligne de base pendant que le tracé se dessine.
  const surface = remplir
    ? `<path class="surface" d="${chemin} L ${r(x(points.length - 1))} ${r(padH + h)} L ${r(x(0))} ${r(padH + h)} Z"
         fill="url(#${idDegrade})"/>`
    : '';

  const lignes = Array.from({ length: graduations + 1 }, (_, i) => {
    const valeur = max * (1 - i / graduations);
    const py = padH + (i / graduations) * h;
    return `<line x1="${padG}" y1="${r(py)}" x2="${largeur - padD}" y2="${r(py)}"
              stroke="var(--line)" stroke-width="1" stroke-dasharray="${i === graduations ? '0' : '3 4'}"/>
            <text x="${padG - 7}" y="${r(py + 3.5)}" text-anchor="end" class="ax">${Math.round(valeur)}</text>`;
  }).join('');

  const reperes = points.map((p, i) => `
    <g class="pt" style="animation-delay:${600 + i * 8}ms">
      <circle cx="${r(x(i))}" cy="${r(y(p.valeur))}" r="9" fill="transparent"/>
      <circle cx="${r(x(i))}" cy="${r(y(p.valeur))}" r="3" class="dot" fill="${couleur}"/>
      <title>${echapper(p.etiquette)} — ${p.valeur}${unite}</title>
    </g>`).join('');

  // Une étiquette sur cinq au maximum, sinon l'axe devient illisible.
  const pas = Math.max(1, Math.ceil(points.length / 6));
  const axeX = points.map((p, i) => (i % pas === 0 || i === points.length - 1)
    ? `<text x="${r(x(i))}" y="${hauteur - 5}" text-anchor="middle" class="ax">${echapper(p.court ?? p.etiquette)}</text>`
    : '').join('');

  // Une lueur parcourt la courbe une fois qu'elle est tracée, puis s'éteint.
  // `offset-path` fait suivre exactement le même chemin que le trait.
  // `color` est posé explicitement : le halo de la lueur s'appuie dessus
  // (drop-shadow ne sait pas lire `fill`).
  const comete = `<circle class="comete" r="4" fill="${couleur}"
      style="offset-path:path('${chemin}');color:${couleur}"/>`;

  return `<svg class="gr" viewBox="0 0 ${largeur} ${hauteur}" preserveAspectRatio="none" role="img">
    <defs><linearGradient id="${idDegrade}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${couleur}" stop-opacity=".34"/>
      <stop offset="100%" stop-color="${couleur2}" stop-opacity="0"/>
    </linearGradient></defs>
    ${lignes}${surface}
    <path d="${chemin}" fill="none" stroke="${couleur}" stroke-width="2.25"
          stroke-linecap="round" stroke-linejoin="round" class="trace"/>
    ${comete}${reperes}${axeX}
  </svg>`;
}

/**
 * Histogramme vertical. Les barres poussent depuis le bas à l'affichage.
 * @param {{etiquette: string, valeur: number, couleur?: string}[]} donnees
 */
export function barres(donnees, options = {}) {
  const { hauteur = 150, couleur = 'var(--accent)', unite = '', etiquettes = true } = options;
  if (!donnees.length) return vide('Pas encore de données');

  const max = Math.max(1, ...donnees.map(d => d.valeur));

  return `<div class="gr-barres" style="--h:${hauteur}px">
    ${donnees.map((d, i) => `
      <div class="gb" title="${echapper(d.etiquette)} — ${d.valeur}${unite}">
        <span class="gb-v">${d.valeur || ''}</span>
        <span class="gb-t" style="height:${Math.max(2, d.valeur / max * 100)}%;
              background:${d.couleur ?? couleur};animation-delay:${i * 24}ms"></span>
        ${etiquettes ? `<span class="gb-l">${echapper(d.court ?? d.etiquette)}</span>` : ''}
      </div>`).join('')}
  </div>`;
}

/**
 * Barres horizontales classées — le format le plus lisible pour comparer
 * des catégories nommées (villes, entreprises, sources).
 */
export function barresH(donnees, options = {}) {
  const { couleur = 'var(--accent2)', unite = '', max: maxImpose } = options;
  if (!donnees.length) return vide('Pas encore de données');

  const max = Math.max(1, maxImpose ?? 0, ...donnees.map(d => d.valeur));

  return `<div class="gr-barresh">
    ${donnees.map((d, i) => `
      <div class="gbh" title="${echapper(d.etiquette)} — ${d.valeur}${unite}">
        <span class="gbh-l">${echapper(d.etiquette)}</span>
        <span class="gbh-t">
          <span class="gbh-f" style="width:${d.valeur / max * 100}%;
                background:${d.couleur ?? couleur};animation-delay:${i * 35}ms"></span>
          ${d.secondaire !== undefined ? `<span class="gbh-s" style="width:${d.secondaire / max * 100}%"></span>` : ''}
        </span>
        <span class="gbh-v">${d.valeur}</span>
      </div>`).join('')}
  </div>`;
}

/**
 * Anneau de progression, avec valeur au centre.
 * Le tracé part de midi et tourne dans le sens horaire.
 */
export function anneau(pourcentage, options = {}) {
  const {
    taille = 132, epaisseur = 11, couleur = 'var(--accent)', couleur2 = 'var(--accent2)',
    valeur = `${Math.round(pourcentage)}%`, libelle = '', atteint = false,
  } = options;

  const rayon = (taille - epaisseur) / 2;
  const circonference = 2 * Math.PI * rayon;
  const offset = circonference * (1 - Math.max(0, Math.min(100, pourcentage)) / 100);
  const id = uid('anneau');

  // La valeur centrale roule si c'est un nombre ; sinon elle est posée telle quelle.
  const nombre = String(valeur).match(/^(-?\d+)(.*)$/);
  const centre = nombre
    ? `<b data-roule="${nombre[1]}" data-suffixe="${echapper(nombre[2])}">${echapper(String(valeur))}</b>`
    : `<b>${echapper(String(valeur))}</b>`;

  return `<div class="gr-anneau${atteint ? ' atteint' : ''}" style="width:${taille}px;height:${taille}px">
    <svg viewBox="0 0 ${taille} ${taille}">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${couleur}"/><stop offset="100%" stop-color="${couleur2}"/>
      </linearGradient></defs>
      <circle cx="${taille / 2}" cy="${taille / 2}" r="${rayon}" fill="none"
              stroke="var(--line)" stroke-width="${epaisseur}"/>
      <circle cx="${taille / 2}" cy="${taille / 2}" r="${rayon}" fill="none"
              stroke="url(#${id})" stroke-width="${epaisseur}" stroke-linecap="round"
              stroke-dasharray="${r(circonference)}" stroke-dashoffset="${r(offset)}"
              style="--vide:${r(circonference)}"
              transform="rotate(-90 ${taille / 2} ${taille / 2})" class="arc"/>
    </svg>
    <div class="gr-anneau-mid">${centre}${libelle ? `<span>${echapper(libelle)}</span>` : ''}</div>
  </div>`;
}

/**
 * Jauge en demi-cercle — pour une valeur qui a un plancher et un plafond
 * naturels (un taux, un score sur 20).
 */
export function jauge(pourcentage, options = {}) {
  const { largeur = 190, couleur = 'var(--accent)', valeur, libelle = '' } = options;
  const hauteur = largeur * 0.58;
  const rayon = largeur / 2 - 14;
  const cx = largeur / 2, cy = hauteur - 6;
  const pct = Math.max(0, Math.min(100, pourcentage));

  const angle = Math.PI * (1 - pct / 100);
  const px = cx + rayon * Math.cos(angle);
  const py = cy - rayon * Math.sin(angle);
  const id = uid('jauge');

  return `<div class="gr-jauge" style="width:${largeur}px">
    <svg viewBox="0 0 ${largeur} ${hauteur}">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="var(--g3)"/><stop offset="52%" stop-color="var(--g2)"/>
        <stop offset="100%" stop-color="var(--g1)"/>
      </linearGradient></defs>
      <path d="M ${cx - rayon} ${cy} A ${rayon} ${rayon} 0 0 1 ${cx + rayon} ${cy}"
            fill="none" stroke="var(--line)" stroke-width="13" stroke-linecap="round"/>
      <path d="M ${cx - rayon} ${cy} A ${rayon} ${rayon} 0 0 1 ${cx + rayon} ${cy}"
            fill="none" stroke="url(#${id})" stroke-width="13" stroke-linecap="round"
            stroke-dasharray="${r(Math.PI * rayon)}"
            stroke-dashoffset="${r(Math.PI * rayon * (1 - pct / 100))}"
            style="--vide:${r(Math.PI * rayon)}" class="arc"/>
      <circle cx="${r(px)}" cy="${r(py)}" r="6" fill="var(--panel)" stroke="${couleur}" stroke-width="3"/>
    </svg>
    <div class="gr-jauge-mid">
      <b data-roule="${Math.round(pct)}" data-suffixe="%">${valeur ?? Math.round(pct) + '%'}</b>
      ${libelle ? `<span>${echapper(libelle)}</span>` : ''}</div>
  </div>`;
}

/**
 * Anneau sectorisé (donut). Chaque part porte son info-bulle.
 * @param {{etiquette: string, valeur: number, couleur: string}[]} parts
 */
export function donut(parts, options = {}) {
  const { taille = 168, epaisseur = 26, centre = '', sousCentre = '' } = options;
  const utiles = parts.filter(p => p.valeur > 0);
  if (!utiles.length) return vide('Pas encore de données');

  const total = utiles.reduce((t, p) => t + p.valeur, 0);
  const rayon = (taille - epaisseur) / 2;
  const circonference = 2 * Math.PI * rayon;

  let parcouru = 0;
  const arcs = utiles.map((p, i) => {
    const part = p.valeur / total;
    // Le retrait de 2 px sépare visuellement deux secteurs voisins ; sur une
    // part minuscule il donnerait une longueur négative, que le navigateur
    // ignore en dessinant l'anneau entier.
    const longueur = Math.max(0.5, part * circonference - 2);
    // Chaque secteur se déroule depuis une longueur nulle : `--plein` porte sa
    // longueur d'arrivée, l'image-clé part de zéro.
    const arc = `<circle cx="${taille / 2}" cy="${taille / 2}" r="${rayon}" fill="none"
        stroke="${p.couleur}" stroke-width="${epaisseur}"
        stroke-dasharray="${r(longueur)} ${r(circonference)}"
        stroke-dashoffset="${r(-parcouru * circonference)}"
        transform="rotate(-90 ${taille / 2} ${taille / 2})" class="part"
        style="--plein:${r(longueur)};--tour:${r(circonference)};animation-delay:${i * 110}ms">
        <title>${echapper(p.etiquette)} — ${p.valeur} (${Math.round(part * 100)} %)</title></circle>`;
    parcouru += part;
    return arc;
  }).join('');

  return `<div class="gr-donut-wrap">
    <div class="gr-donut" style="width:${taille}px;height:${taille}px">
      <svg viewBox="0 0 ${taille} ${taille}">${arcs}</svg>
      <div class="gr-donut-mid"><b>${echapper(String(centre || total))}</b>
        ${sousCentre ? `<span>${echapper(sousCentre)}</span>` : ''}</div>
    </div>
    <ul class="gr-legende">
      ${utiles.map(p => `<li><i style="background:${p.couleur}"></i>
        <span>${echapper(p.etiquette)}</span><b>${p.valeur}</b></li>`).join('')}
    </ul>
  </div>`;
}

/**
 * Radar — profil d'adéquation sur plusieurs axes.
 * @param {{axe: string, valeur: number}[]} axes  valeur de 0 à 100
 */
export function radar(axes, options = {}) {
  const { taille = 300, couleur = 'var(--accent)' } = options;
  if (axes.length < 3) return vide('Pas assez d\'axes');

  const cx = taille / 2, cy = taille / 2, rayon = taille / 2 - 52;
  const point = (i, ratio) => {
    const a = (Math.PI * 2 * i / axes.length) - Math.PI / 2;
    return [cx + rayon * ratio * Math.cos(a), cy + rayon * ratio * Math.sin(a)];
  };

  const toiles = [0.25, 0.5, 0.75, 1].map(niveau => {
    const pts = axes.map((_, i) => point(i, niveau).map(r).join(',')).join(' ');
    return `<polygon points="${pts}" fill="none" stroke="var(--line)" stroke-width="1"/>`;
  }).join('');

  const rayons = axes.map((_, i) => {
    const [x, y] = point(i, 1);
    return `<line x1="${cx}" y1="${cy}" x2="${r(x)}" y2="${r(y)}" stroke="var(--line)" stroke-width="1"/>`;
  }).join('');

  const surface = axes.map((a, i) => point(i, Math.max(0.04, a.valeur / 100)).map(r).join(',')).join(' ');

  const sommets = axes.map((a, i) => {
    const [x, y] = point(i, Math.max(0.04, a.valeur / 100));
    return `<circle class="sommet" cx="${r(x)}" cy="${r(y)}" r="3.5" fill="${couleur}"
        style="animation-delay:${520 + i * 70}ms">
      <title>${echapper(a.axe)} — ${a.n ?? a.valeur}</title></circle>`;
  }).join('');

  const etiquettes = axes.map((a, i) => {
    const [x, y] = point(i, 1.24);
    const ancre = Math.abs(x - cx) < 12 ? 'middle' : (x > cx ? 'start' : 'end');
    return `<text x="${r(x)}" y="${r(y + 4)}" text-anchor="${ancre}" class="ax-fort">${echapper(a.axe)}</text>`;
  }).join('');

  // La surface se déplie depuis le centre plutôt que d'apparaître d'un bloc.
  return `<svg class="gr gr-radar" viewBox="0 0 ${taille} ${taille}" role="img">
    ${toiles}${rayons}
    <polygon points="${surface}" fill="${couleur}" fill-opacity=".18"
             stroke="${couleur}" stroke-width="2" stroke-linejoin="round" class="toile-pleine"/>
    ${sommets}${etiquettes}
  </svg>`;
}

/**
 * Calendrier d'assiduité, une case par jour, en colonnes de semaines.
 * @param {{jour: string, actions: number}[]} jours  ordonnés du plus ancien au plus récent
 */
export function heatmap(jours, options = {}) {
  const { mois = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'] } = options;
  if (!jours.length) return vide('Pas encore d\'historique');

  const max = Math.max(1, ...jours.map(j => j.actions));
  const niveau = (n) => (n === 0 ? 0 : Math.min(4, Math.ceil(n / max * 4)));

  // Les jours sont ordonnés : on les empile par colonnes de 7 en partant du
  // lundi de la première semaine.
  const semaines = [];
  let courante = [];
  const premierJour = new Date(jours[0].jour + 'T12:00:00').getDay();
  const decalage = (premierJour + 6) % 7; // lundi = 0
  for (let i = 0; i < decalage; i++) courante.push(null);

  for (const j of jours) {
    courante.push(j);
    if (courante.length === 7) { semaines.push(courante); courante = []; }
  }
  if (courante.length) semaines.push(courante);

  const entetes = semaines.map((s, i) => {
    const premier = s.find(Boolean);
    if (!premier) return '<span></span>';
    const d = new Date(premier.jour + 'T12:00:00');
    const precedent = semaines[i - 1]?.find(Boolean);
    const changeDeMois = !precedent
      || new Date(precedent.jour + 'T12:00:00').getMonth() !== d.getMonth();
    return `<span>${changeDeMois ? mois[d.getMonth()] : ''}</span>`;
  }).join('');

  return `<div class="gr-heat">
    <div class="gr-heat-jours"><span>L</span><span></span><span>M</span><span></span><span>V</span><span></span><span>D</span></div>
    <div class="gr-heat-corps">
      <div class="gr-heat-mois" style="grid-template-columns:repeat(${semaines.length},1fr)">${entetes}</div>
      <div class="gr-heat-grille" style="grid-template-columns:repeat(${semaines.length},1fr)">
        ${semaines.map((semaine, s) => `<div class="gr-heat-col">
          ${Array.from({ length: 7 }, (_, i) => {
            const j = semaine[i];
            if (!j) return '<i class="vide"></i>';
            // Les cases s'allument colonne par colonne, de la plus ancienne
            // à aujourd'hui : on voit le temps passer.
            return `<i data-n="${niveau(j.actions)}" style="animation-delay:${s * 14 + i * 4}ms"
              title="${j.jour} — ${j.actions} action${j.actions > 1 ? 's' : ''}"></i>`;
          }).join('')}
        </div>`).join('')}
      </div>
    </div>
    <div class="gr-heat-legende">
      <span>Moins</span><i data-n="0"></i><i data-n="1"></i><i data-n="2"></i><i data-n="3"></i><i data-n="4"></i><span>Plus</span>
    </div>
  </div>`;
}

/**
 * Entonnoir de conversion — chaque étage se rétrécit à proportion.
 * @param {{etiquette: string, valeur: number, couleur: string}[]} etapes
 */
export function entonnoir(etapes, options = {}) {
  const { unite = '' } = options;
  if (!etapes.length) return vide('Pas encore de données');

  const base = Math.max(1, etapes[0].valeur);

  return `<div class="gr-entonnoir">
    ${etapes.map((e, i) => {
      const largeur = Math.max(6, e.valeur / base * 100);
      const precedent = i > 0 ? etapes[i - 1].valeur : null;
      const conversion = precedent ? Math.round(e.valeur / Math.max(1, precedent) * 100) : null;
      return `<div class="ge" style="animation-delay:${i * 70}ms">
        <span class="ge-l">${echapper(e.etiquette)}</span>
        <span class="ge-t"><span class="ge-f" style="width:${largeur}%;background:${e.couleur}"></span></span>
        <span class="ge-v">${e.valeur}${unite}</span>
        <span class="ge-c">${conversion !== null ? conversion + ' %' : ''}</span>
      </div>`;
    }).join('')}
  </div>`;
}

/** Micro-courbe sans axes, à poser dans une tuile de statistique. */
export function sparkline(valeurs, options = {}) {
  const { largeur = 120, hauteur = 34, couleur = 'var(--accent)' } = options;
  if (!valeurs.length) return '';

  const max = Math.max(1, ...valeurs);
  const pas = valeurs.length === 1 ? largeur : largeur / (valeurs.length - 1);
  const points = valeurs.map((v, i) => `${r(i * pas)},${r(hauteur - (v / max) * (hauteur - 4) - 2)}`);
  const id = uid('spark');

  return `<svg class="gr-spark" viewBox="0 0 ${largeur} ${hauteur}" preserveAspectRatio="none">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${couleur}" stop-opacity=".38"/>
      <stop offset="100%" stop-color="${couleur}" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon class="surface" points="0,${hauteur} ${points.join(' ')} ${largeur},${hauteur}" fill="url(#${id})"/>
    <polyline class="trace" points="${points.join(' ')}" fill="none" stroke="${couleur}"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

/** Barre segmentée : une seule ligne pour montrer une répartition. */
export function barreEmpilee(parts, options = {}) {
  const { hauteur = 12, legende = true } = options;
  const utiles = parts.filter(p => p.valeur > 0);
  if (!utiles.length) return vide('Pas encore de données');
  const total = utiles.reduce((t, p) => t + p.valeur, 0);

  return `<div class="gr-empilee">
    <div class="ge-barre" style="height:${hauteur}px">
      ${utiles.map((p, i) => `<span style="width:${p.valeur / total * 100}%;background:${p.couleur};
        animation-delay:${i * 60}ms" title="${echapper(p.etiquette)} — ${p.valeur}"></span>`).join('')}
    </div>
    ${legende ? `<ul class="gr-legende en-ligne">
      ${utiles.map(p => `<li><i style="background:${p.couleur}"></i>
        <span>${echapper(p.etiquette)}</span><b>${p.valeur}</b></li>`).join('')}
    </ul>` : ''}
  </div>`;
}

/** Message d'attente uniforme, quand il n'y a rien à tracer. */
export function vide(message) {
  return `<div class="gr-vide">${echapper(message)}</div>`;
}
