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

// ------------------------------------------------------------- ANIMATIONS

/**
 * Fait défiler un compteur de 0 jusqu'à sa valeur.
 *
 * La valeur finale est écrite AVANT de lancer l'animation. C'est essentiel :
 * requestAnimationFrame ne se déclenche pas dans un onglet en arrière-plan ni
 * quand la fenêtre n'est pas composée. Si l'animation ne démarrait jamais,
 * une version qui ne posait la valeur qu'à la fin laissait des « 0 » affichés.
 * L'animation est un embellissement, jamais la source du chiffre.
 */
function animerCompteur(el, valeur, duree = 700) {
  el.textContent = valeur;

  if (valeur === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const debut = performance.now();
  const pas = (t) => {
    const p = Math.min((t - debut) / duree, 1);
    // Décélération : rapide au début, s'arrête en douceur.
    el.textContent = Math.round(valeur * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(pas);
    else el.textContent = valeur; // garantit la valeur exacte à l'arrivée
  };
  requestAnimationFrame(pas);
}

/** Petite pluie de confettis — quand une candidature décroche un entretien. */
export function celebrer() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const couleurs = ['var(--accent)', 'var(--accent2)', 'var(--g1)', 'var(--g2)', 'var(--pink)', 'var(--info)'];
  for (let i = 0; i < 44; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = couleurs[i % couleurs.length];
    c.style.animationDelay = Math.random() * 0.5 + 's';
    c.style.animationDuration = (2 + Math.random() * 1.4) + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 4200);
  }
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

  const tuile = (cls, ic, valeur, libelle, couleur) =>
    `<div class="stat ${cls}"><span class="ic">${ic}</span>
     <div class="n${couleur ? ' plain' : ''}"${couleur ? ` style="color:${couleur}"` : ''} data-compteur="${valeur}">0</div>
     <div class="l">${libelle}</div></div>`;

  document.getElementById('stats').innerHTML =
    tuile('', '📋', offres.length, 'Offres suivies') +
    tuile('s-g1', '🎯', actionnables, 'Actionnables', 'var(--g1)') +
    tuile('s-info', '📨', envoyees, 'Envoyées', 'var(--info)') +
    tuile('s-g2', '🤝', parStatut['Entretien'], 'Entretiens', 'var(--g2)') +
    tuile('s-hot', '⏰', relances, 'Relances à faire', 'var(--hot)') +
    tuile('', '🔥', fraiches, 'Offres fraîches (≤7j)');

  document.getElementById('funnel').innerHTML = STATUSES.map(s => {
    const n = parStatut[s];
    const pct = offres.length ? Math.round(n / offres.length * 100) : 0;
    return `<div class="funnel-row"><span class="fname">${s}</span><span class="ftrack"><span class="ffill" style="width:${pct}%;background:${STATUS_COL[s]}"></span></span><span class="fn">${n}</span></div>`;
  }).join('');

  // Anneau : part des offres pour lesquelles tu as effectivement postulé.
  const pctEnvoye = offres.length ? Math.round(envoyees / offres.length * 100) : 0;
  const anneau = document.getElementById('ringFg');
  const circonference = 2 * Math.PI * 47;
  anneau.style.strokeDasharray = circonference;
  anneau.style.strokeDashoffset = circonference;
  // Lecture forcée du layout : la transition CSS part bien de zéro, sans
  // dépendre de requestAnimationFrame (bridé hors du premier plan).
  void anneau.getBoundingClientRect();
  anneau.style.strokeDashoffset = circonference * (1 - pctEnvoye / 100);
  document.getElementById('ringPct').textContent = pctEnvoye + '%';

  rendrePerformance(offres, parStatut, envoyees);
  rendreActivite(offres);

  document.querySelectorAll('#stats [data-compteur], #perf [data-compteur]')
    .forEach(el => animerCompteur(el, Number(el.dataset.compteur)));

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

/**
 * Statistiques de résultat : ce que tes candidatures donnent réellement.
 * Le taux de réponse se calcule sur les candidatures envoyées, pas sur
 * l'ensemble des offres — sinon il serait artificiellement bas.
 */
function rendrePerformance(offres, parStatut, envoyees) {
  const entretiens = parStatut['Entretien'];
  const refus = parStatut['Refus'];
  const reponses = entretiens + refus;

  const tauxReponse = envoyees ? Math.round(reponses / envoyees * 100) : 0;
  const tauxEntretien = envoyees ? Math.round(entretiens / envoyees * 100) : 0;

  // Délai moyen entre l'envoi et aujourd'hui, pour les candidatures sans réponse.
  const enAttente = offres.filter(o =>
    o.suivi.sent && (o.suivi.status === 'Envoyé' || o.suivi.status === 'Relancé'));
  const delaiMoyen = enAttente.length
    ? Math.round(enAttente.reduce((t, o) => t + joursDepuis(o.suivi.sent), 0) / enAttente.length)
    : 0;

  const tuile = (ic, valeur, suffixe, libelle, couleur, cls = '') =>
    `<div class="stat ${cls}"><span class="ic">${ic}</span>
     <div class="n plain" style="color:${couleur}"><span data-compteur="${valeur}">0</span>${suffixe}</div>
     <div class="l">${libelle}</div></div>`;

  document.getElementById('perf').innerHTML =
    tuile('💬', tauxReponse, '%', `Taux de réponse (sur ${envoyees} envoi${envoyees > 1 ? 's' : ''})`, 'var(--info)', 's-info') +
    tuile('🎯', tauxEntretien, '%', 'Taux d\'entretien', 'var(--g1)', 's-g1') +
    tuile('⏳', delaiMoyen, ' j', `En attente depuis (moy.)`, 'var(--g2)', 's-g2') +
    tuile('🤐', envoyees - reponses, '', 'Sans réponse à ce jour', 'var(--muted)');
}

/** Courbe d'activité : nombre de candidatures envoyées par jour sur 30 jours. */
function rendreActivite(offres) {
  const jours = 30;
  const compte = new Array(jours).fill(0);

  offres.forEach(o => {
    if (!o.suivi.sent) return;
    const ecart = joursDepuis(o.suivi.sent);
    if (ecart >= 0 && ecart < jours) compte[jours - 1 - ecart]++;
  });

  const max = Math.max(...compte, 1);
  document.getElementById('spark').innerHTML = compte.map((n, i) => {
    const date = new Date(Date.now() - (jours - 1 - i) * 86400000);
    const titre = `${date.getDate()} ${MOIS[date.getMonth()].slice(0, 4)} : ${n} candidature${n > 1 ? 's' : ''}`;
    return `<i class="${n === max && n > 0 ? 'hot' : ''}" style="height:${Math.max(n / max * 100, 3)}%;animation-delay:${i * 12}ms" title="${titre}"></i>`;
  }).join('');
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

// ------------------------------------------------------------ FOCUS DU JOUR

/**
 * Construit la liste des actions à mener, de la plus urgente à la moins
 * pressante. Le tri reflète le coût d'une inaction : rater une relance ou
 * un entretien coûte plus cher que ne pas postuler à une offre qui restera
 * ouverte quelques jours.
 */
export function actionsDuJour(offres) {
  const aujourdhui = todayISO();
  const actions = [];

  // 1. Relances en retard — le plus coûteux à laisser filer.
  offres.filter(relanceDue).forEach(o => {
    const retard = joursDepuis(o.suivi.relance);
    actions.push({
      rang: 0, classe: 'urgent', icone: '⏰', offre: o,
      titre: o.titre,
      sous: `${o.entreprise} · relance prévue ${retard === 0 ? "aujourd'hui" : `il y a ${retard} j`}`,
      quoi: 'Relancer',
    });
  });

  // 2. Entretiens à préparer.
  offres.filter(o => o.suivi.status === 'Entretien').forEach(o => {
    actions.push({
      rang: 1, classe: 'chaud', icone: '🤝', offre: o,
      titre: o.titre,
      sous: `${o.entreprise} · entretien en cours — prépare tes arguments`,
      quoi: 'Préparer',
    });
  });

  // 3. Offres prioritaires jamais envoyées, les plus fraîches d'abord.
  offres
    .filter(o => o.groupe === 1 && o.suivi.status === 'À postuler')
    .sort((a, b) => (ageOffre(a.dateOffre) ?? 999) - (ageOffre(b.dateOffre) ?? 999))
    .forEach(o => {
      const age = ageOffre(o.dateOffre);
      actions.push({
        rang: 2, classe: 'ok', icone: '🟢', offre: o,
        titre: o.titre,
        sous: `${o.entreprise} · ${o.ville}${age !== null ? ` · publiée il y a ${age} j` : ''}`,
        quoi: o.aLettre ? 'Postuler' : 'Rédiger la lettre',
      });
    });

  // 4. Offres possibles jamais envoyées.
  offres
    .filter(o => o.groupe === 2 && o.suivi.status === 'À postuler')
    .forEach(o => actions.push({
      rang: 3, classe: '', icone: '🟡', offre: o,
      titre: o.titre, sous: `${o.entreprise} · ${o.ville}`, quoi: 'Étudier',
    }));

  // 5. Offres à vérifier : décider si elles méritent une candidature.
  offres
    .filter(o => o.groupe === 0 && o.suivi.status === 'À postuler')
    .forEach(o => actions.push({
      rang: 4, classe: '', icone: '⚪', offre: o,
      titre: o.titre, sous: `${o.entreprise} · analyse incomplète`, quoi: 'Vérifier',
    }));

  return actions.sort((a, b) => a.rang - b.rang);
}

export function rendreFocus(offres, surClic) {
  const actions = actionsDuJour(offres);
  const zone = document.getElementById('focusList');
  const urgentes = actions.filter(a => a.rang === 0).length;

  document.getElementById('focusSub').textContent = actions.length
    ? `${actions.length} action${actions.length > 1 ? 's' : ''} en attente${urgentes ? ` · ${urgentes} urgente${urgentes > 1 ? 's' : ''}` : ''}`
    : '';

  if (actions.length === 0) {
    zone.innerHTML = `<div class="focus-vide">
      <span class="em">🎉</span>
      <div style="font-size:16px;font-weight:600;margin-bottom:6px">Rien d'urgent aujourd'hui.</div>
      <div style="color:var(--muted);font-size:13.5px">Tout est traité. Lance une collecte pour voir les nouvelles offres,<br>ou souffle un peu — c'est mérité.</div>
    </div>`;
    return;
  }

  zone.innerHTML = '';
  actions.forEach((a, i) => {
    const el = document.createElement('div');
    el.className = 'focus-card ' + a.classe;
    el.style.animationDelay = (i * 0.04) + 's';
    el.innerHTML = `
      <div class="focus-ic">${a.icone}</div>
      <div class="focus-body">
        <div class="ft">${echapper(a.titre)}</div>
        <div class="fs">${echapper(a.sous)}</div>
      </div>
      <span class="focus-quoi">${a.quoi}</span>`;
    el.addEventListener('click', () => surClic(a.offre));
    zone.appendChild(el);
  });
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
