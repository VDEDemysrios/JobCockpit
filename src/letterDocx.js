// Mise en page Word (.docx) d'une lettre de motivation.
// Présentation française classique : coordonnées en haut à gauche,
// destinataire à droite, lieu et date, objet, corps, signature.
import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function dateEnFrancais(d = new Date()) {
  return `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
}

const ligne = (texte, options = {}) => new Paragraph({
  children: [new TextRun({ text: texte, size: 22, font: 'Calibri', ...options })],
  spacing: { after: options.after ?? 120 },
  alignment: options.alignment,
});

/**
 * Construit le document Word.
 * @param {object} offre        titre, entreprise, ville
 * @param {string} contenu      corps de la lettre
 * @param {object} coordonnees  { nom, email, tel }
 * @returns {Promise<Buffer>}
 */
export async function construireDocx(offre, contenu, coordonnees) {
  const { nom, email, tel, ville } = coordonnees;

  const enTete = [
    nom ? ligne(nom, { bold: true, after: 40 }) : null,
    email ? ligne(email, { after: 40 }) : null,
    tel ? ligne(tel, { after: 40 }) : null,
  ].filter(Boolean);

  const destinataire = [
    ligne(offre.entreprise || '', { bold: true, alignment: AlignmentType.RIGHT, after: 40 }),
    offre.ville ? ligne(offre.ville, { alignment: AlignmentType.RIGHT, after: 40 }) : null,
  ].filter(Boolean);

  // Le corps arrive en paragraphes séparés par des lignes vides.
  const corps = contenu
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => new Paragraph({
      children: [new TextRun({ text: p.replace(/\n/g, ' '), size: 22, font: 'Calibri' })],
      spacing: { after: 200, line: 276 },
      alignment: AlignmentType.JUSTIFIED,
    }));

  const document = new Document({
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      children: [
        ...enTete,
        ligne(''),
        ...destinataire,
        ligne(''),
        // Usage français : « Épinal, le 28 juillet 2026 ».
        ligne(ville ? `${ville}, le ${dateEnFrancais()}` : dateEnFrancais(),
          { alignment: AlignmentType.RIGHT, after: 320 }),
        ligne(`Objet : candidature au poste de ${offre.titre}`, { bold: true, after: 320 }),
        ...corps,
        ligne(''),
        ligne(nom || '', { alignment: AlignmentType.RIGHT }),
      ],
    }],
  });

  return Packer.toBuffer(document);
}

/** Nom de fichier propre : « Lettre_Chef_de_projet_EnR_SOLARIS.docx ». */
export function nomFichier(offre) {
  const nettoyer = (t) => String(t ?? '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  return `Lettre_${nettoyer(offre.titre)}_${nettoyer(offre.entreprise)}.docx`
    .replace(/_+/g, '_');
}
