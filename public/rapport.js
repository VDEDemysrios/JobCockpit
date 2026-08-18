// Le bilan hebdomadaire, imprimable.
//
// Distinct de l'export du suivi (`impression.js`), qui liste TOUTES les
// candidatures : ici c'est une SYNTHÈSE de la semaine — ce qui est arrivé, ce
// qui attend une action, où en est le tunnel. De quoi prendre du recul le
// vendredi soir, ou le montrer à un conseiller sans lui déverser deux cents
// lignes.
//
// Même parti pris que le suivi : pas de bibliothèque PDF. Le navigateur sait
// produire un PDF propre ; on lui donne un document net et on laisse
// « Enregistrer au format PDF » finir.
import { dateLisible, dateCourte, echapper, todayISO, GM } from './format.js';

/**
 * Une relance est due si sa date est passée et la candidature encore active.
 * Copié de `render.js` plutôt qu'importé : `render.js` tire tout le rendu (et
 * le DOM), ce module doit rester calculable sans navigateur pour être testé.
 */
function relanceDue(offre, aujourdhui = todayISO()) {
  const s = offre.suivi;
  return Boolean(s.relance) && s.relance <= aujourdhui
    && s.status !== 'Refus' && s.status !== 'Entretien';
}

/** Décale une date ISO de n jours (locale, pas UTC). */
function decaler(iso, jours) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + jours);
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Lundi de la semaine d'une date ISO. */
export function lundiDe(iso) {
  const d = new Date(iso + 'T12:00:00');
  const jour = d.getDay();               // 0 = dimanche
  return decaler(iso, jour === 0 ? -6 : 1 - jour);
}

/**
 * LE BILAN, en données pures — c'est la partie qui peut se tromper, donc la
 * partie qu'on teste. La mise en page vient après.
 *
 * Une candidature « envoyée cette semaine » l'est d'après sa date d'envoi ;
 * une offre « collectée cette semaine » d'après sa première apparition
 * (`vueLe`). Les deux fenêtres sont la semaine calendaire en cours, du lundi
 * au dimanche — pas « les 7 derniers jours », pour qu'un bilan du vendredi et
 * un bilan du lundi suivant ne se recouvrent pas.
 */
export function bilanHebdo(offres, aujourdhui = todayISO()) {
  const lundi = lundiDe(aujourdhui);
  const dimanche = decaler(lundi, 6);
  const dansLaSemaine = (iso) => iso && iso.slice(0, 10) >= lundi && iso.slice(0, 10) <= dimanche;

  const collectees = offres.filter(o => dansLaSemaine(o.vueLe));
  const envoyeesSemaine = offres.filter(o => dansLaSemaine(o.suivi.sent))
    .sort((a, b) => (b.suivi.sent ?? '').localeCompare(a.suivi.sent ?? ''));
  const relancesDues = offres.filter(o => relanceDue(o, aujourdhui))
    .sort((a, b) => (a.suivi.relance ?? '').localeCompare(b.suivi.relance ?? ''));
  const entretiensAVenir = offres
    .filter(o => o.suivi.entretien && o.suivi.entretien >= aujourdhui)
    .sort((a, b) => a.suivi.entretien.localeCompare(b.suivi.entretien));
  const prioritaires = offres
    .filter(o => o.groupe === 1 && o.suivi.status === 'À postuler')
    .sort((a, b) => (b.suivi.pinned ? 1 : 0) - (a.suivi.pinned ? 1 : 0)
      || (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 10);

  return { lundi, dimanche, collectees, envoyeesSemaine, relancesDues, entretiensAVenir, prioritaires };
}

const carte = (valeur, libelle) =>
  `<div class="kpi"><div class="kpi-v">${valeur}</div><div class="kpi-l">${libelle}</div></div>`;

function bloc(titre, lignes) {
  if (!lignes.length) return '';
  return `<h2>${echapper(titre)}<span class="n">${lignes.length}</span></h2>
    <ul class="liste">${lignes.join('')}</ul>`;
}

const item = (o, suffixe = '') => {
  const g = GM[o.groupe] ?? GM[0];
  return `<li><span class="pt">${g.emoji}</span>
    <span class="ti">${echapper(o.titre)}</span>
    <span class="en">${echapper(o.entreprise || '—')} · ${echapper(o.ville || '—')}</span>
    ${suffixe ? `<span class="su">${suffixe}</span>` : ''}</li>`;
};

/**
 * Ouvre le bilan imprimable dans une fenêtre à part.
 * @param stats  le retour de /api/stats (pour le tunnel cumulé)
 */
export function imprimerRapport(offres, stats, candidat = {}) {
  const b = bilanHebdo(offres, stats?.aujourdhui ?? todayISO());
  const perf = stats?.performance ?? {};
  const res = stats?.resume ?? {};

  const aQuelqueChose = b.collectees.length || b.envoyeesSemaine.length
    || b.relancesDues.length || b.entretiensAVenir.length || b.prioritaires.length;
  if (!aQuelqueChose) {
    return { ok: false, message: 'Semaine vide : rien de collecté, rien d\'envoyé, rien à préparer.' };
  }

  const fenetre = window.open('', '_blank');
  if (!fenetre) {
    return { ok: false, message: 'La fenêtre a été bloquée. Autorise les fenêtres surgissantes pour ce site.' };
  }

  fenetre.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<title>Bilan de la semaine — ${echapper(candidat.nom ?? '')}</title>
<style>
  @page{margin:14mm 12mm;}
  *{box-sizing:border-box;}
  body{font:11.5px/1.55 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#101322;margin:0;}
  h1{font-size:21px;margin:0 0 2px;letter-spacing:-.4px;}
  .sous{color:#6f7688;font-size:11px;margin-bottom:16px;}
  .kpis{display:flex;gap:10px;margin-bottom:8px;flex-wrap:wrap;}
  .kpi{flex:1;min-width:110px;border:1px solid #e6e9f2;border-radius:8px;padding:10px 12px;}
  .kpi-v{font-size:22px;font-weight:700;letter-spacing:-.5px;}
  .kpi-l{font-size:9.5px;text-transform:uppercase;letter-spacing:.4px;color:#6f7688;margin-top:2px;}
  .tunnel{color:#3d4356;font-size:10.5px;margin:4px 0 6px;}
  h2{font-size:13px;margin:20px 0 6px;padding-bottom:5px;border-bottom:1.5px solid #101322;break-after:avoid;}
  h2 .n{float:right;font-weight:400;color:#6f7688;}
  ul.liste{list-style:none;margin:0;padding:0;}
  ul.liste li{padding:6px 0;border-top:1px solid #e6e9f2;break-inside:avoid;display:grid;
    grid-template-columns:auto 1fr auto;gap:2px 8px;align-items:baseline;}
  .pt{grid-row:span 2;}
  .ti{font-weight:600;}
  .su{color:#b04b2f;font-weight:600;font-size:10.5px;white-space:nowrap;}
  .en{grid-column:2/4;color:#6f7688;font-size:10px;}
  footer{margin-top:24px;padding-top:8px;border-top:1px solid #e6e9f2;color:#9aa1b3;font-size:9px;}
</style></head><body>
<h1>Bilan de la semaine</h1>
<div class="sous">${echapper(candidat.nom ?? '')}${candidat.nom ? ' · ' : ''}Semaine du ${dateLisible(b.lundi)} au ${dateLisible(b.dimanche)}</div>

<div class="kpis">
  ${carte(b.collectees.length, 'offres collectées')}
  ${carte(b.envoyeesSemaine.length, 'candidatures envoyées')}
  ${carte(b.relancesDues.length, 'relances à faire')}
  ${carte(b.entretiensAVenir.length, 'entretiens à venir')}
</div>
<p class="tunnel"><strong>Depuis le début :</strong> ${res.envoyees ?? 0} candidatures ·
  ${res.reponses ?? 0} réponse${(res.reponses ?? 0) > 1 ? 's' : ''} ·
  ${res.entretiens ?? 0} entretien${(res.entretiens ?? 0) > 1 ? 's' : ''} ·
  taux de réponse ${perf.tauxReponse ?? 0} %.</p>

${bloc('À préparer — entretiens à venir', b.entretiensAVenir.map(o =>
    item(o, `entretien le ${dateCourte(o.suivi.entretien)}`)))}
${bloc('Relances à faire', b.relancesDues.map(o =>
    item(o, `prévue ${dateCourte(o.suivi.relance)}`)))}
${bloc('Envoyées cette semaine', b.envoyeesSemaine.map(o =>
    item(o, dateCourte(o.suivi.sent))))}
${bloc('Prioritaires à traiter', b.prioritaires.map(o => item(o, `${o.score ?? '—'} pt`)))}

<footer>Job Cockpit — bilan généré localement, aucune donnée n'a quitté cet ordinateur.
  ${dateLisible(todayISO())}</footer>
</body></html>`);
  fenetre.document.close();
  fenetre.onload = () => fenetre.print();

  return { ok: true };
}
