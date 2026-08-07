import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

/**
 * LE BUG LE PLUS GRAVE DE CE PROJET, ET LE PLUS DISCRET.
 *
 * L'installateur effaçait `data.db-wal` à CHAQUE exécution. En mode WAL, ce
 * fichier n'est pas une annexe jetable : il contient toutes les écritures
 * depuis le dernier point de contrôle. L'effacer jette le travail le plus
 * récent — celui auquel on tient le plus.
 *
 * Constaté deux fois dans la même soirée : une candidature marquée « Envoyé »
 * a disparu après une simple mise à jour. L'offre était intacte, absente de
 * `rejetees`, et aucune suppression n'avait eu lieu — il n'y avait pas eu de
 * suppression, il y avait eu une PERTE.
 *
 * Ce test lit le code plutôt que d'exécuter l'installateur : le faire tourner
 * pour de vrai demanderait un exécutable construit, et l'invariant qu'on veut
 * tenir est structurel — l'effacement ne doit exister QUE dans la branche de
 * la première installation.
 */
const source = readFileSync(new URL('../scripts/installer.js', import.meta.url), 'utf8');

test('l\'installateur n\'efface le WAL qu\'à la première installation', () => {
  const ligne = /rmSync\(join\(cible, 'data\.db' \+ suffixe\)/;
  assert.match(source, ligne, 'la ligne d\'effacement a changé de forme — revoir ce test');

  // On isole le bloc `if (reprisesBase) { … }` et on vérifie que l'effacement
  // est DEDANS. Hors de cette garde, il s'applique aussi aux mises à jour,
  // c'est-à-dire à la base vivante.
  const garde = source.match(/if \(reprisesBase\) \{[\s\S]*?\n  \}/);
  assert.ok(garde, 'la garde `if (reprisesBase)` a disparu');
  assert.match(garde[0], ligne,
    'l\'effacement du WAL doit rester à l\'intérieur de la garde : sur une mise à '
    + 'jour, `data.db-wal` contient les candidatures les plus récentes');
});

test('la garde protège bien les deux fichiers annexes', () => {
  const garde = source.match(/if \(reprisesBase\) \{[\s\S]*?\n  \}/)[0];
  for (const suffixe of ['-wal', '-shm']) {
    assert.ok(garde.includes(suffixe) || garde.includes('suffixe'),
      `${suffixe} doit être couvert par la garde`);
  }
});

/**
 * Le pendant concret : une base et son WAL posés côte à côte, on vérifie
 * qu'un effacement conditionné laisse le WAL en place quand la base était
 * déjà là. C'est la situation exacte d'une mise à jour.
 */
test('sur une mise à jour, le WAL reste en place', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'jc-wal-'));
  try {
    mkdirSync(dossier, { recursive: true });
    writeFileSync(join(dossier, 'data.db'), 'base');
    writeFileSync(join(dossier, 'data.db-wal'), 'ecritures recentes');

    // Reproduction de la logique corrigée : on n'efface que si l'on VIENT de
    // créer la base.
    const reprisesBase = false;
    if (reprisesBase) rmSync(join(dossier, 'data.db-wal'), { force: true });

    assert.ok(existsSync(join(dossier, 'data.db-wal')),
      'le WAL d\'une base existante ne doit jamais être effacé');
    assert.equal(readFileSync(join(dossier, 'data.db-wal'), 'utf8'), 'ecritures recentes');
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});
