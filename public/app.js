// Point d'entrée du dashboard : état, navigation, événements.
import { API } from './api.js';
import { GM, STATUSES, MOIS, JOURS, todayISO, ageOffre } from './format.js';
import { rendreDashboard, rendreCarte, rendreKanban, rendreAgenda, rendreIndicateurMaj, relanceDue, rendreFocus, actionsDuJour, celebrer } from './render.js';

/** Nombre de jours après l'envoi au bout duquel proposer une relance. */
const DELAI_RELANCE_JOURS = 7;

const dansNJours = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const etat = {
  offres: [],
  meta: null,
  vue: 'dashboard',
  filtre: 'all',
  recherche: '',
  tri: 'grp',
  statut: 'all',
  ouvertes: new Set(),   // cartes dépliées, à rouvrir après un rafraîchissement
};

// ----------------------------------------------------------------- utilitaires

function toast(message, erreur = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (erreur ? ' err' : '');
  t.textContent = (erreur ? '⚠️ ' : '✨ ') + message;
  document.getElementById('toastZone').appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity .3s';
    setTimeout(() => t.remove(), 300);
  }, erreur ? 5200 : 2400);
}

/** Enveloppe une action asynchrone : toute erreur devient un toast. */
async function essayer(action, messageSucces) {
  try {
    const r = await action();
    if (messageSucces) toast(messageSucces);
    return r;
  } catch (erreur) {
    toast(erreur.message, true);
    return null;
  }
}

// ----------------------------------------------------------------------- thème

(() => {
  const theme = localStorage.getItem('bp_theme') || 'vivid';
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('#themeSwitch button')
    .forEach(b => b.classList.toggle('active', b.dataset.t === theme));
})();

document.getElementById('themeSwitch').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  document.documentElement.dataset.theme = b.dataset.t;
  localStorage.setItem('bp_theme', b.dataset.t);
  document.querySelectorAll('#themeSwitch button').forEach(x => x.classList.toggle('active', x === b));
  toast(`Thème « ${b.textContent} » appliqué`);
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
  const [offres, meta] = await Promise.all([API.offres(), API.meta()]);
  etat.offres = offres.offres;
  etat.meta = meta;
}

function trouver(id) {
  return etat.offres.find(o => o.id === id);
}

// ------------------------------------------------------------------ navigation

document.getElementById('nav').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) changerVue(b.dataset.view);
});

function changerVue(vue) {
  etat.vue = vue;
  document.querySelectorAll('.nav button').forEach(x => x.classList.toggle('active', x.dataset.view === vue));
  ['focus', 'dashboard', 'offers', 'kanban', 'agenda'].forEach(id => {
    document.getElementById('view-' + id).style.display = id === vue ? 'block' : 'none';
  });
  document.getElementById('sidebar').classList.remove('open');
  rendreTout();
}

function majBadgesNav() {
  const aPostuler = etat.offres.filter(o =>
    (o.groupe === 1 || o.groupe === 2) && o.suivi.status === 'À postuler').length;
  const relances = etat.offres.filter(relanceDue).length;
  const focus = actionsDuJour(etat.offres).filter(a => a.rang <= 1).length;

  const bo = document.getElementById('nb-offers');
  bo.style.display = aPostuler ? '' : 'none';
  bo.textContent = aPostuler;

  const ba = document.getElementById('nb-agenda');
  ba.style.display = relances ? '' : 'none';
  ba.textContent = relances;

  // Le badge Focus ne compte que l'urgent (relances dues, entretiens) :
  // sinon il afficherait en permanence le nombre total d'offres à traiter.
  const bf = document.getElementById('nb-focus');
  bf.style.display = focus ? '' : 'none';
  bf.textContent = focus;
}

/** Ouvre une offre depuis la vue Focus : bascule sur Offres et la déplie. */
function ouvrirOffre(offre) {
  etat.ouvertes.add(offre.id);
  etat.filtre = 'all';
  etat.statut = 'all';
  etat.recherche = '';
  document.getElementById('search').value = '';
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.g === 'all'));
  changerVue('offers');

  requestAnimationFrame(() => {
    const carte = [...document.querySelectorAll('.card')]
      .find(c => c.querySelector('.ptitle')?.textContent === offre.titre);
    carte?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// ---------------------------------------------------------------- rendu global

function rendreTout() {
  majBadgesNav();
  if (etat.vue === 'focus') rendreFocus(etat.offres, ouvrirOffre);
  else if (etat.vue === 'dashboard') rendreDashboard(etat.offres, etat.meta);
  else if (etat.vue === 'offers') rendreOffres();
  else if (etat.vue === 'kanban') rendreKanban(etat.offres, deposerKanban);
  else if (etat.vue === 'agenda') rendreAgenda(etat.offres);
}

const rangGroupe = g => ({ 1: 0, 2: 1, 0: 2, 3: 3 }[g] ?? 4);

function rendreOffres() {
  const compte = { all: etat.offres.length, 1: 0, 2: 0, 3: 0, 0: 0 };
  etat.offres.forEach(o => { compte[o.groupe] = (compte[o.groupe] ?? 0) + 1; });
  document.getElementById('c-all').textContent = compte.all;
  ['1', '2', '3', '0'].forEach(g => { document.getElementById('c-' + g).textContent = compte[g]; });

  let liste = etat.offres.filter(o => etat.filtre === 'all' || String(o.groupe) === etat.filtre);
  if (etat.statut !== 'all') liste = liste.filter(o => o.suivi.status === etat.statut);
  if (etat.recherche) {
    const q = etat.recherche.toLowerCase();
    liste = liste.filter(o => `${o.titre}${o.entreprise}${o.ville}`.toLowerCase().includes(q));
  }

  if (etat.tri === 'date') liste.sort((a, b) => String(b.dateOffre ?? '').localeCompare(String(a.dateOffre ?? '')));
  else if (etat.tri === 'fresh') liste.sort((a, b) => (ageOffre(a.dateOffre) ?? 999) - (ageOffre(b.dateOffre) ?? 999));
  else if (etat.tri === 'ville') liste.sort((a, b) => String(a.ville).localeCompare(String(b.ville)));
  else if (etat.tri === 'relance') liste.sort((a, b) => (a.suivi.relance || '9999').localeCompare(b.suivi.relance || '9999'));
  else liste.sort((a, b) => rangGroupe(a.groupe) - rangGroupe(b.groupe) || (b.score ?? 0) - (a.score ?? 0));

  // Les épinglées remontent toujours en tête.
  liste.sort((a, b) => (b.suivi.pinned ? 1 : 0) - (a.suivi.pinned ? 1 : 0));

  document.getElementById('offersSub').textContent =
    `${compte[1]} prioritaires · ${compte[2]} possibles · ${compte[0]} à vérifier`;
  document.getElementById('empty').style.display = liste.length ? 'none' : 'block';
  document.getElementById('count').textContent =
    `${liste.length} offre${liste.length > 1 ? 's' : ''} affichée${liste.length > 1 ? 's' : ''}`;

  const grille = document.getElementById('grid');
  grille.innerHTML = '';
  liste.forEach((offre, i) => {
    const carte = rendreCarte(offre, { brancher: brancherCarte });
    carte.style.animationDelay = (i * 0.03) + 's';
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
    const nouveau = !offre.suivi.pinned;
    await essayer(() => API.majSuivi(offre.id, { pinned: nouveau }));
    offre.suivi.pinned = nouveau;
    rendreTout();
  });

  carte.querySelector('[data-act="suppr"]')?.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm('Supprimer cette offre ?')) return;
    const r = await essayer(() => API.supprimerOffre(offre.id), 'Offre supprimée');
    if (r) { await chargerDonnees(); rendreTout(); }
  });

  carte.querySelector('[data-act="postule"]')?.addEventListener('click', async () => {
    const versEnvoye = offre.suivi.status === 'À postuler';
    const champs = versEnvoye
      ? { status: 'Envoyé', sent: offre.suivi.sent || todayISO() }
      : { status: 'À postuler' };

    // Une candidature envoyée sans relance planifiée finit oubliée :
    // on en propose une automatiquement une semaine plus tard.
    let relanceAjoutee = false;
    if (versEnvoye && !offre.suivi.relance) {
      champs.relance = dansNJours(DELAI_RELANCE_JOURS);
      relanceAjoutee = true;
    }

    const r = await essayer(() => API.majSuivi(offre.id, champs),
      versEnvoye
        ? (relanceAjoutee ? `Envoyée ✅ — relance planifiée dans ${DELAI_RELANCE_JOURS} jours` : 'Marqué comme envoyé ✅')
        : 'Remis à « À postuler »');

    if (r) { Object.assign(offre.suivi, champs); rendreTout(); }
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
          champs.relance = dansNJours(DELAI_RELANCE_JOURS);
          message = `Envoyée ✅ — relance planifiée dans ${DELAI_RELANCE_JOURS} jours`;
        }
      }

      const r = await essayer(() => API.majSuivi(offre.id, champs), message);
      if (r) {
        Object.assign(offre.suivi, champs);
        if (champ === 'status' && valeur === 'Entretien') celebrer();
        // Le statut change la couleur, la progression et le Kanban : on redessine.
        if (champ === 'status' || champ === 'relance') rendreTout();
        else majBadgesNav();
      }
    });
  });

  carte.querySelector('[data-act="lettre"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    ouvrirLettre(carte, offre, e.currentTarget);
  });
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

  const libelleInitial = bouton.textContent;
  bouton.disabled = true;
  bouton.innerHTML = '<span class="spinner"></span> Rédaction en cours…';

  let lettre = null;
  try {
    lettre = offre.aLettre ? await API.lettre(offre.id) : await API.genererLettre(offre.id);
  } catch (erreur) {
    toast(erreur.message, true);
    bouton.disabled = false;
    bouton.textContent = libelleInitial;
    return;
  }

  offre.aLettre = true;
  bouton.disabled = false;
  bouton.textContent = '✉️ Masquer la lettre';
  zone.dataset.ouverte = '1';

  zone.innerHTML = `
    <textarea class="letter-area"></textarea>
    <div class="letter-hint">Modifie librement le texte : tes retouches sont enregistrées automatiquement.</div>
    <div class="letter-actions" style="margin-top:10px">
      <button class="btn" data-l="copier">📋 Copier</button>
      <a class="btn" data-l="docx" href="${API.urlDocx(offre.id)}">⬇ Word</a>
      <button class="btn" data-l="regen">🔄 Régénérer</button>
    </div>`;

  const zoneTexte = zone.querySelector('.letter-area');
  zoneTexte.value = lettre.contenu;

  zoneTexte.addEventListener('change', async () => {
    await essayer(() => API.majLettre(offre.id, zoneTexte.value), 'Lettre enregistrée');
  });

  zone.querySelector('[data-l="copier"]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(zoneTexte.value);
      toast('Lettre copiée dans le presse-papiers');
    } catch {
      zoneTexte.select();
      toast('Sélectionne et copie avec Ctrl+C', true);
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
          'Nouvelle lettre rédigée');
        if (r) zoneTexte.value = r.contenu;
      } else if (!erreur.besoinConfirmation) {
        toast(erreur.message, true);
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
      champs.relance = dansNJours(DELAI_RELANCE_JOURS);
      message = `Envoyée ✅ — relance planifiée dans ${DELAI_RELANCE_JOURS} jours`;
    }
  }

  const r = await essayer(() => API.majSuivi(id, champs), message);
  if (r) {
    Object.assign(offre.suivi, champs);
    if (statut === 'Entretien') celebrer();
    rendreTout();
  }
}

// ---------------------------------------------------------------- rafraîchir

document.getElementById('refreshBtn').addEventListener('click', async () => {
  const b = document.getElementById('refreshBtn');
  b.disabled = true;
  b.innerHTML = '<span class="spinner"></span> Collecte en cours…';

  try {
    const r = await API.rafraichir();
    await chargerDonnees();
    rendreTout();
    const s = r.resume;
    toast(`Collecte terminée : ${s.nouvelles} nouvelle(s) offre(s), ${s.analysees} analysée(s).`);
  } catch (erreur) {
    toast(erreur.message, true);
    rendreIndicateurMaj(etat.meta);
  } finally {
    b.disabled = false;
    b.textContent = '🔄 Rafraîchir maintenant';
  }
});

// ------------------------------------------------------------ barre d'outils

document.getElementById('chips').addEventListener('click', e => {
  const c = e.target.closest('.chip');
  if (!c) return;
  document.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
  c.classList.add('active');
  etat.filtre = c.dataset.g;
  rendreOffres();
});

document.getElementById('search').addEventListener('input', e => { etat.recherche = e.target.value; rendreOffres(); });
document.getElementById('sort').addEventListener('change', e => { etat.tri = e.target.value; rendreOffres(); });
document.getElementById('statusFilter').addEventListener('change', e => { etat.statut = e.target.value; rendreOffres(); });

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

document.getElementById('saveOffer').addEventListener('click', async () => {
  const v = id => document.getElementById(id).value.trim();
  if (!v('f-titre') || !v('f-entreprise')) { toast('Titre et entreprise sont obligatoires.', true); return; }

  const r = await essayer(() => API.ajouterOffre({
    titre: v('f-titre'), entreprise: v('f-entreprise'), ville: v('f-ville'),
    date: v('f-date'), contrat: v('f-contrat'),
    groupe: document.getElementById('f-groupe').value,
    lien: v('f-lien'), verdict: v('f-verdict'),
  }), 'Offre ajoutée ✅');

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
  if (zone.value.trim().length < 100) { toast('Colle l\'annonce complète (au moins quelques lignes).', true); return; }

  bouton.disabled = true;
  bouton.innerHTML = '<span class="spinner"></span> Analyse en cours…';
  try {
    const r = await API.collerOffre(zone.value);
    zone.value = '';
    formulaire.classList.remove('show');
    await chargerDonnees();
    rendreTout();
    toast(`« ${r.titre} » ajoutée et classée ${GM[r.groupe].label}`);
  } catch (erreur) {
    toast(erreur.message, true);
  } finally {
    bouton.disabled = false;
    bouton.textContent = 'Analyser et ajouter';
  }
});

document.getElementById('exportBtn').addEventListener('click', () => {
  const lignes = [['Titre', 'Entreprise', 'Ville', 'Date offre', 'Groupe', 'Statut', 'Date envoi', 'Relance', 'Notes', 'Lien']];
  etat.offres.forEach(o => lignes.push([
    o.titre, o.entreprise, o.ville, o.dateOffre ?? '',
    (GM[o.groupe]?.label ?? '').replace(/[^\wÀ-ÿ ]/g, '').trim(),
    o.suivi.status, o.suivi.sent, o.suivi.relance,
    (o.suivi.notes || '').replace(/\n/g, ' '), o.lien ?? '',
  ]));

  const csv = lignes.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'candidatures_benjamin_perrin.csv';
  a.click();
  toast('Export CSV téléchargé');
});

// ------------------------------------------------------- raccourcis clavier

const aide = document.getElementById('aideClavier');
const fermerAide = () => aide.classList.remove('show');
document.getElementById('fermerAide').addEventListener('click', fermerAide);
aide.addEventListener('click', e => { if (e.target === aide) fermerAide(); });

// Séquences « G puis lettre », comme dans Méridien.
const VUES_RACCOURCI = { f: 'focus', d: 'dashboard', o: 'offers', k: 'kanban', a: 'agenda' };
let attendLettre = false;
let minuterieG = null;

document.addEventListener('keydown', e => {
  // On ne détourne jamais les touches pendant une saisie.
  // `e.target` n'est pas toujours un Element (ce peut être `document`) :
  // appeler .matches() dessus lèverait une exception et tuerait silencieusement
  // TOUS les raccourcis.
  const cible = e.target;
  const saisie = cible instanceof Element && cible.matches('input, textarea, select');
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
      // changerVue a déjà rendu la vue visible : pas besoin d'attendre une frame.
      document.getElementById('search').focus();
      document.getElementById('search').select();
      break;

    case 'r':
      e.preventDefault();
      changerVue('dashboard');
      document.getElementById('refreshBtn').click();
      break;

    case 't': {
      e.preventDefault();
      const themes = ['vivid', 'enr', 'dark'];
      const suivant = themes[(themes.indexOf(document.documentElement.dataset.theme) + 1) % themes.length];
      document.querySelector(`#themeSwitch button[data-t="${suivant}"]`).click();
      break;
    }

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
  const meta = etat.meta;
  if (meta?.migre) return;

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
  try {
    await chargerDonnees();
  } catch (erreur) {
    toast(erreur.message, true);
    return;
  }

  await migrerSiNecessaire();

  // On ouvre sur le Focus du jour s'il y a de l'urgent à traiter.
  const urgent = actionsDuJour(etat.offres).filter(a => a.rang <= 1).length;
  if (urgent > 0) etat.vue = 'focus';
  changerVue(etat.vue);

  const jours = etat.meta?.derniereCollecte
    ? Math.floor((Date.now() - new Date(etat.meta.derniereCollecte).getTime()) / 86400000)
    : null;

  setTimeout(() => {
    if (jours === null) toast('Bienvenue 🚀 Clique sur « Rafraîchir maintenant » pour lancer ta première collecte.');
    else if (jours >= 3) toast(`Dernière collecte il y a ${jours} jours — pense à rafraîchir.`);
    else toast('Bienvenue dans ton Job Cockpit 🚀');
  }, 700);
})();
