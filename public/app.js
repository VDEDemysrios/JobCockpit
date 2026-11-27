// Point d'entrée du dashboard : état, navigation, événements.
//
// 4.0 — CE FICHIER A ÉTÉ DÉCOUPÉ
// ------------------------------
// Il faisait 1 800 lignes et tout y passait : palette, raccourcis, toasts,
// collecte. Les morceaux qui ont une vie propre sont partis dans leur module,
// et app.js reste le point d'entrée qui les relie à l'état :
//
//   toast.js         les messages (types normalisés, pile, Annuler)
//   dialogue.js      la confirmation maison, à la place de confirm()
//   surcouche.js     la PILE des surcouches (Échap, inertie, focus)
//   palette.js       la palette v2 (recherche floue, récents, actions, aperçu)
//   clavier.js       les raccourcis, dont la liste au clavier (J/K/P/E/L/X)
//   routage.js       les ancres #/offres/strasbourg, #/offre/<id>
//   collecte-live.js le radar de collecte en direct
//   focus.js         le mode focus et son Pomodoro
//   rappels.js       la cloche, le badge d'onglet, les notifications
//   frappe.js        la révélation progressive des textes rédigés
//   titre.js         le titre de l'onglet, composé à plusieurs mains
import { API } from './api.js';
import {
  GM, SOURCE_LABEL, MOIS, JOURS, todayISO, ageOffre, echapper, pluriel, dansNJours,
} from './format.js';
import { poserIcones, icone, illustration } from './icons.js';
import { jouerIntro } from './intro.js';
import { ouvrirSurcouche, fermerSurcouche } from './surcouche.js';
import { toast } from './toast.js';
import { confirmer } from './dialogue.js';
import { installerPalette } from './palette.js';
import { installerClavier } from './clavier.js';
import { lireRoute, ecrireRoute, villeDuSlug } from './routage.js';
import { installerCollecte } from './collecte-live.js';
import { installerFocus } from './focus.js';
import { installerRappels } from './rappels.js';
import { taperChamp, revelerNoeud, mouvementCoupe } from './frappe.js';
import { poserTitreBase } from './titre.js';
import { installerDepotCv } from './depot-cv.js';
import { lancerTutoriel } from './tutoriel.js';
import { installerEditeurVilles, enregistrerVilles } from './villes.js';
import { ouvrirEntretien, ouvrirFiche, installerEntretien, rendreDossiers } from './entretien.js';
import { rendreChill, installerChill } from './chill.js';
import { installerDock, basculerDock, ouvrirDock } from './dock.js';
import {
  rendreCarte, rendreKanban, rendreAgenda, relanceDue, rendreFocus, rendreTroisDuJour,
  actionsDuJour, celebrer,
} from './render.js';
import { rendreDashboard, rendreCourbe, rendreStats, rendreIndicateurMaj, rendreHero } from './dashboard.js';
import { rendreCv } from './cv.js';
import { animerCompteurs } from './anim.js';
import { imprimerSuivi } from './impression.js';
import { imprimerRapport } from './rapport.js';
import { sonClic, sonNav, sonSucces, sonsActifs, reglerSons } from './sons.js';

// LES SONS DE L'INTERFACE, sur les gestes qui comptent — la navigation et
// l'action principale, pas le moindre clic (ce serait épuisant). Sur
// `pointerdown` : le son colle au geste, et c'est aussi ce qui débloque
// l'audio du navigateur. `sons.js` se tait tout seul si l'utilisateur les a
// coupés dans les Options.
document.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.nav button, [data-dock-page], .dock-onglets button')) sonNav();
  else if (e.target.closest('.btn-primary')) sonClic();
}, true);

const racine = document.documentElement;

const VUES = ['dashboard', 'offers', 'kanban', 'agenda', 'entretiens', 'chill', 'cv', 'options'];
const THEMES = ['vivid', 'enr', 'dark', 'cockpit'];
const NOMS_THEMES = { systeme: 'Système', vivid: 'Clair', enr: 'EnR', dark: 'Nuit', cockpit: 'Cockpit' };

/** Onglet fourre-tout : tout ce qui n'est rattaché à aucune ville prioritaire. */
const VILLE_AUTRE = 'autre';

/** Onglet des offres auxquelles on a déjà postulé — voir `ongletDe`. */
const ONGLET_ENVOYEES = 'envoyees';

// ------------------------------------------------------------------ options

const OPTIONS_DEFAUT = {
  densite: 'normale', animations: true, intro: true,
  relanceJours: 7, masquerEcartees: false, mosaique: false,
};

function lireOptions() {
  try { return { ...OPTIONS_DEFAUT, ...JSON.parse(localStorage.getItem('bp_options') ?? '{}') }; }
  catch { return { ...OPTIONS_DEFAUT }; }
}

let options = lireOptions();

function appliquerOptions() {
  racine.dataset.densite = options.densite;
  racine.dataset.anim = options.animations ? 'on' : 'off';
  try { localStorage.setItem('bp_options', JSON.stringify(options)); } catch { /* navigation privée */ }
}
appliquerOptions();

/**
 * Suspend les animations continues quand l'onglet passe à l'arrière-plan.
 *
 * Le navigateur ralentit les minuteurs d'un onglet caché, mais laisse tourner
 * les animations CSS. Or l'application reste ouverte toute la journée, souvent
 * derrière autre chose : animer ce que personne ne regarde ne coûte que de la
 * batterie. Le CSS fait le reste — voir « CE QUI RESTE EN VIE ».
 */
document.addEventListener('visibilitychange', () => {
  racine.dataset.page = document.hidden ? 'cachee' : 'visible';
  // Au retour sur l'onglet, les échéances ont pu changer de jour.
  if (!document.hidden) rappels?.rafraichir();
});

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
  source: null,          // filtre posé depuis la légende d'un graphique (jc:filtre)
  recherche: '',
  tri: 'grp',
  statut: 'all',
  periode: '30',
  ouvertes: new Set(),   // cartes dépliées, à rouvrir après un rafraîchissement
  limite: 50,            // cartes affichées ; le reste vient à la demande
};

/**
 * Nombre de cartes rendues d'un coup.
 *
 * Après l'élargissement des intitulés, un onglet peut contenir 366 offres :
 * 25 000 nœuds et 78 000 px de haut. La page se chargeait encore, mais elle
 * ne se parcourait plus — et rien de tout cela n'était lu.
 */
const PAR_PAGE = 50;

// Les modules installés plus bas, déclarés ici pour les rappels croisés.
let palette = null;
let collecte = null;
let focus = null;
let rappels = null;

// ----------------------------------------------------------------- utilitaires

/**
 * LE GESTE RÉPOND, MÊME QUAND IL ÉCHOUE.
 *
 * Le troisième argument d'`essayer()` — l'élément qui a déclenché l'action —
 * était passé par tous les appelants et ignoré par la fonction. Un champ dont
 * l'enregistrement échouait ne bougeait pas : seul un message, en bas à
 * droite, loin du regard, disait que rien n'avait été écrit. L'élément tremble
 * désormais à l'échec, et pulse brièvement à la réussite : la réponse arrive
 * là où l'on regarde.
 */
function reagir(el, genre) {
  if (!el?.classList || mouvementCoupe()) return;
  const classe = genre === 'err' ? 'secousse' : 'pulsation';
  el.classList.remove('secousse', 'pulsation');
  void el.offsetWidth;
  el.classList.add(classe);
  setTimeout(() => el.classList.remove(classe), 650);
}

/** Enveloppe une action asynchrone : toute erreur devient un toast. */
async function essayer(action, messageSucces, element = null) {
  try {
    const r = await action();
    if (messageSucces) toast(messageSucces);
    reagir(element, 'ok');
    return r;
  } catch (erreur) {
    toast(erreur.message, 'err');
    reagir(element, 'err');
    return null;
  }
}

/** Fête un vrai moment — jamais quand le mouvement est coupé. */
function feter(intensite) {
  if (options.animations && !mouvementCoupe()) celebrer(intensite);
}

// ----------------------------------------------------------------------- thème

const sombreSysteme = window.matchMedia?.('(prefers-color-scheme: dark)');

/** « Système » se résout en Clair ou Nuit selon le réglage de l'ordinateur. */
function themeResolu(choix) {
  if (choix === 'systeme') return sombreSysteme?.matches ? 'dark' : 'vivid';
  return THEMES.includes(choix) ? choix : 'vivid';
}

/** Les transitions de vue sont-elles possibles et souhaitées ? */
function peutTransitionner() {
  return typeof document.startViewTransition === 'function' && !mouvementCoupe();
}

/**
 * Applique un thème.
 *
 * LA BASCULE EST UN FONDU, PAS UN SAUT. Changer de thème repeignait tout
 * d'un bloc, en une image : sur « Nuit » → « Clair », l'écran entier
 * flashait. La transition de vue du navigateur fait un fondu croisé entre
 * l'ancien et le nouvel aspect ; à défaut, une classe brève autorise les
 * transitions de couleur le temps de la bascule.
 *
 * `apres` (le redessin des graphiques, qui lisent les variables CSS à la
 * construction) passe DANS la mise à jour : sans ça, le fondu se jouerait
 * vers des graphiques encore aux couleurs d'avant.
 */
function appliquerTheme(choix, { transition = false, apres = null } = {}) {
  const poser = () => {
    racine.dataset.themeChoix = choix;
    racine.dataset.theme = themeResolu(choix);
    document.querySelectorAll('#themeSwitch button').forEach(b => {
      const actif = b.dataset.t === choix;
      b.classList.toggle('active', actif);
      b.setAttribute('aria-pressed', String(actif));
    });
    const select = document.getElementById('optTheme');
    if (select) select.value = choix;
    apres?.();
  };
  try { localStorage.setItem('bp_theme', choix); } catch { /* navigation privée */ }
  if (transition && peutTransitionner()) {
    racine.classList.add('vt-theme');
    const vt = document.startViewTransition(poser);
    vt.finished.finally(() => racine.classList.remove('vt-theme'));
  } else if (transition && !mouvementCoupe()) {
    racine.classList.add('theme-bascule');
    poser();
    setTimeout(() => racine.classList.remove('theme-bascule'), 420);
  } else {
    poser();
  }
}

appliquerTheme(localStorage.getItem('bp_theme') || 'vivid');

// Le système change de clair à sombre (le soir) : « Système » suit, et les
// graphiques se redessinent dans les nouvelles couleurs.
sombreSysteme?.addEventListener?.('change', () => {
  if (racine.dataset.themeChoix === 'systeme') appliquerTheme('systeme', { transition: true, apres: rendreTout });
});

document.getElementById('themeSwitch').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  appliquerTheme(b.dataset.t, { transition: true, apres: rendreTout });
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
  // vaut mieux que de laisser l'auteur découvrir des offres sans verdict.
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

const barreLaterale = document.getElementById('sidebar');
const burger = document.getElementById('burger');

function ouvrirTiroir(ouvert) {
  barreLaterale.classList.toggle('open', ouvert);
  burger.setAttribute('aria-expanded', String(ouvert));
  burger.setAttribute('aria-label', ouvert ? 'Fermer la navigation' : 'Ouvrir la navigation');
}

burger.addEventListener('click', (e) => {
  e.stopPropagation();
  ouvrirTiroir(!barreLaterale.classList.contains('open'));
});

// Sur téléphone, la barre latérale devient un tiroir posé par-dessus la page.
// Sans ces deux sorties, on ne peut le refermer qu'en changeant de vue — et
// le voile sombre laisse croire que l'application est bloquée.
document.addEventListener('click', (e) => {
  if (!barreLaterale.classList.contains('open')) return;
  if (!barreLaterale.contains(e.target)) ouvrirTiroir(false);
});

/**
 * Vrai le temps d'un changement de vue.
 *
 * L'entrée en cascade doit se jouer quand on ARRIVE quelque part, pas à
 * chaque fois qu'on coche un filtre. Sans ce drapeau, cocher « Épinglées »
 * relançait l'animation des cinquante cartes : l'écran clignotait, et la
 * liste mettait une demi-seconde à redevenir lisible.
 *
 * Il sert aussi à ne lire le serveur qu'à l'ARRIVÉE sur les vues qui en ont
 * besoin (Options, Entretiens) : `rendreTout()` est appelé à chaque thème,
 * chaque option, chaque statut — y refaire des requêtes, c'était autant
 * d'allers-retours pour des chiffres qui n'avaient pas bougé.
 */
let arriveeSurLaVue = true;

/**
 * Change de vue.
 *
 * LA TRANSITION DE VUE. Là où le navigateur la connaît, l'ancienne vue se
 * fond dans la nouvelle (`startViewTransition`) ; ailleurs, la classe
 * `.entre` rejoue le glissement d'avant. Les deux se taisent avec
 * l'interrupteur des animations et le réglage système.
 *
 * `transition: false` pour les appels qui ont besoin du DOM TOUT DE SUITE :
 * la mise à jour d'une transition de vue est asynchrone, et la visite guidée
 * comme l'ouverture d'une offre cherchent leur élément dans la foulée.
 */
function changerVue(vue, { transition = true, route = true } = {}) {
  if (!VUES.includes(vue)) return;
  const change = vue !== etat.vue;
  const avecTransition = transition && change && peutTransitionner();

  const faire = () => {
    etat.vue = vue;
    arriveeSurLaVue = true;
    document.querySelectorAll('.nav button').forEach(x => {
      const actif = x.dataset.view === vue;
      x.classList.toggle('active', actif);
      if (actif) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current');
    });
    VUES.forEach(id => {
      // `block` et non `flex` : la vue est un ÉLÉMENT de flex dans .main, mais
      // son propre contenu s'empile normalement.
      document.getElementById('view-' + id).style.display = id === vue ? 'block' : 'none';
    });
    ouvrirTiroir(false);

    const actif = document.getElementById('view-' + vue);
    if (!avecTransition) {
      // Repli : la vue GLISSE à l'arrivée. On retire puis remet la classe,
      // avec un reflow entre les deux, pour rejouer l'animation.
      actif.classList.remove('entre');
      void actif.offsetWidth;
      actif.classList.add('entre');
      actif.addEventListener('animationend', () => actif.classList.remove('entre'), { once: true });
    }

    if (vue === 'options') chargerOptionsDistantes();
    rendreTout();

    // C'est la VUE qui défile, pas la page : la remettre en haut demande de
    // viser le bon élément.
    actif.scrollTop = 0;
    document.querySelector('.main').classList.remove('defile');
    arriveeSurLaVue = false;
  };

  if (avecTransition) document.startViewTransition(faire);
  else faire();
  if (route) ecrireAncre();
}

// L'ombre sous le bandeau, qui dit qu'il y a du contenu au-dessus.
document.querySelector('.main').addEventListener('scroll', (e) => {
  if (!e.target.classList?.contains('view')) return;
  document.querySelector('.main').classList.toggle('defile', e.target.scrollTop > 4);
}, true);

// ------------------------------------------------------------------ routage

/**
 * L'ADRESSE SUIT L'ÉCRAN. Voir `routage.js` pour le pourquoi.
 *
 * Changer de VUE ajoute une entrée d'historique (Précédent y revient) ;
 * changer d'onglet de ville la REMPLACE — dix onglets parcourus ne doivent
 * pas coûter dix « Précédent » pour quitter la liste.
 */
let ancreAppliquee = '';

function routeCourante() {
  return ecrireRoute({ vue: etat.vue, ville: etat.vue === 'offers' ? etat.ville : null });
}

function ecrireAncre({ remplacer = false, offre = null } = {}) {
  const h = offre ? ecrireRoute({ offre }) : routeCourante();
  if (h === location.hash) return;
  ancreAppliquee = h;
  try { history[remplacer ? 'replaceState' : 'pushState'](null, '', h); } catch { /* fichier local */ }
}

function appliquerRoute() {
  const h = location.hash;
  if (!h || h === ancreAppliquee) return;
  ancreAppliquee = h;
  const r = lireRoute(h);
  if (r.offre) {
    const o = trouver(r.offre);
    if (o) ouvrirOffre(o, { route: false });
    return;
  }
  if (r.vue === 'offers' && r.ville) {
    const v = villeDuSlug(r.ville, villesOnglets());
    if (v) { etat.ville = v; localStorage.setItem('bp_ville', v); ongletsRendus = null; }
  }
  if (r.vue) changerVue(r.vue, { route: false });
}
window.addEventListener('popstate', appliquerRoute);
window.addEventListener('hashchange', appliquerRoute);

// ------------------------------------------------------------------ bandeau

/**
 * Les pastilles de la navigation.
 *
 * `#nb-entretiens` existait dans le balisage et n'était JAMAIS rempli : la
 * vue Entretiens n'avait pas de compteur, alors que c'est la seule échéance
 * qu'on ne peut ni décaler ni rattraper. Il compte désormais les entretiens à
 * venir — calculés ici, sur les offres déjà chargées, sans requête.
 */
function majBadgesNav() {
  const aPostuler = etat.offres.filter(o =>
    (o.groupe === 1 || o.groupe === 2) && o.suivi.status === 'À postuler').length;
  const relances = etat.offres.filter(relanceDue).length;
  const aujourdhui = todayISO();
  const entretiens = etat.offres.filter(o => o.suivi.entretien && o.suivi.entretien >= aujourdhui).length;

  const poser = (id, valeur) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = valeur ? '' : 'none';
    el.textContent = valeur;
  };

  poser('nb-offers', aPostuler);
  poser('nb-agenda', relances);
  poser('nb-entretiens', entretiens);
}

/**
 * Le prénom de celui qui utilise l'application, tiré du profil.
 *
 * Il était écrit en dur dans trois endroits du balisage et du code. C'était
 * juste tant que l'outil ne servait qu'à une personne ; ça ne l'est plus dès
 * qu'on le donne à installer.
 */
function prenomUtilisateur() {
  const complet = String(etat.meta?.candidat ?? '').trim();
  return complet ? complet.split(/\s+/)[0] : '';
}

const CIRCONF_OBJ = 2 * Math.PI * 7;

/**
 * Bandeau de commande : salutation et pastilles de contexte.
 *
 * L'ANNEAU D'OBJECTIF PROGRESSE EN DIRECT. La pastille « Semaine 3/5 » était
 * réécrite à chaque rendu : marquer une candidature envoyée changeait le
 * chiffre d'un coup, sans que l'œil le remarque. Elle est maintenant construite
 * une fois puis METTUE À JOUR — l'arc avance en glissant, et c'est ce
 * glissement qui se remarque.
 */
function rendreBandeau() {
  const h = new Date().getHours();
  const salut = h < 6 ? 'Encore debout' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
  const prenom = prenomUtilisateur();
  document.getElementById('salut').textContent = prenom ? `${salut}, ${prenom}` : salut;

  const complet = String(etat.meta?.candidat ?? '').trim();
  const sous = document.querySelector('.sb-sub');
  if (sous) sous.textContent = complet;
  poserTitreBase(complet ? `Job Cockpit — ${complet}` : 'Job Cockpit');

  const actions = actionsDuJour(etat.offres);
  const urgentes = actions.filter(a => a.rang === 0).length;

  document.getElementById('salutSous').textContent = urgentes
    ? `${pluriel(urgentes, 'relance')} en retard — commence par là.`
    : actions.length
      ? `${pluriel(actions.length, 'action')} en attente. Rien d'urgent.`
      : 'Tout est traité. Lance une collecte quand tu veux.';

  const envoyees = etat.stats?.performance?.envoisSemaine ?? 0;
  const objectif = etat.meta?.objectifHebdo ?? 5;
  const zone = document.getElementById('cmdPills');

  let obj = zone.querySelector('.cpill-obj');
  if (!obj) {
    zone.innerHTML = `<span class="cpill cpill-obj" title="Candidatures envoyées cette semaine">
        <svg class="obj-anneau" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7" class="obj-fond"/>
          <circle cx="9" cy="9" r="7" class="obj-arc" style="stroke-dasharray:${CIRCONF_OBJ.toFixed(2)};stroke-dashoffset:${CIRCONF_OBJ.toFixed(2)}"/></svg>
        Semaine <b class="obj-n"></b></span>
      <span class="cpill chaud" hidden>${icone('horloge', 12)} <b class="urg-n"></b> en retard</span>`;
    obj = zone.querySelector('.cpill-obj');
  }
  const part = Math.min(1, envoyees / Math.max(1, objectif));
  // Une image plus tard : posé dans la même image que la création, l'arc
  // n'aurait aucun trajet à parcourir.
  requestAnimationFrame(() => {
    obj.querySelector('.obj-arc').style.strokeDashoffset = (CIRCONF_OBJ * (1 - part)).toFixed(2);
  });
  obj.querySelector('.obj-n').textContent = `${envoyees}/${objectif}`;
  obj.classList.toggle('vert', envoyees >= objectif);
  const chaud = zone.querySelector('.cpill.chaud');
  chaud.hidden = !urgentes;
  chaud.querySelector('.urg-n').textContent = urgentes;
}

/**
 * « Pas celle-ci » : retire une offre de la sélection du jour.
 *
 * C'est un refus EXPLICITE, et il passe par la même porte que partout
 * ailleurs — l'offre est écartée, donc elle ne reviendra pas aux prochaines
 * collectes.
 */
async function ecarterDepuisSelection(offre) {
  const ok = await confirmer({
    titre: `Retirer « ${offre.titre} » de la sélection ?`,
    message: 'Elle sera écartée et ne reviendra pas aux prochaines collectes.',
    ok: 'Écarter', danger: true,
  });
  if (!ok) return;
  const r = await essayer(() => API.supprimerOffre(offre.id), 'Offre écartée');
  if (!r) return;
  await chargerDonnees();
  rendreTout();
}

/** Ouvre une offre depuis une autre vue : bascule sur Offres et la déplie. */
function ouvrirOffre(offre, { route = true } = {}) {
  if (!offre) return;
  etat.ouvertes.add(offre.id);
  etat.filtre = 'all';
  etat.statut = 'all';
  etat.drapeaux.clear();
  etat.source = null;
  etat.recherche = '';
  document.getElementById('search').value = '';
  document.getElementById('statusFilter').value = 'all';
  document.querySelectorAll('#chips .chip').forEach(c => { c.classList.remove('active'); c.setAttribute('aria-pressed', 'false'); });
  document.querySelectorAll('#segGroupe button')
    .forEach(b => b.classList.toggle('active', b.dataset.g === 'all'));

  // Sans cette bascule, une offre lyonnaise ouverte depuis l'agenda resterait
  // invisible tant que l'onglet Strasbourg est actif.
  construireOnglets();
  etat.ville = ongletDe(offre);
  localStorage.setItem('bp_ville', etat.ville);
  document.querySelectorAll('#villes .ville')
    .forEach(b => b.classList.toggle('active', b.dataset.v === etat.ville));

  // L'offre peut être au-delà des cinquante premières : on élargit jusqu'à elle.
  etat.limite = PAR_PAGE;
  changerVue('offers', { transition: false, route: false });
  if (!document.querySelector(`#grid .card[data-id="${CSS.escape(offre.id)}"]`)) {
    etat.limite = 2000;
    rendreOffres();
  }
  if (route) ecrireAncre({ offre: offre.id });

  requestAnimationFrame(() => {
    const carte = document.querySelector(`#grid .card[data-id="${CSS.escape(offre.id)}"]`);
    if (!carte) return;
    document.querySelectorAll('#grid .card.focus').forEach(c => c.classList.remove('focus'));
    carte.classList.add('focus');
    carte.scrollIntoView({ behavior: mouvementCoupe() ? 'auto' : 'smooth', block: 'center' });
    carte.querySelector('.head')?.focus({ preventScroll: true });
  });
}

const ouvrirOffreParId = (id) => ouvrirOffre(trouver(id));

// ---------------------------------------------------------------- rendu global

function rendreTout() {
  majBadgesNav();
  rendreBandeau();
  poserIcones();

  if (etat.vue === 'options') rendreOptions();
  else if (etat.vue === 'dashboard') {
    rendreTroisDuJour(etat.offres, { ouvrir: ouvrirOffre, ecarter: ecarterDepuisSelection });
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
  // Ces deux vues lisent le serveur ou portent un état vivant (la
  // conversation, le robot) : on ne les reconstruit qu'à l'arrivée.
  else if (etat.vue === 'entretiens' && arriveeSurLaVue) rendreDossiers(toast);
  else if (etat.vue === 'chill' && arriveeSurLaVue) rendreChill();

  poserIcones();
  // Les rouleaux se lancent une fois le balisage en place : anim.js écrit
  // d'abord la valeur juste, puis anime. Rien ne dépend de l'animation.
  animerCompteurs();
  focus?.rafraichir();
}

const rangGroupe = g => ({ 1: 0, 2: 1, 0: 2, 3: 3 }[g] ?? 4);

/** Les onglets, dans l'ordre : les villes du profil, puis le fourre-tout. */
function villesOnglets() {
  return [...(etat.meta?.villes ?? []), VILLE_AUTRE, ONGLET_ENVOYEES];
}

/**
 * L'onglet d'une offre.
 *
 * UNE CANDIDATURE ENVOYÉE QUITTE SA VILLE. Les onglets de ville servent à
 * TRIER ce qui reste à faire. Une offre à laquelle on vient de postuler n'est
 * plus du tri : elle part dans « Envoyées » — visible, mais plus dans le
 * chemin. Une ville disparue du profil retombe dans « Autre ».
 */
function ongletDe(offre) {
  if ((offre.suivi?.status ?? 'À postuler') !== 'À postuler') return ONGLET_ENVOYEES;
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
  if (villes.join('|') + '#' + etat.ville === ongletsRendus) return;
  ongletsRendus = villes.join('|') + '#' + etat.ville;

  // Première visite : on ouvre sur la ville la mieux fournie plutôt que sur
  // la première du profil. Tomber sur un onglet vide en arrivant donne
  // l'impression que la collecte n'a rien ramené.
  if (!villes.includes(etat.ville)) {
    const compte = Object.fromEntries(villes.map(v => [v, 0]));
    etat.offres.forEach(o => { compte[ongletDe(o)]++; });
    // « Envoyées » est exclu du choix : ouvrir l'application sur ce qui est
    // déjà fait, c'est commencer la journée par regarder derrière soi.
    const choisissables = villes.filter(v => v !== ONGLET_ENVOYEES);
    etat.ville = choisissables.reduce((a, b) => (compte[b] > compte[a] ? b : a), choisissables[0]);
  }

  const libelle = (v) => (v === VILLE_AUTRE ? 'Autre'
    : v === ONGLET_ENVOYEES ? 'Envoyées' : v);

  document.getElementById('villes').innerHTML = villes.map(v => `
    <button class="ville ${v === etat.ville ? 'active' : ''}${v === ONGLET_ENVOYEES ? ' ville-envoyees' : ''}"
            data-v="${echapper(v)}" ${v === etat.ville ? 'aria-current="true"' : ''}>
      <span class="vv">${echapper(libelle(v))}</span>
      <span class="vn" data-compte="${echapper(v)}">0</span>
      <span class="vp"></span>
    </button>`).join('');
}

function choisirVille(ville) {
  etat.ville = ville;
  localStorage.setItem('bp_ville', ville);
  document.querySelectorAll('#villes .ville').forEach(b => {
    const actif = b.dataset.v === ville;
    b.classList.toggle('active', actif);
    if (actif) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  });
  ongletsRendus = villesOnglets().join('|') + '#' + ville;
  rendreOffresDepuisLeDebut();
  ecrireAncre({ remplacer: true });
}

/**
 * LES FILTRES ET LES COMPTEURS, SANS LA GRILLE.
 *
 * Séparés du rendu des cartes pour une raison précise : écarter une offre,
 * changer son statut ou l'épingler doit mettre à jour « 12 prio », « 47
 * offres affichées » et les onglets — mais pas reconstruire les cinquante
 * cartes, ce qui refermait la lettre qu'on était en train de relire dans la
 * carte d'à côté. Rend la liste triée à afficher.
 */
function majFiltresEtCompteurs() {
  // Filtres de CONTEXTE : ils s'appliquent avant de compter les onglets, pour
  // que « Nancy 3 » veuille bien dire « 3 offres à voir ici, avec ce que tu
  // cherches en ce moment ».
  let contexte = etat.offres;
  if (etat.statut !== 'all') contexte = contexte.filter(o => o.suivi.status === etat.statut);
  if (etat.drapeaux.has('pin')) contexte = contexte.filter(o => o.suivi.pinned);
  if (etat.drapeaux.has('lettre')) contexte = contexte.filter(o => o.aLettre);
  if (etat.drapeaux.has('frais')) contexte = contexte.filter(o => {
    const a = ageOffre(o.dateOffre);
    return a !== null && a <= 7;
  });
  if (etat.source) contexte = contexte.filter(o => (o.sources ?? [o.source]).includes(etat.source));
  if (etat.recherche) {
    const q = etat.recherche.toLowerCase();
    contexte = contexte.filter(o => `${o.titre}${o.entreprise}${o.ville}`.toLowerCase().includes(q));
  }
  // Option « masquer les offres à écarter » — sans effet si on filtre justement dessus.
  if (options.masquerEcartees && etat.filtre !== '3') contexte = contexte.filter(o => o.groupe !== 3);

  majPuceSource();

  const parVille = {};
  const prioParVille = {};
  villesOnglets().forEach(v => { parVille[v] = 0; prioParVille[v] = 0; });
  contexte.forEach(o => {
    const v = ongletDe(o);
    parVille[v]++;
    if (o.groupe === 1) prioParVille[v]++;
  });

  document.querySelectorAll('#villes .ville').forEach(bouton => {
    const v = bouton.dataset.v;
    bouton.querySelector('.vn').textContent = parVille[v] ?? 0;
    const prio = bouton.querySelector('.vp');
    const n = prioParVille[v] ?? 0;
    const pertinent = n > 0 && v !== ONGLET_ENVOYEES;
    prio.textContent = pertinent ? `${n} prio` : '';
    prio.style.display = pertinent ? '' : 'none';
    bouton.title = n
      ? `${pluriel(n, 'offre')} prioritaire${n > 1 ? 's' : ''} sur ${parVille[v]}`
      : `${pluriel(parVille[v] ?? 0, 'offre')}, aucune prioritaire`;
  });

  // Le classement par groupe décrit la ville affichée, pas la France entière.
  const dansLaVille = contexte.filter(o => ongletDe(o) === etat.ville);
  const compte = { all: dansLaVille.length, 1: 0, 2: 0, 3: 0, 0: 0 };
  dansLaVille.forEach(o => { compte[o.groupe] = (compte[o.groupe] ?? 0) + 1; });
  document.getElementById('c-all').textContent = compte.all;
  ['1', '2', '3', '0'].forEach(g => { document.getElementById('c-' + g).textContent = compte[g]; });

  const liste = dansLaVille.filter(o => etat.filtre === 'all' || String(o.groupe) === etat.filtre);

  if (etat.tri === 'date') liste.sort((a, b) => String(b.dateOffre ?? '').localeCompare(String(a.dateOffre ?? '')));
  else if (etat.tri === 'score') liste.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  else if (etat.tri === 'fresh') liste.sort((a, b) => (ageOffre(a.dateOffre) ?? 999) - (ageOffre(b.dateOffre) ?? 999));
  else if (etat.tri === 'ville') liste.sort((a, b) => String(a.ville).localeCompare(String(b.ville)));
  else if (etat.tri === 'relance') liste.sort((a, b) => (a.suivi.relance || '9999').localeCompare(b.suivi.relance || '9999'));
  else liste.sort((a, b) => rangGroupe(a.groupe) - rangGroupe(b.groupe) || (b.score ?? 0) - (a.score ?? 0));

  // Les épinglées remontent toujours en tête.
  liste.sort((a, b) => (b.suivi.pinned ? 1 : 0) - (a.suivi.pinned ? 1 : 0));

  const ouLibelle = etat.ville === ONGLET_ENVOYEES ? 'parmi les candidatures envoyées'
    : etat.ville === VILLE_AUTRE ? 'hors des villes prioritaires'
      : `à ${etat.ville}`;

  if (etat.ville === ONGLET_ENVOYEES) {
    const parStatut = {};
    for (const o of dansLaVille) parStatut[o.suivi.status] = (parStatut[o.suivi.status] ?? 0) + 1;
    const resume = Object.entries(parStatut)
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => `${n} ${s.toLowerCase()}`)
      .join(' · ');
    document.getElementById('offersSub').textContent = dansLaVille.length
      ? `candidatures envoyées — ${resume}`
      : 'aucune candidature envoyée pour l\'instant';
  } else {
    document.getElementById('offersSub').textContent =
      `${ouLibelle} — ${compte[1]} prioritaires · ${compte[2]} possibles · ${compte[0]} à vérifier`;
  }

  // LE MESSAGE DE VIDE NE DOIT PAS MENTIR — et il a désormais une image.
  // Un texte gris seul se lisait comme une liste qui n'a pas chargé.
  const vide = document.getElementById('empty');
  vide.style.display = liste.length ? 'none' : 'block';
  const totalOnglet = etat.offres.filter(o => ongletDe(o) === etat.ville).length;
  const filtreActif = etat.statut !== 'all' || etat.drapeaux.size > 0 || etat.source
    || etat.recherche !== '' || etat.filtre !== 'all';

  let texte;
  if (totalOnglet === 0) {
    texte = etat.ville === ONGLET_ENVOYEES
      ? 'Aucune candidature envoyée pour l\'instant. Elles arriveront ici dès que tu en marqueras une.'
      : `Aucune offre ${ouLibelle} pour l'instant. Regarde les autres onglets.`;
  } else if (etat.statut !== 'all' && etat.statut !== 'À postuler' && etat.ville !== ONGLET_ENVOYEES) {
    texte = `Les offres « ${etat.statut} » ne sont pas dans les onglets de ville : `
      + 'elles sont regroupées dans « Envoyées ».';
  } else {
    texte = filtreActif
      ? `Aucune des ${pluriel(totalOnglet, 'offre')} ${ouLibelle} ne correspond à ce filtre.`
      : `Aucune offre ${ouLibelle} pour l'instant. Regarde les autres onglets.`;
  }
  if (!liste.length) {
    vide.innerHTML = `${illustration(filtreActif ? 'recherche' : 'offres')}<p>${echapper(texte)}</p>`;
  }

  const affichees = Math.min(liste.length, etat.limite);
  const reste = liste.length - affichees;
  document.getElementById('count').textContent = reste
    ? `${affichees} sur ${pluriel(liste.length, 'offre')}`
    : `${pluriel(liste.length, 'offre')} affichée${liste.length > 1 ? 's' : ''}`;

  const suite = document.getElementById('plusOffres');
  suite.style.display = reste ? '' : 'none';
  if (reste) suite.textContent = `Voir ${Math.min(reste, PAR_PAGE)} offres de plus — ${reste} restantes`;

  return liste;
}

function rendreOffres() {
  construireOnglets();
  const liste = majFiltresEtCompteurs();

  const grille = document.getElementById('grid');
  const focusId = grille.querySelector('.card.focus')?.dataset.id;
  grille.classList.toggle('mosaique', options.mosaique);
  grille.innerHTML = '';

  // L'entrée en cascade ne se joue qu'à l'ARRIVÉE sur la vue.
  grille.classList.toggle('sans-entree', !arriveeSurLaVue);

  const fragment = document.createDocumentFragment();
  liste.slice(0, etat.limite).forEach((offre, i) => {
    const carte = rendreCarte(offre, { brancher: brancherCarte });
    // Le décalage ne porte que sur les premières cartes : au-delà, la
    // cascade cesse d'être un mouvement et devient une attente.
    if (arriveeSurLaVue) carte.style.animationDelay = Math.min(i * 0.018, 0.3) + 's';
    if (etat.ouvertes.has(offre.id)) marquerOuverte(carte, true);
    if (offre.id === focusId) carte.classList.add('focus');
    fragment.appendChild(carte);
  });
  // Un seul ajout au document : cinquante `appendChild` successifs, c'était
  // cinquante invalidations de mise en page.
  grille.appendChild(fragment);
}

/** Toute modification de filtre repart du haut. */
function rendreOffresDepuisLeDebut() {
  etat.limite = PAR_PAGE;
  rendreOffres();
}

/**
 * LE FILTRE PAR SOURCE, posé depuis la légende du graphique « D'où viennent
 * les offres » (événement `jc:filtre`). Il s'affiche en puce retirable : un
 * filtre invisible est un filtre qu'on oublie, et une liste qui « manque »
 * des offres sans dire pourquoi.
 */
function majPuceSource() {
  const zone = document.getElementById('chips');
  let puce = zone.querySelector('.chip-source');
  if (!etat.source) { puce?.remove(); return; }
  if (!puce) {
    puce = document.createElement('button');
    puce.type = 'button';
    puce.className = 'chip active chip-source';
    puce.dataset.f = 'source';
    zone.appendChild(puce);
  }
  puce.setAttribute('aria-pressed', 'true');
  puce.innerHTML = `Source : ${echapper(SOURCE_LABEL[etat.source] ?? etat.source)} ${icone('croix', 12)}`;
  puce.title = 'Retirer le filtre par source';
}

document.addEventListener('jc:filtre', (e) => {
  const source = e.detail?.source ?? null;
  etat.source = etat.source === source ? null : source;
  etat.limite = PAR_PAGE;
  if (etat.vue !== 'offers') changerVue('offers');
  else rendreOffres();
  if (etat.source) toast(`Offres de ${SOURCE_LABEL[etat.source] ?? etat.source}`);
});

// ------------------------------------------------------- événements des cartes

/** Pose l'état ouvert d'une carte, avec ce qui l'annonce au clavier. */
function marquerOuverte(carte, ouverte) {
  carte.classList.toggle('open', ouverte);
  carte.querySelector('.head')?.setAttribute('aria-expanded', String(ouverte));
  carte.querySelector('.chevron')?.setAttribute('aria-expanded', String(ouverte));
}

function basculerCarte(carte, offre) {
  const ouverte = !carte.classList.contains('open');
  marquerOuverte(carte, ouverte);
  if (ouverte) etat.ouvertes.add(offre.id);
  else etat.ouvertes.delete(offre.id);
}

/**
 * Prépare le balisage d'une carte rendue par render.js, SANS en changer le
 * contenu :
 *
 *   · le détail est enveloppé dans `.detail-in` — c'est ce qui permet de
 *     l'ouvrir en hauteur animée (`grid-template-rows: 0fr → 1fr`) au lieu
 *     d'un `display:block` qui le faisait apparaître d'un coup ;
 *   · l'en-tête devient focusable : la liste se parcourt au clavier ;
 *   · « Pas encore postulé » (un `<span>` cliquable) devient atteignable au
 *     clavier, comme l'épingle et la croix que render.js marque déjà
 *     `role="button"` — leur Entrée / Espace est branchée dans brancherCarte.
 */
function preparerCarte(carte, offre) {
  const detail = carte.querySelector('.detail');
  if (detail && !detail.querySelector(':scope > .detail-in')) {
    const dedans = document.createElement('div');
    dedans.className = 'detail-in';
    dedans.append(...detail.childNodes);
    detail.appendChild(dedans);
  }
  const tete = carte.querySelector('.head');
  if (tete) {
    tete.tabIndex = 0;
    tete.setAttribute('aria-expanded', String(carte.classList.contains('open')));
    tete.setAttribute('aria-label', `${offre.titre}${offre.entreprise ? ', ' + offre.entreprise : ''} — Entrée pour déplier`);
  }
  const pin = carte.querySelector('[data-act="pin"]');
  if (pin) {
    pin.setAttribute('aria-pressed', String(Boolean(offre.suivi.pinned)));
    pin.setAttribute('aria-label', offre.suivi.pinned ? 'Désépingler' : 'Épingler');
  }
  const envoi = carte.querySelector('[data-act="postule"]');
  if (envoi && !envoi.matches('button')) {
    envoi.setAttribute('role', 'button');
    envoi.tabIndex = 0;
  }
}

/** Entrée et Espace sur un `role="button"` qui n'est pas un vrai bouton. */
function activableAuClavier(el, faire) {
  if (!el || el.matches('button')) return;
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    faire(e);
  });
}

/**
 * Branche une carte.
 *
 * LES ÉCOUTEURS RETROUVENT LEUR CARTE PAR L'ÉVÉNEMENT, pas par la fermeture.
 * `rafraichirCarte` remplace parfois l'EN-TÊTE seul (quand une lettre est
 * ouverte dans le détail) : un écouteur qui aurait capturé l'ancienne carte
 * agirait sur un élément sorti du document.
 */
function brancherCarte(carte, offre) {
  preparerCarte(carte, offre);
  const carteDe = (e) => e.currentTarget.closest('.card') ?? carte;

  const tete = carte.querySelector('.head');
  tete.addEventListener('click', e => {
    if (e.target.closest('[data-act="pin"], a, [data-act="suppr"], [data-act="analyser"]')) return;
    basculerCarte(carteDe(e), offre);
  });
  tete.addEventListener('keydown', e => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); basculerCarte(carteDe(e), offre); }
  });
  tete.addEventListener('focus', e => {
    document.querySelectorAll('#grid .card.focus').forEach(c => c.classList.remove('focus'));
    carteDe(e).classList.add('focus');
  });

  const pin = carte.querySelector('[data-act="pin"]');
  pin?.addEventListener('click', e => {
    e.stopPropagation();
    basculerEpingle(offre, e.currentTarget);
  });
  activableAuClavier(pin, () => basculerEpingle(offre, pin));

  const suppr = carte.querySelector('[data-act="suppr"]');
  suppr?.addEventListener('click', e => {
    e.stopPropagation();
    ecarterOffre(offre, carteDe(e));
  });
  activableAuClavier(suppr, () => ecarterOffre(offre, suppr.closest('.card')));

  carte.querySelector('[data-act="analyser"]')?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    analyserMaintenant(offre, e.currentTarget);
  });

  const envoi = carte.querySelector('[data-act="postule"]');
  envoi?.addEventListener('click', (e) => {
    basculerEnvoi(offre, e.currentTarget);
  });
  activableAuClavier(envoi, () => basculerEnvoi(offre, envoi));

  carte.querySelectorAll('[data-champ]').forEach(el => {
    el.addEventListener('change', async () => {
      const champ = el.dataset.champ;
      const valeur = el.value;
      const champs = { [champ]: valeur };
      let message = champ === 'status' ? 'Statut : ' + valeur : null;
      const avant = etat.stats?.performance?.envoisSemaine ?? 0;

      // Passage à « Envoyé » depuis la liste déroulante : même logique.
      if (champ === 'status' && valeur === 'Envoyé') {
        if (!offre.suivi.sent) champs.sent = todayISO();
        if (!offre.suivi.relance) {
          champs.relance = dansNJours(options.relanceJours);
          message = `Envoyée — relance planifiée dans ${options.relanceJours} jours`;
        }
      }
      if (champ === 'status' && valeur === 'À postuler') {
        message = 'Remis à « À postuler » — date d\'envoi et relance effacées';
      }

      const r = await essayer(() => API.majSuivi(offre.id, champs), message, el);
      if (!r) return;
      appliquerSuivi(offre, r, champs);
      if (champ === 'status' && valeur === 'Entretien') feter(60);
      if (champ === 'status' || champ === 'relance' || champ === 'entretien' || champ === 'sent') {
        // Le statut change la couleur, la progression et l'onglet : on
        // redessine LA carte, pas la liste.
        if (champ === 'status') await rafraichirStats();
        rafraichirCarte(offre.id);
        rafraichirCompteurs();
        rappels?.rafraichir();
        if (champ === 'status') saluerObjectif(avant);
      } else {
        majBadgesNav(); rendreBandeau();
      }
    });
  });

  carte.querySelector('[data-act="lettre"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    ouvrirLettre(carteDe(e), offre, e.currentTarget);
  });

  carte.querySelector('[data-act="relance"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    ouvrirRelance(carteDe(e), offre, e.currentTarget);
  });

  carte.querySelector('[data-act="cvadapte"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    ouvrirCvAdapte(carteDe(e), offre, e.currentTarget);
  });

  carte.querySelector('[data-act="entretien"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    ouvrirEntretien(offre, toast);
  });

  carte.querySelector('[data-act="fiche"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    ouvrirFiche(offre, toast);
  });
}

/**
 * LE RENDU INCRÉMENTAL : une carte, pas la liste.
 *
 * Épingler, changer un statut, analyser — tout passait par `rendreTout()`,
 * qui reconstruisait les cinquante cartes. La lettre dépliée dans la carte
 * d'à côté se refermait, la relance qu'on venait de rédiger disparaissait, le
 * défilement sautait. Ici, seule la carte concernée est redessinée ; et si
 * elle porte elle-même une zone ouverte (lettre, relance, CV adapté), seul son
 * EN-TÊTE est remplacé.
 *
 * Rend vrai si la carte était affichée.
 */
function rafraichirCarte(id) {
  const offre = trouver(id);
  const ancienne = document.querySelector(`#grid .card[data-id="${CSS.escape(id)}"]`);
  if (!offre || !ancienne) return false;

  const ouverte = ancienne.classList.contains('open');
  const avaitFocus = ancienne.contains(document.activeElement);
  const neuve = rendreCarte(offre, { brancher: brancherCarte });
  neuve.style.animation = 'none';
  marquerOuverte(neuve, ouverte);
  if (ancienne.classList.contains('focus')) neuve.classList.add('focus');

  const zonesVives = [...ancienne.querySelectorAll('.letter-zone, .relance-zone, .cvadapte-zone')]
    .some(z => z.childElementCount > 0);

  if (zonesVives) {
    ancienne.querySelector('.head').replaceWith(neuve.querySelector('.head'));
    const garder = ['open', 'focus'].filter(c => ancienne.classList.contains(c));
    ancienne.className = neuve.className;
    garder.forEach(c => ancienne.classList.add(c));
    // Le bouton « Candidature envoyée » est dans le détail : on recopie son état.
    const t0 = ancienne.querySelector('.applied-toggle');
    const t1 = neuve.querySelector('.applied-toggle');
    if (t0 && t1) { t0.className = t1.className; t0.innerHTML = t1.innerHTML; }
    if (avaitFocus) ancienne.querySelector('.head')?.focus({ preventScroll: true });
    return true;
  }

  ancienne.replaceWith(neuve);
  if (avaitFocus) neuve.querySelector('.head')?.focus({ preventScroll: true });
  return true;
}

/** Après un changement qui ne touche qu'une offre : compteurs, badges, bandeau. */
function rafraichirCompteurs() {
  majBadgesNav();
  rendreBandeau();
  if (etat.vue === 'offers') majFiltresEtCompteurs();
  else rendreTout();
}

/** Les statistiques sont calculées côté serveur : on les redemande après coup. */
async function rafraichirStats() {
  try {
    const r = await API.stats();
    etat.stats = r.stats;
  } catch { /* le dashboard continue avec les chiffres précédents */ }
}

/** L'objectif de la semaine vient d'être atteint : on le dit, une fois. */
function saluerObjectif(avant) {
  const objectif = etat.meta?.objectifHebdo ?? 5;
  const apres = etat.stats?.performance?.envoisSemaine ?? 0;
  // L'anneau du tableau de bord progresse EN DIRECT, sans reconstruire la
  // vue (dashboard.js le met à jour en place).
  if (apres !== avant && etat.stats) {
    try { rendreHero(etat.stats, etat.offres, etat.meta); } catch { /* vue non montée */ }
  }
  if (avant < objectif && apres >= objectif) {
    feter(80);
    sonSucces();
    toast(`Objectif de la semaine atteint : ${apres} candidatures.`, 'win');
  }
}

// ------------------------------------------------------- gestes sur une offre

async function basculerEpingle(offre, el = null) {
  const r = await essayer(() => API.majSuivi(offre.id, { pinned: !offre.suivi.pinned }), null, el);
  if (!r) return;
  appliquerSuivi(offre, r);
  if (!rafraichirCarte(offre.id) && etat.vue === 'offers') rendreOffres();
  toast(offre.suivi.pinned ? 'Offre épinglée — elle remonte en tête au prochain tri' : 'Épingle retirée');
}

/**
 * Marque envoyée, ou revient à « À postuler ».
 *
 * Revenir en arrière, c'est dire « finalement je n'ai pas postulé » : le
 * serveur efface alors la date d'envoi et la relance qui allaient avec. Dans
 * l'autre sens, une relance est planifiée d'office — une candidature envoyée
 * sans relance finit oubliée.
 */
async function basculerEnvoi(offre, el = null) {
  const versEnvoye = offre.suivi.status === 'À postuler';
  const champs = versEnvoye
    ? { status: 'Envoyé', sent: offre.suivi.sent || todayISO() }
    : { status: 'À postuler' };
  let relanceAjoutee = false;
  if (versEnvoye && !offre.suivi.relance) {
    champs.relance = dansNJours(options.relanceJours);
    relanceAjoutee = true;
  }
  const avant = etat.stats?.performance?.envoisSemaine ?? 0;

  const r = await essayer(() => API.majSuivi(offre.id, champs),
    versEnvoye
      ? (relanceAjoutee ? `Envoyée — relance planifiée dans ${options.relanceJours} jours` : 'Marquée comme envoyée')
      : 'Remis à « À postuler » — date d\'envoi et relance effacées',
    el);

  if (!r) {
    // Un échec doit ramener l'écran à ce qui est réellement enregistré, sans
    // quoi on croit avoir postulé.
    await chargerDonnees();
    rendreTout();
    return false;
  }
  appliquerSuivi(offre, r, champs);
  if (versEnvoye) sonSucces();
  await rafraichirStats();
  rafraichirCarte(offre.id);
  rafraichirCompteurs();
  rappels?.rafraichir();
  // LA COCHE SE DESSINE. Le passage à « Envoyé » est LE geste de
  // l'application : il mérite mieux qu'un changement de libellé.
  if (versEnvoye) {
    document.querySelector(`#grid .card[data-id="${CSS.escape(offre.id)}"] .applied-toggle`)
      ?.classList.add('coche-anim');
    saluerObjectif(avant);
  }
  return true;
}

/**
 * Écarte une offre (ou supprime une saisie manuelle).
 *
 * La carte s'en va SEULE : le reste de la liste ne bouge pas, et les
 * compteurs se mettent à jour sans reconstruire les cartes voisines.
 */
async function ecarterOffre(offre, carte = null) {
  // Une offre saisie à la main n'a pas de sauvegarde : la supprimer est
  // définitif, et cela mérite une confirmation. Une offre collectée se remet
  // d'un clic — demander ET offrir l'annulation ferait payer deux fois.
  if (offre.isManual) {
    const ok = await confirmer({
      titre: `Supprimer « ${offre.titre} » ?`,
      message: 'Cette offre a été saisie à la main : elle n\'a pas de copie ailleurs. La suppression est définitive.',
      ok: 'Supprimer', danger: true,
    });
    if (!ok) return;
  }

  const r = await essayer(() => API.supprimerOffre(offre.id));
  if (!r) return;

  if (r.annulable) {
    toast(`« ${offre.titre.slice(0, 42)} » écartée`, '', {
      libelle: 'Annuler',
      faire: async () => {
        await essayer(() => API.restaurerOffre(offre.id), 'Offre remise dans la liste');
        await chargerDonnees();
        rendreTout();
      },
    });
  } else {
    toast('Offre supprimée');
  }

  etat.offres = etat.offres.filter(o => o.id !== offre.id);
  etat.ouvertes.delete(offre.id);
  const el = carte ?? document.querySelector(`#grid .card[data-id="${CSS.escape(offre.id)}"]`);
  if (el) {
    // La carte s'en va avant le rafraîchissement : montrer LAQUELLE part
    // vaut mieux qu'une liste qui se réorganise sans prévenir.
    const suivante = el.nextElementSibling;
    el.classList.add('part');
    await new Promise(ok => setTimeout(ok, mouvementCoupe() ? 0 : 340));
    el.remove();
    if (suivante?.classList.contains('card') && el.classList.contains('focus')) {
      suivante.classList.add('focus');
      suivante.querySelector('.head')?.focus({ preventScroll: true });
    }
  }
  rafraichirCompteurs();
  rappels?.rafraichir();
}

/**
 * « ANALYSER MAINTENANT » (contrat §3.2).
 *
 * Une offre sans analyse disait « elle sera retentée à la prochaine
 * collecte » — c'est-à-dire dans six heures, ou demain. L'analyse est
 * relancée à la demande, comptée dans le quota, et la carte se redessine
 * avec son verdict sans que la liste bouge.
 */
async function analyserMaintenant(offre, bouton = null) {
  const libelle = bouton?.innerHTML;
  if (bouton) { bouton.disabled = true; bouton.innerHTML = '<span class="spinner"></span> Analyse…'; }
  // Le squelette se pose là où le verdict va tomber : une analyse prend dix
  // à vingt secondes, il faut voir que quelque chose arrive.
  const zone = bouton?.closest('.card')?.querySelector('.analyse-zone');
  if (zone) zone.innerHTML = SQUELETTE_TEXTE;
  try {
    const r = await API.analyserOffre(offre.id);
    if (r.analyse) offre.analyse = r.analyse;
    if (r.quota && etat.meta) etat.meta.quota = r.quota;
    etat.ouvertes.add(offre.id);
    rafraichirCarte(offre.id);
    const carte = document.querySelector(`#grid .card[data-id="${CSS.escape(offre.id)}"]`);
    if (carte) marquerOuverte(carte, true);
    const verdict = carte?.querySelector('.verdict');
    if (verdict) revelerNoeud(verdict);
    toast('Analyse terminée', 'win');
    focus?.rafraichir();
  } catch (err) {
    if (zone) zone.innerHTML = '';
    // 503 : quota du jour ou Gemini indisponible ; 400 : pas de clé ou pas de
    // CV. Le serveur dit lequel en français — on le relaie tel quel.
    toast(err.statut === 503 && !err.donnees?.error
      ? 'Gemini est indisponible ou le quota du jour est épuisé — réessaie plus tard.'
      : err.message, 'err');
    reagir(bouton, 'err');
    if (bouton) { bouton.disabled = false; bouton.innerHTML = libelle; }
  }
}

/** Les actions d'une offre, pour la palette (→ sur un résultat). */
function actionsOffre(offre) {
  const envoyee = offre.suivi.status !== 'À postuler';
  return [
    { id: 'ouvrir', titre: 'Ouvrir l\'offre', ic: 'fleche', faire: () => ouvrirOffre(offre) },
    { id: 'pin', titre: offre.suivi.pinned ? 'Désépingler' : 'Épingler', ic: 'epingle', raccourci: 'P', faire: () => basculerEpingle(offre) },
    !envoyee && { id: 'envoyer', titre: 'Marquer comme envoyée', ic: 'envoi', raccourci: 'E', faire: () => basculerEnvoi(offre) },
    { id: 'lettre', titre: offre.aLettre ? 'Afficher la lettre' : 'Rédiger la lettre', ic: 'plume', raccourci: 'L', faire: () => lettreDepuisAilleurs(offre) },
    !offre.analyse && { id: 'analyser', titre: 'Analyser maintenant', ic: 'analyse', faire: () => analyserMaintenant(offre) },
    offre.lien && { id: 'annonce', titre: 'Ouvrir l\'annonce d\'origine', ic: 'externe', faire: () => window.open(offre.lien, '_blank', 'noopener') },
    offre.lien && { id: 'copier', titre: 'Copier le lien de l\'annonce', ic: 'copier',
      faire: () => navigator.clipboard.writeText(offre.lien).then(() => toast('Lien copié')) },
    envoyee && { id: 'entretien', titre: 'Préparer l\'entretien', ic: 'cible', faire: () => ouvrirEntretien(offre, toast) },
    { id: 'ecarter', titre: offre.isManual ? 'Supprimer l\'offre' : 'Écarter l\'offre', ic: 'poubelle', raccourci: 'X', danger: true, faire: () => ecarterOffre(offre) },
  ].filter(Boolean);
}

/** Ouvre l'offre dans la liste, puis sa lettre. */
function lettreDepuisAilleurs(offre) {
  ouvrirOffre(offre);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const carte = document.querySelector(`#grid .card[data-id="${CSS.escape(offre.id)}"]`);
    const b = carte?.querySelector('[data-act="lettre"]');
    if (carte && b && carte.querySelector('.letter-zone')?.dataset.ouverte !== '1') ouvrirLettre(carte, offre, b);
  }));
}

/** Les gestes clavier sur la carte courante (voir clavier.js). */
function actionCarte(carte, quoi) {
  const offre = trouver(carte.dataset.id);
  if (!offre) return;
  if (quoi === 'basculer') basculerCarte(carte, offre);
  if (quoi === 'epingler') basculerEpingle(offre, carte.querySelector('[data-act="pin"]'));
  if (quoi === 'envoyer') basculerEnvoi(offre, carte.querySelector('[data-act="postule"]') ?? carte);
  if (quoi === 'ecarter') ecarterOffre(offre, carte);
  if (quoi === 'lettre') {
    if (!carte.classList.contains('open')) basculerCarte(carte, offre);
    const b = carte.querySelector('[data-act="lettre"]');
    if (b && carte.querySelector('.letter-zone')?.dataset.ouverte !== '1') ouvrirLettre(carte, offre, b);
    else carte.querySelector('.letter-area')?.focus();
  }
}

// --------------------------------------------------- zones rédigées par Gemini

/** Le squelette d'un texte en cours de rédaction : quelques lignes qui respirent. */
const SQUELETTE_TEXTE = `<div class="skel-texte" aria-hidden="true">
  <div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel court"></div></div>`;

/**
 * Rédige et affiche la relance, avec de quoi la copier.
 *
 * Rien n'est enregistré : une relance se copie et part de la messagerie de
 * l'utilisateur. On la régénère à volonté.
 */
async function ouvrirRelance(carte, offre, bouton) {
  const zone = carte.querySelector('.relance-zone');
  if (!zone) return;

  const libelle = bouton.innerHTML;
  bouton.disabled = true;
  bouton.innerHTML = icone('plume', 14) + ' Rédaction…';
  zone.innerHTML = SQUELETTE_TEXTE;
  try {
    const r = await API.relance(offre.id);
    zone.innerHTML = `
      <div class="relance-mail">
        <div class="relance-champ">
          <span class="relance-etiq">Objet</span>
          <span class="relance-objet">${echapper(r.objet)}</span>
          <button class="btn btn-mini" data-copier-objet>${icone('copier', 13)} Copier</button>
        </div>
        <pre class="relance-corps">${echapper(r.corps)}</pre>
        <div class="relance-pied">
          <button class="btn btn-primary btn-mini" data-copier-corps>${icone('copier', 13)} Copier le message</button>
          <button class="btn btn-mini" data-relancer>${icone('rafraichir', 13)} Régénérer</button>
          <span class="sp-note">Candidature envoyée il y a ${r.jours} j · rien n'est enregistré</span>
        </div>
      </div>`;
    revelerNoeud(zone.querySelector('.relance-corps'));
    zone.querySelector('[data-copier-objet]')?.addEventListener('click', () => {
      navigator.clipboard.writeText(r.objet).then(() => toast('Objet copié.'));
    });
    zone.querySelector('[data-copier-corps]')?.addEventListener('click', () => {
      navigator.clipboard.writeText(r.corps).then(() => toast('Message copié — colle-le dans ta messagerie.'));
    });
    zone.querySelector('[data-relancer]')?.addEventListener('click', () => {
      ouvrirRelance(carte, offre, bouton);
    });
  } catch (err) {
    zone.innerHTML = '';
    toast(err.message, 'err');
    reagir(bouton, 'err');
  } finally {
    bouton.disabled = false;
    bouton.innerHTML = libelle;
  }
}

/**
 * Adapte le CV à l'offre et montre l'écart : ce que l'offre exige et que le
 * CV ne prouve pas, puis le CV taillé, copiable.
 */
async function ouvrirCvAdapte(carte, offre, bouton) {
  const zone = carte.querySelector('.cvadapte-zone');
  if (!zone) return;

  const libelle = bouton.innerHTML;
  bouton.disabled = true;
  bouton.innerHTML = icone('cible', 14) + ' Adaptation…';
  zone.innerHTML = SQUELETTE_TEXTE;
  try {
    const r = await API.cvAdapte(offre.id);
    const a = r.adapte;
    const ec = r.ecart ?? { manques: [], motsCles: [] };
    const puces = (liste) => liste.map(x => `<li>${echapper(x)}</li>`).join('');
    const aCopier = [
      a.accroche,
      '',
      ...a.points.map(p => `• ${p}`),
      ...(a.forces.length ? ['', 'Atouts : ' + a.forces.join(' · ')] : []),
    ].join('\n');

    zone.innerHTML = `
      ${(ec.manques.length || ec.motsCles.length) ? `
      <div class="cva-ecart">
        <div class="cva-titre">Ce que l'offre demande et que ton CV ne montre pas</div>
        ${ec.manques.length ? `<ul class="cva-manques">${puces(ec.manques)}</ul>` : ''}
        ${ec.motsCles.length ? `<div class="cva-kw">Mots-clés absents :
          ${ec.motsCles.map(k => `<span class="cva-tag">${echapper(k)}</span>`).join('')}</div>` : ''}
        <p class="sp-note">À combler, à contourner en entretien, ou à assumer — mais à savoir avant d'envoyer.</p>
      </div>` : ''}

      <div class="cva-cv">
        <div class="cva-titre">Ton CV, taillé pour ce poste</div>
        <p class="cva-accroche">${echapper(a.accroche)}</p>
        <ul class="cva-points">${puces(a.points)}</ul>
        ${a.forces.length ? `<div class="cva-forces">
          ${a.forces.map(f => `<span class="cva-tag fort">${echapper(f)}</span>`).join('')}</div>` : ''}
        <div class="relance-pied">
          <button class="btn btn-primary btn-mini" data-copier-cv>${icone('copier', 13)} Copier</button>
          <button class="btn btn-mini" data-refaire>${icone('rafraichir', 13)} Régénérer</button>
          <span class="sp-note">Réordonné depuis ton CV — rien d'inventé.</span>
        </div>
      </div>`;
    revelerNoeud(zone.querySelector('.cva-cv'));

    zone.querySelector('[data-copier-cv]')?.addEventListener('click', () => {
      navigator.clipboard.writeText(aCopier).then(() => toast('CV adapté copié.'));
    });
    zone.querySelector('[data-refaire]')?.addEventListener('click', () => {
      ouvrirCvAdapte(carte, offre, bouton);
    });
  } catch (err) {
    zone.innerHTML = '';
    toast(err.message, 'err');
    reagir(bouton, 'err');
  } finally {
    bouton.disabled = false;
    bouton.innerHTML = libelle;
  }
}

// ------------------------------------------------------ lettre de motivation

async function ouvrirLettre(carte, offre, bouton) {
  const zone = carte.querySelector('.letter-zone');

  // Déjà affichée : on referme.
  if (zone.dataset.ouverte === '1') {
    zone.innerHTML = '';
    zone.dataset.ouverte = '';
    bouton.innerHTML = icone('plume', 14) + (offre.aLettre ? ' Afficher la lettre' : ' Rédiger la lettre');
    return;
  }

  const libelleInitial = bouton.innerHTML;
  const dejaEcrite = offre.aLettre;
  bouton.disabled = true;
  bouton.innerHTML = '<span class="spinner"></span> ' + (dejaEcrite ? 'Ouverture…' : 'Rédaction en cours…');
  // Une génération prend dix secondes : un squelette dit où le texte va
  // tomber. Une lettre déjà écrite, elle, revient en un instant.
  if (!dejaEcrite) zone.innerHTML = SQUELETTE_TEXTE;

  let lettre = null;
  try {
    lettre = dejaEcrite ? await API.lettre(offre.id) : await API.genererLettre(offre.id);
  } catch (erreur) {
    zone.innerHTML = '';
    toast(erreur.message, 'err');
    reagir(bouton, 'err');
    bouton.disabled = false;
    bouton.innerHTML = libelleInitial;
    return;
  }

  offre.aLettre = true;
  bouton.disabled = false;
  bouton.innerHTML = icone('plume', 14) + ' Masquer la lettre';
  zone.dataset.ouverte = '1';

  zone.innerHTML = `
    <textarea class="letter-area" aria-label="Lettre de motivation"></textarea>
    <div class="letter-hint">Modifie librement le texte : tes retouches sont enregistrées automatiquement.<br>
      <strong>Dossier complet</strong> = la lettre + ton CV, dans un seul fichier à joindre au mail.</div>
    <div class="letter-actions" style="margin-top:10px">
      <a class="btn btn-primary" data-l="dossier" href="${API.urlDossier(offre.id)}">${icone('document', 14)} Dossier complet</a>
      <a class="btn" data-l="docx" href="${API.urlDocx(offre.id)}">${icone('parchemin', 14)} Lettre seule</a>
      <button class="btn" data-l="copier">${icone('copier', 14)} Copier</button>
      <button class="btn" data-l="regen">${icone('rafraichir', 14)} Régénérer</button>
      <button class="btn btn-discret" data-l="versions" aria-expanded="false">${icone('historique', 14)} Versions</button>
    </div>
    <div class="lettre-versions" hidden></div>`;

  const zoneTexte = zone.querySelector('.letter-area');
  // La frappe seulement pour un texte NEUF : rouvrir une lettre déjà écrite
  // n'est pas un événement.
  if (dejaEcrite) zoneTexte.value = lettre.contenu;
  else taperChamp(zoneTexte, lettre.contenu);

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
    bRegen.innerHTML = '<span class="spinner"></span> Rédaction…';
    try {
      const r = await API.genererLettre(offre.id, { regenerer: true });
      taperChamp(zoneTexte, r.contenu);
      toast('Nouvelle lettre rédigée');
    } catch (erreur) {
      if (erreur.besoinConfirmation) {
        const ok = await confirmer({
          titre: 'Remplacer ta lettre retouchée ?',
          message: erreur.message,
          ok: 'Régénérer quand même', danger: true,
        });
        if (ok) {
          const r = await essayer(() => API.genererLettre(offre.id, { regenerer: true, confirmerEcrasement: true }),
            'Nouvelle lettre rédigée', bRegen);
          if (r) taperChamp(zoneTexte, r.contenu);
        }
      } else {
        toast(erreur.message, 'err');
        reagir(bRegen, 'err');
      }
    } finally {
      bRegen.disabled = false;
      bRegen.innerHTML = `${icone('rafraichir', 14)} Régénérer`;
    }
  });

  zone.querySelector('[data-l="versions"]').addEventListener('click', (e) =>
    basculerVersions(offre, zone, zoneTexte, e.currentTarget));
}

/**
 * L'HISTORIQUE DES VERSIONS DE LA LETTRE (contrat §3.5).
 *
 * « Régénérer » écrasait la lettre précédente, et une retouche malheureuse
 * ne se défaisait pas : la bonne version du matin était perdue. Le serveur
 * garde chaque génération et chaque retouche ; on les liste ici, à la
 * demande — jamais en ouvrant la lettre, qui n'a pas à payer une requête de
 * plus pour un historique qu'on consulte rarement.
 */
async function basculerVersions(offre, zone, zoneTexte, bouton) {
  const panneau = zone.querySelector('.lettre-versions');
  if (!panneau.hidden) { panneau.hidden = true; bouton.setAttribute('aria-expanded', 'false'); return; }
  panneau.hidden = false;
  bouton.setAttribute('aria-expanded', 'true');
  panneau.innerHTML = '<div class="skel skel-court"></div><div class="skel skel-court"></div>';
  let versions = [];
  try {
    versions = (await API.lettreVersions(offre.id)).versions ?? [];
  } catch (err) {
    panneau.innerHTML = `<p class="lv-vide">${err.statut === 404
      ? 'L\'historique des versions n\'est pas encore proposé par le serveur.'
      : echapper(err.message)}</p>`;
    return;
  }
  if (!versions.length) {
    panneau.innerHTML = '<p class="lv-vide">Une seule version pour l\'instant : chaque régénération et chaque retouche s\'ajouteront ici.</p>';
    return;
  }
  const quand = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  panneau.innerHTML = `<ol class="lv-liste">${versions.map(v => `
    <li class="lv">
      <span class="lv-n">v${v.version}</span>
      <span class="lv-corps"><span class="lv-meta">${v.origine === 'retouche' ? 'Retouche' : 'Générée'} · ${echapper(quand(v.creeLe))}</span>
        <span class="lv-apercu">${echapper(v.apercu ?? '')}</span></span>
      <button type="button" class="btn btn-mini" data-v="${v.version}">${icone('retour', 12)} Restaurer</button>
    </li>`).join('')}</ol>`;
  panneau.onclick = async (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    const precedent = zoneTexte.value;
    b.disabled = true;
    const r = await essayer(() => API.restaurerVersionLettre(offre.id, b.dataset.v), null, b);
    b.disabled = false;
    if (!r) return;
    taperChamp(zoneTexte, r.contenu);
    toast(`Version ${b.dataset.v} restaurée`, '', {
      libelle: 'Annuler',
      faire: async () => {
        const ok = await essayer(() => API.majLettre(offre.id, precedent));
        if (ok) zoneTexte.value = precedent;
      },
    });
  };
}

// ------------------------------------------------------------------- kanban

async function deposerKanban(id, statut) {
  const offre = trouver(id);
  if (!offre || offre.suivi.status === statut) return;

  const champs = { status: statut };
  let message = `Déplacé vers « ${statut} »`;
  const avant = etat.stats?.performance?.envoisSemaine ?? 0;

  if (statut === 'Envoyé') {
    if (!offre.suivi.sent) champs.sent = todayISO();
    if (!offre.suivi.relance) {
      champs.relance = dansNJours(options.relanceJours);
      message = `Envoyée — relance planifiée dans ${options.relanceJours} jours`;
    }
  }
  if (statut === 'À postuler') {
    message = 'Remis à « À postuler » — date d\'envoi et relance effacées';
  }

  const r = await essayer(() => API.majSuivi(id, champs), message,
    document.querySelector(`.kcard[data-id="${id}"]`));
  if (r) {
    appliquerSuivi(offre, r, champs);
    if (statut === 'Entretien') feter(60);
    await rafraichirStats();
    rendreTout();
    saluerObjectif(avant);
    rappels?.rafraichir();
    // Le Kanban déplace la carte AVANT la réponse du serveur : il a besoin
    // de savoir si le geste a tenu, pour la laisser ou la ramener.
    return true;
  }

  // ÉCHEC : ON REDESSINE, POUR QUE L'ÉCRAN NE MENTE PAS. Une carte déposée
  // dans « Envoyé » alors que le serveur ne répond pas restait affichée dans
  // sa nouvelle colonne : on croyait avoir postulé.
  await chargerDonnees();
  rendreTout();
  return false;
}

// ---------------------------------------------------------------- collecter

function lancerCollecte() {
  collecte?.lancer();
}

document.getElementById('refreshBtn').addEventListener('click', () => lancerCollecte());
document.getElementById('refreshBtn2').addEventListener('click', () => lancerCollecte());

function ajouterOffre() {
  changerVue('offers', { transition: false });
  document.getElementById('form').classList.add('show');
  document.getElementById('f-titre').focus();
}
document.getElementById('quickAdd').addEventListener('click', ajouterOffre);

// ------------------------------------------------------------ barre d'outils

document.getElementById('villes').addEventListener('click', e => {
  const b = e.target.closest('.ville');
  if (b) choisirVille(b.dataset.v);
});

document.getElementById('segGroupe').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('#segGroupe button').forEach(x => {
    x.classList.toggle('active', x === b);
    x.setAttribute('aria-pressed', String(x === b));
  });
  etat.filtre = b.dataset.g;
  rendreOffresDepuisLeDebut();
});

// Drapeaux secondaires : cumulables entre eux, et avec un groupe.
document.getElementById('chips').addEventListener('click', e => {
  const c = e.target.closest('.chip');
  if (!c) return;
  if (c.dataset.f === 'source') { etat.source = null; rendreOffresDepuisLeDebut(); return; }
  const actif = !c.classList.contains('active');
  c.classList.toggle('active', actif);
  c.setAttribute('aria-pressed', String(actif));
  if (actif) etat.drapeaux.add(c.dataset.f);
  else etat.drapeaux.delete(c.dataset.f);
  rendreOffresDepuisLeDebut();
});

document.getElementById('plusOffres').addEventListener('click', () => {
  const avant = document.querySelectorAll('#grid .card').length;
  etat.limite += PAR_PAGE;
  rendreOffres();
  // On revient sur la première carte ajoutée, pas en haut de page.
  document.querySelectorAll('#grid .card')[avant]
    ?.scrollIntoView({ behavior: mouvementCoupe() ? 'auto' : 'smooth', block: 'center' });
});

/**
 * LA RECHERCHE ATTEND LA FIN DE LA FRAPPE.
 *
 * Chaque lettre reconstruisait la liste — filtre, tri, cinquante cartes.
 * Taper « urbanisme » faisait neuf rendus complets, dont huit périmés avant
 * d'avoir fini de s'afficher : la saisie accrochait. On attend 140 ms de
 * silence, ce qui reste imperceptible à l'œil.
 */
let attenteRecherche = 0;
document.getElementById('search').addEventListener('input', e => {
  clearTimeout(attenteRecherche);
  const valeur = e.target.value;
  attenteRecherche = setTimeout(() => { etat.recherche = valeur; rendreOffresDepuisLeDebut(); }, 140);
});
document.getElementById('sort').addEventListener('change', e => { etat.tri = e.target.value; rendreOffresDepuisLeDebut(); });
document.getElementById('statusFilter').addEventListener('change', e => {
  etat.statut = e.target.value;

  // UN FILTRE NE DOIT PAS POUVOIR DEMANDER L'IMPOSSIBLE. Une ville ne contient
  // QUE des offres « À postuler » : choisir un statut d'après-envoi, c'est
  // dire « montre-moi mes candidatures ». On va donc où elles sont.
  const apresEnvoi = etat.statut !== 'all' && etat.statut !== 'À postuler';
  if (apresEnvoi && etat.ville !== ONGLET_ENVOYEES) {
    choisirVille(ONGLET_ENVOYEES);
    toast(`Les offres « ${etat.statut} » sont dans l'onglet Envoyées`);
    return;
  }
  rendreOffresDepuisLeDebut();
});

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
  if (!v('f-titre') || !v('f-entreprise')) {
    toast('Titre et entreprise sont obligatoires.', 'err');
    reagir(document.getElementById(!v('f-titre') ? 'f-titre' : 'f-entreprise'), 'err');
    return;
  }

  const r = await essayer(() => API.ajouterOffre({
    titre: v('f-titre'), entreprise: v('f-entreprise'), ville: v('f-ville'),
    date: v('f-date'), contrat: v('f-contrat'),
    groupe: document.getElementById('f-groupe').value,
    lien: v('f-lien'), verdict: v('f-verdict'),
  }), 'Offre ajoutée', e.currentTarget);

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
  if (zone.value.trim().length < 100) {
    toast('Colle l\'annonce complète (au moins quelques lignes).', 'err');
    reagir(zone, 'err');
    return;
  }

  const libelle = bouton.innerHTML;
  bouton.disabled = true;
  bouton.innerHTML = '<span class="spinner"></span> Analyse en cours…';
  try {
    const r = await API.collerOffre(zone.value);
    zone.value = '';
    formulaire.classList.remove('show');
    await chargerDonnees();
    rendreTout();
    toast(`« ${r.titre} » ajoutée et classée « ${GM[r.groupe]?.label ?? 'À vérifier'} »`, 'win');
  } catch (erreur) {
    toast(erreur.message, 'err');
    reagir(bouton, 'err');
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
  // Le nom du fichier suit celui du profil.
  const qui = String(etat.meta?.candidat ?? '').trim()
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  telecharger(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }),
    qui ? `candidatures_${qui}.csv` : 'candidatures.csv');
  toast('Export CSV téléchargé');
});

document.getElementById('pdfBtn').addEventListener('click', () => {
  // L'export porte sur TOUT le suivi, pas sur l'onglet ni les filtres en cours.
  const r = imprimerSuivi(etat.offres, { nom: etat.meta?.candidat ?? '' });
  if (r.ok) toast(`${pluriel(r.total, 'ligne')} — choisis « Enregistrer au format PDF »`);
  else toast(r.message, 'err');
});

document.getElementById('bilanBtn').addEventListener('click', () => {
  const r = imprimerRapport(etat.offres, etat.stats, { nom: etat.meta?.candidat ?? '' });
  if (r.ok) toast('Bilan de la semaine — choisis « Enregistrer au format PDF »');
  else toast(r.message, 'err');
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
  document.getElementById('optIntro').checked = options.intro;
  document.getElementById('optSons').checked = sonsActifs();
  document.getElementById('optRelance').value = options.relanceJours;
  document.getElementById('optMasquer').checked = options.masquerEcartees;
  document.getElementById('optTheme').value = racine.dataset.themeChoix ?? racine.dataset.theme;
  document.getElementById('goalInput').value = etat.meta?.objectifHebdo ?? 5;
  rendreNotifOption();
  rendreQuota();

  document.getElementById('optSources').innerHTML = (etat.meta?.sources ?? [])
    .map(s => `<div class="src-row ${s.configuree ? 'on' : ''}">
      <span class="pastille"></span>
      <span>${SOURCE_LABEL[s.nom] ?? s.nom}</span>
      <span class="etat">${s.configuree ? 'active' : 'non configurée'}</span>
    </div>`).join('') || '<div class="gr-vide">Aucune source déclarée.</div>';
}

/**
 * Ce que la vue Options lit sur le serveur, UNE FOIS par arrivée sur la vue :
 * le nombre d'offres écartées, la liste des sauvegardes, la disponibilité de
 * l'export agenda. Avant, `rendreOptions` relançait la requête des écartées à
 * chaque `rendreTout()` — chaque bascule d'interrupteur coûtait un aller-retour.
 */
function chargerOptionsDistantes() {
  API.rejetees()
    .then(r => {
      const n = r.rejetees?.length ?? 0;
      document.getElementById('optRejetNb').textContent = n
        ? `Actuellement ${pluriel(n, 'offre')} écartée${n > 1 ? 's' : ''}.`
        : 'Aucune pour le moment.';
    })
    .catch(() => { /* l'option reste utilisable sans le compte */ });
  rendreSauvegardes();
  // L'export agenda : un lien, mais qui ne doit pas télécharger une page
  // d'erreur sur un serveur qui ne le propose pas encore.
  fetch(API.urlIcs, { method: 'HEAD' }).then(r => {
    const lien = document.getElementById('optIcs');
    lien.classList.toggle('indispo', !r.ok);
    lien.setAttribute('aria-disabled', String(!r.ok));
    lien.title = r.ok ? '' : 'Pas encore proposé par le serveur';
  }).catch(() => {});
}

async function rendreSauvegardes() {
  const liste = document.getElementById('optSauvListe');
  const dossier = document.getElementById('optSauvDossier');
  const bouton = document.getElementById('optSauver');
  liste.innerHTML = '<li><div class="skel skel-court"></div></li>';
  try {
    const r = await API.sauvegardes();
    const s = r.sauvegardes ?? [];
    if (r.dossier) dossier.innerHTML = `Une copie de <code>data.db</code> est faite à la fin de chaque collecte, dans <code>${echapper(r.dossier)}</code>.`;
    const taille = (o) => (o >= 1048576 ? `${(o / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);
    const quand = (iso) => {
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
    };
    liste.innerHTML = s.length
      ? s.slice(0, 8).map(x => `<li><span class="sv-nom">${echapper(x.nom)}</span>
          <span class="sv-meta">${echapper(quand(x.date))} · ${taille(x.tailleOctets ?? 0)}</span></li>`).join('')
        + (s.length > 8 ? `<li class="sv-plus">et ${s.length - 8} plus anciennes</li>` : '')
      : '<li class="sv-plus">Aucune sauvegarde pour l\'instant.</li>';
    bouton.disabled = false;
  } catch (err) {
    liste.innerHTML = `<li class="sv-plus">${err.statut === 404
      ? 'La liste des sauvegardes n\'est pas encore proposée par le serveur.' : echapper(err.message)}</li>`;
    bouton.disabled = err.statut === 404;
  }
}

document.getElementById('optSauver').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  const r = await essayer(() => API.creerSauvegarde(), null, b);
  b.disabled = false;
  if (r) { toast(`Sauvegarde faite : ${r.nom}`, 'win'); rendreSauvegardes(); }
});

/** L'état de la permission de notification, dit en clair. */
function rendreNotifOption() {
  const etatTxt = document.getElementById('optNotifEtat');
  const b = document.getElementById('optNotif');
  if (typeof Notification === 'undefined') {
    etatTxt.textContent = 'Ce navigateur ne les propose pas.';
    b.disabled = true;
    return;
  }
  const p = Notification.permission;
  etatTxt.textContent = p === 'granted' ? 'Autorisées.' : p === 'denied'
    ? 'Refusées — à réautoriser dans les réglages du navigateur (cadenas de la barre d\'adresse).' : '';
  b.disabled = p !== 'default';
  b.innerHTML = `${icone(p === 'granted' ? 'coche' : 'cloche', 15)} ${p === 'granted' ? 'Autorisées' : 'Autoriser'}`;
}

document.getElementById('optNotif').addEventListener('click', async () => {
  try { await Notification.requestPermission(); } catch { /* ancien navigateur */ }
  rendreNotifOption();
  if (Notification.permission === 'granted') {
    toast('Notifications activées : tu seras prévenu des relances et des entretiens.', 'win');
    rappels?.rafraichir();
  }
});

/**
 * Barre de consommation du quota du jour : analyses, lettres, réserve.
 */
function rendreQuota() {
  const q = etat.meta?.quota;
  const zone = document.getElementById('quotaBarre');
  const cote = document.getElementById('quotaJour');
  if (!q) { zone.innerHTML = '<div class="gr-vide">Quota inconnu.</div>'; cote.textContent = ''; return; }

  const pc = (n) => Math.round(1000 * n / q.quotaJournalier) / 10;
  const libre = Math.max(0, q.quotaJournalier - q.total - q.reserveLettres);

  cote.textContent = `${q.total} / ${q.quotaJournalier} appels`;

  zone.innerHTML = `
    <div class="quota-barre">
      <span class="qs analyses" style="width:${pc(q.analyses)}%" title="${pluriel(q.analyses, 'analyse')}"></span>
      <span class="qs lettres"  style="width:${pc(q.lettres)}%"  title="${pluriel(q.lettres, 'lettre')}"></span>
      <span class="qs libre"    style="width:${pc(libre)}%"      title="disponible pour l'analyse"></span>
      <span class="qs reserve"  style="width:${pc(q.reserveLettres)}%" title="réservé aux lettres"></span>
    </div>
    <div class="quota-legende">
      <span><i class="analyses"></i> ${q.analyses} analyses</span>
      <span><i class="lettres"></i> ${q.lettres} lettres</span>
      ${q.entretiens != null ? `<span><i class="lettres"></i> ${q.entretiens} entretiens</span>` : ''}
      ${q.chat != null ? `<span><i class="lettres"></i> ${q.chat} messages au compagnon</span>` : ''}
      <span><i class="libre"></i> ${libre} encore analysables</span>
      <span><i class="reserve"></i> ${q.reserveLettres} réservés aux lettres</span>
      ${q.reserveChat != null ? `<span><i class="reserve"></i> ${q.reserveChat} réservés à la discussion${q.restantChat != null ? ` (${q.restantChat} restants)` : ''}</span>` : ''}
    </div>
    ${q.analyseFermee
      ? `<div class="quota-alerte">${icone('alerte', 14)} Google a refusé une analyse aujourd'hui. L'analyse est fermée jusqu'à demain — tout ce qui reste est gardé pour les lettres.</div>`
      : q.restantLettres === 0
        ? `<div class="quota-alerte">${icone('alerte', 14)} Quota épuisé, lettres comprises. Il se renouvelle demain.</div>`
        : `<div class="quota-ok">${icone('coche', 14)} ${pluriel(q.restantLettres, 'lettre')} encore rédigeable${q.restantLettres > 1 ? 's' : ''} aujourd'hui.</div>`}`;
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
brancherOption('optIntro', 'intro', el => el.checked,
  v => v ? 'L\'ouverture jouera au prochain lancement' : 'Ouverture désactivée');
brancherOption('optMasquer', 'masquerEcartees', el => el.checked,
  v => v ? 'Les offres à écarter sont masquées' : 'Toutes les offres sont affichées');

document.getElementById('optRelance').addEventListener('change', e => {
  const v = Number(e.target.value);
  if (!Number.isInteger(v) || v < 1 || v > 60) {
    toast('Choisis un nombre entre 1 et 60.', 'err');
    reagir(e.target, 'err');
    e.target.value = options.relanceJours;
    return;
  }
  options.relanceJours = v;
  appliquerOptions();
  toast(`Relance proposée ${v} jours après l'envoi`);
});

// Les sons gèrent leur propre réglage (localStorage, dans sons.js).
document.getElementById('optSons').addEventListener('change', e => {
  reglerSons(e.target.checked);
  if (e.target.checked) sonNav();
  toast(e.target.checked ? 'Sons activés' : 'Sons coupés');
});

document.getElementById('optTheme').addEventListener('change', e =>
  appliquerTheme(e.target.value, { transition: true, apres: rendreTout }));

document.getElementById('optTutoriel').addEventListener('click',
  () => lancerTutoriel({ allerA: (v) => changerVue(v, { transition: false }), forcer: true }));

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

document.getElementById('optOublierRejets').addEventListener('click', async (e) => {
  const ok = await confirmer({
    titre: 'Remettre en circulation toutes les offres écartées ?',
    message: 'Elles reviendront à la prochaine collecte si les sources les publient encore.',
    ok: 'Tout remettre',
  });
  if (!ok) return;
  const r = await essayer(() => API.oublierRejets(), null, e.currentTarget);
  if (r) {
    toast(r.oubliees ? `${r.oubliees} offre(s) remise(s) en circulation` : 'Aucune offre écartée');
    chargerOptionsDistantes();
  }
});

document.getElementById('optResetHisto').addEventListener('click', async (e) => {
  const ok = await confirmer({
    titre: 'Effacer l\'historique d\'activité ?',
    message: 'Le journal des actions et le calendrier d\'assiduité seront vidés. Tes offres, ton suivi et tes lettres ne sont pas touchés.',
    ok: 'Effacer', danger: true,
  });
  if (!ok) return;
  const r = await essayer(() => API.reinitialiser(), 'Historique effacé', e.currentTarget);
  if (r) { await chargerDonnees(); rendreTout(); }
});

// ------------------------------------------------------------------ mes villes

/**
 * Le bouton ne s'allume qu'une fois quelque chose modifié : éteint, il dit
 * aussi que le fichier est à jour.
 */
function signalerVillesModifiees(modifie = true) {
  const bouton = document.getElementById('villesSave');
  if (!bouton) return;
  bouton.disabled = !modifie;
  document.getElementById('villesEtat').textContent = modifie ? 'Modifications non enregistrées' : '';
}

installerEditeurVilles({ signaler: signalerVillesModifiees });
installerEntretien(toast);
installerChill(toast);
installerDock(toast);

document.getElementById('lecteurBtn').addEventListener('click', () => basculerDock());

document.getElementById('villesSave').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const message = await enregistrerVilles();
    // Les onglets se construisent depuis /meta : sans rechargement, la barre
    // de villes continuerait d'afficher l'ancienne liste.
    await chargerDonnees();
    ongletsRendus = null;
    rendreTout();
    toast(`${message} La prochaine collecte les prendra en compte.`, 'win');
  } catch (erreur) {
    toast(erreur.message, 'err');
    reagir(e.target, 'err');
    e.target.disabled = false;
  }
});

// Objectif hebdomadaire
document.getElementById('goalSave').addEventListener('click', async (e) => {
  const v = Number(document.getElementById('goalInput').value);
  const r = await essayer(() => API.majObjectif(v), `Objectif : ${v} candidatures par semaine`, e.currentTarget);
  if (r) await chargerDonnees();
  if (r) rendreTout();
});

/**
 * LE PAS DES CHAMPS NUMÉRIQUES. La flèche native d'un `input[type=number]`
 * ignore le thème : on la remplace par deux boutons lisibles, et l'évènement
 * `change` est REJOUÉ à la main — le navigateur ne l'émet que pour une saisie
 * humaine.
 */
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pas]');
  if (!b) return;
  const champ = document.getElementById(b.dataset.cible);
  if (!champ) return;
  if (Number(b.dataset.pas) > 0) champ.stepUp(); else champ.stepDown();
  champ.dispatchEvent(new Event('change', { bubbles: true }));
});

// ------------------------------------------------------- palette de commandes

/**
 * Toutes les commandes de la palette. Une par vue — les huit, Entretiens et
 * Chill compris, qui manquaient — puis les actions. `raccourci` est affiché
 * dans la ligne et dans l'aperçu : la palette apprend les touches à force de
 * servir.
 */
function commandes() {
  return [
    { id: 'v-dashboard', titre: 'Tableau de bord', cat: 'Aller à', ic: 'graphique', raccourci: 'G D', faire: () => changerVue('dashboard') },
    { id: 'v-offers', titre: 'Toutes les offres', cat: 'Aller à', ic: 'liste', raccourci: 'G O', mots: 'liste annonces', faire: () => changerVue('offers') },
    { id: 'v-kanban', titre: 'Kanban', cat: 'Aller à', ic: 'colonnes', raccourci: 'G K', mots: 'candidatures colonnes', faire: () => changerVue('kanban') },
    { id: 'v-agenda', titre: 'Agenda des relances', cat: 'Aller à', ic: 'calendrier', raccourci: 'G A', faire: () => changerVue('agenda') },
    { id: 'v-entretiens', titre: 'Entretiens', cat: 'Aller à', ic: 'cible', raccourci: 'G E', mots: 'préparation jury', faire: () => changerVue('entretiens') },
    { id: 'v-chill', titre: 'Chill', cat: 'Aller à', ic: 'etoile', raccourci: 'G C', mots: 'discuter compagnon', faire: () => changerVue('chill') },
    { id: 'v-cv', titre: 'Mon CV', cat: 'Aller à', ic: 'parchemin', raccourci: 'G V', faire: () => changerVue('cv') },
    { id: 'v-options', titre: 'Options', cat: 'Aller à', ic: 'reglages', raccourci: 'G R', mots: 'réglages paramètres', faire: () => changerVue('options') },
    ...villesOnglets().map(v => ({
      id: `ville-${v}`, titre: `Offres — ${v === VILLE_AUTRE ? 'Autre' : v === ONGLET_ENVOYEES ? 'Envoyées' : v}`,
      cat: 'Aller à', ic: 'carte', aide: 'Ouvre cet onglet de la liste des offres.',
      faire: () => { changerVue('offers', { transition: false }); choisirVille(v); },
    })),
    { id: 'a-collecte', titre: 'Lancer une collecte', cat: 'Action', ic: 'radar', raccourci: 'R', mots: 'rafraichir chercher',
      aide: 'Interroge les sources et montre le radar en direct.', faire: () => lancerCollecte() },
    { id: 'a-focus', titre: 'Mode focus', cat: 'Action', ic: 'focus', raccourci: 'F', mots: 'pomodoro concentration minuteur',
      aide: 'Masque tout sauf les trois du jour et un minuteur de 25 minutes.', faire: () => focus?.basculer() },
    { id: 'a-ajouter', titre: 'Ajouter une offre', cat: 'Action', ic: 'plus', raccourci: 'N', faire: () => ajouterOffre() },
    { id: 'a-rappels', titre: 'Voir les rappels', cat: 'Action', ic: 'cloche', mots: 'notifications échéances',
      faire: () => document.getElementById('notifBtn')?.click() },
    { id: 'a-export', titre: 'Exporter une sauvegarde (JSON)', cat: 'Action', ic: 'disque', faire: () => document.getElementById('optExport').click() },
    { id: 'a-csv', titre: 'Exporter en CSV', cat: 'Action', ic: 'document', faire: () => document.getElementById('exportBtn').click() },
    { id: 'a-ics', titre: 'Télécharger l\'agenda (.ics)', cat: 'Action', ic: 'calendrier', mots: 'outlook google calendrier',
      faire: () => { window.location.href = API.urlIcs; } },
    { id: 'a-theme', titre: 'Changer de thème', cat: 'Action', ic: 'soleil', raccourci: 'T', faire: () => themeSuivant() },
    { id: 'a-systeme', titre: 'Thème : suivre le système', cat: 'Action', ic: 'ecran', mots: 'auto sombre clair',
      faire: () => appliquerTheme('systeme', { transition: true, apres: rendreTout }) },
    { id: 'a-lecteur', titre: 'Ouvrir le lecteur flottant', cat: 'Action', ic: 'lecture', raccourci: 'M', faire: () => ouvrirDock('lecteur') },
    { id: 'a-spotify', titre: 'Spotify', cat: 'Action', ic: 'lecture', faire: () => ouvrirDock('spotify') },
    { id: 'a-twitch', titre: 'Twitch — mes directs', cat: 'Action', ic: 'ecran', faire: () => ouvrirDock('twitch') },
    { id: 'a-intro', titre: 'Rejouer l\'ouverture', cat: 'Action', ic: 'radar', faire: () => jouerIntro({ forcer: true }) },
    { id: 'a-visite', titre: 'Refaire la visite guidée', cat: 'Action', ic: 'boussole',
      faire: () => lancerTutoriel({ allerA: (v) => changerVue(v, { transition: false }), forcer: true }) },
    { id: 'a-aide', titre: 'Afficher les raccourcis', cat: 'Action', ic: 'clavier', raccourci: '?', faire: () => ouvrirAide() },
  ];
}

palette = installerPalette({
  commandes,
  offres: () => etat.offres,
  ouvrirOffre,
  actionsOffre,
});
document.getElementById('paletteBtn').addEventListener('click', () => palette?.ouvrir());

function themeSuivant() {
  const actuel = racine.dataset.theme;
  const suivant = THEMES[(THEMES.indexOf(actuel) + 1) % THEMES.length];
  appliquerTheme(suivant, { transition: true, apres: rendreTout });
  toast(`Thème « ${NOMS_THEMES[suivant]} »`);
}

// ------------------------------------------------------- raccourcis clavier

const aide = document.getElementById('aideClavier');
const ouvrirAide = () => ouvrirSurcouche(aide, { titre: 'Raccourcis clavier' });
document.getElementById('fermerAide').addEventListener('click', () => fermerSurcouche(aide));
aide.addEventListener('click', e => { if (e.target === aide) fermerSurcouche(aide); });

installerClavier({
  palette: { ouvrir: () => palette?.ouvrir(), fermer: () => palette?.fermer(), estOuverte: () => Boolean(palette?.estOuverte()) },
  vue: () => etat.vue,
  changerVue,
  lancerCollecte,
  ajouterOffre,
  themeSuivant,
  basculerDock,
  ouvrirAide,
  rechercher: () => {
    changerVue('offers', { transition: false });
    const champ = document.getElementById('search');
    champ.focus();
    champ.select();
  },
  actionCarte,
  get focus() { return focus; },
  get rappels() { return rappels; },
  fermerTiroir: () => {
    if (!barreLaterale.classList.contains('open')) return false;
    ouvrirTiroir(false);
    return true;
  },
  fermerFormulaire: () => {
    if (!formulaire.classList.contains('show')) return false;
    formulaire.classList.remove('show');
    return true;
  },
});

// ------------------------------------------------------- les modules 4.0

/** Une notification du système, si elle est permise. Rien sinon. */
function notifier(titre, corps) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try { new Notification(titre, { body: corps }); } catch { /* hors service worker */ }
}

collecte = installerCollecte({
  toast,
  apresCollecte: async () => {
    await chargerDonnees();
    ongletsRendus = null;
    rendreTout();
    rappels?.rafraichir();
  },
  voirOffres: () => {
    etat.drapeaux.add('frais');
    document.querySelector('#chips [data-f="frais"]')?.classList.add('active');
    changerVue('offers');
  },
});

focus = installerFocus({
  offres: () => etat.offres,
  ouvrirOffre,
  marquerEnvoyee: (offre) => (offre.suivi.status === 'À postuler' ? basculerEnvoi(offre) : null),
  toast,
  notifier,
});
document.getElementById('focusBtn').addEventListener('click', () => focus.basculer());

rappels = installerRappels({
  offres: () => etat.offres,
  ouvrirOffre: ouvrirOffreParId,
});

// --------------------------------------------- migration depuis localStorage

/**
 * Récupère le suivi de l'ancienne version (fichier HTML autonome) une seule
 * fois. Les clés localStorage ne sont PAS effacées : elles restent un filet.
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

// Le dépôt du CV écoute toute la fenêtre, dès le départ : c'est le geste du
// tout premier jour, avant qu'on sache où sont les choses.
installerDepotCv(toast, async () => {
  etat.cv = await API.cv().catch(() => etat.cv);
  rendreTout();
});

(async function demarrer() {
  poserIcones();

  // L'ouverture part TOUT DE SUITE, sans `await` : elle joue pendant que les
  // données arrivent, au lieu de s'ajouter au temps de chargement.
  const ouverture = options.intro ? jouerIntro() : Promise.resolve();

  try {
    await chargerDonnees();
  } catch (erreur) {
    toast(erreur.message, 'err');
    return;
  }

  await migrerSiNecessaire();

  // L'adresse décide de la vue d'arrivée : un rechargement sur
  // `#/offres/nancy` rouvre Nancy, plus le tableau de bord.
  const route = lireRoute(location.hash);
  if (route.vue === 'offers' && route.ville) {
    const v = villeDuSlug(route.ville, villesOnglets());
    if (v) etat.ville = v;
  }
  if (route.offre && trouver(route.offre)) {
    ancreAppliquee = location.hash;
    ouvrirOffre(trouver(route.offre), { route: false });
  } else {
    changerVue(route.vue ?? etat.vue, { transition: false, route: false });
    ecrireAncre({ remplacer: true });
  }

  rappels.rafraichir();
  focus.rafraichir();
  // Une collecte tournait-elle déjà (lancée par le planificateur, ou avant un
  // rechargement) ? La pastille la reprend.
  collecte.seRaccrocher().then(enCours => {
    if (enCours) toast('Une collecte est en cours — la pastille du bandeau la suit.', 'info');
  });

  const jours = etat.meta?.derniereCollecte
    ? Math.floor((Date.now() - new Date(etat.meta.derniereCollecte).getTime()) / 86400000)
    : null;

  await ouverture;

  // La visite guidée, une seule fois, APRÈS l'ouverture et une fois les
  // données là : ses étapes désignent des offres réelles.
  await lancerTutoriel({ allerA: (v) => changerVue(v, { transition: false }) });
  setTimeout(() => {
    if (jours === null) toast('Bienvenue — clique sur « Collecter » pour lancer ta première collecte.');
    else if (jours >= 3) toast(`Dernière collecte il y a ${jours} jours — pense à rafraîchir.`);
    else toast('Bienvenue dans ton Job Cockpit.');
  }, 500);
})();
