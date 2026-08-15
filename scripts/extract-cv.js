// Extrait le texte du CV (.docx) vers profile/cv.txt.
// À lancer UNE FOIS au premier démarrage, puis à chaque mise à jour du CV.
// Le CV et son extraction sont gitignorés : ce sont des données personnelles.
//
// Usage : npm run extract-cv -- "C:/chemin/vers/CV_Camille_Durand.docx"
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mammoth from 'mammoth';

const cheminSource = process.argv[2];

if (!cheminSource) {
  console.error('Usage : npm run extract-cv -- "chemin/vers/CV.docx"');
  process.exit(1);
}
if (!existsSync(cheminSource)) {
  console.error(`Fichier introuvable : ${cheminSource}`);
  process.exit(1);
}

const dossierProfil = resolve('profile');
if (!existsSync(dossierProfil)) mkdirSync(dossierProfil, { recursive: true });

const { value: texte } = await mammoth.extractRawText({ buffer: readFileSync(cheminSource) });

// Compresse les lignes vides multiples pour un prompt plus lisible.
const propre = texte.replace(/\n{3,}/g, '\n\n').trim();

if (propre.length < 200) {
  console.error(`⚠ Texte extrait très court (${propre.length} caractères). Le fichier est-il bien un CV ?`);
  process.exit(1);
}

writeFileSync(resolve('profile/cv.txt'), propre, 'utf8');
// On garde une copie du .docx d'origine (gitignorée) pour pouvoir réextraire.
copyFileSync(cheminSource, resolve('profile/cv-source.docx'));

console.log(`✓ CV extrait : ${propre.length} caractères → profile/cv.txt`);
console.log(`✓ Copie du fichier source → profile/cv-source.docx`);
