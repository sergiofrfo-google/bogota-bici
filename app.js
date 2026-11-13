// Bogotá Bici v0.5: a static app, no build step and no API keys.
// Free services called straight from the browser:
//   BRouter (routing, OSM way tags, turn hints), Nominatim / Photon (place search and street names),
//   IDU map server via IDECA (official ciclorruta network), Overpass (bike shops, pumps),
//   OpenFreeMap (base map, falls back to OSM raster tiles).
// Community reports are stored in this browser only until a Supabase project exists.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtKm = (m) => dec(m / 1000) + ' km';
const fmtM = (m) => (m < 950 ? Math.max(10, Math.round(m / 10) * 10) + ' m' : fmtKm(m));
const fmtMin = (s) => { const m = Math.max(1, Math.round(s / 60)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const clock = (d) => d.toLocaleTimeString(LANG === 'en' ? 'en-US' : 'es-CO', { hour: 'numeric', minute: '2-digit' });
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const QS = new URLSearchParams(location.search);
const SIM = QS.has('sim'); // ?sim=1 replays the route instead of using GPS (for testing navigation at a desk)

const BOGOTA = [-74.0721, 4.6611];
const BBOX = { w: -74.25, s: 4.45, e: -73.98, n: 4.85 };
const TYPES = {
  ex: { get label() { return L('Ciclorruta exclusiva'); }, get short() { return L('Exclusiva'); }, color: '#0B5D52' },
  sh: { get label() { return L('Compartida con peatones'); }, get short() { return L('Con peatones'); }, color: '#3B82C4' },
  pa: { get label() { return L('Carril pintado'); }, get short() { return L('Pintado'); }, color: '#E8A33D' },
  ca: { get label() { return L('Con carros'); }, get short() { return L('Con carros'); }, color: '#C2410C' },
};
const ORDER = ['ex', 'sh', 'pa', 'ca'];
const MODES = {
  infra: { get label() { return L('Más ciclorruta'); }, profile: 'safety' },
  balanced: { get label() { return L('Equilibrada'); }, profile: 'trekking' },
  fast: { get label() { return L('Más rápida'); }, profile: 'fastbike' },
};
const MODE_KEYS = Object.keys(MODES);
const PACE = { calm: { get label() { return L('Tranquilo'); }, f: 1.2 }, normal: { get label() { return L('Normal'); }, f: 1 }, quick: { get label() { return L('Rápido'); }, f: 0.85 } };

const ICONS = {
  warn: '<svg viewBox="0 0 24 24"><path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
  go: '<svg viewBox="0 0 24 24"><path d="M12 2l7 19-7-4-7 4 7-19z" fill="currentColor"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3z"/></svg>',
  alt: '<svg viewBox="0 0 24 24"><path d="M6 20V9a5 5 0 0 1 5-5h7M15 1l3 3-3 3"/><path d="M18 20v-6"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
  overview: '<svg viewBox="0 0 24 24"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>',
  via: '<svg viewBox="0 0 24 24"><path d="M4 20c4-8 12-2 16-14"/><rect x="10" y="10.5" width="5" height="5" rx="1" transform="rotate(45 12.5 13)" fill="currentColor"/></svg>',
  locate: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  round: '<svg viewBox="0 0 24 24"><circle cx="12" cy="10" r="4"/><path d="M12 22v-8M15 7l4-4M16 3h3v3"/></svg>',
  wrench: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6z"/></svg>',
  tyre: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v5M12 16v5M3 12h5M16 12h5"/></svg>',
  pump: '<svg viewBox="0 0 24 24"><path d="M8 21V7h6v5H8"/><path d="M14 9h3l2 3v6"/></svg>',
  pothole: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="14" rx="9" ry="4"/><path d="M7 13.5c1.5 1 3 1.2 5 1.2s3.5-.3 5-1.2"/></svg>',
  closure: '<svg viewBox="0 0 24 24"><path d="M3 10h18v5H3z"/><path d="M6 15v5M18 15v5M7 10l3-5M14 10l3-5"/></svg>',
  missing: '<svg viewBox="0 0 24 24"><path d="M3 12h6M15 12h6"/><path d="M10 9l4 6M14 9l-4 6"/></svg>',
  theft: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  other: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18" cy="12" r="1"/></svg>',
};
const REPORT_TYPES = {
  pothole: { get label() { return L('Hueco'); }, icon: ICONS.pothole },
  closure: { get label() { return L('Obra o cierre'); }, icon: ICONS.closure },
  missing: { get label() { return L('Falta conexión'); }, icon: ICONS.missing },
  danger: { get label() { return L('Cruce peligroso'); }, icon: ICONS.warn },
  theft: { get label() { return L('Robo frecuente'); }, icon: ICONS.theft },
  other: { get label() { return L('Otro'); }, icon: ICONS.other },
};

// ---------------------------------------------------------------- state
const S = {
  A: null, B: null,          // { lng, lat, label }
  routes: { infra: null, balanced: null, fast: null },
  alt: { infra: 0, balanced: 0, fast: 0 },
  mode: MODES[QS.get('m')] ? QS.get('m') : 'infra',
  view: null,                // see VIEWS
  snap: 'peek',              // bottom sheet: 'peek' | 'half' | 'full'
  layers: { idu: true, reports: true },
  prefs: LS.get('bb_prefs', { pace: 'normal', voice: true }),
  saved: LS.get('bb_saved', []),
  reports: loadReports(),
  draftType: 'pothole',
  current: null,             // report or place being shown
  stepsTab: 'tramos',        // 'tramos' | 'turns'
  sel: null,                 // selected row in the steps view
  fit: null,                 // coordinates the map is fitted to (refit when the sheet moves)
  names: new Map(),          // stretch name cache
  errorMsg: '',
};
const markers = { A: null, B: null, reports: [], services: [] };
let map, geoCtl;
const cur = () => S.routes[S.mode];
const pace = () => (PACE[S.prefs.pace] || PACE.normal).f;
const wide = () => innerWidth >= 900;

// ---------------------------------------------------------------- helpers
function toast(msg, ms = 3500) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}
async function fetchT(url, opts = {}, ms = 15000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(t); }
}
function dist(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// project p onto segment a-b (flat approximation, fine at city scale)
function proj(p, a, b) {
  const kx = 111320 * Math.cos(p[1] * Math.PI / 180), ky = 110540;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
  return { t, d: Math.hypot(ax + t * dx, ay + t * dy), p: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] };
}
function distToLine(p, coords) {
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) best = Math.min(best, proj(p, coords[i], coords[i + 1]).d);
  if (coords.length === 1) best = dist(p, coords[0]);
  return best;
}
function bearing(a, b) {
  const r = Math.PI / 180, y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
function pinEl(cls, html) {
  const d = document.createElement('div');
  d.className = 'pin ' + cls; d.innerHTML = html; return d;
}
function lineLength(coords) { let d = 0; for (let i = 1; i < coords.length; i++) d += dist(coords[i - 1], coords[i]); return d; }
function pointAlong(coords, frac) {
  const target = lineLength(coords) * frac;
  let d = 0;
  for (let i = 1; i < coords.length; i++) {
    const s = dist(coords[i - 1], coords[i]);
    if (d + s >= target) { const t = s ? (target - d) / s : 0; return [coords[i - 1][0] + t * (coords[i][0] - coords[i - 1][0]), coords[i - 1][1] + t * (coords[i][1] - coords[i - 1][1])]; }
    d += s;
  }
  return coords[coords.length - 1];
}
// point at a given distance along a parsed route
function pointAtDist(r, d) {
  d = Math.max(0, Math.min(r.cum[r.cum.length - 1], d));
  let lo = 0, hi = r.cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (r.cum[mid] <= d) lo = mid; else hi = mid; }
  const s = r.cum[hi] - r.cum[lo], t = s ? (d - r.cum[lo]) / s : 0;
  const a = r.coords[lo], b = r.coords[hi];
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}
function sliceByDist(r, d0, d1) {
  const out = [pointAtDist(r, d0)];
  for (let i = 0; i < r.coords.length; i++) if (r.cum[i] > d0 && r.cum[i] < d1) out.push(r.coords[i]);
  out.push(pointAtDist(r, d1));
  return out;
}

// ---------------------------------------------------------------- path types from OSM tags
function classify(tagStr) {
  const t = {};
  for (const kv of tagStr.split(' ')) { const i = kv.indexOf('='); if (i > 0) t[kv.slice(0, i)] = kv.slice(i + 1); }
  const hw = t.highway || '';
  const yes = (v) => ['yes', 'designated', 'permissive'].includes(v);
  if (hw === 'cycleway') return yes(t.foot) && t.segregated !== 'yes' ? 'sh' : 'ex';
  if (['footway', 'path', 'pedestrian', 'steps', 'track', 'bridleway', 'corridor'].includes(hw)) return 'sh';
  const cw = ['cycleway', 'cycleway:right', 'cycleway:left', 'cycleway:both'].map((k) => t[k]).filter(Boolean);
  if (cw.includes('track')) return 'ex';
  if (cw.some((v) => v === 'lane' || v === 'opposite_lane')) return 'pa';
  return 'ca';
}

// ---------------------------------------------------------------- routing (BRouter)
let routeSeq = 0;
async function brouter(profile, pts, alt = 0) {
  const ll = pts.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join('|');
  const res = await fetchT(`https://brouter.de/brouter?lonlats=${ll}&profile=${profile}&alternativeidx=${alt}&format=geojson&timode=2`, {}, 30000);
  const text = await res.text();
  if (!res.ok || !text.startsWith('{')) throw new Error(text.slice(0, 200) || `BRouter ${res.status}`);
  return parseRoute(JSON.parse(text));
}
function parseRoute(gj) {
  const f = gj.features[0];
  const coords = f.geometry.coordinates.map((c) => [c[0], c[1]]);
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + dist(coords[i - 1], coords[i]));
  const msgs = f.properties.messages;
  const H = msgs[0], iTags = H.indexOf('WayTags'), iDist = H.indexOf('Distance');
  const segs = []; // { t, d, i0, i1, coords }
  let from = 0;
  for (let k = 1; k < msgs.length; k++) {
    const lon = +msgs[k][0] / 1e6, lat = +msgs[k][1] / 1e6;
    let j = from;
    while (j < coords.length - 1 && !(Math.abs(coords[j][0] - lon) < 2e-6 && Math.abs(coords[j][1] - lat) < 2e-6)) j++;
    if (k === msgs.length - 1) j = coords.length - 1;
    const t = classify(msgs[k][iTags] || '');
    const d = +msgs[k][iDist] || 0;
    if (j > from) {
      const last = segs[segs.length - 1];
      if (last && last.t === t) { last.d += d; last.i1 = j; last.coords.push(...coords.slice(from + 1, j + 1)); }
      else segs.push({ t, d, i0: from, i1: j, coords: coords.slice(from, j + 1) });
    } else if (segs.length) segs[segs.length - 1].d += d;
    from = j;
  }
  const length = +f.properties['track-length'];
  const totals = { ex: 0, sh: 0, pa: 0, ca: 0 };
  for (const s of segs) totals[s.t] += s.d;
  const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  const pct = {};
  for (const k of ORDER) pct[k] = Math.round((totals[k] / sum) * 100);
  // turn instructions from BRouter voice hints: [coordIndex, command, roundaboutExit, distance, angle]
  const man = [];
  for (const v of f.properties.voicehints || []) {
    const [i, cmd, exit, , angle] = v.map(Number);
    if (!(i > 0 && i < coords.length - 1)) continue;
    if (exit > 0 || cmd === 8 || cmd === 9 || Math.abs(angle) >= 25) man.push({ i, cmd, exit, angle, at: cum[i] });
  }
  man.push({ i: coords.length - 1, arrive: true, at: cum[cum.length - 1] });
  const times = (f.properties.times || []).map(Number);
  return {
    id: ++routeSeq, coords, cum, segs, totals, pct, length, man,
    times: times.length === coords.length ? times : null,
    time: +f.properties['total-time'],
    ascend: +f.properties['filtered ascend'] || 0,
    noCars: 100 - pct.ca,
  };
}
const rTime = (r) => r.time * pace();

async function computeRoutes() {
  if (!S.A || !S.B) return;
  S.routes = { infra: null, balanced: null, fast: null };
  S.alt = { infra: 0, balanced: 0, fast: 0 };
  S.sel = null;
  drawRoutes();
  show('loading');
  const res = await Promise.allSettled(MODE_KEYS.map((k) => brouter(MODES[k].profile, wp())));
  res.forEach((r, i) => { if (r.status === 'fulfilled') S.routes[MODE_KEYS[i]] = r.value; });
  if (!MODE_KEYS.some((k) => S.routes[k])) {
    console.error(res);
    S.errorMsg = String(res[0].reason?.message || res[0].reason || 'Error');
    show('error');
    return;
  }
  if (!cur()) S.mode = MODE_KEYS.find((k) => S.routes[k]);
  show('route');
  drawRoutes(true);
}
async function nextAlternative() {
  const k = S.mode;
  const idx = (S.alt[k] + 1) % 4;
  toast(L('Buscando otra alternativa…'), 2000);
  try {
    const r = await brouter(MODES[k].profile, wp(), idx);
    const same = S.routes[k] && Math.abs(r.length - S.routes[k].length) < 30;
    S.alt[k] = idx; S.routes[k] = r; S.sel = null;
    show('route'); drawRoutes(true);
    if (same) toast(L('Esta alternativa es casi igual a la anterior.'));
  } catch { toast(L('No hay más alternativas para esta ruta.')); }
}

function routeFC(r) {
  return { type: 'FeatureCollection', features: r ? r.segs.map((s) => ({ type: 'Feature', properties: { t: s.t, color: TYPES[s.t].color }, geometry: { type: 'LineString', coordinates: s.coords } })) : [] };
}
function drawRoutes(fit) {
  if (!map?.getSource('route')) return;
  const main = cur();
  const alts = MODE_KEYS.filter((k) => k !== S.mode && S.routes[k] && (!main || Math.abs(S.routes[k].length - main.length) > 30));
  map.getSource('route-alt').setData({
    type: 'FeatureCollection',
    features: alts.map((k) => ({ type: 'Feature', properties: { mode: k }, geometry: { type: 'LineString', coordinates: S.routes[k].coords } })),
  });
  map.getSource('route').setData(routeFC(main));
  highlight(null);
  if (fit && main) fitTo(main.coords);
}
function highlight(coords) {
  map?.getSource('hl')?.setData({ type: 'FeatureCollection', features: coords ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] : [] });
}

// ---------------------------------------------------------------- fitting the map into the area the sheet leaves visible
function visibleBox() {
  const topEl = N.on ? $('navTop') : $('quick');
  const top = topEl.getBoundingClientRect().bottom;
  let bottom = 0;
  if (N.on) bottom = $('navBottom').offsetHeight;
  else if (!$('sheet').hidden && !wide()) bottom = parseFloat($('sheet').style.height) || $('sheet').offsetHeight;
  return { top, bottom };
}
function fitTo(coords, opts = {}) {
  if (!coords?.length) return;
  S.fit = coords;
  const b = new maplibregl.LngLatBounds();
  coords.forEach((c) => b.extend(c));
  const p0 = map.getPadding();
  if (p0.top || p0.bottom || p0.left || p0.right) map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
  let pad;
  if (wide() && !N.on) pad = { top: 60, bottom: 60, left: 470, right: 80 };
  else {
    const v = visibleBox();
    pad = { top: v.top + 28, bottom: v.bottom + 28, left: 36, right: N.on ? 36 : 68 };
    if (innerHeight - pad.top - pad.bottom < 90) pad.bottom = Math.max(10, innerHeight - pad.top - 90);
  }
  map.fitBounds(b, { padding: pad, maxZoom: opts.maxZoom || 17, duration: 500, bearing: 0, pitch: 0 });
}

// ---------------------------------------------------------------- bottom sheet (peek / half / full, draggable)
const GRAB = 24;
function sheetHeights() {
  const body = $('sheetBody');
  const content = GRAB + body.scrollHeight;
  const peekEl = body.querySelector('[data-peek]');
  const peek = Math.min(content, peekEl ? GRAB + peekEl.offsetTop + peekEl.offsetHeight + 14 : 180);
  const half = Math.max(peek, Math.min(content, Math.round(innerHeight * 0.52)));
  const full = Math.max(half, Math.min(content, innerHeight - 64));
  return { peek, half, full };
}
function setSnap(s) {
  S.snap = s;
  const el = $('sheet');
  el.dataset.snap = s;
  if (wide()) { el.style.height = ''; return; }
  const h = sheetHeights()[s];
  el.style.height = h + 'px';
  document.body.classList.toggle('sheet-full', s === 'full' && h > innerHeight - $('quick').getBoundingClientRect().bottom - 8);
  $('sheetBody').style.overflowY = s === 'full' || sheetHeights().full === sheetHeights()[s] ? 'auto' : 'hidden';
  afterSheetMove();
}
function afterSheetMove() {
  placePin();
  clearTimeout(afterSheetMove.t);
  afterSheetMove.t = setTimeout(() => { placePin(); if (S.fit && !N.on) fitTo(S.fit, { maxZoom: S.fitMaxZoom }); }, 280);
}
function wireSheetDrag() {
  const el = $('sheet'), body = $('sheetBody');
  let st = null;
  el.addEventListener('touchstart', (e) => {
    if (wide() || e.touches.length > 1) { st = null; return; }
    const y = e.touches[0].clientY;
    st = { y, x: e.touches[0].clientX, h: el.offsetHeight, grab: !!e.target.closest('.grab'), mode: null, lastY: y, lastT: performance.now(), vy: 0 };
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!st) return;
    const y = e.touches[0].clientY, dy = y - st.y, dx = e.touches[0].clientX - st.x;
    if (!st.mode) {
      if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
      st.H = sheetHeights();
      if (Math.abs(dx) > Math.abs(dy)) st.mode = 'none';
      else if (st.grab) st.mode = 'drag';
      else if (dy < 0) st.mode = st.h < st.H.full - 2 ? 'drag' : 'scroll';
      else st.mode = body.scrollTop <= 0 ? 'drag' : 'scroll';
      if (st.mode === 'drag') el.classList.add('dragging');
    }
    if (st.mode !== 'drag') return;
    if (e.cancelable) e.preventDefault();
    el.style.height = Math.max(st.H.peek * 0.7, Math.min(st.H.full, st.h - dy)) + 'px';
    const now = performance.now();
    st.vy = (y - st.lastY) / Math.max(1, now - st.lastT); st.lastY = y; st.lastT = now;
  }, { passive: false });
  const end = () => {
    if (!st) return;
    const s = st; st = null;
    if (s.mode !== 'drag') return;
    el.classList.remove('dragging');
    const h = el.offsetHeight, H = s.H;
    let snap;
    if (s.vy > 0.4) snap = h > H.half + 4 ? 'half' : 'peek';
    else if (s.vy < -0.4) snap = h < H.half - 4 ? 'half' : 'full';
    else snap = ['peek', 'half', 'full'].sort((a, b) => Math.abs(h - H[a]) - Math.abs(h - H[b]))[0];
    setSnap(snap);
  };
  el.addEventListener('touchend', end);
  el.addEventListener('touchcancel', end);
  el.querySelector('.grab').addEventListener('click', () => setSnap(S.snap === 'peek' ? 'half' : 'peek'));
  addEventListener('resize', () => { if (!$('sheet').hidden) setSnap(S.snap); });
}

// ---------------------------------------------------------------- points A / B
function makeMarker(which, p) {
  if (markers[which]) markers[which].remove();
  const m = new maplibregl.Marker({ element: pinEl(which.toLowerCase(), which), draggable: true }).setLngLat([p.lng, p.lat]).addTo(map);
  m.on('dragend', () => setPoint(which, m.getLngLat()));
  markers[which] = m;
}
function setPoint(which, lngLat, label) {
  S[which] = { lng: lngLat.lng, lat: lngLat.lat, label: label || L('Punto en el mapa') };
  makeMarker(which, S[which]);
  $(which === 'A' ? 'from' : 'to').value = S[which].label;
  if (!label) reverseName(lngLat).then((n) => { if (n && S[which] && S[which].lng === lngLat.lng) { S[which].label = n; $(which === 'A' ? 'from' : 'to').value = n; } });
  document.body.classList.toggle('has-route', !!(S.A && S.B));
  if (S.A && S.B) computeRoutes();
  else toast(which === 'A' ? L('Ahora elige el destino: búscalo o toca el mapa.') : L('Ahora elige el origen.'));
}
function clearAll() {
  for (const w of ['A', 'B']) { if (markers[w]) markers[w].remove(); markers[w] = null; S[w] = null; }
  clearVia(false);
  $('from').value = ''; $('to').value = '';
  S.routes = { infra: null, balanced: null, fast: null };
  S.fit = null;
  document.body.classList.remove('has-route');
  drawRoutes(); show(S.saved.length ? 'home' : null);
}

// ---------------------------------------------------------------- Nominatim (1 request per second, shared queue)
// One scheduler for every Nominatim call so searches and name lookups never share a second.
// Searches go to the front of the line; street-name lookups wait behind them.
const nomCache = new Map();
const nomJobs = { hi: [], lo: [] };
let nomBusy = false;
function nomRun() {
  if (nomBusy) return;
  const job = nomJobs.hi.shift() || nomJobs.lo.shift();
  if (!job) return;
  nomBusy = true;
  job().finally(() => setTimeout(() => { nomBusy = false; nomRun(); }, 1100));
}
function nomEnqueue(fn, hi) {
  return new Promise((ok, fail) => {
    nomJobs[hi ? 'hi' : 'lo'].push(() => fn().then(ok, fail));
    nomRun();
  });
}
function nomSearch(url) {
  return nomEnqueue(async () => {
    const r = await fetchT(url, {}, 12000);
    if (r.status === 429) throw new Error('busy');
    if (!r.ok) throw new Error('Nominatim ' + r.status);
    return r.json();
  }, true);
}
function nomReverse(lat, lng, zoom, poly) {
  const k = `${zoom}${poly ? 'p' : ''}:${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (nomCache.has(k)) return nomCache.get(k);
  const p = nomEnqueue(async () => {
    try {
      const r = await fetchT(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}&zoom=${zoom}&accept-language=es${poly ? '&polygon_geojson=1&polygon_threshold=0.00003' : ''}`, {}, 8000);
      return await r.json();
    } catch { return null; }
  }, false);
  nomCache.set(k, p);
  return p;
}
const roadOf = (j) => { const a = j?.address || {}; return a.road || a.pedestrian || a.cycleway || a.footway || a.path || null; };
function geoDist(p, g) {
  if (!g) return Infinity;
  const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' || g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : g.type === 'Point' ? [[g.coordinates]] : [];
  return Math.min(Infinity, ...lines.map((l) => distToLine(p, l)));
}
async function reverseName(ll) {
  const j = await nomReverse(ll.lat, ll.lng, 18, false);
  const a = j?.address || {};
  const road = roadOf(j);
  return road ? `${road}${a.house_number ? ' ' + a.house_number : ''}` : (j?.name || null);
}
// Name of the street a point on the route runs along. A major avenue wins only if the
// point really lies on it (cycleways beside avenues are often unnamed in OSM).
async function streetAt([lng, lat]) {
  const major = await nomReverse(lat, lng, 16, true);
  const n = roadOf(major);
  if (n && geoDist([lng, lat], major.geojson) < 35) return n;
  const minor = await nomReverse(lat, lng, 17, true);
  const m = roadOf(minor);
  if (m && geoDist([lng, lat], minor.geojson) < 35) return m;
  return null;
}
async function tramoName(s) {
  const k = key(s);
  if (S.names.has(k)) return S.names.get(k);
  const n = s.d > 1500 ? 3 : 1;
  const found = [];
  for (let q = 1; q <= n; q++) { const nm = await streetAt(pointAlong(s.coords, q / (n + 1))); if (nm) found.push(nm); }
  let name = null;
  if (found.length) {
    const count = new Map(); found.forEach((x) => count.set(x, (count.get(x) || 0) + 1));
    const top = [...count].sort((a, b) => b[1] - a[1])[0];
    name = top[1] > 1 || count.size === 1 ? top[0] : `${found[0]} → ${found[found.length - 1]}`;
  }
  S.names.set(k, name || null);
  return tramoLabel(s);
}
async function turnName(r, m) {
  if (m.arrive) return null;
  const k = 'turn:' + pointAtDist(r, m.at + 25).map((x) => x.toFixed(4)).join(',');
  if (S.names.has(k)) return S.names.get(k);
  const n = await streetAt(pointAtDist(r, m.at + 25));
  S.names.set(k, n);
  return n;
}

// ---------------------------------------------------------------- "Pasar por": a street or a point the route must go through
// S.via = { label, street: bool, pts: [[lng, lat], ...] }. A street becomes an entry point (closest to A),
// an exit point (closest to B) and points every ~2 km between them, so the route rides along it.
const wp = () => [[S.A.lng, S.A.lat], ...(S.via?.pts || []), [S.B.lng, S.B.lat]];
function nearestOnLines(p, lines) {
  let best = { d: Infinity, p: null };
  for (const l of lines) for (let i = 0; i < l.length - 1; i++) { const q = proj(p, l[i], l[i + 1]); if (q.d < best.d) best = q; }
  return best;
}
async function streetLines(name) {
  const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(name)}&viewbox=${BBOX.w},${BBOX.n},${BBOX.e},${BBOX.s}&bounded=1&limit=40&dedupe=0&countrycodes=co&polygon_geojson=1&polygon_threshold=0.00005&accept-language=es`;
  const j = await nomSearch(u);
  const roads = j.filter((r) => r.category === 'highway' && r.geojson);
  if (!roads.length) return [];
  const main = roads[0].name;
  const lines = [];
  for (const r of roads.filter((x) => x.name === main)) {
    const g = r.geojson;
    if (g.type === 'LineString') lines.push(g.coordinates);
    else if (g.type === 'MultiLineString') lines.push(...g.coordinates);
  }
  return lines;
}
async function streetVia(name) {
  const lines = await streetLines(name);
  if (!lines.length) return null;
  const A = [S.A.lng, S.A.lat], B = [S.B.lng, S.B.lat];
  const entry = nearestOnLines(A, lines).p, exit = nearestOnLines(B, lines).p;
  if (dist(entry, exit) < 400) {
    // short street: the single point with the smallest detour
    let best = null, bestD = Infinity;
    for (const l of lines) for (const q of l) { const d = dist(A, q) + dist(q, B); if (d < bestD) { bestD = d; best = q; } }
    return [best];
  }
  const pts = [entry];
  // dense enough (every ~800 m) that the router can't leave the street between two points for long
  const n = Math.floor(dist(entry, exit) / 800);
  for (let k = 1; k <= n; k++) {
    const t = k / (n + 1), target = [entry[0] + t * (exit[0] - entry[0]), entry[1] + t * (exit[1] - entry[1])];
    const q = nearestOnLines(target, lines);
    if (q.d < 1500) pts.push(q.p);
  }
  pts.push(exit);
  return pts.filter((q, i) => i === 0 || dist(q, pts[i - 1]) > 300);
}
async function setVia(p) {
  $('viaRow').hidden = false;
  $('via').value = p.name;
  S.viaPending = false;
  if (!S.A || !S.B) { toast(L('Elige primero el origen y el destino.')); return; }
  let pts = null;
  if (p.isStreet) {
    toast(L('Buscando {name}…', { name: p.name }), 2500);
    try { pts = await streetVia(p.name); } catch { /* fall back to the point */ }
  }
  // keep the name the rider typed ("Avenida Boyacá") when OSM's main name differs ("Avenida Carrera 72")
  const t = (p.typed || '').trim();
  const label = t.length >= 4 && !p.name.toLowerCase().includes(t.toLowerCase()) ? `${t} (${p.name})` : p.name;
  $('via').value = label;
  S.via = pts ? { label, street: true, pts } : { label, street: false, pts: [[p.lng, p.lat]] };
  drawVia();
  computeRoutes();
}
function setViaPoint(lngLat) {
  S.via = { label: L('Punto en el mapa'), street: false, pts: [[lngLat.lng, lngLat.lat]] };
  S.viaPending = false;
  $('viaRow').hidden = false; $('via').value = S.via.label;
  const v = S.via;
  reverseName(lngLat).then((n) => { if (n && S.via === v) { v.label = n; $('via').value = n; if (S.view === 'route') rerender(); } });
  drawVia();
  computeRoutes();
}
function clearVia(recompute = true) {
  const had = !!S.via;
  S.via = null; S.viaPending = false;
  $('via').value = ''; $('viaRow').hidden = true;
  drawVia();
  if (had && recompute && S.A && S.B) computeRoutes();
}
function startVia() {
  S.viaPending = true;
  $('viaRow').hidden = false;
  if (!wide()) setSnap('peek');
  $('via').focus();
  toast(L('Escribe una calle (p. ej. Avenida Boyacá) o un lugar. También puedes tocar el mapa.'), 5000);
}
function drawVia() {
  (markers.via || []).forEach((m) => m.remove());
  markers.via = [];
  if (!S.via || !map) return;
  S.via.pts.forEach((p, i) => {
    const el = pinEl('via' + (S.via.street && i > 0 && i < S.via.pts.length - 1 ? ' mid' : ''), '');
    el.title = S.via.label;
    const m = new maplibregl.Marker({ element: el, draggable: !S.via.street }).setLngLat(p).addTo(map);
    if (!S.via.street) m.on('dragend', () => setViaPoint(m.getLngLat()));
    markers.via.push(m);
  });
}

// ---------------------------------------------------------------- search
let suggestFor = null, suggestTimer = null;
const INPUT = { A: 'from', B: 'to', V: 'via' };
function wireSearch() {
  for (const [which, id] of Object.entries(INPUT)) {
    const inp = $(id);
    inp.addEventListener('focus', () => { inp.select(); if (!$('sheet').hidden && !wide()) setSnap('peek'); });
    inp.addEventListener('input', () => {
      clearTimeout(suggestTimer);
      const q = inp.value.trim();
      if (q.length < 3) { hideSuggest(); return; }
      suggestTimer = setTimeout(() => photon(q, which), 400);
    });
  }
  // the form has several fields and no submit button, so browsers never submit it on Enter: handle the key ourselves
  const go = async (which) => {
    const q = $(INPUT[which]).value.trim();
    if (q.length < 2) return;
    if (suggestFor?.which === which && suggestFor.list.length && !$('suggest').hidden) { pickPlace(which, { ...suggestFor.list[0], typed: q }); return; }
    const list = await nominatim(q);
    if (!list) return;
    if (list.length) pickPlace(which, { ...list[0], typed: q }); else toast(L('No encontré ese lugar en Bogotá.'));
  };
  $('search').addEventListener('submit', (e) => e.preventDefault());
  for (const [which, id] of Object.entries(INPUT)) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(which); } });
  $('suggest').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (b) pickPlace(suggestFor.which, suggestFor.list[+b.dataset.i]);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#search')) hideSuggest(); });
}
function hideSuggest() { $('suggest').hidden = true; }
function showSuggest(which, list) {
  suggestFor = { which, list };
  $('suggest').innerHTML = list.map((p, i) => `<li><button type="button" data-i="${i}"><strong>${esc(p.name)}</strong><span>${esc(p.sub)}</span></button></li>`).join('');
  $('suggest').hidden = !list.length;
}
async function photon(q, which) {
  try {
    const u = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&bbox=${BBOX.w},${BBOX.s},${BBOX.e},${BBOX.n}&lat=${BOGOTA[1]}&lon=${BOGOTA[0]}`;
    const j = await (await fetchT(u, {}, 6000)).json();
    if (document.activeElement !== $(INPUT[which])) return;
    showSuggest(which, j.features.map((f) => {
      const p = f.properties;
      const name = p.name || [p.street, p.housenumber].filter(Boolean).join(' ');
      return { name, sub: [p.osm_key === 'highway' ? L('Calle') : null, p.street !== name ? p.street : null, p.district || p.locality, p.city].filter(Boolean).join(', '), lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], isStreet: p.osm_key === 'highway' };
    }).filter((p) => p.name));
  } catch { /* suggestions are optional; Enter still searches with Nominatim */ }
}
async function nominatim(q) {
  try {
    const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&viewbox=${BBOX.w},${BBOX.n},${BBOX.e},${BBOX.s}&bounded=1&limit=5&accept-language=es&countrycodes=co`;
    const j = await nomSearch(u);
    return j.map((r) => ({ name: r.name || r.display_name.split(',')[0], sub: r.display_name, lng: +r.lon, lat: +r.lat, isStreet: r.category === 'highway' }));
  } catch (e) { toast(e.message === 'busy' ? L('El buscador está ocupado. Intenta en unos segundos.') : L('La búsqueda no respondió. Intenta de nuevo.')); return null; }
}
function pickPlace(which, p) {
  hideSuggest();
  document.activeElement?.blur?.();
  if (which === 'V') { setVia(p); return; }
  const other = which === 'A' ? S.B : S.A;
  if (!other) map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 14) });
  setPoint(which, { lng: p.lng, lat: p.lat }, p.name);
}

// ---------------------------------------------------------------- bottom sheet views
const DEFAULT_SNAP = { services: 'half', route: 'peek', steps: 'half', report: 'half', layers: 'half', home: 'peek', place: 'half', reportView: 'half', loading: 'peek', error: 'half', arrived: 'half' };
function show(view, snap) {
  S.view = view;
  if (!['services', 'place'].includes(view) && markers.services?.length) { markers.services.forEach((m) => m.remove()); markers.services = []; }
  const sheet = $('sheet'), body = $('sheetBody');
  document.body.classList.toggle('has-sheet', !!view);
  $('placePin').hidden = view !== 'report';
  if (!view) { sheet.hidden = true; document.body.classList.remove('sheet-full'); afterSheetMove(); return; }
  sheet.hidden = false;
  body.innerHTML = VIEWS[view]();
  body.scrollTop = 0;
  setSnap(snap || DEFAULT_SNAP[view] || 'half');
  if (view === 'steps') loadNames();
}
function rerender() { // re-render the current view keeping scroll position and sheet height
  const body = $('sheetBody'), top = body.scrollTop;
  body.innerHTML = VIEWS[S.view]();
  body.scrollTop = top;
  setSnap(S.snap);
}

const bar = (pct) => `<div class="bar" role="img" aria-label="${ORDER.map((k) => `${TYPES[k].label} ${pct[k]} %`).join(', ')}">${ORDER.filter((k) => pct[k] > 0).map((k) => `<div class="${k}" style="width:${pct[k]}%"></div>`).join('')}</div>`;
const badge = (r) => `<span class="badge ${r.noCars >= 70 ? 'good' : r.noCars >= 40 ? 'mid' : 'bad'}">${L('{n} % sin carros', { n: r.noCars })}</span>`;
const ORD = ['', 'primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta'];
const kmAt = (m) => dec(m / 1000);
function manText(m) {
  if (m.arrive) return L('Llegas a tu destino');
  if (m.exit > 0) return L('En la glorieta, toma la {n} salida', { n: (LANG === 'en' ? ORD_EN : ORD)[m.exit] || m.exit + (LANG === 'en' ? 'th' : '.ª') });
  if (m.cmd === 8) return L('Mantente a la izquierda');
  if (m.cmd === 9) return L('Mantente a la derecha');
  const a = Math.abs(m.angle), side = m.angle > 0 ? 'derecha' : 'izquierda';
  if (a < 25) return L('Sigue derecho');
  if (a < 55) return L(`Gira levemente a la ${side}`);
  if (a < 135) return L(`Gira a la ${side}`);
  if (a < 165) return L(`Gira cerrado a la ${side}`);
  return L('Da la vuelta en U');
}
// lower-case first letter, for joining an instruction into a sentence
const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
function manIcon(m) {
  if (m.arrive) return ICONS.flag;
  if (m.exit > 0) return ICONS.round;
  const a = m.cmd === 8 ? -35 : m.cmd === 9 ? 35 : Math.max(-150, Math.min(150, m.angle));
  return `<svg viewBox="0 0 24 24" style="transform:rotate(${Math.round(a)}deg)"><path d="M12 21V4M6 10l6-6 6 6"/></svg>`;
}
function tramos(r) {
  // merge very short stretches (< 60 m) into the previous one so the list stays readable
  const out = [];
  for (const s of r.segs) {
    const last = out[out.length - 1];
    if (last && (s.d < 60 || last.t === s.t)) { last.d += s.d; last.i1 = s.i1; last.coords = last.coords.concat(s.coords.slice(1)); }
    else out.push({ t: s.t, d: s.d, i0: s.i0, i1: s.i1, coords: s.coords.slice() });
  }
  return out;
}
if (!tramos.cache) tramos.cache = new WeakMap();
const tramosOf = (r) => { if (!tramos.cache.has(r)) tramos.cache.set(r, tramos(r)); return tramos.cache.get(r); };
const key = (s) => s.coords[Math.floor(s.coords.length / 2)].map((x) => x.toFixed(4)).join(',') + ':' + Math.round(s.d);
// stretch name for display: the street, a fallback when OSM has none, or a placeholder while loading
const tramoLabel = (s) => (S.names.has(key(s)) ? S.names.get(key(s)) || L('{t} sin nombre', { t: TYPES[s.t].label }) : L('Buscando nombre…'));
const placeKind = (p) => (SVC[p.k] ? SVC[p.k].one : p.kind);

const VIEWS = {
  loading: () => `<div class="stack"><div class="row" data-peek style="align-items:center;gap:12px;min-height:48px"><div class="spin"></div><span>${L('Buscando rutas: más ciclorruta, equilibrada y más rápida…')}</span></div></div>`,
  error: () => `<div class="stack"><strong>${L('No se pudo calcular la ruta.')}</strong><span class="sub">${esc(S.errorMsg)}</span><div class="row" data-peek><button class="btn" data-act="clear">${L('Limpiar')}</button><button class="btn primary" data-act="retry">${L('Reintentar')}</button></div></div>`,
  home: () => `<div class="stack">
      <div class="head"><h2>${L('Mis rutas')}</h2></div>
      <ul class="saved">${S.saved.map((s, i) => `<li ${i === Math.min(1, S.saved.length - 1) ? 'data-peek' : ''}><button class="savedgo" data-act="openSaved" data-i="${i}">${ICONS.star}<span><strong>${esc(s.A.label)} → ${esc(s.B.label)}</strong><small>${esc(MODES[s.mode]?.label || '')}${s.via ? ' · ' + L('Pasando por') + ' ' + esc(s.via.label) : ''}</small></span></button><button class="mini" data-act="delSaved" data-i="${i}" aria-label="${L('Borrar')}">${ICONS.trash}</button></li>`).join('')}</ul>
      <span class="small">${L('Para una ruta nueva, busca el origen y el destino arriba o toca el mapa.')}</span>
    </div>`,
  route: () => {
    const r = cur();
    const fast = S.routes.fast, infra = S.routes.infra;
    const eta = new Date(Date.now() + rTime(r) * 1000);
    const chips = MODE_KEYS.map((k) => {
      const x = S.routes[k];
      return `<button data-act="mode" data-mode="${k}" aria-pressed="${S.mode === k}" ${x ? '' : 'disabled'}><span>${MODES[k].label}</span><b>${x ? fmtMin(rTime(x)) : '—'}</b><small>${x ? L('{n} % sin carros', { n: x.noCars }) : L('sin ruta')}</small></button>`;
    }).join('');
    let blurb = '';
    if (S.mode !== 'fast' && fast) { const d = Math.round((rTime(r) - rTime(fast)) / 60); blurb = d > 0 ? L('{d} min más que la más rápida', { d }) : L('Igual de rápida que la más rápida'); }
    else if (infra && infra.noCars > r.noCars) blurb = L('La de más ciclorruta va {n} % sin carros', { n: infra.noCars });
    const ts = tramosOf(r);
    const worst = ts.map((s, i) => ({ s, i })).filter((x) => x.s.t === 'ca').sort((a, b) => b.s.d - a.s.d)[0];
    const near = reportsNear(r);
    return `<div class="stack">
      <div class="chips">${chips}</div>
      <div class="stats">
        <div class="statsmain"><span class="big">${fmtMin(rTime(r))}</span><span class="sub">${fmtKm(r.length)}${r.ascend ? ` · ↑ ${r.ascend} m` : ''} · ${L('llegas {t}', { t: clock(eta) })}</span></div>
        ${badge(r)}
      </div>
      ${bar(r.pct)}
      <div class="row" data-peek>
        <button class="btn primary" data-act="nav">${ICONS.go} ${L('Iniciar')}</button>
        <button class="btn" data-act="steps">${ICONS.list} ${L('Tramos')}</button>
      </div>
      ${S.via ? `<div class="vialine">${ICONS.via}<span>${L('Pasando por')} <b>${esc(S.via.label)}</b></span><button class="mini" data-act="clearVia" aria-label="${L('Quitar punto de paso')}">${ICONS.close}</button></div>` : ''}
      ${blurb ? `<span class="sub">${blurb}${S.alt[S.mode] ? ` · ${L('alternativa {n}', { n: S.alt[S.mode] + 1 })}` : ''}</span>` : ''}
      <div class="legend">${ORDER.map((k) => `<div><span class="sw ${k}"></span><span>${TYPES[k].short}</span><b>${r.pct[k]} %</b></div>`).join('')}</div>
      ${worst && worst.s.d >= 400 ? `<button class="alert" data-act="selTramo" data-i="${worst.i}">${ICONS.warn}<span style="flex:1"><strong>${L('Tramo con carros más largo: {d}', { d: fmtM(worst.s.d) })}</strong><span>${L('En el km {km}. Toca para verlo en el mapa.', { km: kmAt(r.cum[worst.s.i0]) })}</span></span></button>` : ''}
      ${near.length
        ? `<button class="alert" data-act="openReport" data-id="${near[0].id}">${ICONS.warn}<span style="flex:1"><strong>${L(near.length === 1 ? '{n} reporte activo en esta ruta' : '{n} reportes activos en esta ruta', { n: near.length })}</strong><span>${esc(near.map((x) => REPORT_TYPES[x.type].label).join(' · '))}</span></span></button>`
        : `<div class="okline">${ICONS.check} ${L('Sin reportes activos en esta ruta')}</div>`}
      <div class="tools">
        <button data-act="addVia">${ICONS.via}<span>${L('Pasar por')}</span></button>
        <button data-act="altRoute">${ICONS.alt}<span>${L('Otra ruta')}</span></button>
        <button data-act="save">${ICONS.star}<span>${isSaved() ? L('Guardada') : L('Guardar')}</span></button>
        <button data-act="share">${ICONS.share}<span>${L('Compartir')}</span></button>
        <button data-act="clear">${ICONS.close}<span>${L('Limpiar')}</span></button>
      </div>
      <span class="small">${L('Tipos de vía según etiquetas de OpenStreetMap; pueden tener errores.')} ${L('Tiempos con ritmo {p} (cámbialo en Capas y opciones). Ruta: BRouter.', { p: PACE[S.prefs.pace].label.toLowerCase() })}</span>
    </div>`;
  },
  steps: () => {
    const r = cur();
    const near = reportsNear(r);
    const head = `<div class="head"><button class="back" data-act="back" aria-label="${L('Volver')}">${ICONS.back}</button><div style="min-width:0"><h2>${MODES[S.mode].label}</h2><span class="sub">${fmtMin(rTime(r))} · ${fmtKm(r.length)} · ${L('{n} % sin carros', { n: r.noCars })}</span></div></div>
      <div class="tabs" ${S.sel == null ? 'data-peek' : ''}><button data-act="tab" data-tab="tramos" aria-pressed="${S.stepsTab === 'tramos'}">${L('Tramos')}</button><button data-act="tab" data-tab="turns" aria-pressed="${S.stepsTab === 'turns'}">${L('Indicaciones')}</button></div>`;
    if (S.stepsTab === 'tramos') {
      const ts = tramosOf(r);
      const selCard = S.sel != null && ts[S.sel] ? (() => {
        const s = ts[S.sel];
        return `<div class="selcard" data-peek><div class="rail ${s.t}"></div><div class="body"><div class="top"><span class="nm" data-k="${esc(key(s))}">${esc(tramoLabel(s))}</span><span>${fmtM(s.d)}</span></div><span class="small">${L('Tramo {i} de {n}', { i: S.sel + 1, n: ts.length })} · km ${kmAt(r.cum[s.i0])} · ${TYPES[s.t].label}</span></div>
          <div class="stepper"><button class="mini" data-act="selTramo" data-i="${S.sel - 1}" ${S.sel === 0 ? 'disabled' : ''} aria-label="${L('Tramo anterior')}">${ICONS.back}</button><button class="mini" data-act="selTramo" data-i="${S.sel + 1}" ${S.sel === ts.length - 1 ? 'disabled' : ''} aria-label="${L('Tramo siguiente')}" style="transform:scaleX(-1)">${ICONS.back}</button></div></div>`;
      })() : '';
      const items = ts.map((s, i) => {
        const reps = near.filter((x) => distToLine([x.lng, x.lat], s.coords) < 35);
        return `<li><button class="steprow${S.sel === i ? ' on' : ''}" data-act="selTramo" data-i="${i}"><div class="rail ${s.t}"></div><div class="body">
          <div class="top"><span class="nm" data-k="${esc(key(s))}">${esc(tramoLabel(s))}</span><span>${fmtM(s.d)}</span></div>
          <span class="small">km ${kmAt(r.cum[s.i0])} · ${TYPES[s.t].label}</span>
          ${reps.map((x) => `<span class="rep">⚠ ${esc(REPORT_TYPES[x.type].label)}</span>`).join('')}
        </div></button></li>`;
      }).join('');
      return `<div class="stack">${head}${selCard}${bar(r.pct)}<ol class="steps">${items}</ol>
        <span class="small">${L('Toca un tramo para verlo en el mapa. Nombres de calles aproximados (OpenStreetMap / Nominatim).')}</span></div>`;
    }
    const list = [{ start: true, at: 0 }, ...r.man];
    const turnStreet = (m) => { const n = S.names.get(turnKey(r, m)); return n ? L('por {n}', { n }) : ''; };
    const selCard = S.sel != null && list[S.sel] ? (() => {
      const m = list[S.sel];
      return `<div class="selcard" data-peek><div class="turnic">${m.start ? ICONS.go : manIcon(m)}</div><div class="body"><div class="top"><span>${m.start ? esc(L('Sal de {p}', { p: S.A.label })) : esc(manText(m))}</span></div><span class="small tn" data-i="${S.sel}">${esc(m.start || m.arrive ? '' : turnStreet(m))}</span></div>
        <div class="stepper"><button class="mini" data-act="selTurn" data-i="${S.sel - 1}" ${S.sel === 0 ? 'disabled' : ''} aria-label="${L('Anterior')}">${ICONS.back}</button><button class="mini" data-act="selTurn" data-i="${S.sel + 1}" ${S.sel === list.length - 1 ? 'disabled' : ''} aria-label="${L('Siguiente')}" style="transform:scaleX(-1)">${ICONS.back}</button></div></div>`;
    })() : '';
    const items = list.map((m, i) => {
      const next = list[i + 1];
      const leg = next ? next.at - m.at : 0;
      return `<li><button class="steprow${S.sel === i ? ' on' : ''}" data-act="selTurn" data-i="${i}"><div class="turnic">${m.start ? ICONS.go : manIcon(m)}</div><div class="body">
        <div class="top"><span>${m.start ? esc(L('Sal de {p}', { p: S.A.label })) : esc(manText(m))}</span><span>${m.arrive ? '' : fmtM(leg)}</span></div>
        <span class="small tn" data-i="${i}">${m.start || m.arrive ? `km ${kmAt(m.at)}` : esc(turnStreet(m))}</span>
      </div></button></li>`;
    }).join('');
    return `<div class="stack">${head}${selCard}<ol class="steps turns">${items}</ol>
      <span class="small">${L('Indicaciones de BRouter. Nombres de calles aproximados.')}</span></div>`;
  },
  report: () => `<div class="stack">
      <div class="head" data-peek><button class="back" data-act="cancelReport" aria-label="${L('Cancelar')}">${ICONS.close}</button><div><h2>${L('¿Qué encontraste?')}</h2><span class="sub">${L('Mueve el mapa para poner el pin en el sitio exacto.')}</span></div></div>
      <div class="cats">${Object.entries(REPORT_TYPES).map(([k, v]) => `<button data-act="cat" data-k="${k}" aria-pressed="${S.draftType === k}">${v.icon}${v.label}</button>`).join('')}</div>
      <div><label class="lbl" for="note">${L('Detalle (opcional)')}</label><textarea id="note" rows="2" maxlength="280" placeholder="${L('Ej.: hueco profundo en el carril sentido sur')}"></textarea></div>
      <button class="btn primary" data-act="publish">${L('Publicar reporte')}</button>
      <span class="small" style="text-align:center">${L('Por ahora los reportes se guardan solo en este teléfono.')}</span>
    </div>`,
  reportView: () => {
    const r = S.current, t = REPORT_TYPES[r.type];
    const total = r.still + r.fixed || 1;
    return `<div class="stack">
      <div class="head"><button class="back" data-act="${cur() ? 'backRoute' : 'close'}" aria-label="${L('Volver')}">${ICONS.back}</button>
        <div><h2>${esc(t.label)}</h2><span class="sub">${L('Reportado {t}', { t: timeAgo(r.created) })}</span></div></div>
      ${r.note ? `<p style="margin:0">${esc(r.note)}</p>` : ''}
      <div class="votes"><span>${L('{n} dicen que sigue ahí', { n: `<b>${r.still}</b>` })}</span><span>${L('{n} dicen que ya está arreglado', { n: `<b>${r.fixed}</b>` })}</span></div>
      <div class="vbar"><div style="width:${(r.still / total) * 100}%;background:var(--warn)"></div><div style="width:${(r.fixed / total) * 100}%;background:var(--brand)"></div></div>
      <strong style="font-size:14px">${L('¿Pasaste por aquí hoy?')}</strong>
      <div class="row" data-peek>
        <button class="btn warn" data-act="vote" data-v="still" ${r.myVote ? 'disabled' : ''}>${L('Sigue ahí')}</button>
        <button class="btn ghost-ok" data-act="vote" data-v="fixed" ${r.myVote ? 'disabled' : ''}>${L('Ya está arreglado')}</button>
      </div>
      ${r.myVote ? `<span class="small">${L(r.myVote === 'still' ? 'Ya votaste: sigue ahí. ¡Gracias!' : 'Ya votaste: arreglado. ¡Gracias!')}</span>` : ''}
    </div>`;
  },
  layers: () => `<div class="stack">
      <div class="head" data-peek><button class="back" data-act="close" aria-label="${L('Cerrar')}">${ICONS.close}</button><h2>${L('Capas y opciones')}</h2></div>
      <div><label class="lbl">${L('Idioma')} / Language</label>
        <div class="tabs"><button data-act="lang" data-k="es" aria-pressed="${LANG === 'es'}">Español</button><button data-act="lang" data-k="en" aria-pressed="${LANG === 'en'}">English</button></div></div>
      <div><label class="lbl">${L('Tu ritmo (ajusta los tiempos)')}</label>
        <div class="tabs">${Object.entries(PACE).map(([k, v]) => `<button data-act="pace" data-k="${k}" aria-pressed="${S.prefs.pace === k}">${v.label}</button>`).join('')}</div></div>
      <div>
        <label class="toggle"><input type="checkbox" data-pref="voice" ${S.prefs.voice ? 'checked' : ''}><span>${L('Voz durante la navegación')}<small>${L('Anuncia giros y tramos con carros.')}</small></span></label>
        <label class="toggle"><input type="checkbox" data-layer="idu" ${S.layers.idu ? 'checked' : ''}><span class="sw" style="background:var(--idu)"></span><span>${L('Red oficial de ciclorrutas (IDU)')}<small>${L('Datos IDU / IDECA, CC BY 4.0. Acércate para verla.')}</small></span></label>
        <label class="toggle"><input type="checkbox" data-layer="reports" ${S.layers.reports ? 'checked' : ''}><span class="sw" style="background:var(--warn)"></span><span>${L('Reportes')}</span></label>
      </div>
      <div class="legend">${ORDER.map((k) => `<div><span class="sw ${k}"></span><span>${TYPES[k].label}</span></div>`).join('')}</div>
      <span class="small">${L('Rutas: “Más ciclorruta” usa el perfil safety de BRouter, “Equilibrada” el perfil trekking y “Más rápida” el perfil fastbike.')}</span>
    </div>`,
  services: () => {
    const r = cur();
    const vis = svcVisible();
    const items = vis.map((p, i) => `<li><button class="steprow svcrow" data-act="openPlace" data-i="${i}"><span class="pin ${SVC[p.k].cls}">${SVC[p.k].icon}</span><div class="body">
        <div class="top"><span>${esc(p.name)}</span><span>${p.at != null ? `km ${kmAt(p.at)}` : fmtM(p.d)}</span></div>
        <span class="small">${esc(placeKind(p))}${p.at != null && p.off > 60 ? ' · ' + L('a {d} de la ruta', { d: fmtM(p.off) }) : ''}${p.hours ? ' · ' + esc(p.hours) : ''}</span></div></button></li>`).join('');
    return `<div class="stack">
      <div class="head"><button class="back" data-act="close" aria-label="${L('Cerrar')}">${ICONS.close}</button><div><h2>${L('Lugares para ciclistas')}</h2><span class="sub">${r && SV.where === 'route' ? L('A menos de 300 m de tu ruta') : SV.center ? L('A menos de 3 km') : ''}</span></div></div>
      ${r ? `<div class="tabs"><button data-act="svcWhere" data-w="near" aria-pressed="${SV.where === 'near'}">${L('Cerca de ti')}</button><button data-act="svcWhere" data-w="route" aria-pressed="${SV.where === 'route'}">${L('En tu ruta')}</button></div>` : ''}
      <div class="filters" data-peek>${[['all', L('Todos')], ...Object.entries(SVC).map(([k, v]) => [k, v.label])].map(([k, l]) => `<button data-act="svcFilter" data-k="${k}" aria-pressed="${SV.filter === k}">${l}</button>`).join('')}</div>
      ${SV.loading ? `<div class="row" style="align-items:center;gap:12px"><div class="spin"></div><span>${L('Buscando en OpenStreetMap…')}</span></div>` : ''}
      ${SV.error ? `<span class="sub">${esc(L(SV.error))}</span><button class="btn" data-act="svcRetry">${L('Reintentar')}</button>` : ''}
      ${!SV.loading && !SV.error && !vis.length ? `<span class="sub">${L('No hay lugares de este tipo registrados aquí en OpenStreetMap.')}</span>` : ''}
      ${vis.length ? `<ol class="steps">${items}</ol>` : ''}
      <span class="small">${L('Datos de OpenStreetMap: puede faltar alguno.')} ${L('¿Conoces un taller o una bomba que no aparece?')} <a href="https://www.openstreetmap.org/edit" target="_blank" rel="noopener">${L('Agrégalo en OpenStreetMap')}</a>.</span>
    </div>`;
  },
  place: () => {
    const p = S.current;
    return `<div class="stack">
      <div class="head"><button class="back" data-act="${SV.list.includes(p) ? 'backServices' : 'close'}" aria-label="${L('Volver')}">${ICONS.back}</button><div><h2>${esc(p.name)}</h2><span class="sub">${esc(placeKind(p))}${p.at != null ? ' · ' + L('km {km} de tu ruta', { km: kmAt(p.at) }) : p.d != null ? ' · ' + L('a {d}', { d: fmtM(p.d) }) : ''}</span></div></div>
      ${p.hours ? `<span class="sub">${esc(L('Horario: {h}', { h: p.hours }))}</span>` : ''}
      ${p.address ? `<span class="sub">${esc(p.address)}</span>` : ''}
      <div class="row" data-peek>
        ${cur() ? `<button class="btn primary" data-act="viaPlace">${L('Parar aquí en mi ruta')}</button>` : `<button class="btn primary" data-act="goPlace">${L('Cómo llegar en bici')}</button>`}
        ${p.phone ? `<a class="btn" style="flex:none;width:110px;text-decoration:none;color:inherit" href="tel:${esc(p.phone.replace(/\s/g, ''))}">${L('Llamar')}</a>` : ''}
      </div>
      <span class="small">${L('Datos de OpenStreetMap.')} ${L('¿Falta un taller?')} <a href="https://www.openstreetmap.org/edit#map=18/${p.lat}/${p.lng}" target="_blank" rel="noopener">${L('Agrégalo')}</a>.</span>
    </div>`;
  },
  arrived: () => `<div class="stack">
      <div class="head" data-peek><div><h2>${L('¡Llegaste!')}</h2><span class="sub">${esc(S.B?.label || '')}</span></div></div>
      <span class="sub">${L('¿Encontraste algún problema en el camino? Repórtalo para avisar a otros ciclistas.')}</span>
      <div class="row"><button class="btn" data-act="backRoute">${L('Cerrar')}</button><button class="btn warn" data-act="startReport">${L('Reportar')}</button></div>
    </div>`,
};
const turnKey = (r, m) => 'turn:' + pointAtDist(r, m.at + 25).map((x) => x.toFixed(4)).join(',');

// names load one by one (Nominatim allows 1 request per second) and fill in as they arrive
async function loadNames() {
  const r = cur(), tab = S.stepsTab;
  const still = () => S.view === 'steps' && cur() === r && S.stepsTab === tab;
  if (tab === 'tramos') {
    const ts = tramosOf(r);
    const order = S.sel != null ? [S.sel, ...ts.keys()] : [...ts.keys()];
    for (const i of order) {
      if (!still()) return;
      const k = key(ts[i]);
      const n = await tramoName(ts[i]);
      document.querySelectorAll('#sheetBody .nm').forEach((el) => { if (el.dataset.k === k) el.textContent = n; });
    }
  } else {
    for (let i = 0; i < r.man.length; i++) {
      if (!still()) return;
      const m = r.man[i];
      if (m.arrive) continue;
      const n = await turnName(r, m);
      document.querySelectorAll(`#sheetBody .tn[data-i="${i + 1}"]`).forEach((el) => { el.textContent = n ? L('por {n}', { n }) : ''; });
    }
  }
}
function selectTramo(i) {
  const r = cur(), ts = tramosOf(r);
  if (!ts[i]) return;
  S.stepsTab = 'tramos'; S.sel = i;
  if (S.view !== 'steps') S.view = 'steps';
  $('sheetBody').innerHTML = VIEWS.steps(); $('sheetBody').scrollTop = 0;
  $('sheet').hidden = false;
  setSnap('peek');
  highlight(ts[i].coords);
  S.fitMaxZoom = 17;
  fitTo(ts[i].coords, { maxZoom: 17 });
  loadNames();
}
function selectTurn(i) {
  const r = cur(), list = [{ start: true, at: 0 }, ...r.man];
  const m = list[i];
  if (!m) return;
  S.sel = i;
  $('sheetBody').innerHTML = VIEWS.steps(); $('sheetBody').scrollTop = 0;
  setSnap('peek');
  const seg = sliceByDist(r, m.at - 40, m.at + 60);
  highlight(seg);
  S.fitMaxZoom = 17.5;
  fitTo(seg, { maxZoom: 17.5 });
  loadNames();
}
function timeAgo(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 2) return L('hace un momento');
  if (m < 60) return L('hace {n} min', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return L('hace {n} h', { n: h });
  const d = Math.round(h / 24);
  return d === 1 ? L('hace 1 día') : L('hace {n} días', { n: d });
}

// ---------------------------------------------------------------- saved routes and sharing
const isSaved = () => S.A && S.B && S.saved.some((s) => dist([s.A.lng, s.A.lat], [S.A.lng, S.A.lat]) < 30 && dist([s.B.lng, s.B.lat], [S.B.lng, S.B.lat]) < 30 && (s.via?.label || '') === (S.via?.label || ''));
function saveRoute() {
  if (isSaved()) { toast(L('Esta ruta ya está en Mis rutas.')); return; }
  S.saved.unshift({ A: S.A, B: S.B, via: S.via && { ...S.via, pts: S.via.pts.map((q) => [...q]) }, mode: S.mode });
  S.saved = S.saved.slice(0, 12);
  LS.set('bb_saved', S.saved);
  toast(L('Ruta guardada. La verás en Mis rutas al abrir la app.'));
  rerender();
}
function shareUrl() {
  const u = new URL(location.href.split('?')[0]);
  u.searchParams.set('a', `${S.A.lat.toFixed(6)},${S.A.lng.toFixed(6)}`);
  u.searchParams.set('b', `${S.B.lat.toFixed(6)},${S.B.lng.toFixed(6)}`);
  u.searchParams.set('an', S.A.label); u.searchParams.set('bn', S.B.label);
  u.searchParams.set('m', S.mode);
  if (S.via) { u.searchParams.set('v', S.via.pts.map((p) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`).join(';')); u.searchParams.set('vn', S.via.label); if (S.via.street) u.searchParams.set('vs', '1'); }
  return u.toString();
}
async function share() {
  const url = shareUrl();
  try {
    if (navigator.share) { await navigator.share({ title: L('Ruta en bici'), text: `${S.A.label} → ${S.B.label}`, url }); return; }
    await navigator.clipboard.writeText(url); toast(L('Enlace copiado.'));
  } catch (e) { if (e?.name !== 'AbortError') toast(L('No se pudo compartir.')); }
}

// sheet actions
function wireSheet() {
  $('sheetBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'mode') { S.mode = b.dataset.mode; S.sel = null; rerender(); drawRoutes(true); }
    else if (act === 'steps') { S.sel = null; show('steps'); highlight(null); }
    else if (act === 'tab') { S.stepsTab = b.dataset.tab; S.sel = null; highlight(null); rerender(); if (S.snap === 'peek') setSnap('half'); loadNames(); }
    else if (act === 'selTramo') selectTramo(+b.dataset.i);
    else if (act === 'selTurn') selectTurn(+b.dataset.i);
    else if (act === 'back' || act === 'backRoute') { S.sel = null; show(cur() ? 'route' : null); drawRoutes(true); }
    else if (act === 'nav') startNav();
    else if (act === 'clear') clearAll();
    else if (act === 'retry') computeRoutes();
    else if (act === 'altRoute') nextAlternative();
    else if (act === 'addVia') startVia();
    else if (act === 'clearVia') clearVia();
    else if (act === 'save') saveRoute();
    else if (act === 'share') share();
    else if (act === 'openSaved') { const s = S.saved[+b.dataset.i]; S.mode = s.mode || 'infra'; openRoute(s.A, s.B, s.via); }
    else if (act === 'delSaved') { S.saved.splice(+b.dataset.i, 1); LS.set('bb_saved', S.saved); show(S.saved.length ? 'home' : null); }
    else if (act === 'close') show(cur() ? 'route' : S.saved.length && !S.A ? 'home' : null);
    else if (act === 'lang') { setLang(b.dataset.k); }
    else if (act === 'pace') { S.prefs.pace = b.dataset.k; LS.set('bb_prefs', S.prefs); rerender(); }
    else if (act === 'cat') { S.draftType = b.dataset.k; $('sheetBody').querySelectorAll('[data-act="cat"]').forEach((x) => x.setAttribute('aria-pressed', x === b)); }
    else if (act === 'cancelReport') show(cur() ? 'route' : null);
    else if (act === 'startReport') startReport();
    else if (act === 'publish') publishReport();
    else if (act === 'openReport') openReport(S.reports.find((r) => r.id === b.dataset.id));
    else if (act === 'vote') vote(b.dataset.v);
    else if (act === 'openPlace') openPlace(svcVisible()[+b.dataset.i]);
    else if (act === 'backServices') { show('services'); drawServices(true); }
    else if (act === 'svcFilter') { SV.filter = b.dataset.k; rerender(); drawServices(true); }
    else if (act === 'svcWhere') { SV.where = b.dataset.w; loadServices(); }
    else if (act === 'svcRetry') loadServices();
    else if (act === 'openServices') openServices();
    else if (act === 'viaPlace') { const p = S.current; markers.services.forEach((m) => m.remove()); markers.services = []; setVia({ name: p.name, lng: p.lng, lat: p.lat }); }
    else if (act === 'goPlace') {
      const p = S.current;
      markers.services.forEach((m) => m.remove()); markers.services = [];
      if (!S.A && SV.center && SV.where === 'near') { const c = SV.center; S.A = { lng: c[0], lat: c[1], label: L('Mi ubicación') }; makeMarker('A', S.A); $('from').value = S.A.label; }
      if (!S.A) toast(L('Elige también el origen.'));
      setPoint('B', { lng: p.lng, lat: p.lat }, p.name);
    }
  });
  $('sheetBody').addEventListener('change', (e) => {
    const l = e.target.dataset.layer, p = e.target.dataset.pref;
    if (p) { S.prefs[p] = e.target.checked; LS.set('bb_prefs', S.prefs); return; }
    if (!l) return;
    S.layers[l] = e.target.checked;
    applyLayers();
  });
}
function openRoute(A, B, via) {
  makeMarker('A', A); makeMarker('B', B);
  S.A = A; S.B = B;
  S.via = via || null;
  $('viaRow').hidden = !S.via; $('via').value = S.via?.label || '';
  drawVia();
  $('from').value = A.label; $('to').value = B.label;
  document.body.classList.add('has-route');
  computeRoutes();
}

// ---------------------------------------------------------------- reports (local for now)
function loadReports() {
  try { return JSON.parse(localStorage.getItem('bb_reports') || '[]'); } catch { return []; }
}
function saveReports() { LS.set('bb_reports', S.reports); }
function activeReports() {
  const month = 30 * 864e5;
  return S.reports.filter((r) => !(r.fixed >= 3 && r.fixed > r.still) && Date.now() - r.created < month);
}
function reportsNear(route) {
  if (!route) return [];
  return activeReports().filter((r) => distToLine([r.lng, r.lat], route.coords) < 35);
}
function startReport() {
  S.draftType = 'pothole';
  // when coming from navigation, put the pin where the rider is (and don't let a pending refit move it)
  const at = N.lastPos;
  N.lastPos = null;
  show('report');
  if (at) {
    S.fit = null;
    map.jumpTo({ center: at, zoom: Math.max(map.getZoom(), 17), bearing: 0, pitch: 0 });
    const px = wide() ? (innerWidth + 450) / 2 : innerWidth / 2;
    map.panBy([innerWidth / 2 - px, innerHeight / 2 - pinY()], { duration: 0 });
  }
}
// the placement pin sits in the middle of the map area left visible between the search box and the sheet
function pinY() {
  const top = $('quick').getBoundingClientRect().bottom;
  const bottom = $('sheet').hidden || wide() ? innerHeight : innerHeight - (parseFloat($('sheet').style.height) || $('sheet').offsetHeight);
  return Math.round((top + bottom) / 2);
}
function placePin() { if (S.view === 'report') { $('placePin').style.top = pinY() + 'px'; $('placePin').style.left = (wide() ? (innerWidth + 450) / 2 : innerWidth / 2) + 'px'; } }
function publishReport() {
  const c = map.unproject([wide() ? (innerWidth + 450) / 2 : innerWidth / 2, pinY()]);
  const r = { id: 'r' + Date.now(), type: S.draftType, note: ($('note')?.value || '').trim(), lng: c.lng, lat: c.lat, created: Date.now(), still: 1, fixed: 0, myVote: 'still' };
  S.reports.push(r); saveReports(); drawReports();
  toast(L('Reporte publicado. ¡Gracias!'));
  show(cur() ? 'route' : null);
}
function openReport(r) { if (!r) return; S.current = r; show('reportView'); S.fit = null; map.easeTo({ center: [r.lng, r.lat], zoom: Math.max(map.getZoom(), 15) }); }
function vote(v) {
  const r = S.current;
  if (r.myVote) return;
  r[v] += 1; r.myVote = v; saveReports(); drawReports(); rerender();
}
function drawReports() {
  markers.reports.forEach((m) => m.remove()); markers.reports = [];
  if (!S.layers.reports) return;
  for (const r of activeReports()) {
    const el = pinEl('rep', '!');
    el.setAttribute('role', 'button'); el.setAttribute('aria-label', REPORT_TYPES[r.type].label);
    el.addEventListener('click', (e) => { e.stopPropagation(); if (!N.on) openReport(r); });
    markers.reports.push(new maplibregl.Marker({ element: el }).setLngLat([r.lng, r.lat]).addTo(map));
  }
}

// ---------------------------------------------------------------- navigation (follow the route with GPS)
const N = { on: false, route: null, watch: null, wake: null, sim: null, follow: true, idx: 0, progress: 0, offCount: 0, rerouting: false, lastReroute: 0, said: {}, marker: null, lastPos: null, first: true, man: null, nameFor: null };
function navPadding() {
  return { top: Math.round(innerHeight * 0.42), bottom: $('navBottom').offsetHeight + 16, left: 0, right: 0 };
}
async function requestWake() {
  try { if ('wakeLock' in navigator && document.visibilityState === 'visible') N.wake = await navigator.wakeLock.request('screen'); } catch { /* not supported or denied */ }
}
document.addEventListener('visibilitychange', () => { if (N.on && document.visibilityState === 'visible') requestWake(); });
let voices = [];
function loadVoices() { voices = window.speechSynthesis?.getVoices?.() || []; }
if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function speak(txt) {
  if (!S.prefs.voice || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(txt);
    u.lang = LANG === 'en' ? 'en-US' : 'es-CO';
    u.voice = LANG === 'en' ? voices.find((v) => v.lang?.startsWith('en')) || null : voices.find((v) => v.lang === 'es-CO') || voices.find((v) => v.lang?.startsWith('es')) || null;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch { /* ignore */ }
}
function startNav() {
  const r = cur();
  if (!r) return;
  if (!SIM && !navigator.geolocation) { toast(L('Tu navegador no permite ubicación.')); return; }
  Object.assign(N, { on: true, route: r, follow: true, idx: 0, progress: 0, offCount: 0, said: {}, first: true, man: null });
  N.viaAt = (S.via?.pts || []).map((p) => ({ p, at: snapTo(r, p, 0).along }));
  document.body.classList.add('navigating');
  $('nav').hidden = false;
  $('sheet').hidden = true; $('placePin').hidden = true;
  hideSuggest();
  map.getSource('route-alt').setData({ type: 'FeatureCollection', features: [] });
  highlight(null);
  if (!N.marker) {
    const el = document.createElement('div'); el.className = 'me';
    el.innerHTML = '<div class="cone"></div><div class="dot"></div>';
    N.marker = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' });
  }
  $('navVoice').innerHTML = S.prefs.voice ? ICONS.sound : ICONS.mute;
  $('navRecenter').hidden = true;
  requestWake();
  N.said[r.id + ':' + r.man[0].i + 'f'] = 1; // the first turn is announced with the start message
  renderNav();
  setNavText(L('Buscando señal GPS…'), '');
  speak(L('Iniciando {m}. {min} minutos.', { m: MODES[S.mode].label.toLowerCase(), min: Math.round(rTime(r) / 60) }) + (r.man[0].arrive ? '' : ' ' + L('{t} en {n} metros.', { t: manText(r.man[0]), n: Math.round(r.man[0].at / 10) * 10 })));
  // start from the beginning of the route until the first GPS fix arrives
  map.easeTo({ center: r.coords[0], zoom: 17, pitch: 45, bearing: bearing(r.coords[0], r.coords[Math.min(3, r.coords.length - 1)]), padding: navPadding(), duration: 800 });
  if (SIM) startSim();
  else N.watch = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
}
function stopNav(arrived) {
  if (!N.on) return;
  N.on = false;
  if (N.watch != null) navigator.geolocation.clearWatch(N.watch);
  clearInterval(N.sim); N.watch = null; N.sim = null;
  try { N.wake?.release(); } catch { /* ignore */ }
  N.wake = null;
  window.speechSynthesis?.cancel();
  N.marker?.remove();
  document.body.classList.remove('navigating');
  $('nav').hidden = true;
  map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
  map.getSource('route').setData(routeFC(cur()));
  show(arrived ? 'arrived' : 'route');
  drawRoutes(true);
}
function onPosErr(e) {
  if (e.code === 1) { toast(L('Sin permiso de ubicación. Actívalo en el navegador para navegar.'), 5000); stopNav(); }
  else setNavText(L('Sin señal GPS…'), L('Sigue la línea en el mapa.'));
}
// nearest point on the route, searching first around the last known position
function snapTo(r, p, hint) {
  let best = { d: Infinity };
  const scan = (a, b) => {
    for (let i = Math.max(0, a); i < Math.min(r.coords.length - 1, b); i++) {
      const q = proj(p, r.coords[i], r.coords[i + 1]);
      if (q.d < best.d) best = { d: q.d, i, p: q.p, along: r.cum[i] + q.t * (r.cum[i + 1] - r.cum[i]) };
    }
  };
  scan(hint - 5, hint + 400);
  if (best.d > 40) scan(0, r.coords.length);
  return best;
}
function onPos(pos) {
  if (!N.on) return;
  const c = pos.coords, pt = [c.longitude, c.latitude], acc = c.accuracy || 20;
  N.lastPos = pt;
  const r = N.route;
  const s = snapTo(r, pt, N.idx);
  const limit = Math.max(30, Math.min(acc, 60));
  if (s.d > limit) N.offCount++; else N.offCount = 0;
  if ((N.first && s.d > 80) || N.offCount >= 3) reroute(pt);
  N.first = false;
  if (s.d <= limit) { N.idx = s.i; N.progress = Math.max(N.progress - 30, s.along); }
  const moving = c.speed != null && c.speed > 1.5 && c.heading != null && !isNaN(c.heading);
  const hd = moving ? c.heading : bearing(r.coords[Math.max(0, N.idx)], r.coords[Math.min(r.coords.length - 1, N.idx + 1)]);
  const shown = s.d < 20 ? s.p : pt;
  N.marker.setLngLat(shown).setRotation(hd).addTo(map);
  if (N.follow) map.easeTo({ center: shown, bearing: hd, pitch: 45, zoom: 17, padding: navPadding(), duration: 950, easing: (t) => t });
  renderNav();
  const toB = dist(pt, [S.B.lng, S.B.lat]);
  if (toB < 25 || (r.length - N.progress < 20 && s.d < limit)) { speak(L('Llegaste a tu destino.')); stopNav(true); }
}
async function reroute(pt) {
  if (N.rerouting || Date.now() - N.lastReroute < 15000) return;
  N.rerouting = true; N.lastReroute = Date.now(); N.offCount = 0;
  setNavText(L('Recalculando la ruta…'), '');
  speak(L('Recalculando'));
  try {
    const ahead = (N.viaAt || []).filter((v) => v.at > N.progress + 30).map((v) => v.p);
    const r = await brouter(MODES[S.mode].profile, [pt, ...ahead, [S.B.lng, S.B.lat]]);
    if (!N.on) return;
    Object.assign(N, { route: r, idx: 0, progress: 0, said: {}, man: null });
    N.viaAt = ahead.map((p) => ({ p, at: snapTo(r, p, 0).along }));
    map.getSource('route').setData(routeFC(r));
    renderNav();
  } catch { toast(L('No pude recalcular. Sigue hacia el destino.')); }
  finally { N.rerouting = false; }
}
function timeLeft(r, prog) {
  if (!r.times) return r.time * (1 - prog / r.length) * pace();
  const i = Math.max(0, N.idx), seg = r.cum[i + 1] - r.cum[i] || 1;
  const t = r.times[i] + Math.max(0, Math.min(1, (prog - r.cum[i]) / seg)) * ((r.times[i + 1] ?? r.times[i]) - r.times[i]);
  return Math.max(0, r.times[r.times.length - 1] - t) * pace();
}
function setNavText(text, next) { $('navText').textContent = text; if (next != null) $('navNext').textContent = next; $('navNext').hidden = !$('navNext').textContent; }
function renderNav() {
  const r = N.route, prog = N.progress;
  const mi = r.man.findIndex((m) => m.at > prog + 8);
  const m = r.man[mi < 0 ? r.man.length - 1 : mi];
  const dTo = Math.max(0, m.at - prog);
  const name = m.arrive ? S.B.label : S.names.get(turnKey(r, m));
  if (N.man !== m) { // new maneuver: fetch its street name and the following one
    N.man = m;
    for (const x of [m, r.man[mi + 1]]) if (x && !x.arrive && !S.names.has(turnKey(r, x))) turnName(r, x).then(() => { if (N.on && N.man === m) renderNav(); });
  }
  $('navIcon').innerHTML = manIcon(m);
  $('navDist').textContent = fmtM(dTo);
  const nx = r.man[mi + 1];
  let next = nx && nx.at - m.at < 200 ? L('Luego: {t}', { t: lc(manText(nx)) }) : '';
  if (!N.rerouting) setNavText(`${manText(m)}${name ? (m.arrive ? ': ' + name : ' ' + L('por {n}', { n: name })) : ''}`, next);
  // what kind of path you are on now, and when it changes
  const si = r.segs.findIndex((s) => r.cum[s.i1] > prog);
  const seg = r.segs[si < 0 ? r.segs.length - 1 : si];
  let change = null;
  for (let k = si + 1; si >= 0 && k < r.segs.length; k++) if (r.segs[k].t !== seg.t && r.segs[k].d >= 40) { change = r.segs[k]; break; }
  const dChange = change ? r.cum[change.i0] - prog : 0;
  $('navType').innerHTML = `<span class="sw ${seg.t}"></span><span>${TYPES[seg.t].label}${change && dChange < 2000 ? ` <em>· ${esc(L('{t} en {d}', { t: lc(TYPES[change.t].short), d: fmtM(dChange) }))}</em>` : ''}</span>`;
  const left = timeLeft(r, prog);
  $('navTime').textContent = fmtMin(left);
  $('navRest').textContent = `${fmtKm(Math.max(0, r.length - prog))} · ${L('llegas {t}', { t: clock(new Date(Date.now() + left * 1000)) })}`;
  // voice prompts
  const id = r.id + ':' + m.i;
  if (!m.arrive && !N.rerouting) {
    if (dTo < 170 && dTo > 70 && !N.said[id + 'f']) { N.said[id + 'f'] = 1; speak(L('En {n} metros, {t}', { n: Math.round(dTo / 50) * 50, t: lc(manText(m)) }) + (name ? ' ' + L('por {n}', { n: name }) : '')); }
    else if (dTo <= 35 && !N.said[id + 'n']) { N.said[id + 'n'] = 1; N.said[id + 'f'] = 1; speak(manText(m)); navigator.vibrate?.([70, 50, 70]); }
  }
  if (change && change.t === 'ca' && dChange < 120 && dChange > 20 && !N.said[r.id + 'ca' + change.i0]) {
    N.said[r.id + 'ca' + change.i0] = 1;
    if (!(dTo < 170 && Math.abs(dTo - dChange) < 60)) speak(L('Atención: en {n} metros, tramo con carros.', { n: Math.round(dChange / 10) * 10 }));
  }
}
function startSim() {
  let d = 0;
  const speed = +(QS.get('simspeed') ?? 25); // metres per tick (one tick per second); 0 = positions come from the test
  if (!(speed > 0)) return;
  N.sim = setInterval(() => {
    if (!N.on) return;
    d += speed;
    const p = pointAtDist(N.route, Math.min(d, N.route.length));
    onPos({ coords: { longitude: p[0], latitude: p[1], accuracy: 5, speed: null, heading: null } });
    if (d > N.route.length + speed) clearInterval(N.sim);
  }, 1000);
}
function wireNav() {
  $('navExit').addEventListener('click', () => stopNav());
  $('navVoice').addEventListener('click', () => {
    S.prefs.voice = !S.prefs.voice; LS.set('bb_prefs', S.prefs);
    $('navVoice').innerHTML = S.prefs.voice ? ICONS.sound : ICONS.mute;
    toast(S.prefs.voice ? L('Voz activada') : L('Voz desactivada'), 1500);
    if (!S.prefs.voice) window.speechSynthesis?.cancel();
  });
  $('navOverview').addEventListener('click', () => { N.follow = false; $('navRecenter').hidden = false; fitTo(N.route.coords); });
  $('navRecenter').addEventListener('click', () => {
    N.follow = true; $('navRecenter').hidden = true;
    if (N.lastPos) map.easeTo({ center: N.marker.getLngLat(), zoom: 17, pitch: 45, bearing: N.marker.getRotation(), padding: navPadding(), duration: 600 });
  });
  $('navReport').addEventListener('click', () => { stopNav(); startReport(); });
}

// ---------------------------------------------------------------- IDU overlay (loaded per view from the city map server)
const IDU_URL = 'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/Mapa_Referencia/MapServer/18/query';
const SURFACE = { 0: 'Sin dato', 1: 'Concreto', 2: 'Asfalto', 3: 'Mixtos', 4: 'Adoquín concreto', 5: 'Adoquín arcilla' }; // translated when shown
const iduFeatures = new Map();
const iduDone = new Set();
async function loadIdu() {
  if (!S.layers.idu || map.getZoom() < 12.5) return;
  // load in 0.05° tiles so panning back and forth doesn't repeat requests
  const b = map.getBounds(), step = 0.05;
  const tiles = [];
  for (let x = Math.floor(b.getWest() / step); x <= Math.floor(b.getEast() / step); x++)
    for (let y = Math.floor(b.getSouth() / step); y <= Math.floor(b.getNorth() / step); y++)
      if (!iduDone.has(x + ',' + y)) tiles.push([x, y]);
  for (const [x, y] of tiles.slice(0, 12)) {
    iduDone.add(x + ',' + y);
    try {
      for (let offset = 0; offset < 4000; offset += 1000) {
        const q = new URLSearchParams({
          where: '1=1', geometry: `${x * step},${y * step},${(x + 1) * step},${(y + 1) * step}`, geometryType: 'esriGeometryEnvelope',
          inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'OBJECTID,CICTSUPERF', outSR: '4326', geometryPrecision: '6',
          resultOffset: String(offset), resultRecordCount: '1000', f: 'geojson',
        });
        const j = await (await fetchT(`${IDU_URL}?${q}`, {}, 20000)).json();
        for (const f of j.features || []) if (f.geometry) iduFeatures.set(f.id ?? f.properties.OBJECTID, { type: 'Feature', properties: { s: SURFACE[f.properties.CICTSUPERF] ?? 'Sin dato' }, geometry: f.geometry });
        if (!j.properties?.exceededTransferLimit && !j.exceededTransferLimit) break;
      }
    } catch (e) { iduDone.delete(x + ',' + y); console.warn('IDU', e); }
  }
  map.getSource('idu')?.setData({ type: 'FeatureCollection', features: [...iduFeatures.values()] });
}

// ---------------------------------------------------------------- places for cyclists (Overpass / OpenStreetMap)
// Bike shops and workshops, self-service repair stations, air pumps and "montallantas" (tyre shops, which
// in Colombia also fix bike punctures). Search near the rider, or along the current route.
const SVC = {
  repair: { get label() { return L('Talleres'); }, get one() { return L('Taller de bicicletas'); }, icon: ICONS.wrench, cls: 'shop' },
  station: { get label() { return L('Estaciones'); }, get one() { return L('Estación de reparación'); }, icon: ICONS.wrench, cls: 'station' },
  air: { get label() { return L('Aire'); }, get one() { return L('Aire / bomba'); }, icon: ICONS.pump, cls: 'air' },
  tyre: { get label() { return L('Montallantas'); }, get one() { return L('Montallanta'); }, icon: ICONS.tyre, cls: 'tyre' },
};
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const SV = { filter: 'all', where: 'near', list: [], loading: false, error: '', center: null, key: '' };
function svcKind(t) {
  if (t.shop === 'bicycle' || t['service:bicycle:repair'] === 'yes') return 'repair';
  if (t.amenity === 'bicycle_repair_station') return 'station';
  if (t.shop === 'tyres' || t.craft === 'tyre') return 'tyre';
  return 'air';
}
async function overpass(q) {
  let last;
  for (const u of OVERPASS) {
    try {
      const r = await fetchT(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 25000);
      if (r.ok) return await r.json();
      last = new Error('Overpass ' + r.status);
    } catch (e) { last = e; }
  }
  throw last;
}
function myPosition(ms = 7000) {
  return new Promise((ok) => {
    if (N.lastPos) return ok(N.lastPos);
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition((p) => ok([p.coords.longitude, p.coords.latitude]), () => ok(null), { enableHighAccuracy: false, timeout: ms, maximumAge: 120000 });
  });
}
function openServices(filter) {
  if (filter) SV.filter = filter;
  SV.where = cur() ? 'route' : 'near';
  show('services');
  loadServices();
}
async function loadServices() {
  const r = cur();
  const where = r ? SV.where : 'near';
  SV.loading = true; SV.error = ''; SV.list = [];
  if (S.view === 'services') rerender();
  const key = Math.random().toString(36);
  SV.key = key;
  let area, ref = null;
  if (where === 'route') {
    const b = new maplibregl.LngLatBounds(); r.coords.forEach((c) => b.extend(c));
    area = `(${(b.getSouth() - 0.004).toFixed(4)},${(b.getWest() - 0.004).toFixed(4)},${(b.getNorth() + 0.004).toFixed(4)},${(b.getEast() + 0.004).toFixed(4)})`;
  } else {
    ref = (await myPosition()) || map.getCenter().toArray();
    SV.center = ref;
    area = `(around:3000,${ref[1].toFixed(5)},${ref[0].toFixed(5)})`;
  }
  const q = `[out:json][timeout:25];(nwr["shop"="bicycle"]${area};nwr["service:bicycle:repair"="yes"]${area};nwr["amenity"="bicycle_repair_station"]${area};nwr["amenity"="compressed_air"]${area};nwr["service:bicycle:pump"="yes"]${area};nwr["shop"="tyres"]${area};nwr["craft"="tyre"]${area};);out center 400;`;
  try {
    const j = await overpass(q);
    if (SV.key !== key) return;
    const seen = new Set();
    let list = [];
    for (const el of j.elements || []) {
      const t = el.tags || {};
      const lng = el.lon ?? el.center?.lon, lat = el.lat ?? el.center?.lat;
      if (lng == null || seen.has(el.type + el.id)) continue;
      seen.add(el.type + el.id);
      const kind = svcKind(t);
      const p = { id: el.type + el.id, k: kind, get name() { return t.name || SVC[kind].one; }, kind: SVC[kind].one, lng, lat, hours: t.opening_hours, phone: t.phone || t['contact:phone'], address: [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' '), air: kind === 'air' || t['service:bicycle:pump'] === 'yes' || t.pump === 'yes' };
      if (where === 'route') {
        const s2 = snapTo(r, [lng, lat], 0);
        if (s2.d > 300) continue;
        p.off = s2.d; p.at = s2.along;
      } else p.d = dist(ref, [lng, lat]);
      list.push(p);
    }
    list.sort((a, b) => (where === 'route' ? a.at - b.at : a.d - b.d));
    SV.list = list.slice(0, 80);
  } catch (e) { console.warn(e); SV.error = 'No se pudieron cargar los lugares (el servidor de OpenStreetMap no respondió). Intenta de nuevo.'; } // message translated when shown
  SV.loading = false;
  if (S.view === 'services' || S.view === 'place') { if (S.view === 'services') rerender(); drawServices(true); }
}
const svcVisible = () => SV.list.filter((p) => SV.filter === 'all' || p.k === SV.filter || (SV.filter === 'air' && p.air) || (SV.filter === 'repair' && p.k === 'station'));
function drawServices(fit) {
  markers.services.forEach((m) => m.remove()); markers.services = [];
  if (!['services', 'place'].includes(S.view)) return;
  const vis = svcVisible();
  for (const p of vis) {
    const pe = pinEl(SVC[p.k].cls, SVC[p.k].icon);
    pe.setAttribute('role', 'button'); pe.setAttribute('aria-label', p.name);
    pe.addEventListener('click', (e) => { e.stopPropagation(); if (!N.on) openPlace(p); });
    markers.services.push(new maplibregl.Marker({ element: pe }).setLngLat([p.lng, p.lat]).addTo(map));
  }
  if (fit && vis.length) {
    const pts = vis.slice(0, 12).map((p) => [p.lng, p.lat]);
    if (SV.where === 'near' && SV.center && !cur()) pts.push(SV.center);
    if (cur() && SV.where === 'route') fitTo(cur().coords); else fitTo(pts, { maxZoom: 16 });
  }
}
function openPlace(p) {
  S.current = p;
  show('place');
  S.fit = null;
  map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 16), padding: { top: 0, bottom: (parseFloat($('sheet').style.height) || 0) / 2, left: 0, right: 0 }, duration: 500 });
  map.once('moveend', () => map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }));
}

function applyLayers() {
  const v = S.layers.idu ? 'visible' : 'none';
  for (const id of ['idu-line', 'idu-fill']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
  loadIdu(); drawReports();
}

// ---------------------------------------------------------------- map
const RASTER = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};
async function pickStyle() {
  const url = 'https://tiles.openfreemap.org/styles/positron';
  try { const r = await fetchT(url, {}, 5000); if (r.ok) return url; } catch { /* fall back */ }
  return RASTER;
}

function setLang(l) {
  LANG = l;
  LS.set('bb_lang', l);
  applyStatic();
  if (S.view) rerender();
  if (S.via && $('via').value) $('via').value = S.via.label;
  if (N.on) renderNav();
}

async function init() {
  applyStatic();
  map = new maplibregl.Map({ container: 'map', style: await pickStyle(), center: BOGOTA, zoom: 12, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false });
  map.touchZoomRotate.disableRotation();
  if (!matchMedia('(pointer: coarse)').matches) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  geoCtl = new maplibregl.GeolocateControl({ trackUserLocation: false, positionOptions: { enableHighAccuracy: true }, fitBoundsOptions: { maxZoom: 16 } });
  map.addControl(geoCtl, 'top-right');

  map.on('load', () => {
    map.addSource('idu', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: 'Ciclorrutas: IDU / IDECA (CC BY 4.0)' });
    map.addLayer({ id: 'idu-line', type: 'line', source: 'idu', paint: { 'line-color': '#7C3AED', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 15, 2.2], 'line-opacity': 0.75 } });
    map.addLayer({ id: 'idu-fill', type: 'fill', source: 'idu', minzoom: 15, paint: { 'fill-color': '#7C3AED', 'fill-opacity': 0.35 } });
    for (const id of ['route-alt', 'hl', 'route']) map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'route-alt', type: 'line', source: 'route-alt', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#8A948F', 'line-width': 5, 'line-opacity': 0.75 } });
    map.addLayer({ id: 'route-alt-hit', type: 'line', source: 'route-alt', paint: { 'line-color': '#000', 'line-width': 24, 'line-opacity': 0 } });
    map.addLayer({ id: 'hl', type: 'line', source: 'hl', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#17201C', 'line-width': 18, 'line-opacity': 0.55 } });
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 10 } });
    map.addLayer({ id: 'route', type: 'line', source: 'route', filter: ['!=', ['get', 't'], 'ca'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 6 } });
    map.addLayer({ id: 'route-ca', type: 'line', source: 'route', filter: ['==', ['get', 't'], 'ca'], layout: { 'line-join': 'round' }, paint: { 'line-color': TYPES.ca.color, 'line-width': 5, 'line-dasharray': [1.6, 1.1] } });
    map.on('click', 'idu-fill', (e) => {
      if (S.view === 'report' || N.on) return;
      new maplibregl.Popup({ offset: 8 }).setLngLat(e.lngLat).setHTML(`<strong>${L('Ciclorruta oficial (IDU)')}</strong><br>${esc(L('Superficie: {s}', { s: L(e.features[0].properties.s) }))}`).addTo(map);
      e.preventDefault();
    });
    // tap a grey alternative to switch to it
    map.on('click', 'route-alt-hit', (e) => {
      if (S.view === 'report' || N.on) return;
      const k = e.features[0]?.properties?.mode;
      if (k && S.routes[k]) { S.mode = k; S.sel = null; show('route'); drawRoutes(true); e.preventDefault(); }
    });
    drawReports(); loadIdu();
    // ?a=lat,lng&b=lat,lng opens a route directly (shared links and testing)
    const parse = (v) => { const [lat, lng] = (v || '').split(',').map(Number); return isFinite(lat) && isFinite(lng) && v ? { lat, lng } : null; };
    const a = parse(QS.get('a')), b = parse(QS.get('b'));
    const vpts = (QS.get('v') || '').split(';').map(parse).filter(Boolean).map((p) => [p.lng, p.lat]);
    const via = vpts.length ? { label: QS.get('vn') || L('Punto de paso'), street: QS.get('vs') === '1', pts: vpts } : null;
    if (a && b) openRoute({ ...a, label: QS.get('an') || L('Origen') }, { ...b, label: QS.get('bn') || L('Destino') }, via);
    else if (S.saved.length) show('home');
  });
  map.on('click', (e) => {
    if (e.defaultPrevented || S.view === 'report' || N.on) return;
    hideSuggest();
    if (!S.A) setPoint('A', e.lngLat);
    else if (!S.B) setPoint('B', e.lngLat);
    else if (S.viaPending) setViaPoint(e.lngLat);
    else if (!$('sheet').hidden && S.snap !== 'peek' && !wide()) setSnap('peek');
  });
  // long-press (or right click) on the map adds a point the route must pass through
  map.on('contextmenu', (e) => {
    if (N.on || S.view === 'report' || !S.A || !S.B) return;
    setViaPoint(e.lngLat);
    toast(L('La ruta pasará por ese punto. Arrástralo para ajustarlo.'));
  });
  map.on('movestart', (e) => {
    if (!e.originalEvent) return;
    S.fit = null;
    if (N.on && N.follow) { N.follow = false; $('navRecenter').hidden = false; }
  });
  map.on('moveend', () => {
    loadIdu();
  });
  map.on('move', () => { if (S.view === 'report') placePin(); });

  wireSearch(); wireSheet(); wireSheetDrag(); wireNav();
  $('viaClear').addEventListener('click', () => clearVia());
  $('swap').addEventListener('click', () => {
    const a = S.A, b = S.B;
    S.A = b; S.B = a;
    if (S.via) { S.via = { ...S.via, pts: [...S.via.pts].reverse() }; drawVia(); }
    for (const w of ['A', 'B']) { if (markers[w]) markers[w].remove(); markers[w] = null; if (S[w]) makeMarker(w, S[w]); }
    $('from').value = S.A?.label || ''; $('to').value = S.B?.label || '';
    if (S.A && S.B) computeRoutes();
  });
  $('gps').addEventListener('click', () => {
    if (!navigator.geolocation) return toast(L('Tu navegador no permite ubicación.'));
    toast(L('Buscando tu ubicación…'));
    navigator.geolocation.getCurrentPosition(
      (p) => { const ll = { lng: p.coords.longitude, lat: p.coords.latitude }; if (!S.B) map.flyTo({ center: [ll.lng, ll.lat], zoom: 15 }); setPoint('A', ll, L('Mi ubicación')); },
      () => toast(L('No pude obtener tu ubicación. Revisa los permisos.')),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
  $('locateBtn').addEventListener('click', () => { S.fit = null; geoCtl.trigger(); });
  $('layersBtn').addEventListener('click', () => show(S.view === 'layers' ? (cur() ? 'route' : null) : 'layers'));
  $('reportFab').addEventListener('click', startReport);
  $('svcBtn').addEventListener('click', () => (S.view === 'services' ? show(cur() ? 'route' : null) : openServices()));
}

if (window.maplibregl) init();
else document.body.insertAdjacentHTML('beforeend', `<p style="position:fixed;top:40%;left:16px;right:16px;text-align:center">${L('No se pudo cargar el mapa. Revisa tu conexión.')}</p>`);
