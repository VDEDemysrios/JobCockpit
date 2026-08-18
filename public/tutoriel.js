// Visite guidée de l'application.
//
// POURQUOI UNE VISITE PLUTÔT QU'UNE PAGE D'AIDE
// ---------------------------------------------
// Une page d'aide se lit ailleurs, sur un écran qui ne ressemble pas à celui
// qu'on va utiliser. On y apprend des mots, pas des gestes. La visite désigne
// l'élément réel, à sa place réelle, et change de vue quand il le faut : au
// bout de six étapes, on a vu l'application faire ce qu'elle fait.
//
// TROIS RÈGLES, LES MÊMES QUE POUR L'OUVERTURE
// --------------------------------------------
// · une seule fois, à la première visite — ensuite elle se rappelle par la
//   palette ou par les Options ;
// · interruptible à tout instant, par Échap, par le bouton, par un clic
//   dehors. Une visite qu'on ne peut pas quitter est une prise en otage ;
// · muette si les animations sont coupées ou si le système demande moins de
//   mouvement.

const CLE_VUE = 'bp_tutoriel_vu';

/**
 * Les étapes. `cible` est un sélecteur ; `vue` fait basculer l'application
 * avant de chercher l'élément.
 *
 * Une étape dont la cible est introuvable est SAUTÉE plutôt que d'afficher
 * une bulle dans le vide : la sélection du jour n'existe pas tant qu'aucune
 * offre n'a été collectée, et le premier jour est justement celui où la
 * visite sert le plus.
 */
const ETAPES = [
  {
    vue: 'dashboard', cible: '.panel-dujour',
    titre: 'Commence par ici',
    texte: 'Trois offres, choisies parmi les plus pertinentes du moment : dans ta '
      + 'ville, fraîches, déjà analysées. Elles restent jusqu\'à ce que tu t\'en '
      + 'occupes — c\'est voulu, on n\'esquive pas en rechargeant la page.',
  },
  {
    vue: 'dashboard', cible: '#refreshBtn',
    titre: 'Chercher des offres',
    texte: 'La collecte part toute seule au démarrage puis toutes les 6 heures. '
      + 'Ce bouton sert quand tu ne veux pas attendre.',
  },
  {
    vue: 'offers', cible: '#villes',
    titre: 'Tes villes, et tes candidatures',
    texte: 'Un onglet par ville, plus « Autre » pour le reste. Dès que tu marques '
      + 'une offre comme envoyée, elle quitte sa ville pour l\'onglet « Envoyées » : '
      + 'la liste ne montre que ce qu\'il reste à faire.',
  },
  {
    vue: 'offers', cible: '#grid .verdict-replie',
    titre: 'Le verdict, avant d\'ouvrir',
    texte: 'Sur chaque carte : combien de tes atouts l\'analyse a trouvés face aux '
      + 'exigences de l\'annonce, et son jugement en une phrase. Les manques sont '
      + 'affichés aussi — c\'est le contraste qui rend un « fonce » crédible.',
  },
  {
    vue: 'cv', cible: '#view-cv',
    titre: 'Ton CV, déposé d\'un glisser',
    texte: 'Lâche ton CV Word n\'importe où dans la fenêtre : il est lu et comparé '
      + 'à tes mots-clés. C\'est lui qui part en pièce jointe, tel quel, et c\'est '
      + 'sur lui que reposent l\'analyse et les lettres.',
  },
  {
    vue: 'offers', cible: '#grid .card',
    titre: "La lettre, puis le dossier",
    texte: "Déplie une offre : le programme rédige une lettre adossée à ton CV, "
      + "que tu peux retoucher. Le bouton « Dossier complet » la télécharge avec "
      + "ton CV, dans un seul fichier prêt à joindre à un mail.",
  },
  {
    vue: 'entretiens', cible: '[data-view="entretiens"]',
    titre: "Répéter devant un jury qui ne dort pas",
    texte: "Un entretien décroché ? Cet onglet pose les questions qu'on te posera "
      + "vraiment sur CETTE offre, écoute tes réponses, puis te débriefe. Il en tire "
      + "aussi une fiche et des cartes à relire la veille.",
  },
  {
    vue: 'dashboard', cible: '#paletteBtn',
    titre: "Tout est à portée de Ctrl+K",
    texte: "La palette ouvre une vue, retrouve une offre par son nom, lance une "
      + "collecte. Et « ? » affiche tous les raccourcis. L'onglet Chill, lui, ne sert "
      + "à rien d'utile — c'est fait exprès. Bonne recherche.",
  },
];

/** Vrai si l'utilisateur a déjà fait la visite. */
export function dejaVue() {
  try { return localStorage.getItem(CLE_VUE) === '1'; } catch { return false; }
}

/**
 * Lance la visite guidée.
 *
 * @param {object} o
 * @param {(vue: string) => void} o.allerA   change de vue
 * @param {boolean} [o.forcer]               rejoue même si déjà vue
 * @returns {Promise<void>} résolue à la fin ou à l'abandon
 */
export function lancerTutoriel({ allerA, forcer = false } = {}) {
  const racine = document.documentElement;
  const sobre = racine.dataset.anim === 'off'
    || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!forcer && (dejaVue() || sobre)) return Promise.resolve();

  try { localStorage.setItem(CLE_VUE, '1'); } catch { /* navigation privée */ }

  const voile = document.createElement('div');
  voile.className = 'tuto';
  voile.innerHTML = `
    <div class="tuto-trou" aria-hidden="true"></div>
    <div class="tuto-bulle" role="dialog" aria-modal="true" aria-labelledby="tutoTitre">
      <div class="tuto-etape" id="tutoEtape"></div>
      <h2 class="tuto-titre" id="tutoTitre"></h2>
      <p class="tuto-texte" id="tutoTexte"></p>
      <div class="tuto-pied">
        <button type="button" class="btn btn-discret" data-tuto="quitter">Passer</button>
        <span class="tuto-espace"></span>
        <button type="button" class="btn" data-tuto="precedent">Précédent</button>
        <button type="button" class="btn btn-primary" data-tuto="suivant">Suivant</button>
      </div>
    </div>`;
  document.body.appendChild(voile);

  const trou = voile.querySelector('.tuto-trou');
  const bulle = voile.querySelector('.tuto-bulle');
  let index = 0;

  return new Promise((resoudre) => {
    let fini = false;

    const terminer = () => {
      if (fini) return;
      fini = true;
      document.removeEventListener('keydown', auClavier, true);
      voile.remove();
      resoudre();
    };

    function auClavier(e) {
      if (e.key === 'Escape') { e.preventDefault(); terminer(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); aller(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); aller(-1); }
    }

    /** Avance ou recule, en sautant les étapes dont la cible n'existe pas. */
    function aller(pas) {
      let i = index + pas;
      while (i >= 0 && i < ETAPES.length) {
        if (ETAPES[i].vue) allerA?.(ETAPES[i].vue);
        if (document.querySelector(ETAPES[i].cible)) break;
        i += pas;
      }
      if (i < 0) return;
      if (i >= ETAPES.length) return terminer();
      index = i;
      afficher();
    }

    function afficher() {
      const etape = ETAPES[index];
      if (etape.vue) allerA?.(etape.vue);

      voile.querySelector('#tutoEtape').textContent = `${index + 1} / ${ETAPES.length}`;
      voile.querySelector('#tutoTitre').textContent = etape.titre;
      voile.querySelector('#tutoTexte').textContent = etape.texte;
      voile.querySelector('[data-tuto="precedent"]').disabled = index === 0;
      voile.querySelector('[data-tuto="suivant"]').textContent =
        index === ETAPES.length - 1 ? 'Terminer' : 'Suivant';

      // Le rendu de la vue peut être asynchrone : on mesure à l'image
      // suivante, sinon la cible est encore à sa position d'avant.
      requestAnimationFrame(() => placer(document.querySelector(etape.cible)));
    }

    /** Découpe le projecteur sur la cible et pose la bulle à côté. */
    function placer(cible) {
      if (!cible) return;
      cible.scrollIntoView({ block: 'center', behavior: 'auto' });

      const r = cible.getBoundingClientRect();
      const marge = 6;
      Object.assign(trou.style, {
        left: `${r.left - marge}px`, top: `${r.top - marge}px`,
        width: `${r.width + marge * 2}px`, height: `${r.height + marge * 2}px`,
      });

      // La bulle se met où il reste de la place : sous la cible si possible,
      // au-dessus sinon. Une bulle qui déborde de l'écran cache ce qu'elle
      // explique.
      const hauteurBulle = bulle.offsetHeight || 200;
      const dessous = r.bottom + 14;
      const dessus = r.top - hauteurBulle - 14;
      const y = (dessous + hauteurBulle < window.innerHeight) ? dessous
        : (dessus > 0 ? dessus : Math.max(14, (window.innerHeight - hauteurBulle) / 2));
      const x = Math.min(
        Math.max(14, r.left + r.width / 2 - bulle.offsetWidth / 2),
        window.innerWidth - bulle.offsetWidth - 14);
      Object.assign(bulle.style, { left: `${x}px`, top: `${y}px` });
    }

    voile.querySelector('[data-tuto="quitter"]').addEventListener('click', terminer);
    voile.querySelector('[data-tuto="suivant"]').addEventListener('click', () => aller(1));
    voile.querySelector('[data-tuto="precedent"]').addEventListener('click', () => aller(-1));
    // Un clic hors de la bulle quitte : c'est le geste réflexe de qui veut
    // reprendre la main.
    voile.addEventListener('click', (e) => { if (e.target === voile) terminer(); });
    document.addEventListener('keydown', auClavier, true);
    window.addEventListener('resize', () => placer(document.querySelector(ETAPES[index].cible)));

    // Première étape : on saute d'emblée celles dont la cible manque.
    index = -1;
    aller(1);
  });
}
