// LE TRI ÉCLAIR : une offre à la fois, trois réponses possibles.
//
// LE CONSTAT QUI A MENÉ ICI
// -------------------------
// 172 offres suivies, 166 « à postuler », 6 envoyées. Le tableau de bord
// annonce « 170 actions en attente » : ce n'est pas une file, c'est un stock,
// et il grossit de vingt offres à chaque collecte. Les « 3 du jour » règlent
// la question « par quoi commencer » ; elles ne règlent pas celle du stock.
//
// Or trier ce stock dans la liste, c'est : lire une ligne, déplier la carte,
// faire défiler l'analyse, viser la petite croix à droite, recommencer. Une
// trentaine de secondes par offre, dont vingt de manipulation. À ce prix, on
// ne trie pas — on laisse s'entasser, et la liste cesse d'être lue.
//
// CE QUE FAIT CET ÉCRAN
// ---------------------
// Il montre UNE offre, avec ce qu'il faut pour décider et rien d'autre : le
// verdict de l'analyse, ce que le CV prouve, ce qui manque, le salaire, le
// début de l'annonce. Puis trois réponses, sous les doigts :
//
//     ←  écarter      elle ne reviendra pas aux prochaines collectes
//     →  garder       elle est épinglée, donc en tête de la liste
//     ↓  plus tard    rien ne change ; elle repassera en fin de file
//
// La même chose à la souris (les trois boutons) et au doigt (on fait glisser
// la carte). CHAQUE décision s'annule (U, ou Ctrl+Z) : c'est ce qui permet
// d'aller vite sans craindre la faute de frappe.
//
// Rien de nouveau n'est stocké : « garder » est l'épingle qui existait déjà,
// « écarter » est la croix qui existait déjà. Le tri éclair n'ajoute pas un
// état de plus à entretenir — seulement une façon rapide d'utiliser les deux.
//
// Les fonctions de calcul (`fileDeTri`, `decisionDuGeste`, `bilanDuTri`) sont
// pures et exportées : le module s'importe sous Node sans toucher au document.

import {
  GM, echapper, pluriel, ageOffre, salaireCourt, contratLisible, enLigne, SOURCE_LABEL,
} from './format.js';
import { icone } from './icons.js';
import { ouvrirSurcouche, fermerSurcouche } from './surcouche.js';
import { anneauScore, badgeFraicheur, forces } from './render.js';
import { mouvementCoupe } from './anim.js';
import { sonClic, sonSucces } from './sons.js';

const CLE_PASSEES = 'jc_tri_passees';

const rangGroupe = (g) => ({ 1: 0, 2: 1, 0: 2, 3: 3 }[g] ?? 4);

/**
 * La file à trier, dans l'ordre où on la présente.
 *
 * N'y entrent que les offres sur lesquelles AUCUNE décision n'a été prise :
 * pas encore de candidature, pas épinglée (c'est déjà « garder »), et pas
 * saisie à la main — une offre qu'on a tapée soi-même a été choisie, et
 * l'écarter la supprimerait sans retour.
 *
 * L'ordre : les meilleures d'abord (groupe, puis score, puis fraîcheur). On
 * commence ainsi par ce qui a le plus de chances de valoir une candidature,
 * et l'attention baisse en même temps que l'enjeu. Les offres remises « à
 * plus tard » passent en FIN de file, de la plus ancienne à la plus récente :
 * sinon elles reviendraient en tête à chaque ouverture et l'on ne verrait
 * jamais la suite.
 *
 * @param {object[]} offres
 * @param {{passees?: Record<string, number>}} [options]
 */
export function fileDeTri(offres, { passees = {} } = {}) {
  const fraicheur = (o) => ageOffre(o.dateOffre) ?? 999;
  return (offres ?? [])
    .filter(o => (o.suivi?.status ?? 'À postuler') === 'À postuler' && !o.suivi?.pinned && !o.isManual)
    .sort((a, b) =>
      (passees[a.id] ?? 0) - (passees[b.id] ?? 0)
      || rangGroupe(a.groupe) - rangGroupe(b.groupe)
      || (b.score ?? 0) - (a.score ?? 0)
      || fraicheur(a) - fraicheur(b)
      || String(a.id).localeCompare(String(b.id)));
}

/**
 * Ce que veut dire un glissement de la carte.
 *
 * Le seuil suit la largeur de la carte (un cinquième, plafonné) : sur un
 * téléphone, 140 px seraient la moitié de l'écran. Un glissement surtout
 * vertical vers le bas remet à plus tard ; tout le reste, lâché avant le
 * seuil, ne décide de rien — la carte revient.
 *
 * @returns {'garder'|'ecarter'|'passer'|null}
 */
export function decisionDuGeste(dx, dy, largeur = 600) {
  const seuil = Math.max(60, Math.min(140, largeur * 0.2));
  if (Math.abs(dx) >= seuil && Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'garder' : 'ecarter';
  if (dy >= seuil && dy > Math.abs(dx) * 1.5) return 'passer';
  return null;
}

/** Le compte d'une séance. Pur. */
export function bilanDuTri(decisions) {
  const b = { gardees: 0, ecartees: 0, passees: 0, total: decisions.length };
  for (const d of decisions) {
    if (d.type === 'garder') b.gardees++;
    else if (d.type === 'ecarter') b.ecartees++;
    else b.passees++;
  }
  return b;
}

/** « 3 min 20 », « 45 s ». Pur. */
export function dureeLisible(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${String(s % 60).padStart(2, '0')}` : `${m} min`;
}

function lirePassees() {
  try { return JSON.parse(localStorage.getItem(CLE_PASSEES) ?? '{}') ?? {}; } catch { return {}; }
}
function ecrirePassees(p) {
  try { localStorage.setItem(CLE_PASSEES, JSON.stringify(p)); } catch { /* sans mémoire */ }
}

/**
 * Installe le tri éclair.
 *
 * @param {object} ctx
 * @param {() => object[]} ctx.offres                    toutes les offres
 * @param {(offre) => Promise<boolean>} ctx.ecarter      écarte, rend vrai si c'est fait
 * @param {(offre) => Promise<boolean>} ctx.restaurer    annule un écart
 * @param {(offre, on: boolean) => Promise<boolean>} ctx.epingler
 * @param {(offre) => void} ctx.ouvrirOffre              déplie l'offre dans la liste
 * @param {() => void} [ctx.voirGardees]                 montre les épinglées
 * @param {(bilan) => void} [ctx.apres]                  appelé à la fermeture
 * @param {(m: string, t?: string) => void} ctx.toast
 */
export function installerTri(ctx) {
  const boite = document.createElement('div');
  boite.className = 'overlay tri';
  boite.id = 'triEclair';
  document.body.appendChild(boite);

  let s = null;   // la séance en cours

  const courante = () => s?.file[s.i] ?? null;

  // ------------------------------------------------------------ le rendu

  function gabarit() {
    boite.innerHTML = `
      <div class="tri-scene" tabindex="-1">
        <header class="tri-tete">
          <div class="tri-marque">${icone('eclair', 17)} <b>Tri éclair</b>
            <span class="tri-sous" id="triPortee"></span></div>
          <div class="tri-avance" aria-hidden="true">
            <div class="tri-barre"><i id="triBarre"></i></div>
            <span class="tri-compte" id="triCompte"></span>
          </div>
          <div class="tri-scores" id="triScores"></div>
          <button type="button" class="btn btn-discret" data-tri="fermer">Terminer <span class="kbd">Échap</span></button>
        </header>
        <div class="tri-pile" id="triPile"></div>
        <footer class="tri-pied" id="triPied"></footer>
        <div class="tri-annonce" id="triAnnonce" role="status" aria-live="polite"></div>
      </div>`;
  }

  /** L'intérieur d'une carte : ce qu'il faut pour décider, dans l'ordre où on le lit. */
  function contenuCarte(o) {
    const g = GM[o.groupe] ?? GM[0];
    const f = forces(o.analyse);
    const a = o.analyse;
    const lignes = (x, n = 3) => (Array.isArray(x) ? x.filter(Boolean) : []).slice(0, n)
      .map(t => `<li>${echapper(t)}</li>`).join('');
    const salaire = salaireCourt(o.salaireSource);
    const sources = (o.sources?.length ? o.sources : [o.source]).filter(Boolean)
      .map(x => SOURCE_LABEL[x] ?? x).join(', ');

    const analyse = a ? `
      ${a.verdict ? `<p class="tri-verdict ${g.vd}">${icone('bouclier', 15)}<span>${echapper(a.verdict)}</span></p>` : ''}
      <div class="tri-duo">
        <div class="tri-col ok"><h4>${icone('coche', 12)} Ce que ton CV prouve
          ${f?.atouts > 3 ? `<i>${f.atouts}</i>` : ''}</h4>
          <ul>${lignes(a.prouvable) || '<li class="rien">Rien de relevé.</li>'}</ul></div>
        <div class="tri-col no"><h4>${icone('alerte', 12)} Ce qui manque
          ${f?.manques > 3 ? `<i>${f.manques}</i>` : ''}</h4>
          <ul>${lignes(a.nonprouvable) || '<li class="rien">Rien de bloquant relevé.</li>'}</ul>
          ${f?.compensables ? `<p class="tri-comp">dont ${pluriel(f.compensables, 'point')} compensable${f.compensables > 1 ? 's' : ''}</p>` : ''}</div>
      </div>`
      : `<p class="tri-verdict vd0">${icone('cerveau', 15)}<span><b>Pas encore analysée.</b>
          Le classement ci-dessous vient des mots-clés de ton profil — la fiche complète permet de lancer l'analyse.</span></p>
        ${(o.scoreDetail?.positifs ?? []).length ? `<div class="motifs tri-motifs">${o.scoreDetail.positifs.slice(0, 8)
          .map(m => `<span class="motif">+${m.poids} ${echapper(m.note ?? m.motif)}</span>`).join('')}</div>` : ''}`;

    return `
      <span class="tri-tampon oui" aria-hidden="true">${icone('etoile', 16)} Garder</span>
      <span class="tri-tampon non" aria-hidden="true">${icone('croix', 16)} Écarter</span>
      <div class="tri-carte-tete">
        <span class="badge ${g.key}"><i class="pt pt${o.groupe}"></i> ${g.label}</span>
        ${anneauScore(o.score)}
        ${badgeFraicheur(ageOffre(o.dateOffre))}
        ${o.horsZone ? '<span class="badge badge-zone">Hors zone</span>' : ''}
        ${o.lienMort ? '<span class="badge badge-mort">annonce retirée</span>' : ''}
        ${o.villesRepubliees > 1 ? `<span class="badge badge-diffuse">${o.villesRepubliees} villes</span>` : ''}
        ${salaire ? `<span class="tri-salaire" title="${echapper(o.salaireSource)}">${echapper(salaire)}</span>` : ''}
      </div>
      <h2 class="tri-titre">${echapper(o.titre)}</h2>
      <div class="tri-meta">${echapper(enLigne(o.entreprise || 'Employeur non précisé', o.ville, contratLisible(o.contrat)))}
        ${sources ? `<span class="tri-source">via ${echapper(sources)}</span>` : ''}</div>
      <div class="tri-corps">
        ${analyse}
        ${o.extrait ? `<div class="tri-extrait"><h4>L'annonce</h4><p>${
          // Les annonces arrivent avec trois ou quatre lignes vides d'affilée :
          // sur une carte, c'est un demi-écran de blanc avant la suite.
          echapper(String(o.extrait).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim())}</p></div>` : ''}
      </div>`;
  }

  function creerCarte(o, classe) {
    const el = document.createElement('article');
    el.className = 'tri-carte ' + classe;
    el.dataset.id = String(o.id);
    el.innerHTML = contenuCarte(o);
    return el;
  }

  function majEntete() {
    const total = s.file.length;
    const fait = Math.min(s.i, total);
    const b = bilanDuTri(s.decisions);
    boite.querySelector('#triCompte').textContent = total ? `${Math.min(fait + 1, total)} / ${total}` : '';
    boite.querySelector('#triBarre').style.transform = `scaleX(${total ? fait / total : 1})`;
    boite.querySelector('#triPortee').textContent = s.libelle;
    boite.querySelector('#triScores').innerHTML = `
      <span class="oui" title="Gardées">${icone('etoile', 13)} <b>${b.gardees}</b></span>
      <span class="non" title="Écartées">${icone('croix', 13)} <b>${b.ecartees}</b></span>
      <span title="Remises à plus tard">${icone('horloge', 13)} <b>${b.passees}</b></span>`;
  }

  function rendrePied() {
    const pied = boite.querySelector('#triPied');
    const o = courante();
    if (!o) { pied.innerHTML = ''; return; }
    pied.innerHTML = `
      <div class="tri-gestes">
        <button type="button" class="tri-btn non" data-tri="ecarter">
          ${icone('croix', 18)}<span><b>Écarter</b><small>ne reviendra pas</small></span><span class="kbd">←</span></button>
        <button type="button" class="tri-btn tard" data-tri="passer">
          ${icone('horloge', 18)}<span><b>Plus tard</b><small>repassera en fin de file</small></span><span class="kbd">↓</span></button>
        <button type="button" class="tri-btn oui" data-tri="garder">
          ${icone('etoile', 18)}<span><b>Garder</b><small>épinglée en tête de liste</small></span><span class="kbd">→</span></button>
      </div>
      <div class="tri-second">
        <button type="button" class="btn btn-discret" data-tri="annuler" ${s.decisions.length ? '' : 'disabled'}>
          ${icone('retour', 13)} Annuler <span class="kbd">U</span></button>
        ${o.lien ? `<button type="button" class="btn btn-discret" data-tri="annonce">
          ${icone('externe', 13)} L'annonce <span class="kbd">O</span></button>` : ''}
        <button type="button" class="btn btn-discret" data-tri="fiche">
          ${icone('liste', 13)} Fiche complète <span class="kbd">Entrée</span></button>
      </div>`;
  }

  /** Pose la carte courante et, derrière elle, la suivante. */
  function rendrePile({ entree = false } = {}) {
    const pile = boite.querySelector('#triPile');
    pile.querySelectorAll('.tri-carte:not(.sort)').forEach(c => c.remove());
    const o = courante();
    majEntete();
    rendrePied();
    // Le pied vient d'être réécrit : si le bouton cliqué portait le focus, il
    // est retombé sur <body> et les flèches ne nous parviendraient plus.
    if (!boite.contains(document.activeElement)) {
      boite.querySelector('.tri-scene')?.focus({ preventScroll: true });
    }
    if (!o) { rendreBilan(); return; }

    const apres = s.file[s.i + 1];
    if (apres) pile.appendChild(creerCarte(apres, 'suivante'));
    const carte = creerCarte(o, 'courante');
    pile.appendChild(carte);
    brancherGlisse(carte);
    if (entree && !mouvementCoupe()) {
      carte.animate([
        { transform: 'translateY(14px) scale(.965)', opacity: .6 },
        { transform: 'none', opacity: 1 },
      ], { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
  }

  function rendreBilan() {
    const pile = boite.querySelector('#triPile');
    const b = bilanDuTri(s.decisions);
    const duree = dureeLisible(Date.now() - s.debut);
    const reste = fileDeTri(ctx.offres(), { passees: lirePassees() }).length;
    const el = document.createElement('section');
    el.className = 'tri-bilan';
    el.innerHTML = b.total ? `
      <div class="tri-bilan-ic">${icone('coche', 30)}</div>
      <h2>${pluriel(b.total, 'offre')} triée${b.total > 1 ? 's' : ''} en ${duree}</h2>
      <div class="tri-bilan-chiffres">
        <div class="oui"><b>${b.gardees}</b><span>gardée${b.gardees > 1 ? 's' : ''}</span></div>
        <div class="non"><b>${b.ecartees}</b><span>écartée${b.ecartees > 1 ? 's' : ''}</span></div>
        <div><b>${b.passees}</b><span>à plus tard</span></div>
      </div>
      <p>${b.gardees
        ? `Les ${b.gardees > 1 ? `${b.gardees} gardées sont` : 'gardée est'} en tête de ta liste, épinglée${b.gardees > 1 ? 's' : ''}. C'est par là que la suite commence.`
        : reste ? 'Aucune gardée cette fois. La file se vide quand même : c\'est le but.' : 'La file est vide. Il ne reste plus qu\'à postuler.'}</p>
      <div class="tri-bilan-actions">
        ${b.gardees && ctx.voirGardees ? `<button type="button" class="btn btn-primary" data-tri="gardees">${icone('etoile', 14)} Voir les gardées</button>` : ''}
        <button type="button" class="btn${b.gardees ? '' : ' btn-primary'}" data-tri="fermer">Fermer</button>
        ${s.decisions.length ? `<button type="button" class="btn btn-discret" data-tri="annuler">${icone('retour', 13)} Annuler la dernière</button>` : ''}
      </div>` : `
      <div class="tri-bilan-ic">${icone('coche', 30)}</div>
      <h2>Rien à trier ici</h2>
      <p>Toutes les offres de cette sélection ont déjà une décision : épinglées, envoyées ou écartées.</p>
      <div class="tri-bilan-actions"><button type="button" class="btn btn-primary" data-tri="fermer">Fermer</button></div>`;
    pile.appendChild(el);
    el.querySelector('.btn-primary, .btn')?.focus({ preventScroll: true });
    if (b.total) sonSucces();
  }

  const annoncer = (texte) => {
    const z = boite.querySelector('#triAnnonce');
    if (z) z.textContent = texte;
  };

  // ------------------------------------------------------- les décisions

  /** La carte s'en va du côté de la décision ; la suivante prend sa place. */
  function sortir(carte, type, depuis = { x: 0, y: 0 }) {
    if (!carte) return;
    carte.classList.add('sort');
    carte.classList.remove('courante');
    if (mouvementCoupe()) { carte.remove(); return; }
    const l = window.innerWidth;
    const vers = type === 'garder' ? `translate(${l * 0.7}px, ${depuis.y - 30}px) rotate(16deg)`
      : type === 'ecarter' ? `translate(${-l * 0.7}px, ${depuis.y - 30}px) rotate(-16deg)`
        : `translate(${depuis.x}px, 60px) scale(.94)`;
    const anim = carte.animate([
      { transform: `translate(${depuis.x}px, ${depuis.y}px) rotate(${depuis.x / 22}deg)`, opacity: 1 },
      { transform: vers, opacity: 0 },
    ], { duration: type === 'passer' ? 200 : 300, easing: 'cubic-bezier(.4,0,.9,.6)', fill: 'forwards' });
    anim.onfinish = anim.oncancel = () => carte.remove();
  }

  /**
   * Prend une décision sur l'offre courante.
   *
   * L'ÉCRAN N'ATTEND PAS LE SERVEUR. La carte part tout de suite et la
   * suivante arrive : l'écriture se fait derrière. Si elle échoue, l'offre
   * revient à sa place avec un message — on ne laisse jamais croire à une
   * décision qui n'a pas été enregistrée.
   */
  function decider(type, depuis) {
    const o = courante();
    if (!o || s.verrou) return;
    const carte = boite.querySelector('.tri-carte.courante');
    sortir(carte, type, depuis);

    const decision = { type, offre: o };
    s.decisions.push(decision);
    s.i++;
    if (type === 'garder') sonClic();
    annoncer(type === 'garder' ? 'Gardée.' : type === 'ecarter' ? 'Écartée.' : 'Remise à plus tard.');
    rendrePile({ entree: true });

    const ecrit = type === 'garder' ? ctx.epingler(o, true)
      : type === 'ecarter' ? ctx.ecarter(o)
        : Promise.resolve(true);
    if (type === 'passer') {
      const p = lirePassees();
      p[o.id] = Date.now();
      ecrirePassees(p);
    }
    decision.ecrit = Promise.resolve(ecrit).catch(() => false).then((ok) => {
      if (ok || !s) return ok;
      // Échec : on défait la décision à l'écran, où qu'on en soit depuis.
      const k = s.decisions.indexOf(decision);
      if (k >= 0) s.decisions.splice(k, 1);
      const place = s.file.indexOf(o);
      if (place >= 0 && place < s.i) { s.file.splice(place, 1); s.i--; s.file.splice(s.i, 0, o); }
      rendrePile({ entree: true });
      return false;
    });
  }

  /** Défait la dernière décision, serveur compris. */
  async function annuler() {
    if (!s || s.verrou || !s.decisions.length) return;
    s.verrou = true;
    const d = s.decisions[s.decisions.length - 1];
    try {
      // La décision est peut-être encore en train de s'écrire : on attend
      // qu'elle le soit avant de la défaire, sinon l'annulation arriverait
      // avant ce qu'elle annule.
      const etaitEcrite = await d.ecrit;
      let ok = true;
      if (etaitEcrite !== false) {
        if (d.type === 'garder') ok = await ctx.epingler(d.offre, false);
        else if (d.type === 'ecarter') ok = await ctx.restaurer(d.offre);
        else { const p = lirePassees(); delete p[d.offre.id]; ecrirePassees(p); }
      }
      if (!ok) return;
      const k = s.decisions.indexOf(d);
      if (k >= 0) s.decisions.splice(k, 1);
      const place = s.file.indexOf(d.offre);
      if (place >= 0 && place < s.i) { s.file.splice(place, 1); s.i--; s.file.splice(s.i, 0, d.offre); }
      boite.querySelector('.tri-bilan')?.remove();
      annoncer('Dernière décision annulée.');
      rendrePile({ entree: true });
    } finally {
      s.verrou = false;
    }
  }

  // ------------------------------------------------------- le glissement

  /**
   * La carte se fait glisser — souris, doigt ou stylet, un seul code.
   *
   * `touch-action: pan-y` (en CSS) laisse le doigt faire défiler l'annonce
   * de haut en bas ; seul le mouvement de côté déplace la carte. Le geste ne
   * démarre qu'après quelques pixels : un clic sur un lien ou une sélection
   * de texte n'est pas un glissement.
   */
  function brancherGlisse(carte) {
    let g = null;
    const tampons = { garder: carte.querySelector('.tri-tampon.oui'), ecarter: carte.querySelector('.tri-tampon.non') };

    const poser = (dx, dy) => {
      carte.style.transform = `translate(${dx}px, ${dy * 0.25}px) rotate(${dx / 22}deg)`;
      const seuil = Math.max(60, Math.min(140, carte.offsetWidth * 0.2));
      const force = Math.min(1, Math.abs(dx) / seuil);
      tampons.garder.style.opacity = dx > 0 ? force : 0;
      tampons.ecarter.style.opacity = dx < 0 ? force : 0;
      carte.classList.toggle('vers-garder', dx > 0 && force >= 1);
      carte.classList.toggle('vers-ecarter', dx < 0 && force >= 1);
    };

    carte.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('a, button') || s?.verrou) return;
      g = { x: e.clientX, y: e.clientY, id: e.pointerId, actif: false };
    });
    carte.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.actif) {
        // Le geste se déclare : surtout horizontal, et franc.
        if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
        g.actif = true;
        // La capture garde le geste même si le pointeur sort de la carte.
        // Elle peut être refusée (pointeur déjà relâché) : le glissement
        // marche encore sans elle, il ne faut pas qu'elle l'interrompe.
        try { carte.setPointerCapture?.(g.id); } catch { /* sans capture */ }
        carte.classList.add('en-glisse');
        window.getSelection?.()?.removeAllRanges();
      }
      e.preventDefault();
      poser(dx, dy);
    });
    const lacher = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y;
      const actif = g.actif;
      g = null;
      if (!actif) return;
      carte.classList.remove('en-glisse');
      const choix = e.type === 'pointercancel' ? null : decisionDuGeste(dx, dy, carte.offsetWidth);
      if (choix && choix !== 'passer') { decider(choix, { x: dx, y: dy * 0.25 }); return; }
      // Pas assez loin : la carte revient, sans rien décider.
      carte.classList.remove('vers-garder', 'vers-ecarter');
      tampons.garder.style.opacity = tampons.ecarter.style.opacity = 0;
      if (mouvementCoupe()) { carte.style.transform = ''; return; }
      const retour = carte.animate([{ transform: carte.style.transform }, { transform: 'none' }],
        { duration: 260, easing: 'cubic-bezier(.17,1.14,.33,1)' });
      carte.style.transform = '';
      retour.onfinish = () => {};
    };
    carte.addEventListener('pointerup', lacher);
    carte.addEventListener('pointercancel', lacher);
  }

  // ------------------------------------------------- écoutes et cycle de vie

  boite.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tri]');
    if (!b || !s) return;
    const quoi = b.dataset.tri;
    if (quoi === 'fermer') fermerSurcouche(boite);
    else if (quoi === 'annuler') annuler();
    else if (quoi === 'annonce') ouvrirAnnonce();
    else if (quoi === 'fiche') ouvrirFiche();
    else if (quoi === 'gardees') { const voir = ctx.voirGardees; fermerSurcouche(boite); voir?.(); }
    else decider(quoi);
  });

  function ouvrirAnnonce() {
    const o = courante();
    if (o?.lien) window.open(o.lien, '_blank', 'noopener');
  }

  function ouvrirFiche() {
    const o = courante();
    if (!o) return;
    fermerSurcouche(boite);
    ctx.ouvrirOffre(o);
  }

  boite.addEventListener('keydown', (e) => {
    if (!s || e.altKey) return;
    const touche = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && touche === 'z') { e.preventDefault(); annuler(); return; }
    if (e.ctrlKey || e.metaKey) return;
    // Entrée et Espace sur un bouton restent le clic du bouton.
    const surBouton = e.target instanceof Element && e.target.closest('button, a');
    switch (touche) {
      case 'arrowleft': case 'x': e.preventDefault(); decider('ecarter'); break;
      case 'arrowright': case 'p': case 'g': e.preventDefault(); decider('garder'); break;
      case 'arrowdown': case 's': e.preventDefault(); decider('passer'); break;
      case ' ': if (!surBouton) { e.preventDefault(); decider('passer'); } break;
      case 'u': case 'backspace': e.preventDefault(); annuler(); break;
      case 'o': e.preventDefault(); ouvrirAnnonce(); break;
      case 'enter': if (!surBouton) { e.preventDefault(); ouvrirFiche(); } break;
    }
  });

  /**
   * Ouvre une séance.
   *
   * @param {object} [o]
   * @param {object[]} [o.offres]   la sélection à trier (défaut : toutes)
   * @param {string} [o.libelle]    ce que cette sélection représente
   */
  function ouvrir({ offres, libelle } = {}) {
    if (s) return;
    const passees = lirePassees();
    // Les offres disparues n'ont plus à encombrer la mémoire des « plus tard ».
    const connues = new Set(ctx.offres().map(x => String(x.id)));
    let purge = false;
    for (const id of Object.keys(passees)) if (!connues.has(id)) { delete passees[id]; purge = true; }
    if (purge) ecrirePassees(passees);

    const file = fileDeTri(offres ?? ctx.offres(), { passees });
    s = { file, i: 0, decisions: [], debut: Date.now(), verrou: false,
      libelle: `${libelle ? libelle + ' · ' : ''}${pluriel(file.length, 'offre')} à trier` };
    gabarit();
    ouvrirSurcouche(boite, {
      titre: 'Tri éclair',
      focus: boite.querySelector('.tri-scene'),
      surFermeture: () => {
        const fini = s;
        s = null;
        boite.innerHTML = '';
        if (fini) ctx.apres?.(bilanDuTri(fini.decisions));
      },
    });
    rendrePile({ entree: true });
  }

  return {
    ouvrir,
    fermer: () => fermerSurcouche(boite),
    estOuvert: () => Boolean(s),
  };
}
