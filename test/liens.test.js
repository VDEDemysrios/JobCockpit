// LA VÉRIFICATION DES LIENS, ET SES DEUX PIÈGES.
//
// Ces tests protègent une décision prise après mesure sur les offres réelles,
// pas d'après ce qui semblait raisonnable. Les deux méthodes évidentes — lire
// la page, ou se fier à la disparition des collectes — se sont révélées
// fausses, et chacune aurait supprimé des offres vivantes sans lever la
// moindre erreur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifierLien, verifierOffres, aVerifier } from '../src/liens.js';

/** Un `fetch` de laboratoire : à telle URL, telle réponse. */
function fauxFetch(table) {
  return async (url) => {
    const r = table[url];
    if (r instanceof Error) throw r;
    if (r === undefined) throw new Error('URL non prévue : ' + url);
    return { status: r.status, url, text: async () => r.corps ?? '' };
  };
}

/**
 * SEUL UN 404 OU UN 410 CONCLUT.
 *
 * Jooble répond 403 à toute requête automatisée : ses 56 offres seraient
 * toutes déclarées mortes si un refus valait disparition. Un 429 ou un 500
 * disent que le site se protège ou tombe — l'offre n'en sait rien.
 */
test('un refus ou une panne du site ne tuent pas l\'offre', async () => {
  const f = fauxFetch({
    'https://a/404': { status: 404 },
    'https://a/410': { status: 410 },
    'https://a/403': { status: 403 },
    'https://a/429': { status: 429 },
    'https://a/500': { status: 500 },
    'https://a/200': { status: 200 },
  });
  assert.equal((await verifierLien('https://a/404', f)).etat, 'morte');
  assert.equal((await verifierLien('https://a/410', f)).etat, 'morte');
  assert.equal((await verifierLien('https://a/200', f)).etat, 'vivante');
  for (const code of [403, 429, 500]) {
    assert.equal((await verifierLien(`https://a/${code}`, f)).etat, 'indetermine',
      `HTTP ${code} ne prouve rien sur l'offre`);
  }
});

/**
 * LE PIÈGE DU MESSAGE DANS LA PAGE.
 *
 * Mesuré sur les huit offres France Travail réelles : toutes contiennent
 * « n'existe plus » dans un gabarit d'erreur que la page n'affiche pas —
 * y compris celles recollectées le matin même, dont le titre est bien celui
 * de l'offre. Huit vivantes sur huit auraient été supprimées.
 *
 * La vérification ne doit donc JAMAIS lire le corps de la page.
 */
test('une page qui contient « n\'existe plus » reste vivante si elle répond 200', async () => {
  const f = fauxFetch({
    'https://ft/offre': {
      status: 200,
      corps: `<title>Offre d'emploi Chef de projet agrivoltaïque (H/F)</title>
              <div hidden>Cette offre n'existe plus</div>`,
    },
  });
  const r = await verifierLien('https://ft/offre', f);
  assert.equal(r.etat, 'vivante',
    'le texte de la page ne doit jamais conclure : le gabarit d\'erreur y est toujours');
});

/** Réseau coupé, DNS, délai dépassé : on ne sait pas. Surtout pas « morte ». */
test('une requête qui échoue laisse l\'offre en place', async () => {
  const f = fauxFetch({ 'https://x/y': Object.assign(new Error('délai'), { name: 'TimeoutError' }) });
  const r = await verifierLien('https://x/y', f);
  assert.equal(r.etat, 'indetermine');
  assert.match(r.raison, /Timeout/i);
});

/**
 * QUI VÉRIFIER.
 *
 * Sur douze offres revues à la dernière collecte, zéro morte ; sur douze
 * disparues, cinq mortes — mais sept vivantes. La disparition ne suffit donc
 * pas à écarter, mais elle désigne parfaitement qui sonder : vérifier les
 * autres dépenserait des requêtes pour confirmer ce qu'on sait déjà.
 */
test('on ne sonde que les offres qui ont cessé d\'apparaître', () => {
  const offres = [
    { id: 1, lien: 'https://a/1', last_seen: '2026-08-16' },  // revue aujourd'hui
    { id: 2, lien: 'https://a/2', last_seen: '2026-08-10' },  // disparue
    { id: 3, lien: 'https://a/3', last_seen: '2026-08-02' },  // disparue, plus ancienne
    { id: 4, lien: null,          last_seen: '2026-08-01' },  // sans lien
  ];
  const liste = aVerifier(offres, '2026-08-16T16:48:00Z');
  assert.deepEqual(liste.map(o => o.id), [3, 2],
    'les plus anciennement vues d\'abord : si le plafond coupe, il coupe au bon endroit');
});

/** Une offre déjà déclarée morte ne se re-sonde pas : un 404 reste un 404. */
test('ce qui est déjà mort ou vérifié de frais n\'est pas resondé', () => {
  const hier = new Date(Date.now() - 86400000).toISOString();
  const vieux = new Date(Date.now() - 10 * 86400000).toISOString();
  const offres = [
    { id: 1, lien: 'https://a/1', last_seen: '2026-01-01', lien_mort: 1 },
    { id: 2, lien: 'https://a/2', last_seen: '2026-01-01', lien_verifie_le: hier },
    { id: 3, lien: 'https://a/3', last_seen: '2026-01-01', lien_verifie_le: vieux },
    { id: 4, lien: 'https://a/4', last_seen: '2026-01-01' },
  ];
  const ids = aVerifier(offres, '2026-08-16T00:00:00Z').map(o => o.id).sort();
  assert.deepEqual(ids, [3, 4]);
});

/**
 * Ces sites ne nous doivent rien. Une passe qui les inonde se fait bloquer,
 * et transforme des offres vivantes en « indéterminé » pour tout le monde.
 */
test('la passe est séquentielle et plafonnée', async () => {
  let simultanees = 0, maximum = 0;
  const f = async (url) => {
    simultanees++; maximum = Math.max(maximum, simultanees);
    await new Promise(r => setTimeout(r, 5));
    simultanees--;
    return { status: 200, url, text: async () => '' };
  };
  const offres = Array.from({ length: 10 }, (_, i) => ({ id: i, lien: `https://a/${i}` }));
  const r = await verifierOffres(offres, { recuperer: f, pauseMs: 0, maximum: 4 });

  assert.equal(r.length, 4, 'le plafond doit être respecté');
  assert.equal(maximum, 1, 'une requête à la fois');
});
