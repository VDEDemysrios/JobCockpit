// Porte d'entrée par mot de passe.
//
// POURQUOI, ET POURQUOI SI PEU
// ----------------------------
// Tant que Job Cockpit écoutait sur 127.0.0.1, sa sécurité tenait dans cette
// adresse : personne d'autre ne pouvait l'atteindre. Une URL publique fait
// tomber cette protection d'un coup — et la base contient le CV, les
// candidatures, les notes et les lettres.
//
// Ce module rétablit une porte, et rien de plus : UN mot de passe, partagé,
// pour UN utilisateur. Ce n'est pas un système de comptes, et il ne faut pas
// s'en servir comme tel : le jour où quelqu'un d'autre doit avoir son propre
// accès, c'est le socle Supabase du HANDOFF §5 qu'il faut reprendre, pas ce
// fichier qu'il faut étendre.
//
// Aucune dépendance : un cookie signé en HMAC tient en trente lignes, et
// ajouter une bibliothèque de sessions pour un seul utilisateur serait
// disproportionné — c'est le même raisonnement que pour l'analyse XML des flux.
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const COOKIE = 'cockpit_session';

/** Durée d'une session. Assez longue pour ne pas se reconnecter chaque jour. */
const DUREE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Au-delà, on refuse les tentatives un moment. Une URL publique finit par
 * être trouvée par des robots : sans ce frein, un mot de passe faible tombe
 * en quelques heures.
 */
const ESSAIS_MAX = 8;
const BLOCAGE_MS = 15 * 60 * 1000;

/**
 * Secret de signature. Dérivé du mot de passe : changer le mot de passe
 * invalide donc toutes les sessions en cours, ce qui est le comportement
 * attendu quand on le change parce qu'il a fuité.
 *
 * Un sel aléatoire par démarrage aurait déconnecté à chaque redéploiement.
 */
function secret(motDePasse) {
  return createHmac('sha256', 'job-cockpit/session/v1').update(motDePasse).digest();
}

/** Jeton « expiration.signature », en base64url. */
function signerJeton(motDePasse, expireA) {
  const charge = String(expireA);
  const signature = createHmac('sha256', secret(motDePasse)).update(charge).digest('base64url');
  return `${Buffer.from(charge).toString('base64url')}.${signature}`;
}

/**
 * Vérifie un jeton. Comparaison à temps constant : une comparaison naïve
 * fuit la signature attendue, octet par octet, à qui mesure le temps de
 * réponse.
 */
export function jetonValide(jeton, motDePasse, maintenant = Date.now()) {
  if (typeof jeton !== 'string' || !jeton.includes('.')) return false;

  const [chargeB64, signature] = jeton.split('.');
  let charge;
  try {
    charge = Buffer.from(chargeB64, 'base64url').toString('utf8');
  } catch {
    return false;
  }

  const expireA = Number(charge);
  if (!Number.isFinite(expireA) || expireA < maintenant) return false;

  const attendue = createHmac('sha256', secret(motDePasse)).update(charge).digest('base64url');
  const a = Buffer.from(signature ?? '', 'utf8');
  const b = Buffer.from(attendue, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Compare deux mots de passe à temps constant. */
function motDePasseCorrect(fourni, attendu) {
  const a = Buffer.from(String(fourni ?? ''), 'utf8');
  const b = Buffer.from(attendu, 'utf8');
  // Les longueurs différentes sont déjà une information ; on les égalise en
  // hachant les deux côtés, ce qui rend la comparaison réellement constante.
  const ha = createHmac('sha256', 'cmp').update(a).digest();
  const hb = createHmac('sha256', 'cmp').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Lit un cookie dans l'en-tête brut, sans dépendance. */
export function lireCookie(entete, nom) {
  for (const morceau of String(entete ?? '').split(';')) {
    const [cle, ...reste] = morceau.trim().split('=');
    if (cle === nom) return decodeURIComponent(reste.join('='));
  }
  return null;
}

/**
 * Construit le middleware et les routes de connexion.
 *
 * @param {object} options
 * @param {string} options.motDePasse   secret attendu ; vide = porte ouverte
 * @param {boolean} [options.securise]  pose le drapeau Secure sur le cookie
 * @returns {{actif: boolean, protection: Function, monter: Function}}
 */
export function creerAuth({ motDePasse, securise = true }) {
  // Sans mot de passe, l'application reste ce qu'elle était : un outil local
  // sans porte. C'est server.js qui garantit qu'on n'écoute alors que sur
  // 127.0.0.1 — les deux règles ensemble rendent l'exposition accidentelle
  // impossible.
  if (!motDePasse) {
    return { actif: false, protection: (req, res, suite) => suite(), monter() {} };
  }

  const tentatives = new Map();   // ip -> { nombre, jusqua }

  function frein(ip) {
    const t = tentatives.get(ip);
    if (!t) return 0;
    if (Date.now() > t.jusqua) { tentatives.delete(ip); return 0; }
    return t.nombre >= ESSAIS_MAX ? Math.ceil((t.jusqua - Date.now()) / 1000) : 0;
  }

  function noterEchec(ip) {
    const t = tentatives.get(ip) ?? { nombre: 0, jusqua: 0 };
    t.nombre += 1;
    t.jusqua = Date.now() + BLOCAGE_MS;
    tentatives.set(ip, t);
  }

  const CHEMINS_LIBRES = new Set(['/connexion', '/connexion.html', '/api/connexion', '/style.css']);

  function protection(req, res, suite) {
    if (CHEMINS_LIBRES.has(req.path)) return suite();
    if (jetonValide(lireCookie(req.headers.cookie, COOKIE), motDePasse)) return suite();

    // Une requête d'API reçoit du JSON, pas une page de connexion : le
    // dashboard afficherait sinon du HTML dans un toast d'erreur.
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ ok: false, error: 'Session expirée — recharge la page pour te reconnecter.' });
    }
    return res.redirect('/connexion');
  }

  // Le corps JSON est déjà analysé par le serveur avant ce montage : ces
  // routes n'ont donc pas besoin de connaître express.
  function monter(app, dossierPublic) {
    app.get('/connexion', (req, res) => res.sendFile(`${dossierPublic}/connexion.html`));

    app.post('/api/connexion', (req, res) => {
      const ip = req.ip ?? 'inconnue';
      const attente = frein(ip);
      if (attente) {
        return res.status(429).json({ ok: false, error: `Trop de tentatives. Réessaie dans ${Math.ceil(attente / 60)} minutes.` });
      }

      if (!motDePasseCorrect(req.body?.motDePasse, motDePasse)) {
        noterEchec(ip);
        return res.status(401).json({ ok: false, error: 'Mot de passe incorrect.' });
      }

      tentatives.delete(ip);
      const expireA = Date.now() + DUREE_MS;
      res.cookie(COOKIE, signerJeton(motDePasse, expireA), {
        httpOnly: true,          // inaccessible au JavaScript de la page
        sameSite: 'lax',         // pas envoyé depuis un autre site
        secure: securise,        // HTTPS uniquement une fois en ligne
        maxAge: DUREE_MS,
      });
      res.json({ ok: true });
    });

    app.post('/api/deconnexion', (req, res) => {
      res.clearCookie(COOKIE);
      res.json({ ok: true });
    });
  }

  return { actif: true, protection, monter };
}

/** Mot de passe aléatoire, proposé dans les messages d'aide au déploiement. */
export function motDePasseSuggere() {
  return randomBytes(18).toString('base64url');
}
