// LE RADAR DE COLLECTE EN DIRECT.
//
// CE QUI NE MARCHAIT PAS
// ----------------------
// « Collecter » lançait `POST /api/refresh` et ATTENDAIT : une à trois
// minutes d'un bouton figé sur « Collecte… », sans rien d'autre à l'écran.
// On ne savait ni ce qui se passait, ni si quelque chose se passait — une
// source en panne et une source lente se ressemblaient. Pire, recharger la
// page pendant ce temps faisait perdre le fil : la collecte continuait côté
// serveur, mais plus rien ne le disait.
//
// CE QU'IL FAIT
// -------------
// L'ouverture de l'application est un radar qui balaie des offres. La
// collecte EST ce radar, en vrai : chaque source interrogée s'inscrit, chaque
// offre retenue s'allume en un point de la couleur de son groupe, son titre
// défile dans le journal, les analyses Gemini suivent, puis le bilan tombe
// avec ses compteurs en rouleau. L'attente est habitée, et elle renseigne :
// une source en échec se voit en rouge, au moment où elle échoue.
//
// · RÉDUCTIBLE : « Réduire » (ou Échap) range le radar dans une pastille du
//   bandeau, qui garde la progression. La collecte n'a pas à confisquer
//   l'écran — on peut trier pendant ce temps.
// · RACCROCHABLE : au chargement, `collecteEtat` dit si une collecte tourne ;
//   si oui, la pastille réapparaît et le flux reprend. Le serveur REJOUE son
//   journal à chaque connexion (contrat §3.1) : l'événement `debut` remet
//   donc le radar à zéro, et la reprise ne double rien.
// · REPLI : un serveur qui ne connaît pas encore `/api/collecte/demarrer`
//   (404) reçoit l'ancien `POST /api/refresh`. Le radar tourne alors sans
//   détail, et le bilan arrive à la fin — honnêtement annoncé comme tel.
//
// PERFORMANCE
// -----------
// Le serveur émet les offres EN RAFALE à l'écriture : trois cents événements
// dans la même seconde. Les poser un par un dans le DOM, chacun avec sa
// mesure, ferait ramer la page pile au moment où l'on regarde. Ils passent
// donc par une FILE vidée à chaque image, à un débit qui s'adapte : un
// événement isolé s'affiche aussitôt, un arriéré se résorbe en une seconde et
// demie. Le journal est borné (60 lignes), les points aussi (420).

import { API } from './api.js';
import { echapper, pluriel, SOURCE_LABEL } from './format.js';
import { icone } from './icons.js';
import { ouvrirSurcouche, fermerSurcouche } from './surcouche.js';
import { roulement } from './anim.js';
import { sonSucces } from './sons.js';

const MAX_JOURNAL = 60;
const MAX_POINTS = 420;

const ETAPES = [
  ['sources', 'Sources'], ['fusion', 'Fusion'], ['filtrage', 'Filtrage'],
  ['ecriture', 'Écriture'], ['analyse', 'Analyse'], ['nettoyage', 'Nettoyage'],
  ['sauvegarde', 'Sauvegarde'],
];

/** Part de la barre de progression atteinte au DÉBUT de chaque étape. */
const JALONS = { sources: 0, fusion: 0.62, filtrage: 0.67, ecriture: 0.72, analyse: 0.76, nettoyage: 0.95, sauvegarde: 0.98 };

/**
 * Position d'une offre sur le cadran : un angle tiré de son identifiant (la
 * même offre tombe toujours au même endroit) et une distance qui dit sa
 * pertinence — les prioritaires près du centre, les offres à écarter au bord.
 * Pure, exportée pour les tests.
 */
export function placerOffre(id, groupe) {
  let h = 2166136261;
  for (const c of String(id ?? '')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const angle = (h % 3600) / 10;
  const bande = { 1: [8, 22], 2: [22, 34], 0: [33, 42], 3: [40, 46] }[groupe] ?? [33, 42];
  const t = ((h >>> 12) % 1000) / 1000;
  const rayon = bande[0] + (bande[1] - bande[0]) * Math.sqrt(t);
  return {
    angle,
    x: 50 + Math.cos(angle * Math.PI / 180) * rayon,
    y: 50 + Math.sin(angle * Math.PI / 180) * rayon,
  };
}

/**
 * Avancement global, entre 0 et 1, à partir de l'état connu. Pure.
 *
 * Les requêtes aux sources forment l'essentiel du temps : elles portent les
 * six premiers dixièmes. Les étapes suivantes avancent par jalons, et
 * l'analyse — longue, une offre après l'autre — progresse avec son compteur.
 */
export function avancement({ etape = 'sources', faites = 0, attendues = 0, analyse = null, fini = false } = {}) {
  if (fini) return 1;
  if (etape === 'sources') return attendues ? Math.min(0.6, 0.6 * faites / attendues) : 0.03;
  if (etape === 'analyse' && analyse?.total) {
    return JALONS.analyse + (JALONS.nettoyage - JALONS.analyse) * Math.min(1, analyse.i / analyse.total);
  }
  return JALONS[etape] ?? 0.6;
}

/** Un événement lu dans `collecteEtat`, quelle que soit sa forme exacte. */
function lireEvenement(e) {
  if (!e || typeof e !== 'object') return null;
  // Forme du serveur : `{ seq, nom, donnees }` (src/collecte-live.js). Les
  // autres noms sont tolérés : un journal ne doit pas devenir muet pour une
  // clé renommée.
  const nom = e.donnees !== undefined ? e.nom : (e.type ?? e.evenement ?? e.event);
  if (!nom) return null;
  return { nom, data: e.donnees ?? e.data ?? {} };
}

const chrono = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Installe le radar.
 *
 * @param {object} ctx
 * @param {(m: string, t?: string, a?: object) => void} ctx.toast
 * @param {(resume: object) => Promise<void>} ctx.apresCollecte  recharge les données
 * @param {() => void} [ctx.voirOffres]                          ouvre la vue Offres
 */
export function installerCollecte(ctx) {
  // ── Le balisage, une fois pour toutes ─────────────────────────────────
  const ecran = document.createElement('div');
  ecran.className = 'overlay cl';
  ecran.id = 'collecteLive';
  ecran.innerHTML = `
    <div class="cl-fond" aria-hidden="true"><div class="cl-grille"></div></div>
    <header class="cl-tete">
      <div class="cl-titre">
        <span class="cl-voyant" aria-hidden="true"></span>
        <h2 id="clTitre">Collecte en cours</h2>
        <span class="cl-chrono" id="clChrono">00:00</span>
      </div>
      <ol class="cl-etapes" id="clEtapes">${ETAPES.map(([cle, lib]) =>
        `<li data-etape="${cle}"><span class="cl-etape-pt" aria-hidden="true"></span>${lib}</li>`).join('')}</ol>
      <div class="cl-boutons">
        <button type="button" class="cl-bouton" data-cl="reduire" title="Réduire — la collecte continue (Échap)">
          ${icone('chevron-bas', 15)} Réduire</button>
      </div>
    </header>
    <div class="cl-scene">
      <section class="cl-centre">
        <div class="cl-radar" id="clRadar">
          <div class="cl-cercle" style="--taille:32%"></div>
          <div class="cl-cercle" style="--taille:62%"></div>
          <div class="cl-cercle" style="--taille:92%"></div>
          <div class="cl-croix" aria-hidden="true"></div>
          <div class="cl-faisceau" aria-hidden="true"></div>
          <div class="cl-points" id="clPoints" aria-hidden="true"></div>
          <div class="cl-etiquette" id="clEtiquette" aria-hidden="true"></div>
        </div>
        <div class="cl-compteurs">
          <div><b id="clVues">0</b><span>trouvées</span></div>
          <div><b id="clRetenues">0</b><span>retenues</span></div>
          <div><b id="clNouvelles">0</b><span>nouvelles</span></div>
          <div><b id="clAnalyses">0</b><span>analysées</span></div>
        </div>
        <div class="cl-progression" role="progressbar" aria-label="Avancement de la collecte"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="clProgression">
          <div class="cl-barre"><span id="clBarre"></span></div>
          <span class="cl-pc" id="clPc">0 %</span>
        </div>
        <p class="cl-statut" id="clStatut" aria-live="polite">Connexion au serveur…</p>
      </section>
      <aside class="cl-cote">
        <h3>Sources</h3>
        <ul class="cl-sources" id="clSources"></ul>
        <h3>Journal</h3>
        <ol class="cl-journal" id="clJournal"></ol>
      </aside>
    </div>
    <div class="cl-resume" id="clResume" hidden></div>`;
  document.body.appendChild(ecran);

  const $ = (id) => ecran.querySelector('#' + id);
  const pastille = document.getElementById('collectePastille');

  // ── L'état ────────────────────────────────────────────────────────────
  let s = null;           // état de la collecte en cours ou de la dernière
  let flux = null;        // EventSource
  let sondage = 0;        // minuteur du repli par `collecteEtat`
  let horloge = 0;
  const file = [];
  let vidage = 0;

  function etatNeuf(id = null, debut = Date.now()) {
    return {
      id, debut, enCours: true, fini: false, erreur: null,
      etape: 'sources', sources: {}, attenduesParSource: 0, faites: 0, attendues: 0,
      vues: 0, retenues: 0, nouvelles: 0, analyses: 0, analyse: null,
      points: 0, resume: null, repli: false, vusIds: new Set(),
    };
  }

  // ── Le rendu ──────────────────────────────────────────────────────────

  function remettreAZero() {
    $('clPoints').innerHTML = '';
    $('clJournal').innerHTML = '';
    $('clSources').innerHTML = '';
    $('clEtiquette').textContent = '';
    $('clResume').hidden = true;
    $('clResume').innerHTML = '';
    ecran.classList.remove('fini', 'echec');
    ecran.querySelectorAll('[data-etape]').forEach(li => li.classList.remove('fait', 'actif'));
    ['clVues', 'clRetenues', 'clNouvelles', 'clAnalyses'].forEach(id => { $(id).textContent = '0'; });
  }

  function journal(texte, genre = '') {
    const ol = $('clJournal');
    const li = document.createElement('li');
    li.className = 'cl-ligne' + (genre ? ' ' + genre : '');
    li.innerHTML = texte;
    ol.prepend(li);
    while (ol.children.length > MAX_JOURNAL) ol.lastElementChild.remove();
  }

  function majEtapes() {
    const i = ETAPES.findIndex(([c]) => c === s.etape);
    ecran.querySelectorAll('[data-etape]').forEach((li, k) => {
      li.classList.toggle('fait', s.fini || k < i);
      li.classList.toggle('actif', !s.fini && k === i);
    });
  }

  function majProgression() {
    const p = avancement(s);
    const pc = Math.round(p * 100);
    $('clBarre').style.transform = `scaleX(${p})`;
    $('clPc').textContent = `${pc} %`;
    $('clProgression').setAttribute('aria-valuenow', String(pc));
    if (pastille && !pastille.hidden) {
      pastille.style.setProperty('--p', String(p));
      const lib = pastille.querySelector('.clp-texte');
      if (lib) lib.textContent = s.fini
        ? (s.erreur ? 'Collecte interrompue' : `${pluriel(s.nouvelles || s.resume?.nouvelles || 0, 'nouvelle')}`)
        : `Collecte · ${pc} %`;
      pastille.classList.toggle('fini', s.fini);
    }
  }

  function majCompteurs() {
    $('clVues').textContent = s.vues;
    $('clRetenues').textContent = s.retenues;
    $('clNouvelles').textContent = s.nouvelles;
    $('clAnalyses').textContent = s.analyses;
  }

  function ligneSource(nom) {
    let li = $('clSources').querySelector(`[data-source="${CSS.escape(nom)}"]`);
    if (!li) {
      li = document.createElement('li');
      li.dataset.source = nom;
      li.innerHTML = `<span class="cl-src-pt" aria-hidden="true"></span>
        <span class="cl-src-nom">${echapper(SOURCE_LABEL[nom] ?? nom)}</span>
        <span class="cl-src-n"></span>`;
      $('clSources').appendChild(li);
    }
    return li;
  }

  function majSource(nom) {
    const x = s.sources[nom];
    const li = ligneSource(nom);
    li.className = `cl-src ${x.etat}`;
    const total = s.attenduesParSource;
    li.querySelector('.cl-src-n').textContent =
      `${x.trouvees} · ${x.faites}${total ? '/' + total : ''}${x.echecs ? ` · ${x.echecs} échec${x.echecs > 1 ? 's' : ''}` : ''}`;
  }

  let derniereEtiquette = 0;
  function allumer(o) {
    if (s.vusIds.has(o.id)) return false;
    s.vusIds.add(o.id);
    if (o.nouvelle) s.neuves = (s.neuves ?? 0) + 1;
    if (s.points >= MAX_POINTS) return true;
    s.points++;
    const { x, y } = placerOffre(o.id, o.groupe);
    const pt = document.createElement('span');
    pt.className = `cl-point g${o.groupe ?? 0}${o.nouvelle ? ' neuve' : ''}`;
    pt.style.left = `${x.toFixed(2)}%`;
    pt.style.top = `${y.toFixed(2)}%`;
    $('clPoints').appendChild(pt);

    // L'étiquette suit le dernier point, mais pas plus de trois fois par
    // seconde : au-delà, aucun titre ne se lit.
    const maintenant = performance.now();
    if (maintenant - derniereEtiquette > 320) {
      derniereEtiquette = maintenant;
      const e = $('clEtiquette');
      e.textContent = o.titre ?? '';
      e.style.left = `${x.toFixed(1)}%`;
      e.style.top = `${y.toFixed(1)}%`;
      e.classList.toggle('a-gauche', x > 60);
      e.classList.remove('vu'); void e.offsetWidth; e.classList.add('vu');
    }
    return true;
  }

  // ── Les événements ────────────────────────────────────────────────────

  const traiter = {
    debut(d) {
      // Le journal REJOUÉ commence ici : tout repart de zéro, sans doublon.
      s = etatNeuf(d.id ?? s?.id, d.debut ? new Date(d.debut).getTime() : Date.now());
      remettreAZero();
      const sources = d.sources ?? [];
      const intitules = d.intitules?.length || 1;
      const villes = d.villes?.length || 1;
      s.attenduesParSource = intitules * villes;
      s.attendues = sources.length * s.attenduesParSource;
      sources.forEach(nom => { s.sources[nom] = { etat: 'attente', faites: 0, trouvees: 0, echecs: 0 }; majSource(nom); });
      $('clStatut').textContent = sources.length
        ? `${pluriel(sources.length, 'source')} × ${pluriel(intitules, 'intitulé')} × ${pluriel(villes, 'zone')}`
        : 'Interrogation des sources…';
      journal(`${icone('radar', 13)} Départ — ${echapper(sources.map(n => SOURCE_LABEL[n] ?? n).join(', ') || 'sources configurées')}`, 'info');
      majEtapes();
    },
    source(d) {
      const nom = d.nom ?? 'source';
      const x = s.sources[nom] ??= { etat: 'attente', faites: 0, trouvees: 0, echecs: 0 };
      if (d.etat === 'debut') { x.etat = 'actif'; majSource(nom); return; }
      x.faites++;
      s.faites++;
      if (s.faites > s.attendues) s.attendues = s.faites;
      if (d.etat === 'ok') {
        x.trouvees += d.trouvees ?? 0;
        s.vues += d.trouvees ?? 0;
        x.etat = x.echecs ? 'partiel' : 'actif';
        if (d.trouvees) {
          journal(`<b>${echapper(SOURCE_LABEL[nom] ?? nom)}</b> · ${echapper(d.intitule ?? '')}
            · ${echapper(d.ville ?? '')} <span class="cl-n">${d.trouvees}</span>`);
        }
      } else if (d.etat === 'echec') {
        x.echecs++;
        x.etat = 'partiel';
        journal(`${icone('alerte', 13)} <b>${echapper(SOURCE_LABEL[nom] ?? nom)}</b> en échec
          ${d.message ? '— ' + echapper(d.message) : ''}`, 'err');
      } else if (d.etat === 'ignoree') {
        x.etat = 'ignoree';
      }
      if (s.attenduesParSource && x.faites >= s.attenduesParSource && x.etat !== 'ignoree') {
        x.etat = x.echecs ? (x.echecs >= x.faites ? 'echec' : 'partiel') : 'ok';
      }
      majSource(nom);
      majCompteurs();
    },
    etape(d) {
      if (!ETAPES.some(([c]) => c === d.nom)) return;
      s.etape = d.nom;
      // Les sources encore « en cours » ont fini : l'étape suivante l'atteste.
      Object.entries(s.sources).forEach(([nom, x]) => {
        if (x.etat === 'actif' || x.etat === 'attente') { x.etat = x.echecs ? 'partiel' : 'ok'; majSource(nom); }
      });
      const det = d.detail ?? {};
      const textes = {
        fusion: det.distinctes != null ? `Fusion — ${det.brutes ?? '?'} annonces, ${det.distinctes} distinctes` : 'Fusion des doublons',
        filtrage: det.retenues != null ? `Filtrage — ${det.retenues} retenues, ${det.ignorees ?? 0} écartées` : 'Filtrage par le profil',
        ecriture: det.nouvelles != null ? `Écriture — ${pluriel(det.nouvelles, 'nouvelle offre')}` : 'Écriture des offres',
        analyse: det.prevues != null ? `Analyse Gemini — ${pluriel(det.prevues, 'offre')} prévue${det.prevues > 1 ? 's' : ''}` : 'Analyse Gemini',
        nettoyage: det.purgees != null ? `Nettoyage — ${det.purgees} purgée${det.purgees > 1 ? 's' : ''}, ${det.horsProfil ?? 0} hors profil` : 'Nettoyage',
        sauvegarde: 'Sauvegarde de la base',
      };
      if (d.nom === 'filtrage' && det.retenues != null) s.retenues = Math.max(s.retenues, det.retenues);
      if (d.nom === 'ecriture' && det.nouvelles != null) s.nouvelles = Math.max(s.nouvelles, det.nouvelles);
      if (d.nom === 'analyse' && det.prevues != null) s.analyse = { i: 0, total: det.prevues };
      $('clStatut').textContent = textes[d.nom];
      journal(`${icone('chevron', 12)} ${echapper(textes[d.nom])}`, 'etape');
      majEtapes();
      majCompteurs();
    },
    offre(d) {
      if (!allumer(d)) return;
      s.retenues = Math.max(s.retenues, s.vusIds.size);
      s.nouvelles = Math.max(s.nouvelles, s.neuves ?? 0);
      journal(`<i class="cl-pt g${d.groupe ?? 0}" aria-hidden="true"></i>
        <span class="cl-offre">${echapper(d.titre ?? '')}</span>
        <span class="cl-ent">${echapper([d.entreprise, d.ville].filter(Boolean).join(' · '))}</span>
        ${d.nouvelle ? '<span class="cl-neuf">nouvelle</span>' : ''}`, 'offre');
      majCompteurs();
    },
    analyse(d) {
      s.analyses = Math.max(s.analyses, d.i ?? s.analyses + 1);
      s.analyse = { i: d.i ?? s.analyses, total: d.total ?? s.analyse?.total ?? s.analyses };
      $('clStatut').textContent = `Analyse ${s.analyse.i} / ${s.analyse.total} — ${d.titre ?? ''}`;
      journal(`${icone('analyse', 13)} <span class="cl-offre">${echapper(d.titre ?? '')}</span>
        ${d.verdict ? `<span class="cl-verdict">${echapper(String(d.verdict).slice(0, 110))}</span>` : ''}`, 'analyse');
      majCompteurs();
    },
    fin(d) { conclure(d.resume ?? {}); },
    erreur(d) { conclure(null, d.message ?? 'La collecte s\'est interrompue.'); },
  };

  function recevoir(nom, data) {
    file.push({ nom, data });
    if (!vidage) vidage = requestAnimationFrame(vider);
  }

  /**
   * Vide la file à un débit qui s'adapte à l'arriéré : un événement isolé
   * passe à l'image suivante, une rafale de trois cents s'étale sur une
   * seconde et demie — assez pour VOIR les points tomber, pas assez pour
   * faire attendre le bilan.
   */
  function vider() {
    vidage = 0;
    if (!s) s = etatNeuf();
    // Onglet caché : `requestAnimationFrame` y est gelé, et rien ne se voit.
    // On traite tout d'un coup.
    const n = document.hidden ? file.length : Math.max(1, Math.ceil(file.length / 90));
    for (let k = 0; k < n && file.length; k++) {
      const { nom, data } = file.shift();
      try { traiter[nom]?.(data ?? {}); } catch (e) { console.warn('collecte :', nom, e); }
    }
    majProgression();
    if (file.length) vidage = requestAnimationFrame(vider);
  }

  // ── La fin ────────────────────────────────────────────────────────────

  async function conclure(resume, erreur = null) {
    if (!s || s.fini) return;
    s.fini = true;
    s.enCours = false;
    s.erreur = erreur;
    s.resume = resume;
    fermerFlux();
    clearInterval(horloge);
    ecran.classList.add('fini');
    ecran.classList.toggle('echec', Boolean(erreur));
    $('clTitre').textContent = erreur ? 'Collecte interrompue' : 'Collecte terminée';
    $('clStatut').textContent = erreur ?? 'Terminé.';
    if (resume) {
      s.nouvelles = resume.nouvelles ?? s.nouvelles;
      s.analyses = resume.analysees ?? s.analyses;
      s.retenues = resume.retenues ?? s.retenues;
      s.vues = resume.vues ?? s.vues;
    }
    majEtapes();
    majCompteurs();
    majProgression();
    rendreResume();

    try { await ctx.apresCollecte?.(resume); } catch { /* les données restent celles d'avant */ }

    const ouvert = ecran.classList.contains('show');
    if (erreur) {
      ctx.toast(erreur, 'err');
    } else {
      const n = resume?.nouvelles ?? s.nouvelles;
      if (n > 0) sonSucces();
      ctx.toast(`Collecte terminée : ${pluriel(n, 'nouvelle offre')}, ${pluriel(resume?.analysees ?? s.analyses, 'analyse')}.`,
        n > 0 ? 'win' : '', ouvert ? null : { libelle: 'Bilan', faire: () => ouvrir() });
    }
    // La pastille s'efface d'elle-même après un temps : elle a dit ce qu'elle
    // avait à dire, et un bandeau ne garde pas les nouvelles d'hier.
    setTimeout(() => { if (s?.fini && pastille && !ecran.classList.contains('show')) pastille.hidden = true; }, 20000);
  }

  function rendreResume() {
    const z = $('clResume');
    const r = s.resume ?? {};
    if (s.erreur) {
      z.innerHTML = `<div class="cl-bilan echec">
        <div class="cl-bilan-ic">${icone('alerte', 26)}</div>
        <h3>La collecte s'est interrompue</h3>
        <p>${echapper(s.erreur)}</p>
        <p class="cl-bilan-note">Les offres déjà écrites sont gardées : rien n'est perdu de ce qui a été trouvé.</p>
        <div class="cl-bilan-pied"><button type="button" class="btn btn-primary" data-cl="fermer">Fermer</button></div>
      </div>`;
    } else {
      const chiffres = [
        ['nouvelles', r.nouvelles ?? s.nouvelles, 'nouvelles'],
        ['retenues', r.retenues ?? s.retenues, 'retenues'],
        ['analysees', r.analysees ?? s.analyses, 'analysées'],
        ['vues', r.vues ?? s.vues, 'annonces vues'],
      ];
      const second = [
        r.purgees ? `${r.purgees} purgée${r.purgees > 1 ? 's' : ''}` : '',
        r.horsProfil ? `${r.horsProfil} hors profil` : '',
        r.ignorees ? `${r.ignorees} ignorée${r.ignorees > 1 ? 's' : ''}` : '',
      ].filter(Boolean).join(' · ');
      z.innerHTML = `<div class="cl-bilan">
        <div class="cl-bilan-ic">${icone('coche', 26)}</div>
        <h3>${(r.nouvelles ?? s.nouvelles) > 0 ? 'Du neuf sur le radar' : 'Rien de neuf cette fois'}</h3>
        <div class="cl-bilan-chiffres">${chiffres.map(([cle, v, lib]) =>
          `<div class="cl-chiffre ${cle}"><b data-v="${Number(v) || 0}">${Number(v) || 0}</b><span>${lib}</span></div>`).join('')}</div>
        ${second ? `<p class="cl-bilan-note">${second}</p>` : ''}
        ${s.repli ? '<p class="cl-bilan-note">Le détail en direct viendra avec la mise à jour du serveur.</p>' : ''}
        <div class="cl-bilan-pied">
          <button type="button" class="btn" data-cl="fermer">Fermer</button>
          ${(r.nouvelles ?? s.nouvelles) > 0 ? '<button type="button" class="btn btn-primary" data-cl="voir">Voir les offres</button>' : ''}
        </div>
      </div>`;
      // Les chiffres roulent à l'arrivée — `roulement` pose d'abord la valeur
      // juste, et se tait si le mouvement est coupé.
      requestAnimationFrame(() => z.querySelectorAll('b[data-v]').forEach((b, i) =>
        setTimeout(() => roulement(b, b.dataset.v, { duree: 900 }), i * 110)));
    }
    z.hidden = false;
  }

  // ── Les canaux ────────────────────────────────────────────────────────

  function fermerFlux() {
    if (flux) { flux.close(); flux = null; }
    clearInterval(sondage);
    sondage = 0;
  }

  function brancherFlux() {
    fermerFlux();
    let ouvertUneFois = false;
    try { flux = API.collecteFlux(s?.id); } catch { return suivreParEtat(); }
    for (const nom of Object.keys(traiter)) {
      flux.addEventListener(nom, (e) => {
        let data = {};
        try { data = JSON.parse(e.data || '{}'); } catch { /* ligne illisible : ignorée */ }
        recevoir(nom, data);
      });
    }
    flux.onopen = () => {
      ouvertUneFois = true;
      if (s && s.etape === 'sources' && !s.faites) $('clStatut').textContent = 'Interrogation des sources…';
    };
    flux.onerror = () => {
      if (s?.fini) return fermerFlux();
      // Jamais ouvert : le serveur ne sait pas diffuser. On lit l'état à
      // intervalles réguliers, qui porte le même journal.
      if (!ouvertUneFois || flux?.readyState === EventSource.CLOSED) { suivreParEtat(); return; }
      $('clStatut').textContent = 'Connexion perdue — reprise…';
    };
  }

  /** Le repli du flux : relire `collecteEtat` toutes les deux secondes et demie. */
  function suivreParEtat() {
    fermerFlux();
    let lus = 0;
    const tour = async () => {
      try {
        const e = await API.collecteEtat();
        const evts = (e.evenements ?? []).map(lireEvenement).filter(Boolean);
        // Un journal plus court qu'avant : c'est une NOUVELLE collecte, ou un
        // journal tronqué aux 200 derniers. On repart de son début.
        if (evts.length < lus) lus = 0;
        evts.slice(lus).forEach(x => recevoir(x.nom, x.data));
        lus = evts.length;
        if (!e.enCours && !evts.some(x => x.nom === 'fin' || x.nom === 'erreur')) {
          recevoir('fin', { resume: null });
        }
        if (!e.enCours) { clearInterval(sondage); sondage = 0; }
      } catch (err) {
        clearInterval(sondage); sondage = 0;
        recevoir('erreur', { message: err.message });
      }
    };
    tour();
    sondage = setInterval(tour, 2500);
  }

  function demarrerHorloge() {
    clearInterval(horloge);
    const t = () => { if (s) $('clChrono').textContent = chrono(Date.now() - s.debut); };
    t();
    horloge = setInterval(t, 1000);
  }

  // ── Ouvrir, réduire ───────────────────────────────────────────────────

  function ouvrir() {
    if (!s) return;
    if (pastille) pastille.hidden = true;
    ouvrirSurcouche(ecran, {
      focus: ecran.querySelector('[data-cl="reduire"]'),
      titre: 'Collecte en direct',
      // Échap ou « Réduire » : la collecte continue, la pastille la suit.
      surFermeture: () => {
        if (pastille && s) {
          pastille.hidden = false;
          majProgression();
        }
      },
    });
  }
  function reduire() { fermerSurcouche(ecran); }

  ecran.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cl]');
    if (!b) return;
    const quoi = b.dataset.cl;
    if (quoi === 'reduire') reduire();
    if (quoi === 'fermer') { fermerSurcouche(ecran); if (pastille) pastille.hidden = true; }
    if (quoi === 'voir') { fermerSurcouche(ecran); if (pastille) pastille.hidden = true; ctx.voirOffres?.(); }
  });
  pastille?.addEventListener('click', () => ouvrir());

  /**
   * Lance une collecte, ou rouvre celle qui tourne.
   */
  async function lancer() {
    if (s?.enCours) { ouvrir(); return; }
    s = etatNeuf();
    remettreAZero();
    $('clTitre').textContent = 'Collecte en cours';
    $('clStatut').textContent = 'Démarrage…';
    majEtapes();
    majProgression();
    demarrerHorloge();
    ouvrir();

    try {
      const r = await API.collecteDemarrer();
      s.id = r.id ?? null;
      brancherFlux();
    } catch (err) {
      if (err.statut === 409) {
        // Déjà en cours — lancée par le planificateur, ou depuis un autre
        // onglet. On s'y raccroche plutôt que de refuser.
        s.id = err.donnees?.id ?? null;
        journal(`${icone('info', 13)} Une collecte tournait déjà : le radar la suit.`, 'info');
        brancherFlux();
      } else if (err.statut === 404) {
        await collecteSynchrone();
      } else {
        conclure(null, err.message);
      }
    }
  }

  /** L'ancien chemin, pour un serveur qui ne diffuse pas encore. */
  async function collecteSynchrone() {
    s.repli = true;
    ecran.classList.add('repli');
    $('clStatut').textContent = 'Collecte en cours — le détail en direct n\'est pas encore proposé par le serveur.';
    journal(`${icone('info', 13)} Mode compatible : la collecte tourne en un seul appel, le bilan arrive à la fin.`, 'info');
    try {
      const r = await API.rafraichir();
      conclure(r.resume ?? {});
    } catch (err) {
      conclure(null, err.message);
    }
  }

  /**
   * Au chargement : une collecte tourne-t-elle ? Si oui, la pastille revient
   * et le flux reprend — sans ouvrir le radar en grand, qui confisquerait un
   * écran qu'on vient à peine d'ouvrir.
   */
  async function seRaccrocher() {
    let e;
    try { e = await API.collecteEtat(); } catch { return false; }
    if (!e?.enCours) return false;
    s = etatNeuf(e.id ?? null, e.debut ? new Date(e.debut).getTime() : Date.now());
    remettreAZero();
    demarrerHorloge();
    if (pastille) { pastille.hidden = false; majProgression(); }
    brancherFlux();
    return true;
  }

  return { lancer, seRaccrocher, ouvrir, estEnCours: () => Boolean(s?.enCours) };
}
