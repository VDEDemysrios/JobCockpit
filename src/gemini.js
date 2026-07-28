// Client Gemini bas niveau : limitation de débit, reprise sur erreur,
// extraction du JSON. Aucune logique métier ici — voir analyze.js.
//
// Quota gratuit : ~15 requêtes/minute, ~1500/jour. On se limite à 10/min
// pour garder de la marge.
import { GoogleGenAI } from '@google/genai';

// Chaîne de repli : si un modèle est saturé ou retiré, on tente le suivant.
const MODELES = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];

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
 * Extrait un objet JSON d'une réponse de LLM.
 * Les modèles encadrent souvent le JSON dans un bloc markdown ou l'entourent
 * de commentaires : on isole la première accolade ouvrante et la dernière
 * fermante. Retourne null si rien d'exploitable — JAMAIS d'exception, pour que
 * l'appelant puisse simplement ignorer l'analyse.
 */
export function extraireJson(texte) {
  if (!texte) return null;

  const debut = texte.indexOf('{');
  const fin = texte.lastIndexOf('}');
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
        console.warn(`  ⚠ Gemini [${modele}] tentative ${tentative} : ${message.slice(0, 160)}`);

        // Quota journalier épuisé : inutile d'insister sur les autres modèles.
        if (/quota|RESOURCE_EXHAUSTED/i.test(message) && tentative === 2) {
          return null;
        }
        // Pause avant la reprise.
        if (tentative === 1) await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  return null;
}
