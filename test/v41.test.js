// LA 4.1 — CE QUI SE CALCULE.
//
// Le tri éclair, l'agenda refait et les titres remis en casse lisible ont
// chacun un écran qu'on ne teste pas sans navigateur. Mais chacun repose sur
// un calcul pur : quelle offre entre dans la file et dans quel ordre, ce que
// veut dire un glissement de 90 px, dans quelle section tombe une relance,
// ce que vaut « Mensuel de 2700.0 Euros à 2900.0 Euros ». Ce fichier fige ces
// calculs — ce sont eux qui feraient mentir l'écran en silence.
process.env.TZ = 'Europe/Paris';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  titreLisible, nomLisible, lireSalaire, salaireCourt, salaireAnnuel, contratLisible, enLigne,
} = await import('../public/format.js');
const { fileDeTri, decisionDuGeste, bilanDuTri, dureeLisible } = await import('../public/tri.js');
const { echeances, sectionsAgenda } = await import('../public/render.js');
const { envoyeesAujourdhui } = await import('../public/selection.js');

// ─────────────────────────────────────────────── les capitales qui crient

test('un titre tout en capitales passe en casse de phrase, sigles et H/F debout', () => {
  assert.equal(titreLisible('CHARGE DE PROJET URBAIN ET URBANISME OPERATIONNEL (H/F)'),
    'Chargé de projet urbain et urbanisme opérationnel (H/F)');
  assert.equal(titreLisible('CHEF DE PROJET : ÉNERGIES RENOUVELABLES & ADAPTATION AU CHANGEMENT CLIMATIQUE F/H'),
    'Chef de projet : énergies renouvelables & adaptation au changement climatique F/H');
  assert.equal(titreLisible("CHARGE D'ETUDES TECHNIQUES ENR H/F"), "Chargé d'études techniques ENR H/F");
  assert.equal(titreLisible('CHARGE DE MISSION PLUI ET SIG'), 'Chargé de mission PLUi et SIG');
  assert.equal(titreLisible('CHARGE(E) DE PROJET RESSOURCE EN EAU'), 'Chargé(e) de projet ressource en eau');
  assert.equal(titreLisible('CHEF-FE DE PROJET MOA'), 'Chef-fe de projet MOA');
});

test('les accents perdus avec les capitales reviennent, sans deviner les mots ambigus', () => {
  assert.equal(titreLisible("CHARGE D'ETUDES EN AMENAGEMENT ET PLANIFICATION (H/F)"),
    "Chargé d'études en aménagement et planification (H/F)");
  assert.equal(titreLisible('MANOEUVRE EN PHOTOVOLTAIQUE H/F'), 'Manœuvre en photovoltaïque H/F');
  // « charge » hors de « chargé de » reste tel quel.
  assert.equal(titreLisible('RESPONSABLE PRISE EN CHARGE CLIENTS'), 'Responsable prise en charge clients');
});

test('un titre correctement saisi n\'est jamais touché', () => {
  for (const t of ['Chargé de projet PLUi-H (H/F)', 'Asset Manager EnR F/H', 'Chef de Projet Irve H/F', 'RH', '']) {
    assert.equal(titreLisible(t), t);
  }
});

test('les noms propres connus gardent leur majuscule dans un titre remis en minuscules', () => {
  assert.equal(
    titreLisible('CHARGÉ-CHARGÉE DE MISSION STRASBOURG CAPITALE EUROPÉENNE', ['Strasbourg', 'Eurometropole de Strasbourg']),
    'Chargé-chargée de mission Strasbourg capitale européenne');
});

test('un employeur ou une ville en capitales passe en casse de nom', () => {
  assert.equal(nomLisible('COMMUNAUTE DE COMMUNES DU PAYS DE MAURIAC'), 'Communauté de Communes du Pays de Mauriac');
  assert.equal(nomLisible('PONTICELLI FRERES'), 'Ponticelli Frères');
  assert.equal(nomLisible('MAIRIE DE VIC-EN-BIGORRE'), 'Mairie de Vic-en-Bigorre');
  assert.equal(nomLisible("CHAMBRE D'AGRICULTURE DE L'YONNE"), "Chambre d'Agriculture de l'Yonne");
  assert.equal(nomLisible('LA COMMUNE DE MARSEILLE'), 'La Commune de Marseille');
  assert.equal(nomLisible('ALENCON'), 'Alencon');
  // Les sigles et les mots très courts restent debout.
  assert.equal(nomLisible('ADEIS RH'), 'Adeis RH');
  assert.equal(nomLisible('CA ARCHE AGGLO'), 'CA Arche Agglo');
  assert.equal(nomLisible('CRIT STRASBOURG BTP'), 'Crit Strasbourg BTP');
  assert.equal(nomLisible('A2P SCHILTIGHEIM'), 'A2P Schiltigheim');
  assert.equal(nomLisible('PARIS SP 07'), 'Paris SP 07');
});

test('un nom déjà en casse normale, ou trop court pour en juger, est rendu tel quel', () => {
  for (const n of ['Mairie de ATHIS-MONS', 'Crit', 'CA Mont Saint-Michel - Normandie', 'EDF', 'RTE', '', "L'industrie recrute"]) {
    assert.equal(nomLisible(n), n);
  }
  assert.equal(nomLisible(null), '');
});

// ─────────────────────────────────────────────────────────── le salaire

test('chaque façon d\'annoncer un salaire se lit', () => {
  assert.deepEqual(lireSalaire('38000 – 42000 € brut annuel'), { min: 38000, max: 42000, periode: 'an' });
  assert.deepEqual(lireSalaire('50k € a 55k €/an'), { min: 50000, max: 55000, periode: 'an' });
  assert.deepEqual(lireSalaire('Mensuel de 2700.0 Euros à 2900.0 Euros'), { min: 2700, max: 2900, periode: 'mois' });
  assert.deepEqual(lireSalaire('Horaire de 15.0 Euros'), { min: 15, max: 15, periode: 'h' });
  assert.deepEqual(lireSalaire('Annuel de 45000.0 Euros à 55000.0 Euros - 45-55k€ selon profil et expérience'),
    { min: 45000, max: 55000, periode: 'an' });
  assert.deepEqual(lireSalaire('36 000 – 44 000 € brut annuel'), { min: 36000, max: 44000, periode: 'an' });
  assert.equal(lireSalaire('Selon profil'), null);
  assert.equal(lireSalaire(null), null);
});

test('un « mensuel » de 26 000 € est une saisie annuelle rangée dans la mauvaise case', () => {
  assert.deepEqual(lireSalaire('Mensuel de 26000.0 Euros à 30000.0 Euros'), { min: 26000, max: 30000, periode: 'an' });
});

test('le salaire s\'écrit court, dans l\'unité où on le compare', () => {
  assert.equal(salaireCourt('38000 – 42000 € brut annuel'), '38–42 k€/an');
  assert.equal(salaireCourt('50000 – 50000 € brut annuel'), '50 k€/an');
  assert.equal(salaireCourt('45k €/an'), '45 k€/an');
  assert.equal(salaireCourt('Annuel de 37500.0 Euros'), '37,5 k€/an');
  assert.equal(salaireCourt('Mensuel de 2700.0 Euros à 2900.0 Euros'), '2 700–2 900 €/mois');
  assert.equal(salaireCourt('Mensuel de 1867.02 Euros - Grille FPT + IFSE'), '1 867 €/mois');
  assert.equal(salaireCourt('Horaire de 15.0 Euros'), '15 €/h');
  assert.equal(salaireCourt(''), '');
  assert.equal(salaireCourt('à négocier'), '');
});

test('le salaire se ramène à l\'année pour trier, et vaut null quand rien n\'est annoncé', () => {
  assert.equal(salaireAnnuel('38000 – 42000 € brut annuel'), 40000);
  assert.equal(salaireAnnuel('Mensuel de 2700.0 Euros à 2900.0 Euros'), 33600);
  assert.equal(salaireAnnuel('Horaire de 15.0 Euros'), 24105);
  assert.equal(salaireAnnuel(''), null);
});

test('les contrats codés se lisent, et les morceaux vides ne laissent pas de « · · »', () => {
  assert.equal(contratLisible('MIS'), 'Intérim');
  assert.equal(contratLisible('CDI'), 'CDI');
  assert.equal(contratLisible(null), '');
  assert.equal(enLigne('', 'Montreuil', null, 'publiée il y a 12 j'), 'Montreuil · publiée il y a 12 j');
  assert.equal(enLigne('', '  ', undefined), '');
});

// ──────────────────────────────────────────────────────── le tri éclair

const offre = (id, plus = {}) => ({
  id, titre: 'Poste ' + id, groupe: 1, score: 5, dateOffre: '2026-11-20', isManual: false,
  ...plus, suivi: { status: 'À postuler', pinned: false, ...(plus.suivi ?? {}) },
});

test('la file de tri ne prend que les offres sans décision', () => {
  const file = fileDeTri([
    offre('a'),
    offre('b', { suivi: { status: 'Envoyé' } }),
    offre('c', { suivi: { pinned: true } }),
    offre('d', { isManual: true }),
    offre('e', { suivi: { status: 'Refus' } }),
  ]);
  assert.deepEqual(file.map(o => o.id), ['a']);
  assert.deepEqual(fileDeTri(null), []);
});

test('la file présente les meilleures d\'abord : groupe, puis score, puis fraîcheur', () => {
  const file = fileDeTri([
    offre('possible', { groupe: 2, score: 12 }),
    offre('a-ecarter', { groupe: 3, score: 9 }),
    offre('prio-faible', { groupe: 1, score: 3 }),
    offre('prio-forte', { groupe: 1, score: 11 }),
    offre('a-verifier', { groupe: 0, score: 20 }),
    offre('prio-forte-fraiche', { groupe: 1, score: 11, dateOffre: new Date().toISOString() }),
  ]);
  assert.deepEqual(file.map(o => o.id),
    ['prio-forte-fraiche', 'prio-forte', 'prio-faible', 'possible', 'a-verifier', 'a-ecarter']);
});

test('une offre remise à plus tard repasse en fin de file, la plus ancienne d\'abord', () => {
  const offres = [offre('a', { score: 12 }), offre('b', { score: 9 }), offre('c', { score: 2 })];
  const file = fileDeTri(offres, { passees: { a: 2000, b: 1000 } });
  assert.deepEqual(file.map(o => o.id), ['c', 'b', 'a']);
  // Le tri ne modifie pas la liste qu'on lui confie.
  assert.deepEqual(offres.map(o => o.id), ['a', 'b', 'c']);
});

test('un glissement ne décide que franchement, et le seuil suit la largeur de la carte', () => {
  assert.equal(decisionDuGeste(150, 10, 860), 'garder');
  assert.equal(decisionDuGeste(-150, -20, 860), 'ecarter');
  assert.equal(decisionDuGeste(90, 0, 860), null, '90 px sur une carte large : pas encore');
  assert.equal(decisionDuGeste(90, 0, 340), 'garder', 'sur un téléphone, 90 px sont déjà francs');
  assert.equal(decisionDuGeste(-50, 0, 200), null, 'le seuil ne descend pas sous 60 px');
  assert.equal(decisionDuGeste(20, 200, 860), 'passer');
  assert.equal(decisionDuGeste(160, 200, 860), null, 'en diagonale vers le bas : on ne devine pas');
  assert.equal(decisionDuGeste(0, 0, 860), null);
});

test('le bilan compte chaque décision une fois', () => {
  assert.deepEqual(bilanDuTri([{ type: 'garder' }, { type: 'ecarter' }, { type: 'ecarter' }, { type: 'passer' }]),
    { gardees: 1, ecartees: 2, passees: 1, total: 4 });
  assert.deepEqual(bilanDuTri([]), { gardees: 0, ecartees: 0, passees: 0, total: 0 });
  assert.equal(dureeLisible(45_000), '45 s');
  assert.equal(dureeLisible(200_000), '3 min 20');
  assert.equal(dureeLisible(120_000), '2 min');
});

// ──────────────────────────────────────────────────────────── l'agenda

const suivie = (id, suivi) => ({ id, titre: 'Poste ' + id, entreprise: 'Atyx', suivi: { status: 'Envoyé', ...suivi } });
const JOUR = '2026-11-27';

test('l\'agenda réunit relances, entretiens et envois, dans l\'ordre des dates', () => {
  const items = echeances([
    suivie('a', { sent: '2026-11-11', relance: '2026-11-18' }),
    suivie('b', { sent: '2026-11-20', relance: '2026-11-30', entretien: '2026-11-30' }),
    suivie('c', { status: 'À postuler' }),
  ], JOUR);
  assert.deepEqual(items.map(i => `${i.date} ${i.type} ${i.offre.id}`), [
    '2026-11-11 envoi a', '2026-11-18 relance a', '2026-11-20 envoi b',
    '2026-11-30 entretien b', '2026-11-30 relance b',
  ]);
  assert.equal(items.find(i => i.type === 'relance' && i.offre.id === 'a').retard, true);
  assert.equal(items.find(i => i.type === 'relance' && i.offre.id === 'b').retard, false);
});

test('un refus retire relance et entretien de l\'agenda ; un entretien décroché retire la relance', () => {
  const items = echeances([
    suivie('refus', { status: 'Refus', sent: '2026-11-01', relance: '2026-11-08', entretien: '2026-11-12' }),
    suivie('entretien', { status: 'Entretien', sent: '2026-11-02', relance: '2026-11-09', entretien: '2026-12-02' }),
  ], JOUR);
  assert.deepEqual(items.map(i => `${i.type} ${i.offre.id}`).sort(),
    ['entretien entretien', 'envoi entretien', 'envoi refus']);
});

test('les échéances à traiter se rangent en retard, aujourd\'hui, sous sept jours, plus tard', () => {
  const items = echeances([
    suivie('retard', { relance: '2026-11-18' }),
    suivie('jour', { relance: JOUR }),
    suivie('semaine', { relance: '2026-12-04' }),
    suivie('apres', { relance: '2026-12-05' }),
    suivie('entretien-passe', { entretien: '2026-11-20' }),
    suivie('envoi-seul', { sent: '2026-11-25' }),
  ], JOUR);
  const sections = sectionsAgenda(items, JOUR);
  assert.deepEqual(sections.map(s => [s.cle, s.items.map(i => i.offre.id)]), [
    ['retard', ['retard']], ['jour', ['jour']], ['semaine', ['semaine']], ['apres', ['apres']],
  ]);
  assert.deepEqual(sectionsAgenda([], JOUR), []);
});

// ─────────────────────────────────────────────── ce qui a été corrigé

test('« envoyées aujourd\'hui » compte en heure locale, pas en UTC', () => {
  // 0 h 30 à Paris le 28 novembre : encore le 27 en UTC.
  const vraiDate = Date;
  const fige = new vraiDate('2026-11-27T23:30:00Z');
  globalThis.Date = class extends vraiDate {
    constructor(...a) { super(...(a.length ? a : [fige.getTime()])); }
    static now() { return fige.getTime(); }
  };
  try {
    assert.equal(envoyeesAujourdhui([{ suivi: { sent: '2026-11-28' } }, { suivi: { sent: '2026-11-27' } }]), 1);
  } finally { globalThis.Date = vraiDate; }
});

// ──────────────────────────────────────────────── le câblage, vérifié

const lire = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');

test('le tri éclair a ses trois portes : bouton, palette et touche Z', () => {
  const html = lire('index.html');
  assert.match(html, /id="triBtn"/);
  assert.match(html, /id="triBtnDash"/);
  assert.match(lire('app.js'), /id: 'a-tri'/);
  assert.match(lire('clavier.js'), /case 'z':[\s\S]{0,80}ouvrirTri/);
  // L'aide clavier ne ment pas : chaque touche annoncée est branchée.
  assert.match(html, /Tri éclair<\/span><span><span class="kbd">Z<\/span>/);
});

test('`hidden` cache toujours : aucune classe ne peut ré-afficher un élément caché', () => {
  assert.match(lire('ui.css'), /\[hidden\]\{display:none !important;\}/);
});

test('la grille du mois ne peut plus déborder : ses colonnes acceptent de rétrécir', () => {
  assert.match(lire('tableau.css'), /\.mois\{grid-template-columns:repeat\(7,minmax\(0,1fr\)\);\}/);
});
