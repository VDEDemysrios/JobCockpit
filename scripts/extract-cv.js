// Extrait le texte du CV vers profile/cv.txt, en ligne de commande.
//
// CE SCRIPT NE SAIT PLUS LIRE UN CV : IL APPELLE `src/cv.js`.
// -----------------------------------------------------------
// Il portait sa propre extraction, en double de celle du téléversement. Les
// deux ont divergé, exactement comme `src/cv.js` l'annonçait : cette
// copie-ci ignorait le .txt, ne vérifiait pas qu'un fichier nommé `.docx` en
// était vraiment un, et écrivait `cv.txt` AVANT le document — ce qui faisait
// déclarer périmée, dans l'application, une extraction qui venait de se faire.
//
// Le dépôt par glisser ou par le bouton, dans l'application, reste la voie
// normale. Celle-ci sert quand on travaille depuis les sources.
//
// Usage : npm run extract-cv -- "C:/chemin/vers/CV_Camille_Durand.docx"
import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { enregistrerCv } from '../src/cv.js';

const cheminSource = process.argv[2];

if (!cheminSource) {
  console.error('Usage : npm run extract-cv -- "chemin/vers/CV.docx"');
  process.exit(1);
}
if (!existsSync(cheminSource)) {
  console.error(`Fichier introuvable : ${cheminSource}`);
  process.exit(1);
}

try {
  const { caracteres, chemin } = await enregistrerCv(
    readFileSync(cheminSource), basename(cheminSource), resolve('.'));
  console.log(`✓ CV extrait : ${caracteres} caractères → profile/cv.txt`);
  console.log(`✓ Copie du fichier source → ${chemin}`);
} catch (erreur) {
  console.error(`⚠ ${erreur.message}`);
  process.exit(1);
}
