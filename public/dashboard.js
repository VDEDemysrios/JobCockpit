// Vues « Tableau de bord » et « Statistiques ».
//
// Ces deux vues ne calculent rien : tous les chiffres arrivent déjà agrégés
// depuis /api/stats. Le serveur est seul juge, le navigateur seul dessinateur.
// C'est ce qui garantit qu'un « taux de réponse » affiche la même valeur ici,
// dans la progression et dans les quêtes.
//
// Les seules exceptions sont des DÉRIVÉES D'AFFICHAGE (la série de jours
// consécutifs, le prochain entretien, le compte à rebours) : des lectures de
// données déjà là, pas des statistiques. Elles sont pures et exportées, pour
// être testées sous Node sans navigateur.
//
// LE 4.0, ICI
// -----------
// · `#dashHero` : l'objectif de la semaine en grand anneau, la série, le
//   prochain entretien, la dernière collecte. C'est ce qu'on vient chercher en
//   ouvrant l'application ; ça passe avant tout le reste.
// · Les graphiques ne se REJOUENT plus à chaque rendu. `rendreTout()` d'app.js
//   redessine le tableau de bord après chaque épinglage, chaque note : les
//   barres repoussaient de zéro et les anneaux se redéroulaient à chaque fois,
//   pour des données identiques. `poserGraphique()` ne touche plus au DOM si
//   rien n'a changé, et quand quelque chose a changé, fait GLISSER chaque
//   barre et chaque arc de l'ancienne valeur à la nouvelle.
// · Les graphiques répondent : réticule et info-bulle sur la courbe, morph
//   entre 30 j / 90 j / semaines, légende du donut cliquable.
// · « Analyse détaillée » en onglets plutôt qu'en pile de huit panneaux.

import {
  aire, barres, barresH, anneau, jauge, donut, radar, heatmap, entonnoir, sparkline, vide,
  cheminCourbe, reechantillonner, MARGE_COURBE,
} from './charts.js';
import {
  STATUSES, STATUS_COL, SOURCE_LABEL, PALETTE,
  joursDepuis, dateLisible, ilYA, echapper, pluriel, todayISO, JOURS,
} from './format.js';
import { icone } from './icons.js';
import { mouvementCoupe } from './anim.js';

/** Étiquette courte d'une date ISO pour un axe : « 28/07 ». */
const courtISO = (iso) => {
  const d = new Date(iso + 'T12:00:00');
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const isoLocal = (d) => {
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Une date ISO « AAAA-MM-JJ » en minuit LOCAL (et non UTC, comme `new Date(iso)`). */
const minuitLocal = (iso) => {
  const [a, m, j] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(a, (m || 1) - 1, j || 1);
};

function lireStockage(cle, defaut) {
  try { return localStorage.getItem(cle) ?? defaut; } catch { return defaut; }
}
function ecrireStockage(cle, valeur) {
  try { localStorage.setItem(cle, valeur); } catch { /* navigation privée */ }
}

// ══════════════════════════════════════════ DÉRIVÉES PURES

/**
 * LA SÉRIE : jours consécutifs avec au moins une action, jusqu'à aujourd'hui.
 *
 * Une journée pas encore « faite » ne casse pas la série : à 9 h, n'avoir rien
 * envoyé n'est pas un échec, c'est le matin. La série court donc jusqu'à
 * HIER tant qu'aujourd'hui est vide, et `aujourdhuiFait` dit s'il reste
 * quelque chose à faire pour la prolonger.
 *
 * @param {{jour: string, actions: number}[]} serie  ordonnée, du plus ancien au plus récent
 * @param {string} aujourdhui  ISO local
 */
export function serieJours(serie, aujourdhui = todayISO()) {
  const parJour = new Map((serie ?? []).map(j => [j.jour, Number(j.actions) || 0]));
  const aujourdhuiFait = (parJour.get(aujourdhui) ?? 0) > 0;

  const curseur = minuitLocal(aujourdhui);
  if (!aujourdhuiFait) curseur.setDate(curseur.getDate() - 1);
  let jours = 0;
  // `setDate(-1)` et non `- 86 400 000 ms` : un jour de changement d'heure
  // dure 23 ou 25 heures, et la soustraction en millisecondes sautait ou
  // doublait une date.
  while ((parJour.get(isoLocal(curseur)) ?? 0) > 0) {
    jours++;
    curseur.setDate(curseur.getDate() - 1);
  }

  const derniers = [];
  const d = minuitLocal(aujourdhui);
  d.setDate(d.getDate() - 13);
  for (let i = 0; i < 14; i++) {
    const iso = isoLocal(d);
    derniers.push({ jour: iso, actif: (parJour.get(iso) ?? 0) > 0, aujourdhui: iso === aujourdhui });
    d.setDate(d.getDate() + 1);
  }
  return { jours, aujourdhuiFait, derniers };
}

/**
 * Les sept jours de la semaine en cours (lundi → dimanche), avec les envois.
 * @param {{jour: string, envois: number}[]} serie
 * @param {string} lundi  ISO du lundi de la semaine
 */
export function joursSemaine(serie, lundi, aujourdhui = todayISO()) {
  const parJour = new Map((serie ?? []).map(j => [j.jour, Number(j.envois) || 0]));
  const d = minuitLocal(lundi);
  return Array.from({ length: 7 }, () => {
    const iso = isoLocal(d);
    const jour = { jour: iso, initiale: JOURS[d.getDay()][0].toUpperCase(), envois: parJour.get(iso) ?? 0,
      futur: iso > aujourdhui, aujourdhui: iso === aujourdhui };
    d.setDate(d.getDate() + 1);
    return jour;
  });
}

/**
 * Le prochain entretien daté, aujourd'hui compris. Un refus enregistré après
 * coup ne compte plus : l'entretien n'aura pas lieu.
 * @returns {{offre: object, date: string, jours: number}|null}
 */
export function prochainEntretien(offres, aujourdhui = todayISO()) {
  let meilleur = null;
  for (const o of offres ?? []) {
    const date = o.suivi?.entretien;
    if (!date || o.suivi.status === 'Refus' || date < aujourdhui) continue;
    if (!meilleur || date < meilleur.date) meilleur = { offre: o, date };
  }
  if (!meilleur) return null;
  const jours = Math.round((minuitLocal(meilleur.date) - minuitLocal(aujourdhui)) / 86400000);
  return { ...meilleur, jours };
}

/**
 * Compte à rebours jusqu'au JOUR d'un entretien (minuit local).
 *
 * L'heure de l'entretien n'est pas saisie — seulement sa date. Compter
 * jusqu'à « 9 h » aurait inventé une précision qu'on n'a pas ; on compte donc
 * jusqu'au début du jour J, et on le dit.
 *
 * @returns {{jourJ: boolean, jours: number, heures: number, minutes: number, texte: string}|null}
 */
export function rebours(dateISO, maintenant = new Date()) {
  if (!dateISO) return null;
  const cible = minuitLocal(dateISO);
  const finJour = new Date(cible);
  finJour.setDate(finJour.getDate() + 1);
  if (maintenant >= finJour) return null;
  if (maintenant >= cible) return { jourJ: true, jours: 0, heures: 0, minutes: 0, texte: 'C\'est aujourd\'hui' };
  const ms = cible - maintenant;
  const jours = Math.floor(ms / 86400000);
  const heures = Math.floor(ms % 86400000 / 3600000);
  const minutes = Math.floor(ms % 3600000 / 60000);
  const texte = jours > 0
    ? `${jours} j ${heures} h ${String(minutes).padStart(2, '0')} min avant le jour J`
    : `${heures} h ${String(minutes).padStart(2, '0')} min avant le jour J`;
  return { jourJ: false, jours, heures, minutes, texte };
}

// ══════════════════════════════════════════ POSE DES GRAPHIQUES

/** Les identifiants uniques des dégradés changent à chaque rendu : on les neutralise pour comparer. */
const neutre = (html) => html.replace(/\b(aire|anneau|jauge|spark|hero)-\d+\b/g, '#');

/**
 * Ce qu'on sait faire glisser d'une valeur à l'autre, et comment le lire.
 * Les valeurs sont lues dans les ATTRIBUTS et les styles en ligne — jamais
 * dans la géométrie calculée : aucune lecture ne force de mise en page.
 */
const px = (s) => String(s ?? '').trim().split(/[\s,]+/).filter(Boolean).map(n => `${n}px`).join(' ');
const TRANSITIONS = [
  ['.gb-t', el => ({ height: el.style.height })],
  ['.gbh-f', el => ({ width: el.style.width })],
  ['.ge-f', el => ({ width: el.style.width })],
  ['.ge-barre > span', el => ({ width: el.style.width })],
  ['.arc', el => ({ strokeDashoffset: px(el.getAttribute('stroke-dashoffset')) })],
  ['.part', el => ({
    strokeDasharray: px(el.getAttribute('stroke-dasharray')),
    strokeDashoffset: px(el.getAttribute('stroke-dashoffset')),
  })],
  ['.aiguille', el => ({ transform: el.style.transform })],
  ['.hero-jour i', el => ({ height: el.style.height })],
];

function releverValeurs(racine) {
  const valeurs = new Map();
  for (const [sel, lire] of TRANSITIONS) {
    racine.querySelectorAll(sel).forEach((el, i) => valeurs.set(`${sel}#${el.dataset.cle ?? i}`, lire(el)));
  }
  return valeurs;
}

function animerDepuis(racine, avant) {
  const options = { duration: 720, easing: 'cubic-bezier(.22,1,.36,1)' };
  for (const [sel, lire] of TRANSITIONS) {
    racine.querySelectorAll(sel).forEach((el, i) => {
      const ancien = avant.get(`${sel}#${el.dataset.cle ?? i}`);
      if (!ancien) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: 'ease-out' });
        return;
      }
      const nouveau = lire(el);
      if (Object.keys(nouveau).every(k => nouveau[k] === ancien[k])) return;
      try { el.animate([ancien, nouveau], options); } catch { /* valeur non interpolable : on saute */ }
    });
  }
}

/**
 * Pose un graphique dans `cible` — ou ne fait RIEN s'il est identique.
 *
 * Premier affichage : l'animation d'arrivée du CSS joue (les barres poussent,
 * les arcs se déroulent). Mise à jour : l'arrivée est coupée (`.gr-maj`) et
 * chaque barre, chaque arc, chaque aiguille glisse depuis sa valeur
 * précédente. Le tableau de bord ne « clignote » plus quand on épingle une
 * offre ; il bouge là où un chiffre a bougé, et seulement là.
 *
 * @returns {boolean} vrai si le contenu a changé
 */
export function poserGraphique(cible, html) {
  if (!cible) return false;
  const sig = neutre(html);
  if (cible._sig === sig) return false;
  const premier = cible._sig === undefined;
  const avant = premier || mouvementCoupe() ? null : releverValeurs(cible);
  cible.innerHTML = html;
  cible._sig = sig;
  cible.classList.toggle('gr-maj', !premier);
  if (avant) animerDepuis(cible, avant);
  return true;
}

/**
 * Les tuiles, une par une. Remplacer la rangée entière faisait rouler les six
 * compteurs dès qu'UN changeait : on ne voyait plus lequel.
 */
function poserTuiles(cible, tuiles) {
  if (!cible) return;
  const sigs = tuiles.map(neutre);
  if (!cible._sigs || cible.children.length !== tuiles.length) {
    cible.innerHTML = tuiles.join('');
    cible._sigs = sigs;
    return;
  }
  sigs.forEach((sig, i) => {
    if (cible._sigs[i] === sig) return;
    cible._sigs[i] = sig;
    const t = document.createElement('template');
    t.innerHTML = tuiles[i].trim();
    const neuve = t.content.firstElementChild;
    neuve.classList.add('stat-maj');
    cible.children[i].replaceWith(neuve);
  });
}

// ══════════════════════════════════════════ TUILES

/** Tuile de statistique : icône, valeur qui roule, delta, micro-courbe. */
function tuile({ ic, valeur, unite = '', libelle, teinte, delta, serie, note }) {
  // Le delta porte une FLÈCHE dessinée et un signe : « ▲ 4 » laissait deviner
  // si 4 était un total ou un écart. « +4 vs sem. dernière » ne laisse rien
  // à deviner.
  const fleche = delta === undefined ? '' : `<div class="delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'plat'}">
      <span class="delta-ic">${icone('fleche', 11)}</span>${delta > 0 ? '+' : ''}${delta}
      ${note ? `<span class="delta-note">${echapper(note)}</span>` : ''}</div>`;

  return `<div class="stat" ${teinte ? `style="--teinte:${teinte}"` : ''}>
    <span class="stat-ic" aria-hidden="true">${icone(ic, 15)}</span>
    <div class="n" data-roule="${valeur}" data-suffixe="${echapper(unite)}">${valeur}${unite ? `<span class="u">${unite}</span>` : ''}</div>
    <div class="l">${echapper(libelle)}</div>
    ${fleche}
    ${serie ? `<div class="spark-slot">${sparkline(serie, { couleur: teinte ?? 'var(--accent)' })}</div>` : ''}
  </div>`;
}

// ══════════════════════════════════════════ TABLEAU DE BORD

export function rendreDashboard(stats, offres, meta, options = {}) {
  const { periode = '30' } = options;
  const s = stats.resume;
  const p = stats.performance;

  const sous = document.getElementById('dashSub');
  if (sous) sous.textContent = `${s.total} offres suivies · ${s.actionnables} actionnables · ${s.envoyees} envoyées`;

  rendreHero(stats, offres, meta);

  // ─── Tuiles principales
  const envois30 = stats.serie90.slice(-30).map(j => j.envois);
  const actions30 = stats.serie90.slice(-30).map(j => j.actions);
  const aujourdhui = stats.aujourdhui ?? todayISO();
  const relancesDues = offres.filter(o => o.suivi.relance && o.suivi.relance <= aujourdhui
    && o.suivi.status !== 'Refus' && o.suivi.status !== 'Entretien').length;
  const fraiches = offres.filter(o => o.dateOffre && joursDepuis(o.dateOffre) <= 7).length;

  poserTuiles(document.getElementById('stats'), [
    tuile({ ic: 'liste', valeur: s.total, libelle: 'Offres suivies', teinte: 'var(--accent)' }),
    tuile({ ic: 'cible', valeur: s.actionnables, libelle: 'Actionnables maintenant', teinte: 'var(--g1)' }),
    tuile({
      ic: 'envoi', valeur: s.envoyees, libelle: 'Candidatures envoyées', teinte: 'var(--info)',
      delta: p.tendance, note: 'vs sem. dernière', serie: envois30,
    }),
    tuile({ ic: 'poignee', valeur: s.entretiens, libelle: 'Entretiens décrochés', teinte: 'var(--g2)' }),
    tuile({ ic: 'cloche', valeur: relancesDues, libelle: 'Relances à faire', teinte: 'var(--hot)' }),
    tuile({ ic: 'flamme', valeur: fraiches, libelle: 'Offres fraîches (≤ 7 j)', teinte: 'var(--pink)', serie: actions30 }),
  ]);

  // ─── Entonnoir + anneau
  poserGraphique(document.getElementById('dashAnneau'), anneau(p.tauxCandidature, {
    taille: 132, libelle: 'envoyées', valeur: p.tauxCandidature + '%',
  }));

  const parStatut = Object.fromEntries(stats.parStatut.map(x => [x.statut, x.n]));
  poserGraphique(document.getElementById('funnel'), entonnoir(
    STATUSES.map(st => ({ etiquette: st, valeur: parStatut[st] ?? 0, couleur: STATUS_COL[st] }))
  ));

  // ─── Performance : deux jauges + quatre chiffres
  poserGraphique(document.getElementById('perfJauges'), [
    jauge(p.tauxReponse, { valeur: p.tauxReponse + '%', libelle: 'taux de réponse' }),
    jauge(p.tauxEntretien, { valeur: p.tauxEntretien + '%', libelle: 'taux d\'entretien' }),
  ].join(''));

  poserTuiles(document.getElementById('perf'), [
    tuile({ ic: 'info', valeur: s.reponses, libelle: `Réponses sur ${s.envoyees} envoi${s.envoyees > 1 ? 's' : ''}`, teinte: 'var(--info)' }),
    tuile({ ic: 'horloge', valeur: p.delaiMoyen, unite: ' j', libelle: 'Attente moyenne', teinte: 'var(--g2)' }),
    tuile({ ic: 'vent', valeur: s.sansReponse, libelle: 'Sans réponse à ce jour', teinte: 'var(--g0)' }),
    tuile({ ic: 'plume', valeur: s.avecLettre, libelle: 'Lettres rédigées', teinte: 'var(--accent2)' }),
  ]);

  // ─── Courbe de rythme
  rendreCourbe(stats, periode);

  // ─── Calendrier d'assiduité
  const joursActifs = stats.heatmap.filter(j => j.actions > 0).length;
  const heatSub = document.getElementById('heatSub');
  if (heatSub) heatSub.textContent = `${pluriel(joursActifs, 'jour actif', 'jours actifs')} sur les 6 derniers mois`;
  poserGraphique(document.getElementById('heat'), heatmap(stats.heatmap));

  // ─── Villes
  poserGraphique(document.getElementById('citybars'), barresH(
    stats.parVille.map(v => ({ etiquette: v.ville, valeur: v.n, secondaire: v.envoyees })),
    { unite: ' offre(s)' }
  ) + (stats.parVille.length
    ? '<p class="note-panel">La zone claire à l\'intérieur de chaque barre marque les offres auxquelles tu as postulé.</p>'
    : ''));

  // ─── Sources : la légende est cliquable (`jc:filtre`, écouté par app.js).
  poserGraphique(document.getElementById('sourceDonut'), donut(
    stats.parSource.map((x, i) => ({
      etiquette: SOURCE_LABEL[x.source] ?? x.source,
      valeur: x.n,
      couleur: PALETTE[i % PALETTE.length],
      cle: x.source,
    })),
    { centre: String(s.total), sousCentre: 'offres', filtre: 'source' }
  ) + (stats.parSource.length
    ? '<p class="note-panel">Clique une source pour voir ses offres.</p>' : ''));

  rendreConversion(stats.parSource);
  rendreIndicateurMaj(meta);

  organiserOnglets();
  activerGraphiques(document.getElementById('view-dashboard'));
}

// ══════════════════════════════════════════ LE HÉROS

let horloge = null;

/**
 * Le haut du tableau de bord : ce qu'on vient chercher en l'ouvrant.
 *
 * Avant lui, la première chose visible était « Les 3 du jour » — utile, mais
 * qui dit quoi faire sans dire OÙ L'ON EN EST. L'objectif de la semaine
 * n'existait que dans une pastille du bandeau ; la série, nulle part ; le
 * prochain entretien, perdu dans la file « À faire ». Ici, la hiérarchie est
 * nette : un grand anneau (l'objectif), trois cartes (la régularité,
 * l'échéance, la fraîcheur des données), et seulement ensuite les actions.
 *
 * Exportée : le chantier socle la rappelle quand une candidature part, pour
 * que l'anneau progresse en direct sans attendre un rendu complet.
 */
export function rendreHero(stats, offres, meta) {
  const cible = document.getElementById('dashHero');
  if (!cible || !stats) return;

  const aujourdhui = stats.aujourdhui ?? todayISO();
  const objectif = Math.max(1, Math.round(Number(meta?.objectifHebdo) || 5));
  const fait = Number(stats.performance?.envoisSemaine) || 0;
  const tendance = Number(stats.performance?.tendance) || 0;
  const atteint = fait >= objectif;
  const reste = Math.max(0, objectif - fait);
  const semaine = joursSemaine(stats.serie90, stats.lundi ?? aujourdhui, aujourdhui);
  const serie = serieJours(stats.serie90, aujourdhui);
  const entretien = prochainEntretien(offres, aujourdhui);

  const html = `<section class="hero${atteint ? ' atteint' : ''}" aria-label="Ta semaine">
    <div class="hero-objectif">
      ${anneauObjectif(fait, objectif)}
      <div class="hero-obj-texte">
        <div class="hero-surtitre">${icone('cible', 13)} Objectif de la semaine</div>
        <p class="hero-phrase">${atteint
          ? `<b>Objectif atteint.</b> ${fait > objectif ? `${fait - objectif} de plus que prévu — ` : ''}tout ce qui suit est du bonus.`
          : fait === 0
            ? `<b>${pluriel(objectif, 'candidature')}</b> à envoyer cette semaine. La première est la plus dure.`
            : `Encore <b>${pluriel(reste, 'candidature')}</b> pour l'atteindre.`}</p>
        ${tendance !== 0 || fait ? `<div class="delta ${tendance > 0 ? 'up' : tendance < 0 ? 'down' : 'plat'}">
          <span class="delta-ic">${icone('fleche', 11)}</span>${tendance > 0 ? '+' : ''}${tendance}
          <span class="delta-note">vs semaine dernière</span></div>` : ''}
        <div class="hero-semaine" aria-label="Envois de la semaine, jour par jour">
          ${(() => {
            const max = Math.max(1, ...semaine.map(j => j.envois));
            return semaine.map(j => `<div class="hero-jour${j.futur ? ' futur' : ''}${j.aujourdhui ? ' auj' : ''}"
                title="${echapper(dateLisible(j.jour + 'T12:00:00'))} — ${pluriel(j.envois, 'envoi')}">
              <span class="hj-barre"><i style="height:${j.envois ? Math.max(12, j.envois / max * 100) : 0}%"></i></span>
              <span class="hj-l">${j.initiale}</span></div>`).join('');
          })()}
        </div>
      </div>
    </div>

    <div class="hero-cartes">
      <article class="hero-carte hc-serie${serie.aujourdhuiFait ? ' vive' : ''}">
        <div class="hc-tete">${icone('flamme', 14)} Série</div>
        <div class="hc-valeur"><b data-roule="${serie.jours}">${serie.jours}</b>
          <span>jour${serie.jours > 1 ? 's' : ''} d'affilée</span></div>
        <div class="hc-points" aria-hidden="true">${serie.derniers.map(j =>
          `<i class="${j.actif ? 'on' : ''}${j.aujourdhui ? ' auj' : ''}" title="${j.jour}"></i>`).join('')}</div>
        <div class="hc-sous">${serie.aujourdhuiFait
          ? 'Aujourd\'hui compte déjà.'
          : serie.jours ? 'Une action aujourd\'hui la prolonge.' : 'Une action aujourd\'hui la lance.'}</div>
      </article>

      <article class="hero-carte hc-entretien${entretien ? (entretien.jours <= 2 ? ' proche' : '') : ' vide'}">
        <div class="hc-tete">${icone('poignee', 14)} Prochain entretien</div>
        ${entretien ? `
          <div class="hc-valeur"><b>${entretien.jours === 0 ? 'Jour J' : `J-${entretien.jours}`}</b>
            <span>${echapper(dateLisible(entretien.date + 'T12:00:00'))}</span></div>
          <div class="hc-titre" title="${echapper(entretien.offre.titre)}">${echapper(entretien.offre.titre)}</div>
          <div class="hc-sous"><span data-rebours="${entretien.date}"></span>${entretien.offre.entreprise
            ? ` · ${echapper(entretien.offre.entreprise)}` : ''}</div>`
        : `
          <div class="hc-valeur"><b class="hc-rien">—</b><span>rien de planifié</span></div>
          <div class="hc-sous">Une convocation ? Note sa date sur l'offre : le compte à rebours s'affichera ici.</div>`}
      </article>

      ${carteCollecte(meta)}
    </div>
  </section>`;

  poserGraphique(cible, html);
  majHorloges(cible);
  if (!horloge && typeof window !== 'undefined') {
    // Une minute de précision suffit à un compte à rebours en jours et heures.
    // L'onglet caché ne compte pas : `majHorloges` sort aussitôt.
    horloge = setInterval(() => majHorloges(document.getElementById('dashHero')), 30000);
  }
}

/**
 * L'anneau d'objectif : segmenté (un cran par candidature) tant que
 * l'objectif est petit, continu au-delà. Les crans font COMPTER : 3 sur 5 se
 * voit sans lire le chiffre. Le dégradé est masqué par les mêmes crans que la
 * piste, pour que le plein et le vide aient la même découpe.
 */
function anneauObjectif(fait, objectif) {
  const taille = 188, ep = 14, rayon = (taille - ep) / 2 - 4, c = taille / 2;
  const tour = 2 * Math.PI * rayon;
  const ratio = Math.min(1, fait / objectif);
  const segmente = objectif <= 14;
  const ecart = segmente ? 5 : 0;
  const cran = segmente ? tour / objectif - ecart : tour;
  const motif = segmente ? `stroke-dasharray="${cran.toFixed(2)} ${ecart}"` : '';
  const id = `hero-${++anneauObjectif.n}`;
  const offset = (tour * (1 - ratio)).toFixed(2);

  return `<div class="hero-anneau" role="img"
      aria-label="${pluriel(fait, 'candidature envoyée', 'candidatures envoyées')} sur un objectif de ${objectif}">
    <svg viewBox="0 0 ${taille} ${taille}" aria-hidden="true">
      <defs>
        <linearGradient id="${id}-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="var(--accent)"/><stop offset="100%" stop-color="var(--accent2)"/>
        </linearGradient>
        <mask id="${id}-m"><circle cx="${c}" cy="${c}" r="${rayon}" fill="none" stroke="#fff" stroke-width="${ep + 2}"
          ${motif} transform="rotate(-90 ${c} ${c})"/></mask>
      </defs>
      <circle class="hero-piste" cx="${c}" cy="${c}" r="${rayon}" fill="none" stroke-width="${ep}"
        ${motif} transform="rotate(-90 ${c} ${c})"/>
      <g mask="url(#${id}-m)">
        <circle class="arc hero-arc" cx="${c}" cy="${c}" r="${rayon}" fill="none" stroke="url(#${id}-g)"
          stroke-width="${ep}" stroke-dasharray="${tour.toFixed(2)}" stroke-dashoffset="${offset}"
          style="--vide:${tour.toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>
      </g>
    </svg>
    <div class="hero-centre">
      <div class="hero-compte"><b data-roule="${fait}">${fait}</b><span>/ ${objectif}</span></div>
      <small>envoyée${fait > 1 ? 's' : ''} cette semaine</small>
    </div>
  </div>`;
}
anneauObjectif.n = 0;

function carteCollecte(meta) {
  const derniere = meta?.derniereCollecte;
  const r = meta?.resume;
  let etat = 'ok', libelle = 'À jour';
  if (meta?.collecteEnCours) { etat = 'cours'; libelle = 'En cours'; }
  else if (!derniere) { etat = 'warn'; libelle = 'Jamais lancée'; }
  else if (meta.statut === 'echec') { etat = 'stale'; libelle = 'En échec'; }
  else if (meta.statut === 'partiel') { etat = 'warn'; libelle = 'Partielle'; }
  else if (meta.statut === 'non-configure') { etat = 'warn'; libelle = 'Non configurée'; }
  else if (joursDepuis(derniere) >= 3) { etat = 'stale'; libelle = 'Périmée'; }

  return `<article class="hero-carte hc-collecte etat-${etat}">
    <div class="hc-tete">${icone('globe', 14)} Dernière collecte</div>
    <div class="hc-valeur"><b>${derniere ? `<span data-depuis="${echapper(derniere)}"></span>` : '—'}</b></div>
    <div class="hc-etat"><i></i>${libelle}</div>
    <div class="hc-sous">${r && derniere
      ? `${pluriel(r.retenues ?? 0, 'offre retenue', 'offres retenues')} · ${pluriel(r.nouvelles ?? 0, 'nouvelle')}`
      : 'Lance une collecte pour remplir le radar.'}</div>
  </article>`;
}

/** Les textes qui dépendent de l'heure : remplis ici, hors du HTML comparé. */
function majHorloges(racine) {
  if (!racine || (typeof document !== 'undefined' && document.hidden)) return;
  racine.querySelectorAll('[data-rebours]').forEach(el => {
    const r = rebours(el.dataset.rebours);
    el.textContent = r ? r.texte : '';
  });
  racine.querySelectorAll('[data-depuis]').forEach(el => {
    const t = ilYA(el.dataset.depuis);
    el.textContent = t ? t.charAt(0).toUpperCase() + t.slice(1) : '—';
  });
}

/**
 * LA CONVERSION PAR SOURCE — ce qui manquait, et qui répond à « qu'est-ce qui
 * marche ». Le donut dit d'où viennent les OFFRES ; ce tableau dit d'où
 * viennent les RÉPONSES. Une source qui déverse mille annonces sans aboutir
 * vaut moins qu'un flux qui en donne dix dont trois répondent.
 *
 * Tant qu'on a peu postulé, la colonne « réponses » reste vide et le dit :
 * mieux vaut « pas encore » qu'un taux calculé sur deux candidatures.
 */
function rendreConversion(parSource) {
  const cible = document.getElementById('conversionSources');
  if (!cible) return;

  const total = parSource.reduce((t, x) => t + x.envoyees, 0);
  if (!total) {
    poserGraphique(cible, '<p class="note-panel">Tu n\'as pas encore assez postulé pour '
      + 'que la conversion parle. Elle se remplira à mesure que les réponses arrivent.</p>');
    return;
  }

  const lignes = parSource.filter(x => x.envoyees > 0)
    .sort((a, b) => b.reponses - a.reponses || b.envoyees - a.envoyees)
    .map(x => {
      const taux = x.envoyees ? Math.round(x.reponses / x.envoyees * 100) : 0;
      return `<tr>
        <td>${echapper(SOURCE_LABEL[x.source] ?? x.source)}</td>
        <td class="num">${x.n}</td>
        <td class="num">${x.envoyees}</td>
        <td class="num">${x.reponses || '—'}</td>
        <td class="num">${x.entretiens || '—'}</td>
        <td class="num conv-taux ${taux >= 25 ? 'bon' : ''}">${x.reponses ? taux + ' %' : '—'}</td>
      </tr>`;
    }).join('');

  poserGraphique(cible, `<div class="conv-defile"><table class="conv-table">
    <thead><tr><th>Source</th><th class="num">Collectées</th><th class="num">Envoyées</th>
      <th class="num">Réponses</th><th class="num">Entretiens</th><th class="num">Taux</th></tr></thead>
    <tbody>${lignes}</tbody>
  </table></div>
  <p class="note-panel">« Réponse » = entretien ou refus (l'employeur s'est manifesté).
    Le taux ne s'affiche qu'une fois une réponse reçue.</p>`);
}

// ══════════════════════════════════════════ LA COURBE DE RYTHME

const LEGENDE_COURBE = {
  jours: 'Toutes tes actions du jour — candidatures, relances, lettres, notes',
  semaines: 'Candidatures envoyées, semaine par semaine',
};

/**
 * Courbe de rythme, selon la période choisie dans le sélecteur segmenté.
 *
 * Les trois périodes sont désormais TROIS COURBES (les semaines étaient des
 * barres) : c'est ce qui permet de passer de l'une à l'autre en déformant le
 * tracé au lieu de le remplacer. Basculer de 30 à 90 jours montre la même
 * activité qui se tasse vers la droite — on comprend que c'est un zoom
 * arrière, pas un autre graphique.
 */
export function rendreCourbe(stats, periode) {
  const cible = document.getElementById('courbeRythme');
  if (!cible) return;

  const semaines = periode === 'semaines';
  const points = semaines
    ? stats.semaines.map(s => ({ etiquette: `Semaine du ${dateLisible(s.lundi + 'T12:00:00')}`, court: courtISO(s.lundi), valeur: s.envois }))
    : stats.serie90.slice(-Number(periode || 30))
      .map(j => ({ etiquette: dateLisible(j.jour + 'T12:00:00'), court: courtISO(j.jour), valeur: j.actions }));

  const sig = `${periode}|${points.map(p => p.valeur).join(',')}|${points[0]?.court ?? ''}`;
  if (cible.dataset.sig === sig) return;
  cible.dataset.sig = sig;

  const ancienne = cible.querySelector('.gr-aire');
  const ancienNorm = ancienne ? normDe(ancienne) : null;
  if (ancienne?._morph) cancelAnimationFrame(ancienne._morph);

  cible.innerHTML = aire(points, {
    hauteur: 200,
    unite: semaines ? ' candidature(s)' : ' action(s)',
    marqueurs: semaines,
    libelle: semaines ? 'Candidatures par semaine' : `Actions sur ${points.length} jours`,
  }) + `<ul class="gr-legende en-ligne" style="margin-top:var(--e3)">
      <li><i style="background:var(--accent)"></i><span>${semaines ? LEGENDE_COURBE.semaines : LEGENDE_COURBE.jours}</span></li>
    </ul>`;

  const nouvelle = cible.querySelector('.gr-aire');
  if (ancienNorm && nouvelle && !mouvementCoupe()) morpher(nouvelle, ancienNorm);
  activerGraphiques(document.getElementById('view-dashboard'));
}

/** Valeurs normalisées (0–1) lues dans le balisage d'une courbe. */
function normDe(aireEl) {
  const max = Number(aireEl.dataset.max) || 1;
  return lireSerie(aireEl).map(p => p.v / max);
}

/**
 * LE MORPH. L'ancienne forme est rééchantillonnée sur la grille de la
 * nouvelle, puis chaque point glisse vers sa valeur, image par image. Le
 * tracé est recalculé par `cheminCourbe` — la même fonction qu'`aire()` —
 * pour que la dernière image soit exactement la courbe posée.
 *
 * Coût : 90 points × une chaîne de chemin par image, pendant 600 ms. Rien
 * n'est lu dans la mise en page.
 */
function morpher(aireEl, ancien) {
  const nouveau = normDe(aireEl);
  const depart = reechantillonner(ancien, nouveau.length);
  const trace = aireEl.querySelector('.trace');
  const surface = aireEl.querySelector('.surface');
  if (!trace) return;
  // `sans-entree` reste posée : la retirer à la fin relancerait la
  // révélation CSS de la courbe (changer `animation` redémarre l'animation).
  aireEl.classList.add('sans-entree', 'gr-morph');
  const t0 = performance.now();
  const duree = 620;
  const etape = (t) => {
    const k = Math.min(1, (t - t0) / duree);
    const e = 1 - (1 - k) ** 3;
    const v = nouveau.map((n, i) => depart[i] + (n - depart[i]) * e);
    const c = cheminCourbe(v);
    trace.setAttribute('d', c.trace);
    surface?.setAttribute('d', c.surface);
    if (k < 1 && aireEl.isConnected) aireEl._morph = requestAnimationFrame(etape);
    else aireEl.classList.remove('gr-morph');
  };
  aireEl._morph = requestAnimationFrame(etape);
}

// ══════════════════════════════════════════ INTERACTIVITÉ

function lireSerie(aireEl) {
  if (!aireEl._serie) {
    try { aireEl._serie = JSON.parse(aireEl.dataset.serie || '[]'); } catch { aireEl._serie = []; }
  }
  return aireEl._serie;
}

/**
 * Place le réticule, le point et l'info-bulle sur le i-ème point.
 * Une seule lecture de géométrie (la boîte du tracé), puis des écritures de
 * `transform` seulement : rien qui force à recalculer la page.
 */
function montrerPoint(aireEl, i, boite) {
  const serie = lireSerie(aireEl);
  if (!serie.length) return;
  const plot = aireEl.querySelector('.gr-aire-plot');
  const r = boite ?? plot.getBoundingClientRect();
  i = Math.max(0, Math.min(serie.length - 1, i));
  const p = serie[i];
  const max = Number(aireEl.dataset.max) || 1;
  const x = serie.length === 1 ? r.width / 2 : i / (serie.length - 1) * r.width;
  const y = r.height - (p.v / max) * r.height * (1 - MARGE_COURBE);

  plot.querySelector('.gr-aire-ligne').style.transform = `translateX(${x.toFixed(1)}px)`;
  plot.querySelector('.gr-aire-curseur').style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  const bulle = plot.querySelector('.gr-bulle');
  if (aireEl._i !== i) {
    aireEl._i = i;
    bulle.innerHTML = `<b>${p.v}${echapper(aireEl.dataset.unite ?? '')}</b><span>${echapper(p.e)}</span>`;
  }
  // L'info-bulle passe à GAUCHE du point dans le dernier tiers : à droite,
  // elle sortirait du panneau.
  const aGauche = x > r.width * 0.64;
  const haut = Math.max(0, Math.min(r.height - 40, y - 46));
  bulle.style.transform = aGauche
    ? `translate(calc(${x.toFixed(1)}px - 100% - 12px), ${haut.toFixed(1)}px)`
    : `translate(${(x + 12).toFixed(1)}px, ${haut.toFixed(1)}px)`;
  aireEl.classList.add('survol');
}

function cacherPoint(aireEl) {
  if (!aireEl) return;
  aireEl.classList.remove('survol');
  aireEl._i = undefined;
}

function surlignerDonut(wrap, cle) {
  wrap.classList.toggle('a-cible', cle !== null);
  wrap.querySelectorAll('[data-cle]').forEach(el => el.classList.toggle('actif', el.dataset.cle === cle));
}

function emettreFiltre(wrap, el) {
  const champ = wrap.dataset.filtre || 'source';
  document.dispatchEvent(new CustomEvent('jc:filtre', { detail: { [champ]: el.dataset.cle } }));
  if (!mouvementCoupe()) {
    el.animate([{ transform: 'scale(1)' }, { transform: 'scale(.96)' }, { transform: 'scale(1)' }],
      { duration: 220, easing: 'ease-out' });
  }
}

const activees = new WeakSet();

/**
 * Branche l'interactivité des graphiques sous `racine`, PAR DÉLÉGATION.
 *
 * Les graphiques sont des chaînes réécrites à chaque mise à jour : un
 * écouteur posé sur un `<svg>` partirait avec lui. Ici, une poignée
 * d'écouteurs sur la racine servent tous les graphiques, présents et à venir.
 * Appeler la fonction deux fois sur la même racine ne double rien.
 *
 * · courbe en aire : réticule + info-bulle qui suivent la souris ou le doigt
 *   (`touch-action: pan-y` laisse défiler la page à la verticale), et les
 *   flèches du clavier quand elle a le focus ;
 * · donut : survol d'une part ou d'une ligne de légende = mise en avant ;
 *   clic ou Entrée = `jc:filtre` `{ source }`.
 */
export function activerGraphiques(racine = typeof document !== 'undefined' ? document : null) {
  if (!racine || activees.has(racine)) return;
  activees.add(racine);

  racine.addEventListener('pointermove', e => {
    const plot = e.target.closest?.('.gr-aire-plot');
    if (!plot) return;
    const aireEl = plot.closest('.gr-aire');
    const r = plot.getBoundingClientRect();
    const n = lireSerie(aireEl).length;
    const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    montrerPoint(aireEl, n <= 1 ? 0 : Math.round(t * (n - 1)), r);
  }, { passive: true });

  racine.addEventListener('pointerout', e => {
    const plot = e.target.closest?.('.gr-aire-plot');
    if (plot && !plot.contains(e.relatedTarget)) cacherPoint(plot.closest('.gr-aire'));
    const wrap = e.target.closest?.('.gr-donut-wrap');
    if (wrap && !wrap.contains(e.relatedTarget)) surlignerDonut(wrap, null);
  });

  racine.addEventListener('pointerover', e => {
    const el = e.target.closest?.('.gr-donut-wrap [data-cle]');
    if (el) surlignerDonut(el.closest('.gr-donut-wrap'), el.dataset.cle);
  });

  racine.addEventListener('click', e => {
    const el = e.target.closest?.('.gr-donut-wrap.cliquable [data-cle]');
    if (el) emettreFiltre(el.closest('.gr-donut-wrap'), el);
  });

  racine.addEventListener('keydown', e => {
    const cle = e.target.closest?.('.gr-donut-wrap.cliquable li[data-cle]');
    if (cle && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      emettreFiltre(cle.closest('.gr-donut-wrap'), cle);
      return;
    }
    const aireEl = e.target.classList?.contains('gr-aire') ? e.target : null;
    if (!aireEl) return;
    const n = lireSerie(aireEl).length;
    const i = aireEl._i ?? n - 1;
    const pas = { ArrowLeft: -1, ArrowRight: 1, Home: -n, End: n }[e.key];
    if (pas === undefined) return;
    e.preventDefault();
    montrerPoint(aireEl, i + pas);
  });

  racine.addEventListener('focusin', e => {
    if (e.target.classList?.contains('gr-aire')) montrerPoint(e.target, lireSerie(e.target).length - 1);
    const li = e.target.closest?.('.gr-donut-wrap li[data-cle]');
    if (li) surlignerDonut(li.closest('.gr-donut-wrap'), li.dataset.cle);
  });
  racine.addEventListener('focusout', e => {
    if (e.target.classList?.contains('gr-aire')) cacherPoint(e.target);
    const wrap = e.target.closest?.('.gr-donut-wrap');
    if (wrap && !wrap.contains(e.relatedTarget)) surlignerDonut(wrap, null);
  });
}

// ══════════════════════════════════════════ ANALYSE DÉTAILLÉE EN ONGLETS

/**
 * Huit panneaux empilés sous « Analyse détaillée » : on ouvrait le volet pour
 * une question (« d'où viennent mes offres ? ») et on faisait défiler trois
 * écrans de graphiques sans rapport avant de trouver la réponse. Quatre
 * onglets, chacun une question.
 *
 * Fait par JS, sans toucher à index.html : chaque panneau est rattaché à son
 * onglet par le conteneur qu'il porte. Un panneau inconnu reste visible.
 */
const ONGLETS = [
  { id: 'assiduite', nom: 'Assiduité', ic: 'flamme', ancres: ['heat'] },
  { id: 'sources', nom: 'Villes et sources', ic: 'globe', ancres: ['citybars', 'sourceDonut', 'conversionSources'] },
  { id: 'marche', nom: 'Marché', ic: 'boussole', ancres: ['radarThemes', 'histoScores', 'barresContrat', 'topEntreprises'] },
  { id: 'journal', nom: 'Journal', ic: 'liste', ancres: ['timeline'] },
];
const CLE_ONGLET = 'jc_dash_onglet';

function organiserOnglets() {
  const details = document.getElementById('dashPlus');
  if (!details || details.dataset.onglets) return;

  const blocs = new Map();
  for (const o of ONGLETS) {
    for (const a of o.ancres) {
      const el = document.getElementById(a);
      const bloc = el && [...details.children].find(c => c.tagName !== 'SUMMARY' && c.contains(el));
      if (bloc && !blocs.has(bloc)) blocs.set(bloc, o.id);
    }
  }
  if (!blocs.size) return;
  details.dataset.onglets = '1';

  const presents = ONGLETS.filter(o => [...blocs.values()].includes(o.id));
  const barre = document.createElement('div');
  barre.className = 'dash-onglets';
  barre.setAttribute('role', 'tablist');
  barre.setAttribute('aria-label', 'Analyse détaillée');
  barre.innerHTML = presents.map(o => `<button type="button" role="tab" id="onglet-${o.id}"
      data-onglet="${o.id}" aria-selected="false" tabindex="-1">${icone(o.ic, 14)}<span>${o.nom}</span></button>`).join('')
    + '<span class="dash-onglets-trait" aria-hidden="true"></span>';
  details.querySelector('summary')?.after(barre);

  for (const [bloc, id] of blocs) {
    bloc.dataset.panneau = id;
    bloc.setAttribute('role', 'tabpanel');
    bloc.setAttribute('aria-labelledby', `onglet-${id}`);
  }

  barre.addEventListener('click', e => {
    const b = e.target.closest('[data-onglet]');
    if (b) choisirOnglet(details, b.dataset.onglet, true);
  });
  barre.addEventListener('keydown', e => {
    const tabs = [...barre.querySelectorAll('[data-onglet]')];
    const i = tabs.indexOf(e.target.closest('[data-onglet]'));
    if (i < 0) return;
    const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    const cible = tabs[(j + tabs.length) % tabs.length];
    choisirOnglet(details, cible.dataset.onglet, true);
    cible.focus();
  });
  // Fermé, le volet n'a pas de géométrie : le trait se place à l'ouverture.
  details.addEventListener('toggle', () => { if (details.open) placerTrait(barre); });

  const memo = lireStockage(CLE_ONGLET, presents[0].id);
  choisirOnglet(details, presents.some(o => o.id === memo) ? memo : presents[0].id, false);
}

function choisirOnglet(details, id, anime) {
  details.querySelectorAll('[data-panneau]').forEach(b => {
    const visible = b.dataset.panneau === id;
    b.hidden = !visible;
    if (visible && anime && !mouvementCoupe()) {
      b.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
        { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
  });
  const barre = details.querySelector('.dash-onglets');
  barre?.querySelectorAll('[data-onglet]').forEach(b => {
    const actif = b.dataset.onglet === id;
    b.setAttribute('aria-selected', actif ? 'true' : 'false');
    b.tabIndex = actif ? 0 : -1;
    b.classList.toggle('active', actif);
  });
  if (barre) placerTrait(barre);
  ecrireStockage(CLE_ONGLET, id);
}

/** Le trait sous l'onglet actif GLISSE d'un onglet à l'autre (une lecture, une écriture). */
function placerTrait(barre) {
  const actif = barre.querySelector('[data-onglet].active');
  const trait = barre.querySelector('.dash-onglets-trait');
  if (!actif || !trait) return;
  const l = actif.offsetLeft, w = actif.offsetWidth;
  if (!w) return;
  trait.style.transform = `translateX(${l}px)`;
  trait.style.width = `${w}px`;
}

/** Indicateur « dernière mise à jour », alimenté par le backend. */
export function rendreIndicateurMaj(meta) {
  const banniere = document.getElementById('veilleBanner');
  const texte = document.getElementById('veilleText');
  if (!banniere) return;
  banniere.classList.remove('stale', 'warn');

  if (!meta?.derniereCollecte) {
    banniere.classList.add('warn');
    texte.innerHTML = `${icone('info', 14)} <strong>Aucune collecte encore effectuée.</strong> Clique sur « Rafraîchir maintenant » pour lancer la première.`;
    return;
  }

  const jours = joursDepuis(meta.derniereCollecte);
  const quand = jours === 0 ? "aujourd'hui" : jours === 1 ? 'hier' : `il y a ${jours} jours`;
  const r = meta.resume;
  const detail = r ? ` — ${r.retenues} offre(s) retenue(s), ${r.nouvelles} nouvelle(s)` : '';

  if (meta.statut === 'non-configure') {
    banniere.classList.add('warn');
    texte.innerHTML = `${icone('reglages', 14)} <strong>Aucune source configurée.</strong> Renseigne au moins une clé d'API dans le fichier <code>.env</code> pour que la collecte trouve des offres.`;
  } else if (meta.statut === 'echec') {
    banniere.classList.add('stale');
    texte.innerHTML = `${icone('croix', 14)} <strong>Dernière collecte en échec</strong> (${quand}). Les offres déjà enregistrées sont intactes.`;
  } else if (meta.statut === 'partiel') {
    banniere.classList.add('warn');
    texte.innerHTML = `${icone('info', 14)} <strong>Collecte partielle</strong> ${quand}${detail}. Source(s) indisponible(s) : ${echapper((r?.sourcesEnEchec ?? []).join(', '))}.`;
  } else if (jours >= 3) {
    banniere.classList.add('stale');
    texte.innerHTML = `${icone('horloge', 14)} <strong>Dernière mise à jour ${quand}</strong> (${dateLisible(meta.derniereCollecte)}). Un rafraîchissement serait utile.`;
  } else {
    texte.innerHTML = `${icone('coche', 14)} <strong>À jour</strong> — dernière collecte ${quand}${detail}.`;
  }
}

// ══════════════════════════════════════════ STATISTIQUES

export function rendreStats(stats, timeline) {
  poserGraphique(document.getElementById('radarThemes'), radar(stats.radar, { taille: 320 }));

  poserGraphique(document.getElementById('histoScores'), barres(
    stats.distributionScores.map(t => ({ etiquette: `score ${t.libelle}`, court: t.libelle, valeur: t.n })),
    { hauteur: 170, couleur: 'var(--accent2)', unite: ' offre(s)' }
  ));

  poserGraphique(document.getElementById('barresContrat'), barresH(
    stats.parContrat.map((c, i) => ({ etiquette: c.contrat, valeur: c.n, couleur: PALETTE[i % PALETTE.length] })),
    { unite: ' offre(s)' }
  ));

  poserGraphique(document.getElementById('topEntreprises'), stats.topEntreprises.length
    ? barresH(stats.topEntreprises.map(e => ({ etiquette: e.entreprise, valeur: e.n })), { unite: ' offre(s)' })
      + '<p class="note-panel">Une entreprise qui publie souvent recrute activement — ou peine à recruter. Les deux méritent un coup d\'œil.</p>'
    : vide('Aucune entreprise n\'a encore publié plusieurs offres'));

  rendreTimeline(timeline);
}

/** Icône de chaque type d'événement du journal — elles remplacent les emoji d'EVENEMENT. */
const ICONE_EVENEMENT = {
  candidature: 'envoi', relance: 'cloche', entretien: 'poignee', refus: 'croix', statut: 'rafraichir',
  lettre: 'plume', retouche: 'plume', note: 'cerveau', ajout: 'loupe', epingle: 'etoile', collecte: 'globe',
};
const TEXTE_EVENEMENT = {
  candidature: 'Candidature envoyée', relance: 'Relance effectuée', entretien: 'Entretien décroché',
  refus: 'Refus enregistré', statut: 'Statut modifié', lettre: 'Lettre rédigée', retouche: 'Lettre retouchée',
  note: 'Note ajoutée', ajout: 'Offre ajoutée', epingle: 'Offre épinglée', collecte: 'Collecte lancée',
};

/** Journal d'activité, groupé par jour. */
export function rendreTimeline(evenements) {
  const zone = document.getElementById('timeline');
  if (!zone) return;

  if (!evenements?.length) {
    poserGraphique(zone, vide('Ton journal se remplira dès ta première action'));
    return;
  }

  let jourCourant = null;
  poserGraphique(zone, evenements.map(e => {
    let entete = '';
    if (e.jour !== jourCourant) {
      jourCourant = e.jour;
      entete = `<div class="tl-jour">${dateLisible(e.jour + 'T12:00:00')}</div>`;
    }
    const sujet = e.titre ? `${e.titre}${e.entreprise ? ` · ${e.entreprise}` : ''}` : '';

    // `cree_le` (et donc « il y a 2 h ») bouge avec l'horloge : on le pose
    // dans un attribut, la comparaison des rendus n'en dépend pas.
    return `${entete}<div class="tl tl-${echapper(e.type)}">
      <span class="tl-em" aria-hidden="true">${icone(ICONE_EVENEMENT[e.type] ?? 'info', 13)}</span>
      <span class="tl-b">
        <span class="tl-t">${echapper(TEXTE_EVENEMENT[e.type] ?? e.type)}</span>
        ${sujet ? `<span class="tl-s">${echapper(sujet)}</span>` : ''}
      </span>
      <span class="tl-q" ${e.cree_le ? `data-depuis-brut="${echapper(e.cree_le)}"` : ''}></span>
    </div>`;
  }).join(''));
  zone.querySelectorAll('[data-depuis-brut]').forEach(el => { el.textContent = ilYA(el.dataset.depuisBrut); });
}

