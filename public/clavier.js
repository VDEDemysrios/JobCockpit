// LES RACCOURCIS CLAVIER.
//
// CE QUI NE MARCHAIT PAS
// ----------------------
// · Ils agissaient DERRIÈRE les surcouches. Seule la palette était exclue :
//   « r » dans l'entretien blanc (hors du champ) lançait une collecte, « t »
//   repeignait l'application sous une boîte de dialogue. La pile de
//   `surcouche.js` règle ça : quand quelque chose est ouvert, on se tait.
// · L'aide annonçait « G F » et « G S », qui n'existaient pas, et les
//   Entretiens comme le Chill n'avaient aucun raccourci.
// · La liste des offres ne se parcourait qu'à la souris. Trier deux cents
//   offres, c'est deux cents allers-retours de la main vers la souris.
//
// LA LISTE AU CLAVIER
// -------------------
// J / K descendent et remontent (la convention de Gmail et de Vim), la carte
// courante porte `.focus` et reçoit le vrai focus — un lecteur d'écran suit.
// Entrée déplie, P épingle, E marque envoyée, L ouvre la lettre, X écarte.
// Ces touches ne valent QUE dans la vue Offres ; ailleurs, elles ne font rien
// plutôt que d'agir sur une carte invisible.

import { surcoucheOuverte } from './surcouche.js';

/** Séquences « G puis lettre » → vue. Exporté : l'aide et les tests le lisent. */
export const VUES_RACCOURCI = {
  d: 'dashboard', o: 'offers', k: 'kanban', a: 'agenda',
  e: 'entretiens', c: 'chill', v: 'cv', r: 'options',
};

/**
 * @param {object} ctx  les gestes de l'application (voir app.js)
 */
export function installerClavier(ctx) {
  let attendLettre = false;
  let minuterieG = null;

  const cartes = () => [...document.querySelectorAll('#grid .card')];
  const carteCourante = () => document.querySelector('#grid .card.focus');

  function deplacer(delta) {
    const liste = cartes();
    if (!liste.length) return;
    const actuelle = carteCourante();
    let i = actuelle ? liste.indexOf(actuelle) + delta : (delta > 0 ? 0 : liste.length - 1);
    i = Math.max(0, Math.min(liste.length - 1, i));
    actuelle?.classList.remove('focus');
    const cible = liste[i];
    cible.classList.add('focus');
    const tete = cible.querySelector('.head');
    tete?.focus({ preventScroll: true });
    cible.scrollIntoView({ block: 'nearest', behavior: document.documentElement.dataset.anim === 'off' ? 'auto' : 'smooth' });
  }

  document.addEventListener('keydown', (e) => {
    const cible = e.target;
    // `e.target` n'est pas toujours un Element (ce peut être `document`) :
    // appeler .matches() dessus lèverait une exception et tuerait silencieusement
    // TOUS les raccourcis.
    const saisie = cible instanceof Element
      && (cible.matches('input, textarea, select') || cible.isContentEditable);

    // Ctrl+K est le seul raccourci qui traverse une zone de saisie — et la
    // seule surcouche qu'on referme par le même geste qu'on l'ouvre.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (ctx.palette.estOuverte()) ctx.palette.fermer();
      else if (!surcoucheOuverte()) ctx.palette.ouvrir();
      return;
    }

    // Une surcouche a le clavier : elle seule. Échap est traité par la pile.
    if (surcoucheOuverte()) return;

    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === 'Escape') {
      if (ctx.rappels?.fermerCentre({ rendreFocus: true })) return;
      if (ctx.fermerTiroir()) return;
      if (saisie) { cible.blur(); return; }
      if (ctx.focus?.actif()) { ctx.focus.quitter(); return; }
      if (ctx.fermerFormulaire()) return;
      carteCourante()?.classList.remove('focus');
      return;
    }

    if (saisie) return;

    // Deuxième touche d'une séquence « G + lettre ».
    if (attendLettre) {
      attendLettre = false;
      clearTimeout(minuterieG);
      const vue = VUES_RACCOURCI[e.key.toLowerCase()];
      if (vue) { e.preventDefault(); ctx.changerVue(vue); }
      return;
    }

    const touche = e.key.toLowerCase();

    // La liste au clavier, dans la vue Offres seulement.
    if (ctx.vue() === 'offers' && !ctx.focus?.actif()) {
      const carte = carteCourante();
      switch (touche) {
        case 'j': e.preventDefault(); deplacer(1); return;
        case 'k': e.preventDefault(); deplacer(-1); return;
      }
      // Entrée sur une carte courante dont l'en-tête n'a pas le focus (celui-ci
      // gère sa propre Entrée — voir brancherCarte).
      if (carte && touche === 'enter' && !carte.querySelector('.head')?.contains(cible)) {
        e.preventDefault(); ctx.actionCarte(carte, 'basculer'); return;
      }
      if (carte && ['p', 'e', 'l', 'x'].includes(touche)) {
        e.preventDefault();
        ctx.actionCarte(carte, { p: 'epingler', e: 'envoyer', l: 'lettre', x: 'ecarter' }[touche]);
        return;
      }
    }

    switch (touche) {
      case 'g':
        attendLettre = true;
        // La séquence expire, sinon un « g » isolé piégerait la frappe suivante.
        minuterieG = setTimeout(() => { attendLettre = false; }, 1200);
        break;
      case '/':
        e.preventDefault();
        ctx.rechercher();
        break;
      case 'r':
        e.preventDefault();
        ctx.lancerCollecte();
        break;
      case 'n':
        e.preventDefault();
        ctx.ajouterOffre();
        break;
      case 't':
        e.preventDefault();
        ctx.themeSuivant();
        break;
      case 'f':
        e.preventDefault();
        ctx.focus?.basculer();
        break;
      // Le tri éclair : une offre à la fois. Une fois ouvert, c'est une
      // surcouche — ses propres touches (flèches, U) lui appartiennent.
      case 'z':
        e.preventDefault();
        ctx.ouvrirTri?.();
        break;
      // Le lecteur flottant. Ouvre, puis réduit et déplie — c'est le geste
      // qu'on répète le plus : ranger le son sans l'arrêter.
      case 'm':
        e.preventDefault();
        ctx.basculerDock();
        break;
      case '?':
        e.preventDefault();
        ctx.ouvrirAide();
        break;
    }
  });

  return { deplacer };
}
