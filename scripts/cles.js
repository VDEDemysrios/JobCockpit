// Les deux `.env`, et le piège qu'ils tendent.
//
// LE PROBLÈME, CONSTATÉ TROIS FOIS
// --------------------------------
// `JobCockpit\.env` est celui du projet ; `Application\.env` est le seul que
// lit l'exécutable. Ajouter une clé pendant le développement ne la fait donc
// PAS arriver dans l'application — et rien ne le signale. Le panneau Spotify
// est resté injoignable toute une session pour cette raison, puis l'onglet
// Twitch a affiché son tutoriel d'installation alors que le compte était lié :
// le `TWITCH_CLIENT_ID` était bien renseigné, dans le mauvais fichier.
//
// Le symptôme est toujours le même — « c'est configuré, mais l'application dit
// que non » — et il ne ressemble jamais à un problème de fichier.
//
// LA RÈGLE : ON COMPLÈTE, ON N'ÉCRASE JAMAIS
// ------------------------------------------
// Une clé absente ou vide côté application est reprise du projet. Une clé déjà
// renseignée n'est JAMAIS touchée, même si les deux diffèrent : l'application
// peut avoir sa propre valeur (un `PORT` différent, une clé dédiée), et une
// synchronisation qui écrase serait pire que le problème qu'elle règle.
//
// Rien n'affiche jamais une VALEUR de clé : seulement des noms.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Les couples `CLÉ=valeur` d'un fichier `.env`, commentaires ignorés. */
export function lireEnv(texte) {
  const paires = {};
  for (const ligne of String(texte ?? '').split(/\r?\n/)) {
    const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (m) paires[m[1]] = m[2].trim();
  }
  return paires;
}

/**
 * Ce qu'il faudrait ajouter à la cible pour qu'elle ne manque de rien.
 *
 * Rend les NOMS des clés à compléter, et le texte du fichier une fois complété.
 * Séparer les deux permet de tester la décision sans écrire sur le disque —
 * c'est la partie qui peut se tromper.
 */
export function completer(texteCible, sourcE) {
  const cible = lireEnv(texteCible);
  const source = lireEnv(sourcE);

  const manquantes = Object.keys(source)
    .filter(cle => source[cle] !== '' && !cible[cle]);

  if (!manquantes.length) return { manquantes, texte: texteCible };

  const ajout = manquantes.map(cle => `${cle}=${source[cle]}`).join('\n');
  // Les clés déjà présentes mais VIDES sont remplacées sur place, sinon le
  // fichier porterait deux fois la même clé — et `dotenv` garde la première,
  // c'est-à-dire la vide.
  let texte = texteCible;
  for (const cle of manquantes) {
    if (cle in cible) {
      texte = texte.replace(new RegExp(`^\\s*${cle}\\s*=.*$`, 'm'), '');
    }
  }
  texte = texte.replace(/\n{3,}/g, '\n\n').replace(/\s*$/, '\n');
  return { manquantes, texte: `${texte}${ajout}\n` };
}

/** Complète le `.env` de l'application depuis celui du projet. */
export function synchroniser(cheminCible, cheminSource = join(RACINE, '.env')) {
  if (!existsSync(cheminCible) || !existsSync(cheminSource)) return [];
  const { manquantes, texte } = completer(
    readFileSync(cheminCible, 'utf8'), readFileSync(cheminSource, 'utf8'));
  if (manquantes.length) writeFileSync(cheminCible, texte);
  return manquantes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cible = process.argv[2] ?? join(resolve(RACINE, '..', 'Application'), '.env');
  const ajoutees = synchroniser(cible);
  console.log(ajoutees.length
    ? `\n✅ ${cible}\n   complété depuis le projet : ${ajoutees.join(', ')}`
      + '\n   (redémarre l\'application pour qu\'elle les lise)\n'
    : `\n   ${cible} ne manque de rien.\n`);
}
