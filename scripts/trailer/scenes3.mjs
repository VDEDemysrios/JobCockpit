// Reprises : tableau, focus, thèmes — avec un stockage local VIDÉ avant
// chaque prise (le Pomodoro et le mode focus survivent au rechargement, et
// s'invitaient dans les prises suivantes), et sans toasts.
const APP = 'http://127.0.0.1:4321';
export default async (p) => {
  const amorce = async (theme) => {
    await p.goto(APP + '/bienvenue.html', 300);
    await p.eval(`localStorage.clear(); sessionStorage.clear();
      localStorage.setItem('bp_tutoriel_vu','1'); localStorage.setItem('bp_theme',${JSON.stringify(theme)});
      localStorage.setItem('bp_options', JSON.stringify({densite:'normale', animations:true, intro:false, relanceJours:7, masquerEcartees:false, mosaique:false}));
      sessionStorage.setItem('bp_intro_jouee','1'); 'ok'`);
  };
  const sansToast = async () => { await p.eval(`const s = document.createElement('style'); s.textContent = '#toastZone{display:none !important}'; document.head.appendChild(s); 1`); };
  const parquer = async () => { await p.mouse('mouseMoved', 1860, 1040); p.souris = { x: 1860, y: 1040 }; };

  await amorce('cockpit');
  await p.goto(APP + '/#/tableau', 600); await sansToast(); await p.wait(1200);
  await parquer();
  await p.enregistrer('B-tableau');
  await p.wait(2900);
  await p.eval(`document.querySelector('#view-dashboard').scrollTo({top: 470, behavior: 'smooth'}); 1`);
  await p.wait(2600);
  await p.eval(`document.querySelector('#view-dashboard').scrollTo({top: 1260, behavior: 'smooth'}); 1`);
  await p.wait(1400);
  await p.click('#segRythme button[data-p="90"]', 1300, 700);
  await p.click('#segRythme button[data-p="semaines"]', 1600, 400);
  await p.couper();

  await amorce('cockpit');
  await p.goto(APP + '/#/tableau', 600); await sansToast(); await p.wait(1000);
  await parquer();
  await p.enregistrer('F-focus');
  await p.wait(300);
  await p.key('f', 1400);
  await p.click('.mf-commandes button', 400, 700);
  await p.wait(2800);
  await p.couper();

  await amorce('vivid');
  await p.goto(APP + '/#/tableau', 600); await sansToast(); await p.wait(1000);
  await parquer();
  await p.enregistrer('G-themes');
  await p.wait(500);
  await p.key('t', 1300); await p.key('t', 1300); await p.key('t', 1600);
  await p.couper();
};
