// Construction du HTML des vues centrées sur les offres :
// cartes, focus du jour, kanban, agenda.
// Aucun accès réseau ici : ces fonctions reçoivent les données et rendent.
import {
  GM, STATUSES, STATUS_COL, STATUS_PROG, STATUS_BG, STATUS_EMOJI, KWCOLOR,
  MOIS, MOIS_COURT, SOURCE_LABEL,
  todayISO, joursDepuis, ageOffre, etiquetteFraicheur, dateLisible, echapper, pluriel,
} from './format.js';
import { icone } from './icons.js';
import { offresDuJour, envoyeesAujourdhui } from './selection.js';

const liste = (a) => (a ?? []).map(x => `<li>${echapper(x)}</li>`).join('');

/** Une relance est due si sa date est passée et la candidature encore active. */
export function relanceDue(offre) {
  const s = offre.suivi;
  return Boolean(s.relance) && s.relance <= todayISO()
    && s.status !== 'Refus' && s.status !== 'Entretien';
}

// ------------------------------------------------------------- ANIMATIONS

// Un entretien décroché est le seul moment que l'application célèbre encore.
// Ce n'est pas un score : c'est la seule chose que l'auteur cherche vraiment.
export function celebrer(intensite = 44) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const couleurs = ['var(--accent)', 'var(--accent2)', 'var(--g1)', 'var(--g2)', 'var(--pink)', 'var(--info)'];
  for (let i = 0; i < intensite; i++) {
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

// ------------------------------------------------------------ FOCUS DU JOUR

/**
 * Construit la liste des actions à mener, de la plus urgente à la moins
 * pressante. Le tri reflète le coût d'une inaction : rater une relance ou
 * un entretien coûte plus cher que ne pas postuler à une offre qui restera
 * ouverte quelques jours.
 */
/**
 * Jours avant un entretien. Comparaison à MINUIT des deux côtés : sans cela,
 * un entretien fixé ce matin à 9 h serait compté « demain » l'après-midi même.
 */
function joursAvantEntretien(iso) {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return -1;
  const aujourdhui = new Date();
  aujourdhui.setHours(0, 0, 0, 0);
  return Math.round((d - aujourdhui) / 86400000);
}

export function actionsDuJour(offres) {
  const actions = [];

  // 0. LES ENTRETIENS DATÉS, AVANT TOUT LE RESTE.
  //
  // Une relance oubliée se rattrape le lendemain ; une candidature non
  // envoyée le reste sans conséquence. Un entretien, non. C'est la seule
  // échéance d'une recherche d'emploi qu'on ne peut ni décaler ni refaire,
  // et c'est aussi celle qui décide. Elle passe donc devant.
  offres
    .filter(o => o.suivi.entretien && joursAvantEntretien(o.suivi.entretien) >= 0)
    .sort((a, b) => joursAvantEntretien(a.suivi.entretien) - joursAvantEntretien(b.suivi.entretien))
    .forEach(o => {
      const j = joursAvantEntretien(o.suivi.entretien);
      const quand = j === 0 ? "aujourd'hui" : j === 1 ? 'demain' : `dans ${j} jours`;
      actions.push({
        rang: -1, classe: j <= 2 ? 'urgent' : 'chaud', icone: icone('poignee', 13),
        offre: o, groupe: 'Urgent',
        titre: o.titre,
        sous: `${o.entreprise || 'Entretien'} · entretien ${quand}`,
        quoi: 'Préparer',
      });
    });

  // 1. Relances en retard — le plus coûteux à laisser filer.
  offres.filter(relanceDue).forEach(o => {
    const retard = joursDepuis(o.suivi.relance);
    actions.push({
      rang: 0, classe: 'urgent', icone: icone('cloche', 13), offre: o, groupe: 'Urgent',
      titre: o.titre,
      sous: `${o.entreprise} · relance prévue ${retard === 0 ? "aujourd'hui" : `il y a ${retard} j`}`,
      quoi: 'Relancer',
    });
  });

  // 2. Entretiens décrochés mais SANS DATE : on ne peut pas les classer par
  //    urgence, mais les taire reviendrait à les oublier.
  offres
    .filter(o => o.suivi.status === 'Entretien' && !o.suivi.entretien)
    .forEach(o => {
      actions.push({
        rang: 1, classe: 'chaud', icone: icone('poignee', 13), offre: o, groupe: 'Urgent',
        titre: o.titre,
        sous: `${o.entreprise} · entretien décroché — note la date pour qu'elle compte`,
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
        rang: 2, classe: 'ok', icone: icone('cible', 13), offre: o, groupe: 'Prioritaires à traiter',
        titre: o.titre,
        sous: `${o.entreprise} · ${o.ville}${age !== null ? ` · publiée il y a ${age} j` : ''}`,
        quoi: o.aLettre ? 'Postuler' : 'Rédiger la lettre',
      });
    });

  // 4. Offres possibles jamais envoyées.
  offres
    .filter(o => o.groupe === 2 && o.suivi.status === 'À postuler')
    .forEach(o => actions.push({
      rang: 3, classe: '', icone: icone('loupe', 13), offre: o, groupe: 'À étudier',
      titre: o.titre, sous: `${o.entreprise} · ${o.ville}`, quoi: 'Étudier',
    }));

  // 5. Offres à vérifier : décider si elles méritent une candidature.
  offres
    .filter(o => o.groupe === 0 && o.suivi.status === 'À postuler')
    .forEach(o => actions.push({
      rang: 4, classe: '', icone: icone('info', 13), offre: o, groupe: 'À vérifier',
      titre: o.titre, sous: `${o.entreprise} · analyse incomplète`, quoi: 'Vérifier',
    }));

  return actions.sort((a, b) => a.rang - b.rang);
}

/**
 * Le bloc « Les 3 du jour ».
 *
 * Il passe AVANT la file d'attente, et c'est tout le propos : la file dit ce
 * qu'il resterait à faire, celui-ci dit par quoi commencer. Trois lignes qu'on
 * peut finir valent mieux que deux cent quatre-vingt-deux qu'on ne finira pas.
 *
 * @param {object[]} offres
 * @param {{ouvrir: Function, ecarter: Function}} actions
 */
export function rendreTroisDuJour(offres, actions) {
  const zone = document.getElementById('duJour');
  if (!zone) return;
  const { offres: choisies, criteresRelaches, vivier } = offresDuJour(offres, 3);
  const envoyees = envoyeesAujourdhui(offres);

  const sous = document.getElementById('duJourSub');
  if (sous) {
    sous.textContent = envoyees > 0
      ? `${pluriel(envoyees, 'candidature')} envoyée${envoyees > 1 ? 's' : ''} aujourd'hui`
      : (choisies.length ? 'Commence par celles-ci.' : '');
  }

  if (!choisies.length) {
    zone.innerHTML = `<div class="dj-vide">Tout est traité de ce côté-là.
      Lance une collecte, ou va piocher dans l'onglet Offres.</div>`;
    return;
  }

  zone.innerHTML = '';
  choisies.forEach((offre, i) => {
    const el = document.createElement('div');
    el.className = 'dj-carte';
    el.style.animationDelay = (i * 0.06) + 's';
    const age = offre.age === 0 ? "aujourd'hui"
      : offre.age !== null ? `il y a ${pluriel(offre.age, 'jour')}` : '';
    el.innerHTML = `
      <div class="dj-rang">${i + 1}</div>
      <div class="dj-corps">
        <div class="dj-titre">${echapper(offre.titre)}</div>
        <div class="dj-meta">${echapper(offre.entreprise || 'entreprise non précisée')}
          · ${echapper(offre.ville ?? '')}${age ? ' · publiée ' + age : ''}</div>
        ${(() => {
          // L'ATOUT EN PREMIER, PAS LE SCORE.
          // Un score de 18 ne dit rien à celui qui doute de coller ; « quatre
          // ans de développement de projets EnR, exigé dans l'annonce » le dit.
          const f = forces(offre.analyse);
          if (!f?.premierAtout) return '';
          return `<div class="dj-atout"><b>Ton atout ici :</b> ${echapper(f.premierAtout.slice(0, 150))}</div>`;
        })()}
        <div class="dj-signaux">
          ${offre.score !== null && offre.score !== undefined
            ? `<span class="scorepill fort">⚡ ${offre.score}</span>` : ''}
          ${(() => {
            const f = forces(offre.analyse);
            if (!f?.atouts) return offre.analyse ? '<span class="badge b1">analyse prête</span>' : '';
            return `<span class="badge b1">${f.atouts} atout${f.atouts > 1 ? 's' : ''} prouvable${f.atouts > 1 ? 's' : ''}</span>`
              + (f.manques ? `<span class="badge b0">${f.manques} manque${f.manques > 1 ? 's' : ''}</span>` : '');
          })()}
          ${offre.aLettre ? '<span class="badge b2">lettre écrite</span>' : ''}
        </div>
      </div>
      <div class="dj-actions">
        <button class="btn btn-primary" data-dj="ouvrir">${offre.aLettre ? 'Postuler' : 'Ouvrir'}</button>
        <button class="btn btn-discret" data-dj="ecarter" title="Retirer cette offre de la sélection">Pas celle-ci</button>
      </div>`;
    el.querySelector('[data-dj="ouvrir"]').addEventListener('click', () => actions.ouvrir(offre));
    el.querySelector('[data-dj="ecarter"]').addEventListener('click', () => actions.ecarter(offre));
    zone.appendChild(el);
  });

  // Dire QUAND la sélection a dû baisser d'exigence, plutôt que de faire comme
  // si ces trois-là étaient toujours les meilleures possibles.
  if (criteresRelaches.length) {
    const note = document.createElement('div');
    note.className = 'dj-note';
    note.textContent = `Vivier réduit (${vivier}) — critère(s) assoupli(s) : ${criteresRelaches.join(', ')}.`;
    zone.appendChild(note);
  }
}

export function rendreFocus(offres, surClic) {
  const actions = actionsDuJour(offres);
  const zone = document.getElementById('focusList');
  const urgentes = actions.filter(a => a.rang === 0).length;

  document.getElementById('focusSub').textContent = actions.length
    ? `${pluriel(actions.length, 'action')} en attente${urgentes ? ` · ${pluriel(urgentes, 'urgente')}` : ''}`
    : 'Rien ne presse.';

  if (actions.length === 0) {
    zone.innerHTML = `<div class="focus-vide">
      <span class="em">🎉</span>
      <div style="font-size:16px;font-weight:600;margin-bottom:6px">Rien d'urgent aujourd'hui.</div>
      <div style="color:var(--muted);font-size:13.5px">Tout est traité. Lance une collecte pour voir les nouvelles offres,<br>ou souffle un peu — c'est mérité.</div>
    </div>`;
    return;
  }

  // Un « focus » montre le haut de la pile, pas la pile. À 30 lignes le
  // panneau faisait 2 550 px — les deux tiers du tableau de bord, statistiques
  // et graphiques repoussés hors de vue. Douze remplissent la zone bornée
  // ci-dessous sans jamais la déborder ; le reste est à un clic, dans Offres.
  const affichees = actions.slice(0, 12);
  zone.innerHTML = '';
  let groupeCourant = null;

  affichees.forEach((a, i) => {
    if (a.groupe !== groupeCourant) {
      groupeCourant = a.groupe;
      const titre = document.createElement('div');
      titre.className = 'focus-groupe';
      titre.textContent = groupeCourant;
      zone.appendChild(titre);
    }

    const el = document.createElement('div');
    el.className = 'focus-card ' + a.classe;
    el.style.animationDelay = (i * 0.03) + 's';
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

  if (actions.length > affichees.length) {
    const reste = document.createElement('div');
    reste.className = 'count';
    reste.style.marginTop = 'var(--e3)';
    reste.textContent = `+ ${actions.length - affichees.length} autres offres en attente dans l'onglet Offres.`;
    zone.appendChild(reste);
  }
}

// ------------------------------------------------------------------- OFFRES

/**
 * Ce que l'analyse dit du RAPPORT entre l'offre et le profil.
 *
 * @returns {{atouts:number, manques:number, compensables:number, verdict:string, premierAtout:string}|null}
 */
export function forces(analyse) {
  if (!analyse) return null;
  const liste = (x) => Array.isArray(x) ? x.filter(Boolean) : [];
  const prouvables = liste(analyse.prouvable);
  return {
    atouts: prouvables.length,
    manques: liste(analyse.nonprouvable).length,
    compensables: liste(analyse.compensable).length,
    verdict: String(analyse.verdict ?? '').trim(),
    premierAtout: String(prouvables[0] ?? '').trim(),
  };
}

/**
 * LE VERDICT REMONTE SUR LA CARTE FERMÉE.
 *
 * Constat de l'auteur : « je doute de coller au poste ». Or l'analyse lui
 * répond déjà, et l'a fait 129 fois — « Oui, c'est ta cible exacte. Fonce. »,
 * « ton profil coche 90 % des exigences ». Couverture moyenne des atouts face
 * aux exigences : 75 %.
 *
 * Ce jugement était enterré dans le détail replié : il fallait ouvrir la
 * carte, dérouler « pourquoi ce classement », et lire. Autrement dit, il
 * fallait déjà avoir surmonté le doute pour lire ce qui l'aurait levé.
 *
 * On affiche AUSSI les manques, et le verdict tel quel même quand il est
 * réservé. Une carte qui ne dirait que du bien deviendrait un bruit de fond
 * qu'on cesse de lire — c'est le contraste entre « fonce » et « c'est
 * jouable, mais » qui rend le premier utile.
 */
function verdictReplie(offre) {
  const f = forces(offre.analyse);
  if (!f || (!f.verdict && !f.atouts)) return '';

  const compte = f.atouts
    ? `<span class="vr-compte" title="Points que ton parcours prouve, face aux manques relevés par l'analyse">`
      + `<b>${f.atouts}</b> atout${f.atouts > 1 ? 's' : ''}`
      + (f.manques ? ` · ${f.manques} manque${f.manques > 1 ? 's' : ''}` : '')
      + (f.compensables ? ` dont ${f.compensables} compensable${f.compensables > 1 ? 's' : ''}` : '')
      + `</span>` : '';

  // Le verdict est tronqué à la première phrase : c'est elle qui porte le
  // jugement, la suite le nuance. Le détail complet reste dans la carte.
  const phrase = f.verdict.split(/(?<=[.!?])\s/)[0] ?? '';
  return `<div class="verdict-replie">${compte}${phrase
    ? `<span class="vr-texte">${echapper(phrase.slice(0, 120))}</span>` : ''}</div>`;
}

/** Pastille de score, colorée selon la force du signal. */
function pastilleScore(offre) {
  if (offre.score === null || offre.score === undefined) return '';
  const classe = offre.score >= 6 ? 'fort' : offre.score >= 3 ? 'moyen' : '';
  return `<span class="scorepill ${classe}" title="Score par mots-clés">⚡ ${offre.score}</span>`;
}

export function rendreCarte(offre, actions) {
  const g = GM[offre.groupe] ?? GM[0];
  const s = offre.suivi;
  const carte = document.createElement('div');
  carte.className = 'card';
  carte.dataset.g = offre.groupe;
  carte.dataset.id = offre.id;
  if (s.pinned) carte.classList.add('pinned');

  const due = relanceDue(offre);
  if (due) carte.classList.add('due');
  const fl = etiquetteFraicheur(ageOffre(offre.dateOffre));
  const prog = STATUS_PROG[s.status] ?? 10;
  const a = offre.analyse;

  let detail = '';

  // Motifs de scoring : montrer POURQUOI l'offre est classée là évite de
  // devoir faire confiance à un chiffre sans explication.
  const positifs = offre.scoreDetail?.positifs ?? [];
  const negatifs = [...(offre.scoreDetail?.negatifs ?? []), ...(offre.scoreDetail?.eliminatoires ?? [])];
  if (positifs.length || negatifs.length) {
    // Une offre plafonnée faute d'ancrage sectoriel a un score de
    // prioritaire mais reste « possible » : sans explication, l'écart entre
    // le chiffre et la pastille passerait pour une incohérence.
    const plafonnee = offre.scoreDetail?.sansSecteur
      ? `<div class="plafond">📌 Score de prioritaire, mais <strong>aucun motif de secteur</strong> —
           ni énergie, ni environnement, ni urbanisme. Classée « possible » pour ne pas passer
           devant les offres de ton métier.</div>`
      : '';

    detail += `<div class="sec"><div class="lbl fix">POURQUOI CE CLASSEMENT</div>
      <div class="motifs">
        ${positifs.map(m => `<span class="motif" title="${echapper(m.note ?? '')}">+${m.poids} ${echapper(m.note ?? m.motif)}</span>`).join('')}
        ${negatifs.map(m => `<span class="motif neg" title="${echapper(m.note ?? '')}">${m.poids ? m.poids : '⛔'} ${echapper(m.note ?? m.motif)}</span>`).join('')}
      </div>${plafonnee}</div>`;
  }

  if (a) {
    if ((a.exige ?? []).length || (a.souhaite ?? []).length) {
      detail += `<div class="sec"><div class="cols3">
        <div><div class="lbl req">EXIGÉ</div><ul class="mini">${liste(a.exige)}</ul></div>
        <div><div class="lbl want">SOUHAITÉ</div><ul class="mini">${liste(a.souhaite)}</ul></div>
        <div><div class="lbl deco">DÉCORATIF</div><ul class="mini">${liste(a.decoratif)}</ul></div></div></div>`;
    }
    if ((a.prouvable ?? []).length || (a.nonprouvable ?? []).length) {
      detail += `<div class="sec"><div class="cols3">
        <div><div class="lbl ok">PROUVABLE</div><ul class="mini">${liste(a.prouvable)}</ul></div>
        <div><div class="lbl no">NON PROUVABLE</div><ul class="mini">${liste(a.nonprouvable)}</ul></div>
        <div><div class="lbl fix">COMPENSABLE</div><ul class="mini">${liste(a.compensable)}</ul></div></div></div>`;
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
      detail += `<div class="sec"><div class="lbl fix">MOTS-CLÉS ABSENTS DU CV</div>
        <table class="kwtable"><tr><th>Mot-clé</th><th style="width:80px">Revendicable</th><th>Pourquoi</th></tr>
        ${a.kw.map(k => {
          const c = KWCOLOR[String(k[1]).toLowerCase()] ?? KWCOLOR.partiel;
          return `<tr><td style="font-weight:600">${echapper(k[0])}</td><td><span class="pill" style="background:${c[0]};color:${c[1]}">${c[2]}</span></td><td style="color:var(--muted)">${echapper(k[2])}</td></tr>`;
        }).join('')}</table></div>`;
    }
    if (a.fourchette) {
      detail += `<div class="sec"><div class="lbl fix">CADRAGE DES PRÉTENTIONS</div>
        <div class="money"><strong>Fourchette : ${echapper(a.fourchette)}</strong><div style="color:var(--muted);font-size:12px;margin-top:4px">${echapper(a.fnote ?? '')}</div></div>
        <div class="cols2">
          <div><div class="lbl ok">3 FORMULATIONS</div><ul class="mini">${(a.formul ?? []).map(x => `<li style="font-style:italic;margin-bottom:6px">${echapper(x)}</li>`).join('')}</ul></div>
          <div><div class="lbl want">SI « AU-DESSUS DU BUDGET »</div><ul class="mini">${(a.budget ?? []).map(x => `<li style="font-style:italic;margin-bottom:6px">${echapper(x)}</li>`).join('')}</ul></div>
        </div></div>`;
    }
  } else {
    detail += `<div class="sec" style="color:var(--muted);font-size:13px">⏳ Analyse non disponible pour cette offre (quota atteint, ou description trop courte). Elle sera retentée à la prochaine collecte.</div>`;
  }

  // Texte brut de l'annonce, replié : utile pour vérifier une exigence
  // sans quitter l'application ni rouvrir le site d'origine.
  if (offre.extrait) {
    detail += `<div class="sec"><div class="lbl deco">EXTRAIT DE L'ANNONCE
      ${offre.salaireSource ? `<span style="margin-left:auto;color:var(--g1)">${echapper(offre.salaireSource)}</span>` : ''}</div>
      <div class="extrait">${echapper(offre.extrait)}</div></div>`;
  }

  // Suivi de candidature
  const postule = s.status !== 'À postuler';
  detail += `<div class="sec"><div class="lbl fix">SUIVI DE CANDIDATURE</div>
    <div style="margin-bottom:10px"><span class="applied-toggle ${postule ? '' : 'off'}" data-act="postule">${postule ? icone('coche', 13) + ' Candidature envoyée' : 'Pas encore postulé — +25 pt'}</span></div>
    <div class="track-row">
      <div class="track-field"><label>Statut</label><select data-champ="status">${STATUSES.map(x => `<option ${x === s.status ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="track-field"><label>Date d'envoi</label><input type="date" data-champ="sent" value="${s.sent}"></div>
      <div class="track-field"><label>Relance prévue</label><input type="date" data-champ="relance" value="${s.relance}"></div>
      <!-- La seule échéance qu'on ne peut ni décaler ni rattraper. Elle est
           donc saisissable dès l'envoi, sans attendre le statut « Entretien » :
           on reçoit la convocation avant de penser à changer le statut. -->
      <div class="track-field"><label>Entretien le</label><input type="date" data-champ="entretien" value="${s.entretien ?? ''}"></div>
      ${due ? '<span class="relance-flag">⏰ Relance à faire !</span>' : ''}
    </div>
    <textarea class="notes-area" data-champ="notes" placeholder="Notes : contact, prépa entretien, ressenti…">${echapper(s.notes)}</textarea></div>`;

  // RELANCE — seulement une fois la candidature partie : relancer une offre où
  // l'on n'a pas postulé n'a aucun sens. L'app rédige le courriel ; il se copie
  // et s'envoie depuis la messagerie, rien n'est enregistré ici.
  if (postule) {
    detail += `<div class="sec" data-relance="${offre.id}">
      <div class="lbl fix">${icone('plume', 13)} RELANCE
        ${due ? '<span class="relance-flag">⏰ à faire</span>' : ''}</div>
      <div class="letter-actions">
        <button class="btn" data-act="relance">${icone('plume', 14)} Rédiger la relance</button>
      </div>
      <div class="relance-zone"></div>
    </div>`;
  }

  // Lettre de motivation
  detail += `<div class="sec" data-lettre="${offre.id}">
    <div class="lbl fix">${icone('plume', 13)} LETTRE DE MOTIVATION</div>
    <div class="letter-actions">
      <button class="btn btn-primary" data-act="lettre">${icone('plume', 14)} ${offre.aLettre ? 'Afficher la lettre' : 'Rédiger la lettre'}${offre.aLettre ? '' : ' <span class="gain">+10 pt</span>'}</button>
      ${offre.lettreEditee ? '<span class="badge badge-src">retouchée</span>' : ''}
    </div>
    <div class="letter-zone"></div>
  </div>`;

  // PRÉPARATION D'ENTRETIEN — seulement une fois la candidature partie.
  //
  // La proposer sur une offre où l'on n'a pas postulé serait mettre la
  // charrue devant les bœufs, et encombrer chaque carte d'un bouton dont
  // ce n'est pas le moment. Elle apparaît quand elle sert.
  if (postule) {
    detail += `<div class="sec">
      <div class="lbl fix">${icone('cible', 13)} PRÉPARATION D'ENTRETIEN</div>
      <div class="letter-actions">
        <button class="btn btn-primary" data-act="entretien">${icone('cible', 14)} S'entraîner</button>
        <button class="btn" data-act="fiche">${icone('liste', 14)} Fiche de révision</button>
      </div>
      <div class="d">Un jury pose les questions, tu réponds, et il vise ce que
        l'analyse a repéré comme tes points faibles. Débriefing à la fin.</div>
    </div>`;
  }

  const badgesSources = (offre.sources ?? [])
    .map(s2 => `<span class="badge badge-src">${SOURCE_LABEL[s2] ?? s2}</span>`).join('');

  carte.innerHTML = `<div class="head">
    <span class="chevron">▸</span>
    <span class="pinbtn ${s.pinned ? 'on' : ''}" data-act="pin" title="Épingler">${s.pinned ? '★' : '☆'}</span>
    <div class="titlebox">
      <div class="ptitle">${offre.lien
        ? `<a href="${echapper(offre.lien)}" target="_blank" rel="noopener"
             title="Ouvrir l'annonce d'origine">${echapper(offre.titre)}<span class="ext">↗</span></a>`
        : echapper(offre.titre)}</div>
      <div class="pmeta">${echapper(offre.entreprise)} · ${echapper(offre.ville)}${offre.dateOffre ? ' · offre du ' + dateLisible(offre.dateOffre) : ''}</div>
      ${verdictReplie(offre)}
      <div class="cardprog"><span style="width:${prog}%;background:${STATUS_COL[s.status]}"></span></div>
    </div>
    <div class="tags">
      ${pastilleScore(offre)}
      ${fl ? `<span class="fresh ${fl[0]}">${fl[1]}</span>` : ''}
      ${offre.horsZone ? '<span class="badge badge-zone">Hors zone</span>' : ''}
      ${offre.lienMort
        ? '<span class="badge badge-mort" title="Le lien a été sondé et répond 404 : l\'annonce a été retirée du site. Rien ne sert d\'ouvrir.">annonce retirée</span>'
        : ''}
      ${offre.villesRepubliees > 1
        ? `<span class="badge badge-diffuse" title="Le même texte est diffusé dans ${offre.villesRepubliees} villes — souvent un cabinet qui ratisse, rarement un poste ouvert près de chez toi">${offre.villesRepubliees} villes</span>`
        : ''}
      ${offre.aLettre ? `<span class="badge badge-src" title="Lettre rédigée">${icone('plume', 12)}</span>` : ''}
      ${badgesSources}
      <span class="status-pill" style="border-color:${STATUS_COL[s.status]};color:${STATUS_COL[s.status]}">${s.status}${due ? ' · en retard' : ''}</span>
      <span class="badge ${g.key}"><i class="pt pt${offre.groupe}"></i> ${g.label}</span>
      ${offre.lien
        ? `<a class="link${offre.lienMort ? ' link-mort' : ''}" href="${echapper(offre.lien)}"
              target="_blank" rel="noopener" data-act="lien"
              ${offre.lienMort ? 'title="L\'annonce a été retirée du site"' : ''}>Voir ↗</a>`
        : ''}
      <span class="ecarter" data-act="suppr" title="${offre.isManual
        ? 'Supprimer cette offre'
        : 'Écarter définitivement — elle ne reviendra pas aux prochaines collectes'}">✕</span>
    </div></div>
    <div class="detail">${detail}</div>`;

  actions.brancher(carte, offre);
  return carte;
}

// ------------------------------------------------------------------- KANBAN

export function rendreKanban(offres, surDepot) {
  const zone = document.getElementById('kanban');
  zone.innerHTML = '';

  const cote = document.getElementById('kanbanSide');
  if (cote) {
    const enCours = offres.filter(o => o.suivi.status === 'Envoyé' || o.suivi.status === 'Relancé').length;
    cote.textContent = `${pluriel(enCours, 'candidature')} en cours de traitement`;
  }

  STATUSES.forEach(statut => {
    const col = document.createElement('div');
    col.className = 'kcol';
    col.dataset.status = statut;

    const items = offres.filter(o => o.suivi.status === statut);
    col.innerHTML = `<h4 style="background:${STATUS_BG[statut]};color:${STATUS_COL[statut]}">
      <span>${STATUS_EMOJI[statut]} ${statut}</span><span>${items.length}</span></h4>`;

    // Les cartes vivent dans une zone qui défile, pas directement dans la
    // colonne : sinon l'en-tête part avec elles, et on ne sait plus dans
    // quelle colonne on est arrivé.
    const liste = document.createElement('div');
    liste.className = 'kcol-liste';
    col.appendChild(liste);

    if (!items.length) {
      const v = document.createElement('div');
      v.className = 'kcol-vide';
      v.textContent = 'Glisse une carte ici';
      liste.appendChild(v);
    }

    items.forEach(o => {
      const due = relanceDue(o);
      const c = document.createElement('div');
      c.className = 'kcard';
      c.draggable = true;
      c.dataset.id = o.id;
      c.style.borderLeftColor = (GM[o.groupe] ?? GM[0]).couleur;
      c.innerHTML = `<div class="kt">${echapper(o.titre)}</div>
        <div class="km">${echapper(o.entreprise)} · ${echapper(o.ville)}</div>
        <div class="kb">
          ${o.suivi.pinned ? '<i>📌</i>' : ''}
          ${o.aLettre ? '<i>🖋️</i>' : ''}
          ${due ? '<i style="color:var(--hot)">⏰ relance due</i>' : ''}
          ${o.score !== null && o.score !== undefined ? `<i style="color:var(--faint)">⚡${o.score}</i>` : ''}
        </div>`;
      c.addEventListener('dragstart', ev => { ev.dataTransfer.setData('id', o.id); c.classList.add('drag'); });
      c.addEventListener('dragend', () => c.classList.remove('drag'));
      liste.appendChild(c);
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

export function rendreAgenda(offres, surClic) {
  const aujourdhui = todayISO();
  const items = offres
    .filter(o => o.suivi.relance && o.suivi.status !== 'Refus' && o.suivi.status !== 'Entretien')
    .map(o => ({ offre: o, date: o.suivi.relance }))
    .sort((a, b) => a.date.localeCompare(b.date));

  rendreMois(items, aujourdhui);

  const zone = document.getElementById('agenda');
  zone.innerHTML = '';
  document.getElementById('agendaEmpty').style.display = items.length ? 'none' : 'block';
  document.getElementById('agendaSub').textContent = items.length
    ? `${pluriel(items.length, 'relance')} planifiée${items.length > 1 ? 's' : ''} · ${items.filter(i => i.date < aujourdhui).length} en retard`
    : '';

  items.forEach((it, i) => {
    const d = new Date(it.date + 'T12:00:00');
    const enRetard = it.date < aujourdhui;
    const bientot = !enRetard && joursDepuis(it.date) >= -2;

    const el = document.createElement('div');
    el.className = 'agenda-item' + (enRetard ? ' overdue' : bientot ? ' soon' : '');
    el.style.animationDelay = (i * 0.04) + 's';
    el.innerHTML = `
      <div class="agenda-date"><div class="ad-d">${d.getDate()}</div><div class="ad-m">${MOIS_COURT[d.getMonth()]}</div></div>
      <div class="agenda-body"><div class="ab-t">${echapper(it.offre.titre)}</div><div class="ab-s">${echapper(it.offre.entreprise)} · ${echapper(it.offre.ville)}</div></div>
      <span class="agenda-tag" style="background:${enRetard ? 'var(--hotb)' : 'var(--g2b)'};color:${enRetard ? 'var(--hot)' : 'var(--g2)'}">${enRetard ? '⏰ En retard' : '📌 À venir'}</span>
      ${it.offre.lien ? `<a class="link" href="${echapper(it.offre.lien)}" target="_blank" rel="noopener">Voir ↗</a>` : ''}`;
    el.addEventListener('click', e => {
      if (e.target.closest('a')) return;
      surClic?.(it.offre);
    });
    zone.appendChild(el);
  });
}

/**
 * Calendrier du mois en cours, avec une pastille par relance.
 * Une liste chronologique dit « quoi » ; une grille de mois dit « quand »,
 * et fait voir d'un coup les semaines chargées.
 */
function rendreMois(items, aujourdhui) {
  const zone = document.getElementById('moisCalendrier');
  if (!zone) return;

  const ref = new Date(aujourdhui + 'T12:00:00');
  const premier = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const decalage = (premier.getDay() + 6) % 7; // lundi en tête
  const debut = new Date(premier.getTime() - decalage * 86400000);

  const parJour = items.reduce((acc, it) => {
    (acc[it.date] ??= []).push(it);
    return acc;
  }, {});

  const iso = (d) => {
    const p = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  const entetes = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
    .map(j => `<div class="mois-tete">${j}</div>`).join('');

  const cases = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(debut.getTime() + i * 86400000);
    const cle = iso(d);
    const relances = parJour[cle] ?? [];
    const hors = d.getMonth() !== ref.getMonth();

    return `<div class="mjour ${hors ? 'hors' : ''} ${cle === aujourdhui ? 'today' : ''} ${relances.length ? 'charge' : ''}"
        title="${relances.length ? relances.map(r => r.offre.titre).join(' · ') : cle}">
      <span class="mn">${d.getDate()}</span>
      <span class="mp">${relances.slice(0, 4).map(r =>
        `<i class="${r.date < aujourdhui ? 'retard' : ''}"></i>`).join('')}</span>
    </div>`;
  }).join('');

  zone.innerHTML = entetes + cases;

  const titre = document.getElementById('moisTitre');
  if (titre) titre.textContent = `${MOIS[ref.getMonth()]} ${ref.getFullYear()}`;
}
