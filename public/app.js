// Point d'entrée du dashboard : état, navigation, événements.
import { API } from './api.js';
import {
  GM, SOURCE_LABEL, MOIS, JOURS, todayISO, ageOffre, echapper, pluriel,
} from './format.js';
import { poserIcones } from './icons.js';
import {
  rendreCarte, rendreKanban, rendreAgenda, relanceDue, rendreFocus, actionsDuJour, celebrer,
} from './render.js';
import { rendreDashboard, rendreCourbe, rendreStats, rendreIndicateurMaj } from './dashboard.js';
import { rendreCv } from './cv.js';
import { animerCompteurs } from './anim.js';

const dansNJours = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const VUES = ['dashboard', 'offers', 'kanban', 'agenda', 'cv', 'options'];
const THEMES = ['vivid', 'enr', 'dark', 'cockpit'];

/** Onglet fourre-tout : tout ce qui n'est rattaché à aucune ville prioritaire. */
const VILLE_AUTRE = 'autre';

// ------------------------------------------------------------------ options

const OPTIONS_DEFAUT = {
  densite: 'normale', animations: true,
  relanceJours: 7, masquerEcartees: false, mosaique: false,
};

function lireOptions() {
  try { return { ...OPTIONS_DEFAUT, ...JSON.parse(localStorage.getItem('bp_options') ?? '{}') }; }
  catch { return { ...OPTIONS_DEFAUT }; }
}

let options = lireOptions();

function appliquerOptions() {
  document.documentElement.dataset.densite = options.densite;
  document.documentElement.dataset.anim = options.animations ? 'on' : 'off';
  localStorage.setItem('bp_options', JSON.stringify(options));
}
appliquerOptions();

const etat = {
  offres: [],
  meta: null,
  stats: null,
  cv: null,
  timeline: [],
  vue: 'dashboard',
  filtre: 'all',
  // Onglet de ville courant. Conservé d'une session à l'autre : on revient
  // presque toujours sur la même ville, la retrouver soi-même à chaque
  // ouverture est un péage.
  ville: localStorage.getItem('bp_ville') ?? null,
  drapeaux: new Set(),   // filtres secondaires : pin, lettre, frais
  recherche: '',
  tri: 'grp',
  statut: 'all',
  periode: '30',
  ouvertes: new Set(),   // cartes dépliées, à rouvrir après un rafraîchissement
};

// ----------------------------------------------------------------- utilitaires

function toast(message, type = '') {
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = (type === 'err' ? '⚠️ ' : type === 'win' ? '🎉 ' : '✨ ') + message;
  document.getElementById('toastZone').appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity .3s';
    setTimeout(() => t.remove(), 300);
  }, type === 'err' ? 5200 : 2600);
}

/** Enveloppe une action asynchrone : toute erreur devient un toast. */
async function essayer(action, messageSucces) {
  try {
    const r = await action();
    if (messageSucces) toast(messageSucces);
    return r;
  } catch (erreur) {
    toast(erreur.message, 'err');
    return null;
  }
}

// ----------------------------------------------------------------------- thème

function appliquerTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('bp_theme', theme);
  document.querySelectorAll('#themeSwitch button')
    .forEach(b => b.classList.toggle('active', b.dataset.t === theme));
  const select = document.getElementById('optTheme');
  if (select) select.value = theme;
}

appliquerTheme(localStorage.getItem('bp_theme') || 'vivid');

document.getElementById('themeSwitch').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  appliquerTheme(b.dataset.t);
  // Les graphiques lisent les variables CSS à la construction : on redessine.
  rendreTout();
  toast(`Thème « ${b.textContent.trim()} » appliqué`);
});

// ---------------------------------------------------------------------- horloge

function tic() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  document.getElementById('clockTime').textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  document.getElementById('clockDate').textContent =
    `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
}
setInterval(tic, 1000);
tic();

// -------------------------------------------------------------------- données

async function chargerDonnees() {
  const [offres, meta, stats, cv, timeline] = await Promise.all([
    API.offres(), API.meta(), API.stats(), API.cv(), API.timeline(80).catch(() => ({ evenements: [] })),
  ]);
  etat.offres = offres.offres;
  etat.meta = meta;
  etat.stats = stats.stats;
  etat.cv = cv;
  etat.timeline = timeline.evenements ?? [];

  // Un CV absent bloque analyses et lettres : le signaler dans la navigation
  // vaut mieux que de laisser Benjamin découvrir des offres sans verdict.
  const badge = document.getElementById('nb-cv');
  badge.style.display = (!cv.present || cv.perimee) ? '' : 'none';
}

function trouver(id) {
  return etat.offres.find(o => o.id === id);
}

/**
 * Recopie le suivi tel que le serveur le renvoie.
 *
 * On ne se contente pas des champs demandés : repasser une offre à
 * « À postuler » fait aussi effacer sa date d'envoi et sa relance côté
 * serveur, et la carte doit le montrer immédiatement.
 */
function appliquerSuivi(offre, reponse, champsDemandes) {
  Object.assign(offre.suivi, reponse?.suivi ?? champsDemandes ?? {});
}

// ------------------------------------------------------------------ navigation

document.getElementById('nav').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) changerVue(b.dataset.view);
});

document.getElementById('burger').addEventListener('click', () =>
  document.getElementById('sidebar').classList.toggle('open'));

function changerVue(vue) {
  if (!VUES.includes(vue)) return;
  etat.vue = vue;
  document.querySelectorAll('.nav button').forEach(x => x.classList.toggle('active', x.dataset.view === vue));
  VUES.forEach(id => {
    document.getElementById('view-' + id).style.display = id === vue ? 'block' : 'none';
  });
  document.getElementById('sidebar').classList.remove('open');


  rendreTout();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function majBadgesNav() {
  const aPostuler = etat.offres.filter(o =>
    (o.groupe === 1 || o.groupe === 2) && o.suivi.status === 'À postuler').length;
  const relances = etat.offres.filter(relanceDue).length;

  const poser = (id, valeur) => {
    const el = document.getElementById(id);
    el.style.display = valeur ? '' : 'none';
    el.textContent = valeur;
  };

  poser('nb-offers', aPostuler);
  poser('nb-agenda', relances);
}

/** Bandeau de commande : salutation et pastilles de contexte. */
function rendreBandeau() {
  const h = new Date().getHours();
  const salut = h < 6 ? 'Encore debout' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
  document.getElementById('salut').textContent = `${salut}, Benjamin`;

  const actions = actionsDuJour(etat.offres);
  const urgentes = actions.filter(a => a.rang === 0).length;

  document.getElementById('salutSous').textContent = urgentes
    ? `${pluriel(urgentes, 'relance')} en retard — commence par là.`
    : actions.length
      ? `${pluriel(actions.length, 'action')} en attente. Rien d'urgent.`
      : 'Tout est traité. Lance une collecte quand tu veux.';

  const envoyees = etat.stats?.performance?.envoisSemaine ?? 0;
  const objectif = etat.meta?.objectifHebdo ?? 5;

  document.getElementById('cmdPills').innerHTML = [
    `<span class="cpill ${envoyees >= objectif ? 'vert' : ''}"><span class="em">🎯</span> Semaine <b>${envoyees}/${objectif}</b></span>`,
    urgentes ? `<span class="cpill chaud"><span class="em">⏰</span> <b>${urgentes}</b> en retard</span>` : '',
  ].join('');
}

/** Ouvre une offre depuis une autre vue : bascule sur Offres et la déplie. */
function ouvrirOffre(offre) {
  etat.ouvertes.add(offre.id);
  etat.filtre = 'all';
  etat.statut = 'all';
  etat.drapeaux.clear();
  etat.recherche = '';
  document.getElementById('search').value = '';
  document.getElementById('statusFilter').value = 'all';
  document.querySelectorAll('#chips .chip').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('#segGroupe button')
    .forEach(b => b.classList.toggle('active', b.dataset.g === 'all'));

  // Sans cette bascule, une offre lyonnaise ouverte depuis l'agenda resterait
  // invisible tant que l'onglet Strasbourg est actif.
  construireOnglets();
  etat.ville = ongletDe(offre);
  localStorage.setItem('bp_ville', etat.ville);
  document.querySelectorAll('#villes .ville')
    .forEach(b => b.classList.toggle('active', b.dataset.v === etat.ville));

  changerVue('offers');

  requestAnimationFrame(() => {
    const carte = document.querySelector(`.card[data-id="${offre.id}"]`);
    carte?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// ---------------------------------------------------------------- rendu global

function rendreTout() {
  majBadgesNav();
  rendreBandeau();
  poserIcones();

  if (etat.vue === 'options') rendreOptions();
  else if (etat.vue === 'dashboard') {
    rendreFocus(etat.offres, ouvrirOffre);
    if (etat.stats) {
      rendreDashboard(etat.stats, etat.offres, etat.meta, { periode: etat.periode });
      rendreStats(etat.stats, etat.timeline);
    } else rendreIndicateurMaj(etat.meta);
  }
  else if (etat.vue === 'cv') rendreCv(etat.cv);
  else if (etat.vue === 'offers') rendreOffres();
  else if (etat.vue === 'kanban') rendreKanban(etat.offres, deposerKanban);
  else if (etat.vue === 'agenda') rendreAgenda(etat.offres, ouvrirOffre);

  poserIcones();
  // Les rouleaux se lancent une fois le balisage en place : anim.js écrit
  // d'abord la valeur juste, puis anime. Rien ne dépend de l'animation.
  animerCompteurs();
}

const rangGroupe = g => ({ 1: 0, 2: 1, 0: 2, 3: 3 }[g] ?? 4);

/** Les onglets, dans l'ordre : les villes du profil, puis le fourre-tout. */
function villesOnglets() {
  return [...(etat.meta?.villes ?? []), VILLE_AUTRE];
}

/** L'onglet d'une offre. Une ville disparue du profil retombe dans « Autre ». */
function ongletDe(offre) {
  return villesOnglets().includes(offre.villePrio) ? offre.villePrio : VILLE_AUTRE;
}

/**
 * (Re)construit la barre d'onglets d'après le profil servi par /meta.
 * Sans effet tant que la liste des villes ne change pas : reconstruire à
 * chaque rendu perdrait le focus clavier au milieu d'une navigation.
 */
let ongletsRendus = null;

function construireOnglets() {
  const villes = villesOnglets();
  if (villes.join('|') === ongletsRendus) return;
  ongletsRendus = villes.join('|');

  // Première visite : on ouvre sur la ville la mieux fournie plutôt que sur
  // la première du profil. Tomber sur un onglet vide en arrivant donne
  // l'impression que la collecte n'a rien ramené.
  if (!villes.includes(etat.ville)) {
    const compte = Object.fromEntries(villes.map(v => [v, 0]));
    etat.offres.forEach(o => { compte[ongletDe(o)]++; });
    etat.ville = villes.reduce((a, b) => (compte[b] > compte[a] ? b : a), villes[0]);
  }

  const libelle = (v) => (v === VILLE_AUTRE ? 'Autre' : v);

  document.getElementById('villes').innerHTML = villes.map(v => `
    <button class="ville ${v === etat.ville ? 'active' : ''}" data-v="${echapper(v)}"
            title="${v === VILLE_AUTRE ? 'Offres hors des villes prioritaires' : `Offres autour de ${echapper(v)}`}">
      <span class="vv">${echapper(libelle(v))}</span>
      <span class="vn" data-compte="${echapper(v)}">0</span>
    </button>`).join('');
}

function choisirVille(ville) {
  etat.ville = ville;
  localStorage.setItem('bp_ville', ville);
  document.querySelectorAll('#villes .ville')
    .forEach(b => b.classList.toggle('active', b.dataset.v === ville));
  rendreOffres();
}

function rendreOffres() {
  construireOnglets();

  // Filtres de CONTEXTE : ils s'appliquent avant de compter les onglets, pour
  // que « Nancy 3 » veuille bien dire « 3 offres à voir ici, avec ce que tu
  // cherches en ce moment » — et non 3 offres dont aucune ne s'affichera.
  let contexte = etat.offres;
  if (etat.statut !== 'all') contexte = contexte.filter(o => o.suivi.status === etat.statut);
  if (etat.drapeaux.has('pin')) contexte = contexte.filter(o => o.suivi.pinned);
  if (etat.drapeaux.has('lettre')) contexte = contexte.filter(o => o.aLettre);
  if (etat.drapeaux.has('frais')) contexte = contexte.filter(o => {
    const a = ageOffre(o.dateOffre);
    return a !== null && a <= 7;
  });
  if (etat.recherche) {
    const q = etat.recherche.toLowerCase();
    contexte = contexte.filter(o => `${o.titre}${o.entreprise}${o.ville}`.toLowerCase().includes(q));
  }
  // Option « masquer les offres à écarter » — sans effet si on filtre justement dessus.
  if (options.masquerEcartees && etat.filtre !== '3') contexte = contexte.filter(o => o.groupe !== 3);

  // Compteurs d'onglets.
  const parVille = {};
  villesOnglets().forEach(v => { parVille[v] = 0; });
  contexte.forEach(o => { parVille[ongletDe(o)]++; });
  document.querySelectorAll('#villes .vn').forEach(el => {
    el.textContent = parVille[el.dataset.compte] ?? 0;
  });

  // Le classement par groupe décrit la ville affichée, pas la France entière.
  const dansLaVille = contexte.filter(o => ongletDe(o) === etat.ville);
  const compte = { all: dansLaVille.length, 1: 0, 2: 0, 3: 0, 0: 0 };
  dansLaVille.forEach(o => { compte[o.groupe] = (compte[o.groupe] ?? 0) + 1; });
  document.getElementById('c-all').textContent = compte.all;
  ['1', '2', '3', '0'].forEach(g => { document.getElementById('c-' + g).textContent = compte[g]; });

  let liste = dansLaVille.filter(o => etat.filtre === 'all' || String(o.groupe) === etat.filtre);

  if (etat.tri === 'date') liste.sort((a, b) => String(b.dateOffre ?? '').localeCompare(String(a.dateOffre ?? '')));
  else if (etat.tri === 'score') liste.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  else if (etat.tri === 'fresh') liste.sort((a, b) => (ageOffre(a.dateOffre) ?? 999) - (ageOffre(b.dateOffre) ?? 999));
  else if (etat.tri === 'ville') liste.sort((a, b) => String(a.ville).localeCompare(String(b.ville)));
  else if (etat.tri === 'relance') liste.sort((a, b) => (a.suivi.relance || '9999').localeCompare(b.suivi.relance || '9999'));
  else liste.sort((a, b) => rangGroupe(a.groupe) - rangGroupe(b.groupe) || (b.score ?? 0) - (a.score ?? 0));

  // Les épinglées remontent toujours en tête.
  liste.sort((a, b) => (b.suivi.pinned ? 1 : 0) - (a.suivi.pinned ? 1 : 0));

  const ouLibelle = etat.ville === VILLE_AUTRE ? 'hors des villes prioritaires' : `à ${etat.ville}`;
  document.getElementById('offersSub').textContent =
    `${ouLibelle} — ${compte[1]} prioritaires · ${compte[2]} possibles · ${compte[0]} à vérifier`;

  const vide = document.getElementById('empty');
  vide.style.display = liste.length ? 'none' : 'block';
  // Dire QUEL onglet est vide évite de conclure que la collecte n'a rien donné.
  vide.textContent = dansLaVille.length
    ? `Aucune offre ${ouLibelle} avec ce filtre.`
    : `Aucune offre ${ouLibelle} pour l'instant. Regarde les autres onglets.`;
  document.getElementById('count').textContent =
    `${pluriel(liste.length, 'offre')} affichée${liste.length > 1 ? 's' : ''}`;

  const grille = document.getElementById('grid');
  grille.classList.toggle('mosaique', options.mosaique);
  grille.innerHTML = '';
  liste.forEach((offre, i) => {
    const carte = rendreCarte(offre, { brancher: brancherCarte });
    carte.style.animationDelay = Math.min(i * 0.025, 0.5) + 's';
    if (etat.ouvertes.has(offre.id)) carte.classList.add('open');
    grille.appendChild(carte);
  });
}

// ------------------------------------------------------- événements des cartes

function brancherCarte(carte, offre) {
  carte.querySelector('.head').addEventListener('click', e => {
    if (e.target.closest('[data-act="pin"]') || e.target.closest('a') || e.target.closest('[data-act="suppr"]')) return;
    carte.classList.toggle('open');
    if (carte.classList.contains('open')) etat.ouvertes.add(offre.id);
    else etat.ouvertes.delete(offre.id);
  });

  carte.querySelector('[data-act="pin"]')?.addEventListener('click', async e => {
    e.stopPropagation();
    const r = await essayer(() => API.majSuivi(offre.id, { pinned: !offre.suivi.pinned }), null, e.target);
    if (r) { appliquerSuivi(offre, r); rendreTout(); }
  });

  carte.querySelector('[data-act="suppr"]')?.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm('Supprimer cette offre ?')) return;
    const r = await essayer(() => API.supprimerOffre(offre.id), 'Offre supprimée');
    if (r) { await chargerDonnees(); rendreTout(); }
  });

  carte.querySelector('[data-act="postule"]')?.addEventListener('click', async (e) => {
    const versEnvoye = offre.suivi.status === 'À postuler';
    // Revenir à « À postuler », c'est dire « finalement je n'ai pas postulé » :
    // le serveur efface alors la date d'envoi et la relance qui allaient avec.
    const champs = versEnvoye
      ? { status: 'Envoyé', sent: offre.suivi.sent || todayISO() }
      : { status: 'À postuler' };

    // Une candidature envoyée sans relance planifiée finit oubliée :
    // on en propose une automatiquement une semaine plus tard.
    let relanceAjoutee = false;
    if (versEnvoye && !offre.suivi.relance) {
      champs.relance = dansNJours(options.relanceJours);
      relanceAjoutee = true;
    }

    const r = await essayer(() => API.majSuivi(offre.id, champs),
      versEnvoye
        ? (relanceAjoutee ? `Envoyée ✅ — relance planifiée dans ${options.relanceJours} jours` : 'Marqué comme envoyé ✅')
        : 'Remis à « À postuler » — date d\'envoi et relance effacées',
      e.currentTarget);

    if (r) { appliquerSuivi(offre, r, champs); await rafraichirStats(); rendreTout(); }
  });

  carte.querySelectorAll('[data-champ]').forEach(el => {
    el.addEventListener('change', async () => {
      const champ = el.dataset.champ;
      const valeur = el.value;
      const champs = { [champ]: valeur };
      let message = champ === 'status' ? 'Statut : ' + valeur : null;

      // Passage à « Envoyé » depuis la liste déroulante : même logique.
      if (champ === 'status' && valeur === 'Envoyé') {
        if (!offre.suivi.sent) champs.sent = todayISO();
        if (!offre.suivi.relance) {
          champs.relance = dansNJours(options.relanceJours);
          message = `Envoyée ✅ — relance planifiée dans ${options.relanceJours} jours`;
        }
      }

      if (champ === 'status' && valeur === 'À postuler') {
        message = 'Remis à « À postuler » — date d\'envoi et relance effacées';
      }

      const r = await essayer(() => API.majSuivi(offre.id, champs), message, el);
      if (r) {
        appliquerSuivi(offre, r, champs);
        if (champ === 'status' && valeur === 'Entretien') celebrer(60);
        // Le statut change la couleur, la progression et le Kanban : on redessine.
        if (champ === 'status' || champ === 'relance') { await rafraichirStats(); rendreTout(); }
        else { majBadgesNav(); rendreBandeau(); }
      }
    });
  });

  carte.querySelector('[data-act="lettre"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    ouvrirLettre(carte, offre, e.currentTarget);
  });
}

/** Les statistiques sont calculées côté serveur : on les redemande après coup. */
async function rafraichirStats() {
  try {
    const r = await API.stats();
    etat.stats = r.stats;
  } catch { /* le dashboard continue avec les chiffres précédents */ }
}

// ------------------------------------------------------ lettre de motivation

async function ouvrirLettre(carte, offre, bouton) {
  const zone = carte.querySelector('.letter-zone');

  // Déjà affichée : on referme.
  if (zone.dataset.ouverte === '1') {
    zone.innerHTML = '';
    zone.dataset.ouverte = '';
    bouton.textContent = offre.aLettre ? '✉️ Afficher la lettre' : '✉️ Rédiger la lettre';
    return;
  }

  const libelleInitial = bouton.innerHTML;
  bouton.disabled = true;
  bouton.innerHTML = '<span class="spinner"></span> Rédaction en cours…';

  let lettre = null;
  try {
    lettre = offre.aLettre ? await API.lettre(offre.id) : await API.genererLettre(offre.id);
  } catch (erreur) {
    toast(erreur.message, 'err');
    bouton.disabled = false;
    bouton.innerHTML = libelleInitial;
    return;
  }

  offre.aLettre = true;
  bouton.disabled = false;
  bouton.textContent = '✉️ Masquer la lettre';
  zone.dataset.ouverte = '1';

  zone.innerHTML = `
    <textarea class="letter-area"></textarea>
    <div class="letter-hint">Modifie librement le texte : tes retouches sont enregistrées automatiquement.<br>
      <strong>Dossier complet</strong> = la lettre + ton CV, dans un seul fichier à joindre au mail.</div>
    <div class="letter-actions" style="margin-top:10px">
      <a class="btn btn-primary" data-l="dossier" href="${API.urlDossier(offre.id)}">📎 Dossier complet</a>
      <a class="btn" data-l="docx" href="${API.urlDocx(offre.id)}">⬇ Lettre seule</a>
      <button class="btn" data-l="copier">📋 Copier</button>
      <button class="btn" data-l="regen">🔄 Régénérer</button>
    </div>`;

  const zoneTexte = zone.querySelector('.letter-area');
  zoneTexte.value = lettre.contenu;

  zoneTexte.addEventListener('change', async () => {
    await essayer(() => API.majLettre(offre.id, zoneTexte.value), 'Lettre enregistrée', zoneTexte);
  });

  zone.querySelector('[data-l="copier"]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(zoneTexte.value);
      toast('Lettre copiée dans le presse-papiers');
    } catch {
      zoneTexte.select();
      toast('Sélectionne et copie avec Ctrl+C', 'err');
    }
  });

  zone.querySelector('[data-l="regen"]').addEventListener('click', async () => {
    const bRegen = zone.querySelector('[data-l="regen"]');
    bRegen.disabled = true;
    bRegen.innerHTML = '<span class="spinner"></span> …';
    try {
      const r = await API.genererLettre(offre.id, { regenerer: true });
      zoneTexte.value = r.contenu;
      toast('Nouvelle lettre rédigée');
    } catch (erreur) {
      if (erreur.besoinConfirmation && confirm(erreur.message + '\n\nRégénérer quand même ?')) {
        const r = await essayer(() => API.genererLettre(offre.id, { regenerer: true, confirmerEcrasement: true }),
          'Nouvelle lettre rédigée', bRegen);
        if (r) zoneTexte.value = r.contenu;
      } else if (!erreur.besoinConfirmation) {
        toast(erreur.message, 'err');
      }
    } finally {
      bRegen.disabled = false;
      bRegen.textContent = '🔄 Régénérer';
    }
  });
}

// ------------------------------------------------------------------- kanban

async function deposerKanban(id, statut) {
  const offre = trouver(id);
  if (!offre || offre.suivi.status === statut) return;

  const champs = { status: statut };
  let message = `Déplacé vers « ${statut} »`;

  if (statut === 'Envoyé') {
    if (!offre.suivi.sent) champs.sent = todayISO();
    if (!offre.suivi.relance) {
      champs.relance = dansNJours(options.relanceJours);
      message = `Envoyée ✅ — relance planifiée dans ${options.relanceJours} jours`;
    }
  }
  if (statut === 'À postuler') {
    message = 'Remis à « À postuler » — date d\'envoi et relance effacées';
  }

  const r = await essayer(() => API.majSuivi(id, champs), message,
    document.querySelector(`.kcard[data-id="${id}"]`));
  if (r) {
    appliquerSuivi(offre, r, champs);
    if (statut === 'Entretien') celebrer(60);
    await rafraichirStats();
    rendreTout();
  }
}

// ---------------------------------------------------------------- rafraîchir

async function lancerCollecte(bouton) {
  const boutons = [document.getElementById('refreshBtn'), document.getElementById('refreshBtn2')]
    .filter(Boolean);
  const libelles = boutons.map(b => b.innerHTML);
  boutons.forEach(b => { b.disabled = true; b.innerHTML = '<span class="spinner"></span> Collecte…'; });

  try {
    const r = await API.rafraichir();
    await chargerDonnees();
    rendreTout();
    const s = r.resume;
    toast(`Collecte terminée : ${s.nouvelles} nouvelle(s) offre(s), ${s.analysees} analysée(s).`,
      s.nouvelles > 0 ? 'win' : '');
  } catch (erreur) {
    toast(erreur.message, 'err');
    rendreIndicateurMaj(etat.meta);
  } finally {
    boutons.forEach((b, i) => { b.disabled = false; b.innerHTML = libelles[i]; });
    poserIcones();
  }
}

document.getElementById('refreshBtn').addEventListener('click', e => lancerCollecte(e.currentTarget));
document.getElementById('refreshBtn2').addEventListener('click', e => lancerCollecte(e.currentTarget));

document.getElementById('quickAdd').addEventListener('click', () => {
  changerVue('offers');
  document.getElementById('form').classList.add('show');
  document.getElementById('f-titre').focus();
});

// ------------------------------------------------------------ barre d'outils

document.getElementById('villes').addEventListener('click', e => {
  const b = e.target.closest('.ville');
  if (b) choisirVille(b.dataset.v);
});

document.getElementById('segGroupe').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('#segGroupe button').forEach(x => x.classList.toggle('active', x === b));
  etat.filtre = b.dataset.g;
  rendreOffres();
});

// Drapeaux secondaires : cumulables entre eux, et avec un groupe.
document.getElementById('chips').addEventListener('click', e => {
  const c = e.target.closest('.chip');
  if (!c) return;
  c.classList.toggle('active');
  if (etat.drapeaux.has(c.dataset.f)) etat.drapeaux.delete(c.dataset.f);
  else etat.drapeaux.add(c.dataset.f);
  rendreOffres();
});

document.getElementById('search').addEventListener('input', e => { etat.recherche = e.target.value; rendreOffres(); });
document.getElementById('sort').addEventListener('change', e => { etat.tri = e.target.value; rendreOffres(); });
document.getElementById('statusFilter').addEventListener('change', e => { etat.statut = e.target.value; rendreOffres(); });

document.getElementById('toggleVue').addEventListener('click', e => {
  options.mosaique = !options.mosaique;
  appliquerOptions();
  e.currentTarget.innerHTML = options.mosaique
    ? '<span data-ic="liste" data-ic-taille="15"></span> Liste'
    : '<span data-ic="colonnes" data-ic-taille="15"></span> Grille';
  poserIcones();
  rendreOffres();
});

document.getElementById('segRythme').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('#segRythme button').forEach(x => x.classList.toggle('active', x === b));
  etat.periode = b.dataset.p;
  if (etat.stats) rendreCourbe(etat.stats, etat.periode);
});

const formulaire = document.getElementById('form');
document.getElementById('toggleForm').addEventListener('click', () => formulaire.classList.toggle('show'));
document.getElementById('cancelOffer').addEventListener('click', () => formulaire.classList.remove('show'));
document.getElementById('cancelPaste').addEventListener('click', () => formulaire.classList.remove('show'));

document.getElementById('formTabs').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('#formTabs button').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
});

document.getElementById('saveOffer').addEventListener('click', async (e) => {
  const v = id => document.getElementById(id).value.trim();
  if (!v('f-titre') || !v('f-entreprise')) { toast('Titre et entreprise sont obligatoires.', 'err'); return; }

  const r = await essayer(() => API.ajouterOffre({
    titre: v('f-titre'), entreprise: v('f-entreprise'), ville: v('f-ville'),
    date: v('f-date'), contrat: v('f-contrat'),
    groupe: document.getElementById('f-groupe').value,
    lien: v('f-lien'), verdict: v('f-verdict'),
  }), 'Offre ajoutée ✅', e.currentTarget);

  if (r) {
    ['f-titre', 'f-entreprise', 'f-ville', 'f-date', 'f-contrat', 'f-lien', 'f-verdict']
      .forEach(id => { document.getElementById(id).value = ''; });
    formulaire.classList.remove('show');
    await chargerDonnees();
    rendreTout();
  }
});

document.getElementById('savePaste').addEventListener('click', async () => {
  const zone = document.getElementById('pasteArea');
  const bouton = document.getElementById('savePaste');
  if (zone.value.trim().length < 100) { toast('Colle l\'annonce complète (au moins quelques lignes).', 'err'); return; }

  const libelle = bouton.innerHTML;
  bouton.disabled = true;
  bouton.innerHTML = '<span class="spinner"></span> Analyse en cours…';
  try {
    const r = await API.collerOffre(zone.value);
    zone.value = '';
    formulaire.classList.remove('show');
    await chargerDonnees();
    rendreTout();
    toast(`« ${r.titre} » ajoutée et classée ${GM[r.groupe].emoji} ${GM[r.groupe].label}`, 'win');
  } catch (erreur) {
    toast(erreur.message, 'err');
  } finally {
    bouton.disabled = false;
    bouton.innerHTML = libelle;
  }
});

document.getElementById('exportBtn').addEventListener('click', () => {
  const lignes = [['Titre', 'Entreprise', 'Ville', 'Date offre', 'Score', 'Groupe', 'Statut', 'Date envoi', 'Relance', 'Notes', 'Lien']];
  etat.offres.forEach(o => lignes.push([
    o.titre, o.entreprise, o.ville, o.dateOffre ?? '', o.score ?? '',
    GM[o.groupe]?.label ?? '',
    o.suivi.status, o.suivi.sent, o.suivi.relance,
    (o.suivi.notes || '').replace(/\n/g, ' '), o.lien ?? '',
  ]));

  const csv = lignes.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  telecharger(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), 'candidatures_benjamin_perrin.csv');
  toast('Export CSV téléchargé');
});

function telecharger(blob, nom) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nom;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------ vue Options

function rendreOptions() {
  document.getElementById('optDensite').value = options.densite;
  document.getElementById('optAnim').checked = options.animations;
  document.getElementById('optRelance').value = options.relanceJours;
  document.getElementById('optMasquer').checked = options.masquerEcartees;
  document.getElementById('optTheme').value = document.documentElement.dataset.theme;
  document.getElementById('goalInput').value = etat.meta?.objectifHebdo ?? 5;

  document.getElementById('optSources').innerHTML = (etat.meta?.sources ?? [])
    .map(s => `<div class="src-row ${s.configuree ? 'on' : ''}">
      <span class="pastille"></span>
      <span>${SOURCE_LABEL[s.nom] ?? s.nom}</span>
      <span class="etat">${s.configuree ? 'active' : 'non configurée'}</span>
    </div>`).join('') || '<div class="gr-vide">Aucune source déclarée.</div>';
}

function brancherOption(id, cle, lire, message) {
  document.getElementById(id).addEventListener('change', e => {
    options[cle] = lire(e.target);
    appliquerOptions();
    rendreTout();
    if (message) toast(message(options[cle]));
  });
}

brancherOption('optDensite', 'densite', el => el.value, v => `Densité : ${v}`);
brancherOption('optAnim', 'animations', el => el.checked, v => v ? 'Animations activées' : 'Animations désactivées');
brancherOption('optMasquer', 'masquerEcartees', el => el.checked,
  v => v ? 'Les offres à écarter sont masquées' : 'Toutes les offres sont affichées');

document.getElementById('optRelance').addEventListener('change', e => {
  const v = Number(e.target.value);
  if (!Number.isInteger(v) || v < 1 || v > 60) { toast('Choisis un nombre entre 1 et 60.', 'err'); e.target.value = options.relanceJours; return; }
  options.relanceJours = v;
  appliquerOptions();
  toast(`Relance proposée ${v} jours après l'envoi`);
});

document.getElementById('optTheme').addEventListener('change', e => appliquerTheme(e.target.value));

document.getElementById('optExport').addEventListener('click', () => {
  const donnees = {
    exporteLe: new Date().toISOString(),
    statistiques: etat.stats,
    offres: etat.offres,
  };
  telecharger(new Blob([JSON.stringify(donnees, null, 2)], { type: 'application/json' }),
    `job-cockpit-${todayISO()}.json`);
  toast('Sauvegarde téléchargée');
});

document.getElementById('optResetHisto').addEventListener('click', async () => {
  if (!confirm('Effacer le journal des actions et le calendrier d\'assiduité ?\n\nTes offres, ton suivi et tes lettres ne sont pas touchés.')) return;
  const r = await essayer(() => API.reinitialiser(), 'Historique effacé');
  if (r) { await chargerDonnees(); rendreTout(); }
});

// Objectif hebdomadaire
document.getElementById('goalSave').addEventListener('click', async (e) => {
  const v = Number(document.getElementById('goalInput').value);
  const r = await essayer(() => API.majObjectif(v), `Objectif : ${v} candidatures par semaine`);
  if (r) await chargerDonnees();
  if (r) rendreTout();
});

// ------------------------------------------------------- palette de commandes

const palette = document.getElementById('palette');
const paletteInput = document.getElementById('paletteInput');
const paletteRes = document.getElementById('paletteRes');
let paletteSel = 0;
let paletteItems = [];

const COMMANDES = [
  { emoji: '📊', titre: 'Tableau de bord', cat: 'Aller à', faire: () => changerVue('dashboard') },
  { emoji: '🗂️', titre: 'Toutes les offres', cat: 'Aller à', faire: () => changerVue('offers') },
  { emoji: '🧲', titre: 'Kanban', cat: 'Aller à', faire: () => changerVue('kanban') },
  { emoji: '📅', titre: 'Agenda des relances', cat: 'Aller à', faire: () => changerVue('agenda') },
  { emoji: '📄', titre: 'Mon CV', cat: 'Aller à', faire: () => changerVue('cv') },
  { emoji: '⚙️', titre: 'Options', cat: 'Aller à', faire: () => changerVue('options') },
  { emoji: '📡', titre: 'Lancer une collecte', cat: 'Action', faire: () => lancerCollecte() },
  { emoji: '➕', titre: 'Ajouter une offre', cat: 'Action', faire: () => document.getElementById('quickAdd').click() },
  { emoji: '💾', titre: 'Exporter une sauvegarde', cat: 'Action', faire: () => document.getElementById('optExport').click() },
  { emoji: '📄', titre: 'Exporter en CSV', cat: 'Action', faire: () => document.getElementById('exportBtn').click() },
  { emoji: '🎨', titre: 'Changer de thème', cat: 'Action', faire: () => themeSuivant() },
  { emoji: '⌨️', titre: 'Afficher les raccourcis', cat: 'Action', faire: () => aide.classList.add('show') },
];

function ouvrirPalette() {
  palette.classList.add('show');
  paletteInput.value = '';
  majPalette('');
  paletteInput.focus();
}

function fermerPalette() { palette.classList.remove('show'); }

function majPalette(q) {
  const requete = q.trim().toLowerCase();
  const correspond = (t) => !requete || t.toLowerCase().includes(requete);

  const commandes = COMMANDES.filter(c => correspond(c.titre)).map(c => ({ ...c }));

  // Les offres deviennent des résultats de recherche : atteindre une
  // candidature précise en trois frappes est le geste le plus fréquent.
  const offres = requete
    ? etat.offres
      .filter(o => `${o.titre} ${o.entreprise} ${o.ville}`.toLowerCase().includes(requete))
      .slice(0, 12)
      .map(o => ({
        emoji: (GM[o.groupe] ?? GM[0]).emoji,
        titre: o.titre,
        sous: `${o.entreprise} · ${o.ville}`,
        cat: 'Offres',
        faire: () => ouvrirOffre(o),
      }))
    : [];

  paletteItems = [...commandes, ...offres];
  paletteSel = 0;

  if (!paletteItems.length) {
    paletteRes.innerHTML = '<div class="palette-vide">Aucun résultat.</div>';
    return;
  }

  let cat = null;
  paletteRes.innerHTML = paletteItems.map((it, i) => {
    let entete = '';
    if (it.cat !== cat) { cat = it.cat; entete = `<div class="palette-cat">${cat}</div>`; }
    return `${entete}<div class="pres ${i === 0 ? 'sel' : ''}" data-i="${i}">
      <span class="pem">${it.emoji}</span>
      <span class="pt2">${echapper(it.titre)}</span>
      ${it.sous ? `<span class="ps">${echapper(it.sous)}</span>` : ''}
    </div>`;
  }).join('');
}

function selectionnerPalette(delta) {
  const lignes = [...paletteRes.querySelectorAll('.pres')];
  if (!lignes.length) return;
  paletteSel = (paletteSel + delta + lignes.length) % lignes.length;
  lignes.forEach((l, i) => l.classList.toggle('sel', i === paletteSel));
  lignes[paletteSel].scrollIntoView({ block: 'nearest' });
}

function validerPalette() {
  const item = paletteItems[paletteSel];
  if (!item) return;
  fermerPalette();
  item.faire();
}

paletteInput.addEventListener('input', e => majPalette(e.target.value));
paletteRes.addEventListener('click', e => {
  const l = e.target.closest('.pres');
  if (!l) return;
  paletteSel = Number(l.dataset.i);
  validerPalette();
});
palette.addEventListener('click', e => { if (e.target === palette) fermerPalette(); });
document.getElementById('paletteBtn').addEventListener('click', ouvrirPalette);

function themeSuivant() {
  const actuel = document.documentElement.dataset.theme;
  appliquerTheme(THEMES[(THEMES.indexOf(actuel) + 1) % THEMES.length]);
  rendreTout();
}

// ------------------------------------------------------- raccourcis clavier

const aide = document.getElementById('aideClavier');
const fermerAide = () => aide.classList.remove('show');
document.getElementById('fermerAide').addEventListener('click', fermerAide);
aide.addEventListener('click', e => { if (e.target === aide) fermerAide(); });

// Séquences « G puis lettre ».
const VUES_RACCOURCI = {
  d: 'dashboard', o: 'offers', k: 'kanban',
  a: 'agenda', v: 'cv', r: 'options',
};
let attendLettre = false;
let minuterieG = null;

document.addEventListener('keydown', e => {
  // On ne détourne jamais les touches pendant une saisie.
  // `e.target` n'est pas toujours un Element (ce peut être `document`) :
  // appeler .matches() dessus lèverait une exception et tuerait silencieusement
  // TOUS les raccourcis.
  const cible = e.target;
  const saisie = cible instanceof Element && cible.matches('input, textarea, select');

  // Ctrl+K est le seul raccourci qui traverse une zone de saisie.
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    palette.classList.contains('show') ? fermerPalette() : ouvrirPalette();
    return;
  }

  if (palette.classList.contains('show')) {
    if (e.key === 'ArrowDown') { e.preventDefault(); selectionnerPalette(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selectionnerPalette(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); validerPalette(); }
    else if (e.key === 'Escape') { e.preventDefault(); fermerPalette(); }
    return;
  }

  if (e.ctrlKey || e.altKey || e.metaKey) return;

  if (e.key === 'Escape') {
    if (aide.classList.contains('show')) { fermerAide(); return; }
    if (saisie) { cible.blur(); return; }
    document.getElementById('form').classList.remove('show');
    return;
  }

  if (saisie) return;

  // Deuxième touche d'une séquence « G + lettre ».
  if (attendLettre) {
    attendLettre = false;
    clearTimeout(minuterieG);
    const vue = VUES_RACCOURCI[e.key.toLowerCase()];
    if (vue) { e.preventDefault(); changerVue(vue); }
    return;
  }

  switch (e.key.toLowerCase()) {
    case 'g':
      attendLettre = true;
      // La séquence expire, sinon un « g » isolé piégerait la frappe suivante.
      minuterieG = setTimeout(() => { attendLettre = false; }, 1200);
      break;

    case '/':
      e.preventDefault();
      changerVue('offers');
      document.getElementById('search').focus();
      document.getElementById('search').select();
      break;

    case 'r':
      e.preventDefault();
      lancerCollecte();
      break;

    case 'n':
      e.preventDefault();
      document.getElementById('quickAdd').click();
      break;

    case 't':
      e.preventDefault();
      themeSuivant();
      break;

    case '?':
      e.preventDefault();
      aide.classList.add('show');
      break;
  }
});

// --------------------------------------------- migration depuis localStorage

/**
 * Récupère le suivi de l'ancienne version (fichier HTML autonome) une seule
 * fois. Les clés localStorage ne sont PAS effacées : elles restent un filet
 * de sécurité si quelque chose se passait mal.
 */
async function migrerSiNecessaire() {
  if (etat.meta?.migre) return;

  const lire = (cle, defaut) => {
    try { return JSON.parse(localStorage.getItem(cle) ?? defaut); } catch { return JSON.parse(defaut); }
  };

  const track = lire('bp_track', '{}');
  const offers = lire('bp_offers', '[]');
  const pins = lire('bp_pins', '[]');

  if (Object.keys(track).length === 0 && offers.length === 0 && pins.length === 0) return;

  // Correspondance ancien id numérique -> offre, pour recalculer le hash stable.
  let seed = [];
  try {
    const r = await fetch('seed-historique.json');
    if (r.ok) seed = await r.json();
  } catch { /* absent : seuls les ajouts manuels seront migrés */ }

  const r = await essayer(() => API.migrer({ track, offers, pins, seed }));
  if (r && !r.deja && (r.suivisImportes || r.offresImportees)) {
    toast(`Suivi récupéré : ${r.suivisImportes} candidature(s), ${r.offresImportees} offre(s).`);
    await chargerDonnees();
  }
}

// ------------------------------------------------------------------ démarrage

(async function demarrer() {
  poserIcones();

  try {
    await chargerDonnees();
  } catch (erreur) {
    toast(erreur.message, 'err');
    return;
  }

  await migrerSiNecessaire();

  // On ouvre sur le Focus du jour s'il y a de l'urgent à traiter.
  const urgent = actionsDuJour(etat.offres).filter(a => a.rang <= 1).length;
  changerVue(etat.vue);

  const jours = etat.meta?.derniereCollecte
    ? Math.floor((Date.now() - new Date(etat.meta.derniereCollecte).getTime()) / 86400000)
    : null;

  setTimeout(() => {
    if (jours === null) toast('Bienvenue 🚀 Clique sur « Collecter » pour lancer ta première collecte.');
    else if (jours >= 3) toast(`Dernière collecte il y a ${jours} jours — pense à rafraîchir.`);
    else toast('Bienvenue dans ton Job Cockpit 🚀');
  }, 800);
})();
