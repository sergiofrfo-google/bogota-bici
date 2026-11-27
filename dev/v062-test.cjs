// v0.6.2 checks: the Fastest card is never slower than the others, and starting from the current location.
// (header kept from v0.6) v0.6 checks: report pop-up during navigation (silent), "this stretch is wrong" flag, city-vs-OSM check,
// anonymous stats batching, ride trimming (400 m around start and end), and the offline app (service worker + saved routes).
// Usage: node dev/v06-test.cjs <maplibre-dist-dir> <out-dir>
// Supabase and the city map server are faked; BRouter and Nominatim answers are recorded and replayed.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.join(__dirname, '..');
const ML = process.argv[2];
const OUT = process.argv[3] || '/tmp/v062';
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


const NOVIOS = '4.6560,-74.0800'; // Sergio's case: Fastest (fastbike) was 2 min slower than Most bike lanes
const HOME = { latitude: 4.7180065, longitude: -74.0368149 };
(async () => {
  process.on('unhandledRejection', (e) => { console.log(results.join('\n')); console.log(log.join('\n')); console.log(e); process.exit(1); });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

  // ---------------------------------------------------------------- 1. Fastest is the quickest card
  for (const [name, dest] of [['Parque de los Novios', NOVIOS], ['daily route', B]]) {
    const { ctx, page } = await newPage(b);
    await ctx.route('**/*', router);
    await page.goto(`https://app.test/?a=${A}&b=${dest}&nostats=1`);
    await page.waitForSelector('.chips', { timeout: 90000 });
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => Object.fromEntries(MODE_KEYS.map((k) => [k, S.routes[k] && { t: S.routes[k].time, km: +(S.routes[k].length / 1000).toFixed(1), car: S.routes[k].noCars, src: S.routes[k].src }])));
    const cards = await page.$$eval('.chips button b', (els) => els.map((e) => e.textContent));
    const ok = r.fast.t <= r.infra.t && r.fast.t <= r.balanced.t;
    check(`${name}: Fastest is not slower than the others`, ok, JSON.stringify(r) + ' cards ' + cards.join(' / '));
    check(`${name}: Most bike lanes has the highest car-free share`, r.infra.car >= r.fast.car && r.infra.car >= r.balanced.car);
    if (name === 'Parque de los Novios') await page.screenshot({ path: path.join(OUT, '01-novios-cards.png') });
    await ctx.close();
  }

  // ---------------------------------------------------------------- 2. location already allowed: A starts at my location
  {
    const { ctx, page } = await newPage(b, { permissions: ['geolocation'], geolocation: HOME });
    await ctx.route('**/*', router);
    await page.goto('https://app.test/?nostats=1');
    await page.waitForFunction(() => S.A, null, { timeout: 60000 }).catch(() => {});
    const a = await page.evaluate(() => S.A && { ...S.A, v: document.getElementById('from').value });
    check('location allowed: origin is filled with my location on open', a && a.v === 'Mi ubicación' && Math.abs(a.lat - 4.7180065) < 1e-6, JSON.stringify(a));
    await page.screenshot({ path: path.join(OUT, '02-start-here.png') });
    await ctx.close();
  }

  // ---------------------------------------------------------------- 3. not yet allowed: nothing on open, "Mi ubicación" row on the origin field
  {
    const { ctx, page } = await newPage(b);
    await ctx.route('**/*', router);
    await page.goto('https://app.test/?nostats=1');
    await page.waitForFunction(() => window.map && map.loaded(), null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
    check('location not allowed: origin stays empty, no prompt on open', !(await page.evaluate(() => S.A)));
    await page.tap('#from');
    await page.waitForTimeout(300);
    const row = await page.$('#suggest:not([hidden]) button[data-i="gps"]');
    check('tapping the origin field offers "Mi ubicación"', !!row);
    await page.screenshot({ path: path.join(OUT, '03-origin-row.png') });
    await page.fill('#from', 'Parque');
    await page.waitForTimeout(200);
    check('"Mi ubicación" stays on top while typing', !!(await page.$('#suggest:not([hidden]) li:first-child button[data-i="gps"]')));
    await ctx.grantPermissions(['geolocation']); await ctx.setGeolocation(HOME);
    await page.tap('#suggest button[data-i="gps"]');
    await page.waitForFunction(() => S.A, null, { timeout: 20000 }).catch(() => {});
    check('picking it sets the origin to my location', (await page.evaluate(() => document.getElementById('from').value)) === 'Mi ubicación');
    await page.tap('#to');
    await page.waitForTimeout(300);
    check('destination field does not offer it', !(await page.$('#suggest:not([hidden]) button[data-i="gps"]')));
    await ctx.close();
  }

  // ---------------------------------------------------------------- 4. blocked: clear message
  {
    const { ctx, page } = await newPage(b);
    await ctx.route('**/*', router);
    await page.goto('https://app.test/?nostats=1');
    await page.waitForTimeout(2500);
    await page.tap('#gps');
    await page.waitForTimeout(1500);
    const t = await page.evaluate(() => document.getElementById('toast')?.textContent || '');
    check('blocked location explains how to turn it on', /Bloqueaste|No pude/.test(t), t);
    await ctx.close();
  }

  await b.close();
  console.log(results.join('\n'));
  if (log.length) console.log('\n' + log.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
