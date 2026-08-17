// La vue « Jeux » : deux jeux complets, jouables, sans rien installer.
//
// POURQUOI CES DEUX-LÀ
// --------------------
// Une pause de dix minutes entre deux candidatures n'a pas besoin d'un
// blockbuster : elle a besoin de quelque chose qui démarre en un clic, se
// quitte sans sauvegarder, et qui soit VRAIMENT bon dans son genre. Les
// échecs et le démineur ont cent ans de recul là-dessus.
//
// Le moteur d'échecs (`jeux/echecs-moteur.js`) est un vrai moteur : règles
// complètes vérifiées par perft, et une recherche alpha-bêta avec tables de
// position. Un adversaire qui joue au hasard se démasque au troisième coup —
// autant ne rien proposer.
import { echapper } from './format.js';
import {
  nouvellePartie, coupsLegaux, jouer, enEchec, issue, meilleurCoup, notation,
  BLANC, NOIR,
} from './jeux/echecs-moteur.js';

/** Les pièces en Unicode : nettes à toute taille, sans un octet d'image. */
const GLYPHES = {
  bR: '♔', bD: '♕', bT: '♖', bF: '♗', bC: '♘', bP: '♙',
  nR: '♚', nD: '♛', nT: '♜', nF: '♝', nC: '♞', nP: '♟',
};

const NIVEAUX = {
  1: { nom: 'Tranquille', profondeur: 2 },
  2: { nom: 'Correct', profondeur: 3 },
  3: { nom: 'Coriace', profondeur: 4 },
};

let jeu = null;          // 'echecs' | 'demineur' | null
let echecs = null;       // état de la partie en cours
let selection = null;    // case cliquée en attente de destination
let niveau = 2;
let reflechit = false;

const zone = () => document.getElementById('jeuxZone');

// ═══════════════════════════════ ÉCHECS

function rendreEchiquier() {
  const legaux = coupsLegaux(echecs);
  const permises = selection === null
    ? []
    : legaux.filter(c => c.depart === selection).map(c => c.arrivee);

  const dernier = echecs.coups.at(-1);
  const echec = enEchec(echecs);
  const roiEnEchec = echec ? echecs.cases.indexOf(`${echecs.trait}R`) : -1;

  const cases = echecs.cases.map((p, i) => {
    const sombre = (Math.floor(i / 8) + (i % 8)) % 2 === 1;
    const classes = ['ec-case', sombre ? 'sombre' : 'claire'];
    if (i === selection) classes.push('choisie');
    if (permises.includes(i)) classes.push(p ? 'prise' : 'permise');
    if (dernier && (i === dernier.depart || i === dernier.arrivee)) classes.push('dernier');
    if (i === roiEnEchec) classes.push('echec');

    return `<button class="${classes.join(' ')}" data-case="${i}"
      aria-label="${'abcdefgh'[i % 8]}${8 - Math.floor(i / 8)}">
      ${p ? `<span class="ec-piece ${p[0] === 'b' ? 'blanc' : 'noir'}">${GLYPHES[p]}</span>` : ''}
    </button>`;
  }).join('');

  const fin = issue(echecs);
  const message = fin
    ? (fin.fin === 'mat'
      ? `Échec et mat — ${fin.gagnant === BLANC ? 'les blancs gagnent' : 'les noirs gagnent'}.`
      : fin.fin === 'pat' ? 'Pat : partie nulle.' : `Nulle — ${fin.raison}.`)
    : reflechit ? 'Il réfléchit…'
      : echec ? 'Échec !'
        : echecs.trait === BLANC ? 'À toi de jouer.' : '';

  // Les coups par PAIRES, comme sur une feuille de partie : « 1. e2-e4 e7-e5 ».
  const paires = [];
  for (let i = 0; i < echecs.coups.length; i += 2) {
    paires.push(`<li><span>${notation(echecs.coups[i])}</span>`
      + `<span>${echecs.coups[i + 1] ? notation(echecs.coups[i + 1]) : ''}</span></li>`);
  }

  return `
    <div class="ec-plateau-zone">
      <div class="ec-plateau${fin ? ' finie' : ''}" id="ecPlateau">${cases}</div>
      <div class="ec-rangs">${[8, 7, 6, 5, 4, 3, 2, 1].map(n => `<span>${n}</span>`).join('')}</div>
      <div class="ec-colonnes">${[...'abcdefgh'].map(c => `<span>${c}</span>`).join('')}</div>
    </div>

    <aside class="ec-cote">
      <div class="ec-etat${fin ? ' fin' : ''}${echec && !fin ? ' echec' : ''}">${echapper(message)}</div>

      <label class="ec-niveau">Adversaire
        <select id="ecNiveau">
          ${Object.entries(NIVEAUX).map(([v, n]) =>
            `<option value="${v}" ${Number(v) === niveau ? 'selected' : ''}>${n.nom}</option>`).join('')}
        </select>
      </label>

      <ol class="ec-coups">${paires.join('') || '<li class="ec-rien">La partie commence.</li>'}</ol>

      <div class="ec-actions">
        <button class="btn" data-jeu="annuler" ${echecs.coups.length < 2 ? 'disabled' : ''}>Annuler</button>
        <button class="btn" data-jeu="rejouer">Nouvelle partie</button>
      </div>
    </aside>`;
}

function rendreEchecs() {
  zone().innerHTML = `<div class="panel-box jeu-boite">
    <h3><span data-ic="colonnes" data-ic-taille="14"></span> Échecs
      <button class="chill-vider" data-jeu="quitter">Quitter</button></h3>
    <div class="ec-grille">${rendreEchiquier()}</div>
  </div>`;
}

/**
 * Le tour de l'IA.
 *
 * `setTimeout` avant de calculer : la recherche bloque le fil d'exécution, et
 * sans ce répit le navigateur n'a jamais l'occasion de peindre le coup qu'on
 * vient de jouer. On verrait sa propre pièce arriver EN MÊME TEMPS que la
 * réponse — c'est-à-dire jamais.
 */
function tourIA() {
  if (issue(echecs) || echecs.trait !== NOIR) return;
  reflechit = true;
  rendreEchecs();

  setTimeout(() => {
    const coup = meilleurCoup(echecs, NIVEAUX[niveau].profondeur);
    if (coup) echecs = jouer(echecs, coup);
    reflechit = false;
    rendreEchecs();
  }, 220);
}

function cliquerCase(i) {
  if (reflechit || issue(echecs) || echecs.trait !== BLANC) return;

  const legaux = coupsLegaux(echecs);
  if (selection !== null) {
    // La promotion est forcée en dame : proposer un choix à chaque poussée
    // alourdit un jeu de détente pour un cas qui n'arrive presque jamais
    // autrement qu'en dame.
    const coup = legaux.find(c => c.depart === selection && c.arrivee === i
      && (!c.promotion || c.promotion === 'D'));
    if (coup) {
      echecs = jouer(echecs, coup);
      selection = null;
      rendreEchecs();
      tourIA();
      return;
    }
  }
  selection = legaux.some(c => c.depart === i) ? i : null;
  rendreEchecs();
}

// ═══════════════════════════════ DÉMINEUR

const NIVEAUX_MINES = {
  facile: { l: 9, c: 9, mines: 10, nom: 'Facile' },
  moyen: { l: 16, c: 16, mines: 40, nom: 'Moyen' },
  expert: { l: 16, c: 30, mines: 99, nom: 'Expert' },
};

let mines = null;

function nouveauDemineur(cle = 'facile') {
  const { l, c, mines: n } = NIVEAUX_MINES[cle];
  mines = {
    cle, l, c, n,
    grille: Array.from({ length: l * c }, () => ({ mine: false, ouvert: false, drapeau: false, voisins: 0 })),
    // Les mines ne sont posées qu'au PREMIER clic, autour de lui : sinon on
    // peut perdre au premier coup, ce qui n'est pas un jeu mais un tirage.
    posee: false,
    fini: null,
    debut: null,
  };
}

function poserMines(depart) {
  const { l, c, n, grille } = mines;
  const interdit = new Set([depart, ...voisinsDe(depart)]);
  const libres = [];
  for (let i = 0; i < l * c; i++) if (!interdit.has(i)) libres.push(i);

  for (let k = 0; k < n && libres.length; k++) {
    const j = Math.floor(Math.random() * libres.length);
    grille[libres[j]].mine = true;
    libres.splice(j, 1);
  }
  for (let i = 0; i < l * c; i++) {
    grille[i].voisins = voisinsDe(i).filter(v => grille[v].mine).length;
  }
  mines.posee = true;
  mines.debut = Date.now();
}

function voisinsDe(i) {
  const { l, c } = mines;
  const li = Math.floor(i / c);
  const co = i % c;
  const out = [];
  for (let dl = -1; dl <= 1; dl++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dl && !dc) continue;
      const nl = li + dl;
      const nc = co + dc;
      if (nl >= 0 && nl < l && nc >= 0 && nc < c) out.push(nl * c + nc);
    }
  }
  return out;
}

/** Ouverture en cascade des zones vides. Itérative : une récursion sur une
 *  grille experte peut dépasser la pile. */
function ouvrir(i) {
  const pile = [i];
  while (pile.length) {
    const j = pile.pop();
    const k = mines.grille[j];
    if (k.ouvert || k.drapeau) continue;
    k.ouvert = true;
    if (k.mine) { mines.fini = 'perdu'; return; }
    if (k.voisins === 0) pile.push(...voisinsDe(j));
  }
}

function verifierVictoire() {
  const reste = mines.grille.filter(k => !k.mine && !k.ouvert).length;
  if (reste === 0) mines.fini = 'gagne';
}

function rendreDemineur() {
  const { grille, c, n, fini } = mines;
  const drapeaux = grille.filter(k => k.drapeau).length;
  const secondes = mines.debut ? Math.floor((Date.now() - mines.debut) / 1000) : 0;

  const cases = grille.map((k, i) => {
    if (fini === 'perdu' && k.mine && !k.drapeau) {
      return '<button class="dm-case mine">✷</button>';
    }
    if (k.drapeau) return `<button class="dm-case drapeau" data-mine="${i}">⚑</button>`;
    if (!k.ouvert) return `<button class="dm-case" data-mine="${i}"></button>`;
    return `<button class="dm-case ouvert v${k.voisins}" data-mine="${i}">${k.voisins || ''}</button>`;
  }).join('');

  const message = fini === 'perdu' ? 'Raté. Encore une ?'
    : fini === 'gagne' ? `Gagné en ${secondes} s.`
      : `${n - drapeaux} mine${n - drapeaux > 1 ? 's' : ''} restante${n - drapeaux > 1 ? 's' : ''}`;

  return `<div class="panel-box jeu-boite">
    <h3><span data-ic="cible" data-ic-taille="14"></span> Démineur
      <button class="chill-vider" data-jeu="quitter">Quitter</button></h3>

    <div class="dm-barre">
      <span class="dm-etat${fini ? ' fin' : ''}">${echapper(message)}</span>
      <span class="dm-niveaux">
        ${Object.entries(NIVEAUX_MINES).map(([k, v]) =>
          `<button class="dm-niv${k === mines.cle ? ' actif' : ''}" data-mines="${k}">${v.nom}</button>`).join('')}
      </span>
    </div>

    <p class="dm-aide">Clic pour ouvrir · clic droit pour poser un drapeau.
      La première case est toujours sûre.</p>

    <div class="dm-grille" style="grid-template-columns:repeat(${c},1fr)">${cases}</div>
  </div>`;
}

// ═══════════════════════════════ La vue

function rendreChoix() {
  zone().innerHTML = `<div class="jeux-choix">
    <button class="jeu-carte" data-lancer="echecs">
      <span class="jeu-icone">♞</span>
      <span class="jeu-nom">Échecs</span>
      <span class="jeu-desc">Contre une vraie IA — recherche alpha-bêta,
        trois niveaux. Elle prend ce qui traîne et voit les mats courts.</span>
    </button>
    <button class="jeu-carte" data-lancer="demineur">
      <span class="jeu-icone">✷</span>
      <span class="jeu-nom">Démineur</span>
      <span class="jeu-desc">Trois grilles, du 9×9 à l'expert. La première
        case est toujours sûre : on perd par erreur, jamais par malchance.</span>
    </button>
  </div>`;
}

export function rendreJeux() {
  if (!zone()) return;
  if (jeu === 'echecs') return rendreEchecs();
  if (jeu === 'demineur') { zone().innerHTML = rendreDemineur(); return; }
  rendreChoix();
}

export function installerJeux() {
  const z = zone();
  if (!z) return;

  z.addEventListener('contextmenu', (e) => {
    const b = e.target.closest('[data-mine]');
    if (!b || jeu !== 'demineur' || mines.fini) return;
    e.preventDefault();
    const k = mines.grille[Number(b.dataset.mine)];
    if (!k.ouvert) { k.drapeau = !k.drapeau; rendreJeux(); }
  });

  z.addEventListener('click', (e) => {
    const lancer = e.target.closest('[data-lancer]');
    if (lancer) {
      jeu = lancer.dataset.lancer;
      if (jeu === 'echecs') { echecs = nouvellePartie(); selection = null; }
      else nouveauDemineur();
      return rendreJeux();
    }

    const action = e.target.closest('[data-jeu]');
    if (action) {
      const quoi = action.dataset.jeu;
      if (quoi === 'quitter') { jeu = null; return rendreJeux(); }
      if (quoi === 'rejouer') { echecs = nouvellePartie(); selection = null; return rendreJeux(); }
      if (quoi === 'annuler') {
        // On remonte de DEUX coups : annuler seulement le sien rendrait la
        // main à l'IA, qui rejouerait aussitôt. On veut revenir à sa position.
        let e2 = nouvellePartie();
        for (const c of echecs.coups.slice(0, -2)) e2 = jouer(e2, c);
        echecs = e2; selection = null;
        return rendreJeux();
      }
      return;
    }

    const niv = e.target.closest('[data-mines]');
    if (niv) { nouveauDemineur(niv.dataset.mines); return rendreJeux(); }

    const caseEchecs = e.target.closest('[data-case]');
    if (caseEchecs && jeu === 'echecs') return cliquerCase(Number(caseEchecs.dataset.case));

    const caseMine = e.target.closest('[data-mine]');
    if (caseMine && jeu === 'demineur' && !mines.fini) {
      const i = Number(caseMine.dataset.mine);
      if (mines.grille[i].drapeau) return;
      if (!mines.posee) poserMines(i);
      ouvrir(i);
      if (!mines.fini) verifierVictoire();
      return rendreJeux();
    }
  });

  z.addEventListener('change', (e) => {
    if (e.target.id !== 'ecNiveau') return;
    niveau = Number(e.target.value);
  });
}
