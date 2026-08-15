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

  // Session expirée : inutile d'afficher une erreur dans un toast, puis une
  // seconde, puis une troisième — chaque appel de la page échouerait pareil.
  // On repasse par la porte d'entrée, ce qui est la seule suite possible.
  if (reponse.status === 401) {
    window.location.href = '/connexion';
    // La navigation n'est pas instantanée : cette erreur évite que l'appelant
    // continue avec des données absentes le temps que la page change.
    throw new Error('Session expirée — redirection vers la connexion.');
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
  // Remet une offre écartée par erreur, avec son suivi et sa lettre.
  restaurerOffre:(id)          => appeler(`/api/offers/${id}/restaurer`, { method: 'POST' }),
  /**
   * Envoie un CV. Corps BRUT et non multipart : un fichier, une requête, le
   * nom dans un en-tête — inutile d'assembler un formulaire en plusieurs
   * parties pour un seul document.
   */
  envoyerCv: async (fichier) => {
    const reponse = await fetch('/api/cv', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        // Un nom de fichier peut contenir des accents ou des espaces : un
        // en-tête HTTP, non. On l'encode.
        'X-Nom-Fichier': encodeURIComponent(fichier.name ?? 'cv.docx'),
      },
      body: fichier,
    });
    const data = await reponse.json().catch(() => ({}));
    if (!reponse.ok || !data.ok) throw new Error(data.error ?? `Erreur ${reponse.status}`);
    return data;
  },
  // Les villes prioritaires, réglables APRÈS la première configuration : on
  // déménage, on abandonne une ville, on en ajoute une. Ce sont des évènements
  // ordinaires d'une recherche d'emploi, pas des reconfigurations.
  villes:            ()        => appeler('/api/villes'),
  enregistrerVilles: (villes)  => appeler('/api/villes', { method: 'PUT', body: { villes } }),

  rejetees:      ()            => appeler('/api/offers/rejetees'),
  oublierRejets: ()            => appeler('/api/offers/rejetees/oublier', { method: 'POST', body: {} }),
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
