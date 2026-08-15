// Extraction du CV, partagée par la ligne de commande et par le dépôt de
// fichier dans l'application.
//
// UNE SEULE PORTE. `scripts/extract-cv.js` portait cette logique et le
// téléversement l'aurait recopiée — deux implémentations qui auraient fini
// par diverger, et l'une des deux aurait accepté un fichier que l'autre
// refuse. Le CV nourrit l'analyse de chaque offre et la rédaction de chaque
// lettre : il n'y a pas de place pour deux vérités sur ce qu'est un CV
// valide.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import mammoth from 'mammoth';

/**
 * En dessous, ce n'est pas un CV : c'est un fichier vide, une image scannée
 * sans texte, ou un document protégé. Laisser passer donnerait une analyse
 * fondée sur rien, et des lettres inventées de toutes pièces.
 */
export const TEXTE_MINIMUM = 200;

/** Ce qu'on sait lire. Le PDF n'en fait pas partie — voir `messageRefus`. */
export const EXTENSIONS = ['.docx', '.txt'];

/** L'extension d'un nom de fichier, en minuscules. */
export function extensionDe(nom) {
  const m = String(nom ?? '').toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : '';
}

/**
 * Pourquoi ce fichier est refusé, ou null s'il est acceptable.
 *
 * Le message dit QUOI FAIRE, pas seulement ce qui ne va pas : « format non
 * supporté » laisse démuni, « enregistre-le en .docx » se règle en trente
 * secondes.
 */
export function messageRefus(nom, octets) {
  const ext = extensionDe(nom);
  if (ext === '.pdf') {
    return 'Le PDF n\'est pas lisible ici. Dans Word ou LibreOffice : '
      + '« Enregistrer sous » puis choisis le format .docx.';
  }
  if (!EXTENSIONS.includes(ext)) {
    return `Format non reconnu (${ext || 'sans extension'}). Dépose un fichier .docx ou .txt.`;
  }
  if (!octets || octets.length === 0) return 'Le fichier est vide.';
  // Un .docx est une archive ZIP : ses deux premiers octets sont « PK ». Le
  // vérifier évite d'appeler l'extracteur sur un fichier simplement renommé,
  // qui échouerait avec une erreur technique incompréhensible.
  if (ext === '.docx' && !(octets[0] === 0x50 && octets[1] === 0x4B)) {
    return 'Ce fichier porte l\'extension .docx mais n\'en est pas un. '
      + 'Rouvre-le dans Word et réenregistre-le.';
  }
  return null;
}

/**
 * Extrait le texte d'un CV.
 *
 * @param {Buffer} octets
 * @param {string} nom  nom d'origine, pour choisir l'extracteur
 * @returns {Promise<string>} le texte, nettoyé
 */
export async function extraireTexte(octets, nom) {
  if (extensionDe(nom) === '.txt') return String(octets.toString('utf8')).trim();
  const { value } = await mammoth.extractRawText({ buffer: octets });
  // Les lignes vides multiples sont compressées : le texte part dans les
  // requêtes d'analyse, et les blancs y coûtent des jetons pour rien.
  return String(value ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Enregistre un CV : le texte extrait ET le document d'origine.
 *
 * L'original est conservé parce que c'est LUI qui part en pièce jointe des
 * candidatures, octet pour octet. Ne garder que le texte obligerait à
 * reconstruire une mise en page, donc à en inventer une.
 *
 * @returns {Promise<{caracteres: number, chemin: string}>}
 */
export async function enregistrerCv(octets, nom, racine) {
  const refus = messageRefus(nom, octets);
  if (refus) throw new Error(refus);

  const texte = await extraireTexte(octets, nom);
  if (texte.length < TEXTE_MINIMUM) {
    throw new Error(`Seulement ${texte.length} caractères lus. `
      + 'Si ton CV est une image scannée, son texte n\'est pas récupérable : '
      + 'il faut un document Word.');
  }

  const dossier = join(racine, 'profile');
  if (!existsSync(dossier)) mkdirSync(dossier, { recursive: true });

  writeFileSync(join(dossier, 'cv.txt'), texte, 'utf8');
  const original = join(dossier, extensionDe(nom) === '.txt' ? 'cv-source.txt' : 'cv-source.docx');
  writeFileSync(original, octets);

  return { caracteres: texte.length, chemin: original };
}
