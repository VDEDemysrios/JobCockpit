// Export iCalendar (RFC 5545) des relances et des entretiens.
//
// POURQUOI UN FICHIER .ics
// ------------------------
// Un rappel qui ne vit que dans un onglet ne sonne pas quand l'onglet est
// fermé. Le format iCalendar s'importe dans tous les agendas — Outlook,
// Google, celui du téléphone — et c'est lui qui réveille la veille d'un
// entretien, pas une page web qu'on n'a pas ouverte.
//
// TROIS DÉTAILS QUI FONT QU'UN .ics EST ACCEPTÉ OU REJETÉ
// -------------------------------------------------------
//   · les lignes se terminent par CRLF, et se replient au-delà de 75 octets ;
//   · `,` `;` `\` et les retours à la ligne s'échappent dans le texte ;
//   · l'UID est STABLE (`<offre>-<type>@jobcockpit`) : réimporter le fichier
//     met l'événement à jour au lieu de le dupliquer.
// Les événements sont « journée entière » (`VALUE=DATE`) : on connaît le jour
// d'un entretien, pas toujours l'heure, et une heure inventée serait pire
// qu'aucune. La date reste LOCALE — c'est le principe d'une date sans heure.

/** Échappe un texte selon RFC 5545 §3.3.11. */
export function echapperTexte(texte) {
  return String(texte ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Replie une ligne à 75 octets (pas caractères : les accents comptent double
 * en UTF-8). La suite commence par une espace, comme l'exige la norme.
 */
export function replier(ligne) {
  const morceaux = [];
  let courant = '';
  let octets = 0;
  for (const c of ligne) {
    const t = Buffer.byteLength(c, 'utf8');
    if (octets + t > (morceaux.length ? 74 : 75)) {
      morceaux.push(courant);
      courant = '';
      octets = 0;
    }
    courant += c;
    octets += t;
  }
  morceaux.push(courant);
  return morceaux.join('\r\n ');
}

const compacte = (iso) => String(iso).slice(0, 10).replace(/-/g, '');

/** Le lendemain d'une date ISO, en local (DTEND est exclusif). */
function lendemain(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + 1);
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** Horodatage UTC au format iCalendar : 20261113T140500Z. */
function horodatageUtc(quand) {
  return quand.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const dateValide = (iso) => /^\d{4}-\d{2}-\d{2}/.test(String(iso ?? ''));

/**
 * @param {object} db
 * @param {object} [options] { maintenant } pour les tests
 * @returns {string} le calendrier complet, lignes en CRLF
 */
export function construireAgenda(db, { maintenant = new Date() } = {}) {
  const lignes = db.prepare(`
    SELECT o.id, o.titre, o.entreprise, o.ville, o.lien,
           t.status, t.relance_date, t.entretien_date
    FROM tracking t JOIN offers o ON o.id = t.offer_id
  `).all();

  const stamp = horodatageUtc(maintenant);
  const sortie = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Job Cockpit//Agenda//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Job Cockpit',
  ];

  const evenement = ({ uid, date, resume, description, lien, alarme }) => {
    sortie.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compacte(date)}`,
      `DTEND;VALUE=DATE:${lendemain(date)}`,
      `SUMMARY:${echapperTexte(resume)}`,
      `DESCRIPTION:${echapperTexte(description)}`,
      'TRANSP:TRANSPARENT',
    );
    if (lien) sortie.push(`URL:${String(lien).replace(/[\r\n]/g, '')}`);
    if (alarme) {
      // LA VEILLE AU SOIR : l'événement commence à minuit, six heures avant
      // tombe à 18 h le jour d'avant — le moment où l'on peut encore relire
      // sa fiche, pas celui où l'on dort.
      sortie.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'TRIGGER:-PT6H',
        `DESCRIPTION:${echapperTexte(alarme)}`,
        'END:VALARM',
      );
    }
    sortie.push('END:VEVENT');
  };

  for (const l of lignes) {
    const qui = [l.titre, l.entreprise].filter(Boolean).join(' — ');
    if (dateValide(l.entretien_date) && l.status !== 'Refus') {
      evenement({
        uid: `${l.id}-entretien@jobcockpit`,
        date: l.entretien_date,
        resume: `Entretien : ${qui}`,
        description: [qui, l.ville].filter(Boolean).join('\n'),
        lien: l.lien,
        alarme: `Entretien demain : ${qui}`,
      });
    }
    if (dateValide(l.relance_date) && (l.status === 'Envoyé' || l.status === 'Relancé')) {
      evenement({
        uid: `${l.id}-relance@jobcockpit`,
        date: l.relance_date,
        resume: `Relancer : ${qui}`,
        description: `Relance prévue pour la candidature ${qui}.`,
        lien: l.lien,
      });
    }
  }

  sortie.push('END:VCALENDAR');
  return sortie.map(replier).join('\r\n') + '\r\n';
}
