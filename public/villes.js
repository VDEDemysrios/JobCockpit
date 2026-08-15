// L'éditeur de villes, dans les Options.
//
// CE QU'IL CORRIGE
// ----------------
// Les villes prioritaires étaient fixées une fois pour toutes par l'assistant
// de première configuration ; en changer voulait dire ouvrir
// `profile/profile.json` et comprendre six champs. Celui qui a écrit le
// fichier s'en accommode. Personne d'autre.
//
// Or déménager, abandonner une ville, en ajouter une après un entretien, ce
// sont des évènements ordinaires d'une recherche d'emploi. Ils méritaient
// mieux qu'un éditeur de texte.
//
// DEUX PÉRIMÈTRES, MONTRÉS SEULEMENT SI ON LES CHERCHE
// ----------------------------------------------------
// L'onglet est SERRÉ (ce qu'on veut voir rangé sous ce nom), la collecte est
// LARGE (ce qu'on accepte de considérer). Les confondre est ce qui mettait
// Metz dans l'onglet Nancy. Mais c'est une subtilité, et l'imposer à
// l'ouverture ferait renoncer avant d'avoir commencé : par défaut, une ville
// se règle avec un nom et un code postal. Le reste est replié.
import { API } from './api.js';
import { echapper } from './format.js';

/** La table des départements, servie par l'API au premier affichage. */
let DEPARTEMENTS = {};
let maximum = 8;

/** L'état en cours d'édition. Rien n'est écrit avant « Enregistrer ». */
let lignes = [];
let surEnregistrement = null;

const zone = () => document.getElementById('villesEditeur');

/** « 67 68 » → « Bas-Rhin, Haut-Rhin ». Signale ce qui n'existe pas. */
function nommer(saisie) {
  const numeros = String(saisie ?? '').toUpperCase().split(/[^0-9AB]+/i).filter(Boolean);
  if (!numeros.length) return '';
  return numeros
    .map(n => DEPARTEMENTS[n] ?? `${n} — inconnu`)
    .join(', ');
}

/** Le résumé d'une ligne repliée : ce qu'on a besoin de relire d'un coup d'œil. */
function resume(l) {
  const onglet = l.onglet.length ? l.onglet.join(', ') : '—';
  const enPlus = l.collecte.filter(d => !l.onglet.includes(d));
  return enPlus.length
    ? `onglet ${onglet} · collecte élargie à ${enPlus.join(', ')}`
    : `onglet et collecte : ${onglet}`;
}

function rendre() {
  const html = lignes.map((l, i) => `
    <div class="vil-ligne${l.ouverte ? ' ouverte' : ''}" data-i="${i}">
      <div class="vil-tete">
        <input class="vil-nom" value="${echapper(l.nom)}" maxlength="60"
               placeholder="Nom de la ville" aria-label="Nom de la ville">
        <input class="vil-cp" value="${echapper(l.codePostal)}" maxlength="10"
               placeholder="Code postal" aria-label="Code postal" inputmode="numeric">
        <button type="button" class="vil-detail" aria-expanded="${l.ouverte}"
                title="Régler le périmètre de cette ville">Périmètre</button>
        <button type="button" class="vil-retirer" aria-label="Retirer ${echapper(l.nom || 'cette ville')}">✕</button>
      </div>
      <div class="vil-resume">${echapper(resume(l))}</div>
      <div class="vil-reglage"${l.ouverte ? '' : ' hidden'}>
        <label class="vil-champ">
          <span class="vil-t">L'onglet affiche les départements</span>
          <input class="vil-onglet" value="${echapper(l.onglet.join(' '))}" placeholder="67">
          <span class="vil-noms">${echapper(nommer(l.onglet.join(' ')))}</span>
        </label>
        <label class="vil-champ">
          <span class="vil-t">…et ces communes</span>
          <input class="vil-communes" value="${echapper(l.communes.join(', '))}"
                 placeholder="Villeurbanne, Bron">
          <span class="vil-aide">Les communes de l'agglomération dont le nom ne contient pas celui de la ville.</span>
        </label>
        <label class="vil-champ">
          <span class="vil-t">La collecte cherche aussi dans</span>
          <input class="vil-collecte" value="${echapper(l.collecte.filter(d => !l.onglet.includes(d)).join(' '))}"
                 placeholder="68">
          <span class="vil-noms">${echapper(nommer(l.collecte.filter(d => !l.onglet.includes(d)).join(' ')))}</span>
        </label>
        <label class="vil-champ">
          <span class="vil-t">…et ces libellés</span>
          <input class="vil-larges" value="${echapper(l.zonesLarges.join(', '))}"
                 placeholder="Alsace">
          <span class="vil-aide">Rattrape les annonces qui ne donnent qu'une région, sans code postal.</span>
        </label>
      </div>
    </div>`).join('');

  zone().innerHTML = html || '<p class="vil-vide">Aucune ville. Ajoutes-en une : c\'est elle qui oriente la collecte.</p>';

  const ajout = document.getElementById('villeAjouter');
  if (ajout) ajout.disabled = lignes.length >= maximum;
}

/** Relit les champs dans l'état, sans re-rendre : on ne perd pas le curseur. */
function lireChamps() {
  for (const el of zone().querySelectorAll('.vil-ligne')) {
    const l = lignes[Number(el.dataset.i)];
    if (!l) continue;
    const val = (s) => el.querySelector(s)?.value ?? '';
    l.nom = val('.vil-nom');
    l.codePostal = val('.vil-cp');
    l.onglet = val('.vil-onglet').toUpperCase().split(/[^0-9AB]+/i).filter(Boolean);
    l.communes = val('.vil-communes').split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    l.collecte = [...l.onglet, ...val('.vil-collecte').toUpperCase().split(/[^0-9AB]+/i).filter(Boolean)];
    l.zonesLarges = val('.vil-larges').split(/[,;]+/).map(s => s.trim()).filter(Boolean);
  }
}

function ligneVierge() {
  return { nom: '', codePostal: '', onglet: [], collecte: [], communes: [], zonesLarges: [], ouverte: false };
}

/** Charge les villes du profil et branche l'éditeur. Appelé une seule fois. */
export async function installerEditeurVilles({ signaler }) {
  const conteneur = zone();
  if (!conteneur) return;

  try {
    const d = await API.villes();
    DEPARTEMENTS = d.departements ?? {};
    maximum = d.maximum ?? 8;
    lignes = (d.villes ?? []).map(v => ({
      nom: v.nom,
      // Le département fait un code postal acceptable : c'est de lui qu'il
      // était déduit, et le réafficher évite d'inventer un code postal que
      // l'utilisateur n'a jamais saisi.
      codePostal: v.departement ?? '',
      onglet: v.onglet ?? [],
      collecte: v.collecte ?? [],
      communes: v.communes ?? [],
      zonesLarges: v.zonesLarges ?? [],
      ouverte: false,
    }));
  } catch (e) {
    conteneur.innerHTML = `<p class="vil-vide">${echapper(e.message)}</p>`;
    return;
  }
  rendre();

  // Un seul écouteur pour toutes les lignes : elles sont recréées à chaque
  // rendu, et rebrancher une poignée d'écouteurs par ligne les ferait fuir.
  conteneur.addEventListener('click', (e) => {
    const ligne = e.target.closest('.vil-ligne');
    if (!ligne) return;
    const i = Number(ligne.dataset.i);

    if (e.target.closest('.vil-retirer')) {
      lireChamps();
      lignes.splice(i, 1);
      rendre();
      signaler?.();
      return;
    }
    if (e.target.closest('.vil-detail')) {
      lireChamps();
      lignes[i].ouverte = !lignes[i].ouverte;
      rendre();
    }
  });

  // Les noms de départements suivent la frappe : « 68 » sans « Haut-Rhin » à
  // côté ne se vérifie pas, et un numéro faux ne se voit qu'à la collecte
  // suivante — six heures plus tard.
  conteneur.addEventListener('input', (e) => {
    const ligne = e.target.closest('.vil-ligne');
    if (!ligne) return;
    signaler?.();

    if (e.target.matches('.vil-onglet, .vil-collecte')) {
      const noms = e.target.parentElement.querySelector('.vil-noms');
      if (noms) noms.textContent = nommer(e.target.value);
    }
    if (e.target.matches('.vil-nom, .vil-cp, .vil-onglet, .vil-collecte')) {
      lireChamps();
      const resumeEl = ligne.querySelector('.vil-resume');
      if (resumeEl) resumeEl.textContent = resume(lignes[Number(ligne.dataset.i)]);
    }
  });

  document.getElementById('villeAjouter')?.addEventListener('click', () => {
    lireChamps();
    if (lignes.length >= maximum) return;
    lignes.push(ligneVierge());
    rendre();
    // Le curseur dans le champ qu'on vient de créer : sinon il faut aller le
    // chercher à la souris, juste après avoir cliqué pour l'obtenir.
    zone().querySelector('.vil-ligne:last-child .vil-nom')?.focus();
    signaler?.();
  });

  surEnregistrement = signaler;
}

/**
 * Écrit les villes. Renvoie un message de succès, ou lève avec l'erreur du
 * serveur — c'est lui qui valide, l'interface ne fait que présenter.
 */
export async function enregistrerVilles() {
  lireChamps();
  const charge = lignes.map(l => ({
    nom: l.nom,
    codePostal: l.codePostal,
    onglet: l.onglet,
    collecte: l.collecte,
    communes: l.communes,
    zonesLarges: l.zonesLarges,
  }));
  const d = await API.enregistrerVilles(charge);

  // On repart de ce que le serveur a réellement écrit, pas de ce qu'on a
  // envoyé : il complète les départements manquants et normalise les
  // libellés, et afficher autre chose que le fichier serait mentir.
  lignes = (d.villes ?? []).map(v => ({
    nom: v.nom, codePostal: v.departement ?? '',
    onglet: v.onglet ?? [], collecte: v.collecte ?? [],
    communes: v.communes ?? [], zonesLarges: v.zonesLarges ?? [], ouverte: false,
  }));
  rendre();
  surEnregistrement?.(false);
  return `${lignes.length} ville${lignes.length > 1 ? 's' : ''} enregistrée${lignes.length > 1 ? 's' : ''}.`;
}
