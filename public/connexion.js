// La page de connexion, sortie de son balisage.
//
// LE DÉFAUT QUE CE FICHIER CORRIGE — ET IL ÉTAIT GRAVE
// ----------------------------------------------------
// Ce code vivait dans une balise <script> EN LIGNE de `connexion.html`. La
// politique de sécurité du serveur (`script-src 'self'`, sans
// `'unsafe-inline'`) le bloquait — à juste titre — et le formulaire partait
// donc par le comportement par défaut du navigateur : un GET vers
// `/connexion?password=…`. LE MOT DE PASSE FINISSAIT DANS L'ADRESSE, donc dans
// l'historique, dans les journaux du serveur et dans tout proxy sur le
// chemin. Et la connexion échouait quand même, sans un mot.
//
// Servi comme fichier, le script est autorisé par `'self'`. Par prudence, le
// formulaire déclare aussi `method="post"` : si ce script ne chargeait pas,
// le mot de passe resterait au moins hors de l'adresse.
//
// NB : la page est servie AVANT authentification. `src/auth.js` doit donc
// laisser passer `/connexion.js` (CHEMINS_LIBRES) — sans quoi ce fichier
// serait redirigé vers… la page de connexion.

const form = document.getElementById('form');
const champ = document.getElementById('motDePasse');
const bouton = document.getElementById('valider');
const erreur = document.getElementById('erreur');

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  erreur.classList.remove('visible');
  bouton.disabled = true;
  bouton.textContent = 'Vérification…';

  try {
    const r = await fetch('/api/connexion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motDePasse: champ.value }),
    });
    const d = await r.json().catch(() => ({}));

    if (r.ok && d.ok) { window.location.href = '/'; return; }

    erreur.textContent = d.error ?? 'Connexion impossible.';
    erreur.classList.add('visible');
    champ.select();
  } catch {
    erreur.textContent = 'Serveur injoignable.';
    erreur.classList.add('visible');
  } finally {
    bouton.disabled = false;
    bouton.textContent = 'Entrer';
  }
});
