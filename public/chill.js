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
 * La conversation vit dans le NAVIGATEUR, pas dans la base.
 *
 * Une discussion informelle n'a pas à laisser de trace : ce qu'on dit un soir
 * de découragement n'a pas à être relu six mois plus tard dans un export.
 */
function lireFil() {
  try { return JSON.parse(localStorage.getItem(CLE_FIL) ?? '[]'); } catch { return []; }
}
function ecrireFil(fil) {
  localStorage.setItem(CLE_FIL, JSON.stringify(fil.slice(-60)));
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
      <div class="chill-texte">${echapper(m.texte).replace(/\n/g, '<br>')}</div>
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
        <form class="chill-saisie" id="chillForm">
          <textarea id="chillMsg" rows="2" placeholder="Écris… (Ctrl+Entrée pour envoyer)"></textarea>
          <button class="btn btn-primary" type="submit">Envoyer</button>
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
    if (['lecteur', 'spotify', 'twitch'].includes(b.dataset.chill)) {
      ouvrirDock(b.dataset.chill);
    }
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
    if (!texte) return;

    const fil = lireFil();
    fil.push({ role: 'moi', texte });
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
      const r = await API.chat(fil.map(m => ({ role: m.role, texte: m.texte })));
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
