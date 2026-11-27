// Construction du HTML des vues centrées sur les offres :
// cartes, focus du jour, kanban, agenda.
// Aucun accès réseau ici : ces fonctions reçoivent les données et rendent.
import {
  GM, STATUSES, STATUS_COL, STATUS_PROG, STATUS_BG, KWCOLOR,
  MOIS, MOIS_COURT, SOURCE_LABEL,
  todayISO, joursDepuis, ageOffre, dateLisible, dateCourte, echapper, pluriel,
} from './format.js';
import { icone } from './icons.js';
import { offresDuJour, envoyeesAujourdhui } from './selection.js';
import { mouvementCoupe, flip, roulement } from './anim.js';

const liste = (a) => (a ?? []).map(x => `<li>${echapper(x)}</li>`).join('');

/**
 * Une icône, ou une autre si la première n'existe pas encore.
 *
 * `icone()` rend le tracé « info » pour un nom inconnu — un rond avec un i.
 * Le chantier socle ajoute `chevron` et `epingle` à icons.js EN MÊME TEMPS
 * que ce fichier est écrit : tant qu'ils n'y sont pas, un chevron dessiné en
 * « info » ferait une carte pleine de points d'information. On compare donc
 * au rendu d'un nom absent, ce qui ne demande rien à icons.js.
 */
const ABSENTE = icone('\u0000absente', 1);
function iconeOu(nom, repli, taille) {
  return icone(nom, 1) === ABSENTE ? icone(repli, taille) : icone(nom, taille);
}

/** Une relance est due si sa date est passée et la candidature encore active. */
export function relanceDue(offre) {
  const s = offre.suivi;
  return Boolean(s.relance) && s.relance <= todayISO()
    && s.status !== 'Refus' && s.status !== 'Entretien';
}

// ------------------------------------------------------------- ANIMATIONS

/**
 * Un entretien décroché est le seul moment que l'application célèbre encore.
 * Ce n'est pas un score : c'est la seule chose que l'auteur cherche vraiment.
 *
 * CE QUI NE MARCHAIT PAS : seul `prefers-reduced-motion` était écouté.
 * Couper les animations dans les Options laissait pleuvoir les confettis —
 * la règle `[data-anim="off"]` arrêtait leur chute CSS et les laissait figés
 * en haut de l'écran quatre secondes durant. `mouvementCoupe()` lit les deux.
 *
 * La chute passe par `element.animate()` : chaque confetti a sa propre
 * dérive latérale et sa propre rotation, ce qu'une image-clé partagée ne sait
 * pas faire, et l'élément se retire à la fin de SA chute, pas au bout d'un
 * minuteur arbitraire.
 */
export function celebrer(intensite = 44) {
  if (typeof document === 'undefined' || mouvementCoupe()) return;
  const couleurs = ['var(--accent)', 'var(--accent2)', 'var(--g1)', 'var(--g2)', 'var(--pink)', 'var(--info)'];
  const hauteur = window.innerHeight;
  const n = Math.min(120, Math.max(0, intensite));
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'confetti confetti-js';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = couleurs[i % couleurs.length];
    document.body.appendChild(c);
    const derive = (Math.random() - 0.5) * 220;
    const tours = (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 540);
    const a = c.animate([
      { transform: 'translate3d(0,0,0) rotate(0deg)', opacity: 1 },
      { transform: `translate3d(${derive * 0.6}px, ${hauteur * 0.55}px, 0) rotate(${tours * 0.6}deg)`, opacity: 1, offset: 0.6 },
      { transform: `translate3d(${derive}px, ${hauteur + 40}px, 0) rotate(${tours}deg)`, opacity: 0 },
    ], {
      duration: 2100 + Math.random() * 1500,
      delay: Math.random() * 450,
      easing: 'cubic-bezier(.25,.46,.45,.94)',
      fill: 'backwards',
    });
    a.onfinish = a.oncancel = () => c.remove();
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
            ? `<span class="scorepill fort">${icone('eclair', 11)} ${offre.score}</span>` : ''}
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
      <span class="em focus-vide-ic">${icone('coche', 30)}</span>
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

/**
 * LE SCORE EN ANNEAU MINIATURE.
 *
 * L'éclair et le chiffre (« ⚡ 8 ») disaient une valeur sans dire une
 * ÉCHELLE : 8, est-ce beaucoup ? L'anneau répond d'un coup d'œil — plein aux
 * trois quarts, c'est une offre forte. Le plein est atteint à 12 : au-delà,
 * on compte une poignée d'offres sur neuf cents (voir la distribution des
 * scores), et un anneau qui ne se remplirait jamais n'informerait pas.
 *
 * Exportée pour être testée : c'est un calcul, pas un décor.
 */
export const SCORE_PLEIN = 12;
export function anneauScore(score) {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return '';
  const s = Number(score);
  const classe = s >= 6 ? 'fort' : s >= 3 ? 'moyen' : 'faible';
  const ratio = Math.max(0, Math.min(1, s / SCORE_PLEIN));
  // Rayon 7 dans un carré de 18 : circonférence 2πr ≈ 43,98.
  const tour = 43.98;
  return `<span class="score-anneau ${classe}" title="Score par mots-clés : ${s} (plein à ${SCORE_PLEIN})"
      role="img" aria-label="Score ${s}">
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="7" class="sa-piste"/>
      <circle cx="9" cy="9" r="7" class="sa-arc" stroke-dasharray="${tour}"
        stroke-dashoffset="${Math.round(tour * (1 - ratio) * 100) / 100}" style="--tour:${tour}"
        transform="rotate(-90 9 9)"/>
    </svg><b>${s}</b></span>`;
}

/**
 * LE BADGE DE FRAÎCHEUR, SANS EMOJI.
 *
 * `etiquetteFraicheur` (format.js) rend « 🔥 Nouveau », « 🍂 9 j » : de
 * l'emoji dans le mobilier, rendu différemment sur chaque système. Le badge
 * garde les quatre paliers, mais les porte par une PASTILLE colorée et un
 * texte court. La couleur suit le thème ; l'emoji, lui, ne la suivait pas.
 */
export function badgeFraicheur(age) {
  if (age === null || age === undefined) return '';
  const [classe, texte, titre] =
    age <= 1 ? ['new', 'Nouveau', 'Publiée il y a moins de deux jours']
    : age <= 7 ? ['ok', `${age} j`, `Publiée il y a ${age} jours — encore fraîche`]
    : age <= 14 ? ['warn', `${age} j`, `Publiée il y a ${age} jours — à ne plus laisser traîner`]
    : ['old', `${age} j`, `Publiée il y a ${age} jours — probablement déjà pourvue`];
  return `<span class="fresh fraicheur ${classe}" title="${titre}"><i></i>${texte}</span>`;
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
      ? `<div class="plafond">${icone('info', 13)} Score de prioritaire, mais <strong>aucun motif de secteur</strong> —
           ni énergie, ni environnement, ni urbanisme. Classée « possible » pour ne pas passer
           devant les offres de ton métier.</div>`
      : '';

    detail += `<div class="sec"><div class="lbl fix">POURQUOI CE CLASSEMENT</div>
      <div class="motifs">
        ${positifs.map(m => `<span class="motif" title="${echapper(m.note ?? '')}">+${m.poids} ${echapper(m.note ?? m.motif)}</span>`).join('')}
        ${negatifs.map(m => `<span class="motif neg" title="${echapper(m.note ?? '')}">${m.poids ? m.poids : icone('croix', 10)} ${echapper(m.note ?? m.motif)}</span>`).join('')}
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
        ? `<span class="desaccord">${icone('info', 13)} Le tri par mots-clés a classé cette offre « ${g.label} », mais l'analyse du contenu dit non. <strong>Fie-toi à l'analyse</strong> : les mots-clés ne voient pas le métier réel.</span>`
        : '';
      detail += `<div class="verdict ${g.vd}"><strong>${icone('bouclier', 14)} Verdict :</strong> ${echapper(a.verdict)}${desaccord}</div>`;
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
    // PLUS D'ATTENTE SUBIE. « Elle sera retentée à la prochaine collecte »
    // laissait l'offre sans verdict jusqu'au lendemain, alors que c'est
    // souvent MAINTENANT qu'on hésite à postuler. Le bouton relance l'analyse
    // à la demande (POST /api/offers/:id/analyser, branché par app.js comme
    // les autres `data-act`) ; la phrase d'origine reste, en note.
    detail += `<div class="sec analyse-absente">
      <div class="aa-texte">${icone('cerveau', 16)}
        <span><b>Pas encore d'analyse pour cette offre.</b>
        Quota atteint lors de la collecte, ou description trop courte — sinon elle aurait été faite.</span></div>
      <div class="letter-actions">
        <button class="btn btn-primary" data-act="analyser">${icone('cerveau', 14)} Analyser maintenant</button>
        <span class="d">Compte dans le quota du jour. Sinon, elle sera retentée à la prochaine collecte.</span>
      </div>
      <div class="analyse-zone"></div>
    </div>`;
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
    <div style="margin-bottom:10px"><span class="applied-toggle ${postule ? '' : 'off'}" data-act="postule">${postule ? icone('coche', 13) + ' Candidature envoyée' : 'Pas encore postulé — marquer comme envoyée'}</span></div>
    <div class="track-row">
      <div class="track-field"><label>Statut</label><select data-champ="status">${STATUSES.map(x => `<option ${x === s.status ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="track-field"><label>Date d'envoi</label><input type="date" data-champ="sent" value="${s.sent}"></div>
      <div class="track-field"><label>Relance prévue</label><input type="date" data-champ="relance" value="${s.relance}"></div>
      <!-- La seule échéance qu'on ne peut ni décaler ni rattraper. Elle est
           donc saisissable dès l'envoi, sans attendre le statut « Entretien » :
           on reçoit la convocation avant de penser à changer le statut. -->
      <div class="track-field"><label>Entretien le</label><input type="date" data-champ="entretien" value="${s.entretien ?? ''}"></div>
      ${due ? `<span class="relance-flag">${icone('horloge', 12)} Relance à faire !</span>` : ''}
    </div>
    <textarea class="notes-area" data-champ="notes" placeholder="Notes : contact, prépa entretien, ressenti…">${echapper(s.notes)}</textarea></div>`;

  // RELANCE — seulement une fois la candidature partie : relancer une offre où
  // l'on n'a pas postulé n'a aucun sens. L'app rédige le courriel ; il se copie
  // et s'envoie depuis la messagerie, rien n'est enregistré ici.
  if (postule) {
    detail += `<div class="sec" data-relance="${offre.id}">
      <div class="lbl fix">${icone('plume', 13)} RELANCE
        ${due ? `<span class="relance-flag">${icone('horloge', 12)} à faire</span>` : ''}</div>
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
      <button class="btn btn-primary" data-act="lettre">${icone('plume', 14)} ${offre.aLettre ? 'Afficher la lettre' : 'Rédiger la lettre'}</button>
      ${offre.lettreEditee ? '<span class="badge badge-src">retouchée</span>' : ''}
    </div>
    <div class="letter-zone"></div>
  </div>`;

  // CV ADAPTÉ + ÉCART — tailler le dossier à l'offre, et voir ce qui manque
  // avant d'envoyer. Le CV part sinon identique pour tous les postes.
  detail += `<div class="sec" data-cvadapte="${offre.id}">
    <div class="lbl fix">${icone('cible', 13)} CV ADAPTÉ À CETTE OFFRE</div>
    <div class="letter-actions">
      <button class="btn" data-act="cvadapte">${icone('cible', 14)} Adapter mon CV</button>
    </div>
    <div class="cvadapte-zone"></div>
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

  // L'EN-TÊTE NE PORTE PLUS UN SEUL GLYPHE TEXTE.
  // ▸ ★ ☆ ✕ ↗ étaient des caractères : leur dessin, leur graisse et même leur
  // largeur changeaient d'une police à l'autre (le ☆ de Segoe UI est deux fois
  // plus gros que celui d'Inter), et ils ignoraient l'épaisseur de trait du
  // reste de l'interface. Ce sont désormais des icônes du jeu commun, qui
  // héritent de `currentColor` et s'animent en CSS (chevron qui pivote,
  // étoile qui se remplit).
  //
  // Le badge « à analyser » n'apparaît que sur les prioritaires et les
  // possibles : huit offres sur neuf n'ont pas d'analyse, et un badge posé
  // sur toutes ne signalerait plus rien. C'est sur celles qu'on envisage
  // vraiment que l'absence de verdict coûte.
  const chevron = iconeOu('chevron', 'fleche', 14);
  carte.innerHTML = `<div class="head">
    <span class="chevron" aria-hidden="true">${chevron}</span>
    <span class="pinbtn ${s.pinned ? 'on' : ''}" data-act="pin" role="button" tabindex="0"
      aria-pressed="${s.pinned ? 'true' : 'false'}"
      title="${s.pinned ? 'Désépingler' : 'Épingler'}">${icone('etoile', 15)}</span>
    <div class="titlebox">
      <div class="ptitle">${offre.lien
        ? `<a href="${echapper(offre.lien)}" target="_blank" rel="noopener"
             title="Ouvrir l'annonce d'origine">${echapper(offre.titre)}<span class="ext" aria-hidden="true">${icone('fleche', 11)}</span></a>`
        : echapper(offre.titre)}</div>
      <div class="pmeta">${[offre.entreprise, offre.ville, offre.dateOffre ? 'offre du ' + dateLisible(offre.dateOffre) : '']
        .filter(Boolean).map(echapper).join(' · ')}</div>
      ${verdictReplie(offre)}
      <div class="cardprog"><span style="width:${prog}%;background:${STATUS_COL[s.status]}"></span></div>
    </div>
    <div class="tags">
      ${anneauScore(offre.score)}
      ${badgeFraicheur(ageOffre(offre.dateOffre))}
      ${a || !(offre.groupe === 1 || offre.groupe === 2) ? '' : `<span class="badge badge-sans-analyse" title="Aucune analyse : déplie la carte pour la lancer">${icone('cerveau', 11)} à analyser</span>`}
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
              ${offre.lienMort ? 'title="L\'annonce a été retirée du site"' : ''}>Voir <span class="ext" aria-hidden="true">${icone('fleche', 11)}</span></a>`
        : ''}
      <span class="ecarter" data-act="suppr" role="button" tabindex="0" title="${offre.isManual
        ? 'Supprimer cette offre'
        : 'Écarter définitivement — elle ne reviendra pas aux prochaines collectes'}"
        aria-label="${offre.isManual ? 'Supprimer' : 'Écarter'}">${icone('croix', 13)}</span>
    </div></div>
    <div class="detail">${detail}</div>`;

  actions.brancher(carte, offre);
  return carte;
}

// ------------------------------------------------------------------- KANBAN

//
// CE QUI NE MARCHAIT PAS
// ----------------------
// Le glisser-déposer HTML5 natif (`draggable`, `dragstart`, `drop`) :
//   · ne marche PAS au doigt — sur téléphone et tablette, le Kanban était en
//     lecture seule ;
//   · montre l'image fantôme que le système veut bien générer (souvent un
//     rectangle délavé, sans ombre, qui ne suit pas la souris d'un pixel près) ;
//   · ne dit pas OÙ la carte va tomber : on lâchait « dans la colonne », et
//     elle atterrissait en bas, sous deux cents autres ;
//   · ne fait pas défiler une colonne quand on approche de son bord ;
//   · et chaque dépôt reconstruisait les cinq colonnes, neuf cents cartes
//     comprises, en perdant le défilement de chacune.
//
// CE QUI LE REMPLACE
// ------------------
// Des pointer events (souris, doigt, stylet : un seul code). La carte saisie
// devient l'EMPLACEMENT — un trou en pointillé qui se déplace dans les listes
// pendant qu'un fantôme incliné suit le pointeur. Les voisines s'écartent en
// FLIP. Près d'un bord, la colonne défile toute seule. Au lâcher, le fantôme
// vient se poser dans le trou, le statut change TOUT DE SUITE (mise à jour
// optimiste), et si le serveur refuse, la carte repart d'où elle venait en
// le montrant.
//
// Le rendu n'est plus une reconstruction mais une RÉCONCILIATION : les cartes
// existantes sont gardées, mises à jour si besoin, et seulement déplacées
// quand leur place change. Un `rendreTout()` d'app.js après un dépôt ne casse
// donc plus rien — il ne trouve presque rien à faire.
//
// Tout l'état vit ici, au niveau du module, mais aucune ligne ne touche au
// DOM avant le premier appel : render.js est importé sous Node par les tests.

/** Icône de chaque colonne — elles remplacent 📋 📨 🔔 🤝 🙅. */
const ICONE_STATUT = {
  'À postuler': 'liste', 'Envoyé': 'envoi', 'Relancé': 'cloche', 'Entretien': 'poignee', 'Refus': 'croix',
};

/**
 * Cartes rendues par colonne, par tranches.
 * « À postuler » en compte neuf cents : les poser toutes coûtait plusieurs
 * centaines de millisecondes à chaque passage sur la vue, pour en montrer
 * douze. Les suivantes arrivent en approchant du bas, ou au clic.
 */
const PAR_TRANCHE = 60;
const CLE_REPLIES = 'jc_kanban_replies';
const CLE_ORDRE = 'jc_kanban_ordre';

const kb = {
  zone: null,
  surDepot: null,
  dernieres: [],
  limite: {},
  comptes: {},
  replies: null,
  ordre: null,
  geste: null,       // glissement en cours (pointeur ou clavier)
  amorce: null,      // pointeur posé, glissement pas encore décidé
  attente: new Set(),
  differe: null,
  premier: true,
};

function lireStockage(cle, defaut) {
  try {
    const v = localStorage.getItem(cle);
    return v ? JSON.parse(v) : defaut;
  } catch { return defaut; }
}
function ecrireStockage(cle, valeur) {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* navigation privée */ }
}

/**
 * Ordonne les cartes d'une colonne selon l'ordre que l'utilisateur leur a
 * donné en les déposant. Le serveur ne connaît pas d'ordre dans une colonne :
 * sans cette mémoire, une carte lâchée en deuxième position retombait à sa
 * place « naturelle » au rendu suivant, et le placeholder d'insertion aurait
 * menti. Les cartes jamais rangées suivent, dans l'ordre reçu.
 *
 * Pure, exportée pour les tests.
 *
 * @param {object[]} items
 * @param {string[]} [memo]  identifiants dans l'ordre voulu
 */
export function ordonnerColonne(items, memo) {
  if (!memo?.length) return items.slice();
  const rang = new Map(memo.map((id, i) => [String(id), i]));
  return items
    .map((o, i) => [o, rang.has(String(o.id)) ? rang.get(String(o.id)) : memo.length + i])
    .sort((a, b) => a[1] - b[1])
    .map(x => x[0]);
}

/**
 * Index d'insertion sous le pointeur : avant la première carte dont le
 * milieu est sous lui. Les positions sont lues en `offsetTop` — la place de
 * MISE EN PAGE, qui ignore les transformations — et non à l'écran : pendant
 * qu'une voisine glisse en FLIP, sa position visuelle ment, et l'emplacement
 * se mettait à osciller entre deux places.
 *
 * Pure (elle ne lit que ce qu'on lui donne), exportée pour les tests.
 *
 * @param {{haut:number, hauteur:number}[]} cartes  hors carte saisie
 * @param {number} y  ordonnée du pointeur dans le repère des cartes
 */
export function indexInsertion(cartes, y) {
  for (let i = 0; i < cartes.length; i++) {
    if (y < cartes[i].haut + cartes[i].hauteur / 2) return i;
  }
  return cartes.length;
}

/** Vitesse de défilement automatique : nulle loin du bord, forte tout contre. */
export function vitesseBord(distance, bord = 56, max = 22) {
  if (distance >= bord) return 0;
  const k = 1 - Math.max(0, distance) / bord;
  return Math.ceil(k * k * max);
}

export function rendreKanban(offres, surDepot) {
  const zone = typeof document !== 'undefined' && document.getElementById('kanban');
  if (!zone) return;
  kb.surDepot = surDepot;

  const cote = document.getElementById('kanbanSide');
  if (cote) {
    const enCours = offres.filter(o => o.suivi.status === 'Envoyé' || o.suivi.status === 'Relancé').length;
    cote.textContent = `${pluriel(enCours, 'candidature')} en cours de traitement`;
  }

  // Un rendu demandé EN PLEIN GESTE (rafraîchissement, réponse du serveur)
  // attend la fin du geste : déplacer les cartes sous le doigt de quelqu'un
  // qui est en train de les ranger est la pire chose à faire.
  if (kb.geste) { kb.differe = offres; return; }

  if (kb.zone !== zone || !zone.querySelector('.kcol')) initialiserKanban(zone);
  kb.dernieres = offres;
  reconcilier(offres);
}

function initialiserKanban(zone) {
  kb.zone = zone;
  kb.premier = true;
  kb.replies = new Set(lireStockage(CLE_REPLIES, []));
  kb.ordre = lireStockage(CLE_ORDRE, {}) ?? {};
  zone.classList.add('kanban-pro');
  zone.innerHTML = STATUSES.map(statut => `
    <section class="kcol" data-status="${statut}" aria-label="Colonne ${statut}"
        style="--kc:${STATUS_COL[statut]};--kcb:${STATUS_BG[statut]}">
      <header class="kcol-tete">
        <span class="kcol-ic" aria-hidden="true">${icone(ICONE_STATUT[statut], 14)}</span>
        <span class="kcol-titre">${statut}</span>
        <b class="kcol-n" data-v="">0</b>
        <button type="button" class="kcol-plier" aria-expanded="true"
          title="Replier la colonne" aria-label="Replier la colonne ${statut}">${iconeOu('chevron', 'fleche', 13)}</button>
      </header>
      <div class="kcol-liste" role="list" aria-label="${statut}"></div>
    </section>`).join('')
    + '<div class="kanban-annonce" aria-live="assertive" aria-atomic="true"></div>';

  if (!zone.dataset.branche) {
    zone.dataset.branche = '1';
    zone.addEventListener('pointerdown', surPointeurBas);
    zone.addEventListener('keydown', surClavierKanban);
    zone.addEventListener('click', surClicKanban);
    // Le défilement ne remonte pas : on l'écoute en capture pour les cinq
    // listes à la fois.
    zone.addEventListener('scroll', surDefilementListe, { capture: true, passive: true });
    // Le seul écouteur NON passif, et il faut qu'il soit là DÈS le contact :
    // le navigateur décide au `touchstart` s'il peut faire défiler sans nous
    // attendre. Inscrit au début du glissement, il arriverait trop tard et le
    // doigt ferait défiler la colonne au lieu de déplacer la carte.
    zone.addEventListener('touchmove', e => { if (kb.geste?.mode === 'pointeur') e.preventDefault(); },
      { passive: false });
    // Un appui long au doigt ouvre le menu contextuel du système : pas ici.
    zone.addEventListener('contextmenu', e => { if (kb.amorce || kb.geste) e.preventDefault(); });
    zone.addEventListener('dragstart', e => e.preventDefault());

    // HAUTEUR FLUIDE. L'ancien `height:calc(100% - 90px)` devinait la taille
    // de l'en-tête de vue : une ligne de sous-titre en plus sur un petit
    // écran, et le bas des colonnes passait sous le bord. On MESURE plutôt
    // l'espace restant sous le Kanban, à chaque changement de taille.
    const vue = zone.closest('.view');
    if (vue && typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => requestAnimationFrame(ajusterHauteurKanban)).observe(vue);
    }
    window.addEventListener('resize', () => requestAnimationFrame(ajusterHauteurKanban), { passive: true });
  }
  appliquerReplies(false);
  requestAnimationFrame(ajusterHauteurKanban);
}

function ajusterHauteurKanban() {
  const zone = kb.zone;
  const vue = zone?.closest('.view');
  if (!vue || !zone.isConnected || !vue.clientHeight) return;
  // Lectures groupées, puis une écriture.
  const rv = vue.getBoundingClientRect();
  const rz = zone.getBoundingClientRect();
  const bas = parseFloat(getComputedStyle(vue).paddingBottom) || 0;
  const haut = rz.top - rv.top + vue.scrollTop;
  const h = Math.max(380, Math.floor(vue.clientHeight - haut - bas));
  if (zone._hauteur !== h) {
    zone._hauteur = h;
    zone.style.height = h + 'px';
  }
}

function signatureCarte(o) {
  return [o.titre, o.entreprise, o.ville, o.groupe, o.score, o.aLettre,
    o.suivi.pinned, relanceDue(o), o.suivi.entretien ?? ''].join('\u0001');
}

function contenuCarte(o) {
  const due = relanceDue(o);
  const score = o.score !== null && o.score !== undefined
    ? `<span class="kscore" title="Score par mots-clés">${icone('eclair', 10)}${o.score}</span>` : '';
  return `<span class="kpoignee" aria-hidden="true"></span>
    <div class="kt">${echapper(o.titre)}</div>
    <div class="km">${echapper(o.entreprise || 'Entreprise non précisée')} · ${echapper(o.ville ?? '')}</div>
    <div class="kb">
      ${o.suivi.pinned ? `<span class="kpin" title="Épinglée">${icone('etoile', 11)}</span>` : ''}
      ${o.aLettre ? `<span title="Lettre rédigée">${icone('plume', 11)}</span>` : ''}
      ${due ? `<span class="kdue">${icone('horloge', 11)} relance due</span>` : ''}
      ${o.suivi.entretien ? `<span class="kent">${icone('calendrier', 11)} ${dateCourte(o.suivi.entretien)}</span>` : ''}
      ${score}
    </div>`;
}

function creerCarte(o) {
  const c = document.createElement('div');
  c.className = 'kcard';
  c.dataset.id = String(o.id);
  c.tabIndex = 0;
  c.setAttribute('role', 'listitem');
  c.setAttribute('aria-roledescription', 'carte déplaçable');
  majCarte(c, o);
  return c;
}

function majCarte(c, o) {
  const sig = signatureCarte(o);
  if (c._sig === sig) return;
  c._sig = sig;
  c.style.setProperty('--kg', (GM[o.groupe] ?? GM[0]).couleur);
  c.setAttribute('aria-label', `${o.titre} — ${o.entreprise || 'entreprise non précisée'}. Espace pour déplacer.`);
  c.innerHTML = contenuCarte(o);
}

/**
 * Remet les enfants d'une liste dans l'ordre voulu en ne déplaçant que ceux
 * qui ne sont pas à leur place. Un `replaceChildren` aurait été plus court,
 * mais il retire et réinsère TOUT : le focus clavier saute, l'état de survol
 * se perd, et les animations d'entrée se rejouent sur des cartes immobiles.
 */
function ordonnerEnfants(parent, noeuds) {
  let curseur = parent.firstChild;
  for (const n of noeuds) {
    if (n === curseur) { curseur = curseur.nextSibling; continue; }
    parent.insertBefore(n, curseur);
  }
  while (curseur) {
    const suivant = curseur.nextSibling;
    if (!curseur.classList?.contains('kcard-trou')) curseur.remove();
    curseur = suivant;
  }
}

function reconcilier(offres) {
  const zone = kb.zone;
  const anime = !kb.premier && !mouvementCoupe();
  const parStatut = Object.fromEntries(STATUSES.map(s => [s, []]));
  for (const o of offres) (parStatut[o.suivi.status] ?? parStatut['À postuler']).push(o);

  const existantes = new Map();
  zone.querySelectorAll('.kcard').forEach(c => existantes.set(c.dataset.id, c));
  const colonnes = [...zone.querySelectorAll('.kcol')];

  const muter = () => {
    for (const col of colonnes) {
      const statut = col.dataset.status;
      const items = ordonnerColonne(parStatut[statut], kb.ordre[statut]);
      const limite = Math.max(kb.limite[statut] ?? PAR_TRANCHE, PAR_TRANCHE);
      const liste = col.querySelector('.kcol-liste');
      const noeuds = [];
      for (const o of items.slice(0, limite)) {
        const id = String(o.id);
        let c = existantes.get(id);
        if (c) { existantes.delete(id); majCarte(c, o); }
        else {
          c = creerCarte(o);
          // Une carte qui ARRIVE (nouvelle offre envoyée depuis la liste)
          // entre ; au premier rendu, la cascade de la vue suffit.
          if (anime) c.classList.add('kcard-nait');
        }
        noeuds.push(c);
      }

      if (!items.length) {
        liste._vide ??= Object.assign(document.createElement('div'), {
          className: 'kcol-vide',
          innerHTML: `${icone(ICONE_STATUT[statut], 18)}<span>Glisse une carte ici</span>`,
        });
        noeuds.push(liste._vide);
      }
      const reste = items.length - Math.min(limite, items.length);
      if (reste > 0) {
        liste._plus ??= Object.assign(document.createElement('button'), { type: 'button', className: 'kcol-plus' });
        liste._plus.dataset.plus = statut;
        liste._plus.textContent = `Afficher ${Math.min(reste, PAR_TRANCHE)} de plus · ${reste} restantes`;
        noeuds.push(liste._plus);
      }
      ordonnerEnfants(liste, noeuds);
      poserCompte(col, items.length, anime);
    }
    existantes.forEach(c => c.remove());
  };

  if (anime) flip(zone.querySelectorAll('.kcard'), muter, { duree: 300 });
  else muter();
  kb.premier = false;
}

/** Le compteur d'une colonne : il ROULE quand il change, comme les tuiles. */
function poserCompte(col, n, anime) {
  kb.comptes[col.dataset.status] = n;
  const el = col.querySelector('.kcol-n');
  const v = String(n);
  if (el.dataset.v === v) return;
  el.dataset.v = v;
  el.setAttribute('aria-label', pluriel(n, 'carte'));
  if (anime) roulement(el, v, { duree: 560, tours: 1 });
  else el.textContent = v;
}

function appliquerReplies(sauver = true) {
  const zone = kb.zone;
  // La grille porte la largeur des colonnes : une colonne repliée se réduit
  // à une tranche de 46 px, et `grid-template-columns` s'interpole (le CSS
  // pose la transition) — la colonne se replie au lieu de disparaître.
  zone.style.gridTemplateColumns = STATUSES
    .map(s => (kb.replies.has(s) ? '46px' : 'minmax(0,1fr)')).join(' ');
  zone.querySelectorAll('.kcol').forEach(col => {
    const replie = kb.replies.has(col.dataset.status);
    col.classList.toggle('repliee', replie);
    const b = col.querySelector('.kcol-plier');
    b.setAttribute('aria-expanded', replie ? 'false' : 'true');
    b.title = replie ? 'Déplier la colonne' : 'Replier la colonne';
  });
  if (sauver) ecrireStockage(CLE_REPLIES, [...kb.replies]);
}

function surClicKanban(e) {
  const plier = e.target.closest('.kcol-plier, .kcol.repliee .kcol-tete');
  if (plier) {
    const statut = plier.closest('.kcol').dataset.status;
    if (kb.replies.has(statut)) kb.replies.delete(statut); else kb.replies.add(statut);
    appliquerReplies();
    return;
  }
  const plus = e.target.closest('.kcol-plus');
  if (plus) chargerTranche(plus.dataset.plus);
}

function chargerTranche(statut) {
  kb.limite[statut] = Math.max(kb.limite[statut] ?? PAR_TRANCHE, PAR_TRANCHE) + PAR_TRANCHE;
  if (!kb.geste) reconcilier(kb.dernieres);
}

function surDefilementListe(e) {
  const liste = e.target;
  if (!liste.classList?.contains('kcol-liste') || !liste._plus?.isConnected || liste._charge) return;
  liste._charge = true;
  requestAnimationFrame(() => {
    liste._charge = false;
    if (liste.scrollTop + liste.clientHeight > liste.scrollHeight - 240) chargerTranche(liste._plus.dataset.plus);
  });
}

function annoncer(texte) {
  const el = kb.zone?.querySelector('.kanban-annonce');
  if (el) el.textContent = texte;
}

function cartesDe(liste, sauf) {
  return [...liste.children].filter(c => c.classList.contains('kcard') && c !== sauf);
}

function positionDe(carte) {
  const liste = carte.parentElement;
  return {
    liste,
    statut: carte.closest('.kcol').dataset.status,
    // Index parmi les cartes de la liste = nombre de cartes qui la précèdent.
    index: cartesDe(liste).indexOf(carte),
  };
}

/** Place `carte` dans `liste`, à l'index donné (compté hors carte elle-même). */
function placer(carte, liste, index) {
  const cartes = cartesDe(liste, carte);
  const ref = cartes[index] ?? (liste._plus?.parentElement === liste ? liste._plus : null);
  if (ref === carte.nextSibling && carte.parentElement === liste) return;
  liste.insertBefore(carte, ref);
}

function deplacerAvecFlip(carte, liste, index, avecCarte = false) {
  const depart = carte.parentElement;
  const voisines = new Set([...cartesDe(depart, carte), ...cartesDe(liste, carte)]);
  if (avecCarte) voisines.add(carte);
  flip(voisines, () => placer(carte, liste, index), { duree: 200 });
}

// ── LE GESTE AU POINTEUR ──────────────────────────────────────────────────

function surPointeurBas(e) {
  if (kb.geste || kb.amorce) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const carte = e.target.closest('.kcard');
  if (!carte || kb.attente.has(carte.dataset.id)) return;
  if (e.target.closest('a,button,input,select,textarea')) return;

  const amorce = { x: e.clientX, y: e.clientY, carte, pointeur: e.pointerId, type: e.pointerType };
  kb.amorce = amorce;
  // AU DOIGT, ON ATTEND UN APPUI LONG. Démarrer au premier mouvement
  // rendrait les colonnes impossibles à faire défiler : chaque glissement
  // vertical saisirait une carte. 260 ms immobile = « je prends celle-là ».
  if (e.pointerType !== 'mouse') {
    carte.classList.add('kcard-presse');
    amorce.minuteur = setTimeout(() => {
      if (kb.amorce === amorce) demarrerGlisse(amorce);
    }, 260);
  }
  window.addEventListener('pointermove', surPointeurBouge, { passive: true });
  window.addEventListener('pointerup', surPointeurHaut);
  window.addEventListener('pointercancel', surPointeurAnnule);
}

function surPointeurBouge(e) {
  const a = kb.amorce;
  if (a && e.pointerId === a.pointeur) {
    const d = Math.hypot(e.clientX - a.x, e.clientY - a.y);
    if (a.type === 'mouse') {
      // Cinq pixels : en deçà, c'est un clic qui tremble, pas un glissement.
      if (d > 5) { a.x0 = a.x; a.y0 = a.y; demarrerGlisse(a, e.clientX, e.clientY); }
    } else if (d > 10) {
      // Le doigt a bougé avant la fin de l'appui long : il fait défiler.
      abandonnerAmorce();
    }
    return;
  }
  const g = kb.geste;
  if (g?.mode === 'pointeur' && e.pointerId === g.pointeur) {
    g.x = e.clientX;
    g.y = e.clientY;
  }
}

function surPointeurHaut(e) {
  if (kb.amorce && e.pointerId === kb.amorce.pointeur) { abandonnerAmorce(); return; }
  if (kb.geste?.mode === 'pointeur' && e.pointerId === kb.geste.pointeur) terminerGlisse(false);
}

function surPointeurAnnule(e) {
  if (kb.amorce && e.pointerId === kb.amorce.pointeur) { abandonnerAmorce(); return; }
  if (kb.geste?.mode === 'pointeur' && e.pointerId === kb.geste.pointeur) terminerGlisse(true);
}

function surEchapGlisse(e) {
  if (e.key === 'Escape' && kb.geste?.mode === 'pointeur') { e.preventDefault(); terminerGlisse(true); }
}

function retirerEcouteursPointeur() {
  window.removeEventListener('pointermove', surPointeurBouge);
  window.removeEventListener('pointerup', surPointeurHaut);
  window.removeEventListener('pointercancel', surPointeurAnnule);
  window.removeEventListener('keydown', surEchapGlisse, true);
}

function abandonnerAmorce() {
  const a = kb.amorce;
  if (!a) return;
  clearTimeout(a.minuteur);
  a.carte.classList.remove('kcard-presse');
  kb.amorce = null;
  retirerEcouteursPointeur();
}

function demarrerGlisse(a, x = a.x, y = a.y) {
  clearTimeout(a.minuteur);
  kb.amorce = null;
  const carte = a.carte;
  carte.classList.remove('kcard-presse');
  // Une lecture de géométrie, une seule, avant toute écriture.
  const r = carte.getBoundingClientRect();

  const fantome = carte.cloneNode(true);
  fantome.className = 'kcard kcard-fantome';
  fantome.removeAttribute('tabindex');
  fantome.removeAttribute('role');
  fantome.setAttribute('aria-hidden', 'true');
  fantome.style.width = r.width + 'px';
  fantome.style.height = r.height + 'px';
  fantome.style.transform = `translate3d(${r.left}px, ${r.top}px, 0)`;
  // Le fantôme vit HORS du Kanban (sinon il serait rogné par la colonne qui
  // défile), mais dans un hôte qui porte la classe `kanban-pro` : il garde
  // ainsi exactement l'habillage des cartes, sans dupliquer une règle CSS.
  const hote = document.createElement('div');
  hote.className = 'kanban-pro kanban-fantome-hote';
  hote.appendChild(fantome);
  document.body.appendChild(hote);
  // CAPTURE DU POINTEUR sur le Kanban (qui, lui, ne bouge jamais dans le
  // DOM — la carte, si) : un bouton relâché hors de la fenêtre termine quand
  // même le geste, au lieu de laisser une carte collée au curseur.
  try { kb.zone.setPointerCapture(a.pointeur); } catch { /* pointeur déjà relâché */ }

  const origine = positionDe(carte);
  kb.geste = {
    mode: 'pointeur', carte, fantome, hote, origine, pointeur: a.pointeur,
    // La prise : là où le pointeur a saisi la carte. Le fantôme garde ce
    // décalage, sans quoi il « sauterait » sous le doigt au démarrage.
    prise: { x: (a.x0 ?? a.x) - r.left, y: (a.y0 ?? a.y) - r.top },
    x, y, vx: 0, ancienX: x, angle: 0, echelle: 1, raf: 0, colCible: null,
  };
  carte.classList.add('kcard-trou');
  kb.zone.classList.add('en-glisse');
  document.body.classList.add('kanban-glisse');
  window.addEventListener('keydown', surEchapGlisse, true);
  if (a.type !== 'mouse') navigator.vibrate?.(8);
  annoncer(`Carte saisie : ${carte.querySelector('.kt')?.textContent ?? ''}`);
  kb.geste.raf = requestAnimationFrame(boucleGlisse);
}

/**
 * UNE IMAGE DU GLISSEMENT. Tout le travail par image est ici, et non dans
 * `pointermove` : un pointeur haute fréquence envoie 120 à 1 000 évènements
 * par seconde, et y faire des lectures de géométrie forçait autant de calculs
 * de mise en page. Ici, une fois par image : on LIT (ce qu'il y a sous le
 * pointeur, la boîte de la liste, les positions des cartes), on déplace
 * l'emplacement si besoin (FLIP : lecture groupée, mutation, relecture), puis
 * on ÉCRIT (le fantôme, le défilement). Jamais l'inverse.
 */
function boucleGlisse() {
  const g = kb.geste;
  if (!g || g.mode !== 'pointeur') return;
  const zone = kb.zone;

  // ── LECTURES
  const sous = document.elementFromPoint(g.x, g.y);
  const col = sous?.closest?.('.kcol');
  const dansZone = col && zone.contains(col);
  let liste = null, rl = null, index = 0;
  if (dansZone) {
    liste = col.querySelector('.kcol-liste');
    rl = liste.getBoundingClientRect();
    if (!col.classList.contains('repliee')) {
      const yContenu = g.y - rl.top + liste.scrollTop;
      index = indexInsertion(cartesDe(liste, g.carte)
        .map(c => ({ haut: c.offsetTop, hauteur: c.offsetHeight })), yContenu);
    }
  }
  const defileHoriz = zone.scrollWidth > zone.clientWidth + 2;
  const rz = defileHoriz ? zone.getBoundingClientRect() : null;

  // ── DÉPLACEMENT DE L'EMPLACEMENT
  if (liste) {
    const actuelle = g.carte.parentElement === liste
      ? cartesDe(liste).indexOf(g.carte) : -1;
    if (actuelle !== index) deplacerAvecFlip(g.carte, liste, index);
  }

  // ── ÉCRITURES
  // L'inclinaison suit la VITESSE horizontale, lissée : la carte penche dans
  // le sens où on la tire, et se redresse quand on ralentit — la sensation
  // d'un objet qui a du poids, pas d'un curseur.
  const vitesse = g.x - g.ancienX;
  g.ancienX = g.x;
  g.vx = g.vx * 0.82 + vitesse * 0.18;
  const angleCible = Math.max(-9, Math.min(9, 2.5 + g.vx * 0.9));
  g.angle += (angleCible - g.angle) * 0.22;
  g.echelle += (1.04 - g.echelle) * 0.25;
  g.fantome.style.transform = `translate3d(${g.x - g.prise.x}px, ${g.y - g.prise.y}px, 0) `
    + `rotate(${g.angle.toFixed(2)}deg) scale(${g.echelle.toFixed(3)})`;

  if (g.colCible !== col) {
    g.colCible?.classList.remove('cible');
    if (dansZone) col.classList.add('cible');
    g.colCible = dansZone ? col : null;
  }

  // DÉFILEMENT AUTOMATIQUE près des bords haut et bas de la liste visée…
  if (rl) {
    const haut = vitesseBord(g.y - rl.top);
    const bas = vitesseBord(rl.bottom - g.y);
    if (haut) liste.scrollTop -= haut;
    else if (bas) liste.scrollTop += bas;
  }
  // …et, sur un écran étroit où les colonnes défilent de côté, près des bords
  // gauche et droit du Kanban.
  if (rz) {
    const gauche = vitesseBord(g.x - rz.left, 48);
    const droite = vitesseBord(rz.right - g.x, 48);
    if (gauche) zone.scrollLeft -= gauche;
    else if (droite) zone.scrollLeft += droite;
  }

  g.raf = requestAnimationFrame(boucleGlisse);
}

async function terminerGlisse(annule) {
  const g = kb.geste;
  if (!g) return;
  cancelAnimationFrame(g.raf);
  retirerEcouteursPointeur();
  g.colCible?.classList.remove('cible');
  try { kb.zone.releasePointerCapture(g.pointeur); } catch { /* déjà relâché */ }
  const { carte, fantome, hote, origine } = g;

  if (annule) deplacerAvecFlip(carte, origine.liste, Math.max(0, origine.index));

  // L'ATTERRISSAGE : le fantôme vient se loger dans l'emplacement, se
  // redresse et reprend sa taille. Sans lui, la carte « apparaît » dans la
  // colonne et l'œil perd le fil du geste au moment exact où il compte.
  if (!mouvementCoupe()) {
    let r = carte.getBoundingClientRect();
    // Lâchée sur une colonne REPLIÉE, la carte n'a pas de place visible : le
    // fantôme plonge alors dans l'en-tête de la colonne et s'y résorbe, au
    // lieu de filer vers le coin de l'écran (la boîte d'un élément masqué).
    const plonge = !r.width;
    if (plonge) r = carte.closest('.kcol').querySelector('.kcol-tete').getBoundingClientRect();
    const atterrissage = fantome.animate([
      { transform: fantome.style.transform, opacity: 1 },
      { transform: `translate3d(${r.left}px, ${r.top}px, 0) rotate(0deg) scale(${plonge ? 0.3 : 1})`,
        opacity: plonge ? 0 : 1 },
    ], { duration: 220, easing: 'cubic-bezier(.2,.9,.3,1.15)', fill: 'forwards' });
    // JAMAIS D'ATTENTE SANS FIN. Une page qui ne compose plus d'images
    // (onglet passé en arrière-plan au moment du lâcher) ne termine pas son
    // animation : on attendait `finished` pour toujours, le geste ne se
    // refermait jamais et le Kanban restait sourd à tout nouveau glissement.
    await Promise.race([
      atterrissage.finished.catch(() => {}),
      new Promise(res => setTimeout(res, 300)),
    ]);
  }
  hote.remove();
  carte.classList.remove('kcard-trou');
  kb.zone.classList.remove('en-glisse');
  document.body.classList.remove('kanban-glisse');
  kb.geste = null;
  if (!mouvementCoupe()) {
    carte.classList.add('kcard-pose');
    setTimeout(() => carte.classList.remove('kcard-pose'), 420);
  }
  await validerDepot(carte, origine, annule);
}

// ── LE GESTE AU CLAVIER ───────────────────────────────────────────────────
//
// Espace ou Entrée lève la carte ; les flèches la promènent (haut/bas dans la
// colonne, gauche/droite d'une colonne à l'autre) ; Espace ou Entrée la pose,
// Échap la remet où elle était. Chaque pas est annoncé aux lecteurs d'écran.
// Sans cela, changer un statut au clavier obligeait à quitter le Kanban pour
// aller ouvrir la carte dans la liste des offres.

function surClavierKanban(e) {
  const carte = e.target.closest?.('.kcard');
  if (!carte || carte.classList.contains('kcard-fantome')) return;
  const g = kb.geste;
  if (g && g.mode !== 'clavier') return;

  if (!g) {
    if (e.key === ' ' || e.key === 'Enter') {
      if (kb.attente.has(carte.dataset.id)) return;
      e.preventDefault();
      leverAuClavier(carte);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Sans carte levée, les flèches PROMÈNENT LE FOCUS.
      const voisines = cartesDe(carte.parentElement);
      const i = voisines.indexOf(carte) + (e.key === 'ArrowDown' ? 1 : -1);
      if (voisines[i]) { e.preventDefault(); voisines[i].focus(); }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const cols = [...kb.zone.querySelectorAll('.kcol')];
      const ic = cols.indexOf(carte.closest('.kcol')) + (e.key === 'ArrowRight' ? 1 : -1);
      const cible = cols[ic] && cartesDe(cols[ic].querySelector('.kcol-liste'))[0];
      if (cible) { e.preventDefault(); cible.focus(); }
    }
    return;
  }

  const cols = [...kb.zone.querySelectorAll('.kcol')];
  const { liste, statut } = positionDe(carte);
  const ic = cols.findIndex(c => c.dataset.status === statut);
  const index = cartesDe(liste).indexOf(carte);
  let cibleListe = liste, cibleIndex = index;

  switch (e.key) {
    case 'ArrowUp': cibleIndex = Math.max(0, index - 1); break;
    case 'ArrowDown': cibleIndex = Math.min(cartesDe(liste, carte).length, index + 1); break;
    case 'ArrowLeft':
    case 'ArrowRight': {
      const col = cols[ic + (e.key === 'ArrowRight' ? 1 : -1)];
      if (!col) { e.preventDefault(); return; }
      cibleListe = col.querySelector('.kcol-liste');
      cibleIndex = Math.min(index, cartesDe(cibleListe, carte).length);
      break;
    }
    case ' ': case 'Enter': e.preventDefault(); poserAuClavier(false); return;
    case 'Escape': case 'Tab': e.preventDefault(); poserAuClavier(true); return;
    default: return;
  }
  e.preventDefault();
  if (cibleListe === liste && cibleIndex === index) return;
  deplacerAvecFlip(carte, cibleListe, cibleIndex, true);
  carte.focus({ preventScroll: true });
  carte.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const nouveau = positionDe(carte);
  annoncer(`${nouveau.statut}, position ${cartesDe(nouveau.liste).indexOf(carte) + 1} sur ${cartesDe(nouveau.liste).length}`);
}

function leverAuClavier(carte) {
  kb.geste = { mode: 'clavier', carte, origine: positionDe(carte) };
  carte.classList.add('kcard-levee');
  carte.setAttribute('aria-grabbed', 'true');
  kb.zone.classList.add('en-glisse-clavier');
  annoncer(`Carte levée : ${carte.querySelector('.kt')?.textContent ?? ''}. `
    + 'Flèches pour la déplacer, Espace pour la poser, Échap pour annuler.');
}

async function poserAuClavier(annule) {
  const g = kb.geste;
  if (!g || g.mode !== 'clavier') return;
  const { carte, origine } = g;
  if (annule) deplacerAvecFlip(carte, origine.liste, Math.max(0, origine.index), true);
  carte.classList.remove('kcard-levee');
  carte.removeAttribute('aria-grabbed');
  kb.zone.classList.remove('en-glisse-clavier');
  kb.geste = null;
  carte.focus({ preventScroll: true });
  await validerDepot(carte, origine, annule);
  // Le rendu qu'app.js fait après un dépôt peut avoir déplacé le nœud : on
  // rend le focus à la carte, où qu'elle soit.
  kb.zone.querySelector(`.kcard[data-id="${CSS.escape(carte.dataset.id)}"]`)?.focus({ preventScroll: true });
}

// ── LE DÉPÔT ──────────────────────────────────────────────────────────────

function memoriserOrdre(statut, liste) {
  // Seules les cartes AFFICHÉES ont une place voulue ; celles qui ne sont pas
  // encore rendues suivront, dans l'ordre reçu. Plafonné : la mémoire d'une
  // colonne de neuf cents cartes n'a pas à peser dans le stockage local.
  kb.ordre[statut] = cartesDe(liste).map(c => c.dataset.id).slice(0, 400);
  ecrireStockage(CLE_ORDRE, kb.ordre);
}

function rejouerDiffere() {
  const differe = kb.differe;
  kb.differe = null;
  if (differe) { kb.dernieres = differe; reconcilier(differe); }
}

/**
 * MISE À JOUR OPTIMISTE, AVEC RETOUR ARRIÈRE.
 *
 * La carte est déjà dans sa nouvelle colonne et les compteurs ont déjà roulé
 * quand la requête part : attendre le serveur pour bouger donnait un Kanban
 * qui « colle » un quart de seconde à chaque dépôt. Mais un écran qui garde un
 * état que le serveur a refusé est pire qu'un écran lent — on croirait avoir
 * postulé. Si `surDepot` répond `false`, la carte REPART, visiblement, vers sa
 * colonne d'origine, et tremble une fois pour dire « non ».
 */
async function validerDepot(carte, origine, annule) {
  const id = carte.dataset.id;
  const ici = positionDe(carte);
  memoriserOrdre(ici.statut, ici.liste);

  if (annule || ici.statut === origine.statut) {
    annoncer(annule ? 'Déplacement annulé.' : `Rangée en position ${ici.index + 1}.`);
    rejouerDiffere();
    return;
  }

  // Le rendu différé portait l'ANCIEN statut : le rejouer ramènerait la
  // carte en arrière. Celui que déclenchera la réponse du serveur suffit.
  kb.differe = null;
  const anime = !mouvementCoupe();
  const colDe = (s) => kb.zone.querySelector(`.kcol[data-status="${CSS.escape(s)}"]`);
  const avant = { ...kb.comptes };
  poserCompte(colDe(origine.statut), Math.max(0, (kb.comptes[origine.statut] ?? 1) - 1), anime);
  poserCompte(colDe(ici.statut), (kb.comptes[ici.statut] ?? 0) + 1, anime);
  annoncer(`Déplacée vers « ${ici.statut} ».`);

  carte.classList.add('kcard-attente');
  kb.attente.add(id);
  let accepte;
  try { accepte = await kb.surDepot?.(id, ici.statut); } catch { accepte = false; }
  kb.attente.delete(id);
  // Le nœud a pu être remplacé par un rendu entre-temps : on reprend celui
  // qui est dans la page.
  const vivante = kb.zone.querySelector(`.kcard[data-id="${CSS.escape(id)}"]`) ?? carte;
  vivante.classList.remove('kcard-attente');
  if (accepte !== false) return;

  // REFUSÉ. Si un rendu ne l'a pas déjà ramenée, on la ramène nous-mêmes.
  if (vivante.closest('.kcol')?.dataset.status !== origine.statut && origine.liste.isConnected) {
    deplacerAvecFlip(vivante, origine.liste, Math.max(0, origine.index), true);
    poserCompte(colDe(origine.statut), avant[origine.statut] ?? 0, anime);
    poserCompte(colDe(ici.statut), avant[ici.statut] ?? 0, anime);
  }
  if (anime) {
    vivante.classList.remove('kcard-refus');
    void vivante.offsetWidth; // relance l'animation si elle vient de jouer
    vivante.classList.add('kcard-refus');
    setTimeout(() => vivante.classList.remove('kcard-refus'), 600);
  }
  annoncer(`Le déplacement vers « ${ici.statut} » n'a pas été enregistré. La carte est revenue.`);
}

// ------------------------------------------------------------------- AGENDA

export function rendreAgenda(offres, surClic) {
  const aujourdhui = todayISO();
  const items = offres
    .filter(o => o.suivi.relance && o.suivi.status !== 'Refus' && o.suivi.status !== 'Entretien')
    .map(o => ({ offre: o, date: o.suivi.relance }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Le calendrier montre AUSSI les entretiens : c'est la seule échéance qu'on
  // ne peut pas décaler, et une grille de mois qui ne la portait pas laissait
  // croire à une semaine libre.
  agenda.relances = items;
  agenda.entretiens = offres
    .filter(o => o.suivi.entretien && o.suivi.status !== 'Refus')
    .map(o => ({ offre: o, date: o.suivi.entretien, entretien: true }));
  agenda.surClic = surClic;
  rendreMois();

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
      <span class="agenda-tag" style="background:${enRetard ? 'var(--hotb)' : 'var(--g2b)'};color:${enRetard ? 'var(--hot)' : 'var(--g2)'}">${enRetard ? `${icone('horloge', 12)} En retard` : `${icone('calendrier', 12)} À venir`}</span>
      ${it.offre.lien ? `<a class="link" href="${echapper(it.offre.lien)}" target="_blank" rel="noopener">Voir <span class="ext" aria-hidden="true">${icone('fleche', 11)}</span></a>` : ''}`;
    el.addEventListener('click', e => {
      if (e.target.closest('a')) return;
      surClic?.(it.offre);
    });
    zone.appendChild(el);
  });
}

/** État du calendrier : le mois affiché, et ce qu'il faut y poser. */
const agenda = { decalage: 0, relances: [], entretiens: [], surClic: null, branche: false };

const isoLocal = (d) => {
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * Les 42 cases (six semaines, lundi en tête) d'une grille de mois.
 *
 * LE BUG D'HEURE D'ÉTÉ QUE CETTE FONCTION CORRIGE.
 * La grille se construisait en ajoutant 86 400 000 ms à un minuit local.
 * Or le jour du passage à l'heure d'hiver dure 25 h : `minuit + 24 h` tombe
 * à 23 h LE MÊME JOUR. Toutes les cases suivantes héritaient du décalage — en
 * octobre et novembre, le dimanche 25 octobre apparaissait deux fois et la
 * grille finissait un jour trop tôt ; au printemps (jour de 23 h), il en
 * manquait un. Les pastilles de relance tombaient donc sur la mauvaise case.
 *
 * On ne compte plus en millisecondes mais en JOURS DU CALENDRIER : le
 * constructeur `new Date(a, m, j)` normalise tout seul `j = 0` ou `j = 35`,
 * et il le fait en heure locale, changement d'heure compris.
 *
 * Pure, exportée pour les tests.
 *
 * @param {number} annee
 * @param {number} mois  0 = janvier
 * @returns {{iso: string, jour: number, hors: boolean}[]}
 */
export function joursDuMois(annee, mois) {
  const premier = new Date(annee, mois, 1);
  const decalage = (premier.getDay() + 6) % 7; // lundi = 0
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(annee, mois, 1 - decalage + i);
    return { iso: isoLocal(d), jour: d.getDate(), hors: d.getMonth() !== premier.getMonth() };
  });
}

/**
 * Calendrier du mois, avec une pastille par relance et par entretien.
 * Une liste chronologique dit « quoi » ; une grille de mois dit « quand »,
 * et fait voir d'un coup les semaines chargées.
 *
 * Le mois se PARCOURT (précédent / suivant / aujourd'hui) : planifier une
 * relance à cinq semaines la rendait invisible, la grille ne montrant que le
 * mois courant. Chaque jour chargé porte un aperçu au survol — et au focus,
 * pour le clavier et le doigt — qui nomme les offres ; un clic les ouvre.
 */
function rendreMois(sens = 0) {
  const zone = document.getElementById('moisCalendrier');
  if (!zone) return;
  brancherMois(zone);

  const aujourdhui = todayISO();
  const ref = new Date();
  const cible = new Date(ref.getFullYear(), ref.getMonth() + agenda.decalage, 1);
  const annee = cible.getFullYear(), mois = cible.getMonth();

  const parJour = {};
  for (const it of [...agenda.entretiens, ...agenda.relances]) (parJour[it.date] ??= []).push(it);

  const entetes = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
    .map(j => `<div class="mois-tete">${j}</div>`).join('');

  const cases = joursDuMois(annee, mois).map(({ iso, jour, hors }) => {
    const charges = parJour[iso] ?? [];
    const classes = ['mjour', hors && 'hors', iso === aujourdhui && 'today', charges.length && 'charge',
      charges.some(c => c.entretien) && 'avec-entretien'].filter(Boolean).join(' ');
    if (!charges.length) {
      return `<div class="${classes}"><span class="mn">${jour}</span><span class="mp"></span></div>`;
    }
    const lignes = charges.slice(0, 5).map(c => {
      const type = c.entretien ? 'ent' : c.date < aujourdhui ? 'retard' : '';
      return `<li data-offre="${echapper(String(c.offre.id))}" class="${type}">
        <i></i><span><b>${echapper(c.offre.titre)}</b>
        <small>${c.entretien ? 'Entretien' : 'Relance'} · ${echapper(c.offre.entreprise || '')}</small></span></li>`;
    }).join('');
    const plus = charges.length > 5 ? `<li class="mja-plus">+ ${charges.length - 5} autre(s)</li>` : '';
    return `<div class="${classes}" tabindex="0" data-jour="${iso}"
        aria-label="${echapper(`${dateLisible(iso + 'T12:00:00')} : ${pluriel(charges.length, 'échéance')}`)}">
      <span class="mn">${jour}</span>
      <span class="mp">${charges.slice(0, 4).map(c =>
        `<i class="${c.entretien ? 'ent' : c.date < aujourdhui ? 'retard' : ''}"></i>`).join('')}</span>
      <div class="mjour-apercu" role="tooltip">
        <div class="mja-t">${echapper(dateLisible(iso + 'T12:00:00'))}</div>
        <ul>${lignes}${plus}</ul>
      </div>
    </div>`;
  }).join('');

  zone.innerHTML = entetes + cases;

  // Le mois arrive du côté où l'on va : vers la droite pour « suivant ».
  if (sens && !mouvementCoupe()) {
    zone.animate([
      { opacity: 0, transform: `translateX(${sens * 18}px)` },
      { opacity: 1, transform: 'none' },
    ], { duration: 260, easing: 'cubic-bezier(.22,1,.36,1)' });
  }

  const titre = document.getElementById('moisTitre');
  if (titre) {
    const chevron = iconeOu('chevron', 'fleche', 14);
    titre.innerHTML = `<span class="mois-nav">
      <button type="button" class="mois-btn prec" data-mois="-1" aria-label="Mois précédent">${chevron}</button>
      <span class="mois-nom" aria-live="polite">${MOIS[mois]} ${annee}</span>
      <button type="button" class="mois-btn" data-mois="1" aria-label="Mois suivant">${chevron}</button>
      ${agenda.decalage ? '<button type="button" class="mois-auj" data-mois="0">Aujourd\'hui</button>' : ''}
    </span>`;
  }
}

/** Écouteurs posés UNE fois, par délégation : la grille est réécrite à chaque mois. */
function brancherMois(zone) {
  if (agenda.branche) return;
  agenda.branche = true;

  const titre = document.getElementById('moisTitre');
  titre?.addEventListener('click', e => {
    const b = e.target.closest('[data-mois]');
    if (!b) return;
    const pas = Number(b.dataset.mois);
    const avant = agenda.decalage;
    agenda.decalage = pas === 0 ? 0 : agenda.decalage + pas;
    rendreMois(Math.sign(agenda.decalage - avant));
    // Le bouton cliqué a été réécrit : on rend le focus à son remplaçant.
    titre.querySelector(`[data-mois="${pas === 0 ? 1 : pas}"]`)?.focus();
  });

  const ouvrir = (cible) => {
    const ligne = cible.closest('[data-offre]');
    const jour = cible.closest('[data-jour]');
    const id = ligne?.dataset.offre ?? jour?.querySelector('[data-offre]')?.dataset.offre;
    if (!id) return;
    const tout = [...agenda.entretiens, ...agenda.relances];
    const trouve = tout.find(x => String(x.offre.id) === id);
    if (trouve) agenda.surClic?.(trouve.offre);
  };
  zone.addEventListener('click', e => {
    // Un clic sur le jour lui-même n'ouvre que s'il ne porte qu'une offre ;
    // sinon il montre l'aperçu (le focus suffit), où l'on choisit.
    if (e.target.closest('[data-offre]')) { ouvrir(e.target); return; }
    const jour = e.target.closest('[data-jour]');
    if (jour && jour.querySelectorAll('[data-offre]').length === 1) ouvrir(jour);
  });
  zone.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.closest('[data-jour]')) { e.preventDefault(); ouvrir(e.target); }
  });
}
