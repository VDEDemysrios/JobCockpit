// Liste les modèles Gemini réellement utilisables avec la clé du .env,
// et teste lesquels répondent effectivement.
//
// Les modèles Google évoluent vite : un nom codé en dur dans src/gemini.js
// peut devenir invalide du jour au lendemain et faire échouer toute l'analyse.
// Cet outil sert à mettre à jour la constante MODELES en connaissance de cause.
//
// Usage : npm run modeles
import 'dotenv/config';

const CLE = process.env.GEMINI_API_KEY;

if (!CLE) {
  console.error('GEMINI_API_KEY absente du .env');
  process.exit(1);
}

const reponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${CLE}`);
const donnees = await reponse.json();

if (donnees.error) {
  console.error(`Erreur ${donnees.error.code} : ${donnees.error.message}`);
  process.exit(1);
}

// On ne garde que les modèles de génération de texte, hors spécialités
// (image, audio, embeddings…) qui ne servent pas ici.
const candidats = (donnees.models ?? [])
  .filter(m => (m.supportedGenerationMethods ?? []).includes('generateContent'))
  .map(m => m.name.replace('models/', ''))
  .filter(n => /flash|pro/.test(n) && !/vision|embed|tts|image|audio|live|banana|lyria/.test(n));

console.log(`${candidats.length} modèle(s) annoncé(s). Test de réponse réelle :\n`);

for (const modele of candidats) {
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent?key=${CLE}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'Reponds uniquement par le mot OK' }] }] }),
      }
    );
    const d = await r.json();
    if (r.ok) {
      console.log(`  ✓ ${modele}`);
    } else {
      console.log(`  ✗ ${modele.padEnd(32)} ${d.error.code} ${d.error.message.replace(/\s+/g, ' ').slice(0, 60)}`);
    }
  } catch (erreur) {
    console.log(`  ✗ ${modele.padEnd(32)} ${erreur.message.slice(0, 60)}`);
  }
  // Pause pour ne pas saturer le quota gratuit pendant le test lui-même.
  await new Promise(r => setTimeout(r, 1500));
}

console.log('\nReporter les modèles ✓ dans la constante MODELES de src/gemini.js.');
