// Animations de chiffres — le « roulement machine à sous ».
//
// POURQUOI UN ROULEAU PLUTÔT QU'UN COMPTEUR
// -----------------------------------------
// Un compteur qui défile de 0 à 42 fait défiler des nombres intermédiaires
// qui n'ont jamais existé (7, 19, 31…). Un rouleau, lui, fait défiler des
// CHIFFRES : chaque colonne tourne indépendamment et s'arrête sur le sien,
// de gauche à droite. On lit le nombre final, pas une suite de valeurs
// fausses, et l'arrêt décalé donne le petit claquement d'une machine à sous.
//
// RÈGLE ABSOLUE DE CE FICHIER
// ---------------------------
// La valeur finale est écrite AVANT toute animation, et l'état d'arrivée est
// posé sur l'élément lui-même — jamais laissé à la charge d'une image-clé.
// Une transition CSS ne démarre pas dans un onglet qui ne compose pas de
// frames : si on comptait dessus pour afficher le bon chiffre, la tuile
// resterait bloquée sur un « 0 ». L'animation embellit, elle n'informe pas.

const CHIFFRES = '0123456789';

/** L'utilisateur a demandé moins de mouvement, ou les a coupées dans Options. */
function mouvementCoupe() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.dataset.anim === 'off';
}

/**
 * Fait rouler un nombre dans `el`.
 *
 * @param {HTMLElement} el
 * @param {string|number} valeur   ce qui doit s'afficher à l'arrivée
 * @param {object} [options]
 * @param {string} [options.suffixe]  « % », « j »… posé après le nombre
 * @param {number} [options.duree]    durée de la première colonne, en ms
 * @param {number} [options.tours]    tours complets avant l'arrêt
 */
export function roulement(el, valeur, options = {}) {
  const { suffixe = '', duree = 980, tours = 3 } = options;
  const texte = String(valeur ?? '');

  // 1. La valeur juste, tout de suite. Tout le reste est décoration.
  el.textContent = texte;
  if (suffixe) el.appendChild(baliseSuffixe(suffixe));
  if (mouvementCoupe() || !/\d/.test(texte)) return;

  // 2. Découpage en colonnes : les chiffres roulent, le reste est fixe.
  const fragment = document.createDocumentFragment();
  const colonnes = [];

  for (const caractere of texte) {
    if (CHIFFRES.includes(caractere)) {
      const colonne = construireColonne(Number(caractere), tours);
      colonnes.push(colonne);
      fragment.appendChild(colonne.enveloppe);
    } else {
      const fixe = document.createElement('span');
      fixe.className = 'roul-fixe';
      fixe.textContent = caractere;
      fragment.appendChild(fixe);
    }
  }

  el.textContent = '';
  el.appendChild(fragment);
  if (suffixe) el.appendChild(baliseSuffixe(suffixe));

  // 3. Départ en haut du rouleau, puis lecture forcée de la géométrie.
  //    Sans cette lecture, le navigateur regrouperait les deux écritures de
  //    `transform` et la transition n'aurait aucun trajet à parcourir.
  for (const c of colonnes) c.piste.style.transform = 'translateY(0)';
  void el.getBoundingClientRect();

  // 4. Arrivée. Les colonnes s'arrêtent de gauche à droite, avec un léger
  //    dépassement : le chiffre glisse d'un cheveu trop loin puis revient se
  //    caler. C'est ce micro-rebond qui fait « machine à sous » plutôt que
  //    « compteur qui s'arrête ».
  let fin = 0;
  colonnes.forEach((c, i) => {
    const d = duree + i * 150;
    const retard = i * 90;
    fin = Math.max(fin, d + retard);
    c.piste.style.transition = `transform ${d}ms cubic-bezier(.17,1.14,.33,1) ${retard}ms`;
    c.piste.style.transform = `translateY(-${c.arrivee}em)`;
  });

  // Flou de mouvement pendant la rotation : les chiffres qui défilent vite
  // ne sont pas nets dans la réalité non plus. Il se lève à l'arrêt.
  el.classList.add('roul-tourne');
  clearTimeout(el._finRoulement);
  el._finRoulement = setTimeout(() => el.classList.remove('roul-tourne'), fin);
}

function baliseSuffixe(suffixe) {
  const el = document.createElement('span');
  el.className = 'u';
  el.textContent = suffixe;
  return el;
}

/** Une colonne : un ruban de chiffres qui s'arrête sur le bon. */
function construireColonne(chiffre, tours) {
  const enveloppe = document.createElement('span');
  enveloppe.className = 'roul';

  const piste = document.createElement('span');
  piste.className = 'roul-col';

  // Le ruban porte `tours` cycles complets, puis le cycle d'arrivée.
  for (let cycle = 0; cycle <= tours; cycle++) {
    for (const c of CHIFFRES) {
      const cellule = document.createElement('i');
      cellule.textContent = c;
      piste.appendChild(cellule);
    }
  }

  const arrivee = tours * 10 + chiffre;
  // L'arrivée est posée d'emblée : si la transition ne démarre jamais, la
  // colonne affiche quand même le bon chiffre.
  piste.style.transform = `translateY(-${arrivee}em)`;

  enveloppe.appendChild(piste);
  return { enveloppe, piste, arrivee };
}

/**
 * Anime tous les nombres marqués `data-roule` sous `racine`.
 *
 * L'attribut est retiré au passage : un même rendu ne rejoue pas l'animation
 * en boucle si la fonction est appelée deux fois.
 */
export function animerCompteurs(racine = document) {
  racine.querySelectorAll('[data-roule]').forEach((el, i) => {
    const valeur = el.dataset.roule;
    const suffixe = el.dataset.suffixe ?? '';
    delete el.dataset.roule;
    delete el.dataset.suffixe;
    // Léger décalage entre tuiles : elles ne démarrent pas toutes ensemble.
    roulement(el, valeur, { suffixe, duree: 720 + Math.min(i, 8) * 40 });
  });
}
