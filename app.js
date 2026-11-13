// Bogotá Bici v0.4: a static app, no build step and no API keys.
// Free services called straight from the browser:
//   BRouter (routing, OSM way tags, turn hints), Nominatim / Photon (place search and street names),
//   IDU map server via IDECA (official ciclorruta network), Overpass (bike shops, pumps),
//   OpenFreeMap (base map, falls back to OSM raster tiles).
// Community reports are stored in this browser only until a Supabase project exists.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtKm = (m) => (m / 1000).toFixed(1).replace('.', ',') + ' km';
const fmtM = (m) => (m < 950 ? Math.max(10, Math.round(m / 10) * 10) + ' m' : fmtKm(m));
const fmtMin = (s) => { const m = Math.max(1, Math.round(s / 60)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const clock = (d) => d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const QS = new URLSearchParams(location.search);
const SIM = QS.has('sim'); // ?sim=1 replays the route instead of using GPS (for testing navigation at a desk)

const BOGOTA = [-74.0721, 4.6611];
const BBOX = { w: -74.25, s: 4.45, e: -73.98, n: 4.85 };
const TYPES = {
  ex: { label: 'Ciclorruta exclusiva', short: 'Exclusiva', color: '#0B5D52' },
  sh: { label: 'Compartida con peatones', short: 'Con peatones', color: '#3B82C4' },
  pa: { label: 'Carril pintado', short: 'Pintado', color: '#E8A33D' },
  ca: { label: 'Con carros', short: 'Con carros', color: '#C2410C' },
};
const ORDER = ['ex', 'sh', 'pa', 'ca'];
const MODES = {
  infra: { label: 'Más ciclorruta', profile: 'safety' },
  balanced: { label: 'Equilibrada', profile: 'trekking' },
  fast: { label: 'Más rápida', profile: 'fastbike' },
};
const MODE_KEYS = Object.keys(MODES);
const PACE = { calm: { label: 'Tranquilo', f: 1.2 }, normal: { label: 'Normal', f: 1 }, quick: { label: 'Rápido', f: 0.85 } };

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
  locate: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  round: '<svg viewBox="0 0 24 24"><circle cx="12" cy="10" r="4"/><path d="M12 22v-8M15 7l4-4M16 3h3v3"/></svg>',
  wrench: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6z"/></svg>',
  pump: '<svg viewBox="0 0 24 24"><path d="M8 21V7h6v5H8"/><path d="M14 9h3l2 3v6"/></svg>',
  pothole: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="14" rx="9" ry="4"/><path d="M7 13.5c1.5 1 3 1.2 5 1.2s3.5-.3 5-1.2"/></svg>',
  closure: '<svg viewBox="0 0 24 24"><path d="M3 10h18v5H3z"/><path d="M6 15v5M18 15v5M7 10l3-5M14 10l3-5"/></svg>',
  missing: '<svg viewBox="0 0 24 24"><path d="M3 12h6M15 12h6"/><path d="M10 9l4 6M14 9l-4 6"/></svg>',
  theft: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  other: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18" cy="12" r="1"/></svg>',
};
const REPORT_TYPES = {
  pothole: { label: 'Hueco', icon: ICONS.pothole },
  closure: { label: 'Obra o cierre', icon: ICONS.closure },
  missing: { label: 'Falta conexión', icon: ICONS.missing },
  danger: { label: 'Cruce peligroso', icon: ICONS.warn },
  theft: { label: 'Robo frecuente', icon: ICONS.theft },
  other: { label: 'Otro', icon: ICONS.other },
};

// ---------------------------------------------------------------- state
const S = {
  A: null, B: null,          // { lng, lat, label }
  routes: { infra: null, balanced: null, fast: null },
  alt: { infra: 0, balanced: 0, fast: 0 },
  mode: MODES[QS.get('m')] ? QS.get('m') : 'infra',
  view: null,                // see VIEWS
  snap: 'peek',              // bottom sheet: 'peek' | 'half' | 'full'
  layers: { idu: true, services: false, reports: true },
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
async function brouter(profile, from, to, alt = 0) {
  const ll = `${from.lng.toFixed(6)},${from.lat.toFixed(6)}|${to.lng.toFixed(6)},${to.lat.toFixed(6)}`;
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
  const res = await Promise.allSettled(MODE_KEYS.map((k) => brouter(MODES[k].profile, S.A, S.B)));
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
  toast('Buscando otra alternativa…', 2000);
  try {
    const r = await brouter(MODES[k].profile, S.A, S.B, idx);
    const same = S.routes[k] && Math.abs(r.length - S.routes[k].length) < 30;
    S.alt[k] = idx; S.routes[k] = r; S.sel = null;
    show('route'); drawRoutes(true);
    if (same) toast('Esta alternativa es casi igual a la anterior.');
  } catch { toast('No hay más alternativas para esta ruta.'); }
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
  const topEl = N.on ? $('navTop') : $('search');
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
  el.style.height = sheetHeights()[s] + 'px';
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
  S[which] = { lng: lngLat.lng, lat: lngLat.lat, label: label || 'Punto en el mapa' };
  makeMarker(which, S[which]);
  $(which === 'A' ? 'from' : 'to').value = S[which].label;
  if (!label) reverseName(lngLat).then((n) => { if (n && S[which] && S[which].lng === lngLat.lng) { S[which].label = n; $(which === 'A' ? 'from' : 'to').value = n; } });
  document.body.classList.toggle('has-route', !!(S.A && S.B));
  if (S.A && S.B) computeRoutes();
  else toast(which === 'A' ? 'Ahora elige el destino: búscalo o toca el mapa.' : 'Ahora elige el origen.');
}
function clearAll() {
  for (const w of ['A', 'B']) { if (markers[w]) markers[w].remove(); markers[w] = null; S[w] = null; }
  $('from').value = ''; $('to').value = '';
  S.routes = { infra: null, balanced: null, fast: null };
  S.fit = null;
  document.body.classList.remove('has-route');
  drawRoutes(); show(S.saved.length ? 'home' : null);
}

// ---------------------------------------------------------------- Nominatim (1 request per second, shared queue)
let nomQueue = Promise.resolve();
const nomCache = new Map();
function nomReverse(lat, lng, zoom, poly) {
  const k = `${zoom}${poly ? 'p' : ''}:${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (nomCache.has(k)) return nomCache.get(k);
  const p = nomQueue.then(async () => {
    try {
      const r = await fetchT(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}&zoom=${zoom}&accept-language=es${poly ? '&polygon_geojson=1&polygon_threshold=0.00003' : ''}`, {}, 8000);
      return await r.json();
    } catch { return null; }
  });
  nomQueue = p.then(() => new Promise((ok) => setTimeout(ok, 1100)));
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
  S.names.set(k, name || `${TYPES[s.t].label} sin nombre`);
  return S.names.get(k);
}
async function turnName(r, m) {
  if (m.arrive) return null;
  const k = 'turn:' + pointAtDist(r, m.at + 25).map((x) => x.toFixed(4)).join(',');
  if (S.names.has(k)) return S.names.get(k);
  const n = await streetAt(pointAtDist(r, m.at + 25));
  S.names.set(k, n);
  return n;
}

// ---------------------------------------------------------------- search
let suggestFor = null, suggestTimer = null;
function wireSearch() {
  for (const [id, which] of [['from', 'A'], ['to', 'B']]) {
    const inp = $(id);
    inp.addEventListener('focus', () => { inp.select(); if (!$('sheet').hidden && !wide()) setSnap('peek'); });
    inp.addEventListener('input', () => {
      clearTimeout(suggestTimer);
      const q = inp.value.trim();
      if (q.length < 3) { hideSuggest(); return; }
      suggestTimer = setTimeout(() => photon(q, which), 400);
    });
  }
  $('search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const which = document.activeElement === $('to') ? 'B' : 'A';
    const q = $(which === 'A' ? 'from' : 'to').value.trim();
    if (q.length < 2) return;
    if (suggestFor?.which === which && suggestFor.list.length && !$('suggest').hidden) { pickPlace(which, suggestFor.list[0]); return; }
    const list = await nominatim(q);
    if (list.length) pickPlace(which, list[0]); else toast('No encontré ese lugar en Bogotá.');
  });
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
    if (document.activeElement !== $(which === 'A' ? 'from' : 'to')) return;
    showSuggest(which, j.features.map((f) => {
      const p = f.properties;
      const name = p.name || [p.street, p.housenumber].filter(Boolean).join(' ');
      return { name, sub: [p.street !== name ? p.street : null, p.district || p.locality, p.city].filter(Boolean).join(', '), lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
    }).filter((p) => p.name));
  } catch { /* suggestions are optional; Enter still searches with Nominatim */ }
}
async function nominatim(q) {
  try {
    const u = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&viewbox=${BBOX.w},${BBOX.n},${BBOX.e},${BBOX.s}&bounded=1&limit=5&accept-language=es&countrycodes=co`;
    const j = await (await fetchT(u)).json();
    return j.map((r) => ({ name: r.name || r.display_name.split(',')[0], sub: r.display_name, lng: +r.lon, lat: +r.lat }));
  } catch { toast('La búsqueda no respondió. Intenta de nuevo.'); return []; }
}
function pickPlace(which, p) {
  hideSuggest();
  document.activeElement?.blur?.();
  const other = which === 'A' ? S.B : S.A;
  if (!other) map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 14) });
  setPoint(which, { lng: p.lng, lat: p.lat }, p.name);
}

// ---------------------------------------------------------------- bottom sheet views
const DEFAULT_SNAP = { route: 'peek', steps: 'half', report: 'half', layers: 'half', home: 'peek', place: 'half', reportView: 'half', loading: 'peek', error: 'half', arrived: 'half' };
function show(view, snap) {
  S.view = view;
  const sheet = $('sheet'), body = $('sheetBody');
  document.body.classList.toggle('has-sheet', !!view);
  $('placePin').hidden = view !== 'report';
  if (!view) { sheet.hidden = true; afterSheetMove(); return; }
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
const badge = (r) => `<span class="badge ${r.noCars >= 70 ? 'good' : r.noCars >= 40 ? 'mid' : 'bad'}">${r.noCars} % sin carros</span>`;
const ORD = ['', 'primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta'];
function manText(m) {
  if (m.arrive) return 'Llegas a tu destino';
  if (m.exit > 0) return `En la glorieta, toma la ${ORD[m.exit] || m.exit + '.ª'} salida`;
  if (m.cmd === 8) return 'Mantente a la izquierda';
  if (m.cmd === 9) return 'Mantente a la derecha';
  const a = Math.abs(m.angle), side = m.angle > 0 ? 'derecha' : 'izquierda';
  if (a < 25) return 'Sigue derecho';
  if (a < 55) return `Gira levemente a la ${side}`;
  if (a < 135) return `Gira a la ${side}`;
  if (a < 165) return `Gira cerrado a la ${side}`;
  return 'Da la vuelta en U';
}
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

const VIEWS = {
  loading: () => `<div class="stack"><div class="row" data-peek style="align-items:center;gap:12px;min-height:48px"><div class="spin"></div><span>Buscando rutas: más ciclorruta, equilibrada y más rápida…</span></div></div>`,
  error: () => `<div class="stack"><strong>No se pudo calcular la ruta.</strong><span class="sub">${esc(S.errorMsg)}</span><div class="row" data-peek><button class="btn" data-act="clear">Limpiar</button><button class="btn primary" data-act="retry">Reintentar</button></div></div>`,
  home: () => `<div class="stack">
      <div class="head"><h2>Mis rutas</h2></div>
      <ul class="saved">${S.saved.map((s, i) => `<li ${i === Math.min(1, S.saved.length - 1) ? 'data-peek' : ''}><button class="savedgo" data-act="openSaved" data-i="${i}">${ICONS.star}<span><strong>${esc(s.A.label)} → ${esc(s.B.label)}</strong><small>${esc(MODES[s.mode]?.label || '')}</small></span></button><button class="mini" data-act="delSaved" data-i="${i}" aria-label="Borrar">${ICONS.trash}</button></li>`).join('')}</ul>
      <span class="small">Para una ruta nueva, busca el origen y el destino arriba o toca el mapa.</span>
    </div>`,
  route: () => {
    const r = cur();
    const fast = S.routes.fast, infra = S.routes.infra;
    const eta = new Date(Date.now() + rTime(r) * 1000);
    const chips = MODE_KEYS.map((k) => {
      const x = S.routes[k];
      return `<button data-act="mode" data-mode="${k}" aria-pressed="${S.mode === k}" ${x ? '' : 'disabled'}><span>${MODES[k].label}</span><b>${x ? fmtMin(rTime(x)) : '—'}</b><small>${x ? x.noCars + ' % sin carros' : 'sin ruta'}</small></button>`;
    }).join('');
    let blurb = '';
    if (S.mode !== 'fast' && fast) { const d = Math.round((rTime(r) - rTime(fast)) / 60); blurb = d > 0 ? `${d} min más que la más rápida` : 'Igual de rápida que la más rápida'; }
    else if (infra && infra.noCars > r.noCars) blurb = `La de más ciclorruta va ${infra.noCars} % sin carros`;
    const ts = tramosOf(r);
    const worst = ts.map((s, i) => ({ s, i })).filter((x) => x.s.t === 'ca').sort((a, b) => b.s.d - a.s.d)[0];
    const near = reportsNear(r);
    return `<div class="stack">
      <div class="chips">${chips}</div>
      <div class="stats">
        <div class="statsmain"><span class="big">${fmtMin(rTime(r))}</span><span class="sub">${fmtKm(r.length)}${r.ascend ? ` · ↑ ${r.ascend} m` : ''} · llegas ${clock(eta)}</span></div>
        ${badge(r)}
      </div>
      ${bar(r.pct)}
      <div class="row" data-peek>
        <button class="btn primary" data-act="nav">${ICONS.go} Iniciar</button>
        <button class="btn" data-act="steps">${ICONS.list} Tramos</button>
      </div>
      ${blurb ? `<span class="sub">${blurb}${S.alt[S.mode] ? ` · alternativa ${S.alt[S.mode] + 1}` : ''}</span>` : ''}
      <div class="legend">${ORDER.map((k) => `<div><span class="sw ${k}"></span><span>${TYPES[k].short}</span><b>${r.pct[k]} %</b></div>`).join('')}</div>
      ${worst && worst.s.d >= 400 ? `<button class="alert" data-act="selTramo" data-i="${worst.i}">${ICONS.warn}<span style="flex:1"><strong>Tramo con carros más largo: ${fmtM(worst.s.d)}</strong><span>En el km ${(r.cum[worst.s.i0] / 1000).toFixed(1).replace('.', ',')}. Toca para verlo en el mapa.</span></span></button>` : ''}
      ${near.length
        ? `<button class="alert" data-act="openReport" data-id="${near[0].id}">${ICONS.warn}<span style="flex:1"><strong>${near.length} ${near.length === 1 ? 'reporte activo' : 'reportes activos'} en esta ruta</strong><span>${esc(near.map((x) => REPORT_TYPES[x.type].label).join(' · '))}</span></span></button>`
        : `<div class="okline">${ICONS.check} Sin reportes activos en esta ruta</div>`}
      <div class="tools">
        <button data-act="altRoute">${ICONS.alt}<span>Otra alternativa</span></button>
        <button data-act="save">${ICONS.star}<span>${isSaved() ? 'Guardada' : 'Guardar'}</span></button>
        <button data-act="share">${ICONS.share}<span>Compartir</span></button>
        <button data-act="clear">${ICONS.close}<span>Limpiar</span></button>
      </div>
      <span class="small">Tipos de vía según etiquetas de OpenStreetMap; pueden tener errores. Tiempos con ritmo ${PACE[S.prefs.pace].label.toLowerCase()} (cámbialo en Capas y opciones). Ruta: BRouter.</span>
    </div>`;
  },
  steps: () => {
    const r = cur();
    const near = reportsNear(r);
    const head = `<div class="head"><button class="back" data-act="back" aria-label="Volver">${ICONS.back}</button><div style="min-width:0"><h2>${MODES[S.mode].label}</h2><span class="sub">${fmtMin(rTime(r))} · ${fmtKm(r.length)} · ${r.noCars} % sin carros</span></div></div>
      <div class="tabs" ${S.sel == null ? 'data-peek' : ''}><button data-act="tab" data-tab="tramos" aria-pressed="${S.stepsTab === 'tramos'}">Tramos</button><button data-act="tab" data-tab="turns" aria-pressed="${S.stepsTab === 'turns'}">Indicaciones</button></div>`;
    if (S.stepsTab === 'tramos') {
      const ts = tramosOf(r);
      const selCard = S.sel != null && ts[S.sel] ? (() => {
        const s = ts[S.sel];
        return `<div class="selcard" data-peek><div class="rail ${s.t}"></div><div class="body"><div class="top"><span class="nm" data-k="${esc(key(s))}">${esc(S.names.get(key(s)) || 'Buscando nombre…')}</span><span>${fmtM(s.d)}</span></div><span class="small">Tramo ${S.sel + 1} de ${ts.length} · km ${(r.cum[s.i0] / 1000).toFixed(1).replace('.', ',')} · ${TYPES[s.t].label}</span></div>
          <div class="stepper"><button class="mini" data-act="selTramo" data-i="${S.sel - 1}" ${S.sel === 0 ? 'disabled' : ''} aria-label="Tramo anterior">${ICONS.back}</button><button class="mini" data-act="selTramo" data-i="${S.sel + 1}" ${S.sel === ts.length - 1 ? 'disabled' : ''} aria-label="Tramo siguiente" style="transform:scaleX(-1)">${ICONS.back}</button></div></div>`;
      })() : '';
      const items = ts.map((s, i) => {
        const reps = near.filter((x) => distToLine([x.lng, x.lat], s.coords) < 35);
        return `<li><button class="steprow${S.sel === i ? ' on' : ''}" data-act="selTramo" data-i="${i}"><div class="rail ${s.t}"></div><div class="body">
          <div class="top"><span class="nm" data-k="${esc(key(s))}">${esc(S.names.get(key(s)) || 'Buscando nombre…')}</span><span>${fmtM(s.d)}</span></div>
          <span class="small">km ${(r.cum[s.i0] / 1000).toFixed(1).replace('.', ',')} · ${TYPES[s.t].label}</span>
          ${reps.map((x) => `<span class="rep">⚠ ${esc(REPORT_TYPES[x.type].label)}</span>`).join('')}
        </div></button></li>`;
      }).join('');
      return `<div class="stack">${head}${selCard}${bar(r.pct)}<ol class="steps">${items}</ol>
        <span class="small">Toca un tramo para verlo en el mapa. Nombres de calles aproximados (OpenStreetMap / Nominatim).</span></div>`;
    }
    const list = [{ start: true, at: 0 }, ...r.man];
    const selCard = S.sel != null && list[S.sel] ? (() => {
      const m = list[S.sel];
      return `<div class="selcard" data-peek><div class="turnic">${m.start ? ICONS.go : manIcon(m)}</div><div class="body"><div class="top"><span>${m.start ? 'Sal de ' + esc(S.A.label) : esc(manText(m))}</span></div><span class="small tn" data-i="${S.sel}">${esc(m.start ? '' : S.names.get(turnKey(r, m)) || '')}</span></div>
        <div class="stepper"><button class="mini" data-act="selTurn" data-i="${S.sel - 1}" ${S.sel === 0 ? 'disabled' : ''} aria-label="Anterior">${ICONS.back}</button><button class="mini" data-act="selTurn" data-i="${S.sel + 1}" ${S.sel === list.length - 1 ? 'disabled' : ''} aria-label="Siguiente" style="transform:scaleX(-1)">${ICONS.back}</button></div></div>`;
    })() : '';
    const items = list.map((m, i) => {
      const next = list[i + 1];
      const leg = next ? next.at - m.at : 0;
      return `<li><button class="steprow${S.sel === i ? ' on' : ''}" data-act="selTurn" data-i="${i}"><div class="turnic">${m.start ? ICONS.go : manIcon(m)}</div><div class="body">
        <div class="top"><span>${m.start ? 'Sal de ' + esc(S.A.label) : esc(manText(m))}</span><span>${m.arrive ? '' : fmtM(leg)}</span></div>
        <span class="small tn" data-i="${i}">${m.start || m.arrive ? `km ${(m.at / 1000).toFixed(1).replace('.', ',')}` : esc(S.names.get(turnKey(r, m)) || '')}</span>
      </div></button></li>`;
    }).join('');
    return `<div class="stack">${head}${selCard}<ol class="steps turns">${items}</ol>
      <span class="small">Indicaciones de BRouter. Nombres de calles aproximados.</span></div>`;
  },
  report: () => `<div class="stack">
      <div class="head" data-peek><button class="back" data-act="cancelReport" aria-label="Cancelar">${ICONS.close}</button><div><h2>¿Qué encontraste?</h2><span class="sub">Mueve el mapa para poner el pin en el sitio exacto.</span></div></div>
      <div class="cats">${Object.entries(REPORT_TYPES).map(([k, v]) => `<button data-act="cat" data-k="${k}" aria-pressed="${S.draftType === k}">${v.icon}${v.label}</button>`).join('')}</div>
      <div><label class="lbl" for="note">Detalle (opcional)</label><textarea id="note" rows="2" maxlength="280" placeholder="Ej.: hueco profundo en el carril sentido sur"></textarea></div>
      <button class="btn primary" data-act="publish">Publicar reporte</button>
      <span class="small" style="text-align:center">Por ahora los reportes se guardan solo en este teléfono.</span>
    </div>`,
  reportView: () => {
    const r = S.current, t = REPORT_TYPES[r.type];
    const total = r.still + r.fixed || 1;
    return `<div class="stack">
      <div class="head"><button class="back" data-act="${cur() ? 'backRoute' : 'close'}" aria-label="Volver">${ICONS.back}</button>
        <div><h2>${esc(t.label)}</h2><span class="sub">Reportado ${timeAgo(r.created)}</span></div></div>
      ${r.note ? `<p style="margin:0">${esc(r.note)}</p>` : ''}
      <div class="votes"><span><b>${r.still}</b> dicen que sigue ahí</span><span><b>${r.fixed}</b> dicen que ya está arreglado</span></div>
      <div class="vbar"><div style="width:${(r.still / total) * 100}%;background:var(--warn)"></div><div style="width:${(r.fixed / total) * 100}%;background:var(--brand)"></div></div>
      <strong style="font-size:14px">¿Pasaste por aquí hoy?</strong>
      <div class="row" data-peek>
        <button class="btn warn" data-act="vote" data-v="still" ${r.myVote ? 'disabled' : ''}>Sigue ahí</button>
        <button class="btn ghost-ok" data-act="vote" data-v="fixed" ${r.myVote ? 'disabled' : ''}>Ya está arreglado</button>
      </div>
      ${r.myVote ? `<span class="small">Ya votaste: ${r.myVote === 'still' ? 'sigue ahí' : 'arreglado'}. ¡Gracias!</span>` : ''}
    </div>`;
  },
  layers: () => `<div class="stack">
      <div class="head" data-peek><button class="back" data-act="close" aria-label="Cerrar">${ICONS.close}</button><h2>Capas y opciones</h2></div>
      <div><label class="lbl">Tu ritmo (ajusta los tiempos)</label>
        <div class="tabs">${Object.entries(PACE).map(([k, v]) => `<button data-act="pace" data-k="${k}" aria-pressed="${S.prefs.pace === k}">${v.label}</button>`).join('')}</div></div>
      <div>
        <label class="toggle"><input type="checkbox" data-pref="voice" ${S.prefs.voice ? 'checked' : ''}><span>Voz durante la navegación<small>Anuncia giros y tramos con carros.</small></span></label>
        <label class="toggle"><input type="checkbox" data-layer="idu" ${S.layers.idu ? 'checked' : ''}><span class="sw" style="background:var(--idu)"></span><span>Red oficial de ciclorrutas (IDU)<small>Datos IDU / IDECA, CC BY 4.0. Acércate para verla.</small></span></label>
        <label class="toggle"><input type="checkbox" data-layer="services" ${S.layers.services ? 'checked' : ''}><span class="sw" style="background:var(--ink)"></span><span>Talleres y bombas de aire<small>De OpenStreetMap. Acércate a una zona para cargarlos.</small></span></label>
        <label class="toggle"><input type="checkbox" data-layer="reports" ${S.layers.reports ? 'checked' : ''}><span class="sw" style="background:var(--warn)"></span><span>Reportes</span></label>
      </div>
      <div class="legend">${ORDER.map((k) => `<div><span class="sw ${k}"></span><span>${TYPES[k].label}</span></div>`).join('')}</div>
      <span class="small">Rutas: “Más ciclorruta” usa el perfil safety de BRouter, “Equilibrada” el perfil trekking y “Más rápida” el perfil fastbike.</span>
    </div>`,
  place: () => {
    const p = S.current;
    return `<div class="stack">
      <div class="head"><button class="back" data-act="close" aria-label="Cerrar">${ICONS.close}</button><div><h2>${esc(p.name)}</h2><span class="sub">${esc(p.kind)}</span></div></div>
      ${p.hours ? `<span class="sub">Horario: ${esc(p.hours)}</span>` : ''}
      ${p.address ? `<span class="sub">${esc(p.address)}</span>` : ''}
      <div class="row" data-peek>
        <button class="btn primary" data-act="goPlace">Cómo llegar en bici</button>
        ${p.phone ? `<a class="btn" style="flex:none;width:110px;text-decoration:none;color:inherit" href="tel:${esc(p.phone.replace(/\s/g, ''))}">Llamar</a>` : ''}
      </div>
      <span class="small">Datos de OpenStreetMap. ¿Falta un taller? <a href="https://www.openstreetmap.org/edit#map=18/${p.lat}/${p.lng}" target="_blank" rel="noopener">Agrégalo</a>.</span>
    </div>`;
  },
  arrived: () => `<div class="stack">
      <div class="head" data-peek><div><h2>¡Llegaste!</h2><span class="sub">${esc(S.B?.label || '')}</span></div></div>
      <span class="sub">¿Encontraste algún problema en el camino? Repórtalo para avisar a otros ciclistas.</span>
      <div class="row"><button class="btn" data-act="backRoute">Cerrar</button><button class="btn warn" data-act="startReport">Reportar</button></div>
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
      document.querySelectorAll(`#sheetBody .tn[data-i="${i + 1}"]`).forEach((el) => { el.textContent = n ? 'por ' + n : ''; });
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
  if (m < 2) return 'hace un momento';
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

// ---------------------------------------------------------------- saved routes and sharing
const isSaved = () => S.A && S.B && S.saved.some((s) => dist([s.A.lng, s.A.lat], [S.A.lng, S.A.lat]) < 30 && dist([s.B.lng, s.B.lat], [S.B.lng, S.B.lat]) < 30);
function saveRoute() {
  if (isSaved()) { toast('Esta ruta ya está en Mis rutas.'); return; }
  S.saved.unshift({ A: S.A, B: S.B, mode: S.mode });
  S.saved = S.saved.slice(0, 12);
  LS.set('bb_saved', S.saved);
  toast('Ruta guardada. La verás en Mis rutas al abrir la app.');
  rerender();
}
function shareUrl() {
  const u = new URL(location.href.split('?')[0]);
  u.searchParams.set('a', `${S.A.lat.toFixed(6)},${S.A.lng.toFixed(6)}`);
  u.searchParams.set('b', `${S.B.lat.toFixed(6)},${S.B.lng.toFixed(6)}`);
  u.searchParams.set('an', S.A.label); u.searchParams.set('bn', S.B.label);
  u.searchParams.set('m', S.mode);
  return u.toString();
}
async function share() {
  const url = shareUrl();
  try {
    if (navigator.share) { await navigator.share({ title: 'Ruta en bici', text: `${S.A.label} → ${S.B.label}`, url }); return; }
    await navigator.clipboard.writeText(url); toast('Enlace copiado.');
  } catch (e) { if (e?.name !== 'AbortError') toast('No se pudo compartir.'); }
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
    else if (act === 'save') saveRoute();
    else if (act === 'share') share();
    else if (act === 'openSaved') { const s = S.saved[+b.dataset.i]; S.mode = s.mode || 'infra'; openRoute(s.A, s.B); }
    else if (act === 'delSaved') { S.saved.splice(+b.dataset.i, 1); LS.set('bb_saved', S.saved); show(S.saved.length ? 'home' : null); }
    else if (act === 'close') show(cur() ? 'route' : S.saved.length && !S.A ? 'home' : null);
    else if (act === 'pace') { S.prefs.pace = b.dataset.k; LS.set('bb_prefs', S.prefs); rerender(); }
    else if (act === 'cat') { S.draftType = b.dataset.k; $('sheetBody').querySelectorAll('[data-act="cat"]').forEach((x) => x.setAttribute('aria-pressed', x === b)); }
    else if (act === 'cancelReport') show(cur() ? 'route' : null);
    else if (act === 'startReport') startReport();
    else if (act === 'publish') publishReport();
    else if (act === 'openReport') openReport(S.reports.find((r) => r.id === b.dataset.id));
    else if (act === 'vote') vote(b.dataset.v);
    else if (act === 'goPlace') {
      const p = S.current;
      if (!S.A) toast('Elige también el origen.');
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
function openRoute(A, B) {
  makeMarker('A', A); makeMarker('B', B);
  S.A = A; S.B = B;
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
  if (N.lastPos) map.jumpTo({ center: N.lastPos });
  show('report');
}
// the placement pin sits in the middle of the map area left visible between the search box and the sheet
function pinY() {
  const top = $('search').getBoundingClientRect().bottom;
  const bottom = $('sheet').hidden || wide() ? innerHeight : innerHeight - (parseFloat($('sheet').style.height) || $('sheet').offsetHeight);
  return Math.round((top + bottom) / 2);
}
function placePin() { if (S.view === 'report') { $('placePin').style.top = pinY() + 'px'; $('placePin').style.left = (wide() ? (innerWidth + 450) / 2 : innerWidth / 2) + 'px'; } }
function publishReport() {
  const c = map.unproject([wide() ? (innerWidth + 450) / 2 : innerWidth / 2, pinY()]);
  const r = { id: 'r' + Date.now(), type: S.draftType, note: ($('note')?.value || '').trim(), lng: c.lng, lat: c.lat, created: Date.now(), still: 1, fixed: 0, myVote: 'still' };
  S.reports.push(r); saveReports(); drawReports();
  toast('Reporte publicado. ¡Gracias!');
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
    u.lang = 'es-CO';
    u.voice = voices.find((v) => v.lang === 'es-CO') || voices.find((v) => v.lang?.startsWith('es-')) || null;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch { /* ignore */ }
}
function startNav() {
  const r = cur();
  if (!r) return;
  if (!SIM && !navigator.geolocation) { toast('Tu navegador no permite ubicación.'); return; }
  Object.assign(N, { on: true, route: r, follow: true, idx: 0, progress: 0, offCount: 0, said: {}, first: true, man: null });
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
  setNavText('Buscando señal GPS…', '');
  speak(`Iniciando ${MODES[S.mode].label.toLowerCase()}. ${fmtMin(rTime(r)).replace('min', 'minutos')}. ${r.man[0].arrive ? '' : manText(r.man[0]) + ' en ' + fmtM(r.man[0].at).replace(' m', ' metros')}.`);
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
  if (e.code === 1) { toast('Sin permiso de ubicación. Actívalo en el navegador para navegar.', 5000); stopNav(); }
  else setNavText('Sin señal GPS…', 'Sigue la línea en el mapa.');
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
  if (toB < 25 || (r.length - N.progress < 20 && s.d < limit)) { speak('Llegaste a tu destino.'); stopNav(true); }
}
async function reroute(pt) {
  if (N.rerouting || Date.now() - N.lastReroute < 15000) return;
  N.rerouting = true; N.lastReroute = Date.now(); N.offCount = 0;
  setNavText('Recalculando la ruta…', '');
  speak('Recalculando');
  try {
    const r = await brouter(MODES[S.mode].profile, { lng: pt[0], lat: pt[1] }, S.B);
    if (!N.on) return;
    Object.assign(N, { route: r, idx: 0, progress: 0, said: {}, man: null });
    map.getSource('route').setData(routeFC(r));
    renderNav();
  } catch { toast('No pude recalcular. Sigue hacia el destino.'); }
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
  let next = nx && nx.at - m.at < 200 ? `Luego: ${manText(nx).toLowerCase()}` : '';
  if (!N.rerouting) setNavText(`${manText(m)}${name ? (m.arrive ? ': ' : ' por ') + name : ''}`, next);
  // what kind of path you are on now, and when it changes
  const si = r.segs.findIndex((s) => r.cum[s.i1] > prog);
  const seg = r.segs[si < 0 ? r.segs.length - 1 : si];
  let change = null;
  for (let k = si + 1; si >= 0 && k < r.segs.length; k++) if (r.segs[k].t !== seg.t && r.segs[k].d >= 40) { change = r.segs[k]; break; }
  const dChange = change ? r.cum[change.i0] - prog : 0;
  $('navType').innerHTML = `<span class="sw ${seg.t}"></span><span>${TYPES[seg.t].label}${change && dChange < 2000 ? ` <em>· ${TYPES[change.t].short.toLowerCase()} en ${fmtM(dChange)}</em>` : ''}</span>`;
  const left = timeLeft(r, prog);
  $('navTime').textContent = fmtMin(left);
  $('navRest').textContent = `${fmtKm(Math.max(0, r.length - prog))} · llegas ${clock(new Date(Date.now() + left * 1000))}`;
  // voice prompts
  const id = r.id + ':' + m.i;
  if (!m.arrive && !N.rerouting) {
    if (dTo < 170 && dTo > 70 && !N.said[id + 'f']) { N.said[id + 'f'] = 1; speak(`En ${Math.round(dTo / 50) * 50} metros, ${manText(m).toLowerCase()}${name ? ' por ' + name : ''}`); }
    else if (dTo <= 35 && !N.said[id + 'n']) { N.said[id + 'n'] = 1; N.said[id + 'f'] = 1; speak(manText(m)); navigator.vibrate?.([70, 50, 70]); }
  }
  if (change && change.t === 'ca' && dChange < 120 && dChange > 20 && !N.said[r.id + 'ca' + change.i0]) {
    N.said[r.id + 'ca' + change.i0] = 1;
    if (!(dTo < 170 && Math.abs(dTo - dChange) < 60)) speak(`Atención: en ${Math.round(dChange / 10) * 10} metros, tramo con carros.`);
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
    toast(S.prefs.voice ? 'Voz activada' : 'Voz desactivada', 1500);
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
const SURFACE = { 0: 'Sin dato', 1: 'Concreto', 2: 'Asfalto', 3: 'Mixtos', 4: 'Adoquín concreto', 5: 'Adoquín arcilla' };
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

// ---------------------------------------------------------------- services (Overpass)
let servicesKey = '';
async function loadServices() {
  markers.services.forEach((m) => m.remove()); markers.services = [];
  if (!S.layers.services) return;
  if (map.getZoom() < 13) { toast('Acércate más para ver talleres y bombas.'); return; }
  const b = map.getBounds();
  const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((v) => v.toFixed(3)).join(',');
  servicesKey = bbox;
  const q = `[out:json][timeout:20];(nwr["shop"="bicycle"](${bbox});nwr["amenity"="bicycle_repair_station"](${bbox});nwr["amenity"="compressed_air"](${bbox});nwr["service:bicycle:pump"="yes"](${bbox}););out center 300;`;
  try {
    const j = await (await fetchT('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 25000)).json();
    if (servicesKey !== bbox || !S.layers.services) return;
    for (const el of j.elements) {
      const t = el.tags || {};
      const lng = el.lon ?? el.center?.lon, lat = el.lat ?? el.center?.lat;
      if (lng == null) continue;
      const shop = t.shop === 'bicycle';
      const kind = shop ? 'Taller / tienda de bicicletas' : t.amenity === 'bicycle_repair_station' ? 'Punto de reparación' : 'Bomba de aire';
      const p = { name: t.name || kind, kind, lng, lat, hours: t.opening_hours, phone: t.phone || t['contact:phone'], address: [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ') };
      const pe = pinEl(shop ? 'shop' : 'air', shop ? ICONS.wrench : ICONS.pump);
      pe.setAttribute('role', 'button'); pe.setAttribute('aria-label', p.name);
      pe.addEventListener('click', (e) => { e.stopPropagation(); if (!N.on) { S.current = p; show('place'); } });
      markers.services.push(new maplibregl.Marker({ element: pe }).setLngLat([lng, lat]).addTo(map));
    }
    if (!j.elements.length) toast('No hay talleres ni bombas registrados en esta zona de OpenStreetMap.');
  } catch (e) { console.warn(e); toast('No se pudieron cargar los talleres (Overpass no respondió).'); }
}

function applyLayers() {
  const v = S.layers.idu ? 'visible' : 'none';
  for (const id of ['idu-line', 'idu-fill']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
  loadIdu(); drawReports(); loadServices();
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

async function init() {
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
      new maplibregl.Popup({ offset: 8 }).setLngLat(e.lngLat).setHTML(`<strong>Ciclorruta oficial (IDU)</strong><br>Superficie: ${esc(e.features[0].properties.s)}`).addTo(map);
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
    if (a && b) openRoute({ ...a, label: QS.get('an') || 'Origen' }, { ...b, label: QS.get('bn') || 'Destino' });
    else if (S.saved.length) show('home');
  });
  map.on('click', (e) => {
    if (e.defaultPrevented || S.view === 'report' || N.on) return;
    hideSuggest();
    if (!S.A) setPoint('A', e.lngLat);
    else if (!S.B) setPoint('B', e.lngLat);
    else if (!$('sheet').hidden && S.snap !== 'peek' && !wide()) setSnap('peek');
  });
  map.on('movestart', (e) => {
    if (!e.originalEvent) return;
    S.fit = null;
    if (N.on && N.follow) { N.follow = false; $('navRecenter').hidden = false; }
  });
  map.on('moveend', () => {
    loadIdu();
    if (S.layers.services && !N.on) { clearTimeout(init.t); init.t = setTimeout(loadServices, 700); }
  });
  map.on('move', () => { if (S.view === 'report') placePin(); });

  wireSearch(); wireSheet(); wireSheetDrag(); wireNav();
  $('swap').addEventListener('click', () => {
    const a = S.A, b = S.B;
    S.A = b; S.B = a;
    for (const w of ['A', 'B']) { if (markers[w]) markers[w].remove(); markers[w] = null; if (S[w]) makeMarker(w, S[w]); }
    $('from').value = S.A?.label || ''; $('to').value = S.B?.label || '';
    if (S.A && S.B) computeRoutes();
  });
  $('gps').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Tu navegador no permite ubicación.');
    toast('Buscando tu ubicación…');
    navigator.geolocation.getCurrentPosition(
      (p) => { const ll = { lng: p.coords.longitude, lat: p.coords.latitude }; if (!S.B) map.flyTo({ center: [ll.lng, ll.lat], zoom: 15 }); setPoint('A', ll, 'Mi ubicación'); },
      () => toast('No pude obtener tu ubicación. Revisa los permisos.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
  $('locateBtn').addEventListener('click', () => { S.fit = null; geoCtl.trigger(); });
  $('layersBtn').addEventListener('click', () => show(S.view === 'layers' ? (cur() ? 'route' : null) : 'layers'));
  $('reportFab').addEventListener('click', startReport);
}

if (window.maplibregl) init();
else document.body.insertAdjacentHTML('beforeend', '<p style="position:fixed;top:40%;left:16px;right:16px;text-align:center">No se pudo cargar el mapa. Revisa tu conexión.</p>');
