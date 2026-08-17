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
export function versLecteur(saisie, hote = 'localhost', avecCompte = false) {
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
  // LE DOMAINE EST UN CHOIX, PAS UNE FATALITÉ.
  //
  // `youtube-nocookie.com` n'installe pas de traceur — mais il n'emporte pas
  // la session non plus. Sans elle : pas d'historique, pas d'abonnements, et
  // une vidéo réservée aux connectés reste noire.
  //
  // Le compromis appartient à qui regarde, pas à qui écrit le code. Par
  // défaut on protège ; `avecCompte` bascule sur le domaine ordinaire.
  const domaineYt = avecCompte ? 'https://www.youtube.com' : 'https://www.youtube-nocookie.com';

  const yt = t.match(/(?:youtube\.com\/(?:watch\?v=|live\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return { type: 'YouTube', url: `${domaineYt}/embed/${yt[1]}`, haut: 0 };

  const ytList = t.match(/youtube\.com\/playlist\?list=([\w-]+)/);
  if (ytList) {
    return { type: 'YouTube',
      url: `${domaineYt}/embed/videoseries?list=${ytList[1]}`, haut: 0 };
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

/**
 * UNE ADRESSE TWITCH, TRADUITE EN DESTINATION INTERNE.
 *
 * `versLecteur` sait faire UNE chose d'un lien Twitch : le mettre dans le
 * lecteur. C'est ce qu'il faut pour un direct — et c'est faux pour tout le
 * reste. `twitch.tv/xqc/videos` finissait ainsi en « chaîne xqc en direct »,
 * et `twitch.tv/directory/game/Chess` en tentative de lecture d'une chaîne qui
 * n'existe pas. La seule issue restait d'ouvrir le site, c'est-à-dire de
 * sortir de l'application.
 *
 * Cette fonction dit ce que l'adresse DÉSIGNE ; c'est au panneau de décider
 * quoi en faire — ouvrir une page de chaîne, une catégorie, ou lancer une
 * rediffusion. Elle est pure, donc testable : un lien mal reconnu, autrement,
 * ne se manifeste que par un panneau qui ne bouge pas.
 */
export function destinationTwitch(saisie) {
  const t = String(saisie ?? '').trim();
  if (!/twitch\.tv/i.test(t)) return null;

  const vod = t.match(/twitch\.tv\/videos\/(\d+)/i);
  if (vod) return { type: 'video', id: vod[1] };

  // Le nom d'une catégorie est encodé dans l'adresse — « Just%20Chatting ».
  const jeu = t.match(/twitch\.tv\/directory\/(?:game|category)\/([^/?#]+)/i);
  if (jeu) return { type: 'categorie', nom: decodeURIComponent(jeu[1]).replace(/-/g, ' ') };
  if (/twitch\.tv\/directory\b/i.test(t)) return { type: 'accueil' };

  // `/xqc/videos`, `/xqc/clips`, `/xqc/about` désignent tous la même chaîne :
  // c'est sa page qu'on ouvre, pas un lecteur.
  const chaine = t.match(/twitch\.tv\/([A-Za-z0-9_]{3,25})(?:\/|\?|#|$)/i);
  if (!chaine) return null;
  // Les sections du site ne sont pas des chaînes, et `twitch.tv/settings`
  // ouvrirait une page de chaîne fantôme.
  const RESERVES = new Set(['directory', 'videos', 'settings', 'downloads', 'jobs',
    'p', 'products', 'subs', 'turbo', 'activate', 'login', 'signup', 'search']);
  if (RESERVES.has(chaine[1].toLowerCase())) return null;
  return { type: 'chaine', login: chaine[1].toLowerCase() };
}

/**
 * ROUVRIR L'APPLICATION NE DOIT RIEN LANCER.
 *
 * Cliquer sur un direct dans le panneau Twitch le démarre en `autoplay=true` —
 * c'est bien ce qu'on veut sur le moment. Ce n'est pas ce qu'on veut le
 * lendemain matin au bureau, quand le lecteur se rouvre là où on l'avait
 * laissé et qu'un direct se met à parler tout seul.
 *
 * Ici plutôt que dans la vue, pour la même raison que le reste du module :
 * c'est une règle sur des adresses, elle se teste sans navigateur.
 */
export function sansDemarrageAuto(url) {
  return String(url ?? '')
    .replace(/([?&])autoplay=(?:true|1)\b/g, '$1autoplay=false');
}
