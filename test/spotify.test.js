// SPOTIFY PKCE : le secret jetable, et les refus traduits.
//
// Le flux « code d'autorisation » ordinaire exige un `client_secret`, qu'il
// faudrait stocker et protéger. PKCE le remplace par un secret fabriqué à
// chaque connexion : l'application envoie l'EMPREINTE d'une chaîne aléatoire,
// puis prouve son identité en révélant la chaîne. Un code intercepté ne sert
// donc à rien sans elle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  fabriquerDefi, urlAutorisation, echangerCode, rafraichir, estExpire,
  appeler, resumeLecture, corpsDeLecture, resumeAppareils,
  porteesManquantes, fusionnerPortees, PORTEES, PORTEES_LECTEUR, PORTEES_ECRITURE,
  nombreDePistes, pisteDeLEntree, resumeFile,
} from '../src/spotify.js';

test('le défi est bien l\'empreinte du vérificateur', () => {
  const { verificateur, defi } = fabriquerDefi();
  const attendu = createHash('sha256').update(verificateur).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(defi, attendu, 'Spotify recalcule cette empreinte : elle doit correspondre');
  assert.ok(verificateur.length >= 43, 'PKCE exige au moins 43 caractères');
  assert.ok(!/[+/=]/.test(defi), 'base64 URL-safe : ni +, ni /, ni =');
});

test('deux connexions ne partagent jamais le même vérificateur', () => {
  assert.notEqual(fabriquerDefi().verificateur, fabriquerDefi().verificateur);
});

/** Aucun secret ne doit apparaître dans l'URL d'autorisation. */
test('l\'URL d\'autorisation ne porte que des valeurs publiques', () => {
  const u = new URL(urlAutorisation({
    clientId: 'abc123', redirection: 'http://127.0.0.1:3000/spotify/retour',
    defi: 'DEFI', etat: 'xyz',
  }));
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('code_challenge'), 'DEFI');
  assert.equal(u.searchParams.get('client_id'), 'abc123');
  assert.ok(!u.search.includes('secret'), 'aucun secret ne circule');
  assert.ok(!u.search.includes('code_verifier'),
    'le vérificateur ne part PAS à cette étape : c\'est tout le principe de PKCE');
});

/**
 * ON NE DEMANDE QUE CE QU'ON SAIT JUSTIFIER — ET ON DIT CE QU'ON SUBIT.
 *
 * `user-read-email` et `user-read-private` ne servent à RIEN dans ce projet :
 * ni l'adresse ni le profil ne sont lus une seule fois. Le SDK de Spotify
 * refuse de s'initialiser sans elles, point. Elles sont donc demandées à
 * contrecœur, et uniquement parce que le lecteur intégré a été explicitement
 * voulu — ce test existe pour que personne ne les prenne un jour pour une
 * autorisation utile, et n'aille bâtir dessus.
 *
 * ET LA RÈGLE « RIEN QUI ÉCRIVE » A ÉTÉ ENTAMÉE, VOLONTAIREMENT. Ajouter un
 * morceau à une playlist demande exactement ce que ce test interdisait. Deux
 * portées ont donc été accordées — et deux seulement, pour UNE action
 * déclenchée par un clic. Le reste de la liste noire est intact : rien ne
 * supprime, rien ne renomme, rien ne touche à la bibliothèque.
 */
test('les portées écrivent le strict nécessaire, et rien d\'autre', () => {
  // CE QUI RESTE INTERDIT. La liste s'est raccourcie, pas dissoute : ajouter
  // un morceau à une playlist ne donne aucun droit de supprimer, de renommer,
  // de toucher à la bibliothèque, aux abonnements ou aux images.
  for (const interdite of [
    'user-library-modify', 'ugc-image-upload', 'user-follow-modify',
  ]) {
    assert.ok(!PORTEES.includes(interdite),
      `« ${interdite} » n\'est justifié par aucune fonction`);
  }
  assert.ok(PORTEES.includes('user-modify-playback-state'), 'piloter la lecture est le propos');

  // Les trois du lecteur intégré, épinglées pour qu'un retrait du lecteur
  // emporte aussi ces demandes.
  for (const x of PORTEES_LECTEUR) {
    assert.ok(PORTEES.includes(x), `le lecteur intégré exige « ${x} »`);
  }

  // Et les deux qui ÉCRIVENT, demandées pour UNE action explicite.
  for (const x of PORTEES_ECRITURE) {
    assert.ok(PORTEES.includes(x), `l\'ajout à une playlist exige « ${x} »`);
  }
});

/**
 * UN COMPTE LIÉ AVANT LE LECTEUR INTÉGRÉ N'A PAS `streaming`.
 *
 * Il continue de piloter un appareil distant très bien — mais le SDK échoue en
 * `authentication_error`, un message que personne ne peut relier à « ton
 * autorisation date d'avant ». Sans ce contrôle, la seule issue visible serait
 * de délier et relier au hasard.
 */
test('les portées manquantes d\'un ancien jeton sont nommées', () => {
  const ancien = 'user-read-playback-state user-modify-playback-state';
  assert.deepEqual(porteesManquantes(ancien).sort(),
    ['streaming', 'user-read-email', 'user-read-private']);

  assert.deepEqual(porteesManquantes(PORTEES), [], 'une autorisation neuve ne manque de rien');
  assert.deepEqual(porteesManquantes('').length, 3, 'aucune portée : tout manque');
  assert.deepEqual(porteesManquantes(null).length, 3, 'et un jeton sans portées connues aussi');
});

/**
 * Spotify ne renvoie pas les portées à chaque rafraîchissement. Les écraser
 * par du vide ferait croire, une heure après la liaison, que l'autorisation
 * est incomplète — et l'interface réclamerait une reconnexion inutile.
 */
test('un rafraîchissement muet ne perd pas les portées', () => {
  const garde = fusionnerPortees({ acces: 'A', portees: '' }, { portees: 'streaming' });
  assert.equal(garde.portees, 'streaming');

  const remplace = fusionnerPortees({ acces: 'A', portees: 'streaming user-read-email' },
    { portees: 'streaming' });
  assert.equal(remplace.portees, 'streaming user-read-email',
    'quand Spotify les renvoie, ce sont elles qui font foi');
});

test('l\'échange envoie le vérificateur, jamais un secret', async () => {
  let corpsEnvoye = null;
  const faux = async (url, o) => {
    corpsEnvoye = o.body;
    return {
      ok: true, status: 200,
      json: async () => ({ access_token: 'A', refresh_token: 'R', expires_in: 3600 }),
    };
  };
  const j = await echangerCode({
    clientId: 'c', redirection: 'r', code: 'CODE', verificateur: 'VERIF',
  }, faux);

  assert.equal(corpsEnvoye.get('code_verifier'), 'VERIF');
  assert.ok(!corpsEnvoye.has('client_secret'));
  assert.equal(j.acces, 'A');
  assert.equal(j.refresh, 'R');
  assert.ok(j.expireLe > Date.now(), 'la date d\'expiration doit être future');
});

/**
 * MARGE SUR L'EXPIRATION. Un jeton qui expire pendant le trajet de la requête
 * produit un 401 qu'on aurait pu éviter : on le considère mort une minute
 * avant l'heure.
 */
test('un jeton est considéré expiré avec une minute d\'avance', async () => {
  const faux = async () => ({
    ok: true, status: 200,
    json: async () => ({ access_token: 'A', expires_in: 3600 }),
  });
  const j = await echangerCode({ clientId: 'c', redirection: 'r', code: 'x', verificateur: 'v' }, faux);
  assert.ok(j.expireLe <= Date.now() + 3600 * 1000 - 59000);
  assert.ok(!estExpire(j));
  assert.ok(estExpire({ acces: 'A', expireLe: Date.now() - 1 }));
  assert.ok(estExpire(null));
});

/** Spotify ne renvoie pas toujours un nouveau jeton de rafraîchissement. */
test('le rafraîchissement garde l\'ancien jeton si aucun n\'est renvoyé', async () => {
  const faux = async () => ({
    ok: true, status: 200,
    json: async () => ({ access_token: 'NOUVEAU', expires_in: 3600 }),
  });
  const j = await rafraichir({ clientId: 'c', refresh: 'ANCIEN' }, faux);
  assert.equal(j.acces, 'NOUVEAU');
  assert.equal(j.refresh, 'ANCIEN', 'sans lui, la session serait perdue au bout d\'une heure');
});

/**
 * LES REFUS DE SPOTIFY NE VEULENT RIEN DIRE POUR QUI LES REÇOIT.
 * « 403 » n'apprend rien à quelqu'un qui voulait de la musique : sur une
 * commande du lecteur, ça veut dire qu'il faut Premium, et il faut le dire.
 */
test('les refus du lecteur sont traduits en français', async () => {
  const refus = (n, corps) => async () => ({ status: n, ok: false, json: async () => corps });

  await assert.rejects(
    () => appeler('/me/player/play', { acces: 'a' },
      refus(403, { error: { reason: 'PREMIUM_REQUIRED', message: 'Player command failed' } })),
    /Premium/);
  await assert.rejects(
    () => appeler('/me/player/play', { acces: 'a' },
      refus(404, { error: { reason: 'NO_ACTIVE_DEVICE', message: 'No active device found' } })),
    /appareil actif/);
  await assert.rejects(
    () => appeler('/me/player', { acces: 'a' }, refus(404, {})),
    /appareil actif/, 'un 404 muet sur le lecteur reste un défaut d\'appareil');
  await assert.rejects(() => appeler('/x', { acces: 'a' }, refus(401, {})), (e) => e.expire === true);
});

/**
 * ET SURTOUT : NE PAS TRADUIRE CE QU'ON NE SAIT PAS.
 *
 * Les deux refus étaient écrits en dur — tout 403 devenait « il faut
 * Premium ». Quand Spotify a renommé `/playlists/{id}/tracks` en `/items`,
 * l'ancien chemin s'est mis à répondre 403 : l'application annonçait donc
 * « cette action demande un compte Premium » à un abonné Premium, sur un
 * simple clic pour ouvrir une playlist. Un message faux fait chercher la panne
 * là où elle n'est pas — ici, du côté de l'abonnement.
 */
test('un refus hors lecteur ne parle jamais de Premium', async () => {
  const refus = (n, corps) => async () => ({ status: n, ok: false, json: async () => corps });

  await assert.rejects(
    () => appeler('/playlists/abc/tracks', { acces: 'a' },
      refus(403, { error: { status: 403, message: 'Forbidden' } })),
    (e) => !/Premium/.test(e.message) && /Forbidden/.test(e.message));

  await assert.rejects(
    () => appeler('/playlists/abc', { acces: 'a' },
      refus(404, { error: { message: 'Resource not found' } })),
    (e) => !/appareil/.test(e.message) && /Resource not found/.test(e.message));
});

/**
 * LE RENOMMAGE QUI A VIDÉ TOUTES LES PLAYLISTS, VERROUILLÉ ICI.
 *
 * Spotify a renommé `playlist.tracks` en `playlist.items` et l'entrée `track`
 * en `item`, sans changer de version d'API. Résultat à l'écran : « 0 titre »
 * sous chacune des 36 playlists, et une liste vide à l'ouverture — sans la
 * moindre erreur. Les deux lectures acceptent les deux noms.
 */
test('le compte et les pistes se lisent sous les deux noms', () => {
  assert.equal(nombreDePistes({ items: { total: 14 } }), 14, 'la forme actuelle');
  assert.equal(nombreDePistes({ tracks: { total: 14 } }), 14, 'la forme d\'avant');
  assert.equal(nombreDePistes({}), 0, 'et une playlist sans compteur n\'est pas « undefined »');

  assert.equal(pisteDeLEntree({ item: { uri: 'u' } })?.uri, 'u');
  assert.equal(pisteDeLEntree({ track: { uri: 'u' } })?.uri, 'u');
  assert.equal(pisteDeLEntree({}), null, 'une entrée vide ne devient pas un objet vide');
});

/** 204 : « rien ne joue ». C'est une réponse normale, pas une panne. */
test('« rien ne joue » n\'est pas une erreur', async () => {
  const vide = async () => ({ status: 204, ok: true });
  assert.equal(await appeler('/me/player', { acces: 'a' }, vide), null);
  assert.equal(resumeLecture(null).joue, false);
  assert.equal(resumeLecture(null).titre, undefined, 'aucun morceau à décrire');
});

test('le résumé de lecture garde l\'essentiel', () => {
  const r = resumeLecture({
    is_playing: true,
    progress_ms: 30000,
    device: { name: 'Portable' },
    item: {
      name: 'Titre', duration_ms: 200000, uri: 'spotify:track:x',
      artists: [{ name: 'A' }, { name: 'B' }],
      album: { name: 'Album', images: [{ url: 'http://p' }] },
    },
  });
  assert.equal(r.joue, true);
  assert.equal(r.artistes, 'A, B');
  assert.equal(r.pochette, 'http://p');
  assert.equal(r.appareil, 'Portable');
});

/**
 * LES TROIS RÉGLAGES SONT DANS LA MÊME RÉPONSE, ET ILS DOIVENT EN SORTIR.
 *
 * Volume, lecture aléatoire et répétition arrivent avec l'état du lecteur : les
 * omettre obligeait l'interface à les SUPPOSER, et un curseur qui affiche 50 %
 * pendant que l'enceinte est à 20 % ment à chaque regard.
 */
test('le résumé rapporte le volume, l\'aléatoire et la répétition', () => {
  const r = resumeLecture({
    is_playing: true, shuffle_state: true, repeat_state: 'track',
    device: { name: 'Enceinte', id: 'D1', volume_percent: 23 },
    item: { name: 'T', artists: [], album: {}, duration_ms: 1, uri: 'u' },
  });
  assert.equal(r.aleatoire, true);
  assert.equal(r.repetition, 'track');
  assert.equal(r.volume, 23);
  assert.equal(r.appareilId, 'D1');
});

/**
 * Un appareil qui ne sait pas régler son volume rend `null`, jamais 0. Zéro
 * voudrait dire « coupé », ce qui est une autre affirmation — et afficherait
 * un curseur à fond à gauche sur une télévision qui joue à plein volume.
 */
test('un volume inconnu vaut null, pas zéro', () => {
  const r = resumeLecture({ device: { name: 'TV' }, item: null });
  assert.equal(r.volume, null);
});

/**
 * LE DÉFAUT QUI EMPÊCHAIT DE LANCER UNE PLAYLIST.
 *
 * `uris` prend des morceaux ; `context_uri` prend un contexte qu'on parcourt.
 * Le panneau envoyait `uris` pour tout : un titre partait, une playlist était
 * refusée en 400, et rien à l'écran ne disait pourquoi l'un marchait et
 * l'autre non.
 */
test('un morceau part en uris, une playlist en context_uri', () => {
  assert.deepEqual(corpsDeLecture({ uri: 'spotify:track:abc' }), { uris: ['spotify:track:abc'] });

  for (const uri of ['spotify:playlist:p1', 'spotify:album:a1', 'spotify:artist:x1']) {
    const corps = corpsDeLecture({ uri });
    assert.equal(corps.context_uri, uri, `${uri} doit partir en contexte`);
    assert.ok(!corps.uris, 'un contexte n\'est pas une liste de morceaux');
  }
});

/** Sans URI, on reprend où l'on en était : c'est le bouton « lecture ». */
test('reprendre la lecture n\'envoie aucun corps', () => {
  assert.equal(corpsDeLecture({}), undefined);
  assert.equal(corpsDeLecture(), undefined);
});

/**
 * `offset` n'a de sens que dans un contexte — c'est lui qui évite qu'une
 * playlist relancée « au hasard » reparte trois fois sur le même titre.
 */
test('le rang de départ ne s\'applique qu\'à un contexte', () => {
  assert.deepEqual(corpsDeLecture({ uri: 'spotify:playlist:p', depart: 12 }),
    { context_uri: 'spotify:playlist:p', offset: { position: 12 } });
  assert.deepEqual(corpsDeLecture({ uri: 'spotify:track:t', depart: 12 }),
    { uris: ['spotify:track:t'] });
  assert.ok(!corpsDeLecture({ uri: 'spotify:playlist:p', depart: 0 }).offset,
    'commencer au début n\'a pas besoin d\'être demandé');
});

/**
 * LE MORCEAU DANS SON ALBUM — POURQUOI « SUIVANT » NE MARCHAIT PAS.
 *
 * Lancé seul, un titre part en `{uris:[…]}` : Spotify en fait une file d'UN
 * élément, et « suivant »/« précédent » n'ont rien où aller — mesuré, ni le
 * SDK ni l'API REST n'avancent. Joué DANS le contexte de son album, la lecture
 * continue et les deux boutons fonctionnent. `offset` par URI démarre l'album
 * pile sur ce morceau, pas à son début.
 */
test('un morceau lancé avec son album garde un « suivant »', () => {
  assert.deepEqual(
    corpsDeLecture({ uri: 'spotify:track:t', contexte: 'spotify:album:a' }),
    { context_uri: 'spotify:album:a', offset: { uri: 'spotify:track:t' } });

  // Sans album connu, on retombe sur le morceau seul — mieux qu'une erreur.
  assert.deepEqual(corpsDeLecture({ uri: 'spotify:track:t', contexte: null }),
    { uris: ['spotify:track:t'] });
  assert.deepEqual(corpsDeLecture({ uri: 'spotify:track:t', contexte: '' }),
    { uris: ['spotify:track:t'] });

  // Le contexte ne détourne PAS la lecture d'une playlist : elle reste jouée
  // comme contexte, à son rang.
  assert.deepEqual(
    corpsDeLecture({ uri: 'spotify:playlist:p', depart: 5, contexte: 'spotify:album:a' }),
    { context_uri: 'spotify:playlist:p', offset: { position: 5 } });
});

test('les appareils sont réduits à ce qu\'un menu affiche', () => {
  const a = resumeAppareils({ devices: [
    { id: '1', name: 'Portable', type: 'Computer', is_active: true, volume_percent: 40 },
    { id: '2', name: 'TV', type: 'TV', is_active: false },
  ] });
  assert.equal(a.length, 2);
  assert.equal(a[0].actif, true);
  assert.equal(a[1].volume, null, 'un volume absent n\'est pas un volume nul');
  assert.deepEqual(resumeAppareils(null), [], 'aucun appareil n\'est un cas normal');
});

/**
 * LA FILE QUI RÉPÈTE DIX FOIS LE MÊME MORCEAU.
 *
 * Constaté à l'écran : « Ce qui vient » affichait le titre en cours, dix fois
 * d'affilée. La donnée arrive comme ça — quand un morceau est lancé SEUL,
 * sans playlist ni album, Spotify n'a rien à annoncer après lui et renvoie
 * dix fois le morceau courant plutôt qu'une file vide. Mesuré : `queue` de
 * longueur 10, une seule URI distincte, `context` à `null`.
 */
test('une file qui ne répète que le morceau en cours est une file vide', () => {
  const t = (uri) => ({ uri, name: 'X', artists: [], album: {} });
  const r = resumeFile({
    currently_playing: t('spotify:track:A'),
    queue: Array.from({ length: 10 }, () => t('spotify:track:A')),
  });
  assert.equal(r.boucle, true);
  assert.deepEqual(r.pistes, [], 'annoncer dix fois le titre en cours est un mensonge');
});

/**
 * ET LA RÈGLE RESTE ÉTROITE. Mettre deux fois le même morceau à la suite est
 * un choix ; l'effacer au motif qu'il se répète effacerait du travail de
 * l'utilisateur. On ne conclut que si TOUT est identique au morceau en cours.
 */
test('une vraie file n\'est jamais escamotée', () => {
  const t = (uri) => ({ uri, name: 'X', artists: [], album: {} });
  const melange = resumeFile({
    currently_playing: t('spotify:track:A'),
    queue: [t('spotify:track:A'), t('spotify:track:B'), t('spotify:track:A')],
  });
  assert.equal(melange.boucle, false);
  assert.equal(melange.pistes.length, 3, 'le même titre deux fois peut être voulu');

  const suite = resumeFile({
    currently_playing: t('spotify:track:A'),
    queue: [t('spotify:track:B'), t('spotify:track:C')],
  });
  assert.equal(suite.boucle, false);
  assert.equal(suite.pistes.length, 2);

  assert.deepEqual(resumeFile(null), { boucle: false, pistes: [] });
  assert.deepEqual(resumeFile({ queue: [] }), { boucle: false, pistes: [] },
    'une file réellement vide n\'est pas une boucle');
});

/**
 * UN COMPTE LIÉ AVANT L'AJOUT AUX PLAYLISTS NE PEUT PAS ÉCRIRE.
 *
 * Spotify refuse alors en 403, un code que l'interface traduit ailleurs par
 * « il faut Premium » — ce qui enverrait chercher au mauvais endroit, et
 * chez quelqu'un qui EST abonné. Il faut donc le détecter avant de proposer
 * l'action.
 */
test('les portées d\'écriture manquantes sont détectées à part', () => {
  const ancien = 'user-read-playback-state streaming user-read-email user-read-private';
  assert.deepEqual(porteesManquantes(ancien, PORTEES_ECRITURE).sort(),
    ['playlist-modify-private', 'playlist-modify-public']);

  assert.deepEqual(porteesManquantes(PORTEES, PORTEES_ECRITURE), [],
    'une autorisation neuve peut écrire');

  // Les deux contrôles sont INDÉPENDANTS : un jeton peut savoir jouer sans
  // savoir ranger, et l'interface doit pouvoir le dire séparément.
  const sansEcriture = 'streaming user-read-email user-read-private';
  assert.deepEqual(porteesManquantes(sansEcriture), [], 'le lecteur, lui, marche');
  assert.equal(porteesManquantes(sansEcriture, PORTEES_ECRITURE).length, 2);
});
