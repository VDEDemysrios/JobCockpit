import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creerAuth, jetonValide, lireCookie } from '../src/auth.js';

const MDP = 'un-mot-de-passe-qui-tient';

/** Fausse requête/réponse Express, réduites à ce que le middleware touche. */
function fausseReponse() {
  const r = {
    code: 200, corps: null, redirection: null, cookies: {},
    status(c) { r.code = c; return r; },
    json(d) { r.corps = d; return r; },
    redirect(u) { r.redirection = u; return r; },
    cookie(n, v, o) { r.cookies[n] = { v, o }; return r; },
    clearCookie(n) { delete r.cookies[n]; return r; },
  };
  return r;
}

const requete = (path, cookie) => ({ path, headers: { cookie }, ip: '10.0.0.1' });

// ------------------------------------------------------------------ jetons

test('un jeton signé est accepté, un jeton bricolé ne l\'est pas', () => {
  const auth = creerAuth({ motDePasse: MDP });
  const res = fausseReponse();
  const app = { get() {}, post(chemin, ...suite) { app[chemin] = suite.at(-1); } };
  auth.monter(app, '/public');

  app['/api/connexion']({ body: { motDePasse: MDP }, ip: '10.0.0.1' }, res);
  const jeton = res.cookies.cockpit_session.v;

  assert.ok(jetonValide(jeton, MDP));
  assert.equal(jetonValide(jeton + 'x', MDP), false, 'signature altérée');
  assert.equal(jetonValide(jeton, 'autre-mot-de-passe'), false, 'autre secret');
  assert.equal(jetonValide('', MDP), false);
  assert.equal(jetonValide('nimportequoi', MDP), false);
});

test('un jeton expiré est refusé', () => {
  const auth = creerAuth({ motDePasse: MDP });
  const res = fausseReponse();
  const app = { get() {}, post(chemin, ...suite) { app[chemin] = suite.at(-1); } };
  auth.monter(app, '/public');
  app['/api/connexion']({ body: { motDePasse: MDP }, ip: '10.0.0.1' }, res);

  const jeton = res.cookies.cockpit_session.v;
  const dansDeuxMois = Date.now() + 60 * 24 * 60 * 60 * 1000;
  assert.equal(jetonValide(jeton, MDP, dansDeuxMois), false);
});

// -------------------------------------------------------------- protection

test('sans cookie valide, rien de sensible ne passe', () => {
  const { protection } = creerAuth({ motDePasse: MDP });

  // Une page : on renvoie vers la porte d'entrée.
  const page = fausseReponse();
  protection(requete('/'), page, () => assert.fail('la page ne doit pas être servie'));
  assert.equal(page.redirection, '/connexion');

  // Le CV, servi en statique, doit être protégé comme le reste.
  const cv = fausseReponse();
  protection(requete('/api/cv/fichier'), cv, () => assert.fail('le CV ne doit pas être servi'));
  assert.equal(cv.code, 401);

  // Une requête d'API reçoit du JSON, pas du HTML.
  const api = fausseReponse();
  protection(requete('/api/offers'), api, () => assert.fail('l\'API ne doit pas répondre'));
  assert.equal(api.code, 401);
  assert.equal(api.corps.ok, false);
});

test('la page de connexion et sa feuille de style restent accessibles', () => {
  const { protection } = creerAuth({ motDePasse: MDP });
  for (const chemin of ['/connexion', '/api/connexion', '/style.css']) {
    let passe = false;
    protection(requete(chemin), fausseReponse(), () => { passe = true; });
    assert.ok(passe, `${chemin} doit rester joignable avant connexion`);
  }
});

test('avec un cookie valide, tout passe', () => {
  const auth = creerAuth({ motDePasse: MDP });
  const res = fausseReponse();
  const app = { get() {}, post(chemin, ...suite) { app[chemin] = suite.at(-1); } };
  auth.monter(app, '/public');
  app['/api/connexion']({ body: { motDePasse: MDP }, ip: '10.0.0.1' }, res);

  let passe = false;
  auth.protection(requete('/api/offers', `cockpit_session=${res.cookies.cockpit_session.v}`),
    fausseReponse(), () => { passe = true; });
  assert.ok(passe);
});

// Le mode local doit rester exactement ce qu'il était : aucune porte, aucune
// gêne. C'est server.js qui garantit qu'on n'écoute alors que sur 127.0.0.1.
test('sans mot de passe configuré, la porte est ouverte', () => {
  const auth = creerAuth({ motDePasse: '' });
  assert.equal(auth.actif, false);
  let passe = false;
  auth.protection(requete('/api/offers'), fausseReponse(), () => { passe = true; });
  assert.ok(passe);
});

// ------------------------------------------------------------------ frein

test('les tentatives répétées finissent bloquées', () => {
  const auth = creerAuth({ motDePasse: MDP });
  const app = { get() {}, post(chemin, ...suite) { app[chemin] = suite.at(-1); } };
  auth.monter(app, '/public');

  let derniere;
  for (let i = 0; i < 12; i++) {
    derniere = fausseReponse();
    app['/api/connexion']({ body: { motDePasse: 'raté' }, ip: '10.0.0.2' }, derniere);
  }
  assert.equal(derniere.code, 429, 'le frein doit finir par se déclencher');

  // Et le bon mot de passe ne doit pas contourner le blocage.
  const apres = fausseReponse();
  app['/api/connexion']({ body: { motDePasse: MDP }, ip: '10.0.0.2' }, apres);
  assert.equal(apres.code, 429);
});

// ----------------------------------------------------------------- cookies

test('lireCookie retrouve la bonne valeur parmi plusieurs', () => {
  assert.equal(lireCookie('a=1; cockpit_session=abc.def; b=2', 'cockpit_session'), 'abc.def');
  assert.equal(lireCookie('', 'cockpit_session'), null);
  assert.equal(lireCookie(undefined, 'cockpit_session'), null);
});
