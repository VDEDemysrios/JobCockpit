// Dossier de candidature : la lettre et le CV dans un seul fichier.
//
// POURQUOI CE MODULE
// ------------------
// Le programme ne sait pas produire un CV, et il n'a pas à essayer : le texte
// qu'il extrait du .docx sert à nourrir l'analyse, pas à être relu ou envoyé.
// L'extraction aplatit les tableaux et livre les blocs dans un ordre
// imprévisible — le CV du candidat en ressort avec « CONTACT » avant son nom.
// Ce texte est une matière première, pas un document.
//
// Le CV qu'on envoie à un employeur, c'est donc le .docx d'origine, joint tel
// quel, octet pour octet. Le dossier réunit les deux en un téléchargement.
import JSZip from 'jszip';
import { construireDocx, nomFichier } from './letterDocx.js';

/**
 * Construit l'archive de candidature.
 * @param {object}   options
 * @param {object}   options.offre        titre, entreprise, ville
 * @param {string}   options.contenu      corps de la lettre
 * @param {object}   options.coordonnees  { nom, email, tel, ville }
 * @param {object|null} options.cv        { nom, contenu } — le fichier source
 * @returns {Promise<Buffer>}
 */
export async function construireDossier({ offre, contenu, coordonnees, cv }) {
  const zip = new JSZip();

  zip.file(nomFichier(offre), await construireDocx(offre, contenu, coordonnees));

  // Le CV part sans être relu ni reconstruit : la mise en page de l'auteur
  // est la sienne, le programme n'a pas à la réécrire.
  if (cv?.contenu) zip.file(cv.nom, cv.contenu);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Nom de l'archive : « Candidature_Chef_de_projet_EnR_SOLARIS.zip ». */
export function nomDossier(offre) {
  return nomFichier(offre)
    .replace(/^Lettre_/, 'Candidature_')
    .replace(/\.docx$/, '.zip');
}
