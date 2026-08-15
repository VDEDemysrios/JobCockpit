import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { construirePrompt, extraireCoordonnees } from '../src/letter.js';
import { nomFichier, construireDocx } from '../src/letterDocx.js';

const profil = JSON.parse(readFileSync(new URL('./fixtures/profil.json', import.meta.url), 'utf8'));

// LA FORME QUI FAISAIT ÉCHOUER LA DEVINETTE.
//
// Un CV réel commence souvent par « CONTACT », puis l'e-mail, puis des
// rubriques : le nom n'apparaît PAS dans les premières lignes. Le code
// prenait alors la première ligne venue pour un nom, et signait les lettres
// « Projets agrivoltaïques ».
//
// Ce jeu d'essai reproduit cette forme avec des coordonnées INVENTÉES. Il
// portait auparavant celles de l'auteur — nom, adresse personnelle, numéro
// de mobile, ville — dans un fichier public. Un jeu de test n'a aucune
// raison de contenir les coordonnées de qui que ce soit.
const CV_REALISTE = `CONTACT

camille.durand@exemple.fr

+33 6 12 34 56 78

Nancy, France

COMPÉTENCES

Projets agrivoltaïques

Gestion de projets

EXPÉRIENCE

Chef de Projet & Juriste — Camille Durand`;

test('les coordonnées viennent de profile.json, pas d\'une devinette sur le CV', () => {
  const c = extraireCoordonnees(CV_REALISTE, profil.candidat);
  assert.equal(c.nom, 'Camille Durand');
  assert.notEqual(c.nom, 'Projets agrivoltaïques',
    'régression : le nom ne doit jamais être deviné dans le CV');
});

test('l\'e-mail et le téléphone sont repêchés dans le CV si absents du profil', () => {
  const c = extraireCoordonnees(CV_REALISTE, { nom: 'Camille Durand' });
  assert.equal(c.email, 'camille.durand@exemple.fr');
  assert.match(c.tel, /12 34 56 78/);
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
    'CV du candidat'
  );
  assert.ok(p.includes('POURQUOI MOI ET PAS UN AUTRE'), 'le paragraphe pivot doit être imposé');
  assert.ok(p.includes('N\'INVENTE JAMAIS'));
  assert.ok(p.includes('M2 Droit et Gestion des Énergies'), 'l\'analyse doit nourrir la lettre');
  assert.ok(p.includes('agrivoltaïsme'), 'les mots-clés doivent être transmis');
});

// Les premières lettres réelles faisaient 350 mots et restaient génériques :
// l'auteur les a jugées « pas assez fournies ». Le prompt doit exiger une
// longueur de vraie lettre de candidature.
test('le prompt exige une lettre longue', () => {
  const p = construirePrompt({ titre: 'Chef de projet EnR', description: 'x' }, null, 'CV');
  const plancher = Number(p.match(/(\d{3})\s*(?:à|-)\s*\d{3}\s*mots/)?.[1] ?? 0);
  assert.ok(plancher >= 600, `plancher trop bas (${plancher} mots)`);
});

/**
 * LE PROMPT NE DOIT DÉCRIRE PERSONNE.
 *
 * Il a longtemps décrit le parcours de son auteur : « la spécialisation
 * agrivoltaïque, qui représente 90 % de son portefeuille », « Master 2 Droit
 * et Gestion des Énergies », « son anglais est professionnel, pas courant ».
 *
 * Tant que l'outil ne servait qu'à lui, c'était une bonne consigne. Publié,
 * cela devenait un défaut grave : chaque utilisateur aurait reçu des lettres
 * affirmant SON diplôme et SA spécialisation — des titres inventés, dans un
 * document envoyé à un employeur. Exactement ce que le prompt interdit par
 * ailleurs.
 *
 * Le différenciateur doit donc être CHERCHÉ dans le CV fourni, jamais énoncé
 * d'avance.
 */
test('le prompt ne contient le parcours de personne', () => {
  const p = construirePrompt({ titre: 'Juriste', description: 'x' }, null, 'CV');
  for (const [motif, quoi] of [
    [/90\s*%\s*(?:du|de son)/i, 'une part de portefeuille chiffrée'],
    [/Master 2 Droit et Gestion des Énergies/i, 'un diplôme nommé'],
    [/anglais.{0,40}(?:professionnel|courant)/i, 'un niveau de langue affirmé'],
  ]) {
    assert.ok(!motif.test(p), `le prompt impose encore ${quoi} : il décrit une personne précise`);
  }
});

test('le différenciateur est cherché dans le CV, pas énoncé d\'avance', () => {
  const p = construirePrompt({ titre: 'Juriste', description: 'x' }, null, 'CV');
  assert.match(p, /POURQUOI MOI ET PAS UN AUTRE/,
    'le paragraphe pivot doit rester imposé');
  assert.match(p, /rep[èe]re dans le CV|dans le CV.{0,60}traits|traits qui distinguent/i,
    'le modèle doit déduire le différenciateur du CV fourni');
});

// « Meilleure adaptation à l'offre » : le modèle doit d'abord dépouiller
// l'annonce, pas plaquer une lettre type sur n'importe quel poste.
test('le prompt impose de partir des exigences de l\'annonce', () => {
  const p = construirePrompt(
    { titre: 'Chef de projet', description: 'Instruction des autorisations d\'urbanisme.' },
    null, 'CV');
  assert.ok(p.includes('Instruction des autorisations d\'urbanisme.'),
    'la description de l\'offre doit être transmise en entier');
  assert.match(p, /exigence/i);
});

// La moitié des offres vient désormais de la fonction publique : une lettre
// qui ignore le statut, la catégorie ou le versant sonne hors sujet.
test('le prompt prévoit le cas d\'une offre de la fonction publique', () => {
  const p = construirePrompt({ titre: 'Attaché', description: 'x' }, null, 'CV');
  assert.match(p, /fonction publique/i);
});

/**
 * LE PIÈGE QUI A COÛTÉ LES PREMIÈRES LETTRES.
 *
 * Elles prêtaient au candidat une expertise agronomique que ni son CV ni son
 * diplôme ne portaient, au seul motif qu'il travaillait sur des projets
 * agrivoltaïques. Travailler DANS un domaine ne rend expert d'AUCUNE de ses
 * disciplines techniques — et l'affirmation s'effondre à la première question
 * en entretien.
 *
 * La règle vaut pour tout le monde, pas seulement pour ce parcours-là : un
 * chef de projet en santé n'est pas médecin. Le prompt doit donc énoncer la
 * FRONTIÈRE, et laisser le CV dire où elle passe.
 */
test('le prompt distingue le secteur d\'exercice du métier exercé', () => {
  const p = construirePrompt({ titre: 'Chef de projet', description: 'x' }, null, 'CV');
  assert.match(p, /secteur/i, 'la notion de secteur doit être posée');
  assert.match(p, /n['’]est pas une compétence technique|pas expert|rend expert d['’]AUCUNE/i,
    'le prompt doit dire que le secteur ne donne pas les compétences techniques du secteur');
  assert.match(p, /frontière/i,
    'le modèle doit chercher où passe la limite dans le CV, plutôt que se la voir dicter');
});

/** Le CV est la seule source : rien ne s'ajoute, même si l'offre le réclame. */
test('le prompt interdit tout diplôme ou compétence absent du CV', () => {
  const p = construirePrompt({ titre: 'Juriste', description: 'x' }, null, 'CV');
  assert.match(p, /SEULE source|N['’]INVENTE JAMAIS/,
    'le CV doit être désigné comme seule source');
  assert.match(p, /même si l['’]offre les réclame|même si cela rendrait/i,
    'la tentation la plus forte — coller à l\'offre — doit être nommée');
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
    { nom: 'Camille Durand', email: 'b@exemple.fr', tel: '06 00 00 00 00', ville: 'Nancy' }
  );

  // Signature ZIP : un .docx est une archive.
  assert.equal(buffer[0], 0x50);
  assert.equal(buffer[1], 0x4b);
  assert.ok(buffer.length > 3000, 'le document doit contenir du texte');

  const brut = buffer.toString('latin1');
  assert.ok(brut.includes('word/document.xml'), 'structure Word attendue');
});
