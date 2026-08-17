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

/**
 * LES CARTES À RÉVISER.
 *
 * La réponse est MASQUÉE jusqu'au clic. C'est toute la mécanique : tenter de
 * restituer avant de lire est ce qui fait tenir une notion — relire donne
 * l'impression de savoir, et c'est cette impression qui s'effondre en séance.
 *
 * Une carte non certifiée par le modèle porte un avertissement visible. On
 * n'apprend pas du droit approximatif : on le vérifie d'abord, à la source
 * indiquée.
 */
/** Le type affiché en ce moment. « tout » signifie : sans filtre. */
let typeActif = 'tout';

function rendreNotions(notions, types = {}) {
  const cles = Object.keys(types);
  const compte = (t) => notions.filter(n => (n.type ?? 'jargon') === t).length;

  // Les boutons de fabrication, un par angle. Chacun dit ce qu'il produit :
  // « Le jargon » et « Ce que ça induit » ne s'expliquent pas d'eux-mêmes.
  const fabriquer = cles.map(t => `
    <button class="btn ent-fab" data-ent="notions" data-type="${t}"
            title="${echapper(types[t].aide)}">
      ${echapper(types[t].libelle)}
      ${compte(t) ? `<span class="ent-n">${compte(t)}</span>` : ''}
    </button>`).join('');

  if (!notions.length) {
    return `<div class="ent-doc">
      <div class="ent-doc-titre">Réviser le domaine</div>
      <p class="ent-vide">Tu ne connais pas ce métier ? Chaque bouton fabrique
        dix cartes sous un angle différent — le vocabulaire, le quotidien réel,
        des cas concrets, les conséquences d'une décision, les textes. Le recto
        seul d'abord : tu essaies de répondre, puis tu retournes.</p>
      <div class="ent-fabs">${fabriquer}</div>
    </div>`;
  }

  const visibles = typeActif === 'tout'
    ? notions.map((n, i) => ({ n, i }))
    : notions.map((n, i) => ({ n, i })).filter(x => (x.n.type ?? 'jargon') === typeActif);

  const sues = notions.filter(n => n.su).length;
  const aVerifier = notions.filter(n => !n.sur).length;

  const filtres = [
    `<button class="ent-filtre${typeActif === 'tout' ? ' actif' : ''}"
             data-filtre="tout">Tout <span class="ent-n">${notions.length}</span></button>`,
    ...cles.filter(t => compte(t)).map(t => `
      <button class="ent-filtre${typeActif === t ? ' actif' : ''}" data-filtre="${t}">
        ${echapper(types[t].libelle)} <span class="ent-n">${compte(t)}</span></button>`),
  ].join('');

  return `<div class="ent-doc">
    <div class="ent-doc-titre">Réviser le domaine
      <span class="ent-progres">${sues} / ${notions.length} sues</span></div>

    ${aVerifier ? `<p class="ent-avert">${aVerifier} carte${aVerifier > 1 ? 's' : ''}
      ${aVerifier > 1 ? 'sont marquées' : 'est marquée'} « à vérifier » : le modèle
      ne répond pas de leur exactitude. Va voir la source avant de l'apprendre —
      une règle fausse récitée en entretien ne se rattrape pas.</p>` : ''}

    <div class="ent-filtres">${filtres}</div>

    <div class="ent-cartes">
      ${visibles.map(({ n, i }) => `
        <div class="ent-carte${n.su ? ' su' : ''}${n.sur ? '' : ' douteuse'}" data-carte="${i}">
          <div class="ent-terme">
            <span class="ent-type">${echapper(types[n.type ?? 'jargon']?.libelle ?? '')}</span>
            ${echapper(n.terme)}
            ${n.sur ? '' : '<span class="ent-drapeau">à vérifier</span>'}
          </div>
          <div class="ent-reponse" hidden>
            ${n.memo ? `<p class="ent-memo">${echapper(n.memo)}</p>` : ''}
            <p>${echapper(n.definition).replace(/\n/g, '<br>')}</p>
            ${n.piege ? `<p class="ent-piege"><span>Piège</span> ${echapper(n.piege)}</p>` : ''}
            ${n.pourquoi ? `<p class="ent-pourquoi">${echapper(n.pourquoi)}</p>` : ''}
            ${n.source ? `<p class="ent-source">Source : ${echapper(n.source)}</p>` : ''}
            <div class="ent-juger">
              <button class="btn" data-juger="${i}" data-su="0">À revoir</button>
              <button class="btn" data-juger="${i}" data-su="1">Je sais</button>
            </div>
          </div>
        </div>`).join('') || '<p class="ent-vide">Aucune carte de ce type pour l\'instant.</p>'}
    </div>

    <div class="ent-fabs">
      <span class="ent-fabs-t">Fabriquer 10 cartes :</span>
      ${fabriquer}
    </div>
  </div>`;
}

/**
 * Les pages réellement consultées pendant la recherche.
 *
 * C'est la différence entre croire une définition et aller lire le texte. Sur
 * un domaine juridique, c'est la seule chose qui protège d'apprendre du faux
 * avec confiance.
 */
function rendreLiens(liens) {
  if (!liens?.length) return '';
  return `<div class="ent-doc">
    <div class="ent-doc-titre">Sources consultées</div>
    <p class="ent-vide">Les pages que le modèle a réellement ouvertes pour
      fabriquer ces cartes. Va y vérifier ce que tu comptes citer.</p>
    <ul class="ent-liens">
      ${liens.map(l => `<li><a href="${echapper(l.url)}" target="_blank"
        rel="noopener">${echapper(l.titre || l.url)}</a></li>`).join('')}
    </ul>
  </div>`;
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

    ${rendreNotions(etat.notions ?? [], etat.typesNotions ?? {})}
    ${rendreLiens(etat.liens)}

    ${etat.debrief ? `<div class="ent-doc"><div class="ent-doc-titre">Débriefing</div>
      ${rendreTexte(etat.debrief)}</div>` : ''}
    ${etat.fiche ? `<div class="ent-doc"><div class="ent-doc-titre">Fiche de révision</div>
      ${rendreTexte(etat.fiche)}</div>` : ''}`;
}

function afficher(etat) {
  boite().innerHTML = rendreFil(etat);
  const fil = document.getElementById('entFil');
  if (fil) fil.scrollTop = fil.scrollHeight;
  const champ = document.getElementById('entReponse');
  if (champ) {
    champ.focus();
    // Ctrl+Entrée envoie : on écrit plusieurs paragraphes en entretien, donc
    // Entrée seule doit rester un saut de ligne.
    champ.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        document.getElementById('entForm')?.requestSubmit();
      }
    });
    // Le champ grandit avec la réponse : une réponse d'entretien fait dix
    // lignes, et se relire dans une fenêtre de quatre est pénible.
    const grandir = () => {
      champ.style.height = 'auto';
      champ.style.height = Math.min(champ.scrollHeight, 340) + 'px';
    };
    champ.addEventListener('input', grandir);
    grandir();
  }
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

/**
 * LA LISTE DES DOSSIERS, dans sa propre vue.
 *
 * Ce qu'on veut savoir en arrivant ici est simple, et tient en une ligne par
 * dossier : où j'en suis. Le reste — le fil, les cartes — s'ouvre au clic.
 *
 * Chaque ligne dit son avancement avec des CHIFFRES et pas des libellés :
 * « 3/8 questions · 20 cartes, 6 sues » se lit d'un coup d'œil, « préparation
 * en cours » ne dit rien.
 */
export async function rendreDossiers(toast) {
  const zone = document.getElementById('entDossiers');
  const sous = document.getElementById('entSub');
  if (!zone) return;

  let d;
  try { d = await API.entretiens(); }
  catch (e) { zone.innerHTML = `<p class="ent-vide">${echapper(e.message)}</p>`; return; }

  const dossiers = d.dossiers ?? [];
  if (sous) {
    sous.textContent = dossiers.length
      ? `${dossiers.length} candidature${dossiers.length > 1 ? 's' : ''} envoyée${dossiers.length > 1 ? 's' : ''} — prépare celle qui vient.`
      : 'Rien à préparer pour l\'instant.';
  }

  if (!dossiers.length) {
    zone.innerHTML = `<div class="panel-box"><p class="ent-vide">Aucune
      candidature envoyée. Cette vue se remplit dès que tu marques une offre
      comme envoyée : c'est à ce moment qu'un entretien devient possible, et
      qu'il vaut la peine de s'y préparer.</p></div>`;
    return;
  }

  zone.innerHTML = `<div class="panel-box"><div class="dos-liste">
    ${dossiers.map(o => {
      const commence = o.questions > 0 || o.cartes > 0;
      return `
      <div class="dos" data-dossier="${echapper(o.id)}">
        <div class="dos-t">
          <div class="dos-titre">${echapper(o.titre)}</div>
          <div class="dos-sous">${echapper([o.entreprise, o.ville].filter(Boolean).join(' · ') || '—')}
            ${o.envoyeLe ? `· envoyée le ${echapper(o.envoyeLe)}` : ''}</div>
        </div>
        <div class="dos-etat">
          ${commence ? `
            <span class="dos-jauge" title="Questions posées">${o.questions}/${o.total} questions</span>
            <span class="dos-jauge" title="Cartes révisées">${o.cartesSues}/${o.cartes} cartes</span>
            ${o.debrief ? '<span class="badge b2">débriefé</span>' : ''}
            ${o.fiche ? '<span class="badge badge-src">fiche</span>' : ''}`
          : '<span class="dos-neuf">Pas encore préparé</span>'}
        </div>
        <button class="btn btn-primary" data-ouvrir="${echapper(o.id)}">
          ${commence ? 'Reprendre' : 'Préparer'}</button>
      </div>`;
    }).join('')}
  </div></div>`;

  // Un seul écouteur, reposé à chaque rendu : la liste est reconstruite.
  zone.onclick = async (e) => {
    const b = e.target.closest('[data-ouvrir]') ?? e.target.closest('[data-dossier]');
    if (!b) return;
    const id = b.dataset.ouvrir ?? b.dataset.dossier;
    const cible = dossiers.find(x => x.id === id);
    if (cible) await ouvrirEntretien({ id, titre: cible.titre }, toast);
  };
}

/** Branche les interactions. Un seul écouteur : le contenu est reconstruit. */
export function installerEntretien(toast) {
  const b = boite();
  if (!b) return;

  b.addEventListener('click', async (e) => {
    // Le jugement d'une carte, avant tout le reste : il est DANS une carte,
    // dont le clic sert par ailleurs à la retourner.
    const juge = e.target.closest('[data-juger]');
    if (juge && offreEnCours) {
      e.stopPropagation();
      const i = Number(juge.dataset.juger);
      const su = juge.dataset.su === '1';
      try {
        await API.entretienNotionSue(offreEnCours.id, i, su);
        afficher(await API.entretien(offreEnCours.id));
      } catch (err) { toast(err.message, 'erreur'); }
      return;
    }

    // Retourner une carte. La réponse est masquée jusqu'ici : tenter de
    // restituer avant de lire est ce qui fait tenir la notion.
    const carte = e.target.closest('.ent-carte');
    if (carte) {
      const r = carte.querySelector('.ent-reponse');
      if (r) { r.hidden = !r.hidden; carte.classList.toggle('ouverte', !r.hidden); }
      return;
    }

    const filtre = e.target.closest('[data-filtre]');
    if (filtre) {
      typeActif = filtre.dataset.filtre;
      afficher(await API.entretien(offreEnCours.id));
      return;
    }

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

    if (quoi === 'notions') {
      bouton.disabled = true;
      const avant = bouton.textContent;
      bouton.textContent = 'Fabrication des cartes…';
      try {
        const r = await API.entretienNotions(offreEnCours.id, bouton.dataset.type);
        afficher(await API.entretien(offreEnCours.id));
        toast(`${r.ajoutees} carte${r.ajoutees > 1 ? 's' : ''} à réviser`);
      } catch (err) {
        toast(err.message, 'erreur');
        bouton.disabled = false; bouton.textContent = avant;
      }
    }

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
