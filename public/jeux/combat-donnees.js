// Les six combattants, leurs armes, et les six arènes.
//
// POURQUOI DES DONNÉES SÉPARÉES DU MOTEUR
// ---------------------------------------
// L'équilibrage d'un jeu de combat, c'est des nombres : portée, dégâts, image
// de départ, image de récupération. Les enfouir dans le code rend chaque
// réglage risqué et chaque comparaison impossible. Ici, tout est dans une
// table qu'on lit d'un coup d'œil — et qu'un test peut vérifier.
//
// LE VOCABULAIRE, PARCE QU'IL COMMANDE TOUT
// -----------------------------------------
//   depart    images avant que le coup devienne dangereux ;
//   actif     images pendant lesquelles il touche ;
//   recup     images pendant lesquelles on ne peut rien faire ;
//   avantage  images d'écart après un coup BLOQUÉ. Positif = on rejoue en
//             premier, négatif = c'est l'adversaire qui reprend la main.
//
// Un coup lent doit frapper fort ou porter loin. Un coup rapide doit être
// court ou faible. Toute la tension d'un jeu de combat tient dans cet
// arbitrage, et un test vérifie plus bas qu'aucun personnage n'échappe à la
// règle.

/** Une image = 1/60 s. Tous les temps du jeu sont comptés en images. */
export const IPS = 60;

/** Largeur du terrain, en unités de jeu. Le sol est à y = 0. */
export const ARENE = { largeur: 900, mur: 40 };

/**
 * Les palettes, en pixel art : quatre à six teintes par personnage.
 *
 * Peu de couleurs, franchement séparées : c'est ce qui fait lire une
 * silhouette à trente pixels de haut. Une palette de vingt nuances donne une
 * bouillie grise dès qu'on réduit.
 */
export const COMBATTANTS = {
  chevalier: {
    nom: 'Roland',
    titre: 'Chevalier',
    arme: 'Épée longue et bouclier',
    archetype: 'Lourd',
    origine: 'chateau',
    resume: 'Lent, encaisse, et punit très fort. Il gagne les échanges qu\'il '
      + 'accepte, jamais ceux qu\'il subit.',
    // Un lourd a plus de vie et moins de vitesse. Sans ces deux écarts, ce
    // n'est pas un archétype, c'est un costume.
    vie: 1150,
    vitesse: 1.95,
    poids: 1.35,
    palette: ['#e8e4dc', '#9aa3b0', '#5a6472', '#2e3440', '#b8860b', '#8c2f2f'],
    coups: {
      leger: { nom: 'Taille', degats: 62, portee: 74, hauteur: 46, depart: 8, actif: 4, recup: 12, avantage: -2, poussee: 7 },
      lourd: { nom: 'Estoc lourd', degats: 128, portee: 96, hauteur: 40, depart: 18, actif: 5, recup: 24, avantage: -8, poussee: 20 },
      special: {
        nom: 'Charge à l\'écu', degats: 105, portee: 62, hauteur: 52,
        depart: 14, actif: 8, recup: 22, avantage: -4, poussee: 26,
        // L'armure absorbe UN coup pendant l'élan : c'est ce qui permet au
        // lourd d'entrer face à un zoneur, sinon il ne rentre jamais.
        armure: 1, avance: 120,
      },
    },
  },

  samourai: {
    nom: 'Kenzō',
    titre: 'Samouraï',
    arme: 'Katana',
    archetype: 'Équilibré',
    origine: 'donjon',
    resume: 'Aucune faiblesse, aucun excès. Le personnage qui punit les '
      + 'erreurs des autres.',
    vie: 1000,
    vitesse: 2.3,
    poids: 1,
    palette: ['#f2e8d5', '#c94f4f', '#7d2c2c', '#2b2b33', '#d9d9e0', '#1a1a20'],
    coups: {
      leger: { nom: 'Coupe', degats: 55, portee: 68, hauteur: 44, depart: 6, actif: 3, recup: 10, avantage: 0, poussee: 6 },
      lourd: { nom: 'Iaï', degats: 112, portee: 104, hauteur: 38, depart: 15, actif: 4, recup: 20, avantage: -6, poussee: 16 },
      special: {
        nom: 'Vent tranchant', degats: 42, portee: 210, hauteur: 34,
        depart: 18, actif: 6, recup: 38, avantage: -14, poussee: 12,
        // Un projectile lent : il n'est pas là pour toucher, il est là pour
        // forcer l'adversaire à bouger.
        projectile: { vitesse: 7.5, portee: 420 },
      },
    },
  },

  ninja: {
    nom: 'Sayo',
    titre: 'Ninja',
    arme: 'Kusarigama',
    archetype: 'Pression',
    origine: 'village',
    resume: 'Rapide, insaisissable, fragile. Elle ne gagne pas un échange : '
      + 'elle en gagne six d\'affilée.',
    vie: 880,
    vitesse: 3.2,
    poids: 0.8,
    palette: ['#e6e6ef', '#4a5568', '#2d3142', '#161821', '#7fd1c1', '#c0392b'],
    coups: {
      leger: { nom: 'Faucille', degats: 42, portee: 58, hauteur: 42, depart: 4, actif: 3, recup: 8, avantage: 2, poussee: 4 },
      lourd: { nom: 'Chaîne', degats: 92, portee: 132, hauteur: 36, depart: 13, actif: 5, recup: 22, avantage: -7, poussee: 14 },
      special: {
        nom: 'Fuite d\'ombre', degats: 74, portee: 66, hauteur: 48,
        depart: 9, actif: 4, recup: 16, avantage: -1, poussee: 10,
        // Elle traverse : le coup sort DERRIÈRE l'adversaire. C'est la
        // signature du personnage, et ce qui rend le blocage difficile.
        traverse: true, avance: 150,
      },
    },
  },

  lancier: {
    nom: 'Alaric',
    titre: 'Lancier',
    arme: 'Hallebarde',
    archetype: 'Zoneur',
    origine: 'rempart',
    resume: 'La plus longue portée du jeu. Tant qu\'il garde sa distance, '
      + 'on ne le touche pas — mais collé, il n\'a plus rien.',
    vie: 940,
    vitesse: 1.95,
    poids: 1.1,
    palette: ['#efe7d2', '#4f7942', '#2f4a2a', '#242018', '#b0a58c', '#8a7a4e'],
    coups: {
      leger: { nom: 'Piqûre', degats: 48, portee: 118, hauteur: 34, depart: 9, actif: 3, recup: 13, avantage: -3, poussee: 8 },
      lourd: { nom: 'Balayage', degats: 104, portee: 156, hauteur: 44, depart: 20, actif: 6, recup: 34, avantage: -9, poussee: 22 },
      special: {
        nom: 'Muraille', degats: 96, portee: 176, hauteur: 50,
        depart: 20, actif: 7, recup: 30, avantage: -12, poussee: 18,
        // Aucune avance : son special le PLANTE sur place. Un zoneur qui
        // avance en frappant n'aurait plus de faiblesse.
        avance: 0,
      },
    },
  },

  lutteur: {
    nom: 'Brann',
    titre: 'Lutteur',
    arme: 'Gantelets cloutés',
    archetype: 'Empoigneur',
    origine: 'arene',
    resume: 'Rien à distance, tout au corps à corps. Sa prise passe à travers '
      + 'la garde : bloquer ne sauve personne.',
    vie: 1120,
    vitesse: 2.35,
    poids: 1.4,
    palette: ['#e8d5b7', '#a0522d', '#6b3410', '#2a1d14', '#c9a227', '#7a1f1f'],
    coups: {
      leger: { nom: 'Crochet', degats: 58, portee: 52, hauteur: 46, depart: 6, actif: 3, recup: 11, avantage: -1, poussee: 5 },
      lourd: { nom: 'Marteau', degats: 122, portee: 66, hauteur: 42, depart: 16, actif: 4, recup: 22, avantage: -7, poussee: 18 },
      special: {
        nom: 'Étreinte', degats: 165, portee: 48, hauteur: 54,
        depart: 11, actif: 3, recup: 30, avantage: -14, poussee: 30,
        // IMPARABLE. C'est l'outil de l'archétype : sans lui, l'empoigneur
        // reste dehors pendant que l'adversaire garde. Le prix est une portée
        // dérisoire et une récupération punitive s'il rate.
        imparable: true, avance: 96, armure: 1,
      },
    },
  },

  duelliste: {
    nom: 'Ysoré',
    titre: 'Duelliste',
    arme: 'Rapière',
    archetype: 'Technique',
    origine: 'jardin',
    resume: 'Frappe vite, frappe peu. Elle gagne à l\'usure et au placement, '
      + 'jamais à la force.',
    vie: 860,
    vitesse: 2.9,
    poids: 0.85,
    palette: ['#f5efe0', '#5b6ec4', '#33407e', '#1c1f2e', '#d4af37', '#9b2d3a'],
    coups: {
      leger: { nom: 'Botte', degats: 38, portee: 86, hauteur: 32, depart: 4, actif: 2, recup: 8, avantage: 3, poussee: 3 },
      lourd: { nom: 'Fente', degats: 86, portee: 104, hauteur: 30, depart: 12, actif: 3, recup: 18, avantage: -5, poussee: 12 },
      special: {
        nom: 'Reprise', degats: 92, portee: 110, hauteur: 40,
        depart: 10, actif: 4, recup: 20, avantage: -3, poussee: 14,
        avance: 90,
      },
    },
  },
};

/**
 * Les arènes. Une par origine — le décor dit d'où vient le personnage avant
 * qu'on ait lu son nom.
 *
 * Les couleurs sont ordonnées du CIEL vers le SOL : c'est dans cet ordre que
 * le rendu les empile, et s'en écarter donne un dégradé qui part à l'envers.
 */
export const ARENES = {
  chateau: {
    nom: 'Cour du donjon',
    ciel: ['#2b3a5c', '#54688f', '#8a9ab5'],
    brume: '#9fb0c9',
    sol: ['#6b6357', '#4e483f', '#332f29'],
    silhouettes: 'creneaux',
    accent: '#b8860b',
  },
  donjon: {
    nom: 'Château de l\'Est',
    ciel: ['#3d2233', '#8c4a52', '#e0846a'],
    brume: '#f0b49a',
    sol: ['#5c4a3a', '#3f332a', '#28211c'],
    silhouettes: 'pagode',
    accent: '#c94f4f',
  },
  village: {
    nom: 'Village sous la lune',
    ciel: ['#0d1326', '#1c2b4a', '#37507a'],
    brume: '#4a6591',
    sol: ['#2a3142', '#1e232f', '#141821'],
    silhouettes: 'toits',
    accent: '#7fd1c1',
  },
  rempart: {
    nom: 'Chemin de ronde',
    ciel: ['#43526b', '#6f8296', '#a9b8c2'],
    brume: '#b9c6cf',
    sol: ['#5a5f52', '#43473d', '#2c2f29'],
    silhouettes: 'tours',
    accent: '#4f7942',
  },
  arene: {
    nom: 'Arène de sable',
    ciel: ['#7a4a1f', '#c08040', '#e8b878'],
    brume: '#e3c39a',
    sol: ['#c2a06a', '#9c7d4e', '#6f5836'],
    silhouettes: 'gradins',
    accent: '#c9a227',
  },
  jardin: {
    nom: 'Jardin du palais',
    ciel: ['#1f3a4d', '#3d6b7a', '#7fa8a0'],
    brume: '#9dc0b3',
    sol: ['#4a5a3c', '#37452d', '#232c1d'],
    silhouettes: 'arcades',
    accent: '#5b6ec4',
  },
};

/** Les règles communes. Un seul endroit pour les régler. */
export const REGLES = {
  rounds: 3,           // au meilleur des trois
  duree: 60 * IPS,     // 60 secondes par round
  distanceDepart: 220,
  // Le blocage laisse passer une fraction des dégâts. Sans cela, garder est
  // gratuit et la partie s'enlise ; trop, et garder ne sert plus à rien.
  chip: 0.14,
  // Après un coup encaissé, on ne peut plus rien faire pendant `hitstun`
  // images. C'est ce qui rend les enchaînements possibles.
  hitstunBase: 14,
  blockstunBase: 9,
  // Un round gagné avec la vie pleine se voit : c'est la petite récompense
  // qui pousse à mieux jouer plutôt qu'à survivre.
  perfectSeuil: 1,
  dashImages: 12,
  dashVitesse: 6.2,
};
