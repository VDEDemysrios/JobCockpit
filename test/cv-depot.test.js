// INSTALLER SON CV : LE CHEMIN QUI SE REFERMAIT TOUT SEUL.
//
// Le CV est la pièce dont dépendent l'analyse de chaque offre et la rédaction
// de chaque lettre. Il n'y avait pourtant qu'UN geste pour l'installer — un
// glisser-déposer sur la fenêtre — et rien à l'écran ne l'annonçait : seule la
// visite guidée le disait, une fois, et la visite se marquait « faite » dès
// son lancement. Refusée, interrompue, ou simplement rechargée, elle ne
// revenait plus. Restait la vue « Mon CV », qui conseillait
// `npm run extract-cv` : une commande de terminal dans un dossier de projet,
// deux choses absentes de l'exécutable distribué.
//
// Aucune de ces trois pièces ne lève d'erreur en se dégradant. Le symptôme est
// un utilisateur qui n'arrive pas à mettre son CV et ne sait pas pourquoi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lire = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const tutoriel = lire('tutoriel.js');
const vueCv = lire('cv.js');
const depot = lire('depot-cv.js');
const css = lire('style.css');

/**
 * UNE VISITE INTERROMPUE N'A PAS ÉTÉ FAITE.
 *
 * La marque était posée au lancement, avant la première bulle : fermer la
 * fenêtre pendant l'ouverture animée suffisait à la consommer pour toujours.
 */
test('la visite ne se déclare faite qu\'une fois terminée ou refusée', () => {
  const marques = [...tutoriel.matchAll(/localStorage\.setItem\(CLE_VUE/g)];
  assert.equal(marques.length, 1, 'un seul endroit doit poser la marque');

  const terminer = tutoriel.indexOf('const terminer = () =>');
  assert.ok(terminer > 0, 'la fonction de sortie doit exister');
  assert.ok(marques[0].index > terminer,
    'la marque est posée au lancement : une visite abandonnée à la première '
    + 'étape ne reviendrait jamais');
});

/**
 * LE PROJECTEUR DÉCOUPE LE RECTANGLE DE SA CIBLE.
 *
 * Visant `#view-cv`, il couvrait tout l'écran : plus d'ombre, donc plus rien
 * de désigné, à l'étape qui porte le geste le plus important.
 */
test('l\'étape du CV désigne un élément, pas la vue entière', () => {
  const etape = tutoriel.slice(tutoriel.indexOf('vue: \'cv\''));
  assert.match(etape.slice(0, 200), /cible: '#view-cv \[data-choisir-cv\]'/);
  assert.ok(!/cible: '#view-cv'/.test(tutoriel),
    'une vue entière comme cible annule le projecteur');
});

/**
 * IL FAUT UN GESTE VISIBLE, PAS SEULEMENT UN GESTE QUI MARCHE.
 *
 * Le glisser-déposer reste le plus rapide, mais une action que rien n'annonce
 * n'existe pas pour celui qui ne la connaît pas déjà.
 */
test('la vue « Mon CV » propose un bouton partout où il manque un CV', () => {
  const boutons = [...vueCv.matchAll(/data-choisir-cv/g)];
  assert.ok(boutons.length >= 4,
    `seulement ${boutons.length} bouton(s) : l'état vide, le document `
    + 'introuvable, l\'extraction périmée et le remplacement en ont chacun besoin');
});

/**
 * LA COMMANDE N'EXISTE PAS DANS L'EXÉCUTABLE DISTRIBUÉ.
 *
 * `npm run extract-cv` suppose npm et le dossier des sources. La proposer
 * comme seule issue à quelqu'un qui a lancé `JobCockpit.exe` revient à ne rien
 * proposer.
 */
test('la ligne de commande n\'est plus la seule issue de l\'état vide', () => {
  const vide = vueCv.slice(vueCv.indexOf('Aucun CV n\'a encore été extrait'),
    vueCv.indexOf('const couverts'));
  assert.match(vide, /data-choisir-cv/, 'l\'état vide doit porter le bouton');
  const cmd = vide.indexOf('npm run extract-cv');
  if (cmd >= 0) {
    assert.ok(vide.indexOf('data-choisir-cv') < cmd,
      'la commande doit venir APRÈS le bouton, pas à sa place');
  }
});

/**
 * L'ÉCOUTE EST DÉLÉGUÉE, PARCE QUE LES VUES SONT RECONSTRUITES.
 *
 * Un écouteur posé sur le bouton partirait avec lui au premier rafraîchissement
 * — et le bouton deviendrait inerte sans que rien ne le signale.
 */
test('le bouton reste vivant après un rendu', () => {
  assert.match(depot, /document\.addEventListener\('click'/);
  assert.match(depot, /closest\?\.\('\[data-choisir-cv\]'\)/);
});

/**
 * RECHOISIR LE MÊME FICHIER DOIT MARCHER.
 *
 * Un `<input type="file">` ne déclenche `change` que si la valeur change :
 * corriger son CV puis le reprendre, sous le même nom, ne déclenchait rien.
 */
test('le sélecteur est vidé après chaque choix', () => {
  assert.match(depot, /choix\.value = ''/);
});

/** Le format refusé le plus fréquent mérite sa phrase, pas un code. */
test('le PDF est refusé avec la marche à suivre', () => {
  assert.match(depot, /Enregistrer sous/);
});

// ─────────────────────────────────────────────────────── l'empilement

/** Les trois calques concernés, lus dans la feuille de style. */
function couche(selecteur) {
  const bloc = css.slice(css.indexOf(selecteur));
  const m = bloc.slice(0, 400).match(/z-index:\s*(\d+)/);
  assert.ok(m, `${selecteur} n'a pas de z-index`);
  return Number(m[1]);
}

/**
 * UN MESSAGE EST LA SEULE TRACE QU'UNE ACTION A ABOUTI.
 *
 * Les messages étaient à 100, sous la visite guidée. Celle-ci dit « lâche ton
 * CV n'importe où dans la fenêtre » : on le lâchait, et la confirmation comme
 * l'erreur s'affichaient derrière son voile sombre. Le geste paraissait sans
 * effet, au moment précis où l'application le réclamait.
 */
test('rien ne passe devant les messages', () => {
  const toast = couche('#toastZone{');
  for (const surcouche of ['.tuto{', '.depot-voile{', '.intro{', '.overlay{']) {
    assert.ok(toast > couche(surcouche),
      `${surcouche} (${couche(surcouche)}) passe devant les messages (${toast})`);
  }
});

/** Le voile qui répond au glisser doit se voir pendant la visite qui l'invite. */
test('le voile de dépôt passe devant la visite guidée', () => {
  assert.ok(couche('.depot-voile{') > couche('.tuto{'),
    'le « Dépose ton CV » se retrouve assombri par le voile de la visite');
});

// ─────────────────────────────────────────── le CV qui naît déjà périmé

/**
 * « TON DOCUMENT A ÉTÉ MODIFIÉ APRÈS LA DERNIÈRE EXTRACTION », TROIS SECONDES
 * APRÈS L'AVOIR DÉPOSÉ.
 *
 * La vue « Mon CV » compare les dates des deux fichiers : `perimee` vaut vrai
 * dès que le document est plus récent que le texte extrait. `enregistrerCv`
 * écrivait `cv.txt` en premier et le document juste après — le document était
 * donc systématiquement le plus récent, et tout CV fraîchement installé
 * s'annonçait dépassé, en affirmant que les analyses et les lettres
 * travaillaient sur une version périmée. C'était faux, et c'était la première
 * chose qu'on lisait après avoir enfin réussi à mettre son CV.
 */
test('un CV qui vient d\'être déposé n\'est pas annoncé périmé', async () => {
  const { mkdtempSync, statSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { enregistrerCv } = await import('../src/cv.js');

  // LA TAILLE COMPTE, ET CE N'EST PAS DU REMPLISSAGE. Sur quelques centaines
  // d'octets, les deux écritures tombent dans la même milliseconde et l'ordre
  // devient invisible — le test passerait quel qu'il soit. Un CV Word réel
  // pèse près de 180 ko : à cette taille l'écart se mesure, et c'est très
  // exactement la situation dans laquelle le bandeau apparaissait.
  const racine = mkdtempSync(join(tmpdir(), 'jc-cv-'));
  const texte = 'Expérience professionnelle, contrôle de légalité. '.repeat(3700);
  await enregistrerCv(Buffer.from(texte, 'utf8'), 'CV.txt', racine);

  const extrait = statSync(join(racine, 'profile', 'cv.txt')).mtime;
  const source = statSync(join(racine, 'profile', 'cv-source.txt')).mtime;

  // La comparaison de `src/api.js`, à l'identique.
  assert.ok(!(source > extrait),
    `le document (${source.toISOString()}) est plus récent que son extraction `
    + `(${extrait.toISOString()}) : la vue le déclarera périmé sur-le-champ`);
});

/**
 * UNE SEULE PORTE, ET ELLE AVAIT DÉJÀ DEUX BATTANTS.
 *
 * `src/cv.js` s'ouvre sur cette règle : la ligne de commande et le
 * téléversement doivent partager la MÊME extraction, faute de quoi l'une
 * acceptera ce que l'autre refuse. `scripts/extract-cv.js` gardait pourtant sa
 * copie — qui ignorait le .txt, ne vérifiait pas la signature d'un .docx, et
 * écrivait les deux fichiers dans le mauvais ordre.
 */
test('la ligne de commande passe par la même extraction que le dépôt', () => {
  const script = readFileSync(
    new URL('../scripts/extract-cv.js', import.meta.url), 'utf8');
  assert.match(script, /import \{ enregistrerCv \} from '\.\.\/src\/cv\.js'/);
  assert.ok(!/mammoth/.test(script),
    'le script réextrait pour son compte : les deux portes vont diverger');
});
