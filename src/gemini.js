// Client Gemini bas niveau : limitation de débit, reprise sur erreur,
// extraction du JSON. Aucune logique métier ici — voir analyze.js.
//
// Quota gratuit : ~15 requêtes/minute, ~1500/jour. On se limite à 10/min
// pour garder de la marge.
import { GoogleGenAI } from '@google/genai';

// Chaîne de repli : si un modèle est saturé, retiré, ou à court de quota,
// on passe au suivant. Vérifiée le 28/07/2026 contre l'API : les modèles
// évoluent vite, et un nom devenu invalide fait échouer TOUTE l'analyse.
//
// Pour revérifier ce qui est disponible avec la clé du .env :
//   npm run modeles
const MODELES = [
  'gemini-3.6-flash',        // le plus capable des « flash » disponibles
  'gemini-flash-latest',     // alias suivant automatiquement les nouveautés
  'gemini-3.5-flash-lite',   // plus léger, quota généralement plus large
  'gemini-flash-lite-latest',
];

/**
 * Classe une erreur d'API pour décider de la suite.
 * Fonction pure, testable sans réseau.
 *
 * - 'modele-indisponible' (404/503) : ce modèle est retiré ou saturé
 * - 'quota'               (429)     : quota épuisé pour CE modèle
 * - 'autre'                         : incident passager, une reprise vaut le coup
 *
 * Dans les deux premiers cas, réessayer le même modèle est inutile :
 * il faut passer au suivant. C'est ce que la première version ratait —
 * un 429 sur un modèle interrompait toute la chaîne.
 */
export function classerErreur(message) {
  const texte = String(message ?? '');
  if (/\b404\b|no longer available|not found/i.test(texte)) return 'modele-indisponible';
  if (/\b503\b|high demand|overloaded|UNAVAILABLE/i.test(texte)) return 'modele-indisponible';
  if (/\b429\b|quota|RESOURCE_EXHAUSTED|rate limit/i.test(texte)) return 'quota';
  return 'autre';
}

/** Espace les appels pour ne pas dépasser le quota par minute. */
export class Limiteur {
  constructor(parMinute = 10) {
    this.intervalleMs = 60000 / parMinute;
    this.dernierAppel = 0;
  }

  async attendre() {
    const ecoule = Date.now() - this.dernierAppel;
    if (ecoule < this.intervalleMs) {
      await new Promise(r => setTimeout(r, this.intervalleMs - ecoule));
    }
    this.dernierAppel = Date.now();
  }
}

/**
 * Extrait un objet OU un tableau JSON d'une réponse de LLM.
 *
 * Les modèles encadrent souvent le JSON dans un bloc markdown ou l'entourent
 * de commentaires : on isole donc la première ouverture et la fermeture
 * correspondante. Retourne null si rien d'exploitable — JAMAIS d'exception,
 * pour que l'appelant puisse simplement ignorer le résultat.
 *
 * LE TABLEAU N'ÉTAIT PAS PRÉVU, ET ÉCHOUAIT EN SILENCE.
 * La fonction ne cherchait que des accolades. Un prompt demandant une LISTE
 * reçoit un tableau au premier niveau — parfaitement valide, et pourtant
 * illisible ici : la première accolade rencontrée était celle du premier
 * élément, la dernière celle du dernier, et la tranche ainsi découpée perdait
 * les crochets englobants. `JSON.parse` recevait alors une suite d'objets
 * séparés par des virgules, et rendait null. Le module de révision n'a donc
 * jamais reçu une seule carte, alors que le modèle répondait juste.
 */
export function extraireJson(texte) {
  if (!texte) return null;

  const debutObjet = texte.indexOf('{');
  const debutTableau = texte.indexOf('[');
  const tableau = debutTableau !== -1
    && (debutObjet === -1 || debutTableau < debutObjet);

  const debut = tableau ? debutTableau : debutObjet;
  const fin = texte.lastIndexOf(tableau ? ']' : '}');
  if (debut === -1 || fin === -1 || fin <= debut) return null;

  try {
    return JSON.parse(texte.slice(debut, fin + 1));
  } catch {
    return null;
  }
}

let client = null;
const limiteur = new Limiteur(10);

function obtenirClient() {
  if (!client) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY absente du .env');
    }
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

/** true si l'analyse LLM est disponible. */
export function estConfigure() {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Envoie un prompt et renvoie le texte brut de la réponse.
 * Essaie chaque modèle de la chaîne de repli, une reprise par modèle.
 * @returns {Promise<string|null>} null si tous les modèles ont échoué
 */
export async function demander(prompt) {
  const genai = obtenirClient();

  for (const modele of MODELES) {
    for (let tentative = 1; tentative <= 2; tentative++) {
      try {
        await limiteur.attendre();
        const reponse = await genai.models.generateContent({
          model: modele,
          contents: prompt,
        });
        return reponse.text;
      } catch (erreur) {
        const message = String(erreur?.message ?? erreur);
        const type = classerErreur(message);
        console.warn(`  ⚠ Gemini [${modele}] ${type} : ${message.replace(/\s+/g, ' ').slice(0, 110)}`);

        // Modèle retiré, saturé, ou quota épuisé : réessayer le MÊME modèle
        // ne servirait à rien. On passe directement au suivant de la chaîne.
        if (type !== 'autre') break;

        // Incident passager : une seule reprise, après une courte pause.
        if (tentative === 1) await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  console.warn('  ⚠ Aucun modèle Gemini disponible — offres conservées sans analyse.');
  return null;
}
