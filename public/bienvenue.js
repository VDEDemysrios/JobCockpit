// L'assistant de premier lancement.
//
// Il n'a pas de dépendance sur app.js : la page tourne AVANT qu'un profil
// existe, donc avant que le tableau de bord ait quoi que ce soit à afficher.
// Les mêler ferait échouer l'assistant sur l'absence des données qu'il sert
// précisément à créer.

const CLES = ['GEMINI_API_KEY', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY',
  'FRANCE_TRAVAIL_CLIENT_ID', 'FRANCE_TRAVAIL_CLIENT_SECRET', 'JOOBLE_API_KEY'];

/** Exemples proposés en filigrane, pour montrer la forme attendue. */
const EXEMPLES_INTITULES = ['énergies renouvelables', 'chef de projet', 'juriste environnement'];
const EXEMPLES_VILLES = [['Nantes', '44000'], ['Rennes', '35000'], ['Paris', '75001']];

const message = document.getElementById('message');

/** Ajoute une ligne « intitulé ». */
function ligneIntitule(valeur = '', index = 0) {
  const l = document.createElement('div');
  l.className = 'bv-ligne';
  l.innerHTML = `<input class="bv-intitule" maxlength="60"
    placeholder="${EXEMPLES_INTITULES[index % EXEMPLES_INTITULES.length]}">
    <button type="button" class="bv-retirer" aria-label="Retirer cet intitulé">✕</button>`;
  l.querySelector('input').value = valeur;
  l.querySelector('.bv-retirer').addEventListener('click', () => l.remove());
  return l;
}

/** Ajoute une ligne « ville + code postal ». */
function ligneVille(index = 0) {
  const [ville, cp] = EXEMPLES_VILLES[index % EXEMPLES_VILLES.length];
  const l = document.createElement('div');
  l.className = 'bv-ligne';
  l.innerHTML = `<input class="bv-ville" maxlength="60" placeholder="${ville}">
    <input class="bv-cp" maxlength="5" inputmode="numeric" placeholder="${cp}">
    <button type="button" class="bv-retirer" aria-label="Retirer cette ville">✕</button>`;
  l.querySelector('.bv-retirer').addEventListener('click', () => l.remove());
  return l;
}

const zoneIntitules = document.getElementById('intitules');
const zoneVilles = document.getElementById('villes');

// Deux lignes de chaque au départ : une seule donne l'impression qu'on n'en
// attend qu'une, trois font paraître le formulaire long.
for (let i = 0; i < 2; i++) {
  zoneIntitules.appendChild(ligneIntitule('', i));
  zoneVilles.appendChild(ligneVille(i));
}

document.querySelectorAll('[data-ajouter]').forEach(b => {
  b.addEventListener('click', () => {
    const quoi = b.dataset.ajouter;
    const zone = quoi === 'intitules' ? zoneIntitules : zoneVilles;
    const n = zone.children.length;
    zone.appendChild(quoi === 'intitules' ? ligneIntitule('', n) : ligneVille(n));
    zone.lastElementChild.querySelector('input').focus();
  });
});

document.getElementById('assistant').addEventListener('submit', async (e) => {
  e.preventDefault();
  const bouton = document.getElementById('valider');
  bouton.disabled = true;
  message.textContent = '';
  message.className = 'bv-message';

  const reponses = {
    nom: document.getElementById('nom').value,
    villeCandidat: document.getElementById('villeCandidat').value,
    ecarterDebutants: document.getElementById('ecarterDebutants').checked,
    intitules: [...document.querySelectorAll('.bv-intitule')].map(i => i.value),
    villes: [...document.querySelectorAll('#villes .bv-ligne')].map(l => ({
      nom: l.querySelector('.bv-ville').value,
      codePostal: l.querySelector('.bv-cp').value,
    })),
    cles: Object.fromEntries(CLES.map(c => [c, document.getElementById(c)?.value ?? ''])),
  };

  try {
    const r = await fetch('/api/configuration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reponses),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error ?? `Erreur ${r.status}`);

    message.className = 'bv-message ok';

    // Le serveur applique désormais le profil SANS redémarrage. Terminer un
    // assistant pour s'entendre répondre « maintenant, relance le programme »
    // était le pire endroit où demander un effort : c'est le moment précis où
    // l'on vient de tout saisir et où l'on veut voir le résultat.
    //
    // Le drapeau reste lu : si une version future avait de nouveau besoin
    // d'un redémarrage, mieux vaut le dire que d'ouvrir une application qui
    // montrerait l'ancien état.
    if (data.redemarrageRequis) {
      message.textContent = 'Créé. Redémarre Job Cockpit pour que tes réglages s\'appliquent.';
      bouton.textContent = 'C\'est fait';
      return;
    }

    message.textContent = 'C\'est prêt. Ouverture de ton tableau de bord…';
    bouton.textContent = 'Entrer';
    setTimeout(() => { window.location.href = '/'; }, 900);
  } catch (erreur) {
    message.className = 'bv-message err';
    message.textContent = erreur.message;
    bouton.disabled = false;
  }
});
