// Glisser-déposer du CV, sur toute l'application.
//
// POURQUOI SUR TOUTE LA FENÊTRE, ET PAS SUR UNE ZONE
// --------------------------------------------------
// Une zone de dépôt cachée dans l'onglet « Mon CV » suppose qu'on sache
// qu'elle existe et qu'on y aille. Or déposer son CV est un geste qu'on fait
// UNE fois, au tout début, quand on ne connaît pas encore l'application.
// Elle écoute donc partout : lâcher un .docx n'importe où le prend.
//
// Le voile n'apparaît QUE pour un fichier. Sans cette vérification, faire
// glisser un mot d'une carte à l'autre déclenchait un « dépose ton CV ici »
// en plein écran, ce qui est absurde et donne l'impression que l'application
// ne comprend rien à ce qu'on fait.
//
// IL FAUT AUSSI UN BOUTON, ET CE N'EST PAS UNE COMMODITÉ
// -----------------------------------------------------
// Le glisser-déposer était le SEUL moyen d'installer un CV, et rien à l'écran
// ne l'annonçait : la visite guidée le disait une fois, et la visite ne passe
// qu'une fois. Qui la refusait — ou la voyait s'interrompre — se retrouvait
// devant une vue « Mon CV » vide qui conseillait une commande de terminal,
// laquelle n'existe pas dans l'exécutable distribué. Le CV devenait
// littéralement impossible à installer, alors que c'est la pièce dont
// dépendent l'analyse des offres et toutes les lettres.
//
// D'où `[data-choisir-cv]` : n'importe quel bouton portant cet attribut ouvre
// le sélecteur de fichiers. L'écoute est DÉLÉGUÉE au document, parce que les
// vues sont reconstruites à chaque rendu — un écouteur posé sur le bouton
// partirait avec lui au premier rafraîchissement.

import { API } from './api.js';

export const EXTENSIONS = ['.docx', '.txt'];

/** L'utilisateur fait-il glisser un FICHIER, et non du texte ou un élément ? */
function transporteUnFichier(evenement) {
  const types = evenement.dataTransfer?.types;
  return Boolean(types && [...types].includes('Files'));
}

/**
 * Installe le dépôt de CV.
 *
 * @param {(message: string, type?: string) => void} toast
 * @param {() => Promise<void>} apresDepot  recharge les données concernées
 */
export function installerDepotCv(toast, apresDepot) {
  const voile = document.createElement('div');
  voile.className = 'depot-voile';
  voile.setAttribute('aria-hidden', 'true');
  voile.innerHTML = `<div class="depot-boite">
      <div class="depot-titre">Dépose ton CV</div>
      <div class="depot-sous">Word (.docx) ou texte (.txt)</div>
    </div>`;
  document.body.appendChild(voile);

  // Le sélecteur de fichiers, créé UNE fois et gardé caché : `accept` fait
  // que l'explorateur ne propose d'emblée que ce qu'on sait lire.
  const choix = document.createElement('input');
  choix.type = 'file';
  choix.accept = EXTENSIONS.join(',');
  choix.hidden = true;
  choix.addEventListener('change', async () => {
    const fichier = choix.files?.[0];
    // Le champ est vidé AVANT l'envoi : sans ça, rechoisir le même fichier
    // après l'avoir corrigé ne déclenche aucun `change`, et l'application a
    // l'air de refuser de le reprendre.
    choix.value = '';
    if (fichier) await envoyer(fichier, toast, apresDepot);
  });
  document.body.appendChild(choix);

  document.addEventListener('click', (evenement) => {
    if (!evenement.target.closest?.('[data-choisir-cv]')) return;
    evenement.preventDefault();
    choix.click();
  });

  // `dragenter`/`dragleave` se déclenchent aussi en passant d'un élément
  // enfant à un autre : le voile clignoterait à chaque survol. On compte donc
  // les entrées et les sorties plutôt que de basculer un drapeau.
  let profondeur = 0;

  const montrer = () => voile.classList.add('actif');
  const cacher = () => { profondeur = 0; voile.classList.remove('actif'); };

  window.addEventListener('dragenter', (e) => {
    if (!transporteUnFichier(e)) return;
    profondeur++;
    montrer();
  });

  window.addEventListener('dragover', (e) => {
    if (!transporteUnFichier(e)) return;
    // Sans ceci, le navigateur ouvre le fichier à la place de l'application —
    // on quitte le tableau de bord pour un document Word affiché brut.
    e.preventDefault();
  });

  window.addEventListener('dragleave', (e) => {
    if (!transporteUnFichier(e)) return;
    if (--profondeur <= 0) cacher();
  });

  window.addEventListener('drop', async (e) => {
    if (!transporteUnFichier(e)) return;
    e.preventDefault();
    cacher();
    const fichier = e.dataTransfer.files?.[0];
    if (fichier) await envoyer(fichier, toast, apresDepot);
  });

  return {
    envoyer: (f) => envoyer(f, toast, apresDepot),
    choisir: () => choix.click(),
  };
}

/** Envoie le fichier et rend compte, en clair, de ce qui s'est passé. */
async function envoyer(fichier, toast, apresDepot) {
  const nom = fichier.name ?? '';
  const ext = (nom.toLowerCase().match(/\.[a-z0-9]+$/) ?? [''])[0];

  // On refuse AVANT d'envoyer quand c'est évident : téléverser dix mégaoctets
  // pour s'entendre dire « format non reconnu » est une perte de temps qu'on
  // peut éviter côté navigateur. Le serveur revérifie de son côté — c'est lui
  // qui fait autorité.
  if (ext === '.pdf') {
    return toast('Le PDF n\'est pas lisible. Dans Word : « Enregistrer sous » → .docx', 'err');
  }
  if (!EXTENSIONS.includes(ext)) {
    return toast(`Dépose un fichier .docx ou .txt (reçu : ${ext || 'sans extension'})`, 'err');
  }

  toast('Lecture du CV…');
  try {
    const r = await API.envoyerCv(fichier);
    toast(`CV enregistré — ${r.caracteres} caractères lus.`, 'win');
    await apresDepot?.();
  } catch (erreur) {
    toast(erreur.message, 'err');
  }
}
