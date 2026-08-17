// Le rendu du jeu de combat, en pixel art.
//
// COMMENT ON OBTIENT DE VRAIS PIXELS
// ----------------------------------
// On dessine dans un canevas INTERNE de 320×180, puis on l'agrandit sans
// lissage. Chaque pixel dessiné devient un carré net à l'écran. Dessiner
// directement en grande taille donnerait des bords flous et des diagonales
// baveuses : ce serait du dessin vectoriel déguisé, pas du pixel art.
//
// POURQUOI LES PERSONNAGES SONT PEINTS PAR LE CODE
// ------------------------------------------------
// Six combattants avec leurs animations font des centaines d'images. Plutôt
// que de les dessiner une par une, on décrit un CORPS — tête, buste, bras,
// jambes, arme — et on le pose différemment selon l'état. Le résultat est
// cohérent d'un personnage à l'autre, animable, et tient dans un fichier.
//
// La palette fait le reste : quatre à six teintes franches suffisent à rendre
// une silhouette lisible à trente pixels de haut. C'est le nombre de couleurs
// qui trahit le faux pixel art, jamais la taille.
import { COMBATTANTS, ARENES, ARENE } from './combat-donnees.js';
import { ETATS, boite } from './combat-moteur.js';

export const LARGEUR = 320;
export const HAUTEUR = 180;
export const SOL = 156;       // ligne de sol dans le repère interne

/** Le monde fait 900 unités de large ; l'écran en montre 320. */
const echelle = LARGEUR / ARENE.largeur;

/** Un rectangle en pixels entiers : la moindre décimale floute tout. */
function px(ctx, x, y, l, h, couleur) {
  ctx.fillStyle = couleur;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(l)), Math.max(1, Math.round(h)));
}

// ─────────────────────────────── Les décors

function silhouettes(ctx, forme, couleur, base) {
  ctx.fillStyle = couleur;
  if (forme === 'creneaux') {
    for (let x = -10; x < LARGEUR + 10; x += 34) {
      px(ctx, x, base - 46, 26, 46, couleur);
      for (let c = 0; c < 3; c++) px(ctx, x + c * 9, base - 54, 6, 9, couleur);
    }
  } else if (forme === 'pagode') {
    for (const [x, h] of [[40, 74], [150, 96], [250, 68]]) {
      px(ctx, x - 4, base - h, 8, h, couleur);
      for (let e = 0; e < 3; e++) {
        const l = 46 - e * 12;
        px(ctx, x - l / 2, base - h + e * 22, l, 5, couleur);
        px(ctx, x - l / 2 + 4, base - h + e * 22 + 5, l - 8, 14, couleur);
      }
    }
  } else if (forme === 'toits') {
    for (let x = -20; x < LARGEUR + 20; x += 52) {
      const h = 30 + ((x * 7) % 20);
      px(ctx, x, base - h, 44, h, couleur);
      for (let i = 0; i < 22; i++) px(ctx, x - 2 + i * 2, base - h - 1 - i * 0.4, 3, 2, couleur);
    }
  } else if (forme === 'tours') {
    for (const x of [30, 130, 230, 300]) {
      px(ctx, x, base - 82, 30, 82, couleur);
      px(ctx, x - 3, base - 90, 36, 9, couleur);
    }
    px(ctx, 0, base - 34, LARGEUR, 34, couleur);
  } else if (forme === 'gradins') {
    for (let e = 0; e < 5; e++) {
      px(ctx, 0, base - 62 + e * 12, LARGEUR, 10, couleur);
    }
  } else if (forme === 'arcades') {
    for (let x = -10; x < LARGEUR + 10; x += 46) {
      px(ctx, x, base - 66, 10, 66, couleur);
      px(ctx, x + 10, base - 66, 36, 7, couleur);
    }
  }
}

/** Assombrit une couleur : la profondeur se fait par la valeur, pas par le flou. */
function foncer(hex, facteur) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * facteur);
  const v = Math.round(((n >> 8) & 255) * facteur);
  const b = Math.round((n & 255) * facteur);
  return `rgb(${r},${v},${b})`;
}

export function dessinerDecor(ctx, cleArene, temps) {
  const a = ARENES[cleArene] ?? ARENES.chateau;

  // Le ciel en trois bandes franches plutôt qu'un dégradé : un dégradé lisse
  // sur un fond pixel art jure immédiatement.
  const bandes = [0, 40, 82];
  a.ciel.forEach((c, i) => px(ctx, 0, bandes[i], LARGEUR, (bandes[i + 1] ?? SOL) - bandes[i], c));

  // Deux plans de silhouettes : le lointain plus pâle, décalé lentement. Ce
  // décalage est ce qui donne la profondeur — sans lui, le décor est un mur.
  const derive = (temps * 0.06) % 40;
  ctx.save();
  ctx.translate(-derive * 0.4, 0);
  silhouettes(ctx, a.silhouettes, foncer(a.brume, 0.72), SOL - 16);
  ctx.restore();

  ctx.save();
  ctx.translate(-derive, 0);
  silhouettes(ctx, a.silhouettes, foncer(a.brume, 0.45), SOL - 4);
  ctx.restore();

  // Le sol, en trois strates.
  px(ctx, 0, SOL, LARGEUR, 6, a.sol[0]);
  px(ctx, 0, SOL + 6, LARGEUR, 8, a.sol[1]);
  px(ctx, 0, SOL + 14, LARGEUR, HAUTEUR - SOL - 14, a.sol[2]);
  for (let x = 0; x < LARGEUR; x += 16) px(ctx, x + ((x * 3) % 5), SOL + 3, 6, 1, a.sol[2]);
}

// ─────────────────────────────── Les combattants

/**
 * La pose : quatre nombres qui déplacent les membres.
 *
 * Tout le mouvement du jeu tient là-dedans. Chaque état lit son avancement
 * (`t`, de 0 à 1) et en tire une inclinaison, une extension de bras, un
 * écartement de jambes. Une animation n'est rien d'autre qu'une fonction du
 * temps vers une pose.
 */
function pose(f, t) {
  const base = { penche: 0, bras: 0, jambe: 0, arme: 0, recul: 0 };
  switch (f.etat) {
    case ETATS.MARCHE:
      return { ...base, jambe: Math.sin(t * Math.PI * 4) * 4, bras: Math.sin(t * Math.PI * 4) * 2 };
    case ETATS.GARDE:
      return { ...base, penche: -2, bras: -4, recul: 2 };
    case ETATS.ESQUIVE:
      return { ...base, penche: 5, jambe: 6, bras: 3 };
    case ETATS.TOUCHE:
      return { ...base, penche: -7, bras: -3, recul: 4 };
    case ETATS.BLOQUE:
      return { ...base, penche: -3, bras: -4, recul: 2 };
    case ETATS.KO:
      return { ...base, penche: -18, jambe: 10, recul: 8 };
    case ETATS.ATTAQUE: {
      const c = f.coup;
      const total = c.depart + c.actif + c.recup;
      const p = f.image / total;
      const finDepart = c.depart / total;
      const finActif = (c.depart + c.actif) / total;
      // Trois temps : on arme (recul), on frappe (extension maximale), on
      // récupère. Sans l'armement, un coup part sans qu'on l'ait vu venir —
      // et un jeu de combat où l'on ne lit pas les coups n'est pas jouable.
      if (p < finDepart) {
        const q = p / finDepart;
        return { ...base, penche: -4 * q, bras: -6 * q, arme: -8 * q };
      }
      if (p < finActif) return { ...base, penche: 6, bras: 14, arme: 20, jambe: 5 };
      const q = (p - finActif) / (1 - finActif);
      return { ...base, penche: 6 - 6 * q, bras: 14 - 12 * q, arme: 20 - 18 * q, jambe: 5 - 5 * q };
    }
    default:
      return { ...base, penche: Math.sin(t * Math.PI * 2) * 0.6 };
  }
}

/** L'arme, dessinée selon le personnage. C'est elle qui distingue de loin. */
function dessinerArme(ctx, cle, p, x, y, sens, palette) {
  const [, , , sombre, or] = palette;
  const acier = '#cfd6df';
  const bois = '#6b4a2f';
  const dx = sens * (10 + p.arme);

  if (cle === 'chevalier') {
    px(ctx, x + dx, y - 26 - p.bras, sens * 3, 22, acier);           // lame
    px(ctx, x + dx - sens, y - 6 - p.bras, sens * 6, 3, or);         // garde
    px(ctx, x - sens * 9, y - 20, sens * 7, 16, sombre);             // bouclier
    px(ctx, x - sens * 8, y - 18, sens * 5, 12, or);
  } else if (cle === 'samourai') {
    px(ctx, x + dx, y - 24 - p.bras, sens * 2, 24, acier);
    px(ctx, x + dx - sens, y - 2 - p.bras, sens * 4, 2, sombre);
  } else if (cle === 'ninja') {
    px(ctx, x + dx, y - 18 - p.bras, sens * 2, 10, acier);
    px(ctx, x + dx + sens * 2, y - 18 - p.bras, sens * 5, 2, acier);  // faucille
    for (let i = 1; i < 6; i++) px(ctx, x + dx - sens * i * 3, y - 6, 2, 2, sombre);
  } else if (cle === 'lancier') {
    px(ctx, x + dx - sens * 6, y - 30 - p.bras, sens * 2, 40, bois);  // hampe
    px(ctx, x + dx - sens * 6, y - 34 - p.bras, sens * 3, 8, acier);  // fer
    px(ctx, x + dx - sens * 4, y - 30 - p.bras, sens * 4, 3, acier);
  } else if (cle === 'lutteur') {
    px(ctx, x + dx - sens * 2, y - 22 - p.bras, sens * 5, 6, or);     // gantelets
    px(ctx, x - sens * 6, y - 16, sens * 5, 5, or);
  } else if (cle === 'duelliste') {
    px(ctx, x + dx, y - 20 - p.bras, sens * 1, 20, acier);            // rapière
    px(ctx, x + dx - sens, y - 4 - p.bras, sens * 3, 3, or);
  }
}

export function dessinerCombattant(ctx, f, temps) {
  const d = COMBATTANTS[f.cle];
  const [peau, tenue, tenue2, sombre, or] = d.palette;
  const x = Math.round(f.x * echelle);
  const y = SOL;
  const s = f.sens;
  const p = pose(f, (temps % 60) / 60);
  const bx = x - s * p.recul;

  // L'ombre ancre le personnage au sol. Sans elle, il flotte — c'est le
  // détail qui manque toujours aux jeux amateurs.
  ctx.globalAlpha = 0.28;
  px(ctx, bx - 9, y - 2, 18, 3, '#000');
  ctx.globalAlpha = 1;

  if (f.etat === ETATS.KO) {
    px(ctx, bx - 12, y - 8, 24, 8, tenue);
    px(ctx, bx - s * 14, y - 10, 7, 7, peau);
    return;
  }

  const inc = p.penche * 0.4;

  // Jambes
  px(ctx, bx - 6 - p.jambe * 0.4, y - 14, 5, 14, tenue2);
  px(ctx, bx + 2 + p.jambe * 0.4, y - 14, 5, 14, tenue2);
  px(ctx, bx - 7 - p.jambe * 0.4, y - 3, 7, 3, sombre);
  px(ctx, bx + 2 + p.jambe * 0.4, y - 3, 7, 3, sombre);

  // Buste, incliné
  px(ctx, bx - 7 + inc, y - 32, 14, 19, tenue);
  px(ctx, bx - 7 + inc, y - 32, 14, 5, tenue2);        // épaules
  px(ctx, bx - 2 + inc, y - 28, 4, 12, or);            // ceinture / plastron

  // Bras avant, tendu selon la pose
  px(ctx, bx + s * (4 + p.bras * 0.5) + inc, y - 27, s * 7, 4, peau);
  // Bras arrière
  px(ctx, bx - s * 5 + inc, y - 26, s * 4, 4, tenue2);

  // Tête et casque : la coiffe distingue les six d'un coup d'œil.
  const tx = bx + inc * 1.6;
  px(ctx, tx - 5, y - 43, 10, 11, peau);
  if (f.cle === 'chevalier') {
    px(ctx, tx - 6, y - 45, 12, 8, tenue2);
    px(ctx, tx - 6, y - 39, 12, 2, sombre);            // fente du heaume
    px(ctx, tx - 1, y - 50, 2, 6, or);                 // cimier
  } else if (f.cle === 'samourai') {
    px(ctx, tx - 6, y - 45, 12, 6, sombre);
    px(ctx, tx - 9, y - 46, 4, 3, or);                 // ornement latéral
    px(ctx, tx + 5, y - 46, 4, 3, or);
  } else if (f.cle === 'ninja') {
    px(ctx, tx - 5, y - 44, 10, 7, sombre);
    px(ctx, tx - 5, y - 39, 10, 3, or);                // bandeau clair : les yeux
  } else if (f.cle === 'lancier') {
    px(ctx, tx - 6, y - 45, 12, 5, tenue2);
    px(ctx, tx - 8, y - 41, 16, 2, tenue2);            // large bord
  } else if (f.cle === 'lutteur') {
    px(ctx, tx - 5, y - 45, 10, 4, sombre);            // bandeau
    px(ctx, tx - 6, y - 34, 12, 3, or);                // épaulières
  } else {
    px(ctx, tx - 6, y - 45, 12, 4, tenue2);
    px(ctx, tx + s * 4, y - 44, s * 5, 3, tenue);      // plume
  }

  dessinerArme(ctx, f.cle, p, bx + inc, y - 8, s, d.palette);

  // La lueur d'impact : elle dit QUAND le coup touche, ce que la pose seule
  // ne suffit pas à faire.
  if (f.etat === ETATS.ATTAQUE && f.coup) {
    const actif = f.image >= f.coup.depart && f.image < f.coup.depart + f.coup.actif;
    if (actif) {
      const b = boite(f);
      const px0 = Math.round((b.x + b.l / 2) * echelle) + s * 14;
      ctx.globalAlpha = 0.5;
      px(ctx, px0, y - 30, s * Math.round(f.coup.portee * echelle), 2, '#fff');
      ctx.globalAlpha = 1;
    }
  }
}

export function dessinerProjectiles(ctx, projectiles) {
  for (const p of projectiles) {
    const x = Math.round(p.x * echelle);
    px(ctx, x, SOL - 30, p.sens * 8, 3, '#e8f4ff');
    px(ctx, x - p.sens * 4, SOL - 29, p.sens * 5, 1, '#8fb8d8');
  }
}

/**
 * Une image complète.
 *
 * La secousse d'impact est appliquée ici, en pixels ENTIERS : une secousse
 * fractionnaire fait baver toute l'image, ce qui ruine le rendu net qu'on
 * vient de construire.
 */
export function dessiner(ctx, etat, cleArene, temps) {
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  if (etat.secousse > 0) {
    ctx.translate(Math.round((Math.random() - 0.5) * etat.secousse),
      Math.round((Math.random() - 0.5) * etat.secousse * 0.6));
  }

  dessinerDecor(ctx, cleArene, temps);

  // Le combattant le plus en arrière est dessiné en premier : sans cet ordre,
  // celui de gauche passe toujours devant, et les corps à corps deviennent
  // illisibles.
  const ordre = etat.a.x <= etat.b.x ? [etat.a, etat.b] : [etat.b, etat.a];
  for (const f of ordre) dessinerCombattant(ctx, f, temps);
  dessinerProjectiles(ctx, etat.projectiles);

  ctx.restore();
}
