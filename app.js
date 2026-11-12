// Bogotá Bici v0.3: a static app, no build step and no API keys.
// Free services called straight from the browser:
//   BRouter (routing + OSM way tags), Nominatim / Photon (place search),
//   IDU map server via IDECA (official ciclorruta network), Overpass (bike shops, pumps),
//   OpenFreeMap (base map, falls back to OSM raster tiles).
// Community reports are stored in this browser only until a Supabase project exists.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtKm = (m) => (m / 1000).toFixed(1).replace('.', ',') + ' km';
const fmtM = (m) => (m < 1000 ? Math.round(m / 10) * 10 + ' m' : fmtKm(m));

const BOGOTA = [-74.0721, 4.6611];
const BBOX = { w: -74.25, s: 4.45, e: -73.98, n: 4.85 };
const TYPES = {
  ex: { label: 'Ciclorruta exclusiva', short: 'Exclusiva', color: '#0B5D52' },
  sh: { label: 'Compartida con peatones', short: 'Con peatones', color: '#3B82C4' },
  pa: { label: 'Carril pintado', short: 'Pintado', color: '#E8A33D' },
  ca: { label: 'Con carros', short: 'Con carros', color: '#C2410C' },
};
const ORDER = ['ex', 'sh', 'pa', 'ca'];
const PROFILE = { infra: 'safety', fast: 'fastbike' };

const ICONS = {
  warn: '<svg viewBox="0 0 24 24"><path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
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
  routes: { infra: null, fast: null },
  mode: 'infra',
  view: null,                // 'route' | 'steps' | 'report' | 'reportView' | 'layers' | 'place' | 'loading' | 'error'
  layers: { idu: true, services: false, reports: true },
  reports: loadReports(),
  draftType: 'pothole',
  current: null,             // report or place being shown
  names: new Map(),          // street name cache
};
const markers = { A: null, B: null, reports: [], services: [] };
let map;

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
// distance in metres from point p to the polyline (flat approximation, fine at city scale)
function distToLine(p, coords) {
  const kx = 111320 * Math.cos(p[1] * Math.PI / 180), ky = 110540;
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = (coords[i][0] - p[0]) * kx, ay = (coords[i][1] - p[1]) * ky;
    const bx = (coords[i + 1][0] - p[0]) * kx, by = (coords[i + 1][1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const x = ax + t * dx, y = ay + t * dy;
    best = Math.min(best, Math.hypot(x, y));
  }
  return best;
}
function pinEl(cls, html) {
  const d = document.createElement('div');
  d.className = 'pin ' + cls; d.innerHTML = html; return d;
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
async function brouter(profile) {
  const ll = `${S.A.lng.toFixed(6)},${S.A.lat.toFixed(6)}|${S.B.lng.toFixed(6)},${S.B.lat.toFixed(6)}`;
  const res = await fetchT(`https://brouter.de/brouter?lonlats=${ll}&profile=${profile}&alternativeidx=0&format=geojson`, {}, 30000);
  const text = await res.text();
  if (!res.ok || !text.startsWith('{')) throw new Error(text.slice(0, 200) || `BRouter ${res.status}`);
  return parseRoute(JSON.parse(text));
}
function parseRoute(gj) {
  const f = gj.features[0];
  const coords = f.geometry.coordinates.map((c) => [c[0], c[1]]);
  const msgs = f.properties.messages;
  const H = msgs[0], iTags = H.indexOf('WayTags'), iDist = H.indexOf('Distance');
  const segs = []; // { t, d, coords }
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
      if (last && last.t === t) { last.d += d; last.coords.push(...coords.slice(from + 1, j + 1)); }
      else segs.push({ t, d, coords: coords.slice(from, j + 1) });
    } else if (segs.length) segs[segs.length - 1].d += d;
    from = j;
  }
  const length = +f.properties['track-length'];
  const totals = { ex: 0, sh: 0, pa: 0, ca: 0 };
  for (const s of segs) totals[s.t] += s.d;
  const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  const pct = {};
  for (const k of ORDER) pct[k] = Math.round((totals[k] / sum) * 100);
  return {
    coords, segs, totals, pct, length,
    time: +f.properties['total-time'],
    ascend: +f.properties['filtered ascend'] || 0,
    noCars: 100 - pct.ca,
  };
}

async function computeRoutes() {
  if (!S.A || !S.B) return;
  S.routes = { infra: null, fast: null };
  drawRoutes();
  show('loading');
  try {
    const [infra, fast] = await Promise.all([brouter(PROFILE.infra), brouter(PROFILE.fast)]);
    S.routes = { infra, fast };
    show('route');
    drawRoutes(true);
  } catch (e) {
    console.error(e);
    S.errorMsg = String(e.message || e);
    show('error');
  }
}

function drawRoutes(fit) {
  if (!map.getSource('route')) return;
  const main = S.routes[S.mode];
  const alt = S.routes[S.mode === 'infra' ? 'fast' : 'infra'];
  map.getSource('route-alt').setData({
    type: 'FeatureCollection',
    features: alt ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: alt.coords } }] : [],
  });
  map.getSource('route').setData({
    type: 'FeatureCollection',
    features: main ? main.segs.map((s) => ({ type: 'Feature', properties: { t: s.t, color: TYPES[s.t].color }, geometry: { type: 'LineString', coordinates: s.coords } })) : [],
  });
  if (fit && main) fitTo(main.coords);
}
function fitTo(coords) {
  const b = new maplibregl.LngLatBounds();
  coords.forEach((c) => b.extend(c));
  const sheetH = $('sheet').hidden ? 40 : $('sheet').offsetHeight;
  const wide = innerWidth >= 900;
  map.fitBounds(b, {
    padding: wide ? { top: 60, bottom: 60, left: 460, right: 80 } : { top: 150, bottom: Math.min(sheetH + 20, innerHeight * 0.65), left: 40, right: 64 },
    maxZoom: 16, duration: 600,
  });
}

function reportsNear(route) {
  if (!route) return [];
  return activeReports().filter((r) => distToLine([r.lng, r.lat], route.coords) < 35);
}

// ---------------------------------------------------------------- points A / B
function setPoint(which, lngLat, label) {
  S[which] = { lng: lngLat.lng, lat: lngLat.lat, label: label || 'Punto en el mapa' };
  if (markers[which]) markers[which].remove();
  const m = new maplibregl.Marker({ element: pinEl(which.toLowerCase(), which), draggable: true })
    .setLngLat([lngLat.lng, lngLat.lat]).addTo(map);
  m.on('dragend', () => { const p = m.getLngLat(); setPoint(which, p); });
  markers[which] = m;
  $(which === 'A' ? 'from' : 'to').value = S[which].label;
  if (!label) reverseName(lngLat).then((n) => { if (n && S[which] && S[which].lng === lngLat.lng) { S[which].label = n; $(which === 'A' ? 'from' : 'to').value = n; } });
  if (S.A && S.B) computeRoutes();
  else toast(which === 'A' ? 'Ahora elige el destino: búscalo o toca el mapa.' : 'Ahora elige el origen.');
}
function clearAll() {
  for (const w of ['A', 'B']) { if (markers[w]) markers[w].remove(); markers[w] = null; S[w] = null; }
  $('from').value = ''; $('to').value = '';
  S.routes = { infra: null, fast: null };
  drawRoutes(); show(null);
}

async function reverseName(ll) {
  try {
    const r = await fetchT(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${ll.lat}&lon=${ll.lng}&zoom=17&accept-language=es`);
    const j = await r.json();
    const a = j.address || {};
    return a.road ? `${a.road}${a.house_number ? ' ' + a.house_number : ''}` : (j.name || null);
  } catch { return null; }
}

// ---------------------------------------------------------------- search
let suggestFor = null, suggestTimer = null;
function wireSearch() {
  for (const [id, which] of [['from', 'A'], ['to', 'B']]) {
    const inp = $(id);
    inp.addEventListener('focus', () => inp.select());
    inp.addEventListener('input', () => {
      clearTimeout(suggestTimer);
      const q = inp.value.trim();
      if (q.length < 3) { hideSuggest(); return; }
      suggestTimer = setTimeout(() => photon(q, which), 450);
    });
  }
  $('search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const which = document.activeElement === $('to') ? 'B' : 'A';
    const q = $(which === 'A' ? 'from' : 'to').value.trim();
    if (q.length < 2) return;
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
  map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 14) });
  setPoint(which, { lng: p.lng, lat: p.lat }, p.name);
}

// ---------------------------------------------------------------- bottom sheet views
function show(view) {
  S.view = view;
  const sheet = $('sheet'), body = $('sheetBody');
  document.body.classList.toggle('has-sheet', !!view);
  $('placePin').hidden = view !== 'report';
  sheet.classList.toggle('tall', view === 'steps');
  if (!view) { sheet.hidden = true; return; }
  sheet.hidden = false;
  body.innerHTML = VIEWS[view]();
  sheet.scrollTop = 0;
  if (view === 'steps') loadStreetNames();
}

const bar = (pct) => `<div class="bar" role="img" aria-label="${ORDER.map((k) => `${TYPES[k].label} ${pct[k]} %`).join(', ')}">${ORDER.filter((k) => pct[k] > 0).map((k) => `<div class="${k}" style="width:${pct[k]}%"></div>`).join('')}</div>`;

const VIEWS = {
  loading: () => `<div class="stack"><div class="row" style="align-items:center;gap:12px"><div class="spin"></div><span>Buscando la ruta más rápida y la de más ciclorruta…</span></div></div>`,
  error: () => `<div class="stack"><strong>No se pudo calcular la ruta.</strong><span class="sub">${esc(S.errorMsg)}</span><div class="row"><button class="btn" data-act="clear">Limpiar</button><button class="btn primary" data-act="retry">Reintentar</button></div></div>`,
  route: () => {
    const r = S.routes[S.mode];
    const other = S.routes[S.mode === 'infra' ? 'fast' : 'infra'];
    const near = reportsNear(r);
    const diff = Math.round((r.time - other.time) / 60);
    const blurb = S.mode === 'infra'
      ? (diff > 0 ? `${diff} min más que la más rápida` : 'Igual de rápida que la más rápida')
      : (other.noCars > r.noCars ? `La de más ciclorruta va ${other.noCars} % sin carros` : 'También es la de más ciclorruta');
    const cls = r.noCars >= 70 ? 'good' : r.noCars >= 40 ? 'mid' : 'bad';
    return `<div class="stack">
      <div class="tabs">
        <button data-act="mode" data-mode="infra" aria-pressed="${S.mode === 'infra'}">Más ciclorruta</button>
        <button data-act="mode" data-mode="fast" aria-pressed="${S.mode === 'fast'}">Más rápida</button>
      </div>
      <div class="stats">
        <div><div style="display:flex;align-items:baseline;gap:10px"><span class="big">${Math.round(r.time / 60)} min</span><span class="sub">${fmtKm(r.length)}${r.ascend ? ` · ↑ ${r.ascend} m` : ''}</span></div>
        <span class="sub" style="font-size:13px">${blurb}</span></div>
        <span class="badge ${cls}">${r.noCars} % sin carros</span>
      </div>
      ${bar(r.pct)}
      <div class="legend">${ORDER.map((k) => `<div><span class="sw ${k}"></span><span>${TYPES[k].label}</span><b>${r.pct[k]} %</b></div>`).join('')}</div>
      ${near.length
        ? `<button class="alert" data-act="openReport" data-id="${near[0].id}">${ICONS.warn}<span style="flex:1"><strong>${near.length} ${near.length === 1 ? 'reporte activo' : 'reportes activos'} en esta ruta</strong><span>${esc(near.map((x) => REPORT_TYPES[x.type].label).join(' · '))}</span></span></button>`
        : `<div class="okline">${ICONS.check} Sin reportes activos en esta ruta</div>`}
      <div class="row"><button class="btn" data-act="clear">Limpiar</button><button class="btn primary" data-act="steps">Ver tramos</button></div>
      <span class="small">Tipos de vía según etiquetas de OpenStreetMap; pueden tener errores. Ruta: BRouter.</span>
    </div>`;
  },
  steps: () => {
    const r = S.routes[S.mode];
    const near = reportsNear(r);
    let km = 0;
    const items = tramos(r).map((s, i) => {
      const start = km; km += s.d;
      const reps = near.filter((x) => distToLine([x.lng, x.lat], s.coords) < 35);
      return `<li><div class="rail ${s.t}"></div><div class="body">
        <div class="top"><span id="nm${i}">${esc(S.names.get(key(s)) || 'Tramo ' + (i + 1))}</span><span>${fmtM(s.d)}</span></div>
        <span class="small">km ${(start / 1000).toFixed(1).replace('.', ',')} · ${TYPES[s.t].label}</span>
        ${reps.map((x) => `<span class="rep">⚠ ${esc(REPORT_TYPES[x.type].label)}</span>`).join('')}
        <button class="btn" style="height:32px;flex:none;width:auto;padding:0 10px;font-size:12px;align-self:flex-start;margin-top:4px" data-act="zoom" data-i="${i}">Ver en el mapa</button>
      </div></li>`;
    }).join('');
    return `<div class="stack">
      <div class="head"><button class="back" data-act="back" aria-label="Volver">${ICONS.back}</button><div><h2>Tramos de la ruta</h2><span class="sub">${S.mode === 'infra' ? 'Más ciclorruta' : 'Más rápida'} · ${Math.round(r.time / 60)} min · ${fmtKm(r.length)}</span></div></div>
      ${bar(r.pct)}
      <ol class="steps">${items}</ol>
      <span class="small">Nombres de calles aproximados (OpenStreetMap / Nominatim).</span>
    </div>`;
  },
  report: () => `<div class="stack">
      <div class="head"><button class="back" data-act="cancelReport" aria-label="Cancelar">${ICONS.close}</button><div><h2>¿Qué encontraste?</h2><span class="sub">Mueve el mapa para poner el pin en el sitio exacto.</span></div></div>
      <div class="cats">${Object.entries(REPORT_TYPES).map(([k, v]) => `<button data-act="cat" data-k="${k}" aria-pressed="${S.draftType === k}">${v.icon}${v.label}</button>`).join('')}</div>
      <div><label class="lbl" for="note">Detalle (opcional)</label><textarea id="note" rows="2" maxlength="280" placeholder="Ej.: hueco profundo en el carril sentido sur"></textarea></div>
      <button class="btn primary" data-act="publish">Publicar reporte</button>
      <span class="small" style="text-align:center">Por ahora los reportes se guardan solo en este teléfono.</span>
    </div>`,
  reportView: () => {
    const r = S.current, t = REPORT_TYPES[r.type];
    const total = r.still + r.fixed || 1;
    const ago = timeAgo(r.created);
    return `<div class="stack">
      <div class="head"><button class="back" data-act="${S.routes.infra ? 'backRoute' : 'close'}" aria-label="Volver">${ICONS.back}</button>
        <div><h2>${esc(t.label)}</h2><span class="sub">Reportado ${ago}</span></div></div>
      ${r.note ? `<p style="margin:0">${esc(r.note)}</p>` : ''}
      <div class="votes"><span><b>${r.still}</b> dicen que sigue ahí</span><span><b>${r.fixed}</b> dicen que ya está arreglado</span></div>
      <div class="vbar"><div style="width:${(r.still / total) * 100}%;background:var(--warn)"></div><div style="width:${(r.fixed / total) * 100}%;background:var(--brand)"></div></div>
      <strong style="font-size:14px">¿Pasaste por aquí hoy?</strong>
      <div class="row">
        <button class="btn warn" data-act="vote" data-v="still" ${r.myVote ? 'disabled' : ''}>Sigue ahí</button>
        <button class="btn ghost-ok" data-act="vote" data-v="fixed" ${r.myVote ? 'disabled' : ''}>Ya está arreglado</button>
      </div>
      ${r.myVote ? `<span class="small">Ya votaste: ${r.myVote === 'still' ? 'sigue ahí' : 'arreglado'}. ¡Gracias!</span>` : ''}
    </div>`;
  },
  layers: () => `<div class="stack">
      <div class="head"><button class="back" data-act="close" aria-label="Cerrar">${ICONS.close}</button><h2>Capas</h2></div>
      <div>
        <label class="toggle"><input type="checkbox" data-layer="idu" ${S.layers.idu ? 'checked' : ''}><span class="sw" style="background:var(--idu)"></span><span>Red oficial de ciclorrutas (IDU)<small>Datos IDU / IDECA, CC BY 4.0. Acércate para verla.</small></span></label>
        <label class="toggle"><input type="checkbox" data-layer="services" ${S.layers.services ? 'checked' : ''}><span class="sw" style="background:var(--ink)"></span><span>Talleres y bombas de aire<small>De OpenStreetMap. Acércate a una zona para cargarlos.</small></span></label>
        <label class="toggle"><input type="checkbox" data-layer="reports" ${S.layers.reports ? 'checked' : ''}><span class="sw" style="background:var(--warn)"></span><span>Reportes</span></label>
      </div>
      <div class="legend">${ORDER.map((k) => `<div><span class="sw ${k}"></span><span>${TYPES[k].label}</span></div>`).join('')}</div>
    </div>`,
  place: () => {
    const p = S.current;
    return `<div class="stack">
      <div class="head"><button class="back" data-act="close" aria-label="Cerrar">${ICONS.close}</button><div><h2>${esc(p.name)}</h2><span class="sub">${esc(p.kind)}</span></div></div>
      ${p.hours ? `<span class="sub">Horario: ${esc(p.hours)}</span>` : ''}
      ${p.address ? `<span class="sub">${esc(p.address)}</span>` : ''}
      <div class="row">
        <button class="btn primary" data-act="goPlace">Cómo llegar en bici</button>
        ${p.phone ? `<a class="btn" style="flex:none;width:110px;text-decoration:none;color:inherit" href="tel:${esc(p.phone.replace(/\s/g, ''))}">Llamar</a>` : ''}
      </div>
      <span class="small">Datos de OpenStreetMap. ¿Falta un taller? <a href="https://www.openstreetmap.org/edit#map=18/${p.lat}/${p.lng}" target="_blank" rel="noopener">Agrégalo</a>.</span>
    </div>`;
  },
};

function tramos(r) {
  // merge very short stretches (< 60 m) into the previous one so the list stays readable
  const out = [];
  for (const s of r.segs) {
    const last = out[out.length - 1];
    if (last && (s.d < 60 || last.t === s.t)) { last.d += s.d; last.coords = last.coords.concat(s.coords.slice(1)); }
    else out.push({ t: s.t, d: s.d, coords: s.coords.slice() });
  }
  return out;
}
const key = (s) => s.coords[Math.floor(s.coords.length / 2)].map((x) => x.toFixed(4)).join(',');
async function loadStreetNames() {
  const r = S.routes[S.mode];
  const list = tramos(r);
  for (let i = 0; i < list.length; i++) {
    if (S.view !== 'steps' || S.routes[S.mode] !== r) return;
    const k = key(list[i]);
    if (!S.names.has(k)) {
      const [lng, lat] = list[i].coords[Math.floor(list[i].coords.length / 2)];
      const n = await reverseName({ lng, lat });
      S.names.set(k, n || `Tramo ${i + 1}`);
      await new Promise((ok) => setTimeout(ok, 1100)); // Nominatim allows 1 request per second
    }
    const el = $('nm' + i);
    if (el) el.textContent = S.names.get(k);
  }
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

// sheet actions
function wireSheet() {
  $('sheetBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'mode') { S.mode = b.dataset.mode; show('route'); drawRoutes(true); }
    else if (act === 'steps') show('steps');
    else if (act === 'back' || act === 'backRoute') { show('route'); drawRoutes(true); }
    else if (act === 'clear') clearAll();
    else if (act === 'retry') computeRoutes();
    else if (act === 'close') show(S.routes.infra ? 'route' : null);
    else if (act === 'zoom') { const s = tramos(S.routes[S.mode])[+b.dataset.i]; fitTo(s.coords); }
    else if (act === 'cat') { S.draftType = b.dataset.k; $('sheetBody').querySelectorAll('[data-act="cat"]').forEach((x) => x.setAttribute('aria-pressed', x === b)); }
    else if (act === 'cancelReport') show(S.routes.infra ? 'route' : null);
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
    const l = e.target.dataset.layer;
    if (!l) return;
    S.layers[l] = e.target.checked;
    applyLayers();
  });
}

// ---------------------------------------------------------------- reports (local for now)
function loadReports() {
  try { return JSON.parse(localStorage.getItem('bb_reports') || '[]'); } catch { return []; }
}
function saveReports() { try { localStorage.setItem('bb_reports', JSON.stringify(S.reports)); } catch { /* private mode */ } }
function activeReports() {
  const month = 30 * 864e5;
  return S.reports.filter((r) => !(r.fixed >= 3 && r.fixed > r.still) && Date.now() - r.created < month);
}
function startReport() {
  S.draftType = 'pothole';
  show('report');
}
function publishReport() {
  // the pin is drawn at 40% of the screen height, centred
  const c = map.unproject([innerWidth / 2, innerHeight * 0.4]);
  const r = { id: 'r' + Date.now(), type: S.draftType, note: ($('note')?.value || '').trim(), lng: c.lng, lat: c.lat, created: Date.now(), still: 1, fixed: 0, myVote: 'still' };
  S.reports.push(r); saveReports(); drawReports();
  toast('Reporte publicado. ¡Gracias!');
  show(S.routes.infra ? 'route' : null);
}
function openReport(r) { if (!r) return; S.current = r; show('reportView'); map.easeTo({ center: [r.lng, r.lat], zoom: Math.max(map.getZoom(), 15) }); }
function vote(v) {
  const r = S.current;
  if (r.myVote) return;
  r[v] += 1; r.myVote = v; saveReports(); drawReports(); show('reportView');
}
function drawReports() {
  markers.reports.forEach((m) => m.remove()); markers.reports = [];
  if (!S.layers.reports) return;
  for (const r of activeReports()) {
    const el = pinEl('rep', '!');
    el.setAttribute('role', 'button'); el.setAttribute('aria-label', REPORT_TYPES[r.type].label);
    el.addEventListener('click', (e) => { e.stopPropagation(); openReport(r); });
    markers.reports.push(new maplibregl.Marker({ element: el }).setLngLat([r.lng, r.lat]).addTo(map));
  }
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
      pe.addEventListener('click', (e) => { e.stopPropagation(); S.current = p; show('place'); });
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
  map = new maplibregl.Map({ container: 'map', style: await pickStyle(), center: BOGOTA, zoom: 12, attributionControl: { compact: true } });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true, positionOptions: { enableHighAccuracy: true } }), 'top-right');

  map.on('load', () => {
    map.addSource('idu', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: 'Ciclorrutas: IDU / IDECA (CC BY 4.0)' });
    map.addLayer({ id: 'idu-line', type: 'line', source: 'idu', paint: { 'line-color': '#7C3AED', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 15, 2.2], 'line-opacity': 0.75 } });
    map.addLayer({ id: 'idu-fill', type: 'fill', source: 'idu', minzoom: 15, paint: { 'fill-color': '#7C3AED', 'fill-opacity': 0.35 } });
    map.addSource('route-alt', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'route-alt', type: 'line', source: 'route-alt', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#8A948F', 'line-width': 4, 'line-opacity': 0.8 } });
    map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 10 } });
    map.addLayer({ id: 'route', type: 'line', source: 'route', filter: ['!=', ['get', 't'], 'ca'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 6 } });
    map.addLayer({ id: 'route-ca', type: 'line', source: 'route', filter: ['==', ['get', 't'], 'ca'], layout: { 'line-join': 'round' }, paint: { 'line-color': TYPES.ca.color, 'line-width': 5, 'line-dasharray': [1.6, 1.1] } });
    map.on('click', 'idu-fill', (e) => {
      if (S.view === 'report') return;
      new maplibregl.Popup({ offset: 8 }).setLngLat(e.lngLat).setHTML(`<strong>Ciclorruta oficial (IDU)</strong><br>Superficie: ${esc(e.features[0].properties.s)}`).addTo(map);
      e.preventDefault();
    });
    drawReports(); loadIdu();
    // ?a=lat,lng&b=lat,lng opens a route directly (handy for testing and sharing)
    const qs = new URLSearchParams(location.search);
    const parse = (v) => { const [lat, lng] = (v || '').split(',').map(Number); return isFinite(lat) && isFinite(lng) && v ? { lat, lng } : null; };
    const a = parse(qs.get('a')), b = parse(qs.get('b'));
    if (a && b) { setPoint('A', a, qs.get('an') || 'Origen'); setPoint('B', b, qs.get('bn') || 'Destino'); }
  });
  map.on('click', (e) => {
    if (e.defaultPrevented || S.view === 'report') return;
    hideSuggest();
    if (!S.A) setPoint('A', e.lngLat);
    else if (!S.B) setPoint('B', e.lngLat);
  });
  map.on('moveend', () => {
    loadIdu();
    if (S.layers.services) { clearTimeout(init.t); init.t = setTimeout(loadServices, 700); }
  });

  wireSearch(); wireSheet();
  $('swap').addEventListener('click', () => {
    const a = S.A, b = S.B;
    for (const w of ['A', 'B']) { if (markers[w]) markers[w].remove(); markers[w] = null; }
    S.A = null; S.B = null;
    if (b) { S.A = null; setPointSilent('A', b); }
    if (a) setPointSilent('B', a);
    if (S.A && S.B) computeRoutes();
  });
  $('gps').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Tu navegador no permite ubicación.');
    toast('Buscando tu ubicación…');
    navigator.geolocation.getCurrentPosition(
      (p) => { const ll = { lng: p.coords.longitude, lat: p.coords.latitude }; map.flyTo({ center: [ll.lng, ll.lat], zoom: 15 }); setPoint('A', ll, 'Mi ubicación'); },
      () => toast('No pude obtener tu ubicación. Revisa los permisos.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
  $('layersBtn').addEventListener('click', () => show(S.view === 'layers' ? (S.routes.infra ? 'route' : null) : 'layers'));
  $('reportBtn').addEventListener('click', startReport);
  $('reportFab').addEventListener('click', startReport);
}
function setPointSilent(which, p) {
  S[which] = p;
  const m = new maplibregl.Marker({ element: pinEl(which.toLowerCase(), which), draggable: true }).setLngLat([p.lng, p.lat]).addTo(map);
  m.on('dragend', () => setPoint(which, m.getLngLat()));
  markers[which] = m;
  $(which === 'A' ? 'from' : 'to').value = p.label;
}

if (window.maplibregl) init();
else document.body.insertAdjacentHTML('beforeend', '<p style="position:fixed;top:40%;left:16px;right:16px;text-align:center">No se pudo cargar el mapa. Revisa tu conexión.</p>');

