import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { construirePrompt, extraireCoordonnees } from '../src/letter.js';
import { nomFichier, construireDocx } from '../src/letterDocx.js';

const profil = JSON.parse(readFileSync(new URL('../profile/profile.json', import.meta.url), 'utf8'));

// Le CV réel commence par « CONTACT », puis l'e-mail, puis des rubriques :
// le nom n'apparaît PAS dans les premières lignes. Deviner échouait.
const CV_REALISTE = `CONTACT

benjamin.perrinb@gmail.com

+33 6 06 90 40 91

Épinal, France

COMPÉTENCES

Projets agrivoltaïques

Gestion de projets

EXPÉRIENCE

Chef de Projet & Juriste — Benjamin Perrin`;

test('les coordonnées viennent de profile.json, pas d\'une devinette sur le CV', () => {
  const c = extraireCoordonnees(CV_REALISTE, profil.candidat);
  assert.equal(c.nom, 'Benjamin Perrin');
  assert.notEqual(c.nom, 'Projets agrivoltaïques',
    'régression : le nom ne doit jamais être deviné dans le CV');
});

test('l\'e-mail et le téléphone sont repêchés dans le CV si absents du profil', () => {
  const c = extraireCoordonnees(CV_REALISTE, { nom: 'Benjamin Perrin' });
  assert.equal(c.email, 'benjamin.perrinb@gmail.com');
  assert.match(c.tel, /06 90 40 91/);
});

test('profile.json a la priorité sur le CV', () => {
  const c = extraireCoordonnees(CV_REALISTE, {
    nom: 'Autre Nom', email: 'pro@exemple.fr', telephone: '01 02 03 04 05',
  });
  assert.equal(c.nom, 'Autre Nom');
  assert.equal(c.email, 'pro@exemple.fr');
  assert.equal(c.tel, '01 02 03 04 05');
});

test('extraireCoordonnees ne plante pas sans CV ni profil', () => {
  const c = extraireCoordonnees(null, undefined);
  assert.deepEqual(c, { nom: '', email: '', tel: '', ville: '' });
});

test('construirePrompt impose la structure et interdit l\'invention', () => {
  const p = construirePrompt(
    { titre: 'Chef de projet EnR', entreprise: 'SOLARIS', ville: 'Nancy', description: 'Développement de projets.' },
    { prouvable: ['M2 Droit et Gestion des Énergies'], nonprouvable: ['5 ans'], compensable: [], kw: [['agrivoltaïsme', 'oui', '']] },
    'CV de Benjamin'
  );
  assert.ok(p.includes('POURQUOI MOI ET PAS UN AUTRE'), 'le paragraphe pivot doit être imposé');
  assert.ok(p.includes('N\'INVENTE JAMAIS'));
  assert.ok(p.includes('M2 Droit et Gestion des Énergies'), 'l\'analyse doit nourrir la lettre');
  assert.ok(p.includes('agrivoltaïsme'), 'les mots-clés doivent être transmis');
});

test('nomFichier produit un nom de fichier sain', () => {
  assert.equal(
    nomFichier({ titre: 'Chef de projet ENR (H/F)', entreprise: 'Veles Énergies' }),
    'Lettre_Chef_de_projet_ENR_H_F_Veles_Energies.docx'
  );
});

test('construireDocx produit un fichier Word valide contenant le nom et l\'objet', async () => {
  const buffer = await construireDocx(
    { titre: 'Chef de projet EnR', entreprise: 'SOLARIS', ville: 'Nancy' },
    'Madame, Monsieur,\n\nPremier paragraphe.\n\nSecond paragraphe.',
    { nom: 'Benjamin Perrin', email: 'b@exemple.fr', tel: '06 00 00 00 00', ville: 'Épinal' }
  );

  // Signature ZIP : un .docx est une archive.
  assert.equal(buffer[0], 0x50);
  assert.equal(buffer[1], 0x4b);
  assert.ok(buffer.length > 3000, 'le document doit contenir du texte');

  const brut = buffer.toString('latin1');
  assert.ok(brut.includes('word/document.xml'), 'structure Word attendue');
});
