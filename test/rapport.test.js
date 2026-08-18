// LE BILAN HEBDOMADAIRE, en données.
//
// La mise en page vit dans une fenêtre d'impression, intestable en node ;
// mais le TRI de la semaine, lui, peut se tromper — et c'est ce qu'on
// verrouille. La fenêtre calendaire est le lundi → dimanche de la semaine en
// cours, pas « les 7 derniers jours » : un bilan du vendredi et un du lundi
// suivant ne doivent pas se recouvrir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bilanHebdo, lundiDe } from '../public/rapport.js';

test('lundiDe ramène au lundi, dimanche compris', () => {
  assert.equal(lundiDe('2026-08-19'), '2026-08-17', 'mercredi → lundi de la semaine');
  assert.equal(lundiDe('2026-08-17'), '2026-08-17', 'un lundi reste lui-même');
  assert.equal(lundiDe('2026-08-23'), '2026-08-17', 'dimanche → le lundi précédent, pas le suivant');
});

const offre = (o) => ({
  titre: o.titre ?? 'X', entreprise: 'E', ville: 'Nancy', groupe: o.groupe ?? 1,
  score: o.score ?? 5, vueLe: o.vueLe ?? null,
  suivi: { status: o.status ?? 'À postuler', sent: o.sent ?? '', relance: o.relance ?? '',
    entretien: o.entretien ?? null, pinned: o.pinned ?? false },
});

test('la semaine ne retient que ce qui tombe entre lundi et dimanche', () => {
  const auj = '2026-08-19'; // mercredi ; semaine 17→23 août
  const offres = [
    offre({ titre: 'collectée cette semaine', vueLe: '2026-08-18' }),
    offre({ titre: 'collectée la semaine passée', vueLe: '2026-08-14' }),
    offre({ titre: 'envoyée cette semaine', status: 'Envoyé', sent: '2026-08-17' }),
    offre({ titre: 'envoyée avant', status: 'Envoyé', sent: '2026-08-10' }),
    offre({ titre: 'relance due', status: 'Envoyé', sent: '2026-08-01', relance: '2026-08-18' }),
    offre({ titre: 'relance future', status: 'Envoyé', sent: '2026-08-15', relance: '2026-08-25' }),
    offre({ titre: 'entretien à venir', status: 'Entretien', entretien: '2026-08-24' }),
    offre({ titre: 'entretien passé', status: 'Entretien', entretien: '2026-08-01' }),
  ];
  const b = bilanHebdo(offres, auj);

  assert.equal(b.lundi, '2026-08-17');
  assert.equal(b.dimanche, '2026-08-23');
  assert.deepEqual(b.collectees.map(o => o.titre), ['collectée cette semaine']);
  assert.deepEqual(b.envoyeesSemaine.map(o => o.titre), ['envoyée cette semaine']);
  assert.deepEqual(b.relancesDues.map(o => o.titre), ['relance due'],
    'une relance future n\'est pas due ; une relance passée l\'est');
  assert.deepEqual(b.entretiensAVenir.map(o => o.titre), ['entretien à venir'],
    'un entretien passé n\'est pas « à venir »');
});

test('les prioritaires à traiter sont les mieux notées, non postulées', () => {
  const offres = [
    offre({ titre: 'top', groupe: 1, score: 12, status: 'À postuler' }),
    offre({ titre: 'moyen', groupe: 1, score: 6, status: 'À postuler' }),
    offre({ titre: 'déjà envoyée', groupe: 1, score: 20, status: 'Envoyé' }),
    offre({ titre: 'groupe 2', groupe: 2, score: 30, status: 'À postuler' }),
  ];
  const b = bilanHebdo(offres, '2026-08-19');
  assert.deepEqual(b.prioritaires.map(o => o.titre), ['top', 'moyen'],
    'seulement le groupe 1 non postulé, du mieux noté au moins');
});
