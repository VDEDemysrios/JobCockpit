// La vue « Chill » : une conversation, et rien qui pousse.
//
// POURQUOI CETTE VUE EXISTE
// -------------------------
// Tout le reste de l'application pousse à agir : trois offres du jour, des
// relances en retard, un objectif hebdomadaire. C'est ce qu'il faut pour
// avancer, et c'est épuisant à la longue. Ici, rien ne pousse. On discute, et
// si la conversation revient sur les offres, elle revient d'elle-même.
//
// LE SON A DÉMÉNAGÉ, ET C'EST UNE CORRECTION, PAS UN RANGEMENT
// -------------------------------------------------------------
// Les lecteurs vivaient ici. Le défaut était structurel : cette vue est
// reconstruite à chaque rendu, donc le cadre aussi, donc la lecture repartait
// de zéro dès qu'on changeait d'onglet — c'est-à-dire pendant les seuls
// moments où l'on avait envie de fond sonore. Le lecteur est devenu une
// fenêtre flottante, frère de `.app`, que rien ne reconstruit : `dock.js`.
//
// LES PIÈCES JOINTES SURVIVENT AUX TOURS
// --------------------------------------
// C'est le défaut qu'on a payé le plus cher ici. On joignait une capture, on
// posait sa question AU TOUR SUIVANT, et le compagnon répondait « je n'ai pas
// accès aux images ». Il disait vrai : la version précédente n'envoyait la
// pièce qu'avec le message où on la déposait, et l'historique repartait en
// texte. Le serveur rouvre désormais une fenêtre bornée sur les derniers
// tours — voir `src/pieces.js`.
//
// La conséquence ici est une règle de stockage :
//   · le CONTENU des pièces vit en mémoire, dans `fil` ;
//   · le `localStorage` ne reçoit qu'une VIGNETTE et un descriptif.
//
// Un PDF de six méga-octets en base64 dépasse le quota du navigateur au
// deuxième fichier, et l'écriture échoue en silence : on perdrait TOUTE la
// conversation, pas seulement la pièce. Après un rechargement, le compagnon
// ne revoit donc plus les fichiers — c'est le prix, et il est annoncé.
import { API } from './api.js';
import { echapper } from './format.js';
import { rendreTexte } from './entretien.js';
import { ouvrirDock, jouerMedia } from './dock.js';
import {
  installerRobot, poser, reveiller, dire, taire,
  voixActive, basculerVoix, voixDisponible,
} from './robot.js';

const CLE_FIL = 'bp_chill_fil';

/**
 * La conversation vit dans le NAVIGATEUR, pas dans la base : ce qu'on dit un
 * soir de découragement n'a pas à être relu six mois plus tard dans un export.
 *
 * `fil` est la source de vérité EN MÉMOIRE — c'est elle qui porte le contenu
 * des pièces. Le `localStorage` n'en reçoit qu'une version allégée.
 */
let fil = [];
let enAttente = [];        // les pièces prêtes à partir avec le prochain message
let envoiEnCours = false;

// ─────────────────────────────────────────────────────── persistance

function lireFil() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_FIL) ?? '[]');
    return Array.isArray(brut) ? brut : [];
  } catch { return []; }
}

/**
 * Écrit une version ALLÉGÉE : les vignettes, jamais les fichiers.
 *
 * Le quota du `localStorage` tourne autour de cinq méga-octets pour tout le
 * domaine. Un seul PDF y tient à peine, deux le font déborder — et une
 * écriture qui échoue emporte la conversation entière.
 */
function ecrireFil() {
  const leger = fil.slice(-60).map(m => ({
    role: m.role, texte: m.texte, le: m.le,
    pieces: (m.pieces ?? []).map(p => ({
      nom: p.nom, mimeType: p.mimeType, genre: p.genre,
      taille: p.taille, vignette: p.vignette ?? null,
    })),
  }));
  try {
    localStorage.setItem(CLE_FIL, JSON.stringify(leger));
  } catch {
    // Plein malgré tout : on sacrifie les vignettes avant la conversation.
    try {
      localStorage.setItem(CLE_FIL, JSON.stringify(leger.map(m => ({
        ...m, pieces: m.pieces.map(p => ({ ...p, vignette: null })) }))));
    } catch { /* il reste la session en cours, en mémoire */ }
  }
}

// ─────────────────────────────────────────────────────── les pièces

const GENRES = {
  image: '🖼', pdf: '📕', son: '🎵', video: '🎬', document: '📄', texte: '📃',
};

/** Le même classement que le serveur — voir `src/pieces.js`. */
function genreDe(mime) {
  if (/^image\//i.test(mime)) return 'image';
  if (/^application\/pdf$/i.test(mime)) return 'pdf';
  if (/^audio\//i.test(mime)) return 'son';
  if (/^video\//i.test(mime)) return 'video';
  if (/wordprocessingml/i.test(mime)) return 'document';
  if (/^text\/|^application\/(json|xml|csv)/i.test(mime)) return 'texte';
  return 'inconnu';
}

const poids = (o) => (o >= 1048576
  ? `${(o / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);

const enBase64 = (fichier) => new Promise((resoudre, rejeter) => {
  const l = new FileReader();
  l.onload = () => resoudre(String(l.result).split(',')[1] ?? '');
  l.onerror = () => rejeter(new Error('lecture impossible'));
  l.readAsDataURL(fichier);
});

/**
 * Réduit une image avant de l'envoyer.
 *
 * PAS DE `createObjectURL`, ET C'EST UNE CONTRAINTE RÉELLE. La façon
 * habituelle de charger un fichier dans une `<img>` produit une adresse
 * `blob:` — que la politique de sécurité de ce projet REFUSE. La pièce jointe
 * échouait alors en silence : pas de vignette, pas de message, rien. Un
 * `FileReader` rend une adresse `data:`, déjà autorisée, et n'oblige à rien
 * ouvrir de plus.
 *
 * Une capture d'écran moderne fait 3840 px de large pour deux méga-octets. Le
 * modèle n'en tire rien de plus qu'à 1600 px, et le trajet est quatre fois
 * plus long. On ne réduit QUE les images : un PDF ou un son se dégraderait.
 */
function reduireImage(fichier, cote = 1600) {
  return new Promise((resoudre) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => resoudre(null);
    lecteur.onload = () => {
      const img = new Image();
      img.onerror = () => resoudre(null);
      img.onload = () => {
        const echelle = Math.min(1, cote / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * echelle);
        c.height = Math.round(img.height * echelle);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);

        // La vignette est une SECONDE réduction, minuscule : c'est elle qui part
        // dans le `localStorage`, et elle doit y tenir des dizaines de fois.
        const v = document.createElement('canvas');
        const ev = Math.min(1, 160 / Math.max(c.width, c.height));
        v.width = Math.round(c.width * ev);
        v.height = Math.round(c.height * ev);
        v.getContext('2d').drawImage(c, 0, 0, v.width, v.height);

        resoudre({
          mimeType: 'image/jpeg',
          data: c.toDataURL('image/jpeg', 0.85).split(',')[1],
          vignette: v.toDataURL('image/jpeg', 0.6),
        });
      };
      img.src = String(lecteur.result);
    };
    lecteur.readAsDataURL(fichier);
  });
}

async function preparerFichier(fichier) {
  const genre = genreDe(fichier.type);
  if (genre === 'inconnu') {
    return { erreur: `${fichier.name} : format non lu (${fichier.type || 'type inconnu'})` };
  }
  if (fichier.size > 9 * 1024 * 1024) {
    return { erreur: `${fichier.name} : trop lourd (${poids(fichier.size)}, 9 Mo maximum)` };
  }
  if (genre === 'image') {
    const reduit = await reduireImage(fichier);
    if (!reduit) return { erreur: `${fichier.name} : image illisible` };
    return { piece: { nom: fichier.name, genre, taille: fichier.size, ...reduit } };
  }
  return { piece: {
    nom: fichier.name, genre, taille: fichier.size,
    mimeType: fichier.type, data: await enBase64(fichier), vignette: null,
  } };
}

// ─────────────────────────────────────────────────────── rendu

function rendrePiecesDe(m) {
  if (!m.pieces?.length) return '';
  return `<div class="ch-pieces">${m.pieces.map(p => (p.genre === 'image' && p.vignette
    ? `<img class="ch-piece-img" src="${echapper(p.vignette)}" alt="${echapper(p.nom)}">`
    : `<span class="ch-piece" title="${echapper(p.nom)}">
        <span class="ch-piece-ic">${GENRES[p.genre] ?? '📎'}</span>
        <span class="ch-piece-nom">${echapper(p.nom)}</span>
        <span class="ch-piece-poids">${poids(p.taille ?? 0)}</span>
      </span>`)).join('')}</div>`;
}

const heure = (t) => (t
  ? new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  : '');

/**
 * Les réponses passent par le rendu markdown de la préparation d'entretien.
 *
 * Le compagnon a pour consigne de ne pas écrire en rapport, mais il glisse des
 * `**gras**` et des tirets malgré tout — et une astérisque au milieu d'un
 * message se lit comme une faute de frappe.
 */
function rendreConversation() {
  if (!fil.length) {
    return `<div class="ch-accueil">
      <p>De quoi tu veux parler ? Du dernier film que tu as vu, d'une offre qui
        t'embête, de rien en particulier.</p>
      <p class="ch-note">Tu peux lui envoyer une capture, un PDF, un Word, un
        son : il les lit vraiment. Glisse-les ici, colle-les, ou passe par le
        trombone.</p>
    </div>`;
  }
  return fil.map((m, i) => `
    <div class="ch-tour ch-${m.role}">
      <div class="ch-bulle">
        ${rendrePiecesDe(m)}
        ${m.texte ? `<div class="ch-texte">${m.role === 'lui'
    ? rendreTexte(m.texte)
    : echapper(m.texte).replace(/\n/g, '<br>')}</div>` : ''}
      </div>
      <div class="ch-sous">
        <span class="ch-heure">${heure(m.le)}</span>
        <button class="ch-mini" data-copier="${i}" title="Copier">⧉</button>
        ${m.role === 'lui' && voixDisponible()
    ? `<button class="ch-mini" data-relire="${i}" title="Lire à voix haute">🔈</button>` : ''}
      </div>
    </div>`).join('');
}

function rendreEnAttente() {
  const zone = document.getElementById('chAttente');
  if (!zone) return;
  zone.innerHTML = enAttente.length
    ? `<div class="ch-attente">${enAttente.map((p, i) => (p.genre === 'image'
      ? `<span class="ch-jointe"><img src="${echapper(p.vignette)}" alt="">
          <button data-retirer="${i}" title="Retirer">×</button></span>`
      : `<span class="ch-jointe ch-jointe-fic" title="${echapper(p.nom)}">
          <span class="ch-piece-ic">${GENRES[p.genre] ?? '📎'}</span>
          <span class="ch-piece-nom">${echapper(p.nom)}</span>
          <button data-retirer="${i}" title="Retirer">×</button></span>`)).join('')}</div>`
    : '';
}

export function rendreChill() {
  const zone = document.getElementById('chillZone');
  if (!zone) return;

  zone.innerHTML = `
    <div class="chill-grille">
      <div class="panel-box ch-panneau">
        <div class="ch-tete">
          <div class="ch-robot" id="chRobot"></div>
          <div class="ch-qui">
            <div class="ch-nom">Ton compagnon</div>
            <div class="ch-etat" id="chEtat">Là, si tu veux parler.</div>
          </div>
          ${voixDisponible()
    ? `<button class="rb-voix ${voixActive() ? 'allume' : ''}" id="chVoix"
        title="${voixActive() ? 'Couper la voix' : 'Lire les réponses à voix haute'}">🔊</button>`
    : ''}
          ${fil.length ? '<button class="chill-vider" data-chill="vider">Effacer</button>' : ''}
        </div>

        <div class="ch-fil" id="chFil">${rendreConversation()}</div>
        <button class="ch-bas" id="chBas" hidden title="Revenir en bas">↓</button>

        <div id="chAttente"></div>

        <form class="ch-saisie" id="chillForm">
          <button class="ch-trombone" type="button" data-chill="joindre"
            title="Joindre une image, un PDF, un Word, un son…">📎</button>
          <textarea id="chillMsg" rows="1"
            placeholder="Écris… (Ctrl+Entrée pour envoyer)"></textarea>
          <button class="btn btn-primary" type="submit">Envoyer</button>
          <input type="file" id="chillFichier" multiple hidden
            accept="image/*,application/pdf,audio/*,video/mp4,.docx,.txt,.md,.csv,.json">
        </form>
      </div>

      <!-- Le son n'est plus une colonne de cette vue : c'est une fenêtre qui
           te suit partout. Ce bloc n'est qu'une porte d'entrée. -->
      <div class="panel-box chill-media">
        <h3><span data-ic="etoile" data-ic-taille="14"></span> Fond sonore</h3>
        <p class="chill-note">Le lecteur est une <strong>fenêtre flottante</strong> :
          il reste ouvert quand tu changes d'onglet, tu le déplaces à la souris
          et tu le poses où tu veux. <span class="kbd">M</span> l'ouvre et le
          réduit de n'importe où.</p>
        <form class="chill-lien" id="chillLienForm">
          <input id="chillLien" placeholder="Lien YouTube, Twitch ou Spotify…" autocomplete="off">
          <button class="btn btn-primary" type="submit">Ouvrir</button>
        </form>
        <div class="chill-portes">
          <button class="btn" type="button" data-chill="lecteur">Ouvrir le lecteur</button>
          <button class="btn" type="button" data-chill="spotify">Spotify</button>
          <button class="btn" type="button" data-chill="twitch">Twitch</button>
        </div>
      </div>
    </div>`;

  installerRobot(document.getElementById('chRobot'));
  rendreEnAttente();
  const f = document.getElementById('chFil');
  if (f) f.scrollTop = f.scrollHeight;
  grandirChamp();
}

/** Le champ grandit avec le message : on écrit parfois cinq lignes. */
function grandirChamp() {
  const c = document.getElementById('chillMsg');
  if (!c) return;
  c.style.height = 'auto';
  c.style.height = `${Math.min(c.scrollHeight, 200)}px`;
}

const annoncer = (t) => {
  const e = document.getElementById('chEtat');
  if (e) e.textContent = t;
};

// ─────────────────────────────────────────────────────── câblage

export function installerChill(toast) {
  const zone = document.getElementById('chillZone');
  if (!zone) return;
  fil = lireFil();

  const joindre = async (fichiers) => {
    for (const f of [...fichiers].slice(0, 6)) {
      const { piece, erreur } = await preparerFichier(f);
      if (erreur) { toast(erreur, 'erreur'); continue; }
      enAttente.push(piece);
    }
    rendreEnAttente();
    reveiller();
  };

  zone.addEventListener('click', async (e) => {
    reveiller();

    const copier = e.target.closest('[data-copier]');
    if (copier) {
      const m = fil[Number(copier.dataset.copier)];
      if (m) { await navigator.clipboard.writeText(m.texte).catch(() => {}); toast('Copié.'); }
      return;
    }
    const relire = e.target.closest('[data-relire]');
    if (relire) {
      const m = fil[Number(relire.dataset.relire)];
      if (m) {
        annoncer('Il parle…');
        dire(m.texte, { surFin: () => annoncer('Là, si tu veux parler.') });
      }
      return;
    }
    const retirer = e.target.closest('[data-retirer]');
    if (retirer) { enAttente.splice(Number(retirer.dataset.retirer), 1); rendreEnAttente(); return; }

    const bVoix = e.target.closest('#chVoix');
    if (bVoix) {
      const actif = basculerVoix();
      bVoix.classList.toggle('allume', actif);
      toast(actif ? 'Il lira ses réponses à voix haute.' : 'Voix coupée.');
      return;
    }
    if (e.target.closest('#chBas')) {
      const f = document.getElementById('chFil');
      f?.scrollTo({ top: f.scrollHeight, behavior: 'smooth' });
      return;
    }

    const b = e.target.closest('[data-chill]');
    if (!b) return;
    if (b.dataset.chill === 'joindre') document.getElementById('chillFichier')?.click();
    if (b.dataset.chill === 'lecteur') ouvrirDock();
    if (b.dataset.chill === 'spotify') ouvrirDock('spotify');
    if (b.dataset.chill === 'twitch') ouvrirDock('twitch');
    if (b.dataset.chill === 'vider') {
      if (!confirm('Effacer la conversation ?')) return;
      taire();
      fil = [];
      localStorage.removeItem(CLE_FIL);
      rendreChill();
    }
  });

  zone.addEventListener('change', (e) => {
    if (e.target.id !== 'chillFichier') return;
    joindre(e.target.files ?? []);
    e.target.value = '';       // sans ça, redéposer le même fichier ne fait rien
  });

  // GLISSER-DÉPOSER. C'est le geste naturel pour un fichier, et sans cible le
  // document tombait DANS le navigateur — qui quittait l'application pour
  // l'ouvrir, en emportant la conversation en cours.
  for (const ev of ['dragenter', 'dragover']) {
    zone.addEventListener(ev, (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      zone.querySelector('.ch-panneau')?.classList.add('ch-survol');
    });
  }
  zone.addEventListener('dragleave', (e) => {
    if (e.target === zone) zone.querySelector('.ch-panneau')?.classList.remove('ch-survol');
  });
  zone.addEventListener('drop', (e) => {
    zone.querySelector('.ch-panneau')?.classList.remove('ch-survol');
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    joindre(e.dataTransfer.files);
  });

  // COLLER. Un `<textarea>` ne peut pas contenir d'image : sans cette
  // interception, `Ctrl+V` sur une capture ne faisait rien du tout.
  zone.addEventListener('paste', (e) => {
    const fichiers = [...(e.clipboardData?.items ?? [])]
      .filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
    if (!fichiers.length) return;      // du texte : on laisse faire
    e.preventDefault();
    joindre(fichiers);
  });

  // Le bouton « revenir en bas » n'apparaît que si on est remonté : affiché en
  // permanence, il masque la dernière ligne de la conversation.
  zone.addEventListener('scroll', (e) => {
    const f = e.target.closest?.('#chFil');
    if (!f) return;
    const bas = document.getElementById('chBas');
    if (bas) bas.hidden = f.scrollHeight - f.scrollTop - f.clientHeight < 80;
  }, true);

  zone.addEventListener('input', (e) => {
    if (e.target.id !== 'chillMsg') return;
    grandirChamp();
    reveiller();
    // Il se tourne vers toi pendant que tu écris : le seul état que
    // l'utilisateur déclenche, et celui qui rend la tête vivante.
    if (e.target.value.trim() && !envoiEnCours) poser('ecoute');
  });

  zone.addEventListener('keydown', (e) => {
    if (e.target.id === 'chillMsg' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      document.getElementById('chillForm')?.requestSubmit();
    }
  });

  zone.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (e.target.id === 'chillLienForm') {
      const champ = document.getElementById('chillLien');
      if (!champ?.value.trim()) return;
      jouerMedia(champ.value.trim());
      champ.value = '';
      return;
    }
    if (e.target.id !== 'chillForm' || envoiEnCours) return;

    const champ = document.getElementById('chillMsg');
    const texte = champ?.value.trim() ?? '';
    // Une pièce seule est un message valide : on n'exige pas de texte avec.
    if (!texte && !enAttente.length) return;

    const pieces = enAttente;
    enAttente = [];
    envoiEnCours = true;
    taire();

    fil.push({ role: 'moi', texte, le: Date.now(), pieces });
    ecrireFil();
    rendreChill();

    // IL LIT D'ABORD, IL ÉCRIT ENSUITE. Deux états valent mieux qu'un : le
    // premier dit « c'est parti », le second « ça vient ». Sur un appel de dix
    // secondes, c'est la différence entre attendre et douter.
    poser('lit', { bulle: pieces.length ? 'il regarde' : 'il lit' });
    annoncer(pieces.length ? 'Il regarde ce que tu lui as envoyé…' : 'Il te lit…');
    const versEcrit = setTimeout(() => {
      poser('ecrit', { bulle: 'il écrit' });
      annoncer('Il écrit…');
    }, 1600);

    try {
      const r = await API.chat(
        fil.map(m => ({ role: m.role, texte: m.texte, pieces: m.pieces })),
        pieces);
      clearTimeout(versEcrit);
      fil.push({ role: 'lui', texte: r.reponse, le: Date.now(), pieces: [] });
      ecrireFil();
      rendreChill();

      for (const x of r.refus ?? []) toast(`${x.nom} : ${x.raison}`, 'erreur');

      if (voixActive()) {
        annoncer('Il parle…');
        dire(r.reponse, { surFin: () => annoncer('Là, si tu veux parler.') });
      } else {
        poser('repos');
        annoncer('Là, si tu veux parler.');
      }
    } catch (err) {
      clearTimeout(versEcrit);
      poser('repos');
      annoncer('Ça n\'est pas passé.');
      rendreChill();
      toast(err.message, 'erreur');
    } finally {
      envoiEnCours = false;
    }
  });
}
