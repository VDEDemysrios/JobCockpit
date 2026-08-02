// Fabrique l'icône de l'application : assets/job-cockpit.ico
//
// POURQUOI À LA MAIN
// ------------------
// Une icône, c'est un PNG dans un conteneur ICO. Les deux formats se
// fabriquent avec `zlib`, déjà dans Node. Ajouter une bibliothèque de
// traitement d'images pour dessiner quatre formes serait le contraire du
// raisonnement tenu partout ailleurs dans ce projet.
//
// LE DESSIN
// ---------
// Un cadran de cockpit : un disque sombre, une aiguille orientée vers le haut
// à droite — la progression —, et un point lumineux. Pas de fusée : le projet
// a retiré sa gamification, l'icône n'a pas à la réintroduire.
//
// Usage : npm run icone
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

// Palette reprise du thème « vivid » de l'interface : la même identité.
const FOND = [17, 19, 34];        // --ink
const ACCENT = [124, 116, 245];   // --accent éclairci
const CLAIR = [232, 234, 255];

/** Mélange deux couleurs. `t` va de 0 (a) à 1 (b). */
const melanger = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/**
 * Dessine l'icône dans un tableau RVBA.
 *
 * Tout est calculé en distances au centre, ce qui donne des bords adoucis
 * sans avoir à gérer d'anticrénelage : on module simplement l'opacité sur le
 * dernier pixel de chaque forme.
 */
function dessiner(taille) {
  const px = Buffer.alloc(taille * taille * 4);
  const c = (taille - 1) / 2;
  const r = taille * 0.46;

  // L'aiguille : un segment partant du centre vers le haut à droite.
  const angle = -Math.PI / 4;
  const bout = { x: c + Math.cos(angle) * r * 0.62, y: c + Math.sin(angle) * r * 0.62 };

  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      const i = (y * taille + x) * 4;
      const d = Math.hypot(x - c, y - c);

      // Hors du disque : transparent, avec un bord adouci sur 1,5 pixel.
      const dansLeDisque = Math.min(1, Math.max(0, (r - d) / 1.5));
      if (dansLeDisque <= 0) continue;

      // Fond : un dégradé léger, plus clair en haut à gauche.
      const t = Math.min(1, Math.max(0, (x + y) / (2 * taille)));
      let couleur = melanger(melanger(FOND, [40, 44, 82], 0.55), FOND, t);

      // L'anneau extérieur.
      const anneau = Math.min(1, Math.max(0, (taille * 0.055 - Math.abs(d - r * 0.9)) / 1.5));
      if (anneau > 0) couleur = melanger(couleur, ACCENT, anneau * 0.85);

      // L'aiguille : distance du point au segment centre → bout.
      const vx = bout.x - c, vy = bout.y - c;
      const wx = x - c, wy = y - c;
      const proj = Math.min(1, Math.max(0, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
      const dSeg = Math.hypot(wx - vx * proj, wy - vy * proj);
      const epaisseur = taille * 0.042 * (1 - proj * 0.45);   // effilée vers la pointe
      const aiguille = Math.min(1, Math.max(0, (epaisseur - dSeg) / 1.5));
      if (aiguille > 0) couleur = melanger(couleur, CLAIR, aiguille);

      // Le moyeu.
      const moyeu = Math.min(1, Math.max(0, (taille * 0.075 - d) / 1.5));
      if (moyeu > 0) couleur = melanger(couleur, ACCENT, moyeu);

      px[i] = couleur[0]; px[i + 1] = couleur[1]; px[i + 2] = couleur[2];
      px[i + 3] = Math.round(255 * dansLeDisque);
    }
  }
  return px;
}

/** Somme de contrôle CRC-32, exigée par chaque bloc PNG. */
const TABLE_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const o of buf) c = TABLE_CRC[(c ^ o) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloc(type, donnees) {
  const t = Buffer.from(type, 'ascii');
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(donnees.length);
  const somme = Buffer.alloc(4);
  somme.writeUInt32BE(crc32(Buffer.concat([t, donnees])));
  return Buffer.concat([longueur, t, donnees, somme]);
}

function png(taille, px) {
  // Chaque ligne est préfixée d'un octet de filtre — 0 = aucun.
  const brut = Buffer.alloc((taille * 4 + 1) * taille);
  for (let y = 0; y < taille; y++) {
    brut[y * (taille * 4 + 1)] = 0;
    px.copy(brut, y * (taille * 4 + 1) + 1, y * taille * 4, (y + 1) * taille * 4);
  }

  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(taille, 0);
  entete.writeUInt32BE(taille, 4);
  entete[8] = 8;    // 8 bits par canal
  entete[9] = 6;    // RVBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', entete),
    bloc('IDAT', deflateSync(brut, { level: 9 })),
    bloc('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Une image au format DIB, tel que l'attend un fichier ICO.
 *
 * Windows accepte le PNG dans un ICO depuis Vista, mais beaucoup de lecteurs
 * — dont celui de .NET, qui sert aux raccourcis — le rendent faux : essai
 * fait, l'icône ressortait avec des couleurs aberrantes et un fond vert.
 * Le DIB est universellement compris, et c'est ce qui compte pour une icône.
 *
 * Trois pièges du format, tous obligatoires :
 *   - les octets vont en BGRA, pas en RVBA ;
 *   - les lignes sont stockées de bas en haut ;
 *   - la hauteur déclarée vaut le DOUBLE, parce que l'en-tête compte aussi
 *     un masque de transparence hérité — qu'on écrit vide, la couche alpha
 *     faisant le travail.
 */
function dib(taille, px) {
  const entete = Buffer.alloc(40);
  entete.writeUInt32LE(40, 0);
  entete.writeInt32LE(taille, 4);
  entete.writeInt32LE(taille * 2, 8);
  entete.writeUInt16LE(1, 12);
  entete.writeUInt16LE(32, 14);

  const couleurs = Buffer.alloc(taille * taille * 4);
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      const src = ((taille - 1 - y) * taille + x) * 4;
      const dst = (y * taille + x) * 4;
      couleurs[dst] = px[src + 2];       // B
      couleurs[dst + 1] = px[src + 1];   // V
      couleurs[dst + 2] = px[src];       // R
      couleurs[dst + 3] = px[src + 3];   // A
    }
  }

  // Masque monochrome : une ligne fait un multiple de 4 octets.
  const masque = Buffer.alloc(Math.ceil(taille / 32) * 4 * taille);
  return Buffer.concat([entete, couleurs, masque]);
}

/** Conteneur ICO : un en-tête, une entrée par taille, puis les images. */
function ico(images) {
  const entete = Buffer.alloc(6);
  entete.writeUInt16LE(0, 0);
  entete.writeUInt16LE(1, 2);              // 1 = icône
  entete.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entrees = images.map(({ taille, donnees }) => {
    const e = Buffer.alloc(16);
    e[0] = taille >= 256 ? 0 : taille;     // 0 signifie 256
    e[1] = taille >= 256 ? 0 : taille;
    e[4] = 1; e[5] = 0;                    // plans
    e[6] = 32; e[7] = 0;                   // bits par pixel
    e.writeUInt32LE(donnees.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += donnees.length;
    return e;
  });

  return Buffer.concat([entete, ...entrees, ...images.map(i => i.donnees)]);
}

// Le 256 reste en PNG : à cette taille le DIB pèse 256 Ko, et tous les
// lecteurs modernes savent le lire. Les tailles courantes sont en DIB, pour
// être justes partout.
const TAILLES = [16, 24, 32, 48, 64, 128, 256];
const images = TAILLES.map(taille => {
  const px = dessiner(taille);
  return { taille, donnees: taille >= 256 ? png(taille, px) : dib(taille, px) };
});

mkdirSync(join(RACINE, 'assets'), { recursive: true });
const chemin = join(RACINE, 'assets/job-cockpit.ico');
writeFileSync(chemin, ico(images));

console.log(`✅ ${chemin}`);
console.log(`   ${TAILLES.join(', ')} px — ${(ico(images).length / 1024).toFixed(1)} Ko`);
