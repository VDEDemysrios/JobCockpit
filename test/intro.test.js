// L'OUVERTURE : UNE SEULE HORLOGE POUR LE FAISCEAU ET POUR LES POINTS.
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Le faisceau et les points ont tourné pendant des semaines sur deux horloges
// séparées. Le faisceau partait de `rotate(-90deg)` à 250 ms avec un
// assouplissement ; les points s'allumaient à `(angle / 360) × 2108 ms`, comme
// si le faisceau démarrait à zéro degré, à zéro seconde, à vitesse constante.
// Rien ne correspondait : jusqu'à **1,3 seconde d'écart** entre le passage du
// faisceau et l'allumage du point.
//
// Aucune erreur, aucun test rouge, aucune console qui râle. On obtenait
// simplement une autre animation — des lucioles au lieu d'un radar — et les
// trois points retenus s'allumaient seuls, une seconde après que le faisceau
// les avait dépassés. Le seul symptôme exploitable était : « il ne s'arrête
// pas sur les points oranges ».
//
// C'est le profil de panne exact que ce projet cherche à couvrir par la
// mesure : ce qui ne plante pas doit être compté.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { semerPoints, momentBalaye, capFaisceau, BALAYAGE } from '../public/intro.js';

/** Le même générateur reproductible que l'ouverture. */
function tirage(graine) {
  let e = graine;
  return () => {
    e = (e * 1103515245 + 12345) & 0x7fffffff;
    return e / 0x7fffffff;
  };
}

const points = () => semerPoints(tirage(20260815));

/** Position du bord d'attaque à l'instant t, en degrés « point ». */
function capA(t) {
  const p = (t - BALAYAGE.debut) / BALAYAGE.duree;
  return capFaisceau(BALAYAGE.depart + p * (BALAYAGE.arrivee - BALAYAGE.depart));
}

/** Écart angulaire le plus court entre deux directions, en degrés. */
function ecartAngulaire(a, b) {
  const d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
  return d;
}

/**
 * L'INVARIANT CENTRAL : un point s'allume QUAND le faisceau le croise.
 *
 * C'est ce qui distingue un balayage de lucioles clignotantes, et c'est
 * exactement ce qui était faux.
 */
test('chaque point s\'allume au moment où le faisceau le croise', () => {
  const fautes = [];
  for (const p of points()) {
    const ecart = ecartAngulaire(capA(p.retard), p.angle);
    if (ecart > 0.5) {
      fautes.push(`point à ${p.angle.toFixed(1)}° : faisceau à `
        + `${capA(p.retard).toFixed(1)}° quand il s'allume (${ecart.toFixed(1)}° d'écart)`);
    }
  }
  assert.deepEqual(fautes.slice(0, 5), [],
    `${fautes.length} point(s) s'allument à côté du faisceau`);
});

/** Personne ne s'allume avant que le balayage ait commencé, ni après sa fin. */
test('aucun point ne s\'allume hors du balayage', () => {
  const fin = BALAYAGE.debut + BALAYAGE.duree;
  for (const p of points()) {
    assert.ok(p.retard >= BALAYAGE.debut - 1 && p.retard <= fin + 1,
      `un point s'allume à ${Math.round(p.retard)} ms, hors de [${BALAYAGE.debut}, ${fin}]`);
  }
});

/**
 * LA CHUTE : LE FAISCEAU DOIT S'ARRÊTER SUR LES TROIS RETENUES.
 *
 * C'est le symptôme rapporté, et la raison d'être de l'animation : trois
 * offres restent quand tout le reste s'est éteint. Les laisser au tirage,
 * c'était accepter qu'une ouverture sur deux ne raconte rien.
 */
test('le faisceau s\'immobilise sur les trois points retenus', () => {
  const retenues = points().filter(p => p.retenu);
  assert.equal(retenues.length, 3, 'trois, comme la sélection du jour');

  const capFinal = capFaisceau(BALAYAGE.arrivee);
  for (const p of retenues) {
    const ecart = ecartAngulaire(p.angle, capFinal);
    assert.ok(ecart <= 20,
      `une retenue est à ${ecart.toFixed(0)}° du point d'arrêt du faisceau : `
      + 'il ne s\'arrêtera pas dessus');
    // En ARRIÈRE du bord d'attaque, jamais devant : la traîne lumineuse suit
    // le faisceau, elle ne le précède pas.
    const recul = (capFinal - p.angle + 360) % 360;
    assert.ok(recul > 0 && recul <= 20,
      `une retenue est devant le bord d'attaque (${recul.toFixed(0)}°) : elle `
      + 'resterait dans le noir');
  }
});

/**
 * La fin du balayage leur est RÉSERVÉE. Sans zone franche, un point ordinaire
 * s'allume là où le faisceau s'immobilise, et la chute se lit comme quatre ou
 * cinq taches au lieu de trois.
 */
test('aucun point ordinaire ne traîne là où le faisceau s\'arrête', () => {
  const capFinal = capFaisceau(BALAYAGE.arrivee);
  for (const p of points().filter(x => !x.retenu)) {
    const recul = (capFinal - p.angle + 360) % 360;
    assert.ok(recul > 20,
      `un point ordinaire est à ${recul.toFixed(0)}° du point d'arrêt`);
  }
});

/**
 * Les points ordinaires doivent être ÉTEINTS à la fin. Leur animation dure
 * 1,2 s dans la feuille de style : si le dernier s'allume trop tard, il reste
 * à l'écran en même temps que les retenues et brouille la lecture.
 */
test('le dernier point ordinaire a le temps de s\'éteindre', () => {
  const DUREE_POINT = 1200;   // .intro-point, dans style.css
  const FIN_OUVERTURE = 3400; // DUREE, dans intro.js
  const dernier = Math.max(...points().filter(p => !p.retenu).map(p => p.retard));
  assert.ok(dernier + DUREE_POINT <= FIN_OUVERTURE,
    `le dernier point ordinaire s'éteint à ${Math.round(dernier + DUREE_POINT)} ms, `
    + `après la fin de l'ouverture (${FIN_OUVERTURE} ms)`);
});

/**
 * LES DEUX REPÈRES SONT DÉCALÉS D'UN QUART DE TOUR, et c'est le genre d'écart
 * qui ne se voit pas dans le code. Un dégradé conique part de MIDI ; les
 * points sont placés en coordonnées ordinaires, où zéro degré pointe à DROITE.
 */
test('le cap du faisceau tient compte du quart de tour', () => {
  assert.equal(capFaisceau(0), -90, 'rotation nulle = le faisceau pointe vers le haut');
  assert.equal(capFaisceau(90), 0, 'un quart de tour = le faisceau pointe à droite');
});

/** La densité doit rester uniforme : sans racine carrée, tout s'entasse au centre. */
test('les points couvrent le cadran, pas seulement son centre', () => {
  const rayons = points().filter(p => !p.retenu)
    .map(p => Math.hypot(p.x - 50, p.y - 50));
  const dehors = rayons.filter(r => r > 30).length;
  assert.ok(dehors > rayons.length * 0.45,
    `seulement ${dehors} points sur ${rayons.length} au-delà de la mi-rayon : `
    + 'le radar aurait l\'air d\'avoir un trou sur les bords');
  assert.ok(Math.max(...rayons) <= 49, 'aucun point ne déborde du cadran');
});
