// Export PDF du suivi de candidatures.
//
// POURQUOI PAS DE BIBLIOTHÈQUE PDF
// --------------------------------
// Le navigateur sait déjà produire un PDF, avec les polices du système, des
// liens cliquables et une pagination correcte. Embarquer un générateur de
// PDF pour refaire ça moins bien serait le contraire du raisonnement tenu
// ailleurs dans le projet (l'analyse XML des flux, le cookie signé).
//
// On construit donc un document propre dans une fenêtre dédiée, et on laisse
// « Enregistrer au format PDF » faire le reste.
import { GM, STATUS_EMOJI, dateLisible, echapper, todayISO } from './format.js';

/** Statuts qui décrivent une candidature réellement engagée. */
const ENGAGES = new Set(['Envoyé', 'Relancé', 'Entretien', 'Refus']);

/**
 * Les candidatures engagées sont listées TOUTES : c'est le sujet du document.
 * Les offres seulement repérées sont bornées — 214 lignes de choses qu'on n'a
 * pas encore faites ne sont plus un suivi, c'est un annuaire.
 */
const MAX_A_POSTULER = 40;

/**
 * Trois sections, dans l'ordre où on veut les relire : ce qui est en cours,
 * ce qui attend une action, ce qui est clos. Une candidature refusée n'est
 * pas au même rang qu'un entretien à préparer.
 */
function sections(offres) {
  const suivies = offres.filter(o => ENGAGES.has(o.suivi.status));

  const aPostuler = offres
    .filter(o => o.groupe === 1 && o.suivi.status === 'À postuler')
    .sort((a, b) => (b.suivi.pinned ? 1 : 0) - (a.suivi.pinned ? 1 : 0)
      || (b.score ?? 0) - (a.score ?? 0));

  return [
    { titre: 'Candidatures en cours',
      note: 'Envoyées, relancées, ou en entretien.',
      lot: suivies.filter(o => o.suivi.status !== 'Refus') },
    { titre: 'À traiter — prioritaires les mieux notées',
      note: aPostuler.length > MAX_A_POSTULER
        ? `Les ${MAX_A_POSTULER} premières sur ${aPostuler.length}, épinglées d'abord.`
        : 'Retenues par le classement, pas encore envoyées.',
      lot: aPostuler.slice(0, MAX_A_POSTULER) },
    { titre: 'Sans suite',
      note: 'Conservées pour mémoire.',
      lot: suivies.filter(o => o.suivi.status === 'Refus') },
  ].filter(s => s.lot.length > 0);
}

function ligne(o) {
  const s = o.suivi;
  const g = GM[o.groupe] ?? GM[0];
  return `<tr>
    <td class="t">
      ${o.lien ? `<a href="${echapper(o.lien)}">${echapper(o.titre)}</a>` : echapper(o.titre)}
      <span class="e">${echapper(o.entreprise || '—')} · ${echapper(o.ville || '—')}</span>
    </td>
    <td>${g.emoji} ${o.score ?? '—'}</td>
    <td>${STATUS_EMOJI[s.status] ?? ''} ${echapper(s.status)}</td>
    <td>${s.sent ? dateLisible(s.sent) : '—'}</td>
    <td>${s.relance ? dateLisible(s.relance) : '—'}</td>
    <td class="n">${echapper((s.notes || '').slice(0, 220))}</td>
  </tr>`;
}

/**
 * Ouvre le document imprimable dans une fenêtre à part.
 *
 * Une fenêtre séparée plutôt qu'une feuille `@media print` sur le tableau de
 * bord : imprimer l'application entière obligerait à masquer une centaine
 * d'éléments, et le moindre ajout futur ressortirait sur le papier sans
 * qu'on s'en aperçoive.
 */
export function imprimerSuivi(offres, candidat = {}) {
  const lots = sections(offres);
  const total = lots.reduce((n, s) => n + s.lot.length, 0);

  if (total === 0) {
    return { ok: false, message: 'Rien à exporter : aucune candidature suivie, aucune offre prioritaire.' };
  }

  const fenetre = window.open('', '_blank');
  if (!fenetre) {
    return { ok: false, message: 'La fenêtre a été bloquée. Autorise les fenêtres surgissantes pour ce site.' };
  }

  fenetre.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Suivi de candidatures — ${echapper(candidat.nom ?? '')}</title>
<style>
  @page{margin:14mm 12mm;}
  *{box-sizing:border-box;}
  body{font:11px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    color:#101322;margin:0;}
  h1{font-size:20px;margin:0 0 2px;letter-spacing:-.4px;}
  .sous{color:#6f7688;font-size:11px;margin-bottom:18px;}
  h2{font-size:13px;margin:22px 0 2px;padding-bottom:5px;border-bottom:1.5px solid #101322;}
  h2 .n{float:right;font-weight:400;color:#6f7688;}
  .note{color:#6f7688;font-size:10px;margin:0 0 8px;}
  table{width:100%;border-collapse:collapse;}
  th{text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.5px;
    color:#6f7688;padding:0 6px 5px 0;font-weight:600;}
  td{padding:7px 6px 7px 0;border-top:1px solid #e6e9f2;vertical-align:top;}
  /* Une ligne coupée entre deux pages est illisible. */
  tr{break-inside:avoid;}
  h2{break-after:avoid;}
  .t{width:38%;}
  .t a{color:#101322;text-decoration:none;font-weight:600;}
  .t .e{display:block;color:#6f7688;font-weight:400;margin-top:2px;}
  .n{color:#3d4356;font-size:10px;}
  footer{margin-top:26px;padding-top:8px;border-top:1px solid #e6e9f2;
    color:#9aa1b3;font-size:9px;}
</style></head><body>
<h1>Suivi de candidatures</h1>
<div class="sous">${echapper(candidat.nom ?? '')}${candidat.nom ? ' · ' : ''}${dateLisible(todayISO())} · ${total} ligne${total > 1 ? 's' : ''}</div>
${lots.map(s => `
  <h2>${echapper(s.titre)}<span class="n">${s.lot.length}</span></h2>
  <p class="note">${echapper(s.note)}</p>
  <table>
    <tr><th class="t">Poste</th><th>Score</th><th>Statut</th><th>Envoyé</th><th>Relance</th><th>Notes</th></tr>
    ${s.lot.map(ligne).join('')}
  </table>`).join('')}
<footer>Job Cockpit — document généré localement, aucune donnée n'a quitté cet ordinateur.</footer>
</body></html>`);
  fenetre.document.close();

  // L'impression attend le rendu : lancée trop tôt, elle sort une page vide.
  fenetre.onload = () => fenetre.print();

  return { ok: true, total };
}
