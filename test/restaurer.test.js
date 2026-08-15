import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirBase, upsertOffre, supprimerOffres, restaurerRejet, idsRejetes } from '../src/db.js';

const OFFRE = {
  id: 'x1', source: 'france-travail', sourcesAll: ['france-travail'], externalId: 'ft-1',
  titre: 'Chef de projet EnR', entreprise: 'ACME', ville: 'Strasbourg', departement: '67',
  horsZone: 0, contrat: 'CDI', dateOffre: '2026-08-01', lien: 'https://exemple.fr',
  description: 'Une description.', salaireSource: null, groupe: 1, score: 12,
  scoreDetail: null, analysisJson: null, isManual: 0,
};

function baseAvecOffre() {
  const db = ouvrirBase(':memory:');
  upsertOffre(db, OFFRE);
  return db;
}

/**
 * CE QUE CETTE FONCTIONNALITÉ EXISTE POUR RÉPARER.
 *
 * Écarter se fait en un clic ; se tromper aussi. La seule issue était « Tout
 * remettre » dans les Options — qui ramène les milliers d'offres du ménage
 * automatique avec la seule qu'on visait. Autant dire aucune issue.
 */
test('une offre écartée à la main se remet exactement où elle était', () => {
  const db = baseAvecOffre();
  db.prepare(`INSERT INTO tracking (offer_id, status, notes) VALUES (?, ?, ?)`)
    .run('x1', 'Envoyé', 'Relancer le 15');
  db.prepare(`INSERT INTO letters (offer_id, content, generated_at) VALUES (?, ?, ?)`)
    .run('x1', 'Madame, Monsieur…', '2026-08-01T10:00:00Z');

  supprimerOffres(db, ['x1'], 'manuel');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM offers').get().n, 0);
  assert.ok(idsRejetes(db).has('x1'), 'elle est bien écartée des collectes');

  assert.equal(restaurerRejet(db, 'x1'), true);

  const remise = db.prepare('SELECT * FROM offers WHERE id = ?').get('x1');
  assert.equal(remise.titre, 'Chef de projet EnR');
  assert.equal(remise.score, 12);
  // Le suivi et la lettre reviennent avec : sans eux, « remettre » rendrait
  // une coquille et le travail fait resterait perdu.
  assert.equal(db.prepare('SELECT status FROM tracking WHERE offer_id = ?').get('x1').status, 'Envoyé');
  assert.equal(db.prepare('SELECT notes FROM tracking WHERE offer_id = ?').get('x1').notes, 'Relancer le 15');
  assert.ok(db.prepare('SELECT content FROM letters WHERE offer_id = ?').get('x1').content.startsWith('Madame'));
  // Et elle redevient collectable.
  assert.equal(idsRejetes(db).has('x1'), false);
  db.close();
});

/**
 * LA LIMITE, ASSUMÉE ET TESTÉE.
 *
 * Les suppressions automatiques portent sur des milliers d'offres : garder
 * une copie de chacune ferait grossir la base sans jamais servir, personne ne
 * cherchant à annuler un ménage qu'il n'a pas demandé. Ces rejets-là ne sont
 * donc pas restaurables, et la fonction le dit au lieu de prétendre réussir.
 */
test('un rejet automatique n\'est pas restaurable, et le dit', () => {
  const db = baseAvecOffre();
  supprimerOffres(db, ['x1'], 'hors-profil');

  assert.equal(restaurerRejet(db, 'x1'), false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM offers').get().n, 0,
    'rien n\'est inventé quand il n\'y a rien à restaurer');
  db.close();
});

test('restaurer une offre inconnue échoue proprement', () => {
  const db = ouvrirBase(':memory:');
  assert.equal(restaurerRejet(db, 'jamais-vue'), false);
  db.close();
});

/** Une offre sans suivi ni lettre se remet aussi, sans rien fabriquer. */
test('une offre nue se remet sans suivi ni lettre inventés', () => {
  const db = baseAvecOffre();
  supprimerOffres(db, ['x1'], 'manuel');
  assert.equal(restaurerRejet(db, 'x1'), true);

  assert.equal(db.prepare('SELECT COUNT(*) n FROM tracking').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM letters').get().n, 0);
  db.close();
});
