import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  estConfigure, departementDe, construireProfil, rendreEnv, CLES_ENV, chargerProfil,
} from '../src/configuration.js';
import { VILLES_MAX } from '../src/villes.js';

const REPONSES = {
  nom: 'Camille Durand',
  villeCandidat: 'Nantes',
  intitules: ['énergies renouvelables', 'chef de projet'],
  villes: [{ nom: 'Nantes', codePostal: '44000' }, { nom: 'Rennes', codePostal: '35000' }],
};

/**
 * LE PIÈGE QUE CE TEST EXISTE POUR ATTRAPER.
 *
 * `profile.example.json` est un fichier valide : il a des intitulés, des
 * villes, un scoring complet. Le prendre pour une configuration ferait lancer
 * des collectes sur « intitulé de poste 1 » — des requêtes réelles, du quota
 * dépensé, et aucune offre. L'assistant doit donc s'ouvrir malgré tout.
 */
test('le fichier d\'exemple n\'est pas pris pour une configuration', () => {
  const exemple = JSON.parse(readFileSync(new URL('../profile/profile.example.json', import.meta.url), 'utf8'));
  assert.equal(estConfigure(exemple), false);
});

test('un profil réel est reconnu comme configuré', () => {
  assert.equal(estConfigure(construireProfil(REPONSES)), true);
  assert.equal(estConfigure(null), false);
  assert.equal(estConfigure({}), false);
  assert.equal(estConfigure({ intitules: ['juriste'], villesPrioritaires: [] }), false,
    'des intitulés sans ville ne suffisent pas');
});

test('le département se déduit du code postal', () => {
  assert.equal(departementDe('44000'), '44');
  assert.equal(departementDe('Nantes 44000'), '44');
  assert.equal(departementDe('75008'), '75');
  assert.equal(departementDe(''), null);
  assert.equal(departementDe('abc'), null);
  // La Corse se découpe en 2A et 2B ; « 20 » n'existe pas comme département.
  // On ne devine pas laquelle plutôt que d'en inscrire un faux.
  assert.equal(departementDe('20000'), '2A');
});

test('les intitulés deviennent les premiers motifs positifs', () => {
  const p = construireProfil(REPONSES);
  assert.deepEqual(p.scoring.positifs.map(x => x.motif), ['energies renouvelables', 'chef de projet']);
  assert.ok(p.scoring.positifs.every(x => x.poids === 3));
});

/**
 * Chaque intitulé est interrogé pour chaque ville ET en national, sur chaque
 * source. Sans plafond, une liste de vingt métiers épuiserait les quotas
 * gratuits dès la première collecte — et l'utilisateur conclurait que l'outil
 * ne marche pas.
 */
test('le nombre d\'intitulés et de villes est plafonné', () => {
  const p = construireProfil({
    ...REPONSES,
    intitules: Array.from({ length: 12 }, (_, i) => 'metier ' + i),
    villes: Array.from({ length: 9 }, (_, i) => ({ nom: 'Ville' + i, codePostal: '4400' + (i % 10) })),
  });
  assert.equal(p.intitules.length, 6);
  // Le plafond des villes est celui de `villes.js` : l'assistant et l'éditeur
  // des Options écrivent le même fichier, et deux limites différentes
  // laisseraient l'un accepter ce que l'autre refuse.
  assert.ok(p.villesPrioritaires.length <= VILLES_MAX);
});

test('une ville sans code postal lisible est ignorée plutôt qu\'inventée', () => {
  const p = construireProfil({ ...REPONSES, villes: [
    { nom: 'Nantes', codePostal: '44000' },
    { nom: 'Quelque part', codePostal: '' },
  ] });
  assert.deepEqual(p.villesPrioritaires.map(v => v.nom), ['Nantes']);
});

test('le nettoyage automatique est éteint au départ', () => {
  // Une suppression est irrécupérable : personne ne devrait la découvrir le
  // premier jour, sur un profil qu'il n'a pas encore ajusté.
  assert.equal(construireProfil(REPONSES).nettoyageAutomatique, false);
});

/**
 * L'INJECTION QUE CE TEST FERME.
 *
 * Un retour à la ligne dans une valeur permettrait d'écrire une variable
 * supplémentaire depuis un champ de formulaire — un chemin de base de
 * données, un mot de passe, une adresse d'écoute publique.
 */
test('une clé ne peut pas écrire une seconde variable', () => {
  const env = rendreEnv({ GEMINI_API_KEY: 'abc\nCOCKPIT_MOT_DE_PASSE=vole\nHOST=0.0.0.0' });
  const lignes = env.split('\n').filter(l => l && !l.startsWith('#'));
  const posees = lignes.map(l => l.split('=')[0]);
  assert.deepEqual(posees, CLES_ENV, 'aucune variable en plus de celles prévues');
  assert.ok(env.includes('GEMINI_API_KEY=abc COCKPIT_MOT_DE_PASSE=vole HOST=0.0.0.0'),
    'la valeur est aplatie sur une seule ligne, donc inoffensive');
});

test('les clés absentes restent vides, sans casser le fichier', () => {
  const env = rendreEnv({ GEMINI_API_KEY: 'xyz' });
  assert.ok(env.includes('GEMINI_API_KEY=xyz'));
  assert.ok(env.includes('ADZUNA_APP_ID='));
  assert.ok(env.includes('# COCKPIT_MOT_DE_PASSE='),
    'le mot de passe est proposé en commentaire, pas activé à l\'insu de l\'utilisateur');
});

/**
 * LE PREMIER DOUBLE-CLIC.
 *
 * Le serveur lisait `profile/profile.json` sans filet. Quelqu'un qui
 * télécharge l'application et double-clique n'en a pas : il mourait donc
 * avant d'avoir servi le moindre octet, sur une trace d'erreur Node.
 *
 * L'assistant existait pourtant — page, garde-fou, redirection — mais rien ne
 * tenait debout assez longtemps pour le montrer. Toute la promesse « clé en
 * main » s'arrêtait là, et personne n'aurait su pourquoi.
 *
 * Ces trois cas sont ceux d'un dossier fraîchement décompressé, d'une
 * installation normale, et d'un fichier abîmé.
 */
test('l\'application démarre sans profil, comme au premier double-clic', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'cockpit-neuf-'));
  const { profil, erreur } = chargerProfil(dossier);
  assert.equal(erreur, null, 'un dossier sans profil est un cas NORMAL, pas une panne');
  assert.deepEqual(profil, {});
  assert.equal(estConfigure(profil), false,
    'un profil vide doit envoyer vers l\'assistant, pas ouvrir un tableau de bord vide');
  rmSync(dossier, { recursive: true, force: true });
});

test('sans profil, on repart de l\'exemple — qui mène à l\'assistant', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'cockpit-neuf-'));
  mkdirSync(join(dossier, 'profile'));
  writeFileSync(join(dossier, 'profile/profile.example.json'),
    JSON.stringify({ intitules: ['intitulé de poste 1'], villesPrioritaires: [{ nom: 'Strasbourg' }] }));

  const { profil, erreur } = chargerProfil(dossier);
  assert.equal(erreur, null);
  assert.deepEqual(profil.intitules, ['intitulé de poste 1']);
  assert.equal(estConfigure(profil), false,
    'l\'exemple est syntaxiquement valide : le prendre pour une configuration ferait '
    + 'collecter sur « intitulé de poste 1 »');
  rmSync(dossier, { recursive: true, force: true });
});

test('un profil abîmé est signalé, jamais remplacé en douce', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'cockpit-casse-'));
  mkdirSync(join(dossier, 'profile'));
  writeFileSync(join(dossier, 'profile/profile.json'), '{ ceci n\'est pas du JSON');
  writeFileSync(join(dossier, 'profile/profile.example.json'), '{}');

  const { erreur } = chargerProfil(dossier);
  assert.ok(erreur, 'repartir sur l\'exemble en silence ferait perdre ses réglages '
    + 'sans que rien ne l\'explique');
  assert.match(erreur.chemin, /profile\.json$/);
  rmSync(dossier, { recursive: true, force: true });
});
