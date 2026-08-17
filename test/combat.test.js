// LE JEU DE COMBAT : l'équilibrage, et ce qui rend un coup honnête.
//
// Presque tout ce qui compte dans un jeu de combat est INVISIBLE : une image
// de départ de trop, une boîte de coup qui traîne après la fin de
// l'animation, une portée qui ne correspond pas au dessin. Rien de tout cela
// ne lève d'erreur — ça rend le jeu injouable, et on ne sait pas pourquoi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMBATTANTS, ARENES, REGLES, ARENE } from '../public/jeux/combat-donnees.js';
import {
  nouvelleRencontre, avancer, boite, boiteCoup, intentionIA, ETATS,
} from '../public/jeux/combat-moteur.js';

const CLES = Object.keys(COMBATTANTS);

test('six combattants, six archétypes distincts, six arènes', () => {
  assert.equal(CLES.length, 6);
  const archetypes = new Set(CLES.map(c => COMBATTANTS[c].archetype));
  assert.equal(archetypes.size, 6, 'deux personnages du même archétype, c\'est un doublon');
  for (const c of CLES) {
    assert.ok(ARENES[COMBATTANTS[c].origine], `${c} n'a pas d'arène`);
  }
  assert.equal(new Set(CLES.map(c => COMBATTANTS[c].origine)).size, 6,
    'chaque combattant doit avoir SON décor : c\'est ce qui dit d\'où il vient');
});

/**
 * L'ARBITRAGE FONDAMENTAL D'UN JEU DE COMBAT.
 *
 * Un coup lent doit frapper fort ou porter loin ; un coup rapide doit être
 * court ou faible. Sans cette tension, un personnage domine tout et le jeu
 * meurt en trois parties.
 */
test('aucun coup n\'est à la fois rapide, fort et long', () => {
  for (const cle of CLES) {
    for (const [nom, c] of Object.entries(COMBATTANTS[cle].coups)) {
      const rapide = c.depart <= 8;
      const fort = c.degats >= 100;
      const long = c.portee >= 120;
      assert.ok(!(rapide && fort), `${cle}.${nom} : rapide ET fort`);
      assert.ok(!(rapide && long), `${cle}.${nom} : rapide ET long`);
      assert.ok(c.recup >= c.depart / 2, `${cle}.${nom} : trop peu punissable`);
    }
  }
});

/** Un coup fort doit se payer : négatif sur blocage, donc punissable. */
test('les coups forts sont punissables quand on les bloque', () => {
  for (const cle of CLES) {
    const { lourd, special } = COMBATTANTS[cle].coups;
    assert.ok(lourd.avantage < 0, `${cle}.lourd doit être négatif sur garde`);
    assert.ok(special.avantage < 0, `${cle}.special doit être négatif sur garde`);
  }
});

/** Les archétypes doivent se distinguer par les CHIFFRES, pas par le nom. */
test('les archétypes se lisent dans les statistiques', () => {
  const { chevalier, ninja, lancier, lutteur } = COMBATTANTS;

  assert.ok(chevalier.vie > ninja.vie + 200, 'le lourd doit encaisser bien plus');
  assert.ok(ninja.vitesse > chevalier.vitesse * 1.5, 'le rapide doit être bien plus rapide');
  assert.ok(lancier.coups.lourd.portee === Math.max(...CLES.map(c => COMBATTANTS[c].coups.lourd.portee)),
    'le zoneur doit avoir la plus longue portée du jeu');
  assert.ok(lutteur.coups.special.imparable, 'l\'empoigneur a besoin d\'un coup imparable');
  assert.ok(lutteur.coups.special.portee < 60,
    'et il doit le payer par une portée dérisoire');
});

// ─────────────────────────────── Le moteur

test('une rencontre commence à distance, face à face', () => {
  const e = nouvelleRencontre('samourai', 'ninja');
  assert.equal(e.a.sens, 1);
  assert.equal(e.b.sens, -1);
  assert.equal(Math.round(e.b.x - e.a.x), REGLES.distanceDepart);
  assert.equal(e.a.vie, COMBATTANTS.samourai.vie);
});

/**
 * LA BOÎTE DE COUP N'EXISTE QUE PENDANT LES IMAGES ACTIVES.
 *
 * Une boîte qui traîne pendant la récupération touche APRÈS la fin de
 * l'animation : on se fait frapper par un coup qu'on voit se terminer. C'est
 * le défaut le plus déroutant qu'un jeu de combat puisse avoir.
 */
test('un coup ne touche que pendant ses images actives', () => {
  const e = nouvelleRencontre('samourai', 'ninja');
  const c = COMBATTANTS.samourai.coups.lourd;
  const vus = [];

  avancer(e, { a: { lourd: true }, b: {} });
  const total = c.depart + c.actif + c.recup;
  for (let i = 0; i < total + 2; i++) {
    vus.push(Boolean(boiteCoup(e.a)));
    avancer(e, { a: {}, b: {} });
  }
  const actifs = vus.filter(Boolean).length;
  assert.equal(actifs, c.actif, `${actifs} images actives au lieu de ${c.actif}`);
  assert.ok(!vus[0], 'rien pendant le départ');
  assert.ok(!vus.at(-1), 'rien pendant la récupération');
});

test('un coup ne touche qu\'une fois par activation', () => {
  const e = nouvelleRencontre('chevalier', 'ninja');
  e.b.x = e.a.x + 60;
  const avant = e.b.vie;
  for (let i = 0; i < 40; i++) avancer(e, { a: i === 0 ? { lourd: true } : {}, b: {} });
  const perdu = avant - e.b.vie;
  assert.ok(perdu > 0, 'le coup doit toucher');
  assert.ok(perdu <= COMBATTANTS.chevalier.coups.lourd.degats,
    'et ne pas toucher deux fois pendant la même activation');
});

test('garder réduit fortement les dégâts sans les annuler', () => {
  const plein = nouvelleRencontre('chevalier', 'samourai');
  plein.b.x = plein.a.x + 60;
  for (let i = 0; i < 40; i++) avancer(plein, { a: i === 0 ? { lourd: true } : {}, b: {} });
  const sansGarde = plein.b.vieMax - plein.b.vie;

  const garde = nouvelleRencontre('chevalier', 'samourai');
  garde.b.x = garde.a.x + 60;
  for (let i = 0; i < 40; i++) avancer(garde, { a: i === 0 ? { lourd: true } : {}, b: { recule: true } });
  const avecGarde = garde.b.vieMax - garde.b.vie;

  assert.ok(avecGarde > 0, 'garder laisse passer un peu : sinon garder est gratuit');
  assert.ok(avecGarde < sansGarde * 0.3, 'mais bien moins que de se faire toucher');
});

/** La prise du lutteur passe à travers la garde. C'est tout son intérêt. */
test('un coup imparable ignore la garde', () => {
  const e = nouvelleRencontre('lutteur', 'chevalier');
  e.b.x = e.a.x + 40;
  for (let i = 0; i < 50; i++) avancer(e, { a: i === 0 ? { special: true } : {}, b: { recule: true } });
  const perdu = e.b.vieMax - e.b.vie;
  assert.ok(perdu > COMBATTANTS.lutteur.coups.special.degats * 0.8,
    'l\'étreinte doit passer la garde presque intégralement');
});

test('personne ne sort de l\'arène', () => {
  const e = nouvelleRencontre('ninja', 'samourai');
  for (let i = 0; i < 600; i++) avancer(e, { a: { recule: true }, b: { avance: true } });
  assert.ok(e.a.x >= ARENE.mur);
  assert.ok(e.b.x <= ARENE.largeur - ARENE.mur);
});

test('deux combattants ne se traversent pas', () => {
  const e = nouvelleRencontre('ninja', 'chevalier');
  for (let i = 0; i < 300; i++) avancer(e, { a: { avance: true }, b: { avance: true } });
  assert.ok(Math.abs(e.b.x - e.a.x) >= 44, 'ils doivent rester distincts');
});

test('le round se termine au KO, et désigne le vainqueur', () => {
  const e = nouvelleRencontre('chevalier', 'duelliste');
  e.b.vie = 30;
  e.b.x = e.a.x + 60;
  for (let i = 0; i < 60 && !e.fin; i++) avancer(e, { a: i === 0 ? { lourd: true } : {}, b: {} });
  assert.equal(e.fin?.vainqueur, 'a');
  assert.equal(e.fin.raison, 'ko');
  assert.equal(e.b.etat, ETATS.KO);
});

test('le temps écoulé départage à la vie restante', () => {
  const e = nouvelleRencontre('samourai', 'ninja');
  e.temps = 2;
  e.b.vie = 400;
  avancer(e, { a: {}, b: {} });
  avancer(e, { a: {}, b: {} });
  assert.equal(e.fin?.raison, 'temps');
  assert.equal(e.fin.vainqueur, 'a', 'la meilleure PROPORTION de vie gagne');
});

// ─────────────────────────────── L'IA

/**
 * ELLE NE DOIT PAS LIRE LES INTENTIONS DU JOUEUR.
 *
 * Une IA qui réagit à l'image près à ce qu'on vient d'appuyer est imbattable
 * et détestable : on n'affronte personne, on se fait lire. Celle-ci décide
 * d'après ce qu'elle voit, et hésite.
 */
test('l\'IA hésite, et d\'autant plus qu\'elle est facile', () => {
  const e = nouvelleRencontre('samourai', 'ninja');
  const compter = (niveau) => {
    let vides = 0;
    for (let i = 0; i < 400; i++) {
      const t = i / 400;
      if (Object.keys(intentionIA(e, 'b', niveau, () => t)).length === 0) vides++;
    }
    return vides;
  };
  assert.ok(compter(1) > compter(3), 'le niveau facile doit hésiter davantage');
});

test('l\'IA avance quand elle est trop loin, et frappe à portée', () => {
  const e = nouvelleRencontre('lutteur', 'samourai');
  e.a.x = 100; e.b.x = 800;   // très loin
  const loin = intentionIA(e, 'b', 3, () => 0.5);
  assert.ok(loin.avance || loin.special, 'de loin, elle comble la distance');

  e.b.x = e.a.x + 60;
  const proche = intentionIA(e, 'b', 3, () => 0.5);
  assert.ok(proche.leger || proche.lourd || proche.special || proche.recule,
    'à portée, elle agit');
});

test('l\'IA ne fait rien pendant qu\'elle est occupée', () => {
  const e = nouvelleRencontre('samourai', 'ninja');
  avancer(e, { a: {}, b: { lourd: true } });
  assert.deepEqual(intentionIA(e, 'b', 3, () => 0.5), {},
    'une IA qui empile des ordres pendant son attaque tricherait');
});

/** Les arènes s'empilent du ciel vers le sol : l'ordre est structurel. */
test('chaque arène a son ciel, son sol et son accent', () => {
  for (const [cle, a] of Object.entries(ARENES)) {
    assert.equal(a.ciel.length, 3, `${cle} : trois teintes de ciel attendues`);
    assert.equal(a.sol.length, 3, `${cle} : trois teintes de sol attendues`);
    assert.match(a.accent, /^#[0-9a-f]{6}$/i, `${cle} : accent invalide`);
    assert.ok(a.nom && a.silhouettes, `${cle} : décor incomplet`);
  }
});

test('les palettes restent courtes : une silhouette se lit en peu de teintes', () => {
  for (const cle of CLES) {
    const p = COMBATTANTS[cle].palette;
    assert.ok(p.length >= 4 && p.length <= 6, `${cle} : ${p.length} teintes`);
    for (const t of p) assert.match(t, /^#[0-9a-f]{6}$/i);
  }
});

/**
 * UN COUP À PROJECTILE NE FRAPPE PAS AUSSI AU CORPS À CORPS.
 *
 * Le défaut le plus coûteux de ce moteur, et parfaitement invisible :
 * `portee` décrivait la distance d'apparition du projectile, mais servait
 * AUSSI de boîte de contact. Le samouraï frappait donc à 210 unités — près du
 * double du plus long coup de mêlée — tout en lançant sa lame de vent.
 *
 * Mesuré sur 40 combats avant correction : son special touchait 820 fois
 * contre 12 pour le projectile lui-même, et il gagnait 97 % des rencontres.
 * Aucun test ne signalait quoi que ce soit.
 */
test('le geste qui lance un projectile ne touche pas lui-même', () => {
  const e = nouvelleRencontre('samourai', 'chevalier');
  e.b.x = e.a.x + 70;                      // à portée d'un coup de mêlée
  const avant = e.b.vie;

  const c = COMBATTANTS.samourai.coups.special;
  avancer(e, { a: { special: true }, b: {} });
  for (let i = 0; i < c.depart + c.actif + 2; i++) {
    assert.equal(boiteCoup(e.a), null,
      'un coup à projectile ne doit JAMAIS avoir de boîte de mêlée');
    avancer(e, { a: {}, b: {} });
  }
  // Le projectile, lui, existe bien et porte les dégâts.
  assert.ok(e.projectiles.length > 0 || e.b.vie < avant,
    'le projectile doit avoir été lancé');
});

/**
 * L'ÉQUILIBRAGE, MESURÉ PLUTÔT QUE SUPPOSÉ.
 *
 * On fait jouer toutes les paires par deux IA et on regarde l'écart entre le
 * meilleur et le pire. Ce n'est pas une garantie d'équilibre parfait — un vrai
 * joueur ne joue pas comme l'IA — mais un écart qui s'envole signale toujours
 * un outil cassé, comme la boîte de mêlée du projectile plus haut.
 */
test('aucun personnage n\'écrase tous les autres', () => {
  const cles = Object.keys(COMBATTANTS);
  const v = Object.fromEntries(cles.map(c => [c, { g: 0, t: 0 }]));
  let graine = 12345;
  const alea = () => { graine = (graine * 1103515245 + 12345) & 0x7fffffff; return graine / 0x7fffffff; };

  for (const a of cles) {
    for (const b of cles) {
      if (a === b) continue;
      for (let n = 0; n < 6; n++) {
        const e = nouvelleRencontre(a, b);
        let i = 0;
        while (!e.fin && i < 4000) {
          avancer(e, { a: intentionIA(e, 'a', 2, alea), b: intentionIA(e, 'b', 2, alea) });
          i++;
        }
        v[a].t++; v[b].t++;
        if (e.fin?.vainqueur === 'a') v[a].g++;
        else if (e.fin?.vainqueur === 'b') v[b].g++;
        assert.ok(e.fin, `${a} contre ${b} ne se termine pas : la partie est bloquée`);
      }
    }
  }
  const taux = cles.map(c => (v[c].g / v[c].t) * 100);
  const ecart = Math.max(...taux) - Math.min(...taux);
  assert.ok(ecart < 75,
    `écart de ${Math.round(ecart)} points entre le meilleur et le pire : un outil est cassé`);
});
