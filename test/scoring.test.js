import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scorer } from '../src/scoring.js';

const profil = JSON.parse(readFileSync(new URL('../profile/profile.json', import.meta.url), 'utf8'));
const offres = JSON.parse(readFileSync(new URL('./fixtures/offers.json', import.meta.url), 'utf8'));

test('un motif éliminatoire classe directement en groupe 3', () => {
  const r = scorer({ titre: 'Juriste M&A', description: '5 ans en M&A exigés.'.padEnd(250, ' .') }, profil);
  assert.equal(r.groupe, 3);
  assert.ok(r.detail.eliminatoires.length > 0, 'le motif éliminatoire doit être tracé');
});

test('une description trop courte classe en groupe 0 (à vérifier)', () => {
  const r = scorer({ titre: 'Juriste', description: 'Trop court.' }, profil);
  assert.equal(r.groupe, 0);
});

test('score_detail liste les motifs déclenchés (verdict auditable)', () => {
  const r = scorer(offres[0], profil);
  assert.ok(Array.isArray(r.detail.positifs));
  assert.ok(r.detail.positifs.length > 0);
  assert.ok(typeof r.score === 'number');
});

test('« 2 ans d\'expérience » ne déclenche PAS le motif éliminatoire', () => {
  const r = scorer({
    titre: 'Chef de projet EnR',
    description: 'Une première expérience de 2 ans en énergies renouvelables. Développement de projets photovoltaïques et concertation locale avec les collectivités territoriales.'.padEnd(250, ' .')
  }, profil);
  assert.notEqual(r.groupe, 3);
});

// ------------------------------------------- motifs éliminatoires de TITRE

const ANNONCE_ENR = 'Développement de projets photovoltaïques et éoliens, concertation avec les collectivités, autorisation environnementale et suivi réglementaire. Vous travaillerez en lien avec les ressources humaines pour le recrutement de votre équipe, et une alternance pourra être proposée.'.padEnd(300, ' .');

test('un motif de titre écarte quand il est dans l\'intitulé', () => {
  const r = scorer({ titre: 'Assistant de direction (H/F)', description: ANNONCE_ENR }, profil);
  assert.equal(r.groupe, 3);
  assert.ok(r.detail.eliminatoires.length > 0);
});

// La raison d'être de cette seconde liste. Le même motif appliqué au texte
// entier écartait « Chef·fe de projet junior aménagement et énergie », notée
// 12, parce que son annonce mentionnait « alternance » et « ressources
// humaines » en passant.
test('les mêmes mots dans la DESCRIPTION n\'écartent rien', () => {
  const r = scorer({ titre: 'Chef de projet énergies renouvelables (H/F)', description: ANNONCE_ENR }, profil);
  assert.notEqual(r.groupe, 3, 'une bonne offre ne doit pas tomber sur un mot de sa description');
  assert.ok(r.score >= 6, `score attendu élevé, obtenu ${r.score}`);
});

test('un profil sans eliminatoiresTitre continue de fonctionner', () => {
  const sansListe = JSON.parse(JSON.stringify(profil));
  delete sansListe.scoring.eliminatoiresTitre;
  const r = scorer({ titre: 'Assistant de direction', description: ANNONCE_ENR }, sansListe);
  assert.notEqual(r.groupe, 3, 'la liste est optionnelle');
});

// Test de calibrage : le scoring doit reproduire le jugement déjà porté.
test('les 11 offres de référence sont correctement classées', () => {
  const resultats = offres.map(o => ({
    titre: o.titre,
    attendu: o.attendu,
    obtenu: scorer(o, profil).groupe,
  }));

  const exacts = resultats.filter(r => r.obtenu === r.attendu);
  const rang = { 1: 0, 2: 1, 0: 2, 3: 3 };
  const graves = resultats.filter(r => Math.abs(rang[r.obtenu] - rang[r.attendu]) >= 3);

  const rapport = resultats
    .map(r => `${r.obtenu === r.attendu ? 'OK ' : 'KO '} attendu=${r.attendu} obtenu=${r.obtenu}  ${r.titre}`)
    .join('\n');

  assert.equal(graves.length, 0, `Erreur à deux crans détectée :\n${rapport}`);
  assert.ok(exacts.length >= 9, `Seulement ${exacts.length}/11 exacts :\n${rapport}`);
});

// ------------------------------------------------------- ancrage sectoriel

// Une offre peut atteindre 6 points sur la seule fonction : droit public (3)
// + chef de projet (2) + collectivité (1). Sans un mot du secteur, elle ne
// doit pas passer devant une offre qui parle vraiment d'énergie.
test('sans motif de secteur, une offre plafonne à « possible »', () => {
  // Le profil courant durcit la règle (socleObligatoire). Ce test décrit le
  // mode SOUPLE : on le fixe explicitement plutôt que de dépendre du réglage
  // du moment, sinon il raconterait autre chose au prochain ajustement.
  const souple = JSON.parse(JSON.stringify(profil));
  souple.scoring.socleObligatoire = false;

  const r = scorer({
    titre: 'Chef de projet marchés publics',
    description: 'Au sein de la direction, vous pilotez la commande publique en droit public pour le compte de la collectivité, avec rédaction de contrats et veille réglementaire.'.padEnd(300, ' .'),
  }, souple);

  assert.ok(r.score >= souple.scoring.seuils.prioritaire,
    `le score doit dépasser le seuil prioritaire, obtenu ${r.score}`);
  assert.equal(r.groupe, 2, 'mais rester « possible » faute d\'ancrage');
  assert.equal(r.detail.sansSecteur, true, 'et le dire dans le détail');
});

test('un seul mot du secteur suffit à rendre le groupe 1 accessible', () => {
  const r = scorer({
    titre: 'Chef de projet énergies renouvelables',
    description: 'Développement de projets photovoltaïques, concertation avec les collectivités et suivi des autorisations environnementales en droit public.'.padEnd(300, ' .'),
  }, profil);

  assert.equal(r.groupe, 1);
  assert.ok(!r.detail.sansSecteur);
});

test('le socle n\'affecte ni les « possibles » ni les « à écarter »', () => {
  const faible = scorer({
    titre: 'Chef de projet marchés publics',
    description: 'Pilotage de la commande publique pour la collectivité.'.padEnd(300, ' .'),
  }, profil);
  assert.notEqual(faible.groupe, 1);

  const sansSocle = JSON.parse(JSON.stringify(profil));
  sansSocle.scoring.socleSecteur = [];
  const r = scorer({
    titre: 'Chef de projet marchés publics',
    description: 'Au sein de la direction, vous pilotez la commande publique en droit public pour le compte de la collectivité, avec rédaction de contrats et veille réglementaire.'.padEnd(300, ' .'),
  }, sansSocle);
  assert.equal(r.groupe, 1, 'liste vide = règle désactivée');
});

test('socleObligatoire écarte au lieu de rétrograder', () => {
  const dur = JSON.parse(JSON.stringify(profil));
  dur.scoring.socleObligatoire = true;

  const offre = {
    titre: 'Chef de projet marchés publics',
    description: 'Au sein de la direction, vous pilotez la commande publique en droit public pour le compte de la collectivité, avec rédaction de contrats et veille réglementaire.'.padEnd(300, ' .'),
  };

  assert.equal(scorer(offre, dur).groupe, 3, 'sans secteur : écartée');

  const souple = JSON.parse(JSON.stringify(profil));
  souple.scoring.socleObligatoire = false;
  assert.equal(scorer(offre, souple).groupe, 2, 'sans le durcissement : seulement rétrogradée');
});

test('socleObligatoire ne touche pas une offre ancrée dans le secteur', () => {
  const dur = JSON.parse(JSON.stringify(profil));
  dur.scoring.socleObligatoire = true;
  const r = scorer({
    titre: 'Chef de projet énergies renouvelables',
    description: 'Développement de projets photovoltaïques, concertation avec les collectivités et autorisations environnementales.'.padEnd(300, ' .'),
  }, dur);
  assert.equal(r.groupe, 1);
  assert.ok(!r.detail.sansSecteur);
});
