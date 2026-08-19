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
  //
  // 401 NE VEUT DIRE QU'UNE CHOSE : NOTRE cookie a expiré. Un service tiers
  // déconnecté — Spotify, Twitch — répond 409 côté serveur, exprès. Rendu en
  // 401, un jeton Spotify mort éjectait l'utilisateur de son tableau de bord
  // parce qu'il venait de cliquer sur « pause ».
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
  // Préparation d'entretien. L'application menait jusqu'à la candidature puis
  // s'arrêtait — or c'est l'entretien qui décide.
  // Discuter. L'historique part du navigateur : une conversation informelle
  // n'a pas a laisser de trace dans la base.
  //
  // `pieces` : les fichiers joints a CE message. Le serveur y ajoute ceux des
  // derniers tours — sans quoi une question posee au tour suivant recevait
  // « je n'ai pas acces aux images ». Voir `src/pieces.js`.
  chat:              (messages, pieces) =>
    appeler('/api/chat', { method: 'POST', body: { messages, pieces } }),

  // Spotify, par le flux PKCE. Tout passe par LE SERVEUR : les jetons ne
  // descendent jamais dans la page, et la politique de sécurité reste close.
  spotifyEtat:       ()        => appeler('/api/spotify/etat'),
  spotifyConnexion:  ()        => appeler('/api/spotify/connexion', { method: 'POST', body: {} }),
  spotifyDeconnexion:()        => appeler('/api/spotify/deconnexion', { method: 'POST', body: {} }),
  spotifyLecture:    ()        => appeler('/api/spotify/lecture'),
  /**
   * Une seule route pour tout le lecteur.
   *
   * `options` porte selon l'action : `uri` et `depart` pour lancer quelque
   * chose, `valeur` pour un réglage (volume, position, répétition),
   * `aleatoire` pour armer le brassage avant de démarrer une playlist.
   */
  spotifyCommande:   (action, options = {}) =>
    appeler('/api/spotify/commande', { method: 'POST', body: { action, ...options } }),
  spotifyRecherche:  (q)       => appeler(`/api/spotify/recherche?q=${encodeURIComponent(q)}`),
  spotifyPlaylists:  ()        => appeler('/api/spotify/playlists'),
  spotifyAppareils:  ()        => appeler('/api/spotify/appareils'),
  spotifyAppareil:   (id)      => appeler('/api/spotify/appareil', { method: 'POST', body: { id } }),
  spotifyFile:       ()        => appeler('/api/spotify/file'),
  spotifyEnfiler:    (uri)     => appeler('/api/spotify/file', { method: 'POST', body: { uri } }),
  // La seule route qui ÉCRIVE chez l'utilisateur : ajouter un morceau à
  // une playlist qui lui appartient.
  spotifyAjouter:    (playlist, uri) =>
    appeler('/api/spotify/playlist', { method: 'POST', body: { playlist, uri } }),
  spotifyRecents:    ()        => appeler('/api/spotify/recents'),
  spotifyContenu:    (uri)     => appeler(`/api/spotify/contenu?uri=${encodeURIComponent(uri)}`),
  spotifyParoles:    (l)       => appeler('/api/spotify/paroles?' + new URLSearchParams({
    titre: l?.titre ?? '', artistes: l?.artistes ?? '',
    album: l?.album ?? '', duree: String(l?.duree ?? 0) })),

  // YouTube. La navigation se fait chez nous : `youtube.com` refuse de
  // s'afficher dans un cadre, seules les adresses /embed/ l'acceptent.
  youtubeEtat:       ()        => appeler('/api/youtube/etat'),
  youtubeAccueil:    ()        => appeler('/api/youtube/accueil'),
  youtubeRecherche:  (q)       => appeler(`/api/youtube/recherche?q=${encodeURIComponent(q)}`),
  // La chaîne d'un YouTuber, dans l'onglet : sa fiche et ses dernières vidéos.
  youtubeChaine:     (id)      => appeler(`/api/youtube/chaine?id=${encodeURIComponent(id)}`),
  // L'interrupteur du lecteur intégré. Il commande aussi la politique de
  // sécurité du serveur : il faut recharger la page pour qu'elle prenne effet.
  spotifyLecteurLocal: (actif) =>
    appeler('/api/spotify/lecteur-local', { method: 'POST', body: { actif } }),

  // Twitch, par le flux implicite — un Client ID public, aucun secret. Le
  // jeton est déposé par la fenêtre de connexion ; la page principale ne le
  // voit jamais et se contente de demander si le compte est lié.
  twitchEtat:        ()        => appeler('/api/twitch/etat'),
  twitchConnexion:   ()        => appeler('/api/twitch/connexion', { method: 'POST', body: {} }),
  twitchVerifier:    ()        => appeler('/api/twitch/verifier', { method: 'POST', body: {} }),
  twitchDeconnexion: ()        => appeler('/api/twitch/deconnexion', { method: 'POST', body: {} }),
  twitchDirects:     ()        => appeler('/api/twitch/directs'),
  twitchSuivies:     ()        => appeler('/api/twitch/suivies'),
  twitchRecherche:   (q)       => appeler(`/api/twitch/recherche?q=${encodeURIComponent(q)}`),
  // La navigation, chez nous : `twitch.tv` refuse le cadre, seul le lecteur
  // l'accepte. Ces trois-là remplacent le site — catégories, catégorie, chaîne.
  twitchCategories:  ()        => appeler('/api/twitch/categories'),
  twitchCategorie:   (id)      => appeler(`/api/twitch/categorie?id=${encodeURIComponent(id)}`),
  twitchChaine:      (login)   => appeler(`/api/twitch/chaine?login=${encodeURIComponent(login)}`),

  entretiens:        ()        => appeler('/api/entretiens'),
  entretien:         (id)      => appeler(`/api/entretien/${id}`),
  entretienRepondre: (id, reponse) =>
    appeler(`/api/entretien/${id}/repondre`, { method: 'POST', body: { reponse } }),
  entretienDebrief:  (id)      => appeler(`/api/entretien/${id}/debrief`, { method: 'POST', body: {} }),
  entretienFiche:    (id)      => appeler(`/api/entretien/${id}/fiche`, { method: 'POST', body: {} }),
  entretienReset:    (id)      => appeler(`/api/entretien/${id}`, { method: 'DELETE' }),
  // Cartes à réviser : chaque appel en AJOUTE dix sans reprendre les
  // précédentes, pour réviser sur plusieurs jours.
  entretienNotions:  (id, type) => appeler(`/api/entretien/${id}/notions`, { method: 'POST', body: { type } }),
  entretienNotionSue:(id, i, su) =>
    appeler(`/api/entretien/${id}/notions/${i}`, { method: 'PATCH', body: { su } }),

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
  // Rédige la relance d'une candidature sans réponse. Rien n'est enregistré :
  // le courriel se copie et s'envoie depuis la messagerie de l'utilisateur.
  relance:       (id)          => appeler(`/api/relance/${id}`, { method: 'POST', body: {} }),
  // CV taillé pour l'offre + l'écart (ce qu'elle exige et que le CV ne montre pas).
  cvAdapte:      (id)          => appeler(`/api/cv-adapte/${id}`, { method: 'POST', body: {} }),
  genererLettre: (id, options) => appeler(`/api/letter/${id}`, { method: 'POST', body: options ?? {} }),
  majLettre:     (id, contenu) => appeler(`/api/letter/${id}`, { method: 'PATCH', body: { contenu } }),
  urlDocx:       (id)          => `/api/letter/${id}/docx`,
  urlDossier:    (id)          => `/api/letter/${id}/dossier`,
};
