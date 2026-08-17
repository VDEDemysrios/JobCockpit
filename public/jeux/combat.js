// Le jeu de combat : sélection, boucle, commandes.
//
// Le moteur (`combat-moteur.js`) est pur et testé ; le rendu
// (`combat-rendu.js`) ne fait que peindre. Ce fichier-ci les relie et gère la
// seule chose qu'aucun des deux ne connaît : le joueur.
//
// LA BOUCLE EST À PAS FIXE
// ------------------------
// La simulation avance par images de 1/60 s, quoi qu'il arrive. Faire avancer
// le jeu proportionnellement au temps écoulé rendrait les portées et les
// images de départ dépendantes de la machine : un coup imparable ici
// deviendrait esquivable ailleurs. Dans un jeu de combat, le pas fixe n'est
// pas un détail d'implémentation, c'est la règle du jeu.
import { echapper } from '../format.js';
import { COMBATTANTS, ARENES, REGLES, IPS } from './combat-donnees.js';
import { nouvelleRencontre, avancer, intentionIA, ETATS } from './combat-moteur.js';
import { dessiner, dessinerCombattant, LARGEUR, HAUTEUR, SOL as SOL_RENDU } from './combat-rendu.js';

const TOUCHES = {
  ArrowLeft: 'gauche', ArrowRight: 'droite',
  q: 'gauche', d: 'droite', Q: 'gauche', D: 'droite',
  j: 'leger', k: 'lourd', l: 'special', ' ': 'esquive',
  J: 'leger', K: 'lourd', L: 'special',
};

let ecran = 'selection';     // selection | combat | fin
let choix = { joueur: null, adversaire: null };
let niveau = 2;
let rencontre = null;
let scores = [0, 0];
let round = 1;
let boucle = null;
let temps = 0;
const enfonces = new Set();

const zone = () => document.getElementById('combatZone');

// ─────────────────────────────── Écrans

function rendreSelection() {
  return `
    <div class="cb-select">
      <h4 class="cb-titre">Choisis ton combattant</h4>
      <div class="cb-grille">
        ${Object.entries(COMBATTANTS).map(([cle, c]) => `
          <button class="cb-carte${choix.joueur === cle ? ' choisi' : ''}" data-perso="${cle}">
            <canvas class="cb-vignette" data-apercu="${cle}" width="72" height="96"></canvas>
            <span class="cb-nom">${echapper(c.nom)}</span>
            <span class="cb-role">${echapper(c.titre)} · ${echapper(c.archetype)}</span>
            <span class="cb-arme">${echapper(c.arme)}</span>
          </button>`).join('')}
      </div>

      ${choix.joueur ? `
        <div class="cb-fiche">
          <p>${echapper(COMBATTANTS[choix.joueur].resume)}</p>
          <div class="cb-stats">
            ${barre('Vie', COMBATTANTS[choix.joueur].vie, 1200)}
            ${barre('Vitesse', COMBATTANTS[choix.joueur].vitesse, 3.4)}
            ${barre('Portée', COMBATTANTS[choix.joueur].coups.lourd.portee, 170)}
          </div>
          <div class="cb-lancer">
            <label>Adversaire
              <select id="cbNiveau">
                <option value="1" ${niveau === 1 ? 'selected' : ''}>Tranquille</option>
                <option value="2" ${niveau === 2 ? 'selected' : ''}>Correct</option>
                <option value="3" ${niveau === 3 ? 'selected' : ''}>Coriace</option>
              </select>
            </label>
            <button class="btn btn-primary" data-combat="lancer">Combattre</button>
          </div>
        </div>` : '<p class="cb-aide">Six armes, six façons de gagner.</p>'}
    </div>`;
}

const barre = (nom, valeur, max) => `
  <div class="cb-stat"><span>${nom}</span>
    <i><b style="width:${Math.round((valeur / max) * 100)}%"></b></i></div>`;

function rendreCombat() {
  const j = COMBATTANTS[choix.joueur];
  const o = COMBATTANTS[choix.adversaire];
  const arene = ARENES[j.origine];

  return `
    <div class="cb-jeu">
      <div class="cb-hud">
        <div class="cb-vie gauche">
          <span class="cb-qui">${echapper(j.nom)}</span>
          <i><b id="cbVieA"></b></i>
        </div>
        <div class="cb-centre">
          <div class="cb-chrono" id="cbChrono">60</div>
          <div class="cb-rounds" id="cbRounds"></div>
        </div>
        <div class="cb-vie droite">
          <span class="cb-qui">${echapper(o.nom)}</span>
          <i><b id="cbVieB"></b></i>
        </div>
      </div>

      <canvas id="cbCanevas" width="${LARGEUR}" height="${HAUTEUR}"></canvas>
      <div class="cb-annonce" id="cbAnnonce"></div>

      <div class="cb-pied">
        <span class="cb-lieu">${echapper(arene.nom)}</span>
        <span class="cb-touches">
          <b>Q</b>/<b>D</b> se déplacer · <b>Q</b> maintenu garde ·
          <b>J</b> léger · <b>K</b> lourd · <b>L</b> spécial · <b>Espace</b> esquive
        </span>
        <button class="btn" data-combat="quitter">Abandonner</button>
      </div>
    </div>`;
}

// ─────────────────────────────── La boucle

function intentionsJoueur() {
  const f = rencontre.a;
  const versLaDroite = f.sens > 0;
  // « Reculer » dépend du sens : c'est la touche opposée à l'adversaire qui
  // garde, comme dans tous les jeux du genre. Le figer sur une touche fixe
  // casserait le réflexe de tous ceux qui en ont déjà joué un.
  const avance = enfonces.has(versLaDroite ? 'droite' : 'gauche');
  const recule = enfonces.has(versLaDroite ? 'gauche' : 'droite');

  const i = { avance, recule };
  for (const c of ['leger', 'lourd', 'special', 'esquive']) {
    if (enfonces.has(c)) { i[c] = true; enfonces.delete(c); }   // un appui = un coup
  }
  return i;
}

function majHud() {
  const pc = (f) => `${Math.max(0, (f.vie / f.vieMax) * 100)}%`;
  const a = document.getElementById('cbVieA');
  const b = document.getElementById('cbVieB');
  if (a) a.style.width = pc(rencontre.a);
  if (b) b.style.width = pc(rencontre.b);

  const chrono = document.getElementById('cbChrono');
  if (chrono) chrono.textContent = Math.ceil(rencontre.temps / IPS);

  const r = document.getElementById('cbRounds');
  if (r) {
    const points = (n) => '●'.repeat(n) + '○'.repeat(Math.ceil(REGLES.rounds / 2) - n);
    r.innerHTML = `<span>${points(scores[0])}</span><span>${points(scores[1])}</span>`;
  }
}

function annoncer(texte, duree = 1600) {
  const el = document.getElementById('cbAnnonce');
  if (!el) return;
  el.textContent = texte;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), duree);
}

function terminerRound() {
  const v = rencontre.fin.vainqueur;
  if (v === 'a') scores[0]++;
  if (v === 'b') scores[1]++;
  majHud();

  const gagnants = Math.ceil(REGLES.rounds / 2);
  const fini = scores[0] >= gagnants || scores[1] >= gagnants;

  annoncer(v === null ? 'Égalité'
    : v === 'a' ? (rencontre.a.vie === rencontre.a.vieMax ? 'Parfait !' : 'Round gagné')
      : 'Round perdu', fini ? 2600 : 1800);

  setTimeout(() => {
    if (fini) {
      ecran = 'fin';
      arreter();
      rendreCombatVue();
      return;
    }
    round++;
    rencontre = nouvelleRencontre(choix.joueur, choix.adversaire, { round, scores });
    annoncer(`Round ${round}`);
  }, fini ? 2600 : 1800);
}

function image() {
  const ctx = document.getElementById('cbCanevas')?.getContext('2d');
  if (!ctx) { arreter(); return; }

  temps++;
  if (!rencontre.fin) {
    avancer(rencontre, {
      a: intentionsJoueur(),
      b: intentionIA(rencontre, 'b', niveau),
    });
    if (rencontre.fin) terminerRound();
  }
  if (rencontre.secousse > 0) rencontre.secousse -= 1;

  dessiner(ctx, rencontre, COMBATTANTS[choix.joueur].origine, temps);
  majHud();
}

function demarrer() {
  arreter();
  // `setInterval` et non `requestAnimationFrame` : le pas doit rester fixe
  // même sur un écran à 120 Hz, sinon le jeu tourne deux fois trop vite.
  boucle = setInterval(image, 1000 / IPS);
}
function arreter() { clearInterval(boucle); boucle = null; }

// ─────────────────────────────── Vue

/**
 * Les vignettes de la sélection.
 *
 * On RÉUTILISE le rendu du jeu plutôt que de redessiner à côté : deux façons
 * de peindre le même personnage finissent toujours par diverger, et c'est la
 * vignette qui aurait raison au moment de choisir — donc le mauvais dessin
 * qui décide.
 *
 * `dessinerCombattant` travaille dans le repère du terrain : le personnage
 * est posé sur la ligne de sol (y = 156) à `x * échelle`. On déplace donc le
 * repère pour amener ce point au bas de la vignette.
 */
function apercus() {
  for (const c of document.querySelectorAll('[data-apercu]')) {
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const cle = c.dataset.apercu;

    ctx.fillStyle = ARENES[COMBATTANTS[cle].origine].ciel[1];
    ctx.fillRect(0, 0, c.width, c.height);

    const zoom = 1.6;
    ctx.save();
    ctx.translate(c.width / 2, c.height - 6);
    ctx.scale(zoom, zoom);
    ctx.translate(0, -SOL_RENDU);
    dessinerCombattant(ctx, {
      cle, x: 0, sens: 1, etat: ETATS.REPOS, image: 0, coup: null,
      vie: 1, vieMax: 1, armure: 0,
    }, 0);
    ctx.restore();
  }
}

export function rendreCombatVue() {
  const z = zone();
  if (!z) return;

  if (ecran === 'selection') { z.innerHTML = rendreSelection(); apercus(); return; }

  if (ecran === 'fin') {
    const gagne = scores[0] > scores[1];
    z.innerHTML = `<div class="cb-fin ${gagne ? 'gagne' : 'perdu'}">
      <h4>${gagne ? 'Victoire' : 'Défaite'}</h4>
      <p>${scores[0]} — ${scores[1]} contre ${echapper(COMBATTANTS[choix.adversaire].nom)}</p>
      <div class="cb-lancer">
        <button class="btn btn-primary" data-combat="revanche">Revanche</button>
        <button class="btn" data-combat="retour">Changer de combattant</button>
      </div>
    </div>`;
    return;
  }

  z.innerHTML = rendreCombat();
  demarrer();
  annoncer(`Round ${round}`);
}

function nouvelAdversaire() {
  const autres = Object.keys(COMBATTANTS).filter(c => c !== choix.joueur);
  return autres[Math.floor(Math.random() * autres.length)];
}

export function installerCombat() {
  const z = zone();
  if (!z) return;

  z.addEventListener('click', (e) => {
    const p = e.target.closest('[data-perso]');
    if (p) { choix.joueur = p.dataset.perso; return rendreCombatVue(); }

    const b = e.target.closest('[data-combat]');
    if (!b) return;
    const quoi = b.dataset.combat;

    if (quoi === 'lancer' || quoi === 'revanche') {
      choix.adversaire = quoi === 'revanche' ? choix.adversaire : nouvelAdversaire();
      scores = [0, 0]; round = 1; temps = 0;
      rencontre = nouvelleRencontre(choix.joueur, choix.adversaire);
      ecran = 'combat';
      return rendreCombatVue();
    }
    if (quoi === 'quitter' || quoi === 'retour') {
      arreter(); ecran = 'selection';
      return rendreCombatVue();
    }
  });

  z.addEventListener('change', (e) => {
    if (e.target.id === 'cbNiveau') niveau = Number(e.target.value);
  });
}

/** Les touches sont écoutées sur le DOCUMENT : le canevas n'a pas le focus. */
export function brancherClavier() {
  window.addEventListener('keydown', (e) => {
    if (ecran !== 'combat') return;
    const t = TOUCHES[e.key];
    if (!t) return;
    e.preventDefault();
    enfonces.add(t);
  });
  window.addEventListener('keyup', (e) => {
    const t = TOUCHES[e.key];
    if (t === 'gauche' || t === 'droite') enfonces.delete(t);
  });
}

/** Quitter la vue coupe la boucle : un jeu qui tourne en fond mange la batterie. */
export function quitterCombat() {
  arreter();
  ecran = 'selection';
}
