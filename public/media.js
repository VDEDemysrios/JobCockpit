// Reconnaître un lien de lecteur, et en faire une adresse intégrable.
//
// Module PUR : ni DOM, ni réseau. C'est ce qui le rend testable — la logique
// vivait dans la vue, donc dans un fichier qu'aucun test ne peut charger, et
// un lien mal reconnu ne se manifeste que par un cadre vide.
//
// LES CADRES PLUTÔT QUE LES SCRIPTS. Aucun script tiers ne s'exécute dans la
// page : la politique de sécurité garde script-src à 'self', et seuls les
// domaines de ces trois lecteurs sont autorisés en frame-src. Un cadre a son
// propre contexte — il ne peut ni lire le tableau de bord, ni toucher à la
// base.
//
// L'HÔTE EST UN PARAMÈTRE, pas une lecture de `location`. Twitch exige un
// `parent` correspondant à la page qui affiche le lecteur, et une fonction
// qui va chercher elle-même son environnement cesse d'être testable.

/** Reconnaît ce qu'on colle et en fait une adresse de lecteur intégrable. */
export function versLecteur(saisie, hote = 'localhost') {
  const t = String(saisie ?? '').trim();
  if (!t) return null;

  // Spotify : piste, album, playlist, podcast. L'identifiant est le dernier
  // segment, éventuellement suivi de paramètres.
  const spot = t.match(/spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/);
  if (spot) {
    return { type: 'Spotify',
      url: `https://open.spotify.com/embed/${spot[1]}/${spot[2]}`, haut: 352 };
  }
  const spotUri = t.match(/^spotify:(track|album|playlist|episode|show|artist):([A-Za-z0-9]+)$/);
  if (spotUri) {
    return { type: 'Spotify',
      url: `https://open.spotify.com/embed/${spotUri[1]}/${spotUri[2]}`, haut: 352 };
  }

  // YouTube : lien long, court, ou direct. `-nocookie` par défaut — pas de
  // raison de laisser un traceur s'installer pour écouter de la musique.
  const yt = t.match(/(?:youtube\.com\/(?:watch\?v=|live\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return { type: 'YouTube', url: `https://www.youtube-nocookie.com/embed/${yt[1]}`, haut: 0 };

  const ytList = t.match(/youtube\.com\/playlist\?list=([\w-]+)/);
  if (ytList) {
    return { type: 'YouTube',
      url: `https://www.youtube-nocookie.com/embed/videoseries?list=${ytList[1]}`, haut: 0 };
  }

  // Twitch : la chaîne, ou une rediffusion. `parent` est OBLIGATOIRE et doit
  // correspondre à l'hôte qui affiche le cadre, sans quoi Twitch refuse.
  const parent = hote || 'localhost';
  const twVod = t.match(/twitch\.tv\/videos\/(\d+)/);
  if (twVod) {
    return { type: 'Twitch',
      url: `https://player.twitch.tv/?video=${twVod[1]}&parent=${parent}&autoplay=false`, haut: 0 };
  }
  const tw = t.match(/twitch\.tv\/([A-Za-z0-9_]+)/);
  if (tw) {
    return { type: 'Twitch',
      url: `https://player.twitch.tv/?channel=${tw[1]}&parent=${parent}&autoplay=false`, haut: 0 };
  }

  // Un nom seul : on suppose une chaîne Twitch, c'est le cas le plus courant.
  if (/^[A-Za-z0-9_]{3,25}$/.test(t)) {
    return { type: 'Twitch',
      url: `https://player.twitch.tv/?channel=${t}&parent=${parent}&autoplay=false`, haut: 0 };
  }
  return null;
}
