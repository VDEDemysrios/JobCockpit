// Appels à l'API du backend.
//
// Toute erreur réseau ou serveur est convertie en Error avec un message
// lisible en français : l'appelant l'affiche dans un toast, et le dashboard
// continue de fonctionner avec les données déjà chargées.

async function appeler(url, options = {}) {
  let reponse;
  try {
    reponse = await fetch(url, {
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error('Le serveur ne répond pas. Est-il bien démarré (npm start) ?');
  }

  let donnees = null;
  try { donnees = await reponse.json(); } catch { /* réponse non JSON */ }

  if (!reponse.ok || donnees?.ok === false) {
    const erreur = new Error(donnees?.error ?? `Erreur serveur (${reponse.status}).`);
    erreur.statut = reponse.status;
    erreur.besoinConfirmation = donnees?.besoinConfirmation;
    throw erreur;
  }
  return donnees;
}

export const API = {
  offres:        ()            => appeler('/api/offers'),
  meta:          ()            => appeler('/api/meta'),
  majSuivi:      (id, champs)  => appeler(`/api/track/${id}`, { method: 'PATCH', body: champs }),
  ajouterOffre:  (offre)       => appeler('/api/offers', { method: 'POST', body: offre }),
  collerOffre:   (texte)       => appeler('/api/offers/paste', { method: 'POST', body: { texte } }),
  supprimerOffre:(id)          => appeler(`/api/offers/${id}`, { method: 'DELETE' }),
  rafraichir:    ()            => appeler('/api/refresh', { method: 'POST' }),
  migrer:        (donnees)     => appeler('/api/migrate', { method: 'POST', body: donnees }),

  majObjectif:   (objectif)    => appeler('/api/objectif', { method: 'PUT', body: { objectif } }),
  reinitialiser: ()            => appeler('/api/historique/reinitialiser', { method: 'POST' }),
  stats:         ()            => appeler('/api/stats'),
  cv:            ()            => appeler('/api/cv'),
  timeline:      (limite = 60) => appeler(`/api/timeline?limite=${limite}`),

  lettre:        (id)          => appeler(`/api/letter/${id}`),
  genererLettre: (id, options) => appeler(`/api/letter/${id}`, { method: 'POST', body: options ?? {} }),
  majLettre:     (id, contenu) => appeler(`/api/letter/${id}`, { method: 'PATCH', body: { contenu } }),
  urlDocx:       (id)          => `/api/letter/${id}/docx`,
  urlDossier:    (id)          => `/api/letter/${id}/dossier`,
};
