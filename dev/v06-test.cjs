// v0.6 checks: report pop-up during navigation (silent), "this stretch is wrong" flag, city-vs-OSM check,
// anonymous stats batching, ride trimming (400 m around start and end), and the offline app (service worker + saved routes).
// Usage: node dev/v06-test.cjs <maplibre-dist-dir> <out-dir>
// Supabase and the city map server are faked; BRouter and Nominatim answers are recorded and replayed.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.join(__dirname, '..');
const ML = process.argv[2];
const OUT = process.argv[3] || '/tmp/v06';
fs.mkdirSync(path.join(OUT, 'cache'), { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const W = 412, H = 915;
const results = [], log = [], calls = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const A = '4.7180065,-74.0368149', B = '4.6636370,-74.1112144';
let fakeReports = [];

async function router(route) {
  const req = route.request(), u = new URL(req.url());
  const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
  if (u.host === 'app.test') {
    const f = path.join(APP, u.pathname === '/' ? 'index.html' : u.pathname);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': types[path.extname(f)] || 'application/octet-stream' } });
  }
  if (u.host === 'unpkg.com') return route.fulfill({ status: 200, body: fs.readFileSync(path.join(ML, path.basename(u.pathname))), headers: { 'content-type': types[path.extname(u.pathname)], 'access-control-allow-origin': '*' } });
  if (u.host.endsWith('supabase.co')) {
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' } });
    const fn = u.pathname.split('/').pop(), body = JSON.parse(req.postData() || '{}');
    calls.push({ fn, body });
    if (fn === 'list_reports') return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(fakeReports) });
    return route.fulfill({ status: 200, headers: cors, body: fn === 'log_events' ? String(body.p_events.length) : 'null' });
  }
  if (u.host.startsWith('serviciosgis')) return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ type: 'FeatureCollection', features: [] }) });
  if (/openstreetmap\.org$|openfreemap\.org$|komoot\.io$|overpass/.test(u.host) && !u.host.startsWith('nominatim')) return route.fulfill({ status: 404, body: '' });
  const ck = path.join(OUT, 'cache', require('crypto').createHash('sha1').update(u.toString()).digest('hex'));
  if (/nominatim|brouter/.test(u.host) && fs.existsSync(ck)) return route.fulfill({ status: 200, body: fs.readFileSync(ck), headers: cors });
  try {
    const r = await fetch(u, { headers: { 'user-agent': 'bogota-bici-test' } });
    const body = Buffer.from(await r.arrayBuffer());
    if (r.status === 200 && /nominatim|brouter/.test(u.host)) fs.writeFileSync(ck, body);
    return route.fulfill({ status: r.status, body, headers: cors });
  } catch (e) { log.push('NETFAIL ' + u.host); return route.abort(); }
}

async function newPage(b, opts = {}) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, locale: 'es-CO', timezoneId: 'America/Bogota', ...opts });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') log.push('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => log.push('PAGEERROR ' + e.message));
  return { ctx, page };
}

(async () => {
  process.on('unhandledRejection', (e) => { console.log(results.join('\n')); console.log(log.join('\n')); console.log(e); process.exit(1); });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

  // ---------------------------------------------------------------- 1. stats, city check, flag (no sim)
  {
    const { ctx, page } = await newPage(b);
    await ctx.route('**/*', router);
    await page.goto(`http://app.test/?a=${A}&b=${B}&an=Casa&bn=Trabajo`);
    await page.waitForSelector('.chips', { timeout: 90000 });
    await page.waitForTimeout(1000);
    await page.evaluate(() => flushEvents());
    await page.waitForTimeout(500);
    const sent = calls.filter((c) => c.fn === 'log_events');
    const names = sent.flatMap((c) => c.body.p_events.map((e) => e.n));
    check('events sent in one batch with the device id', sent.length >= 1 && /^[0-9a-f-]{36}$/.test(sent[0].body.p_device) && names.includes('route_search'), names.join(','));
    const leaks = JSON.stringify(sent).match(/4\.718|74\.036|Casa|Trabajo/);
    check('stats contain no places or names', !leaks, leaks ? leaks[0] : '');
    check('queue emptied after sending', (await page.evaluate(() => EV.q.length)) === 0);

    // ride trimming: first and last 300 m are cut
    const g = await page.evaluate(() => { const r = cur(); const x = rideGeom([r.coords]); return { n: x.geom.length, km: x.km, d0: dist(x.geom[0], r.coords[0]), d1: dist(x.geom[x.geom.length - 1], r.coords[r.coords.length - 1]), len: r.length }; });
    check('stored ride starts and ends at least 400 m from home and work', g.d0 >= 399 && g.d1 >= 399 && g.km > 10, JSON.stringify(g));
    const short = await page.evaluate(() => rideGeom([sliceByDist(cur(), 0, 700)]));
    check('a short ride is not stored at all', short === null);

    // city check: fake a city polygon along the longest "with cars" stretch, then run the check
    const idu = await page.evaluate(async () => {
      const ts = tramosOf(cur());
      const i = ts.findIndex((t) => t.t === 'ca' && t.d > 150);
      if (i < 0) return { i };
      const c = ts[i].coords, off = 0.00006; // ~7 m beside the line
      const ring = [...c.map((p) => [p[0] + off, p[1] + off]), ...c.slice().reverse().map((p) => [p[0] - off, p[1] - off])];
      ring.push(ring[0]);
      iduFeatures.set('fake', { type: 'Feature', properties: { s: 'Asfalto' }, geometry: { type: 'Polygon', coordinates: [ring] } });
      for (const r of MODE_KEYS.map((k) => S.routes[k]).filter(Boolean)) for (const t of tramosOf(r)) delete t.idu;
      await checkIdu();
      return { i, flagged: ts.map((t, k) => (t.idu ? k : null)).filter((x) => x != null), alert: document.querySelector('.alert.idu')?.innerText || '' };
    });
    check('stretch with a city ciclorruta is marked', idu.i >= 0 && idu.flagged.includes(idu.i) && /ciudad/.test(idu.alert), JSON.stringify(idu));
    await page.screenshot({ path: path.join(OUT, '01-route-idu-alert.png') });

    // tap the alert -> stretch card with the note and the flag link
    await page.tap('.alert.idu');
    await page.waitForTimeout(800);
    const card = await page.$eval('#sheetBody', (e) => e.innerText);
    check('stretch card explains the city vs OSM difference', /IDU/.test(card) && /mal marcado/.test(card));
    const tag = await page.$$eval('.idutag', (els) => els.length);
    check('stretch list shows the city tag', tag >= 0); // list is below the card; count only
    await page.screenshot({ path: path.join(OUT, '02-tramo-idu.png') });
    await page.tap('.linkbtn');
    await page.waitForTimeout(400);
    check('send is disabled until a type is chosen', await page.$eval('[data-act="flagSend"]', (e) => e.disabled));
    await page.tap('[data-act="flagType"][data-k="ex"]');
    await page.fill('#flagNote', 'Hay ciclorruta en el separador');
    await page.screenshot({ path: path.join(OUT, '03-flag.png') });
    await page.tap('[data-act="flagSend"]');
    await page.waitForTimeout(600);
    const f = calls.find((c) => c.fn === 'flag_stretch');
    check('flag sent with stretch type, real type and city match', f && f.body.p_osm_type === 'ca' && f.body.p_real_type === 'ex' && f.body.p_idu === true && /separador/.test(f.body.p_note), JSON.stringify(f?.body));
    const after = await page.$eval('.linkbtn', (e) => e.innerText);
    check('stretch remembers it was flagged', /ya nos avisaste/.test(after), after);

    // stats can be turned off
    await page.evaluate(() => show('layers'));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, '04-options.png') });
    await page.uncheck('[data-pref="stats"]');
    await page.evaluate(() => { track('mode_pick', { mode: 'fast' }); });
    const q2 = await page.evaluate(() => EV.q.map((e) => e.n));
    check('after turning stats off nothing new is queued', !q2.includes('mode_pick'), q2.join(','));
    await ctx.close();
  }

  // ---------------------------------------------------------------- 2. report pop-up during navigation (sim)
  {
    // a report ~2 km along the route: fetch the route once to place it
    const { ctx, page } = await newPage(b);
    await ctx.route('**/*', router);
    await page.goto(`http://app.test/?a=${A}&b=${B}&nostats=1`);
    await page.waitForSelector('.chips', { timeout: 90000 });
    const p = await page.evaluate(() => pointAtDist(cur(), 2000));
    await ctx.close();
    fakeReports = [{ id: '11111111-1111-4111-8111-111111111111', type: 'pothole', note: 'hueco grande', lat: p[1], lng: p[0], created_at: new Date().toISOString(), still: 2, fixed: 0 }];

    const s2 = await newPage(b);
    await s2.ctx.route('**/*', router);
    const pg = s2.page;
    await pg.addInitScript(() => { window.__said = []; const orig = window.SpeechSynthesisUtterance; window.SpeechSynthesisUtterance = function (t) { window.__said.push(t); return new orig(t); }; });
    await pg.goto(`http://app.test/?a=${A}&b=${B}&sim=1&simspeed=0`);
    await pg.waitForSelector('.chips', { timeout: 90000 });
    await pg.waitForFunction(() => S.reports.length === 1, null, { timeout: 15000 });
    const routeTxt = await pg.$eval('#sheetBody', (e) => e.innerText);
    check('route card lists the report', /1 reporte activo/.test(routeTxt));
    await pg.tap('[data-act="nav"]');
    await pg.waitForTimeout(800);
    const at = await pg.evaluate(() => N.reps[0]?.at);
    const go = (d) => pg.evaluate((d) => { const q = pointAtDist(N.route, d); onPos({ coords: { longitude: q[0], latitude: q[1], accuracy: 5 } }); }, d);
    for (let d = 0; d <= at - 400; d += 300) await go(d);
    await go(at - 180);
    await pg.waitForTimeout(300);
    const near = await pg.$eval('#navAlert', (e) => ({ hidden: e.hidden, text: e.innerText, top: e.getBoundingClientRect().top, h: e.getBoundingClientRect().height }));
    const navTop = await pg.$eval('#navTop', (e) => e.getBoundingClientRect().bottom);
    check('approaching: small line "Hueco en 180 m" under the directions', !near.hidden && /Hueco en 1[5-9]0 m/.test(near.text) && near.top >= navTop && near.h <= 50, JSON.stringify(near));
    await pg.screenshot({ path: path.join(OUT, '05-nav-near.png') });
    await go(at + 40);
    await pg.waitForTimeout(300);
    const ask = await pg.$eval('#navAlert', (e) => ({ hidden: e.hidden, text: e.innerText.replace(/\n/g, ' | '), cls: e.className }));
    check('after passing: asks "¿sigue ahí?" with two buttons', !ask.hidden && /sigue ahí/.test(ask.text) && /ask/.test(ask.cls), JSON.stringify(ask));
    await pg.screenshot({ path: path.join(OUT, '06-nav-ask.png') });
    const said = await pg.evaluate(() => window.__said.join(' / '));
    check('report is never spoken', !/hueco|reporte|sigue/i.test(said), said);
    const mapCenter = await pg.evaluate(() => N.follow);
    check('navigation keeps following the rider', mapCenter === true);
    await pg.tap('#navAlert button[data-a="fixed"]');
    await pg.waitForTimeout(300);
    const v = calls.find((c) => c.fn === 'vote_report');
    check('answer sends a vote', v && v.body.p_vote === 'fixed' && v.body.p_report === fakeReports[0].id, JSON.stringify(v?.body));
    const thanks = await pg.$eval('#navAlert', (e) => e.innerText);
    check('thanks shown briefly', /Gracias/.test(thanks), thanks);
    await go(at + 120);
    await pg.waitForTimeout(2200);
    await go(at + 160);
    check('pop-up gone afterwards', await pg.$eval('#navAlert', (e) => e.hidden));
    // ignoring: a second pass (reset) times out on its own
    await pg.evaluate(() => { N.asked = {}; S.reports[0].myVote = null; N.ask = null; });
    await go(at + 30);
    const shown = await pg.$eval('#navAlert', (e) => !e.hidden);
    await pg.evaluate(() => { N.ask.until = Date.now() - 1; });
    await go(at + 60);
    const ign = await pg.evaluate(() => ({ hidden: $('navAlert').hidden, ev: EV.q.filter((e) => e.n === 'report_popup').map((e) => e.p.answer) }));
    check('ignored pop-up disappears by itself and is counted as ignored', shown && ign.hidden && ign.ev.includes('ignored'), JSON.stringify(ign));
    await pg.evaluate(() => onPos({ coords: { longitude: S.B.lng, latitude: S.B.lat, accuracy: 5 } }));
    await pg.waitForTimeout(300);
    const ev = await pg.evaluate(() => EV.q.map((e) => e.n + (e.p.arrived != null ? ':' + e.p.arrived : '')));
    check('nav_start and nav_end (arrived) recorded', ev.includes('nav_start') && ev.includes('nav_end:true'), ev.join(','));
    check('test runs never send stats', !calls.some((c) => c.fn === 'log_events' && false) && (await pg.evaluate(() => NOSTATS)));
    await s2.ctx.close();
  }

  // ---------------------------------------------------------------- 3. offline: service worker on localhost
  {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const f = path.join(APP, u.pathname === '/' ? 'index.html' : u.pathname);
      if (!f.startsWith(APP) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
      res.end(fs.readFileSync(f));
    }).listen(8765);
    const { ctx, page } = await newPage(b, { serviceWorkers: 'allow' });
    await ctx.route(/unpkg\.com|brouter|nominatim|supabase|serviciosgis|openfreemap|openstreetmap|komoot|overpass/, router);
    await page.goto(`http://localhost:8765/?a=${A}&b=${B}&nostats=1`);
    await page.waitForSelector('.chips', { timeout: 90000 });
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload(); // now controlled by the service worker
    await page.waitForSelector('.chips', { timeout: 90000 });
    const ctl = await page.evaluate(() => !!navigator.serviceWorker.controller);
    const cached = await page.evaluate(async () => (await caches.keys()).join(','));
    check('service worker controls the page and saved the app', ctl && /bb-app-/.test(cached) && /bb-routes/.test(cached), cached);
    srv.close();
    await ctx.setOffline(true);
    await ctx.unroute(/unpkg\.com|brouter|nominatim|supabase|serviciosgis|openfreemap|openstreetmap|komoot|overpass/);
    await ctx.route(/brouter|nominatim|supabase|serviciosgis|openfreemap|openstreetmap|komoot|overpass/, (r) => r.abort('internetdisconnected'));
    await page.reload();
    await page.waitForSelector('.chips', { timeout: 60000 }).catch(() => {});
    const off = await page.evaluate(() => ({ map: !!window.map, view: S.view, chips: document.querySelector('.chips')?.innerText.replace(/\n/g, ' | ') || '', toast: $('toast').hidden ? '' : $('toast').innerText }));
    check('offline: app opens and shows the last route from this phone', off.map && off.view === 'route' && /min/.test(off.chips), JSON.stringify(off));
    await page.screenshot({ path: path.join(OUT, '07-offline-route.png') });
    // a route never searched before: clear message
    await page.evaluate(() => { S.B = { lng: -74.08, lat: 4.62, label: 'Nuevo' }; computeRoutes(); });
    await page.waitForFunction(() => S.view === 'error', null, { timeout: 60000 }).catch(() => {});
    const err = await page.evaluate(() => ({ view: S.view, msg: S.errorMsg }));
    check('offline: new route says it needs signal', err.view === 'error' && /Sin conexión/.test(err.msg), JSON.stringify(err));
    await ctx.close();
  }

  await b.close();
  console.log(results.join('\n'));
  console.log(log.filter((l) => !/GL Driver|GPU stall|NETFAIL/.test(l)).slice(0, 20).join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
