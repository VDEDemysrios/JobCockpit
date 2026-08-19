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
import { API } from './api.js';
import { echapper } from './format.js';
import { ouvrirDock, jouerMedia } from './dock.js';

const CLE_FIL = 'bp_chill_fil';

/**
 * L'image jointe au prochain message, s'il y en a une. Elle vit ici, pas dans
 * le fil : on ne la range dans le message qu'à l'envoi.
 */
let imageEnAttente = null;   // { apercu (dataURL), mimeType, data (base64) }

/**
 * RÉDUIRE L'IMAGE AVANT DE L'ENVOYER, et pourquoi.
 *
 * Une capture d'écran fait souvent 2 à 5 Mo. L'envoyer telle quelle, c'est
 * payer des jetons pour des pixels que le modèle n'a pas besoin de lire, et
 * gonfler le `localStorage` où vit la conversation. On la ramène à 1280 px de
 * côté maximum, en JPEG — largement assez pour lire une offre ou un mail.
 *
 * Rend `{ apercu, mimeType, data }` : l'aperçu (dataURL) pour l'afficher, et
 * la base64 nue (sans préfixe `data:`) pour l'API.
 */
function reduireImage(fichier, cote = 1280) {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new Error('Image illisible.'));
    lecteur.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image illisible.'));
      img.onload = () => {
        const ratio = Math.min(1, cote / Math.max(img.width, img.height));
        const l = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const c = document.createElement('canvas');
        c.width = l; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, l, h);
        const apercu = c.toDataURL('image/jpeg', 0.82);
        resolve({ apercu, mimeType: 'image/jpeg', data: apercu.split(',')[1] });
      };
      img.src = lecteur.result;
    };
    lecteur.readAsDataURL(fichier);
  });
}

/**
 * La conversation vit dans le NAVIGATEUR, pas dans la base.
 *
 * Une discussion informelle n'a pas à laisser de trace : ce qu'on dit un soir
 * de découragement n'a pas à être relu six mois plus tard dans un export.
 */
function lireFil() {
  try { return JSON.parse(localStorage.getItem(CLE_FIL) ?? '[]'); } catch { return []; }
}
function ecrireFil(fil) {
  const recent = fil.slice(-60);
  try {
    localStorage.setItem(CLE_FIL, JSON.stringify(recent));
  } catch {
    // Quota dépassé — presque toujours à cause des images. On garde le TEXTE
    // (le fil de la conversation), on ne largue que les images des messages,
    // en commençant par les plus anciens. Perdre une vignette vaut mieux que
    // perdre la conversation, ou de la voir refuser d'enregistrer.
    const sansImages = recent.map(m => ({ ...m, image: null }));
    try { localStorage.setItem(CLE_FIL, JSON.stringify(sansImages)); }
    catch { localStorage.setItem(CLE_FIL, JSON.stringify(sansImages.slice(-20))); }
  }
}

function rendreFil(fil) {
  if (!fil.length) {
    return `<p class="chill-vide">De quoi tu veux parler ? Du dernier film que
      tu as vu, d'une offre qui t'embête, de rien en particulier. Il connaît
      l'état de ta recherche s'il faut, mais il ne la ramènera pas sur le
      tapis.</p>`;
  }
  return fil.map(m => `
    <div class="chill-tour chill-${m.role}">
      <div class="chill-texte">
        ${m.image ? `<img class="chill-image" src="${echapper(m.image)}" alt="image envoyée">` : ''}
        ${m.texte ? echapper(m.texte).replace(/\n/g, '<br>') : ''}</div>
    </div>`).join('');
}

export function rendreChill() {
  const zone = document.getElementById('chillZone');
  if (!zone) return;
  const fil = lireFil();

  zone.innerHTML = `
    <div class="chill-grille">
      <div class="panel-box chill-parler">
        <h3><span data-ic="plume" data-ic-taille="14"></span> Discuter
          ${fil.length ? '<button class="chill-vider" data-chill="vider">Effacer</button>' : ''}</h3>
        <div class="chill-fil" id="chillFil">${rendreFil(fil)}</div>
        <div class="chill-apercu" id="chillApercu"></div>
        <form class="chill-saisie" id="chillForm">
          <textarea id="chillMsg" rows="2"
            placeholder="Écris, ou colle une capture (Ctrl+V) — Ctrl+Entrée pour envoyer"></textarea>
          <div class="chill-saisie-boutons">
            <button class="btn chill-joindre" type="button" data-chill="joindre"
              title="Joindre une image"><span data-ic="carte" data-ic-taille="14"></span> Image</button>
            <button class="btn btn-primary" type="submit">Envoyer</button>
          </div>
          <input type="file" id="chillFichier" accept="image/*" hidden>
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

  const f = document.getElementById('chillFil');
  if (f) f.scrollTop = f.scrollHeight;
  rendreApercu();
}

/** L'aperçu de l'image en attente, au-dessus de la barre de saisie. */
function rendreApercu() {
  const zone = document.getElementById('chillApercu');
  if (!zone) return;
  zone.innerHTML = imageEnAttente
    ? `<div class="chill-apercu-vignette">
        <img src="${echapper(imageEnAttente.apercu)}" alt="aperçu">
        <button class="chill-apercu-x" data-chill="retirer-image" title="Retirer">×</button>
      </div>`
    : '';
}

/** Prend un fichier image, le réduit, le met en attente et l'affiche. */
async function joindreFichier(fichier, signaler) {
  if (!fichier || !fichier.type.startsWith('image/')) return;
  try {
    imageEnAttente = await reduireImage(fichier);
    rendreApercu();
  } catch (e) {
    signaler?.(e.message, 'erreur');
  }
}

/** Branche la vue. Un seul écouteur : le contenu est reconstruit à chaque tour. */
export function installerChill(toast) {
  const zone = document.getElementById('chillZone');
  if (!zone) return;

  zone.addEventListener('click', (e) => {
    const b = e.target.closest('[data-chill]');
    if (!b) return;
    if (b.dataset.chill === 'vider') {
      if (!confirm('Effacer la conversation ?')) return;
      localStorage.removeItem(CLE_FIL);
      rendreChill();
    }
    if (b.dataset.chill === 'joindre') {
      document.getElementById('chillFichier')?.click();
    }
    if (b.dataset.chill === 'retirer-image') {
      imageEnAttente = null;
      rendreApercu();
    }
    if (['lecteur', 'spotify', 'twitch'].includes(b.dataset.chill)) {
      ouvrirDock(b.dataset.chill);
    }
  });

  // Le bouton « Image » ouvre le sélecteur de fichier.
  zone.addEventListener('change', (e) => {
    if (e.target.id !== 'chillFichier') return;
    joindreFichier(e.target.files?.[0], toast);
    e.target.value = '';   // pour pouvoir re-choisir le même fichier ensuite
  });

  // COLLER UNE CAPTURE. Un `<textarea>` ne peut pas contenir d'image : sans ce
  // gardien, Ctrl+V d'une capture ne faisait RIEN, ce qui ressemblait à un
  // collage cassé. On intercepte l'image et on la joint ; le collage de TEXTE,
  // lui, suit son cours normal (on ne l'empêche pas).
  zone.addEventListener('paste', (e) => {
    if (e.target.id !== 'chillMsg') return;
    const item = [...(e.clipboardData?.items ?? [])].find(i => i.type.startsWith('image/'));
    if (!item) return;               // pas d'image : c'est du texte, on laisse faire
    e.preventDefault();
    joindreFichier(item.getAsFile(), toast);
  });

  zone.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (e.target.id === 'chillLienForm') {
      const champ = document.getElementById('chillLien');
      if (jouerMedia(champ?.value)) champ.value = '';
      return;
    }

    if (e.target.id !== 'chillForm') return;
    const champ = document.getElementById('chillMsg');
    const texte = champ?.value.trim();
    // Une image seule est un message valide : on n'exige pas de texte avec.
    if (!texte && !imageEnAttente) return;

    const image = imageEnAttente;
    imageEnAttente = null;

    const fil = lireFil();
    fil.push({ role: 'moi', texte, image: image?.apercu ?? null });
    ecrireFil(fil);
    rendreChill();

    // On dit qu'il écrit : un appel prend plusieurs secondes, et un silence
    // ressemble à une panne.
    const zoneFil = document.getElementById('chillFil');
    if (zoneFil) {
      zoneFil.insertAdjacentHTML('beforeend',
        '<div class="chill-tour chill-lui chill-attente"><div class="chill-texte">…</div></div>');
      zoneFil.scrollTop = zoneFil.scrollHeight;
    }

    try {
      // L'image ne part qu'avec CE message ; l'historique reste en texte, sinon
      // chaque tour renverrait toutes les images déjà vues — coûteux et inutile.
      const r = await API.chat(
        fil.map(m => ({ role: m.role, texte: m.texte })),
        image ? { mimeType: image.mimeType, data: image.data } : undefined);
      const suite = lireFil();
      suite.push({ role: 'lui', texte: r.reponse });
      ecrireFil(suite);
    } catch (err) {
      toast(err.message, 'erreur');
    }
    rendreChill();
  });

  zone.addEventListener('keydown', (e) => {
    if (e.target.id === 'chillMsg' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      document.getElementById('chillForm')?.requestSubmit();
    }
  });
}
