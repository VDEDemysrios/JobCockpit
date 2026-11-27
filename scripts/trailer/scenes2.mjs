// Prises de vues pour le montage cinématographique : gestes lents et lisibles,
// un peu plus longs que nécessaire — le montage coupe.
const APP = 'http://127.0.0.1:4321';

export default async (p) => {
  const amorce = async (theme, { intro = false } = {}) => {
    await p.goto(APP + '/bienvenue.html', 300);
    await p.eval(`localStorage.setItem('bp_tutoriel_vu','1'); localStorage.setItem('bp_theme',${JSON.stringify(theme)});
      localStorage.setItem('bp_options', JSON.stringify({densite:'normale', animations:true, intro:${intro}, relanceJours:7, masquerEcartees:false, mosaique:false}));
      ${intro ? "sessionStorage.removeItem('bp_intro_jouee')" : "sessionStorage.setItem('bp_intro_jouee','1')"}; 'ok'`);
  };
  // Le pointeur part toujours hors champ, en bas à droite.
  const parquer = async () => { await p.mouse('mouseMoved', 1860, 1040); p.souris = { x: 1860, y: 1040 }; };

  // A — ouverture radar de l'application
  await amorce('cockpit', { intro: true });
  await parquer();
  await p.enregistrer('A-ouverture');
  await p.goto(APP + '/#/tableau', 4300);
  await p.wait(2600);
  await p.couper();

  // B — tableau de bord : lecture, puis courbe
  await amorce('cockpit');
  await p.goto(APP + '/#/tableau', 1800);
  await parquer();
  await p.enregistrer('B-tableau');
  await p.wait(1400);
  await p.eval(`document.querySelector('#view-dashboard').scrollTo({top: 560, behavior: 'smooth'}); 1`);
  await p.wait(1600);
  await p.eval(`document.querySelector('#view-dashboard').scrollTo({top: 1260, behavior: 'smooth'}); 1`);
  await p.wait(1400);
  await p.click('#segRythme button[data-p="90"]', 1300, 700);
  await p.click('#segRythme button[data-p="semaines"]', 1600, 400);
  await p.couper();

  // C — radar de collecte
  await amorce('cockpit');
  await p.goto(APP + '/#/tableau', 1500);
  await parquer();
  await p.enregistrer('C-radar');
  await p.wait(400);
  await p.click('#refreshBtn', 300, 800);
  await p.wait(15500);
  await p.couper();

  // D — kanban : glissement lent
  await amorce('cockpit');
  await p.goto(APP + '/#/kanban', 1800);
  await parquer();
  await p.enregistrer('D-kanban');
  await p.wait(600);
  await p.drag('.kcol[data-status="À postuler"] .kcard:nth-child(2)', '.kcol[data-status="Envoyé"] .kcard:nth-child(2)', 1700);
  await p.wait(500);
  await p.drop(1800);
  await p.couper();

  // E — palette puis clavier dans la liste
  await amorce('cockpit');
  await p.goto(APP + '/#/offres', 1800);
  await parquer();
  await p.enregistrer('E-palette');
  await p.wait(500);
  await p.key('k', 700, 2);
  await p.type('photovolt', 95);
  await p.wait(900);
  await p.key('ArrowDown', 400); await p.key('ArrowDown', 400); await p.key('ArrowDown', 800);
  await p.key('Enter', 1900);
  await p.key('j', 520); await p.key('j', 520); await p.key('Enter', 1900);
  await p.couper();

  // F — mode focus
  await amorce('cockpit');
  await p.goto(APP + '/#/tableau', 1600);
  await parquer();
  await p.enregistrer('F-focus');
  await p.wait(300);
  await p.key('f', 1400);
  await p.click('.mf-commandes button', 400, 700);
  await p.wait(2600);
  await p.couper();

  // G — thèmes
  await amorce('vivid');
  await p.goto(APP + '/#/tableau', 1600);
  await parquer();
  await p.enregistrer('G-themes');
  await p.wait(500);
  await p.key('t', 1300); await p.key('t', 1300); await p.key('t', 1600);
  await p.couper();
};
