// LE THÈME AVANT LE PREMIER RENDU.
//
// Script CLASSIQUE, chargé dans <head> sans `defer` ni `type="module"` — et
// c'est tout son intérêt. Un module s'exécute APRÈS l'analyse du document :
// `app.js` posait donc le thème choisi une fois la page déjà peinte, et quiconque
// avait choisi « Nuit » voyait à chaque ouverture un éclair blanc, le temps que
// `data-theme="vivid"` écrit en dur dans le balisage soit remplacé. Ici, le
// thème, la densité et l'interrupteur des animations sont posés sur <html>
// avant que le moindre pixel soit dessiné.
//
// `script-src 'self'` l'autorise : c'est un fichier servi, pas un script en
// ligne. Il ne dépend de rien et ne fait rien d'autre — chaque milliseconde
// passée ici retarde le premier affichage.
//
// « SYSTÈME » suit `prefers-color-scheme` : Nuit quand le système est sombre,
// Clair sinon, et bascule en direct si le système change (le soir venu).
(function () {
  var racine = document.documentElement;
  var THEMES = ['vivid', 'enr', 'dark', 'cockpit'];
  var choix = 'vivid';
  var options = {};
  try {
    choix = localStorage.getItem('bp_theme') || 'vivid';
    options = JSON.parse(localStorage.getItem('bp_options') || '{}') || {};
  } catch (e) { /* stockage indisponible : les valeurs par défaut */ }

  var sombre = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function resoudre(c) {
    if (c === 'systeme') return sombre && sombre.matches ? 'dark' : 'vivid';
    return THEMES.indexOf(c) >= 0 ? c : 'vivid';
  }

  racine.dataset.themeChoix = choix;
  racine.dataset.theme = resoudre(choix);
  racine.dataset.densite = options.densite || 'normale';
  racine.dataset.anim = options.animations === false ? 'off' : 'on';

  if (sombre && sombre.addEventListener) {
    sombre.addEventListener('change', function () {
      if (racine.dataset.themeChoix === 'systeme') racine.dataset.theme = resoudre('systeme');
    });
  }
})();
