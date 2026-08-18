// Vues « Tableau de bord » et « Statistiques ».
//
// Ces deux vues ne calculent rien : tous les chiffres arrivent déjà agrégés
// depuis /api/stats. Le serveur est seul juge, le navigateur seul dessinateur.
// C'est ce qui garantit qu'un « taux de réponse » affiche la même valeur ici,
// dans la progression et dans les quêtes.

import {
  aire, barres, barresH, anneau, jauge, donut, radar, heatmap, entonnoir, sparkline, vide,
} from './charts.js';
import {
  STATUSES, STATUS_COL, STATUS_EMOJI, SOURCE_LABEL, PALETTE, EVENEMENT,
  joursDepuis, dateLisible, ilYA, echapper, pluriel,
} from './format.js';

/** Étiquette courte d'une date ISO pour un axe : « 28/07 ». */
const courtISO = (iso) => {
  const d = new Date(iso + 'T12:00:00');
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Tuile de statistique, avec teinte, emoji, delta et micro-courbe. */
function tuile({ emoji, valeur, unite = '', libelle, teinte, delta, serie, note }) {
  const fleche = delta === undefined || delta === 0 ? '' :
    `<div class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} ${note ?? ''}</div>`;

  return `<div class="stat" ${teinte ? `style="--teinte:${teinte}"` : ''}>
    <span class="em">${emoji}</span>
    <div class="n" data-roule="${valeur}" data-suffixe="${echapper(unite)}">${valeur}${unite ? `<span class="u">${unite}</span>` : ''}</div>
    <div class="l">${echapper(libelle)}</div>
    ${fleche}
    ${serie ? `<div class="spark-slot">${sparkline(serie, { couleur: teinte ?? 'var(--accent)' })}</div>` : ''}
  </div>`;
}

// ══════════════════════════════════════════ TABLEAU DE BORD

export function rendreDashboard(stats, offres, meta, options = {}) {
  const { periode = '30' } = options;
  const s = stats.resume;
  const p = stats.performance;

  document.getElementById('dashSub').textContent =
    `${s.total} offres suivies · ${s.actionnables} actionnables · ${s.envoyees} envoyées`;

  // ─── Tuiles principales
  const envois30 = stats.serie90.slice(-30).map(j => j.envois);
  const actions30 = stats.serie90.slice(-30).map(j => j.actions);
  const relancesDues = offres.filter(o => o.suivi.relance && o.suivi.relance <= stats.aujourdhui
    && o.suivi.status !== 'Refus' && o.suivi.status !== 'Entretien').length;
  const fraiches = offres.filter(o => {
    if (!o.dateOffre) return false;
    return joursDepuis(o.dateOffre) <= 7;
  }).length;

  document.getElementById('stats').innerHTML = [
    tuile({ emoji: '🗂️', valeur: s.total, libelle: 'Offres suivies', teinte: 'var(--accent)' }),
    tuile({ emoji: '🎯', valeur: s.actionnables, libelle: 'Actionnables maintenant', teinte: 'var(--g1)' }),
    tuile({
      emoji: '📮', valeur: s.envoyees, libelle: 'Candidatures envoyées', teinte: 'var(--info)',
      delta: p.tendance, note: 'vs sem. dernière', serie: envois30,
    }),
    tuile({ emoji: '🤝', valeur: s.entretiens, libelle: 'Entretiens décrochés', teinte: 'var(--g2)' }),
    tuile({ emoji: '⏰', valeur: relancesDues, libelle: 'Relances à faire', teinte: 'var(--hot)' }),
    tuile({ emoji: '🔥', valeur: fraiches, libelle: 'Offres fraîches (≤ 7 j)', teinte: 'var(--pink)', serie: actions30 }),
  ].join('');

  // ─── Entonnoir + anneau
  document.getElementById('dashAnneau').innerHTML = anneau(p.tauxCandidature, {
    taille: 132, libelle: 'envoyées', valeur: p.tauxCandidature + '%',
  });

  const parStatut = Object.fromEntries(stats.parStatut.map(x => [x.statut, x.n]));
  document.getElementById('funnel').innerHTML = entonnoir(
    STATUSES.map(st => ({
      etiquette: `${STATUS_EMOJI[st]} ${st}`,
      valeur: parStatut[st] ?? 0,
      couleur: STATUS_COL[st],
    }))
  );

  // ─── Performance : trois jauges + quatre chiffres
  document.getElementById('perfJauges').innerHTML = [
    jauge(p.tauxReponse, { valeur: p.tauxReponse + '%', libelle: 'taux de réponse' }),
    jauge(p.tauxEntretien, { valeur: p.tauxEntretien + '%', libelle: 'taux d\'entretien' }),
  ].join('');

  document.getElementById('perf').innerHTML = [
    tuile({ emoji: '💬', valeur: s.reponses, libelle: `Réponses sur ${s.envoyees} envoi${s.envoyees > 1 ? 's' : ''}`, teinte: 'var(--info)' }),
    tuile({ emoji: '⏳', valeur: p.delaiMoyen, unite: ' j', libelle: 'Attente moyenne', teinte: 'var(--g2)' }),
    tuile({ emoji: '🤐', valeur: s.sansReponse, libelle: 'Sans réponse à ce jour', teinte: 'var(--g0)' }),
    tuile({ emoji: '🖋️', valeur: s.avecLettre, libelle: 'Lettres rédigées', teinte: 'var(--accent2)' }),
  ].join('');

  // ─── Courbe de rythme
  rendreCourbe(stats, periode);

  // ─── Calendrier d'assiduité
  const joursActifs = stats.heatmap.filter(j => j.actions > 0).length;
  document.getElementById('heatSub').textContent =
    `${pluriel(joursActifs, 'jour actif', 'jours actifs')} sur les 6 derniers mois`;
  document.getElementById('heat').innerHTML = heatmap(stats.heatmap);

  // ─── Villes
  document.getElementById('citybars').innerHTML = barresH(
    stats.parVille.map(v => ({
      etiquette: v.ville, valeur: v.n, secondaire: v.envoyees,
    })),
    { unite: ' offre(s)' }
  ) + (stats.parVille.length
    ? '<p class="note-panel">La zone claire à l\'intérieur de chaque barre marque les offres auxquelles tu as postulé.</p>'
    : '');

  // ─── Sources
  document.getElementById('sourceDonut').innerHTML = donut(
    stats.parSource.map((x, i) => ({
      etiquette: SOURCE_LABEL[x.source] ?? x.source,
      valeur: x.n,
      couleur: PALETTE[i % PALETTE.length],
    })),
    { centre: String(s.total), sousCentre: 'offres' }
  );

  rendreConversion(stats.parSource);

  rendreIndicateurMaj(meta);
}

/**
 * LA CONVERSION PAR SOURCE — ce qui manquait, et qui répond à « qu'est-ce qui
 * marche ». Le donut dit d'où viennent les OFFRES ; ce tableau dit d'où
 * viennent les RÉPONSES. Une source qui déverse mille annonces sans aboutir
 * vaut moins qu'un flux qui en donne dix dont trois répondent.
 *
 * Tant qu'on a peu postulé, la colonne « réponses » reste vide et le dit :
 * mieux vaut « pas encore » qu'un taux calculé sur deux candidatures.
 */
function rendreConversion(parSource) {
  const cible = document.getElementById('conversionSources');
  if (!cible) return;

  const total = parSource.reduce((t, x) => t + x.envoyees, 0);
  if (!total) {
    cible.innerHTML = '<p class="note-panel">Tu n\'as pas encore assez postulé pour '
      + 'que la conversion parle. Elle se remplira à mesure que les réponses arrivent.</p>';
    return;
  }

  const lignes = parSource.filter(x => x.envoyees > 0)
    .sort((a, b) => b.reponses - a.reponses || b.envoyees - a.envoyees)
    .map(x => {
      const taux = x.envoyees ? Math.round(x.reponses / x.envoyees * 100) : 0;
      return `<tr>
        <td>${SOURCE_LABEL[x.source] ?? x.source}</td>
        <td class="num">${x.n}</td>
        <td class="num">${x.envoyees}</td>
        <td class="num">${x.reponses || '—'}</td>
        <td class="num">${x.entretiens || '—'}</td>
        <td class="num conv-taux ${taux >= 25 ? 'bon' : ''}">${x.reponses ? taux + ' %' : '—'}</td>
      </tr>`;
    }).join('');

  cible.innerHTML = `<table class="conv-table">
    <thead><tr><th>Source</th><th class="num">Collectées</th><th class="num">Envoyées</th>
      <th class="num">Réponses</th><th class="num">Entretiens</th><th class="num">Taux</th></tr></thead>
    <tbody>${lignes}</tbody>
  </table>
  <p class="note-panel">« Réponse » = entretien ou refus (l'employeur s'est manifesté).
    Le taux ne s'affiche qu'une fois une réponse reçue.</p>`;
}

/** Courbe de rythme, selon la période choisie dans le sélecteur segmenté. */
export function rendreCourbe(stats, periode) {
  const cible = document.getElementById('courbeRythme');
  if (!cible) return;

  if (periode === 'semaines') {
    cible.innerHTML = barres(
      stats.semaines.map(s => ({
        etiquette: `Semaine du ${dateLisible(s.lundi)}`,
        court: courtISO(s.lundi),
        valeur: s.envois,
        couleur: 'var(--accent)',
      })),
      { hauteur: 190, unite: ' candidature(s)' }
    );
    return;
  }

  const jours = stats.serie90.slice(-Number(periode));
  cible.innerHTML = aire(
    jours.map(j => ({ etiquette: dateLisible(j.jour), court: courtISO(j.jour), valeur: j.actions })),
    { hauteur: 200, unite: ' action(s)' }
  ) + `<ul class="gr-legende en-ligne" style="margin-top:var(--e3)">
      <li><i style="background:var(--accent)"></i><span>Toutes tes actions du jour — candidatures, relances, lettres, notes</span></li>
    </ul>`;
}

/** Indicateur « dernière mise à jour », alimenté par le backend. */
export function rendreIndicateurMaj(meta) {
  const banniere = document.getElementById('veilleBanner');
  const texte = document.getElementById('veilleText');
  if (!banniere) return;
  banniere.classList.remove('stale', 'warn');

  if (!meta?.derniereCollecte) {
    banniere.classList.add('warn');
    texte.innerHTML = '⚠️ <strong>Aucune collecte encore effectuée.</strong> Clique sur « Rafraîchir maintenant » pour lancer la première.';
    return;
  }

  const jours = joursDepuis(meta.derniereCollecte);
  const quand = jours === 0 ? "aujourd'hui" : jours === 1 ? 'hier' : `il y a ${jours} jours`;
  const r = meta.resume;
  const detail = r ? ` — ${r.retenues} offre(s) retenue(s), ${r.nouvelles} nouvelle(s)` : '';

  if (meta.statut === 'non-configure') {
    banniere.classList.add('warn');
    texte.innerHTML = `⚙️ <strong>Aucune source configurée.</strong> Renseigne au moins une clé d'API dans le fichier <code>.env</code> pour que la collecte trouve des offres.`;
  } else if (meta.statut === 'echec') {
    banniere.classList.add('stale');
    texte.innerHTML = `❌ <strong>Dernière collecte en échec</strong> (${quand}). Les offres déjà enregistrées sont intactes.`;
  } else if (meta.statut === 'partiel') {
    banniere.classList.add('warn');
    texte.innerHTML = `⚠️ <strong>Collecte partielle</strong> ${quand}${detail}. Source(s) indisponible(s) : ${(r?.sourcesEnEchec ?? []).join(', ')}.`;
  } else if (jours >= 3) {
    banniere.classList.add('stale');
    texte.innerHTML = `⏳ <strong>Dernière mise à jour ${quand}</strong> (${dateLisible(meta.derniereCollecte)}). Un rafraîchissement serait utile.`;
  } else {
    texte.innerHTML = `✅ <strong>À jour</strong> — dernière collecte ${quand}${detail}.`;
  }
}

// ══════════════════════════════════════════ STATISTIQUES

export function rendreStats(stats, timeline) {
  const s = stats.resume;
  const p = stats.performance;

  document.getElementById('radarThemes').innerHTML = radar(stats.radar, { taille: 320 });

  document.getElementById('histoScores').innerHTML = barres(
    stats.distributionScores.map(t => ({ etiquette: `score ${t.libelle}`, court: t.libelle, valeur: t.n })),
    { hauteur: 170, couleur: 'var(--accent2)', unite: ' offre(s)' }
  );

  document.getElementById('barresContrat').innerHTML = barresH(
    stats.parContrat.map((c, i) => ({
      etiquette: c.contrat, valeur: c.n, couleur: PALETTE[i % PALETTE.length],
    })),
    { unite: ' offre(s)' }
  );

  document.getElementById('topEntreprises').innerHTML = stats.topEntreprises.length
    ? barresH(stats.topEntreprises.map(e => ({ etiquette: e.entreprise, valeur: e.n })), { unite: ' offre(s)' })
      + '<p class="note-panel">Une entreprise qui publie souvent recrute activement — ou peine à recruter. Les deux méritent un coup d\'œil.</p>'
    : vide('Aucune entreprise n\'a encore publié plusieurs offres');

  rendreTimeline(timeline);
}

/** Journal d'activité, groupé par jour. */
export function rendreTimeline(evenements) {
  const zone = document.getElementById('timeline');
  if (!zone) return;

  if (!evenements?.length) {
    zone.innerHTML = vide('Ton journal se remplira dès ta première action');
    return;
  }

  let jourCourant = null;
  zone.innerHTML = evenements.map(e => {
    let entete = '';
    if (e.jour !== jourCourant) {
      jourCourant = e.jour;
      entete = `<div class="tl-jour">${dateLisible(e.jour)}</div>`;
    }
    const modele = EVENEMENT[e.type] ?? { emoji: '•', texte: e.type };
    const sujet = e.titre ? `${e.titre}${e.entreprise ? ` · ${e.entreprise}` : ''}` : '';

    return `${entete}<div class="tl">
      <span class="tl-em">${modele.emoji}</span>
      <span class="tl-b">
        <span class="tl-t">${echapper(modele.texte)}</span>
        ${sujet ? `<span class="tl-s">${echapper(sujet)}</span>` : ''}
      </span>
      <span class="tl-q">${e.cree_le ? ilYA(e.cree_le) : ''}</span>
    </div>`;
  }).join('');
}
