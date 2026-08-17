// La vue « Chill » : une conversation, et de quoi mettre du son.
//
// POURQUOI CETTE VUE EXISTE
// -------------------------
// Tout le reste de l'application pousse à agir : trois offres du jour, des
// relances en retard, un objectif hebdomadaire. C'est ce qu'il faut pour
// avancer, et c'est épuisant à la longue. Ici, rien ne pousse. On discute, on
// met de la musique, et si la conversation revient sur les offres, elle
// revient d'elle-même.
//
// LES LECTEURS SONT DES CADRES, PAS DES SCRIPTS
// ---------------------------------------------
// Spotify, YouTube et Twitch sont chargés dans des `<iframe>`. C'est un choix,
// pas une facilité :
//   · aucun script tiers ne s'exécute dans la page — la politique de sécurité
//     garde `script-src 'self'` ;
//   · aucun identifiant n'est demandé, donc rien à confier à l'application ;
//   · un cadre a son propre contexte : il ne peut ni lire le tableau de bord,
//     ni toucher à la base.
//
// La contrepartie est réelle et il faut la connaître : sans compte lié,
// Spotify ne joue que des extraits de trente secondes. Se connecter DANS le
// cadre (compte Premium) débloque la lecture complète — c'est Spotify qui
// gère la session, jamais nous.
import { API } from './api.js';
import { echapper } from './format.js';
import { versLecteur } from './media.js';

const CLE_FIL = 'bp_chill_fil';
const CLE_MEDIA = 'bp_chill_media';

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

function lireMedia() {
  try { return JSON.parse(localStorage.getItem(CLE_MEDIA) ?? 'null'); } catch { return null; }
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

function rendreMedia(media) {
  if (!media) {
    return `<div class="chill-media-vide">
      <p>Colle un lien <strong>Spotify</strong>, <strong>YouTube</strong> ou
        <strong>Twitch</strong> — ou juste un nom de chaîne Twitch.</p>
      <p class="chill-note">Rien à connecter : le lecteur s'ouvre tel quel.
        Sur Spotify, connecte-toi <em>dans le lecteur</em> pour les morceaux
        entiers ; sans compte, ce sont des extraits de trente secondes.</p>
    </div>`;
  }
  return `<iframe class="chill-cadre" src="${echapper(media.url)}"
    title="Lecteur ${echapper(media.type)}" loading="lazy"
    allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
    allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}

export function rendreChill() {
  const zone = document.getElementById('chillZone');
  if (!zone) return;
  const fil = lireFil();
  const media = lireMedia();

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

      <!-- Le lecteur se REDIMENSIONNE : on ne regarde pas un direct et on
           n'écoute pas un album dans la même fenêtre. La taille est retenue. -->
      <div class="panel-box chill-media" id="chillMediaBox">
        <h3><span data-ic="etoile" data-ic-taille="14"></span> Fond sonore
          ${media ? `<span class="chill-type">${echapper(media.type)}</span>
            <button class="chill-vider" data-chill="fermer">Fermer</button>` : ''}</h3>
        <form class="chill-lien" id="chillLienForm">
          <input id="chillLien" placeholder="Lien Spotify, YouTube, Twitch…" autocomplete="off">
          <button class="btn" type="submit">Ouvrir</button>
        </form>
        <div class="chill-cadre-boite" id="chillCadre">${rendreMedia(media)}</div>
      </div>
    </div>`;

  const boite = document.getElementById('chillCadre');
  const taille = localStorage.getItem('bp_chill_taille');
  if (boite && taille) boite.style.height = taille;
  boite?.addEventListener('mouseup', () => {
    localStorage.setItem('bp_chill_taille', boite.style.height || '');
  });

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
    if (b.dataset.chill === 'fermer') {
      localStorage.removeItem(CLE_MEDIA);
      rendreChill();
    }
  });

  zone.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (e.target.id === 'chillLienForm') {
      const champ = document.getElementById('chillLien');
      const media = versLecteur(champ?.value, location.hostname);
      if (!media) return toast('Lien non reconnu — Spotify, YouTube ou Twitch.', 'erreur');
      localStorage.setItem(CLE_MEDIA, JSON.stringify(media));
      rendreChill();
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
