// LE PLAN DE MONTAGE. Temps en secondes. Une mesure = 2.308 s (104 BPM) :
// les coupes tombent sur des mesures. Coordonnées caméra en pixels source
// (1920×1080) : (x, y) = point qui se retrouve au centre, s = grossissement.
// « Calm Confidence » (Suno) : 106,5 BPM mesuré.
const MES = 60 / 106.5 * 4;
window.PLAN = {
  clips: [
    // 0 — accroche : le radar déjà en marche, serré, sans explication
    { id: 'accroche', type: 'prise', seq: 'C-radar', debut: 9.4, duree: MES, curseur: false,
      camera: [{ t: 0, s: 1.4, x: 770, y: 480 }, { t: MES, s: 1.2, x: 770, y: 500 }] },

    { id: 'titre', type: 'carton', duree: 2 * MES, entree: { type: 'fondu', d: .3 },
      carton: { sur: 'Job Cockpit 4.0', titre: 'Pilote ta recherche d’emploi.', sous: 'Collecte, tri, analyse, lettres. Chez toi.' } },

    // ouverture radar de l'application, pleine image
    { id: 'ouverture', type: 'prise', seq: 'A-ouverture', debut: 1.1, duree: 2 * MES, curseur: false, entree: { type: 'fondu', d: .4 },
      camera: [{ t: 0, s: 1.08, x: 960, y: 540 }, { t: 2 * MES, s: 1.15, x: 960, y: 560 }] },

    // tableau de bord : héros puis les 3 du jour
    // la page défile à 2.9 s de la prise : avant, le héros ; après, les 3 du jour en haut
    // au ralenti (×0.6) : la page ne défile pas pendant le clip, c'est la
    // caméra qui va du héros aux 3 du jour
    { id: 'tableau', type: 'prise', seq: 'B-tableau', debut: 0.1, vitesse: .6, duree: 2 * MES, entree: { type: 'zoom', d: .45 },
      camera: [{ t: 0, s: 1.0, x: 960, y: 540 }, { t: 1.3, s: 1.3, x: 760, y: 320 }, { t: 2.2, s: 1.3, x: 760, y: 320 },
               { t: 3.2, s: 1.3, x: 920, y: 660 }, { t: 2 * MES, s: 1.34, x: 920, y: 670 }],
      legendes: [{ t0: .5, t1: 2.2, texte: 'L’objectif de la semaine', x: 640, y: 150 },
                 { t0: 3.1, t1: 4.6, texte: 'Trois offres à ouvrir. Pas trois cents.', x: 960, y: 980, ecran: true }] },

    { id: 'chiffres', type: 'chiffres', duree: MES * 1.5, entree: { type: 'fondu', d: .3 },
      chiffres: [{ valeur: 3195, libelle: 'annonces vues' }, { valeur: 738, libelle: 'retenues' }, { valeur: 3, libelle: 'à ouvrir', accent: true }] },

    { id: 'c-collecte', type: 'carton', duree: MES, entree: { type: 'fondu', d: .3 },
      carton: { sur: 'La collecte', titre: 'Regarde-la travailler.' } },

    // le radar, long : sources → offres → analyse
    // dans la prise : radar ouvert vers 1.6 s, sources jusqu'à ~3 s, offres
    // de 3 à ~9.3 s, analyses ensuite
    // dans la prise : clic à ~1.1 s, sources jusqu'à ~4.3 s, offres de ~4.5
    // à ~10.8 s, analyses ensuite (clip : prise 1.6 → 13.1)
    // dans la prise : sources jusqu'à ~5.5 s, offres de ~6 à ~12.5 s,
    // analyses ensuite (clip : prise 3.0 → 14.5)
    { id: 'radar', type: 'prise', seq: 'C-radar', debut: 3.0, duree: 5 * MES, entree: { type: 'zoom', d: .35 },
      camera: [{ t: 0, s: 1.0, x: 960, y: 540 }, { t: 1.8, s: 1.0, x: 960, y: 540 }, { t: 3.4, s: 1.25, x: 770, y: 480 },
               { t: 5.6, s: 1.25, x: 770, y: 480 }, { t: 6.6, s: 1.5, x: 1650, y: 560 }, { t: 7.8, s: 1.5, x: 1650, y: 640 },
               { t: 8.6, s: 1.0, x: 960, y: 540 }, { t: 9.2, s: 1.0, x: 960, y: 540 }, { t: 10.0, s: 1.45, x: 1620, y: 470 },
               { t: 5 * MES, s: 1.45, x: 1620, y: 520 }],
      legendes: [{ t0: .4, t1: 2.3, texte: 'Quatre sources, en parallèle', x: 1500, y: 240, ancre: 'droite' },
                 { t0: 4.3, t1: 6.3, texte: 'Chaque offre retenue s’allume', x: 300, y: 860 },
                 { t0: 9.9, t1: 11.5, texte: 'Gemini analyse les prioritaires', x: 960, y: 980, ecran: true }] },

    { id: 'c-kanban', type: 'carton', duree: MES, entree: { type: 'fondu', d: .3 },
      carton: { sur: 'Le suivi', titre: 'Glisse. Lâche. C’est noté.' } },

    // kanban : la caméra suit la main
    { id: 'kanban', type: 'prise', seq: 'D-kanban', debut: 0.3, duree: 2 * MES, entree: { type: 'zoom', d: .35 },
      suivre: 'curseur', decalage: { x: 120, y: 60 },
      camera: [{ t: 0, s: 1.42, x: 500, y: 400 }],
      legendes: [{ t0: 2.9, t1: 4.4, texte: 'Enregistré, et la relance est planifiée', x: 960, y: 980, ecran: true }] },

    { id: 'c-clavier', type: 'carton', duree: MES, entree: { type: 'fondu', d: .3 },
      carton: { sur: 'Au clavier', titre: 'Tout est à trois touches.' } },

    // palette puis J/K
    { id: 'palette', type: 'prise', seq: 'E-palette', debut: 0.55, duree: 2.5 * MES, entree: { type: 'zoom', d: .35 },
      camera: [{ t: 0, s: 1.25, x: 960, y: 430 }, { t: 3.6, s: 1.25, x: 960, y: 430 }, { t: 4.4, s: 1.18, x: 960, y: 420 }, { t: 2.5 * MES, s: 1.2, x: 960, y: 460 }],
      legendes: [{ t0: .2, t1: 1.6, texte: 'Ctrl K', x: 1200, y: 160, touche: true },
                 { t0: 4.6, t1: 5.7, texte: 'J K', x: 1200, y: 160, touche: true }] },

    { id: 'c-focus', type: 'carton', duree: MES, entree: { type: 'fondu', d: .3 },
      carton: { sur: 'Quand ça compte', titre: 'Reste concentré.' } },

    { id: 'focus', type: 'prise', seq: 'F-focus', debut: 1.3, duree: 1.5 * MES, entree: { type: 'zoom', d: .35 },
      camera: [{ t: 0, s: 1.45, x: 590, y: 250 }, { t: 1.5 * MES, s: 1.15, x: 760, y: 320 }],
      legendes: [{ t0: 1.2, t1: 3.0, texte: 'Pomodoro, et rien d’autre à l’écran', x: 960, y: 980, ecran: true }] },

    { id: 'themes', type: 'prise', seq: 'G-themes', debut: 0.3, duree: MES * 1.5, curseur: false, entree: { type: 'fondu', d: .35 },
      camera: [{ t: 0, s: 1.0, x: 960, y: 540 }, { t: MES * 1.5, s: 1.05, x: 960, y: 540 }],
      legendes: [{ t0: .3, t1: 3.0, texte: 'Quatre thèmes, ou celui du système', x: 960, y: 980, ecran: true }] },

    { id: 'fin', type: 'carton', duree: 2.5 * MES, entree: { type: 'fondu', d: .4 },
      carton: { type: 'fin', titre: 'Job Cockpit 4.0', sous: 'Gratuit, open source, et tout reste chez toi.',
        points: ['Collecte automatique', 'Analyse par IA', 'Lettres et entretiens', 'Windows · macOS · Linux'] } },
  ],
};
