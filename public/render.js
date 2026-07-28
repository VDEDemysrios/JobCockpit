// Construction du HTML des différentes vues.
// Aucun accès réseau ici : ces fonctions reçoivent les données et rendent.
import {
  GM, STATUSES, STATUS_COL, STATUS_PROG, STATUS_BG, KWCOLOR, MOIS, SOURCE_LABEL,
  todayISO, joursDepuis, ageOffre, etiquetteFraicheur, dateLisible, echapper,
} from './format.js';

const liste = (a) => (a ?? []).map(x => `<li>${echapper(x)}</li>`).join('');

/** Une relance est due si sa date est passée et la candidature encore active. */
export function relanceDue(offre) {
  const s = offre.suivi;
  return Boolean(s.relance) && s.relance <= todayISO()
    && s.status !== 'Refus' && s.status !== 'Entretien';
}

// ---------------------------------------------------------------- DASHBOARD

export function rendreDashboard(offres, meta) {
  const parGroupe = { 1: 0, 2: 0, 3: 0, 0: 0 };
  offres.forEach(o => { parGroupe[o.groupe] = (parGroupe[o.groupe] ?? 0) + 1; });
  const actionnables = parGroupe[1] + parGroupe[2];

  const parStatut = Object.fromEntries(STATUSES.map(s => [s, 0]));
  offres.forEach(o => { parStatut[o.suivi.status] = (parStatut[o.suivi.status] ?? 0) + 1; });
  const envoyees = parStatut['Envoyé'] + parStatut['Relancé'] + parStatut['Entretien'] + parStatut['Refus'];

  const relances = offres.filter(relanceDue).length;
  const fraiches = offres.filter(o => { const a = ageOffre(o.dateOffre); return a !== null && a <= 7; }).length;

  document.getElementById('dashSub').textContent =
    `${offres.length} offres · ${actionnables} actionnables · ${envoyees} envoyées`;

  document.getElementById('stats').innerHTML = `
    <div class="stat"><span class="ic">📋</span><div class="n">${offres.length}</div><div class="l">Offres suivies</div></div>
    <div class="stat s-g1"><span class="ic">🎯</span><div class="n" style="color:var(--g1)">${actionnables}</div><div class="l">Actionnables</div></div>
    <div class="stat s-info"><span class="ic">📨</span><div class="n" style="color:var(--info)">${envoyees}</div><div class="l">Envoyées</div></div>
    <div class="stat s-g2"><span class="ic">🤝</span><div class="n" style="color:var(--g2)">${parStatut['Entretien']}</div><div class="l">Entretiens</div></div>
    <div class="stat s-hot"><span class="ic">⏰</span><div class="n" style="color:var(--hot)">${relances}</div><div class="l">Relances à faire</div></div>
    <div class="stat"><span class="ic">🔥</span><div class="n">${fraiches}</div><div class="l">Offres fraîches (≤7j)</div></div>`;

  document.getElementById('funnel').innerHTML = STATUSES.map(s => {
    const n = parStatut[s];
    const pct = offres.length ? Math.round(n / offres.length * 100) : 0;
    return `<div class="funnel-row"><span class="fname">${s}</span><span class="ftrack"><span class="ffill" style="width:${pct}%;background:${STATUS_COL[s]}"></span></span><span class="fn">${n}</span></div>`;
  }).join('');

  const villes = {};
  offres.forEach(o => {
    const v = (String(o.ville ?? '').match(/^([^(]+)/) || ['', o.ville])[1].trim() || '—';
    villes[v] = (villes[v] ?? 0) + 1;
  });
  const max = Math.max(...Object.values(villes), 1);
  document.getElementById('citybars').innerHTML = Object.entries(villes)
    .sort((a, b) => b[1] - a[1])
    .map(([v, n]) => `<div class="citybar"><span class="cn">${echapper(v)}</span><span class="ct"><span class="cf" style="width:${n / max * 100}%"></span></span><span style="font-weight:700;width:20px;text-align:right">${n}</span></div>`)
    .join('');

  rendreIndicateurMaj(meta);
}

/** Indicateur « dernière mise à jour », alimenté par le backend. */
export function rendreIndicateurMaj(meta) {
  const banniere = document.getElementById('veilleBanner');
  const texte = document.getElementById('veilleText');
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

// ------------------------------------------------------------------- OFFRES

export function rendreCarte(offre, actions) {
  const g = GM[offre.groupe] ?? GM[0];
  const s = offre.suivi;
  const carte = document.createElement('div');
  carte.className = 'card';
  carte.dataset.g = offre.groupe;
  if (s.pinned) carte.classList.add('pinned');

  const due = relanceDue(offre);
  const fl = etiquetteFraicheur(ageOffre(offre.dateOffre));
  const prog = STATUS_PROG[s.status] ?? 10;
  const a = offre.analyse;

  let detail = '';

  if (a) {
    if ((a.exige ?? []).length || (a.souhaite ?? []).length) {
      detail += `<div class="sec"><div class="cols3">
        <div><div class="lbl req">⛔ EXIGÉ</div><ul class="mini">${liste(a.exige)}</ul></div>
        <div><div class="lbl want">➕ SOUHAITÉ</div><ul class="mini">${liste(a.souhaite)}</ul></div>
        <div><div class="lbl deco">💬 DÉCORATIF</div><ul class="mini">${liste(a.decoratif)}</ul></div></div></div>`;
    }
    if ((a.prouvable ?? []).length || (a.nonprouvable ?? []).length) {
      detail += `<div class="sec"><div class="cols3">
        <div><div class="lbl ok">✅ PROUVABLE</div><ul class="mini">${liste(a.prouvable)}</ul></div>
        <div><div class="lbl no">❌ NON PROUVABLE</div><ul class="mini">${liste(a.nonprouvable)}</ul></div>
        <div><div class="lbl fix">🔧 COMPENSABLE</div><ul class="mini">${liste(a.compensable)}</ul></div></div></div>`;
    }
    if (a.verdict) {
      // Le score par mots-clés et le jugement de l'analyse peuvent diverger :
      // les mots-clés voient « énergie renouvelable », pas le métier réel.
      // Quand c'est le cas, on le dit — le verdict fait autorité.
      const verdictNegatif = /^\s*(non|à écarter|a ecarter|passe ton chemin)/i.test(a.verdict);
      const desaccord = verdictNegatif && (offre.groupe === 1 || offre.groupe === 2)
        ? `<span class="desaccord">⚠️ Le tri par mots-clés a classé cette offre « ${g.label} », mais l'analyse du contenu dit non. <strong>Fie-toi à l'analyse</strong> : les mots-clés ne voient pas le métier réel.</span>`
        : '';
      detail += `<div class="verdict ${g.vd}"><strong>⚖️ Verdict :</strong> ${echapper(a.verdict)}${desaccord}</div>`;
    }
    if ((a.kw ?? []).length) {
      detail += `<div class="sec"><div class="lbl fix">🔑 MOTS-CLÉS ABSENTS DU CV</div>
        <table class="kwtable"><tr><th>Mot-clé</th><th style="width:80px">Revendicable</th><th>Pourquoi</th></tr>
        ${a.kw.map(k => {
          const c = KWCOLOR[String(k[1]).toLowerCase()] ?? KWCOLOR.partiel;
          return `<tr><td style="font-weight:600">${echapper(k[0])}</td><td><span class="pill" style="background:${c[0]};color:${c[1]}">${c[2]}</span></td><td style="color:var(--muted)">${echapper(k[2])}</td></tr>`;
        }).join('')}</table></div>`;
    }
    if (a.fourchette) {
      detail += `<div class="sec"><div class="lbl fix">💰 CADRAGE DES PRÉTENTIONS</div>
        <div class="money"><strong>Fourchette : ${echapper(a.fourchette)}</strong><div style="color:var(--muted);font-size:12px;margin-top:4px">${echapper(a.fnote ?? '')}</div></div>
        <div class="cols2">
          <div><div class="lbl ok">3 FORMULATIONS</div><ul class="mini">${(a.formul ?? []).map(x => `<li style="font-style:italic;margin-bottom:6px">${echapper(x)}</li>`).join('')}</ul></div>
          <div><div class="lbl want">SI « AU-DESSUS DU BUDGET »</div><ul class="mini">${(a.budget ?? []).map(x => `<li style="font-style:italic;margin-bottom:6px">${echapper(x)}</li>`).join('')}</ul></div>
        </div></div>`;
    }
  } else {
    detail += `<div class="sec" style="color:var(--muted);font-size:13px">⏳ Analyse non disponible pour cette offre (quota atteint, ou description trop courte). Elle sera retentée à la prochaine collecte.</div>`;
  }

  // Suivi de candidature
  const postule = s.status !== 'À postuler';
  detail += `<div class="sec"><div class="lbl fix">📌 SUIVI DE CANDIDATURE</div>
    <div style="margin-bottom:10px"><span class="applied-toggle ${postule ? '' : 'off'}" data-act="postule">${postule ? '✅ Candidature envoyée' : '⬜ Pas encore postulé'}</span></div>
    <div class="track-row">
      <div class="track-field"><label>Statut</label><select data-champ="status">${STATUSES.map(x => `<option ${x === s.status ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="track-field"><label>Date d'envoi</label><input type="date" data-champ="sent" value="${s.sent}"></div>
      <div class="track-field"><label>Relance prévue</label><input type="date" data-champ="relance" value="${s.relance}"></div>
      ${due ? '<span class="relance-flag">⏰ Relance à faire !</span>' : ''}
    </div>
    <textarea class="notes-area" data-champ="notes" placeholder="Notes : contact, prépa entretien, ressenti…">${echapper(s.notes)}</textarea></div>`;

  // Lettre de motivation
  detail += `<div class="sec" data-lettre="${offre.id}">
    <div class="lbl fix">✉️ LETTRE DE MOTIVATION</div>
    <div class="letter-actions">
      <button class="btn btn-primary" data-act="lettre">${offre.aLettre ? '✉️ Afficher la lettre' : '✉️ Rédiger la lettre'}</button>
    </div>
    <div class="letter-zone"></div>
  </div>`;

  const badgesSources = (offre.sources ?? [])
    .map(s2 => `<span class="badge badge-src">${SOURCE_LABEL[s2] ?? s2}</span>`).join('');

  carte.innerHTML = `<div class="head">
    <span class="chevron">▸</span>
    <span class="pinbtn ${s.pinned ? 'on' : ''}" data-act="pin">${s.pinned ? '★' : '☆'}</span>
    <div class="titlebox">
      <div class="ptitle">${echapper(offre.titre)}</div>
      <div class="pmeta">${echapper(offre.entreprise)} · ${echapper(offre.ville)}${offre.dateOffre ? ' · offre du ' + dateLisible(offre.dateOffre) : ''}</div>
      <div class="cardprog"><span style="width:${prog}%;background:${STATUS_COL[s.status]}"></span></div>
    </div>
    <div class="tags">
      ${fl ? `<span class="fresh ${fl[0]}">${fl[1]}</span>` : ''}
      ${offre.horsZone ? '<span class="badge badge-zone">🌍 Hors zone</span>' : ''}
      ${badgesSources}
      <span class="status-pill" style="border-color:${STATUS_COL[s.status]};color:${STATUS_COL[s.status]}">${s.status}${due ? ' ⏰' : ''}</span>
      <span class="badge ${g.key}">${g.label}</span>
      ${offre.lien ? `<a class="link" href="${echapper(offre.lien)}" target="_blank" rel="noopener" data-act="lien">Voir ↗</a>` : ''}
      ${offre.isManual ? '<span class="link" style="color:var(--g3);cursor:pointer" data-act="suppr">✕</span>' : ''}
    </div></div>
    <div class="detail">${detail}</div>`;

  actions.brancher(carte, offre);
  return carte;
}

// ------------------------------------------------------------------- KANBAN

export function rendreKanban(offres, surDepot) {
  const zone = document.getElementById('kanban');
  zone.innerHTML = '';

  STATUSES.forEach(statut => {
    const col = document.createElement('div');
    col.className = 'kcol';
    col.dataset.status = statut;

    const items = offres.filter(o => o.suivi.status === statut);
    col.innerHTML = `<h4 style="background:${STATUS_BG[statut]};color:${STATUS_COL[statut]}">${statut}<span>${items.length}</span></h4>`;

    items.forEach(o => {
      const c = document.createElement('div');
      c.className = 'kcard';
      c.draggable = true;
      c.dataset.id = o.id;
      c.style.borderLeftColor = { 1: 'var(--g1)', 2: 'var(--g2)', 3: 'var(--g3)', 0: 'var(--g0)' }[o.groupe];
      c.innerHTML = `<div class="kt">${echapper(o.titre)}</div><div class="km">${echapper(o.entreprise)} · ${echapper(o.ville)}</div>`;
      c.addEventListener('dragstart', ev => { ev.dataTransfer.setData('id', o.id); c.classList.add('drag'); });
      c.addEventListener('dragend', () => c.classList.remove('drag'));
      col.appendChild(c);
    });

    col.addEventListener('dragover', ev => { ev.preventDefault(); col.classList.add('dragover'); });
    col.addEventListener('dragleave', () => col.classList.remove('dragover'));
    col.addEventListener('drop', ev => {
      ev.preventDefault();
      col.classList.remove('dragover');
      surDepot(ev.dataTransfer.getData('id'), statut);
    });

    zone.appendChild(col);
  });
}

// ------------------------------------------------------------------- AGENDA

export function rendreAgenda(offres) {
  const aujourdhui = todayISO();
  const items = offres
    .filter(o => o.suivi.relance && o.suivi.status !== 'Refus' && o.suivi.status !== 'Entretien')
    .map(o => ({ offre: o, date: o.suivi.relance }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const zone = document.getElementById('agenda');
  zone.innerHTML = '';
  document.getElementById('agendaEmpty').style.display = items.length ? 'none' : 'block';
  document.getElementById('agendaSub').textContent = items.length ? `${items.length} relance(s) planifiée(s)` : '';

  items.forEach((it, i) => {
    const d = new Date(it.date);
    const enRetard = it.date < aujourdhui;
    const bientot = !enRetard && joursDepuis(it.date) >= -2;

    const el = document.createElement('div');
    el.className = 'agenda-item' + (enRetard ? ' overdue' : bientot ? ' soon' : '');
    el.style.animationDelay = (i * 0.05) + 's';
    el.innerHTML = `
      <div class="agenda-date"><div class="ad-d">${d.getDate()}</div><div class="ad-m">${MOIS[d.getMonth()].slice(0, 3)}</div></div>
      <div class="agenda-body"><div class="ab-t">${echapper(it.offre.titre)}</div><div class="ab-s">${echapper(it.offre.entreprise)} · ${echapper(it.offre.ville)}</div></div>
      <span class="agenda-tag" style="background:${enRetard ? 'var(--hotb)' : 'var(--g2b)'};color:${enRetard ? 'var(--hot)' : 'var(--g2)'}">${enRetard ? '⏰ En retard' : '📌 À venir'}</span>
      ${it.offre.lien ? `<a class="link" href="${echapper(it.offre.lien)}" target="_blank" rel="noopener">Voir ↗</a>` : ''}`;
    zone.appendChild(el);
  });
}
