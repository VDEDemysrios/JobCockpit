import { test } from 'node:test';
import assert from 'node:assert/strict';
import flux, { analyserFlux, decouperTitre, decoder, sansHtml, dateEntree, decoderReponse } from '../src/sources/rss.js';

const FLUX_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Alertes emploi</title>
  <item>
    <title><![CDATA[Chef de projet agrivoltaïque H/F - TotalEnergies - Lyon (69)]]></title>
    <link>https://exemple.fr/offres/1</link>
    <description><![CDATA[<p>Vous d&eacute;veloppez des projets <b>agrivoltaïques</b>.</p><p>CDI.</p>]]></description>
    <pubDate>Fri, 24 Jul 2026 09:12:00 +0200</pubDate>
  </item>
  <item>
    <title>Juriste droit public &amp; environnement</title>
    <link>https://exemple.fr/offres/2</link>
    <description>Veille réglementaire et autorisations environnementales.</description>
    <pubDate>Mon, 01 Jun 2026 08:00:00 +0200</pubDate>
  </item>
</channel></rss>`;

const FLUX_ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Chargé de développement EnR | Strasbourg</title>
    <link rel="alternate" href="https://exemple.fr/atom/1"/>
    <summary>Développement de projets solaires en Alsace.</summary>
    <updated>2026-07-25T10:00:00Z</updated>
  </entry>
</feed>`;

// ------------------------------------------------------------------ analyse

test('un flux RSS est converti au format commun', () => {
  const offres = analyserFlux(FLUX_RSS);
  assert.equal(offres.length, 2);

  const premiere = offres[0];
  assert.equal(premiere.titre, 'Chef de projet agrivoltaïque H/F');
  assert.equal(premiere.entreprise, 'TotalEnergies');
  assert.equal(premiere.ville, 'Lyon (69)');
  assert.equal(premiere.lien, 'https://exemple.fr/offres/1');
  assert.equal(premiere.dateOffre, '2026-07-24');
  assert.ok(premiere.description.includes('agrivoltaïques'));
  assert.ok(!premiere.description.includes('<p>'), 'le HTML doit être retiré');
});

test('un flux Atom est lu comme un flux RSS', () => {
  const offres = analyserFlux(FLUX_ATOM);
  assert.equal(offres.length, 1);
  assert.equal(offres[0].titre, 'Chargé de développement EnR');
  assert.equal(offres[0].ville, 'Strasbourg');
  assert.equal(offres[0].lien, 'https://exemple.fr/atom/1', 'le lien Atom est un attribut href');
  assert.equal(offres[0].dateOffre, '2026-07-25');
});

test('la configuration du flux prime sur ce que dit le titre', () => {
  const offres = analyserFlux(FLUX_RSS, { entreprise: 'Voltalia', ville: 'Épinal' });
  assert.equal(offres[0].entreprise, 'Voltalia');
  assert.equal(offres[0].ville, 'Épinal');
});

test('un flux vide ou illisible ne lève pas', () => {
  assert.deepEqual(analyserFlux(''), []);
  assert.deepEqual(analyserFlux('<html><body>page d\'erreur</body></html>'), []);
  assert.deepEqual(analyserFlux(null), []);
});

// ------------------------------------------------------------------ découpe

test('un titre à trois segments donne poste, entreprise et ville', () => {
  assert.deepEqual(decouperTitre('Chef de projet EnR - EDF Renouvelables - Nancy (54)'),
    { titre: 'Chef de projet EnR', entreprise: 'EDF Renouvelables', ville: 'Nancy (54)' });
});

test('« chez » sépare aussi le poste de l\'entreprise', () => {
  const d = decouperTitre('Juriste droit public chez Cabinet Durand Associés');
  assert.equal(d.titre, 'Juriste droit public');
  assert.equal(d.entreprise, 'Cabinet Durand Associés');
});

// Un code postal trahit une ville : sans cet indice, « Paris (75) » serait
// pris pour un nom d'entreprise.
test('un segment portant un code postal est reconnu comme une ville', () => {
  const d = decouperTitre('Chargé de projet | Paris (75)');
  assert.equal(d.ville, 'Paris (75)');
  assert.equal(d.entreprise, '');
});

test('un titre sans séparateur est conservé entier', () => {
  const d = decouperTitre('Développeur de projets photovoltaïques');
  assert.equal(d.titre, 'Développeur de projets photovoltaïques');
  assert.equal(d.entreprise, '');
  assert.equal(d.ville, '');
});

// ------------------------------------------- flux réels : références, adresses

// Relevé sur le flux de choisirleservicepublic.gouv.fr le 29 juillet 2026.
// Le titre y commence par la référence interne de l'offre, et l'adresse
// postale est rangée dans une balise `category`, avec deux autres categories.
const FLUX_SERVICE_PUBLIC = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:a10="http://www.w3.org/2005/Atom" version="2.0"><channel>
  <title>Export RSS des offres</title>
  <item>
    <link>https://choisirleservicepublic.gouv.fr/offre-emploi/DEF_14-00069057/</link>
    <category>Aménagement et développement durable du territoire/Chargée / Chargé de gestion locative</category>
    <category>Emploi ouvert aux titulaires et aux contractuels</category>
    <category>15 RUE JACQUES KABLE
67000 STRASBOURG</category>
    <title>DEF_14-00069057 - CHARGE CLIENTELE ET GESTION LOCATIVE</title>
    <description>&lt;b&gt;Domaine / Métier : &lt;/b&gt;Aménagement&lt;br /&gt;Sous l'autorité du chef de bureau.</description>
    <pubDate>Wed, 29 Jul 2026 02:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

// Sans ce traitement, `decouperTitre` prenait la référence pour l'intitulé du
// poste et l'intitulé pour le nom de l'employeur : toutes les offres du
// Service Public arrivaient illisibles dans le tableau.
test('une référence d\'offre en tête de titre est retirée', () => {
  const [offre] = analyserFlux(FLUX_SERVICE_PUBLIC);
  assert.equal(offre.titre, 'CHARGE CLIENTELE ET GESTION LOCATIVE');
  assert.notEqual(offre.entreprise, 'CHARGE CLIENTELE ET GESTION LOCATIVE');
});

test('un titre dont le premier segment est un vrai mot n\'est pas amputé', () => {
  const offres = analyserFlux(FLUX_RSS);
  assert.equal(offres[0].titre, 'Chef de projet agrivoltaïque H/F');
  // « Chef de projet EnR 2026 » contient un chiffre mais reste un intitulé :
  // seul un segment collé, sans espace, est une référence.
  assert.equal(decouperTitre('Chef de projet EnR 2026 - Nancy').titre, 'Chef de projet EnR 2026');
});

// Relevé tel quel : « MINT_BA067PNB-123673 - DIPN67 - SIPAF67- Responsable… ».
// La référence de publication est suivie du code du service : retirer la
// première seulement laissait « DIPN67 » comme intitulé de poste.
test('plusieurs références empilées sont toutes retirées', () => {
  const d = decouperTitre('MINT_BA067PNB-123673 - DIPN67 - SIPAF67- Responsable LRA au sein du SPAFT');
  assert.equal(d.titre, 'SIPAF67- Responsable LRA au sein du SPAFT');
});

// Le nom du flux est une étiquette de journal (« Service Public — affaires
// juridiques — Bas-Rhin »), pas un employeur. L'afficher dans la colonne
// « entreprise » remplissait le tableau d'employeurs qui n'existent pas.
test('le nom du flux ne tient pas lieu d\'employeur', () => {
  const [offre] = analyserFlux(FLUX_SERVICE_PUBLIC, { nom: 'Service Public — Bas-Rhin' });
  assert.equal(offre.entreprise, '', 'mieux vaut aucun employeur qu\'un employeur faux');
});

// Ces flux sont filtrés par département à la source : l'information existe,
// mais aucune entrée ne la répète. Sans elle, les offres dont l'adresse
// manque sont classées « hors zone » et écartées de la collecte.
test('la zone déclarée sur le flux situe les offres sans adresse', () => {
  const sansAdresse = FLUX_SERVICE_PUBLIC.replace(/<category>15 RUE[\s\S]*?<\/category>/, '');
  const [offre] = analyserFlux(sansAdresse, { zone: 'Bas-Rhin, 67' });
  assert.equal(offre.zone, 'Bas-Rhin, 67');
});

test('l\'adresse de l\'entrée prime sur la zone déclarée sur le flux', () => {
  const [offre] = analyserFlux(FLUX_SERVICE_PUBLIC, { zone: 'Bas-Rhin, 67' });
  assert.equal(offre.zone, 'STRASBOURG');
});

test('l\'adresse postale rangée en category donne la ville et le code postal', () => {
  const [offre] = analyserFlux(FLUX_SERVICE_PUBLIC);
  assert.equal(offre.codePostal, '67000');
  assert.equal(offre.ville, 'STRASBOURG');
});

// « 173/175 rue de Bercy CS 10205 : 75588 Paris » : le numéro de boîte postale
// précède le vrai code postal. Le premier nombre à cinq chiffres n'est donc
// pas forcément le bon — seul celui que suit un nom de commune l'est.
test('un numéro de boîte postale n\'est pas pris pour le code postal', () => {
  const xml = FLUX_SERVICE_PUBLIC.replace('15 RUE JACQUES KABLE\n67000 STRASBOURG',
    '173/175 rue de Bercy CS 10205 : 75588 Paris');
  const [offre] = analyserFlux(xml);
  assert.equal(offre.codePostal, '75588');
  assert.equal(offre.ville, 'Paris');
});

test('la ville forcée par la configuration prime sur l\'adresse du flux', () => {
  const [offre] = analyserFlux(FLUX_SERVICE_PUBLIC, { ville: 'Épinal' });
  assert.equal(offre.ville, 'Épinal');
});

// ------------------------------------------------------------------ encodage

// Beaucoup de flux d'emploi français sont encore en ISO-8859-1 et ne le disent
// que dans le prologue XML, pas dans l'en-tête HTTP. Lus comme de l'UTF-8, les
// accents deviennent des « � » et l'offre part illisible dans l'analyse Gemini.
test('un flux ISO-8859-1 est décodé d\'après son prologue XML', () => {
  const octets = Buffer.from(
    `<?xml version="1.0" encoding="ISO-8859-1" ?><rss><channel><item>` +
    `<title>Chargé de mission mobilité durable</title></item></channel></rss>`, 'latin1');
  const xml = decoderReponse(octets, 'application/xml');
  assert.ok(xml.includes('Chargé de mission mobilité durable'), `accents perdus : ${xml.slice(0, 120)}`);
});

test('le charset annoncé par HTTP prime sur le prologue XML', () => {
  const octets = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1" ?><title>énergie</title>', 'utf8');
  assert.ok(decoderReponse(octets, 'text/xml; charset=utf-8').includes('énergie'));
});

test('un encodage inconnu retombe sur UTF-8 sans lever', () => {
  const octets = Buffer.from('<title>énergie</title>', 'utf8');
  assert.ok(decoderReponse(octets, 'text/xml; charset=krypton-9').includes('énergie'));
});

// ------------------------------------------------------------ petits outils

test('les entités XML sont décodées, y compris les doubles échappements', () => {
  assert.equal(decoder('Droit &amp; environnement'), 'Droit & environnement');
  assert.equal(decoder('&lt;b&gt;gras&lt;/b&gt;'), '<b>gras</b>');
  assert.equal(decoder('<![CDATA[Texte brut]]>'), 'Texte brut');
  assert.equal(decoder('&#233;nergie'), 'énergie');
});

test('sansHtml transforme les balises de bloc en sauts de ligne', () => {
  assert.equal(sansHtml('<p>Un</p><p>Deux</p>'), 'Un\nDeux');
  assert.equal(sansHtml('Ligne<br/>Suivante'), 'Ligne\nSuivante');
  assert.equal(sansHtml('<p>D&eacute;veloppement</p>'), 'Développement');
});

test('une date absente ou illisible renvoie null', () => {
  assert.equal(dateEntree('<item><title>x</title></item>'), null);
  assert.equal(dateEntree('<item><pubDate>bientôt</pubDate></item>'), null);
});

// ---------------------------------------------------------------- source

test('la source est ignorée tant qu\'aucun flux n\'est déclaré', () => {
  assert.equal(flux.estConfiguree(undefined), false);
  assert.equal(flux.estConfiguree({}), false);
  assert.equal(flux.estConfiguree({ flux: [] }), false);
  assert.equal(flux.estConfiguree({ flux: [{ url: 'https://exemple.fr/rss' }] }), true);
});

// Un flux est une URL fixe : le relire pour chacune des 4 villes renverrait
// 4 fois la même chose.
test('les flux ne sont lus qu\'à la passe nationale', async () => {
  const resultat = await flux.chercher({
    intitule: 'chef de projet', ville: { nom: 'Nancy' }, depuisDate: '2026-07-21',
    profil: { flux: [{ url: 'https://exemple.invalide/rss' }] },
  });
  assert.deepEqual(resultat, [], 'aucun appel réseau ne doit partir sur une passe par ville');
});
