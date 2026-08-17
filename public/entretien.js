// L'entretien blanc : une surcouche, un fil de questions, un débriefing.
//
// POURQUOI UNE SURCOUCHE ET PAS UN PANNEAU DANS LA CARTE
// ------------------------------------------------------
// Un entretien demande de l'attention pleine. Le faire dans la liste, avec
// deux cents autres offres qui défilent derrière, c'est répéter dans le
// couloir. La surcouche rend le reste de l'application inerte — au clavier
// comme aux lecteurs d'écran — et il ne reste que la question posée.
//
// CE QUE L'INTERFACE DOIT ABSOLUMENT FAIRE
// ----------------------------------------
// Ne PAS afficher la question suivante avant que la réponse soit écrite. La
// tentation, en préparant un entretien, est de lire les questions pour se
// rassurer sans jamais formuler de réponse — et c'est précisément formuler
// qui prépare. Le champ est donc devant, et la suite n'arrive qu'après envoi.
import { API } from './api.js';
import { echapper } from './format.js';
import { ouvrirSurcouche, fermerSurcouche } from './surcouche.js';

let offreEnCours = null;

const boite = () => document.getElementById('entretien');

/** Markdown minimal : titres, gras, listes. Le débriefing en use, pas plus. */
function rendreTexte(md) {
  return echapper(md ?? '')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^/, '<p>').replace(/$/, '</p>');
}

function rendreFil(etat) {
  const fil = etat.echanges.map(e => `
    <div class="ent-tour ent-${e.role}">
      <div class="ent-qui">${e.role === 'jury' ? 'Le jury' : 'Toi'}</div>
      <div class="ent-texte">${echapper(e.texte).replace(/\n/g, '<br>')}</div>
    </div>`).join('');

  const posees = etat.echanges.filter(e => e.role === 'jury').length;
  const finie = posees >= etat.questionsParSeance;

  return `
    <div class="ent-tete">
      <div>
        <h2>Entretien blanc</h2>
        <div class="ent-poste">${echapper(etat.titre ?? '')}</div>
      </div>
      <div class="ent-compte">${posees} / ${etat.questionsParSeance}</div>
      <button class="btn" data-ent="fermer">Fermer</button>
    </div>

    ${etat.analysePresente ? '' : `<p class="ent-avert">Cette offre n'a pas
      encore d'analyse : le jury ne connaît pas tes points faibles et restera
      en surface. Lance l'analyse d'abord, la séance vaudra bien plus.</p>`}

    <div class="ent-fil" id="entFil">${fil || `<p class="ent-vide">Le jury va
      ouvrir la séance. Réponds comme tu le ferais à l'oral : à voix haute si
      tu peux, puis écris. C'est de formuler qui prépare, pas de lire.</p>`}</div>

    ${finie ? '' : `
      <form class="ent-saisie" id="entForm">
        <textarea id="entReponse" rows="4" placeholder="${posees
          ? 'Ta réponse…' : 'Prêt ? Envoie pour que le jury commence.'}"></textarea>
        <button class="btn btn-primary" type="submit">${posees ? 'Répondre' : 'Commencer'}</button>
      </form>`}

    <div class="ent-pied">
      <button class="btn" data-ent="debrief">Débriefer maintenant</button>
      <button class="btn" data-ent="fiche">Fiche de révision</button>
      <button class="btn btn-discret" data-ent="reset">Recommencer</button>
    </div>

    ${etat.debrief ? `<div class="ent-doc"><div class="ent-doc-titre">Débriefing</div>
      ${rendreTexte(etat.debrief)}</div>` : ''}
    ${etat.fiche ? `<div class="ent-doc"><div class="ent-doc-titre">Fiche de révision</div>
      ${rendreTexte(etat.fiche)}</div>` : ''}`;
}

function afficher(etat) {
  boite().innerHTML = rendreFil(etat);
  const fil = document.getElementById('entFil');
  if (fil) fil.scrollTop = fil.scrollHeight;
  document.getElementById('entReponse')?.focus();
}

/** Empêche le double envoi et dit ce qui se passe : un appel prend du temps. */
function occuper(message) {
  const f = document.getElementById('entForm');
  if (f) f.innerHTML = `<div class="ent-attente">${echapper(message)}</div>`;
}

/**
 * Ouvre la préparation pour une offre.
 *
 * @param {object} offre
 * @param {(msg: string, type?: string) => void} toast
 */
export async function ouvrirEntretien(offre, toast) {
  offreEnCours = offre;
  let etat;
  try {
    etat = await API.entretien(offre.id);
  } catch (e) { return toast(e.message, 'erreur'); }

  if (!etat.geminiPret) {
    return toast('La clé Gemini est nécessaire pour préparer un entretien.', 'erreur');
  }
  afficher(etat);
  ouvrirSurcouche('entretien');
}

/** Demande la fiche sans passer par la séance : elle n'en dépend pas. */
export async function ouvrirFiche(offre, toast) {
  offreEnCours = offre;
  let etat;
  try { etat = await API.entretien(offre.id); } catch (e) { return toast(e.message, 'erreur'); }
  if (!etat.geminiPret) {
    return toast('La clé Gemini est nécessaire.', 'erreur');
  }
  afficher(etat);
  ouvrirSurcouche('entretien');
  if (!etat.fiche) await demanderFiche(toast);
}

async function demanderFiche(toast) {
  const doc = document.createElement('div');
  doc.className = 'ent-doc';
  doc.innerHTML = '<div class="ent-attente">Rédaction de la fiche…</div>';
  boite().appendChild(doc);
  try {
    const r = await API.entretienFiche(offreEnCours.id);
    const etat = await API.entretien(offreEnCours.id);
    afficher(etat);
    toast('Fiche prête');
    return r;
  } catch (e) { doc.remove(); toast(e.message, 'erreur'); }
}

/** Branche les interactions. Un seul écouteur : le contenu est reconstruit. */
export function installerEntretien(toast) {
  const b = boite();
  if (!b) return;

  b.addEventListener('click', async (e) => {
    const bouton = e.target.closest('[data-ent]');
    if (!bouton || !offreEnCours) return;
    const quoi = bouton.dataset.ent;

    if (quoi === 'fermer') return fermerSurcouche('entretien');

    if (quoi === 'debrief') {
      bouton.disabled = true;
      try {
        await API.entretienDebrief(offreEnCours.id);
        afficher(await API.entretien(offreEnCours.id));
        toast('Débriefing prêt');
      } catch (err) { toast(err.message, 'erreur'); bouton.disabled = false; }
    }

    if (quoi === 'fiche') { bouton.disabled = true; await demanderFiche(toast); }

    if (quoi === 'reset') {
      if (!confirm('Recommencer la séance ?\n\nLes questions et tes réponses seront effacées. La fiche de révision est conservée.')) return;
      await API.entretienReset(offreEnCours.id);
      afficher(await API.entretien(offreEnCours.id));
    }
  });

  b.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!offreEnCours) return;
    const champ = document.getElementById('entReponse');
    const reponse = champ?.value.trim() ?? '';
    const premiere = !document.querySelector('.ent-tour');
    if (!reponse && !premiere) return;

    occuper(premiere ? 'Le jury ouvre la séance…' : 'Le jury réfléchit…');
    try {
      await API.entretienRepondre(offreEnCours.id, reponse);
      afficher(await API.entretien(offreEnCours.id));
    } catch (err) {
      toast(err.message, 'erreur');
      afficher(await API.entretien(offreEnCours.id));
    }
  });
}
