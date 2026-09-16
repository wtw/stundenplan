/* Schule — Web-App. Redet mit dem Apps-Script-Backend, cached offline. */

'use strict';

// ------------------------------------------------------------ Einstellungen --

const S = {
  url:   () => localStorage.getItem('schule.url')   || '',
  token: () => localStorage.getItem('schule.token') || '',
  setzen(url, token) {
    localStorage.setItem('schule.url', url.trim());
    localStorage.setItem('schule.token', token.trim());
  },
  cacheLesen() {
    try {
      const r = localStorage.getItem('schule.daten');
      return r ? JSON.parse(r) : null;
    } catch (e) { return null; }
  },
  cacheSchreiben(d) {
    try {
      localStorage.setItem('schule.daten', JSON.stringify(d));
      localStorage.setItem('schule.datenAt', new Date().toISOString());
    } catch (e) { /* voll oder gesperrt — nicht schlimm */ }
  },
  cacheAlter() {
    const a = localStorage.getItem('schule.datenAt');
    return a ? new Date(a) : null;
  }
};

// ------------------------------------------------------------------ Zustand --

let DATEN  = null;      // Antwort des Backends
let TAG    = heute();   // angezeigter Tag
let GEWAEHLT = null;    // Kind, dessen Stunden gerade angezeigt werden
let LAEUFT = false;

// -------------------------------------------------------------- Datumshilfen --

function heute() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
function iso(d) {
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}
function ausIso(s) {
  const t = s.split('-');
  return new Date(+t[0], +t[1] - 1, +t[2]);
}
function plus(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
function montagVon(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = (x.getDay() + 6) % 7;      // Mo = 0
  return plus(x, -wd);
}

/** 'HH:MM' -> Minuten seit Mitternacht */
function mn(hhmm) {
  const t = String(hhmm).split(':');
  return Number(t[0]) * 60 + Number(t[1]);
}

function dauerText(vonM, bisM) {
  const d = bisM - vonM;
  const h = Math.floor(d / 60), m = d % 60;
  return (h ? h + ' Std' : '') + (h && m ? ' ' : '') + (m ? m + ' Min' : '');
}

/** Abstand in Tagen zu heute. */
function abstand(d) {
  return Math.round((d - heute()) / 86400000);
}

/**
 * Was in der Kopfzeile über dem Datum steht. Für heute bewusst nur "HEUTE" —
 * das ist die Information, die man ohne Nachdenken erfassen soll.
 */
function tagesLabel(d) {
  const n = abstand(d);
  if (n === 0)  return 'Heute';
  if (n === -1) return 'Gestern';
  if (n === 1)  return 'Morgen';
  if (n === 2)  return 'Übermorgen';
  return WOCHENTAGE[d.getDay()];
}

const WOCHENTAGE = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
const KURZ       = ['So','Mo','Di','Mi','Do','Fr','Sa'];
const MONATE     = ['Januar','Februar','März','April','Mai','Juni','Juli',
                    'August','September','Oktober','November','Dezember'];

function langesDatum(d) {
  return d.getDate() + '. ' + MONATE[d.getMonth()] + ' ' + d.getFullYear();
}

// ------------------------------------------------------------------ Backend --

async function hole(von, tage) {
  if (!S.url() || !S.token()) throw new Error('Nicht eingerichtet');
  const u = new URL(S.url());
  u.searchParams.set('token', S.token());
  u.searchParams.set('von', iso(von));
  u.searchParams.set('tage', String(tage));
  const r = await fetch(u.toString(), { redirect: 'follow' });
  const j = await r.json();
  if (!j.ok) throw new Error(j.fehler || 'Unbekannter Fehler');
  return j.daten;
}

async function schicke(body) {
  if (!S.url() || !S.token()) throw new Error('Nicht eingerichtet');
  // text/plain vermeidet den CORS-Preflight, den Apps Script nicht beantwortet
  const r = await fetch(S.url(), {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ token: S.token() }, body))
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.fehler || 'Unbekannter Fehler');
  return j;
}

async function laden(zielDatum) {
  const von = plus(zielDatum || TAG, -3);
  try {
    LAEUFT = true;
    zeichne();
    DATEN = await hole(von, 35);
    S.cacheSchreiben(DATEN);
  } finally {
    LAEUFT = false;
  }
  zeichne();
}

function tagDaten(d) {
  if (!DATEN) return null;
  const k = iso(d);
  return DATEN.tage.find(t => t.datum === k) || null;
}

function hatTag(d) { return !!tagDaten(d); }

// ------------------------------------------------------------------ Zeichnen --

const $ = s => document.querySelector(s);

function zeichne(richtung) {
  const istHeute = abstand(TAG) === 0;

  $('#wochentag').textContent = tagesLabel(TAG);
  $('#datumText').textContent = langesDatum(TAG);

  const kopf = $('#kopf');
  kopf.classList.toggle('ist-heute', istHeute);
  kopf.classList.toggle('nicht-heute', !istHeute);

  const knopf = $('#zuHeute');
  knopf.hidden = istHeute;
  document.body.classList.toggle('mit-heute-knopf', !istHeute);
  if (!istHeute) {
    $('#zhPfeil').textContent = abstand(TAG) > 0 ? '‹' : '›';
  }

  zeichneHeute();
  zeichneWoche();
  if (richtung) {
    animiere($('#tagInhalt'), richtung);
    animiere($('#datumKnopf'), richtung);
  }
}

/** Kurzes Ein-Wischen, damit ein Tageswechsel sichtbar ist. */
function animiere(el, richtung) {
  if (!el) return;
  const klasse = richtung > 0 ? 'rein-r' : 'rein-l';
  el.classList.remove('rein-r', 'rein-l');
  void el.offsetWidth;                    // Neustart der Animation erzwingen
  el.classList.add(klasse);
  el.addEventListener('animationend', function weg() {
    el.classList.remove('rein-r', 'rein-l');
    el.removeEventListener('animationend', weg);
  });
}

const PX_STUNDE = 62;     // Pixel je Stunde in der Tafel
const MIN_HOEHE  = 210;

function zeichneHeute() {
  const box = $('#tagInhalt');

  if (!S.url() || !S.token()) {
    box.innerHTML = meldung('Noch nicht eingerichtet',
      'Trag unter Einstellungen die Apps-Script-URL und das Token ein.');
    $('#stand').textContent = '';
    return;
  }

  const t = tagDaten(TAG);
  if (!t) {
    box.innerHTML = meldung(
      LAEUFT ? 'Lädt …' : 'Keine Daten für diesen Tag',
      LAEUFT ? '' : 'Tipp auf das Datum, um zu heute zurückzuspringen.');
    return;
  }

  box.innerHTML = tagAnsicht(t);

  box.querySelectorAll('.spalte').forEach(function (b) {
    b.addEventListener('click', function () {
      const k = b.dataset.kind;
      GEWAEHLT = (GEWAEHLT === k) ? null : k;
      zeichneHeute();
    });
  });

  const unklar = (DATEN.unklar || []).filter(u => u.datum >= iso(heute()));
  const h = $('#hinweisUnklar');
  if (unklar.length) {
    h.hidden = false;
    h.textContent = 'Nicht verstanden: ' +
      unklar.map(u => '„' + u.titel + '“ (' + u.datum + ')').join(', ') +
      ' — prüf die Schreibweise.';
  } else {
    h.hidden = true;
  }

  const a = S.cacheAlter();
  $('#stand').textContent = a
    ? 'Stand: ' + a.toLocaleString('de-DE', { day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit' })
    : '';
}

/** Tafel + Hinweiszeile + gegebenenfalls die Stundenliste. */
function tagAnsicht(t) {
  const kinder = DATEN.kinder || [];
  const inSchule = kinder.filter(k => {
    const x = t.kinder[k.kuerzel];
    return x && x.schule;
  });

  // Niemand in der Schule: nur die Begründung zeigen
  if (!inSchule.length) {
    const x = t.kinder[kinder[0] && kinder[0].kuerzel] || {};
    return meldung('Kein Unterricht', x.grund || '');
  }

  const von = Math.min.apply(null, inSchule.map(k => mn(t.kinder[k.kuerzel].bringen)));
  const bis = Math.max.apply(null, inSchule.map(k => mn(t.kinder[k.kuerzel].abholen)));
  const hoehe = Math.max(MIN_HOEHE, (bis - von) / 60 * PX_STUNDE);
  const y = m => (m - von) / (bis - von) * hoehe;

  // Fallen Bring- oder Abholzeit zusammen?
  const gleichBringen = inSchule.length > 1 &&
    inSchule.every(k => t.kinder[k.kuerzel].bringen === t.kinder[inSchule[0].kuerzel].bringen);
  const gleichAbholen = inSchule.length > 1 &&
    inSchule.every(k => t.kinder[k.kuerzel].abholen === t.kinder[inSchule[0].kuerzel].abholen);

  // Die aktuelle Uhrzeit, falls heute und im Bild
  let jetztM = null;
  if (abstand(TAG) === 0) {
    const n = new Date();
    const m = n.getHours() * 60 + n.getMinutes();
    if (m >= von && m <= bis) jetztM = m;
  }

  // Besondere Zeiten bekommen eine eingefärbte Beschriftung statt einer
  // Sprechblase — die würde sonst über die Säulen ragen.
  const sonder = {};
  if (gleichBringen) sonder[von] = 'gleich';
  if (gleichAbholen) sonder[bis] = 'gleich';
  if (jetztM !== null) sonder[jetztM] = 'jetzt';

  const tick = (m, art) =>
    '<span class="tick' + (art ? ' tick-' + art : '') + '" style="top:' +
    y(m) + 'px">' + uhr(m) + '</span>';

  const nahAnSonder = m => Object.keys(sonder)
    .some(x => Math.abs(y(Number(x)) - y(m)) < 15);

  let ticks = tick(von, sonder[von]);
  let linien = '';
  for (let m = Math.ceil(von / 60) * 60; m < bis; m += 60) {
    if (m - von < 26 || bis - m < 26) continue;      // zu nah am Rand
    linien += '<div class="linie" style="top:' + y(m) + 'px"></div>';
    if (!nahAnSonder(m)) ticks += tick(m);
  }
  ticks += tick(bis, sonder[bis]);
  if (jetztM !== null && jetztM !== von && jetztM !== bis) {
    ticks += tick(jetztM, 'jetzt');
  }

  // Säulen
  const spalten = kinder.map(k => saeule(k, t.kinder[k.kuerzel], von, bis, hoehe, y)).join('');

  let marken = '';
  if (gleichBringen) marken += '<div class="gleich" style="top:' + y(von) + 'px"></div>';
  if (gleichAbholen) marken += '<div class="gleich" style="top:' + y(bis) + 'px"></div>';
  if (jetztM !== null) marken += '<div class="jetzt" style="top:' + y(jetztM) + 'px"></div>';

  const tafel =
    '<div class="tafel">' +
      '<div class="tafel-gitter" style="height:' + hoehe + 'px">' +
        '<div class="achse">' + ticks + '</div>' +
        '<div class="spalten" style="grid-template-columns:repeat(' + kinder.length + ',1fr)">' +
          '<div class="linien">' + linien + '</div>' +
          spalten + marken +
        '</div>' +
      '</div>' +
    '</div>';

  return tafel + zusammenZeile(t, inSchule, gleichBringen, gleichAbholen) +
         detailBlock(t) +
         (GEWAEHLT ? '' : '<p class="tipp">Tipp auf eine Säule für alle Stunden</p>');
}

function uhr(m) {
  const h = Math.floor(m / 60), r = m % 60;
  return ('0' + h).slice(-2) + ':' + ('0' + r).slice(-2);
}

function saeule(kind, tag, von, bis, hoehe, y) {
  const k = kind.kuerzel;
  const gewaehlt = GEWAEHLT === k;

  if (!tag || !tag.schule) {
    return '<button class="spalte" type="button" data-kind="' + k + '" ' +
             'aria-pressed="false" disabled>' +
             '<div class="saeule frei" style="top:0;height:' + hoehe + 'px">' +
               '<div class="mitte">' +
                 '<span class="wer">' + esc(k) + '</span>' +
                 '<span class="grund">' + esc((tag && tag.grund) || 'kein Unterricht') + '</span>' +
               '</div>' +
             '</div>' +
           '</button>';
  }

  const a = mn(tag.bringen), b = mn(tag.abholen);
  const top = y(a);
  const h   = Math.max(46, y(b) - y(a));
  const kompakt = h < 100 ? ' kompakt' : '';

  const anmerkung = tag.quelle
    ? '<span class="anmerkung">' +
      (tag.notiz ? esc(tag.notiz) : (tag.quelle === 'kalender' ? 'aus dem Kalender' : 'Ausnahme')) +
      '</span>'
    : '';

  return '<button class="spalte" type="button" data-kind="' + k + '" ' +
           'aria-pressed="' + (gewaehlt ? 'true' : 'false') + '">' +
           '<div class="saeule' + kompakt + '" style="top:' + top + 'px;height:' + h + 'px">' +
             '<span class="zeit-o">' + esc(tag.bringen) + '</span>' +
             '<span class="mitte">' +
               '<span class="wer">' + esc(k) + '</span>' +
               '<span class="wo">' + esc(kind.klasse) + '</span>' +
               '<span class="dauer">' + dauerText(a, b) + '</span>' +
               anmerkung +
             '</span>' +
             '<span class="zeit-u">' + esc(tag.abholen) + '</span>' +
           '</div>' +
         '</button>';
}

/** Die eine Zeile, die man morgens wirklich liest. */
function zusammenZeile(t, inSchule, gleichBringen, gleichAbholen) {
  if (inSchule.length < 2) return '';
  const erst = t.kinder[inSchule[0].kuerzel];

  const teile = [];
  if (gleichBringen) {
    teile.push('zusammen bringen um <b>' + esc(erst.bringen) + '</b>');
  }
  if (gleichAbholen) {
    teile.push('zusammen abholen um <b>' + esc(erst.abholen) + '</b>');
  }
  // Fallen keine Zeiten zusammen, sagen die Säulen alles Nötige.
  if (!teile.length) return '';
  return '<p class="zusammen">Heute ' + teile.join(' und ') + '.</p>';
}

function detailBlock(t) {
  if (!GEWAEHLT) return '';
  const tag = t.kinder[GEWAEHLT];
  if (!tag || !tag.stunden || !tag.stunden.length) return '';
  const kind = (DATEN.kinder || []).find(k => k.kuerzel === GEWAEHLT) || {};
  const gibtBetreuung = tag.stunden.some(s => s.fach && !s.unterricht);

  return '<div class="detail">' +
    '<div class="detail-kopf">' +
      '<span class="detail-punkt ' + GEWAEHLT.toLowerCase() + '"></span>' +
      esc(GEWAEHLT) + ' · ' + esc(kind.klasse || '') + ' · alle Stunden' +
    '</div>' +
    '<div class="karte"><div class="stunden">' +
      tag.stunden.map(zeile).join('') +
      (gibtBetreuung
        ? '<p class="fussnote">Ausgegraut: Ganztagsangebot, ohne euer Kind.</p>'
        : '') +
    '</div></div>' +
  '</div>';
}

function meldung(titel, text) {
  return '<div class="karte"><div class="karte-kopf">' +
         '<div class="frei-text">' + esc(titel) +
         (text ? '<span class="frei-grund">' + esc(text) + '</span>' : '') +
         '</div></div></div>';
}

function zeile(s) {
  const klassen = ['stunde'];
  if (s.entfaellt) klassen.push('entfaellt');
  else if (!s.unterricht) klassen.push('betreuung');
  const fach = s.fach || (s.entfaellt ? 'entfällt' : '—');
  return '<div class="' + klassen.join(' ') + '">' +
    '<span class="nr">' + (s.nr || '') + '</span>' +
    '<span class="zeit">' + s.von + '–' + s.bis + '</span>' +
    '<span class="fach">' + esc(fach) + '</span>' +
  '</div>';
}

function zeichneWoche() {
  const tab = $('#wocheTabelle');
  if (!DATEN) { tab.innerHTML = ''; return; }

  const kinder = DATEN.kinder || [];
  const start = montagVon(TAG);
  const hKey = iso(heute());

  let html = '<thead><tr><th>Tag</th>' +
    kinder.map(k => '<th>' + esc(k.kuerzel) + ' · ' + esc(k.klasse) + '</th>').join('') +
    '</tr></thead><tbody>';

  for (let w = 0; w < 2; w++) {
    for (let i = 0; i < 5; i++) {
      const d = plus(start, w * 7 + i);
      const t = tagDaten(d);
      const ist = iso(d) === hKey;
      html += '<tr' + (ist ? ' class="heute"' : '') + '>' +
        '<td class="tag">' + KURZ[d.getDay()] + ' ' + d.getDate() + '.' +
          (d.getMonth() + 1) + '.</td>' +
        kinder.map(k => {
          const x = t ? t.kinder[k.kuerzel] : null;
          const cls = k.kuerzel.toLowerCase();
          if (!x) return '<td class="' + cls + '"><span class="leer">—</span></td>';
          if (!x.schule) return '<td class="' + cls + '"><span class="leer">' +
                                esc(x.grund || 'frei') + '</span></td>';
          return '<td class="' + cls + '">' + x.bringen + ' – ' + x.abholen + '</td>';
        }).join('') +
      '</tr>';
    }
  }
  tab.innerHTML = html + '</tbody>';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

// ------------------------------------------------------------- Navigation --

document.querySelectorAll('.leiste button').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.leiste button').forEach(x => x.classList.remove('aktiv'));
    b.classList.add('aktiv');
    ['Heute','Woche','Ausnahme','Setup'].forEach(n => {
      $('#seite' + n).hidden = (n !== b.dataset.seite);
    });
    if (b.dataset.seite === 'Ausnahme') ausnahmeVorbereiten();
  });
});

$('#zurueck').addEventListener('click', () => springe(-1));
$('#vor').addEventListener('click',     () => springe(1));
function zurueckZuHeute() {
  const richtung = TAG < heute() ? 1 : (TAG > heute() ? -1 : 0);
  TAG = heute();
  GEWAEHLT = null;
  zeichne(richtung);
  if (!hatTag(TAG)) laden(TAG).catch(zeigeFehler);
}

$('#datumKnopf').addEventListener('click', zurueckZuHeute);
$('#zuHeute').addEventListener('click', zurueckZuHeute);

// Die Jetzt-Linie soll mitwandern, solange heute zu sehen ist.
setInterval(function () {
  if (document.hidden) return;
  if (abstand(TAG) !== 0) return;
  if ($('#seiteHeute').hidden) return;
  zeichneHeute();
}, 60000);

function springe(n) {
  TAG = plus(TAG, n);
  GEWAEHLT = null;
  zeichne(n);
  if (!hatTag(TAG)) laden(TAG).catch(zeigeFehler);
}

// Wischen — nur auf der Heute-Seite, und nur waagerecht
let startX = null, startY = null;
document.addEventListener('touchstart', e => {
  startX = e.touches[0].clientX;
  startY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', e => {
  if (startX === null || $('#seiteHeute').hidden) { startX = null; return; }
  const dx = e.changedTouches[0].clientX - startX;
  const dy = e.changedTouches[0].clientY - startY;
  startX = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) {
    springe(dx < 0 ? 1 : -1);
  }
}, { passive: true });

// --------------------------------------------------------------- Ausnahme --

function ausnahmeVorbereiten() {
  $('#axDatum').value = iso(TAG);
  const box = $('#axKinder');
  if (!box.children.length && DATEN) {
    box.innerHTML = DATEN.kinder.map(k =>
      '<label class="chip"><input type="checkbox" name="kind" value="' + k.kuerzel +
      '"><span>' + esc(k.kuerzel) + ' · ' + esc(k.klasse) + '</span></label>').join('');
  }
  typFelder();
}

function typFelder() {
  const typ = document.querySelector('input[name="typ"]:checked').value;
  $('#labelVon').hidden = !(typ === 'ab' || typ === 'zeit');
  $('#labelBis').hidden = !(typ === 'bis' || typ === 'zeit');
}
document.querySelectorAll('input[name="typ"]').forEach(r =>
  r.addEventListener('change', typFelder));

function gewaehlteKinder() {
  return [...document.querySelectorAll('#axKinder input:checked')].map(i => i.value);
}

$('#ausnahmeForm').addEventListener('submit', async e => {
  e.preventDefault();
  const kinder = gewaehlteKinder();
  const st = $('#axStatus');
  if (!kinder.length) return setzeStatus(st, 'Bitte mindestens ein Kind wählen.', 'fehler');

  const typ = document.querySelector('input[name="typ"]:checked').value;
  const von = $('#axVon').value || null;
  const bis = $('#axBis').value || null;
  if ((typ === 'ab' || typ === 'zeit') && !von) return setzeStatus(st, 'Startzeit fehlt.', 'fehler');
  if ((typ === 'bis' || typ === 'zeit') && !bis) return setzeStatus(st, 'Endzeit fehlt.', 'fehler');

  setzeStatus(st, 'Speichert und gleicht den Kalender ab …');
  $('#axSpeichern').disabled = true;
  try {
    let letzte = null;
    for (const k of kinder) {
      letzte = await schicke({
        aktion: 'ausnahme', kind: k, datum: $('#axDatum').value,
        typ, von, bis, notiz: $('#axNotiz').value || null
      });
    }
    DATEN = letzte.daten;
    S.cacheSchreiben(DATEN);
    TAG = ausIso($('#axDatum').value);
    zeichne();
    setzeStatus(st, 'Gespeichert. Der Kalender ist aktualisiert.', 'gut');
  } catch (err) {
    setzeStatus(st, 'Fehler: ' + err.message, 'fehler');
  } finally {
    $('#axSpeichern').disabled = false;
  }
});

$('#axLoeschen').addEventListener('click', async () => {
  const kinder = gewaehlteKinder();
  const st = $('#axStatus');
  if (!kinder.length) return setzeStatus(st, 'Bitte mindestens ein Kind wählen.', 'fehler');
  setzeStatus(st, 'Entfernt …');
  try {
    let letzte = null;
    for (const k of kinder) {
      letzte = await schicke({ aktion: 'ausnahmeWeg', kind: k, datum: $('#axDatum').value });
    }
    DATEN = letzte.daten;
    S.cacheSchreiben(DATEN);
    zeichne();
    setzeStatus(st, 'Entfernt. Hinweis: Einträge, die du direkt im Kalender ' +
                    'angelegt hast, musst du dort löschen.', 'gut');
  } catch (err) {
    setzeStatus(st, 'Fehler: ' + err.message, 'fehler');
  }
});

function setzeStatus(el, text, art) {
  el.textContent = text;
  el.className = 'status' + (art ? ' ' + art : '');
}

// ---------------------------------------------------------- Einstellungen --

$('#cfgUrl').value   = S.url();
$('#cfgToken').value = S.token();

$('#setupForm').addEventListener('submit', async e => {
  e.preventDefault();
  S.setzen($('#cfgUrl').value, $('#cfgToken').value);
  setzeStatus($('#cfgStatus'), 'Lädt …');
  try {
    await laden(heute());
    setzeStatus($('#cfgStatus'), 'Verbunden.', 'gut');
  } catch (err) {
    setzeStatus($('#cfgStatus'), 'Fehler: ' + err.message, 'fehler');
  }
});

$('#cfgSync').addEventListener('click', async () => {
  setzeStatus($('#cfgStatus'), 'Gleicht ab, das kann eine Minute dauern …');
  try {
    const r = await schicke({ aktion: 'sync' });
    DATEN = r.daten;
    S.cacheSchreiben(DATEN);
    zeichne();
    const b = r.bilanz || {};
    setzeStatus($('#cfgStatus'),
      'Fertig: ' + (b.neu || 0) + ' neu, ' + (b.geaendert || 0) + ' geändert, ' +
      (b.geloescht || 0) + ' gelöscht.', 'gut');
  } catch (err) {
    setzeStatus($('#cfgStatus'), 'Fehler: ' + err.message, 'fehler');
  }
});

function zeigeFehler(err) {
  console.warn(err);
  const a = S.cacheAlter();
  $('#stand').textContent = a
    ? 'Offline — Stand: ' + a.toLocaleString('de-DE')
    : 'Keine Verbindung.';
}

// ------------------------------------------------------------------ Start --

DATEN = S.cacheLesen();
zeichne();
if (S.url() && S.token()) laden(heute()).catch(zeigeFehler);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.url() && S.token()) laden(TAG).catch(zeigeFehler);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('sw.js').catch(() => {}));
}
