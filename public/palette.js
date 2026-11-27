// LA PALETTE DE COMMANDES, VERSION 2.
//
// CE QUI MANQUAIT À LA PREMIÈRE
// -----------------------------
// · Elle cherchait une sous-chaîne EXACTE : « charge mission » ne trouvait
//   pas « Chargé de mission », « strasb urba » rien du tout. Or la palette sert
//   précisément à retrouver une offre dont on n'a retenu que deux bribes.
// · Elle ne montrait pas POURQUOI un résultat sortait : sans surlignage, une
//   liste de douze titres se relit en entier pour trouver le bon.
// · Six vues sur huit seulement, pas les entretiens ni le Chill.
// · Une offre trouvée ne pouvait qu'être ouverte. Pour l'épingler, il fallait
//   l'ouvrir, la trouver dans la liste, viser l'épingle — trois gestes là où
//   la palette en promet un.
// · Rien ne se rappelait d'une ouverture à l'autre, alors qu'on y revient
//   pour les deux ou trois mêmes choses.
//
// CE QU'ELLE FAIT
// ---------------
// · une recherche FLOUE (sous-chaîne d'abord, puis mots dans le désordre, puis
//   lettres dans l'ordre), avec les lettres trouvées surlignées ;
// · les RÉCENTS en tête quand le champ est vide ;
// · « → » sur une offre ouvre ses actions (ouvrir, épingler, marquer envoyée,
//   rédiger la lettre, écarter, ouvrir l'annonce), « ← » revient ;
// · un APERÇU de l'élément sélectionné à droite : le verdict d'une offre se
//   lit avant de l'ouvrir ;
// · « > » en tête ne cherche que les commandes.
//
// `scoreFlou` et `surligner` sont purs et exportés : c'est la partie qui se
// trompe en silence, elle se teste sous Node.

import { echapper, normaliser, pluriel, ageOffre, GM } from './format.js';
import { icone } from './icons.js';
import { ouvrirSurcouche, fermerSurcouche } from './surcouche.js';

const CLE_RECENTS = 'bp_palette_recents';
const MAX_RECENTS = 6;

// ───────────────────────────────────────────── la recherche floue (pure)

/**
 * Normalise un texte en gardant, pour chaque caractère obtenu, l'indice du
 * caractère d'origine : « Œuvre » devient « oeuvre », et le surlignage doit
 * quand même tomber sur le bon glyphe.
 */
function aplatir(texte) {
  const s = String(texte ?? '');
  let plat = '';
  const origine = [];
  for (let i = 0; i < s.length; i++) {
    const n = normaliser(s[i]);
    for (const c of n) { plat += c; origine.push(i); }
  }
  return { plat, origine };
}

const debutDeMot = (plat, i) => i === 0 || /[^a-z0-9]/.test(plat[i - 1]);

/**
 * Note la correspondance d'une requête avec un texte.
 *
 * @returns {{score: number, indices: number[]} | null}  `indices` désigne les
 *          caractères D'ORIGINE à surligner ; null si rien ne correspond.
 */
export function scoreFlou(requete, texte) {
  const q = normaliser(requete).replace(/\s+/g, ' ').trim();
  if (!q) return { score: 0, indices: [] };
  const { plat, origine } = aplatir(texte);
  if (!plat) return null;
  const versOrigine = (idx) => [...new Set(idx.map(i => origine[i]))];

  // 1. La sous-chaîne entière : le cas le plus fort, surtout en début de mot.
  const pos = plat.indexOf(q);
  if (pos >= 0) {
    const idx = Array.from({ length: q.length }, (_, k) => pos + k);
    return {
      score: 1000 + (debutDeMot(plat, pos) ? 300 : 0) - pos * 2 - plat.length * 0.2,
      indices: versOrigine(idx),
    };
  }

  // 2. Les mots de la requête, chacun quelque part, dans n'importe quel ordre.
  const mots = q.split(' ').filter(Boolean);
  if (mots.length > 1) {
    const idx = [];
    let score = 600;
    let tousTrouves = true;
    for (const m of mots) {
      const p = plat.indexOf(m);
      if (p < 0) { tousTrouves = false; break; }
      for (let k = 0; k < m.length; k++) idx.push(p + k);
      score += debutDeMot(plat, p) ? 40 : 0;
      score -= p * 0.5;
    }
    if (tousTrouves) return { score: score - plat.length * 0.2, indices: versOrigine(idx) };
  }

  // 3. Les lettres dans l'ordre (« strbg » → « Strasbourg »). Chaque lettre
  //    qui suit la précédente ou commence un mot vaut plus : c'est ce qui
  //    classe « Chargé de MIssion » avant « CHArGé d'éMIssions ».
  const compact = q.replace(/ /g, '');
  const idx = [];
  let j = 0;
  let score = 200;
  let precedent = -2;
  for (let i = 0; i < plat.length && j < compact.length; i++) {
    if (plat[i] !== compact[j]) continue;
    idx.push(i);
    if (i === precedent + 1) score += 12;
    if (debutDeMot(plat, i)) score += 18;
    score -= (i - precedent - 1) * 0.6;
    precedent = i;
    j++;
  }
  if (j < compact.length) return null;
  // Trop éparpillé pour être une intention : on préfère ne rien proposer.
  if (idx[idx.length - 1] - idx[0] > compact.length * 6 + 12) return null;
  return { score: score - plat.length * 0.2, indices: versOrigine(idx) };
}

/** Le texte échappé, les caractères trouvés enveloppés de `<mark>`. */
export function surligner(texte, indices = []) {
  const s = String(texte ?? '');
  if (!indices.length) return echapper(s);
  const marques = new Set(indices);
  let html = '';
  let ouvert = false;
  for (let i = 0; i < s.length; i++) {
    const m = marques.has(i);
    if (m && !ouvert) { html += '<mark>'; ouvert = true; }
    if (!m && ouvert) { html += '</mark>'; ouvert = false; }
    html += echapper(s[i]);
  }
  if (ouvert) html += '</mark>';
  return html;
}

/**
 * Classe les éléments pour une requête. Pur : prend la liste, rend la liste
 * triée avec les indices de surlignage. Les offres passent après les
 * commandes à score égal — une commande a un nom court, une offre un titre
 * long, et le score pénalise déjà la longueur.
 */
export function classer(requete, elements, { limiteOffres = 12, limiteCommandes = 8 } = {}) {
  const res = [];
  for (const el of elements) {
    const t = scoreFlou(requete, el.titre);
    const s = el.cherche ? scoreFlou(requete, el.cherche) : null;
    const meilleur = t && (!s || t.score >= s.score * 0.9) ? { ...t, champ: 'titre' } : s ? { ...s, champ: 'sous', score: s.score * 0.85 } : null;
    if (!meilleur) continue;
    res.push({ el, score: meilleur.score, indices: meilleur.champ === 'titre' ? meilleur.indices : [] });
  }
  res.sort((a, b) => b.score - a.score);
  const commandes = res.filter(r => !r.el.offre).slice(0, limiteCommandes);
  const offres = res.filter(r => r.el.offre).slice(0, limiteOffres);
  return [...commandes, ...offres];
}

// ───────────────────────────────────────────── les récents

function lireRecents() {
  try {
    const r = JSON.parse(localStorage.getItem(CLE_RECENTS) ?? '[]');
    return Array.isArray(r) ? r : [];
  } catch { return []; }
}
function noterRecent(id) {
  if (!id) return;
  const r = [id, ...lireRecents().filter(x => x !== id)].slice(0, MAX_RECENTS);
  try { localStorage.setItem(CLE_RECENTS, JSON.stringify(r)); } catch { /* sans mémoire */ }
}

// ───────────────────────────────────────────── l'interface

/**
 * Installe la palette.
 *
 * @param {object} ctx
 * @param {() => object[]} ctx.commandes   [{ id, titre, cat, ic, raccourci, aide, faire, mots }]
 * @param {() => object[]} ctx.offres      les offres chargées
 * @param {(offre) => void} ctx.ouvrirOffre
 * @param {(offre) => object[]} ctx.actionsOffre  [{ id, titre, ic, faire, danger }]
 */
export function installerPalette(ctx) {
  const palette = document.getElementById('palette');
  const champ = document.getElementById('paletteInput');
  const res = document.getElementById('paletteRes');
  const apercu = document.getElementById('paletteApercu');
  if (!palette || !champ || !res) return null;

  let items = [];
  let sel = 0;
  let contexte = null;          // l'offre dont on montre les actions

  const versItemOffre = (o) => ({
    id: `o:${o.id}`,
    titre: o.titre,
    sous: [o.entreprise, o.ville].filter(Boolean).join(' · '),
    cherche: `${o.titre} ${o.entreprise ?? ''} ${o.ville ?? ''}`,
    cat: 'Offres',
    offre: o,
    faire: () => ctx.ouvrirOffre(o),
  });

  function elementsDeBase() {
    return ctx.commandes().map(c => ({ ...c, cherche: [c.titre, c.mots].filter(Boolean).join(' ') }));
  }

  function calculer(q) {
    if (contexte) {
      const actions = ctx.actionsOffre(contexte).map(a => ({ ...a, cat: 'Actions sur l\'offre' }));
      if (!q.trim()) return actions.map(a => ({ ...a, indices: [] }));
      return classer(q, actions, { limiteCommandes: 20 }).map(r => ({ ...r.el, indices: r.indices }));
    }
    const brut = q.trim();
    const seulementCommandes = brut.startsWith('>');
    const requete = seulementCommandes ? brut.slice(1) : brut;
    const commandes = elementsDeBase();

    if (!requete) {
      // Champ vide : les récents, puis les vues, puis les actions.
      const recents = lireRecents().map(id => {
        if (id.startsWith('o:')) {
          const o = ctx.offres().find(x => x.id === id.slice(2));
          return o ? versItemOffre(o) : null;
        }
        return commandes.find(c => c.id === id) ?? null;
      }).filter(Boolean).map(x => ({ ...x, cat: 'Récents', indices: [] }));
      const deja = new Set(recents.map(r => r.id));
      return [...recents, ...commandes.filter(c => !deja.has(c.id)).map(c => ({ ...c, indices: [] }))];
    }

    const elements = seulementCommandes ? commandes : [...commandes, ...ctx.offres().map(versItemOffre)];
    return classer(requete, elements).map(r => ({ ...r.el, indices: r.indices }));
  }

  function rendre() {
    items = calculer(champ.value);
    sel = Math.min(sel, Math.max(0, items.length - 1));

    if (!items.length) {
      res.innerHTML = `<div class="palette-vide">Aucun résultat pour « ${echapper(champ.value.trim())} ».
        <span>Essaie deux bribes du titre, ou « &gt; » pour les seules commandes.</span></div>`;
      champ.removeAttribute('aria-activedescendant');
      if (apercu) apercu.innerHTML = '';
      return;
    }

    let cat = null;
    res.innerHTML = (contexte
      ? `<button type="button" class="palette-retour" data-retour>${icone('chevron-g', 14)}
          <span>${echapper(contexte.titre)}</span><span class="kbd">←</span></button>` : '')
      + items.map((it, i) => {
        let entete = '';
        if (it.cat !== cat) { cat = it.cat; entete = `<div class="palette-cat" role="presentation">${echapper(cat)}</div>`; }
        const marque = it.offre
          ? `<i class="pt pt${it.offre.groupe}" aria-hidden="true"></i>`
          : icone(it.ic ?? 'fleche', 16);
        return `${entete}<div class="pres${i === sel ? ' sel' : ''}${it.danger ? ' danger' : ''}" role="option"
            id="pres-${i}" data-i="${i}" aria-selected="${i === sel}">
          <span class="pem">${marque}</span>
          <span class="pt2">${surligner(it.titre, it.indices)}</span>
          ${it.sous ? `<span class="ps">${echapper(it.sous)}</span>` : ''}
          ${it.raccourci ? `<span class="pr">${it.raccourci.split(' ').map(k => `<span class="kbd">${echapper(k)}</span>`).join('')}</span>` : ''}
          ${it.offre ? `<button type="button" class="pres-plus" data-actions="${i}" tabindex="-1"
              title="Actions sur cette offre (→)" aria-label="Actions sur cette offre">${icone('chevron', 14)}</button>` : ''}
        </div>`;
      }).join('');
    selectionner(0, true);
  }

  function selectionner(delta, absolu = false) {
    const lignes = [...res.querySelectorAll('.pres')];
    if (!lignes.length) return;
    sel = absolu ? Math.min(sel, lignes.length - 1) : (sel + delta + lignes.length) % lignes.length;
    lignes.forEach((l, i) => {
      const actif = i === sel;
      l.classList.toggle('sel', actif);
      l.setAttribute('aria-selected', String(actif));
    });
    lignes[sel].scrollIntoView({ block: 'nearest' });
    champ.setAttribute('aria-activedescendant', `pres-${sel}`);
    rendreApercu(items[sel]);
  }

  /**
   * L'aperçu : ce qu'il faut savoir AVANT d'ouvrir. Pour une offre, le
   * verdict et le statut ; pour une commande, ce qu'elle fait et sa touche.
   */
  function rendreApercu(it) {
    if (!apercu) return;
    if (!it) { apercu.innerHTML = ''; return; }
    const o = it.offre ?? (contexte && !it.offre ? contexte : null);
    if (o) {
      const g = GM[o.groupe] ?? GM[0];
      const age = ageOffre(o.dateOffre);
      const verdict = o.analyse?.verdict;
      apercu.innerHTML = `
        <div class="pa-titre">${echapper(o.titre)}</div>
        <div class="pa-meta">${echapper([o.entreprise, o.ville].filter(Boolean).join(' · ') || '—')}</div>
        <div class="pa-tags">
          <span class="badge ${g.key}"><i class="pt pt${o.groupe}"></i> ${g.label}</span>
          ${o.score != null ? `<span class="scorepill">${o.score}</span>` : ''}
          <span class="badge badge-src">${echapper(o.suivi?.status ?? 'À postuler')}</span>
          ${o.suivi?.pinned ? `<span class="badge badge-src">${icone('epingle-pleine', 11)} épinglée</span>` : ''}
        </div>
        ${verdict ? `<p class="pa-verdict">${echapper(verdict.slice(0, 260))}${verdict.length > 260 ? '…' : ''}</p>`
          : '<p class="pa-vide">Pas encore d\'analyse pour cette offre.</p>'}
        <div class="pa-pied">${age !== null ? `publiée ${age === 0 ? 'aujourd\'hui' : `il y a ${pluriel(age, 'jour')}`}` : ''}
          ${o.aLettre ? ' · lettre écrite' : ''}</div>
        ${!contexte ? '<div class="pa-astuce"><span class="kbd">→</span> pour ses actions</div>' : ''}`;
      return;
    }
    apercu.innerHTML = `
      <div class="pa-ic">${icone(it.ic ?? 'fleche', 22)}</div>
      <div class="pa-titre">${echapper(it.titre)}</div>
      ${it.aide ? `<p class="pa-verdict">${echapper(it.aide)}</p>` : ''}
      ${it.raccourci ? `<div class="pa-pied">Raccourci : ${it.raccourci.split(' ').map(k => `<span class="kbd">${echapper(k)}</span>`).join(' ')}</div>` : ''}`;
  }

  function valider() {
    const it = items[sel];
    if (!it) return;
    if (!contexte) noterRecent(it.id);
    else noterRecent(`o:${contexte.id}`);
    fermer();
    // Après la fermeture : l'action peut ouvrir une autre surcouche (une
    // confirmation), qui doit trouver la pile vide.
    setTimeout(() => it.faire(), 0);
  }

  function entrerContexte(i = sel) {
    const it = items[i];
    if (!it?.offre) return false;
    contexte = it.offre;
    sel = 0;
    champ.value = '';
    champ.placeholder = `Action sur « ${it.offre.titre.slice(0, 40)} »…`;
    rendre();
    return true;
  }
  function sortirContexte() {
    if (!contexte) return false;
    contexte = null;
    champ.placeholder = 'Aller à une offre, une vue, une action…';
    sel = 0;
    rendre();
    return true;
  }

  function ouvrir(texte = '') {
    contexte = null;
    champ.placeholder = 'Aller à une offre, une vue, une action…';
    champ.value = texte;
    sel = 0;
    rendre();
    ouvrirSurcouche(palette, { focus: champ, titre: 'Palette de commandes' });
  }
  function fermer() { fermerSurcouche(palette); }
  const estOuverte = () => palette.classList.contains('show');

  // Le classement est recalculé à la frappe, mais une seule fois par image :
  // taper vite sur 900 offres ne doit pas empiler des calculs déjà périmés.
  let attente = 0;
  champ.addEventListener('input', () => {
    sel = 0;
    cancelAnimationFrame(attente);
    attente = requestAnimationFrame(rendre);
  });

  champ.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); selectionner(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectionner(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); valider(); }
    else if (e.key === 'ArrowRight' && champ.selectionStart === champ.value.length) {
      if (entrerContexte()) e.preventDefault();
    } else if ((e.key === 'ArrowLeft' && champ.selectionStart === 0) || (e.key === 'Backspace' && !champ.value)) {
      if (sortirContexte()) e.preventDefault();
    }
  });

  res.addEventListener('click', (e) => {
    if (e.target.closest('[data-retour]')) { sortirContexte(); champ.focus(); return; }
    const plus = e.target.closest('[data-actions]');
    if (plus) { e.stopPropagation(); entrerContexte(Number(plus.dataset.actions)); champ.focus(); return; }
    const l = e.target.closest('.pres');
    if (!l) return;
    sel = Number(l.dataset.i);
    valider();
  });
  res.addEventListener('mousemove', (e) => {
    const l = e.target.closest('.pres');
    if (!l || Number(l.dataset.i) === sel) return;
    sel = Number(l.dataset.i);
    selectionner(0, true);
  });
  palette.addEventListener('click', (e) => { if (e.target === palette) fermer(); });

  return { ouvrir, fermer, estOuverte, basculer: () => (estOuverte() ? fermer() : ouvrir()) };
}
