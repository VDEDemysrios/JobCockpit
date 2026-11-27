// LE MODE FOCUS : une offre, un minuteur, rien d'autre.
//
// POURQUOI
// --------
// Le tableau de bord montre TOUT : les trois du jour, les relances, les
// graphiques, le rail de navigation, le bandeau, les compteurs. C'est ce qu'il
// faut pour décider quoi faire — et c'est exactement ce qui empêche de le
// faire. Écrire une lettre avec, dans le coin de l'œil, 282 offres à trier et
// un objectif hebdomadaire en retard, c'est écrire en se sentant en retard.
//
// Le mode focus retire le rail et le bandeau, ne garde que les trois du jour
// et la carte sur laquelle on travaille, et pose un minuteur Pomodoro :
// vingt-cinq minutes de travail, cinq de pause, une cloche à la fin. On en
// sort par « F », par Échap ou par le bouton.
//
// LE MINUTEUR SURVIT AU RECHARGEMENT. Il ne compte pas des secondes écoulées
// (un onglet caché ralentit `setInterval` jusqu'à une fois par minute) : il
// garde son HEURE DE FIN, et l'affichage se recalcule depuis elle. Recharger,
// changer d'onglet ou mettre l'ordinateur en veille ne le décale pas.

import { echapper, pluriel } from './format.js';
import { icone } from './icons.js';
import { offresDuJour } from './selection.js';
import { sonFin, sonClic } from './sons.js';
import { poserMarque } from './titre.js';

const CLE = 'bp_focus';
export const DUREES_POMODORO = { travail: 25 * 60000, pause: 5 * 60000 };

/** Le temps restant, en millisecondes, d'un minuteur décrit par son état. Pur. */
export function restantDe(m, maintenant = Date.now()) {
  if (!m) return DUREES_POMODORO.travail;
  if (m.enMarche) return Math.max(0, m.fin - maintenant);
  return m.restant ?? DUREES_POMODORO[m.phase ?? 'travail'];
}

/** « 24:59 ». Pur. */
export function formaterMinuteur(ms) {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function lire() {
  try { return JSON.parse(localStorage.getItem(CLE) ?? 'null') ?? {}; } catch { return {}; }
}
function ecrire(etat) {
  try { localStorage.setItem(CLE, JSON.stringify(etat)); } catch { /* sans mémoire */ }
}

/**
 * Installe le mode focus.
 *
 * @param {object} ctx
 * @param {() => object[]} ctx.offres
 * @param {(offre) => void} ctx.ouvrirOffre     quitte le mode et déplie l'offre
 * @param {(offre) => Promise<void>} ctx.marquerEnvoyee
 * @param {(m: string, t?: string) => void} ctx.toast
 * @param {(titre: string, corps: string) => void} [ctx.notifier]
 */
export function installerFocus(ctx) {
  const racine = document.documentElement;
  let etat = { actif: false, offreId: null, minuteur: { phase: 'travail', enMarche: false, restant: DUREES_POMODORO.travail, cycles: 0 }, ...lire() };
  let tic = 0;

  const zone = document.createElement('section');
  zone.className = 'mode-focus';
  zone.id = 'modeFocus';
  zone.setAttribute('aria-label', 'Mode focus');
  zone.hidden = true;
  document.body.appendChild(zone);

  const CIRCONF = 2 * Math.PI * 54;

  function rendre() {
    const { offres: trois } = offresDuJour(ctx.offres(), 3);
    const courante = ctx.offres().find(o => o.id === etat.offreId) ?? null;
    const m = etat.minuteur;
    zone.innerHTML = `
      <header class="mf-tete">
        <div class="mf-marque">${icone('focus', 18)} <b>Mode focus</b>
          <span class="mf-sous">${m.cycles ? `${pluriel(m.cycles, 'séance')} terminée${m.cycles > 1 ? 's' : ''} aujourd'hui` : 'Une chose à la fois.'}</span></div>
        <button type="button" class="btn btn-discret" data-mf="quitter">${icone('croix', 14)} Quitter <span class="kbd">F</span></button>
      </header>
      <div class="mf-grille">
        <section class="mf-minuteur ${m.phase}" aria-label="Minuteur Pomodoro">
          <div class="mf-cadran">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle cx="60" cy="60" r="54" class="mf-piste"/>
              <circle cx="60" cy="60" r="54" class="mf-arc" id="mfArc"
                style="stroke-dasharray:${CIRCONF.toFixed(1)}"/>
            </svg>
            <div class="mf-temps"><b id="mfTemps">${formaterMinuteur(restantDe(m))}</b>
              <span>${m.phase === 'pause' ? 'pause' : 'concentration'}</span></div>
          </div>
          <div class="mf-commandes">
            <button type="button" class="btn btn-primary" data-mf="basculer">
              ${m.enMarche ? `${icone('pause', 15)} Pause` : `${icone('lecture', 15)} ${restantDe(m) < DUREES_POMODORO[m.phase] ? 'Reprendre' : 'Démarrer'}`}</button>
            <button type="button" class="btn" data-mf="raz" title="Remettre à zéro">${icone('rafraichir', 15)}</button>
            <button type="button" class="btn btn-discret" data-mf="phase">${m.phase === 'pause' ? 'Passer au travail' : 'Prendre une pause'}</button>
          </div>
        </section>

        <section class="mf-travail">
          <h3>${icone('cible', 14)} Sur quoi tu travailles</h3>
          ${courante ? `
            <div class="mf-carte">
              <div class="mf-carte-titre">${echapper(courante.titre)}</div>
              <div class="mf-carte-meta">${echapper([courante.entreprise, courante.ville].filter(Boolean).join(' · '))}</div>
              ${courante.analyse?.verdict ? `<p class="mf-verdict">${echapper(courante.analyse.verdict.slice(0, 320))}</p>` : ''}
              <div class="mf-carte-actions">
                <button type="button" class="btn btn-primary" data-mf="ouvrir">${icone('plume', 14)} Ouvrir la carte</button>
                ${courante.suivi?.status === 'À postuler'
                  ? `<button type="button" class="btn" data-mf="envoyee">${icone('envoi', 14)} Marquer envoyée</button>` : ''}
                ${courante.lien ? `<a class="btn btn-discret" href="${echapper(courante.lien)}" target="_blank" rel="noopener">${icone('externe', 14)} L'annonce</a>` : ''}
                <button type="button" class="btn btn-discret" data-mf="lacher">Changer</button>
              </div>
            </div>`
          : '<p class="mf-vide">Choisis une des trois offres ci-dessous : elle restera ici le temps de la séance.</p>'}

          <h3>${icone('etoile', 14)} Les 3 du jour</h3>
          <div class="mf-trois">${trois.length ? trois.map((o, i) => `
            <button type="button" class="mf-choix${o.id === etat.offreId ? ' actif' : ''}" data-mf-offre="${echapper(o.id)}">
              <span class="mf-rang">${i + 1}</span>
              <span class="mf-choix-t">${echapper(o.titre)}</span>
              <span class="mf-choix-m">${echapper([o.entreprise, o.ville].filter(Boolean).join(' · '))}</span>
            </button>`).join('') : '<p class="mf-vide">Rien en attente : tout est traité.</p>'}</div>
        </section>
      </div>`;
    majCadran();
  }

  /** Met à jour l'arc et le chiffre, sans reconstruire la vue. */
  function majCadran() {
    const m = etat.minuteur;
    const restant = restantDe(m);
    const total = DUREES_POMODORO[m.phase];
    const arc = zone.querySelector('#mfArc');
    if (arc) arc.style.strokeDashoffset = (CIRCONF * (1 - restant / total)).toFixed(2);
    const t = zone.querySelector('#mfTemps');
    if (t) t.textContent = formaterMinuteur(restant);
    poserMarque('focus', m.enMarche ? `${m.phase === 'pause' ? 'Pause' : 'Focus'} ${formaterMinuteur(restant)} ·` : '');
    if (m.enMarche && restant <= 0) finDePhase();
  }

  function finDePhase() {
    const m = etat.minuteur;
    const finiTravail = m.phase === 'travail';
    sonFin();
    if (finiTravail) m.cycles = (m.cycles ?? 0) + 1;
    const suivante = finiTravail ? 'pause' : 'travail';
    etat.minuteur = { phase: suivante, enMarche: false, restant: DUREES_POMODORO[suivante], cycles: m.cycles };
    ecrire(etat);
    arreterTic();
    const message = finiTravail ? 'Séance terminée — cinq minutes de pause.' : 'La pause est finie — on y retourne ?';
    ctx.toast(message, 'win');
    ctx.notifier?.('Job Cockpit', message);
    if (etat.actif) rendre(); else poserMarque('focus', '');
  }

  function demarrerTic() {
    arreterTic();
    tic = setInterval(majCadran, 1000);
  }
  function arreterTic() { clearInterval(tic); tic = 0; }

  function basculerMinuteur() {
    const m = etat.minuteur;
    if (m.enMarche) {
      etat.minuteur = { ...m, enMarche: false, restant: restantDe(m) };
      arreterTic();
    } else {
      etat.minuteur = { ...m, enMarche: true, fin: Date.now() + restantDe(m) };
      demarrerTic();
    }
    ecrire(etat);
    rendre();
  }

  function activer(on = !etat.actif) {
    etat.actif = on;
    ecrire(etat);
    racine.dataset.focus = on ? 'on' : 'off';
    zone.hidden = !on;
    if (on) {
      rendre();
      zone.querySelector('[data-mf="basculer"]')?.focus({ preventScroll: true });
    }
  }

  zone.addEventListener('click', async (e) => {
    const choix = e.target.closest('[data-mf-offre]');
    if (choix) { etat.offreId = choix.dataset.mfOffre; ecrire(etat); sonClic(); rendre(); return; }
    const b = e.target.closest('[data-mf]');
    if (!b) return;
    const quoi = b.dataset.mf;
    const courante = ctx.offres().find(o => o.id === etat.offreId);
    if (quoi === 'quitter') activer(false);
    if (quoi === 'basculer') basculerMinuteur();
    if (quoi === 'raz') {
      etat.minuteur = { ...etat.minuteur, enMarche: false, restant: DUREES_POMODORO[etat.minuteur.phase] };
      arreterTic(); ecrire(etat); rendre();
    }
    if (quoi === 'phase') {
      const p = etat.minuteur.phase === 'pause' ? 'travail' : 'pause';
      etat.minuteur = { ...etat.minuteur, phase: p, enMarche: false, restant: DUREES_POMODORO[p] };
      arreterTic(); ecrire(etat); rendre();
    }
    if (quoi === 'lacher') { etat.offreId = null; ecrire(etat); rendre(); }
    if (quoi === 'ouvrir' && courante) { activer(false); ctx.ouvrirOffre(courante); }
    if (quoi === 'envoyee' && courante) { await ctx.marquerEnvoyee(courante); rendre(); }
  });

  // Reprise après rechargement : le minuteur continue là où il en était.
  if (etat.minuteur?.enMarche) {
    if (restantDe(etat.minuteur) <= 0) finDePhase();
    else demarrerTic();
  }
  if (etat.actif) activer(true);

  return {
    basculer: () => activer(),
    actif: () => etat.actif,
    quitter: () => activer(false),
    rafraichir: () => { if (etat.actif) rendre(); },
  };
}
