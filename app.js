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
let OFFEN  = {};        // welche Karten aufgeklappt sind
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

function zeichne() {
  $('#wochentag').textContent = WOCHENTAGE[TAG.getDay()];
  $('#datumText').textContent = langesDatum(TAG);
  zeichneHeute();
  zeichneWoche();
}

function zeichneHeute() {
  const box = $('#karten');

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

  box.innerHTML = (DATEN.kinder || []).map(k => karte(k, t.kinder[k.kuerzel])).join('');

  box.querySelectorAll('.karte-kopf').forEach(b => {
    b.addEventListener('click', () => {
      const karte = b.closest('.karte');
      const kind = karte.dataset.kind;
      OFFEN[kind] = !OFFEN[kind];
      karte.classList.toggle('offen', OFFEN[kind]);
      const s = karte.querySelector('.stunden');
      if (s) s.hidden = !OFFEN[kind];
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

function meldung(titel, text) {
  return '<div class="karte"><div class="karte-kopf">' +
         '<div class="frei-text">' + esc(titel) +
         (text ? '<span class="frei-grund">' + esc(text) + '</span>' : '') +
         '</div></div></div>';
}

function karte(kind, tag) {
  const k = kind.kuerzel;
  const offen = !!OFFEN[k];
  let kopf;

  if (tag && tag.schule) {
    kopf =
      '<div class="zeitenblock">' +
        feld('Bringen', tag.bringen) +
        feld('Abholen', tag.abholen) +
      '</div>';
  } else {
    const grund = tag ? (tag.grund || 'Kein Unterricht') : 'Keine Daten';
    kopf = '<div class="frei-text">Kein Unterricht' +
           '<span class="frei-grund">' + esc(grund) + '</span></div>';
  }

  const merker = tag && tag.quelle
    ? '<span class="merker">' +
      (tag.quelle === 'kalender' ? 'aus dem Kalender' : 'Ausnahme') +
      (tag.notiz ? ': ' + esc(tag.notiz) : '') + '</span>'
    : '';

  let stunden = '';
  if (tag && tag.stunden && tag.stunden.length) {
    const gibtBetreuung = tag.stunden.some(s => s.fach && !s.unterricht);
    stunden = '<div class="stunden"' + (offen ? '' : ' hidden') + '>' +
      tag.stunden.map(zeile).join('') +
      (gibtBetreuung
        ? '<p class="fussnote">Ausgegraut: Ganztagsangebot, ohne euer Kind.</p>'
        : '') +
      '</div>';
  }

  return '<div class="karte' + (offen ? ' offen' : '') + '" data-kind="' + k + '">' +
    '<button class="karte-kopf" type="button">' +
      '<div class="kind-spalte">' +
        '<div class="abzeichen">' + esc(k) + '</div>' +
        '<div class="klasse">' + esc(kind.klasse) + '</div>' +
      '</div>' +
      kopf +
      (stunden ? '<span class="pfeilchen">›</span>' : '') +
    '</button>' +
    (merker ? '<div style="padding:0 16px 14px">' + merker + '</div>' : '') +
    stunden +
  '</div>';
}

function feld(label, wert) {
  return '<dl class="zeitfeld"><dt>' + label + '</dt><dd>' + esc(wert) + '</dd></dl>';
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
$('#datumKnopf').addEventListener('click', () => { TAG = heute(); zeichne(); });

function springe(n) {
  TAG = plus(TAG, n);
  zeichne();
  if (!hatTag(TAG)) laden(TAG).catch(zeigeFehler);
}

// Wischen
let startX = null;
document.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
document.addEventListener('touchend', e => {
  if (startX === null || !$('#seiteHeute').hidden === false) { /* nur Heute */ }
  if (startX === null) return;
  const dx = e.changedTouches[0].clientX - startX;
  startX = null;
  if ($('#seiteHeute').hidden) return;
  if (Math.abs(dx) > 70) springe(dx < 0 ? 1 : -1);
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
