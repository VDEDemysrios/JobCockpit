// LES RAPPELS : ce qui arrive à échéance, au bon endroit.
//
// POURQUOI
// --------
// Les échéances existaient — relances planifiées, dates d'entretien — mais il
// fallait OUVRIR l'application, et la bonne vue, pour les voir. Or la seule
// chose qu'on ne rattrape pas, c'est un entretien oublié, et l'application
// reste toute la journée dans un onglet derrière les autres. Trois relais :
//
//   · le TITRE DE L'ONGLET porte « (3) » quand trois choses attendent
//     aujourd'hui : visible depuis n'importe quel autre onglet ;
//   · une CLOCHE dans le bandeau ouvre la liste, triée par urgence, et chaque
//     ligne mène à son offre ;
//   · une NOTIFICATION du système, une fois par échéance et par jour — et
//     seulement après un « oui » explicite. Demander la permission au
//     chargement, avant d'avoir montré à quoi elle sert, c'est s'assurer un
//     refus définitif.
//
// UNE SEULE REQUÊTE, PAS À CHAQUE RENDU. `/api/rappels` est relu au
// démarrage, après une collecte ou un changement de statut, et toutes les dix
// minutes — jamais dans `rendreTout()`. Un serveur qui ne connaît pas encore
// la route (404) est remplacé par un calcul local sur les offres déjà
// chargées : relances dues, entretiens proches, candidatures sans réponse.

import { API } from './api.js';
import { echapper, pluriel, todayISO } from './format.js';
import { icone, illustration } from './icons.js';
import { poserMarque } from './titre.js';
import { sonNotif } from './sons.js';

const CLE_NOTIFIES = 'bp_rappels_notifies';
const INTERVALLE = 10 * 60000;

const TYPES = {
  relance: { ic: 'plume', lib: 'Relance' },
  entretien: { ic: 'cible', lib: 'Entretien' },
  'sans-reponse': { ic: 'horloge', lib: 'Sans réponse' },
  'offre-fraiche': { ic: 'eclair', lib: 'Offre fraîche' },
};

const jourLocal = (iso) => {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const ecartJours = (iso) => {
  const d = jourLocal(iso);
  if (!d) return null;
  const a = new Date(); a.setHours(0, 0, 0, 0);
  return Math.round((d - a) / 86400000);
};

/**
 * Le repli local : les mêmes rappels, calculés sur les offres chargées.
 * Pur (hors date du jour), exporté pour les tests.
 */
export function rappelsLocaux(offres) {
  const out = [];
  for (const o of offres ?? []) {
    const s = o.suivi ?? {};
    const base = { offerId: o.id, titre: o.titre, entreprise: o.entreprise };
    if (s.entretien) {
      const j = ecartJours(s.entretien);
      if (j !== null && j >= 0 && j <= 14) out.push({ ...base, type: 'entretien', date: s.entretien, dansJours: j, poids: 100 - j });
    }
    if (s.relance && s.status !== 'Refus' && s.status !== 'Entretien') {
      const j = ecartJours(s.relance);
      if (j !== null && j <= 0) out.push({ ...base, type: 'relance', date: s.relance, retardJours: -j, poids: 80 + Math.min(15, -j) });
    }
    if (s.status === 'Envoyé' && s.sent) {
      const j = ecartJours(s.sent);
      if (j !== null && j <= -14 && !s.relance) out.push({ ...base, type: 'sans-reponse', date: s.sent, retardJours: -j, poids: 40 });
    }
  }
  return out.sort((a, b) => b.poids - a.poids);
}

/** Ce qui compte « pour aujourd'hui » : en retard, ou dans les 24 heures. Pur. */
export function urgents(rappels) {
  return (rappels ?? []).filter(r => (r.type === 'relance' && (r.retardJours ?? 0) >= 0)
    || (r.type === 'entretien' && (r.dansJours ?? 99) <= 1));
}

function libelleEcheance(r) {
  if (r.type === 'entretien') {
    return r.dansJours === 0 ? 'aujourd\'hui' : r.dansJours === 1 ? 'demain' : `dans ${pluriel(r.dansJours, 'jour')}`;
  }
  if (r.type === 'relance') return r.retardJours ? `en retard de ${pluriel(r.retardJours, 'jour')}` : 'aujourd\'hui';
  if (r.type === 'sans-reponse') return `envoyée il y a ${pluriel(r.retardJours ?? 14, 'jour')}`;
  if (r.type === 'offre-fraiche') return 'publiée il y a moins de 48 h';
  return '';
}

/**
 * Installe la cloche et le centre de notifications.
 *
 * @param {object} ctx
 * @param {() => object[]} ctx.offres
 * @param {(id: string) => void} ctx.ouvrirOffre
 */
export function installerRappels(ctx) {
  const bouton = document.getElementById('notifBtn');
  const badge = document.getElementById('notifNb');
  const centre = document.getElementById('notifCentre');
  let rappels = [];
  let routeAbsente = false;
  let minuteur = 0;

  function lireNotifies() {
    try { return JSON.parse(localStorage.getItem(CLE_NOTIFIES) ?? '{}'); } catch { return {}; }
  }

  /** Une notification système par échéance et par JOUR, jamais deux. */
  function notifierNouveaux(liste) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const jour = todayISO();
    const deja = lireNotifies();
    // On ne garde que la mémoire du jour : hier n'empêche rien aujourd'hui.
    const vus = deja.jour === jour ? new Set(deja.cles ?? []) : new Set();
    let sonne = false;
    for (const r of urgents(liste)) {
      const cle = `${r.type}-${r.offerId}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      try {
        const n = new Notification(`${TYPES[r.type]?.lib ?? 'Rappel'} — ${libelleEcheance(r)}`, {
          body: [r.titre, r.entreprise].filter(Boolean).join(' · '),
          tag: `jc-${cle}`,
        });
        n.onclick = () => { window.focus(); ctx.ouvrirOffre(r.offerId); n.close(); };
        sonne = true;
      } catch { /* certains navigateurs refusent hors service worker */ }
    }
    if (sonne) sonNotif();
    try { localStorage.setItem(CLE_NOTIFIES, JSON.stringify({ jour, cles: [...vus] })); } catch { /* */ }
  }

  function majBadges() {
    const n = urgents(rappels).length;
    poserMarque('rappels', n ? `(${n})` : '');
    if (badge) { badge.textContent = n || ''; badge.hidden = !n; }
    bouton?.classList.toggle('a-rappels', n > 0);
    bouton?.setAttribute('aria-label', n ? `Rappels : ${pluriel(n, 'échéance')} aujourd'hui` : 'Rappels');
  }

  function rendreCentre() {
    if (!centre) return;
    const groupes = [
      ['Aujourd\'hui', urgents(rappels)],
      ['À venir et à surveiller', rappels.filter(r => !urgents([r]).length)],
    ].filter(([, l]) => l.length);

    const permission = typeof Notification === 'undefined' ? 'indisponible' : Notification.permission;
    centre.innerHTML = `
      <div class="nc-tete"><b>Rappels</b>
        <span class="nc-sous">${rappels.length ? pluriel(rappels.length, 'échéance') : ''}</span></div>
      ${groupes.length ? groupes.map(([titre, liste]) => `
        <div class="nc-groupe">${echapper(titre)}</div>
        <ul class="nc-liste">${liste.slice(0, 12).map(r => `
          <li><button type="button" class="nc-ligne ${r.type}" data-nc-offre="${echapper(r.offerId)}">
            <span class="nc-ic">${icone(TYPES[r.type]?.ic ?? 'info', 15)}</span>
            <span class="nc-corps">
              <span class="nc-titre">${echapper(r.titre ?? 'Offre')}</span>
              <span class="nc-meta">${echapper(TYPES[r.type]?.lib ?? '')} · ${echapper(libelleEcheance(r))}${r.entreprise ? ' · ' + echapper(r.entreprise) : ''}</span>
            </span>
          </button></li>`).join('')}</ul>`).join('')
        : `<div class="nc-vide">${illustration('notifs', 56)}<p>Rien qui presse. Les relances et les entretiens s'afficheront ici.</p></div>`}
      <div class="nc-pied">
        ${permission === 'default' ? `<button type="button" class="btn btn-mini" data-nc="permission">${icone('cloche', 13)} Me prévenir sur le bureau</button>` : ''}
        ${permission === 'granted' ? `<span class="nc-note">${icone('coche', 13)} Notifications du bureau activées</span>` : ''}
        ${permission === 'denied' ? '<span class="nc-note">Notifications refusées dans le navigateur.</span>' : ''}
        ${routeAbsente ? '<span class="nc-note">Calcul local — le serveur ne propose pas encore les rappels.</span>' : ''}
      </div>`;
  }

  async function rafraichir() {
    if (!routeAbsente) {
      try {
        const r = await API.rappels();
        rappels = r.rappels ?? [];
      } catch (e) {
        if (e.statut === 404) routeAbsente = true;
        else return;      // panne passagère : on garde la liste précédente
      }
    }
    if (routeAbsente) rappels = rappelsLocaux(ctx.offres());
    majBadges();
    if (centre && !centre.hidden) rendreCentre();
    notifierNouveaux(rappels);
  }

  function ouvrirCentre() {
    if (!centre) return;
    rendreCentre();
    centre.hidden = false;
    bouton?.setAttribute('aria-expanded', 'true');
    centre.querySelector('button')?.focus({ preventScroll: true });
  }
  function fermerCentre({ rendreFocus = false } = {}) {
    if (!centre || centre.hidden) return false;
    centre.hidden = true;
    bouton?.setAttribute('aria-expanded', 'false');
    if (rendreFocus) bouton?.focus();
    return true;
  }

  bouton?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (centre.hidden) ouvrirCentre(); else fermerCentre();
  });
  centre?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const l = e.target.closest('[data-nc-offre]');
    if (l) { fermerCentre(); ctx.ouvrirOffre(l.dataset.ncOffre); return; }
    if (e.target.closest('[data-nc="permission"]')) {
      // La demande part d'un CLIC, et d'un clic seulement : c'est ce que les
      // navigateurs exigent, et c'est surtout le moment où l'on sait à quoi
      // elle sert.
      try { await Notification.requestPermission(); } catch { /* ancien navigateur */ }
      rendreCentre();
      notifierNouveaux(rappels);
    }
  });
  document.addEventListener('click', (e) => {
    if (centre && !centre.hidden && !centre.contains(e.target)) fermerCentre();
  });

  // Toutes les dix minutes, mais pas dans un onglet caché : on relira au
  // retour, ce qui suffit pour des échéances qui se comptent en jours.
  const programmer = () => {
    clearInterval(minuteur);
    minuteur = setInterval(() => { if (!document.hidden) rafraichir(); }, INTERVALLE);
  };
  programmer();

  return {
    rafraichir,
    fermerCentre,
    ouvert: () => Boolean(centre && !centre.hidden),
    liste: () => rappels,
  };
}
