// Jeu d'icônes de l'interface.
//
// Des tracés SVG monoline, épaisseur 1.75, cohérents entre eux — et non des
// emoji. Les emoji se rendent différemment sur chaque système (Windows,
// macOS, Android), s'alignent mal sur le texte, ignorent la couleur du thème
// et donnent immédiatement un air amateur à une interface.
//
// Chaque icône hérite de `currentColor` : elle prend donc la couleur de son
// contexte, sans réglage supplémentaire.

const TRACES = {
  // Navigation
  cible:      '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  graphique:  '<path d="M3 20h18"/><rect x="5" y="11" width="3.5" height="6" rx="1"/><rect x="10.25" y="6" width="3.5" height="11" rx="1"/><rect x="15.5" y="13" width="3.5" height="4" rx="1"/>',
  liste:      '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M7.5 9h9M7.5 12.5h9M7.5 16h5"/>',
  colonnes:   '<rect x="3" y="4.5" width="5" height="15" rx="1.5"/><rect x="9.5" y="4.5" width="5" height="10" rx="1.5"/><rect x="16" y="4.5" width="5" height="13" rx="1.5"/>',
  calendrier: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  trophee:    '<path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4.5a3 3 0 0 0 3 3M17 6h2.5a3 3 0 0 1-3 3"/><path d="M12 14v3.5M8.5 21h7l-.7-3.5h-5.6L8.5 21Z"/>',
  reglages:   '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"/>',

  // Actions et états
  envoi:      '<path d="M21 4 3 10.5l7 3M21 4l-3.5 16-4-7.5M21 4 10 13.5"/>',
  cloche:     '<path d="M18 8.5a6 6 0 1 0-12 0c0 5-2.5 6.5-2.5 6.5h17S18 13.5 18 8.5Z"/><path d="M13.7 19a2 2 0 0 1-3.4 0"/>',
  plume:      '<path d="M20 4C13 4 8 8 6.5 14.5 6 16.5 5 18.5 4 20"/><path d="M20 4c0 7-4 12-10.5 13.5"/><path d="M8.5 15.5h6"/>',
  fusee:      '<path d="M12 2c3.5 2 5.5 6 5.5 10L12 17l-5.5-5C6.5 8 8.5 4 12 2Z"/><circle cx="12" cy="9.5" r="2"/><path d="M9 17.5 6.5 21M15 17.5 17.5 21"/>',
  flamme:     '<path d="M12 2.5c2.5 4 6 5.5 6 10a6 6 0 0 1-12 0c0-2 1-3.5 2-4.5.5 1.5 1.5 2 2.5 2 1.5 0 2-2 1.5-7.5Z"/>',
  diamant:    '<path d="M6 3h12l4 6-10 12L2 9l4-6Z"/><path d="M2 9h20M9 3l-2.5 6L12 21l5.5-12L15 3"/>',
  coche:      '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.5 2.5L16 9.5"/>',
  zen:        '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.2 1.5 3.5 1.5 3.5-1.5 3.5-1.5M8.5 9.5h.01M15.5 9.5h.01"/>',
  feuille:    '<path d="M4 20c0-8 5-13 16-14 0 10-5 15-13 15-1.5 0-3-.4-3-1Z"/><path d="M9 15c2-3 5-5 8-6"/>',
  carte:      '<path d="M9 3 3 5.5v15L9 18l6 3 6-2.5v-15L15 6 9 3Z"/><path d="M9 3v15M15 6v15"/>',
  loupe:      '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/>',
  livre:      '<path d="M4 4.5h6a2.5 2.5 0 0 1 2.5 2.5v13A2 2 0 0 0 10.5 18H4V4.5Z"/><path d="M20 4.5h-6a2.5 2.5 0 0 0-2.5 2.5v13A2 2 0 0 1 13.5 18H20V4.5Z"/>',
  porte:      '<path d="M14.5 3.5v17H5.5v-17h9Z"/><path d="M14.5 5h4v15.5H3"/><circle cx="11.5" cy="12" r="1" fill="currentColor" stroke="none"/>',
  'gratte-ciel': '<path d="M3 20.5h18"/><path d="M6 20.5V8l5-4.5V20.5M11 20.5V10l7 2.5v8"/><path d="M8 11h1M8 14h1M8 17h1M14 15h1M14 18h1"/>',

  // Interface
  eclair:     '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  boussole:   '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
  carte2:     '<path d="M3 7.5 9 4.5l6 3 6-3v12l-6 3-6-3-6 3v-12Z"/><path d="M9 4.5v12M15 7.5v12"/>',
  filtre:     '<path d="M3.5 5.5h17l-6.5 7.5v6l-4 2v-8L3.5 5.5Z"/>',
  medaille:   '<circle cx="12" cy="14.5" r="5.5"/><path d="m8.5 9.5-3-6.5h12l-3 6.5"/><path d="m12 12 .9 1.8 2 .3-1.45 1.4.35 2L12 16.6l-1.8.9.35-2L9.1 14.1l2-.3L12 12Z"/>',
  bougie:     '<path d="M3 20.5h18"/><path d="M6.5 20.5v-6M12 20.5V7M17.5 20.5v-9"/><path d="M4.5 14.5h4M10 7h4M15.5 11.5h4"/>',
  cerveau:    '<path d="M9.5 4.5A2.5 2.5 0 0 0 7 7a2.5 2.5 0 0 0-1.5 4.5A2.5 2.5 0 0 0 7 16a2.5 2.5 0 0 0 2.5 2.5V4.5Z"/><path d="M14.5 4.5A2.5 2.5 0 0 1 17 7a2.5 2.5 0 0 1 1.5 4.5A2.5 2.5 0 0 1 17 16a2.5 2.5 0 0 1-2.5 2.5V4.5Z"/>',
  bouclier:   '<path d="M12 3 4.5 6v6c0 4.5 3 7.7 7.5 9 4.5-1.3 7.5-4.5 7.5-9V6L12 3Z"/><path d="m8.75 12 2.25 2.25 4.25-4.5"/>',
  entonnoir:  '<path d="M3.5 5h17l-6.5 8v6.5l-4 1.5V13L3.5 5Z"/>',
  parchemin:  '<path d="M5 4.5h11a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2v-13Z"/><path d="M18 6.5h1.5a1.5 1.5 0 0 1 0 3H18"/><path d="M8.5 9h6M8.5 12.5h6M8.5 16h3.5"/>',
  cible2:     '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="5"/>',
  vent:       '<path d="M3 8.5h11a3 3 0 1 0-3-3"/><path d="M3 12.5h15a3 3 0 1 1-3 3"/><path d="M3 16.5h7"/>',
  soleil:     '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.2 5.2l1.8 1.8M17 17l1.8 1.8M18.8 5.2 17 7M7 17l-1.8 1.8"/>',
  horloge:    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l3.5 2"/>',
  poignee:    '<path d="M8 12.5 11 15l1.5-1.5"/><path d="M3.5 10.5 7 7l4 3.5 2-1.5 3.5 3 4-3.5"/><path d="M3.5 10.5v4L9 20l2-2 2 2 5.5-5.5v-4"/>',
  document:   '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M8.5 13h7M8.5 16.5h4"/>',
  rafraichir: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/>',
  etoile:     '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
  cadenas:    '<rect x="4.5" y="10" width="15" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  globe:      '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z"/>',
  fleche:     '<path d="M5 12h14M13 6l6 6-6 6"/>',
  croix:      '<path d="M6 6l12 12M18 6 6 18"/>',
  info:       '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>',
};

/**
 * Renvoie le balisage SVG d'une icône.
 * @param {string} nom     clé du jeu d'icônes
 * @param {number} taille  côté du carré, en pixels
 */
export function icone(nom, taille = 20) {
  const trace = TRACES[nom] ?? TRACES.info;
  return `<svg class="ic" width="${taille}" height="${taille}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${trace}</svg>`;
}

/** Remplace tout élément portant `data-ic` par l'icône correspondante. */
export function poserIcones(racine = document) {
  racine.querySelectorAll('[data-ic]').forEach(el => {
    el.innerHTML = icone(el.dataset.ic, Number(el.dataset.icTaille) || 20);
    el.removeAttribute('data-ic');
  });
}
