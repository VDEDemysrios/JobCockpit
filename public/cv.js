// Vue « Mon CV ».
//
// POURQUOI CETTE VUE EXISTE
// -------------------------
// Le CV joue deux rôles, et les confondre a rendu cette vue inutilisable dans
// sa première version :
//
//   - c'est un DOCUMENT, celui que l'employeur reçoit. Il part en pièce jointe
//     dans son .docx d'origine, mise en page comprise ;
//   - c'est aussi une MATIÈRE PREMIÈRE : le texte extrait de ce document
//     nourrit l'analyse des offres et la rédaction des lettres.
//
// Afficher le texte extrait revenait à montrer la matière première à la place
// du document : l'extraction aplatit les tableaux et livre les blocs dans un
// ordre imprévisible — « CONTACT » et « COMPÉTENCES » ressortaient avant le
// nom du candidat. Illisible, et pour rien : ce n'est pas ce qu'on envoie.
//
// Cette vue montre donc le document, et ne garde du texte extrait que ce qui
// se décide : la couverture des mots-clés. Chaque motif « positif » du scoring
// valorise une offre parce qu'elle mentionne une compétence — si le CV ne la
// porte pas, le classement récompense quelque chose d'invérifiable.

import { echapper, dateLisible, ilYA, pluriel } from './format.js';
import { anneau } from './charts.js';
import { icone } from './icons.js';

export function rendreCv(cv) {
  const sous = document.getElementById('cvSub');
  const zone = document.getElementById('cvContenu');

  if (!cv?.present) {
    sous.textContent = 'Aucun CV extrait pour le moment.';
    zone.innerHTML = `<div class="panel-box">
      <div class="focus-vide">
        <span class="em">📄</span>
        <div style="font-size:16px;font-weight:600;margin-bottom:8px">Aucun CV n'a encore été extrait.</div>
        <div style="color:var(--muted);font-size:13.5px;line-height:1.7">
          Sans lui, les offres sont collectées et classées, mais ni analysées ni
          accompagnées d'une lettre.<br>Lance cette commande dans le terminal :
        </div>
        <code class="cv-cmd">npm run extract-cv -- "C:/chemin/vers/CV.docx"</code>
      </div></div>`;
    return;
  }

  const couverts = cv.couverture.filter(c => c.present);
  const manquants = cv.couverture.filter(c => !c.present);
  const pct = cv.couverture.length
    ? Math.round(couverts.length / cv.couverture.length * 100) : 0;

  sous.textContent = cv.fichier
    ? `${cv.fichier.nom} · ${couverts.length}/${cv.couverture.length} mots-clés couverts`
    : `${couverts.length}/${cv.couverture.length} mots-clés couverts`;

  const alerte = cv.perimee
    ? `<div class="veille-banner stale" style="margin-bottom:var(--e4)">
        <span class="grow">⚠️ <strong>Ton document a été modifié après la dernière extraction.</strong>
        Les analyses et les lettres travaillent donc sur une version périmée. Relance
        <code>npm run extract-cv</code> pour la mettre à jour.</span></div>`
    : '';

  zone.innerHTML = alerte + `
    <div class="grille-2">
      <div class="panel-box">
        <h3><span data-ic="document" data-ic-taille="14"></span> Le document envoyé
          <span class="h3-side">pièce jointe de tes candidatures</span></h3>
        ${cv.fichier ? `
          <div class="cv-doc">
            <div class="cv-doc-ic">📄</div>
            <div class="cv-doc-txt">
              <strong>${echapper(cv.fichier.nom)}</strong>
              <span>${(cv.fichier.octets / 1024).toFixed(0)} ko${cv.fichier.modifieLe
                ? ` · modifié ${ilYA(cv.fichier.modifieLe)}` : ''}</span>
            </div>
            <a class="btn btn-primary" href="/api/cv/fichier">${icone('document', 14)} Ouvrir</a>
          </div>
          <p class="note-panel">C'est ce fichier, tel quel, que reçoit l'employeur : le bouton
            <strong>Dossier complet</strong> d'une lettre le joint automatiquement. Sa mise en page
            est la tienne — le programme ne la réécrit jamais.</p>
        ` : `
          <p class="note-panel">Le texte du CV est bien extrait, mais le document d'origine est
            introuvable. Relance <code>npm run extract-cv</code> en lui donnant le chemin de ton
            .docx pour pouvoir le joindre à tes candidatures.</p>
        `}
        <div class="cv-fiche">
          ${ligne('Candidat', cv.candidat?.nom || '—')}
          ${ligne('Ville déclarée', cv.candidat?.ville || '—')}
          ${ligne('Texte extrait le', `${dateLisible(cv.extraitLe.slice(0, 10))} · ${ilYA(cv.extraitLe)}`)}
          ${ligne('Matière lue', `${pluriel(cv.mots, 'mot')}`)}
        </div>
        <p class="note-panel">Le texte extrait de ce document est envoyé à Google Gemini à chaque
          analyse d'offre et à chaque rédaction de lettre. C'est la seule donnée qui quitte ton
          ordinateur. Laisser <code>GEMINI_API_KEY</code> vide coupe complètement cet envoi.</p>
      </div>

      <div class="panel-box">
        <h3><span data-ic="cerveau" data-ic-taille="14"></span> Couverture de tes mots-clés
          <span class="h3-side">motifs positifs du scoring</span></h3>
        <div class="cv-couv">
          <div id="cvAnneau"></div>
          <div class="cv-couv-listes">
            ${manquants.length ? `
              <div class="lbl no">❌ ${pluriel(manquants.length, 'motif')} sans appui dans le CV</div>
              <div class="motifs" style="margin-bottom:var(--e4)">
                ${manquants.map(m => `<span class="motif neg" title="${echapper(m.motif)}">
                  +${m.poids} ${echapper(m.note || m.motif)}</span>`).join('')}
              </div>` : ''}
            <div class="lbl ok">✅ ${pluriel(couverts.length, 'motif')} appuyé${couverts.length > 1 ? 's' : ''} par le CV</div>
            <div class="motifs">
              ${couverts.map(m => `<span class="motif" title="${echapper(m.motif)}">
                +${m.poids} ${echapper(m.note || m.motif)}</span>`).join('')}
            </div>
          </div>
        </div>
        <p class="note-panel">Un motif sans appui fait monter des offres pour une compétence que ton
          CV ne démontre pas. Soit tu l'ajoutes au CV, soit tu retires le motif de
          <code>profile.json</code> — les deux se valent, mais laisser l'écart te fera perdre
          du temps sur des offres qui ne tiendront pas en entretien.</p>
      </div>
    </div>`;

  document.getElementById('cvAnneau').innerHTML = anneau(pct, {
    taille: 130, epaisseur: 11, atteint: pct === 100,
    valeur: `${pct}%`, libelle: 'couverts',
  });
}

const ligne = (cle, valeur) =>
  `<div class="cv-l"><span class="cv-k">${echapper(cle)}</span><span class="cv-v">${valeur}</span></div>`;
