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

// ══════════════════════════════════════════ COURBE EN AIRE
//
// CE QUI NE MARCHAIT PAS
// ----------------------
// La courbe était un seul `<svg viewBox="0 0 1000 180"
// preserveAspectRatio="none">` : c'est ce qui lui faisait épouser toute la
// largeur du panneau… en étirant TOUT ce qu'il contenait. Sur un écran large,
// les chiffres de l'axe devenaient des caractères écrasés de 3 px de haut sur
// 14 de large, les points des ellipses ; sur un téléphone, l'inverse. Et
// l'info-bulle se réduisait au `<title>` natif, qui met une seconde à venir.
//
// LA RÉPARTITION, DÉSORMAIS
// -------------------------
// · Le SVG ne porte QUE de la géométrie : surface, tracé, lignes de grille.
//   Il peut s'étirer sans dommage — `vector-effect="non-scaling-stroke"` garde
//   au trait son épaisseur réelle, quelle que soit la déformation.
// · Tout ce qui se LIT est en HTML, posé en pourcentages par-dessus : les
//   graduations, les dates, le réticule, le point survolé et l'info-bulle.
//   Le texte reste du texte, net, à sa taille, sélectionnable.
// · Les données voyagent dans `data-serie` : `activerGraphiques()` (dans
//   dashboard.js) y lit les valeurs pour l'info-bulle, sans rien recalculer.
//
// La fonction reste PURE : elle rend une chaîne et ne touche jamais au DOM.

/** Fraction de la hauteur réservée au-dessus du point le plus haut. */
export const MARGE_COURBE = 0.1;

/**
 * Les chemins d'une courbe lissée, dans un repère 1000 × 100.
 *
 * Exportée parce que le morph entre 30 j / 90 j / semaines redessine la
 * courbe à chaque image à partir de valeurs intermédiaires : il doit tracer
 * EXACTEMENT comme `aire()`, sans quoi la dernière image sauterait.
 *
 * @param {number[]} norm  valeurs normalisées entre 0 et 1
 * @returns {{trace: string, surface: string}}
 */
export function cheminCourbe(norm, { largeur = 1000, hauteur = 100 } = {}) {
  const n = norm.length;
  if (!n) return { trace: '', surface: '' };
  const x = (i) => (n === 1 ? largeur / 2 : i * largeur / (n - 1));
  const y = (v) => hauteur - Math.max(0, v) * hauteur * (1 - MARGE_COURBE);

  // Bézier cubiques à tangentes horizontales : une ligne brisée sur 90 points
  // donne un « sismographe » qui masque la tendance, et ces tangentes-là ne
  // dépassent jamais sous zéro (un lissage Catmull-Rom, si).
  let trace = `M ${r(x(0))} ${r(y(norm[0]))}`;
  for (let i = 1; i < n; i++) {
    const x0 = x(i - 1), y0 = y(norm[i - 1]);
    const x1 = x(i), y1 = y(norm[i]);
    const mx = (x0 + x1) / 2;
    trace += ` C ${r(mx)} ${r(y0)}, ${r(mx)} ${r(y1)}, ${r(x1)} ${r(y1)}`;
  }
  const surface = `${trace} L ${r(x(n - 1))} ${hauteur} L ${r(x(0))} ${hauteur} Z`;
  return { trace, surface };
}

/**
 * Rééchantillonne une série sur `n` points, par interpolation linéaire.
 *
 * C'est ce qui permet de MORPHER une courbe de 30 points en une de 90 : on
 * redistribue l'ancienne forme sur la grille de la nouvelle, puis on
 * interpole point à point. La courbe se déforme au lieu de clignoter.
 */
export function reechantillonner(valeurs, n) {
  if (!valeurs.length || n <= 0) return Array.from({ length: Math.max(0, n) }, () => 0);
  if (valeurs.length === 1) return Array.from({ length: n }, () => valeurs[0]);
  return Array.from({ length: n }, (_, j) => {
    const pos = n === 1 ? 0 : j / (n - 1) * (valeurs.length - 1);
    const i = Math.floor(pos);
    const t = pos - i;
    const a = valeurs[i];
    const b = valeurs[Math.min(valeurs.length - 1, i + 1)];
    return a + (b - a) * t;
  });
}

/**
 * Plafond « rond » d'un axe : 1, 2, 5 × 10^k, divisible par le nombre de
 * graduations. Un axe qui monte à 7 avec quatre graduations affichait
 * 7 / 5 / 4 / 2 / 0 — arrondis faux, lignes qui ne tombent sur rien.
 */
export function plafondRond(max, graduations = 4) {
  if (!(max > 0)) return graduations;
  const brut = max / graduations;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map(m => m * puissance).find(p => p >= brut) ?? 10 * puissance;
  // Les valeurs sont des comptes : un pas fractionnaire n'aurait pas de sens.
  return Math.max(graduations, Math.ceil(pas) * graduations);
}

/**
 * Courbe en aire, avec dégradé, grille, réticule et info-bulle.
 *
 * @param {{etiquette: string, court?: string, valeur: number}[]} points
 * @param {object} [options] { hauteur, couleur, couleur2, unite, graduations, marqueurs }
 */
export function aire(points, options = {}) {
  const {
    hauteur = 180, couleur = 'var(--accent)', couleur2 = 'var(--accent2)',
    unite = '', graduations = 4, remplir = true, marqueurs = false, libelle = 'Courbe',
  } = options;

  if (!points.length) return vide('Pas encore de données');

  const valeurs = points.map(p => Number(p.valeur) || 0);
  const max = plafondRond(Math.max(1, ...valeurs), graduations);
  const norm = valeurs.map(v => v / max);
  const { trace, surface } = cheminCourbe(norm);
  const idDegrade = uid('aire');
  const n = points.length;
  const xPct = (i) => (n === 1 ? 50 : i / (n - 1) * 100);
  const yPct = (v) => 100 - (v / max) * 100 * (1 - MARGE_COURBE);

  // Lignes de grille dans le SVG (elles peuvent s'étirer), chiffres en HTML.
  const grille = Array.from({ length: graduations + 1 }, (_, i) => {
    const v = max * (1 - i / graduations);
    const py = r(yPct(v));
    return `<line x1="0" y1="${py}" x2="1000" y2="${py}" class="${i === graduations ? 'base' : ''}"
      vector-effect="non-scaling-stroke"/>`;
  }).join('');
  const axeY = Array.from({ length: graduations + 1 }, (_, i) => {
    const v = max * (1 - i / graduations);
    return `<span style="top:${r(yPct(v))}%">${Math.round(v)}</span>`;
  }).join('');

  // Six étiquettes au plus : au-delà, l'axe devient illisible.
  const pas = Math.max(1, Math.ceil(n / 6));
  const axeX = points.map((p, i) => {
    if (!(i % pas === 0 || i === n - 1)) return '';
    // Une étiquette trop proche de la dernière se tait plutôt que de la
    // chevaucher.
    if (i !== n - 1 && n - 1 - i < pas * 0.6) return '';
    const bord = i === 0 ? ' debut' : i === n - 1 ? ' fin' : '';
    return `<span class="${bord.trim()}" style="left:${r(xPct(i))}%">${echapper(p.court ?? p.etiquette)}</span>`;
  }).join('');

  // Les marqueurs sont pour les séries courtes (les semaines) : sur 90 jours,
  // 90 points ne seraient qu'un trait plus épais.
  const points_ = marqueurs
    ? points.map((p, i) => `<i class="gr-aire-pt" style="left:${r(xPct(i))}%;top:${r(yPct(valeurs[i]))}%;
        animation-delay:${400 + i * 30}ms"></i>`).join('')
    : '';

  const total = valeurs.reduce((t, v) => t + v, 0);
  const serie = points.map((p, i) => ({ e: p.etiquette, v: valeurs[i] }));

  return `<div class="gr-aire" data-gr="aire" tabindex="0" role="img"
      aria-label="${echapper(`${libelle} : ${total}${unite} sur ${n} points. Flèches pour parcourir.`)}"
      style="--h:${hauteur}px;--c:${couleur}" data-max="${max}" data-unite="${echapper(unite)}"
      data-serie="${echapper(JSON.stringify(serie))}">
    <div class="gr-aire-y" aria-hidden="true">${axeY}</div>
    <div class="gr-aire-plot">
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="${idDegrade}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${couleur}" stop-opacity=".32"/>
          <stop offset="100%" stop-color="${couleur2}" stop-opacity="0"/>
        </linearGradient></defs>
        <g class="gr-aire-grille">${grille}</g>
        ${remplir ? `<path class="surface" d="${surface}" fill="url(#${idDegrade})"/>` : ''}
        <path class="trace" d="${trace}" fill="none" stroke="${couleur}" stroke-width="2.25"
          stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      </svg>
      ${points_}
      <span class="gr-aire-ligne" aria-hidden="true"></span>
      <span class="gr-aire-curseur" aria-hidden="true"></span>
      <div class="gr-bulle" aria-hidden="true"></div>
    </div>
    <div class="gr-aire-x" aria-hidden="true">${axeX}</div>
  </div>`;
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
      <!-- Le bouton de la jauge TOURNE autour du centre au lieu d'être posé à
           ses coordonnées finales : il suit ainsi l'arc pendant que celui-ci
           se déroule, et une mise à jour le fait glisser d'une valeur à
           l'autre (une rotation s'anime, un couple cx/cy ne sait que sauter). -->
      <g class="aiguille" style="transform-origin:${r(cx)}px ${r(cy)}px;transform:rotate(${r(pct * 1.8)}deg);--angle:${r(pct * 1.8)}deg">
        <circle cx="${r(cx - rayon)}" cy="${r(cy)}" r="6" fill="var(--panel)" stroke="${couleur}" stroke-width="3"/>
      </g>
    </svg>
    <div class="gr-jauge-mid">
      <b data-roule="${Math.round(pct)}" data-suffixe="%">${valeur ?? Math.round(pct) + '%'}</b>
      ${libelle ? `<span>${echapper(libelle)}</span>` : ''}</div>
  </div>`;
}

/**
 * Anneau sectorisé (donut). Chaque part porte son info-bulle.
 *
 * Une part qui porte une `cle` devient CLIQUABLE, elle et sa ligne de
 * légende : `activerGraphiques()` émet alors `jc:filtre` avec cette clé. La
 * légende n'était qu'un rappel des couleurs ; elle répond désormais à la
 * question qu'on se pose en la lisant — « montre-moi celles-là ».
 *
 * @param {{etiquette: string, valeur: number, couleur: string, cle?: string}[]} parts
 * @param {object} [options] { taille, epaisseur, centre, sousCentre, filtre }
 *   `filtre` nomme le champ de `detail` de l'événement (« source » par défaut).
 */
export function donut(parts, options = {}) {
  const { taille = 168, epaisseur = 26, centre = '', sousCentre = '', filtre = 'source' } = options;
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
    const cle = p.cle !== undefined ? ` data-cle="${echapper(p.cle)}"` : '';
    const arc = `<circle cx="${taille / 2}" cy="${taille / 2}" r="${rayon}" fill="none"
        stroke="${p.couleur}" stroke-width="${epaisseur}"
        stroke-dasharray="${r(longueur)} ${r(circonference)}"
        stroke-dashoffset="${r(-parcouru * circonference)}"
        transform="rotate(-90 ${taille / 2} ${taille / 2})" class="part"${cle}
        style="--plein:${r(longueur)};--tour:${r(circonference)};animation-delay:${i * 110}ms">
        <title>${echapper(p.etiquette)} — ${p.valeur} (${Math.round(part * 100)} %)</title></circle>`;
    parcouru += part;
    return arc;
  }).join('');

  const cliquable = utiles.some(p => p.cle !== undefined);

  return `<div class="gr-donut-wrap${cliquable ? ' cliquable' : ''}" data-gr="donut" data-filtre="${echapper(filtre)}">
    <div class="gr-donut" style="width:${taille}px;height:${taille}px">
      <svg viewBox="0 0 ${taille} ${taille}">${arcs}</svg>
      <div class="gr-donut-mid"><b>${echapper(String(centre || total))}</b>
        ${sousCentre ? `<span>${echapper(sousCentre)}</span>` : ''}</div>
    </div>
    <ul class="gr-legende">
      ${utiles.map(p => {
        const pct = Math.round(p.valeur / total * 100);
        const attributs = p.cle !== undefined
          ? ` data-cle="${echapper(p.cle)}" role="button" tabindex="0"
              title="Voir les offres : ${echapper(p.etiquette)}"` : '';
        return `<li${attributs}><i style="background:${p.couleur}"></i>
        <span>${echapper(p.etiquette)}</span><em>${pct} %</em><b>${p.valeur}</b></li>`;
      }).join('')}
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
  const dernier = valeurs[valeurs.length - 1];

  // `non-scaling-stroke` : la micro-courbe s'étire sur la largeur de la tuile,
  // et sans lui son trait s'épaississait à l'horizontale et s'affinait à la
  // verticale — un trait « baveux », le contraire d'un chiffre net. Le point
  // final est en HTML pour la même raison : un cercle étiré devient un ovale.
  return `<span class="gr-spark-wrap">
  <svg class="gr-spark" viewBox="0 0 ${largeur} ${hauteur}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${couleur}" stop-opacity=".34"/>
      <stop offset="100%" stop-color="${couleur}" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon class="surface" points="0,${hauteur} ${points.join(' ')} ${largeur},${hauteur}" fill="url(#${id})"/>
    <polyline class="trace" points="${points.join(' ')}" fill="none" stroke="${couleur}"
              stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  </svg>
  <i class="gr-spark-fin" style="top:${r((hauteur - (dernier / max) * (hauteur - 4) - 2) / hauteur * 100)}%;background:${couleur}"></i>
  </span>`;
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
