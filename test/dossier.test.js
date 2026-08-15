import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { construireDossier, nomDossier } from '../src/dossier.js';

const OFFRE = { titre: 'Chef de projet EnR', entreprise: 'SOLARIS', ville: 'Nancy' };
const LETTRE = 'Madame, Monsieur,\n\nUn paragraphe.\n\nUn autre paragraphe.';
const COORD = { nom: 'Camille Durand', email: 'b@exemple.fr', tel: '06 00 00 00 00', ville: 'Nancy' };

// Le CV n'est plus recopié en texte dans la lettre : il part tel quel, en
// pièce jointe, dans le même fichier que la lettre. Un seul téléchargement,
// deux documents prêts à joindre à un mail.
test('le dossier contient la lettre ET le CV', async () => {
  const zip = await JSZip.loadAsync(await construireDossier({
    offre: OFFRE, contenu: LETTRE, coordonnees: COORD,
    cv: { nom: 'CV_Camille_Durand.docx', contenu: Buffer.from('un vrai CV') },
  }));

  const fichiers = Object.keys(zip.files);
  assert.equal(fichiers.length, 2);
  assert.ok(fichiers.some(f => f.startsWith('Lettre_')), `lettre absente : ${fichiers}`);
  assert.ok(fichiers.includes('CV_Camille_Durand.docx'), `CV absent : ${fichiers}`);
});

test('la lettre du dossier est un vrai document Word', async () => {
  const zip = await JSZip.loadAsync(await construireDossier({
    offre: OFFRE, contenu: LETTRE, coordonnees: COORD,
    cv: { nom: 'CV.docx', contenu: Buffer.from('cv') },
  }));

  const lettre = zip.file(Object.keys(zip.files).find(f => f.startsWith('Lettre_')));
  const octets = await lettre.async('nodebuffer');
  assert.equal(octets[0], 0x50, 'signature ZIP attendue : un .docx est une archive');
  assert.equal(octets[1], 0x4b);
});

test('le CV est joint octet pour octet, sans retraitement', async () => {
  const original = Buffer.from('contenu binaire du CV, à ne surtout pas transformer');
  const zip = await JSZip.loadAsync(await construireDossier({
    offre: OFFRE, contenu: LETTRE, coordonnees: COORD,
    cv: { nom: 'CV.docx', contenu: original },
  }));

  const joint = await zip.file('CV.docx').async('nodebuffer');
  assert.deepEqual(joint, original);
});

// Le CV peut manquer : mieux vaut livrer la lettre seule qu'échouer.
test('sans CV, le dossier livre la lettre seule', async () => {
  const zip = await JSZip.loadAsync(await construireDossier({
    offre: OFFRE, contenu: LETTRE, coordonnees: COORD, cv: null,
  }));
  assert.equal(Object.keys(zip.files).length, 1);
});

test('nomDossier produit un nom de fichier sain', () => {
  assert.equal(
    nomDossier({ titre: 'Chef de projet ENR (H/F)', entreprise: 'Veles Énergies' }),
    'Candidature_Chef_de_projet_ENR_H_F_Veles_Energies.zip'
  );
});
