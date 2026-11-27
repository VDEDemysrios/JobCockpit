// La boîte de confirmation de l'application, à la place de `confirm()`.
//
// POURQUOI REMPLACER `confirm()`
// ------------------------------
// La boîte native est dessinée par le navigateur : grise, hors thème, avec le
// nom de l'hôte en titre (« localhost:3000 indique… ») — au milieu d'une
// interface qui a choisi chacun de ses gris. Surtout, elle ne distingue rien :
// « Effacer l'historique » et « Retirer de la sélection » avaient le même
// bouton OK, à la même place, de la même couleur. Une action qui détruit se
// confirme d'un bouton ROUGE, et on doit pouvoir le lire avant de le viser.
//
// Elle BLOQUE aussi le fil d'exécution : pendant qu'elle est ouverte, plus
// rien ne s'anime, plus un minuteur ne tourne — le lecteur flottant compris.
//
// LE CONTRAT
// ----------
// `confirmer({ titre, message, ok, annuler, danger })` rend une promesse de
// booléen. Entrée confirme, Échap annule (via la pile de `surcouche.js`), un
// clic sur le voile annule. Le focus va au bouton d'action et revient, à la
// fermeture, là où il était.

import { ouvrirSurcouche, fermerSurcouche } from './surcouche.js';
import { echapper } from './format.js';
import { icone } from './icons.js';

/**
 * Demande une confirmation.
 *
 * @param {object} o
 * @param {string} o.titre
 * @param {string} [o.message]   texte simple ; les sauts de ligne sont gardés
 * @param {string} [o.ok]        libellé du bouton d'action
 * @param {string} [o.annuler]
 * @param {boolean} [o.danger]   action destructive : bouton rouge, icône d'alerte
 * @returns {Promise<boolean>}
 */
export function confirmer({ titre, message = '', ok = 'Confirmer', annuler = 'Annuler', danger = false } = {}) {
  // Hors navigateur (tests) : on ne détruit rien par défaut.
  if (typeof document === 'undefined') return Promise.resolve(false);

  return new Promise((resoudre) => {
    let reponse = false;
    const voile = document.createElement('div');
    voile.className = 'overlay dlg-voile';
    voile.innerHTML = `
      <div class="dlg${danger ? ' danger' : ''}" role="document">
        <div class="dlg-ic" aria-hidden="true">${icone(danger ? 'alerte' : 'info', 20)}</div>
        <div class="dlg-corps">
          <h2 class="dlg-titre" id="dlgTitre">${echapper(titre)}</h2>
          ${message ? `<p class="dlg-texte">${echapper(message).replace(/\n/g, '<br>')}</p>` : ''}
        </div>
        <div class="dlg-pied">
          <button type="button" class="btn" data-dlg="non">${echapper(annuler)}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-dlg="oui">${echapper(ok)}</button>
        </div>
      </div>`;
    document.body.appendChild(voile);

    const boutonOk = voile.querySelector('[data-dlg="oui"]');

    const conclure = (oui) => {
      reponse = oui;
      fermerSurcouche(voile);
    };

    voile.addEventListener('click', (e) => {
      if (e.target === voile) return conclure(false);
      const b = e.target.closest('[data-dlg]');
      if (b) conclure(b.dataset.dlg === 'oui');
    });
    voile.addEventListener('keydown', (e) => {
      // Entrée confirme même si le focus a glissé sur « Annuler » par
      // tabulation ? Non : un bouton qui a le focus fait ce qu'il dit. Entrée
      // ne force la confirmation que hors des boutons.
      if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); conclure(true); }
    });

    ouvrirSurcouche(voile, {
      focus: boutonOk,
      titre,
      surFermeture: () => {
        // Retiré du DOM une fois la sortie jouée : la pile a déjà rendu le
        // focus, rien ne dépend plus de cet élément.
        setTimeout(() => voile.remove(), 0);
        resoudre(reponse);
      },
    });
    voile.setAttribute('aria-labelledby', 'dlgTitre');
  });
}
