import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estDansZonePrioritaire } from '../scripts/collect.js';

const profil = JSON.parse(readFileSync(new URL('../profile/profile.json', import.meta.url), 'utf8'));
const VILLES = profil.villesPrioritaires;

const dansLaZone = (offre) => estDansZonePrioritaire(offre, VILLES);

test('reconnaît une ville prioritaire nommée directement', () => {
  assert.ok(dansLaZone({ ville: 'Strasbourg' }));
  assert.ok(dansLaZone({ ville: 'NANCY', zone: '54 - NANCY' }));
  assert.ok(dansLaZone({ ville: 'Paris' }));
  assert.ok(dansLaZone({ ville: 'Lyon' }));
});

// Régressions observées lors de la première collecte réelle : ces deux offres
// étaient marquées « hors zone » alors qu'elles sont en Île-de-France.
test('reconnaît un département renvoyé à la place d\'une commune', () => {
  assert.ok(dansLaZone({ ville: 'Hauts-de-Seine', zone: 'France, Ile-de-France, Hauts-de-Seine' }),
    'Hauts-de-Seine est limitrophe de Paris');
});

test('reconnaît une commune de banlieue via la hiérarchie géographique', () => {
  assert.ok(dansLaZone({
    ville: 'Dammartin-en-Goele',
    zone: 'France, Ile-de-France, Seine-et-Marne, Dammartin-en-Goele',
  }), 'commune inconnue, mais la zone porte « Seine-et-Marne »');
});

test('reconnaît la zone via un code postal', () => {
  assert.ok(dansLaZone({ ville: 'Benfeld', codePostal: '67230' }), 'Bas-Rhin');
  assert.ok(dansLaZone({ ville: 'Ecrouves', codePostal: '54200' }), 'Meurthe-et-Moselle');
});

test('reconnaît la zone via un libellé « 54 - COMMUNE »', () => {
  assert.ok(dansLaZone({ ville: 'TOUL', zone: '54 - TOUL' }));
});

test('classe bien hors zone ce qui est réellement éloigné', () => {
  assert.equal(dansLaZone({ ville: 'Bordeaux', zone: 'France, Nouvelle-Aquitaine, Gironde, Bordeaux' }), false);
  assert.equal(dansLaZone({ ville: 'Courchevel', codePostal: '73120' }), false);
  assert.equal(dansLaZone({ ville: 'Fuveau', zone: 'France, Provence-Alpes-Cote d Azur, Bouches-du-Rhone' }), false);
  assert.equal(dansLaZone({ ville: 'La Seyne-sur-Mer', codePostal: '83500' }), false);
});

test('une localisation vide n\'est jamais considérée dans la zone', () => {
  assert.equal(dansLaZone({ ville: '', zone: '' }), false);
  assert.equal(dansLaZone({}), false);
});
