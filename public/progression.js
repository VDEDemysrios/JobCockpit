// Affichage de la progression : niveau, série, objectif, succès.
// Les données viennent du backend, qui reste seul juge des points obtenus.
import { dateLisible, echapper } from './format.js';

/** Barème affiché, aligné sur les constantes du serveur (src/progression.js). */
const BAREME = [
  { emoji: '📨', libelle: 'Envoyer une candidature', points: 25 },
  { emoji: '🔔', libelle: 'Effectuer une relance', points: 15 },
  { emoji: '✒️', libelle: 'Rédiger une lettre de motivation', points: 10 },
  { emoji: '➕', libelle: 'Ajouter une offre à la main', points: 5 },
  { emoji: '🔍', libelle: 'Une offre analysée par la collecte', points: 1 },
  { emoji: '🚪', libelle: 'Décrocher un entretien (bonus)', points: 100 },
];

/** Bloc de niveau dans la barre latérale, visible depuis toutes les vues. */
export function rendreBandeauNiveau(p) {
  const n = p.niveau;
  document.getElementById('lvlEm').textContent = n.embleme;
  document.getElementById('lvlTitre').textContent = n.titre;
  document.getElementById('lvlRang').textContent = `Niveau ${n.rang}`;
  document.getElementById('lvlXp').textContent = `${p.xp} XP`;
  document.getElementById('lvlManque').textContent =
    n.seuilSuivant ? `${n.manquant} pts` : 'niveau max';
  document.getElementById('lvlFill').style.width = n.progression + '%';

  const serie = document.getElementById('lvlSerie');
  serie.style.display = p.serie > 0 ? '' : 'none';
  document.getElementById('lvlSerieN').textContent = p.serie;
}

/** Vue complète « Progression ». */
export function rendreProgression(p) {
  const n = p.niveau;
  const s = p.stats;

  document.getElementById('progSub').textContent =
    `${p.succes.filter(x => x.obtenu).length} succès sur ${p.succes.length} · ${p.xp} points cumulés`;

  // Bandeau de niveau
  document.getElementById('heroEm').textContent = n.embleme;
  document.getElementById('heroRang').textContent = `Niveau ${n.rang} sur 7`;
  document.getElementById('heroTitre').textContent = n.titre;
  document.getElementById('heroXp').textContent = p.xp;
  document.getElementById('heroBar').style.width = n.progression + '%';
  document.getElementById('heroSub').textContent = n.seuilSuivant
    ? `Encore ${n.manquant} points pour devenir « ${n.titreSuivant} »`
    : 'Tu as atteint le dernier palier. Chapeau.';

  // Tuiles de synthèse
  const tuile = (grand, legende, note, i) =>
    `<div class="prog-tile" style="animation-delay:${i * 55}ms">
       <div class="big">${grand}</div><div class="cap">${legende}</div>
       ${note ? `<div class="note">${note}</div>` : ''}
     </div>`;

  const messageSerie = p.serie === 0
    ? 'Fais une action aujourd\'hui pour la lancer'
    : p.serie === 1 ? 'Reviens demain pour la prolonger'
    : 'Les week-ends ne la cassent pas';

  document.getElementById('progTiles').innerHTML = [
    `<div class="prog-tile" style="animation-delay:0ms">
       <div class="flamme">${p.serie > 0 ? '🔥' : '💤'}</div>
       <div class="big" style="font-size:30px;margin-top:4px">${p.serie} j</div>
       <div class="cap">Série en cours</div>
       <div class="note">${messageSerie}</div>
     </div>`,
    tuile(s.envoyees, 'Candidatures envoyées', `${s.relances} relance${s.relances > 1 ? 's' : ''} effectuée${s.relances > 1 ? 's' : ''}`, 1),
    tuile(s.lettres, 'Lettres rédigées', s.lettres ? 'Chacune vaut 10 points' : 'La première en vaut 10', 2),
    tuile(s.entretiens, 'Entretiens décrochés', s.entretiens ? 'Bonus de 100 points chacun' : 'Ça viendra', 3),
  ].join('');

  // Anneau d'objectif hebdomadaire
  const pct = p.objectifHebdo ? Math.min(p.faitCetteSemaine / p.objectifHebdo * 100, 100) : 0;
  const anneau = document.getElementById('goalFg');
  const circ = 2 * Math.PI * 54;
  anneau.style.strokeDasharray = circ;
  anneau.style.strokeDashoffset = circ;
  void anneau.getBoundingClientRect(); // force le départ à zéro sans requestAnimationFrame
  anneau.style.strokeDashoffset = circ * (1 - pct / 100);

  document.getElementById('goalTxt').textContent = `${p.faitCetteSemaine}/${p.objectifHebdo}`;
  document.getElementById('goalRing').classList.toggle('atteint', p.faitCetteSemaine >= p.objectifHebdo);
  document.getElementById('goalInput').value = p.objectifHebdo;

  const reste = p.objectifHebdo - p.faitCetteSemaine;
  document.getElementById('goalMsg').innerHTML = reste <= 0
    ? '🎉 <strong>Objectif atteint cette semaine.</strong> Tout ce que tu envoies maintenant est du bonus.'
    : `Il te reste <strong>${reste} candidature${reste > 1 ? 's' : ''}</strong> à envoyer d'ici dimanche soir.`;

  // Vitrine des succès
  const obtenus = p.succes.filter(x => x.obtenu).length;
  document.getElementById('succesCompte').textContent = `— ${obtenus}/${p.succes.length}`;

  document.getElementById('badges').innerHTML = p.succes.map((x, i) => `
    <div class="badge-tile ${x.obtenu ? 'obtenu' : 'verrouille'}" style="animation-delay:${i * 32}ms"
         title="${echapper(x.astuce)}">
      <span class="em">${x.obtenu ? x.emoji : '🔒'}</span>
      <div class="nm">${echapper(x.nom)}</div>
      <div class="as">${echapper(x.astuce)}</div>
      ${x.obtenu && x.obtenuLe ? `<div class="badge-date">${dateLisible(x.obtenuLe.slice(0, 10))}</div>` : ''}
    </div>`).join('');

  // Barème
  document.getElementById('baremeList').innerHTML = BAREME.map(b => `
    <div style="display:flex;align-items:center;gap:11px;padding:8px 0;border-bottom:1px solid var(--line)">
      <span style="font-size:18px">${b.emoji}</span>
      <span style="flex:1">${b.libelle}</span>
      <span style="font-weight:700;color:var(--accent)">+${b.points}</span>
    </div>`).join('');
}
