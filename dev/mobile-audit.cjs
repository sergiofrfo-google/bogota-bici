// Mobile audit: loads the app at a phone viewport with touch, opens Sergio's daily route,
// drags the bottom sheet, opens tramos, selects a stretch and runs simulated navigation.
// Usage: node dev/mobile-audit.cjs <maplibre-dist-dir> <out-dir>
// The app is served from this repo; the MapLibre bundle from a local npm install.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '..');
const ML = process.argv[2];
const OUT = process.argv[3] || '/tmp/audit';
fs.mkdirSync(OUT, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const W = 412, H = 915;
const report = [], log = [];

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'es-CO', timezoneId: 'America/Bogota' });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() !== 'log') log.push(m.type() + ': ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => log.push('PAGEERROR ' + e.message));
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.host === 'app.test') {
      const f = path.join(APP, u.pathname === '/' ? 'index.html' : u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: 'nf' });
      return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': types[path.extname(f)] || 'application/octet-stream' } });
    }
    if (u.host === 'unpkg.com') {
      const f = path.join(ML, path.basename(u.pathname));
      return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': types[path.extname(f)] } });
    }
    if (/openstreetmap\.org$|openfreemap\.org$|komoot\.io$|overpass/.test(u.host) && !u.host.startsWith('nominatim')) return route.fulfill({ status: 404, body: '' });
    try {
      const req = route.request();
      const r = await fetch(u, { method: req.method(), body: req.postData() || undefined, headers: { 'user-agent': 'bogota-bici-test' } });
      const body = Buffer.from(await r.arrayBuffer());
      return route.fulfill({ status: r.status, body, headers: { 'content-type': r.headers.get('content-type') || 'text/plain', 'access-control-allow-origin': '*' } });
    } catch (e) { log.push('NETFAIL ' + u.host + ' ' + e.message); return route.abort(); }
  });
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  async function drag(x, y0, y1, steps = 8) {
    await touch('touchStart', x, y0);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', x, y0 + ((y1 - y0) * i) / steps); await page.waitForTimeout(16); }
    await touch('touchEnd');
    await page.waitForTimeout(500);
  }
  const shot = async (n) => { await page.screenshot({ path: path.join(OUT, n + '.png') }); };
  const sheetH = () => page.$eval('#sheet', (e) => Math.round(e.getBoundingClientRect().height));
  const check = (name, ok, extra = '') => report.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

  const url = 'http://app.test/?a=4.7180065,-74.0368149&b=4.6636370,-74.1112144&an=Rincón de Antigua&bn=Gran Reserva de Mallorca' + '&sim=1&simspeed=' + (process.env.SIM || 0);
  await page.goto(url);
  await page.waitForSelector('.chips', { timeout: 90000 });
  await page.waitForTimeout(1500);
  await shot('01-route-peek');

  // no horizontal overflow
  const ow = await page.evaluate(() => document.documentElement.scrollWidth);
  check('no horizontal scroll', ow <= W, `scrollWidth ${ow}`);
  // headline on one line
  const big = await page.$eval('.big', (e) => e.getBoundingClientRect().height);
  check('time headline on one line', big < 40, `height ${big}`);
  const chipsTxt = await page.$eval('.chips', (e) => e.innerText.replace(/\n/g, ' | '));
  report.push('chips: ' + chipsTxt);
  // route fits above the sheet: project the route bounds and compare with visible area
  const fit = await page.evaluate(() => {
    const r = cur(); const top = $('search').getBoundingClientRect().bottom; const sh = $('sheet').getBoundingClientRect().top;
    let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9;
    for (const c of r.coords) { const p = map.project(c); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); }
    return { top, sh, minY, maxY, minX, maxX };
  });
  check('route fully visible between search and sheet (peek)', fit.minY >= fit.top && fit.maxY <= fit.sh && fit.minX >= 0 && fit.maxX <= W, JSON.stringify(fit));
  const peekH = await sheetH();
  report.push(`sheet peek height ${peekH}px of ${H}`);

  // drag sheet up -> half -> full
  await drag(200, H - peekH + 10, H - peekH - 300);
  await page.waitForTimeout(400);
  const afterUp = await sheetH();
  check('drag up expands sheet', afterUp > peekH + 100, `${peekH} -> ${afterUp} (${await page.$eval('#sheet', (e) => e.dataset.snap)})`);
  await shot('02-route-expanded');
  await drag(200, H - afterUp + 10, H - 100);
  await page.waitForTimeout(400);
  const afterDown = await sheetH();
  check('drag down collapses sheet', afterDown < afterUp - 100, `${afterUp} -> ${afterDown}`);
  // refit after collapse
  await page.waitForTimeout(900);

  // modes
  for (const k of ['balanced', 'fast', 'infra']) {
    await page.tap(`.chips [data-mode="${k}"]`); await page.waitForTimeout(900);
  }
  await shot('03-route-infra');

  // tramos
  await page.tap('[data-act="steps"]');
  await page.waitForTimeout(800);
  await shot('04-tramos-half');
  report.push('tramos sheet ' + (await sheetH()) + 'px');
  await page.waitForTimeout(16000);
  const names = await page.$$eval('.steps .nm', (els) => els.map((e) => e.textContent));
  report.push('tramo names: ' + names.join(' | '));
  check('no "Tramo N" placeholder names', !names.some((n) => /^Tramo \d+$/.test(n)));
  // select the longest stretch
  const longest = await page.evaluate(() => { const ts = tramosOf(cur()); let bi = 0; ts.forEach((s, i) => { if (s.d > ts[bi].d) bi = i; }); return bi; });
  await page.evaluate(() => { $('sheetBody').scrollTop = 0; });
  await drag(200, H - (await sheetH()) + 10, H - (await sheetH()) - 400); // expand to see the list
  await page.waitForTimeout(300);
  const rowSel = `.steps [data-act="selTramo"][data-i="${longest}"]`;
  await page.$eval(rowSel, (e) => e.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await page.tap(rowSel);
  await page.waitForTimeout(1500);
  await shot('05-tramo-selected');
  const sel = await page.evaluate((i) => {
    const s = tramosOf(cur())[i]; const top = $('search').getBoundingClientRect().bottom; const sh = $('sheet').getBoundingClientRect().top;
    let minY = 1e9, maxY = -1e9; for (const c of s.coords) { const p = map.project(c); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    return { top, sh, minY, maxY, h: $('sheet').offsetHeight, card: $('sheetBody').querySelector('.selcard')?.innerText };
  }, longest);
  check('selected stretch visible above the sheet', sel.minY >= sel.top - 2 && sel.maxY <= sel.sh + 2, JSON.stringify(sel));
  // step to next stretch
  await page.tap('.selcard [aria-label="Tramo siguiente"]');
  await page.waitForTimeout(1200);
  await shot('06-tramo-next');
  // indicaciones
  await page.tap('[data-act="tab"][data-tab="turns"]');
  await page.waitForTimeout(8000);
  await shot('07-indicaciones');
  const turns = await page.$$eval('.turns .steprow', (els) => els.slice(0, 12).map((e) => e.innerText.replace(/\n/g, ' ')));
  report.push('first turns: ' + turns.join(' || '));
  await page.tap('[data-act="back"]');
  await page.waitForTimeout(800);

  // layers & options
  await page.tap('#layersBtn'); await page.waitForTimeout(600); await shot('08-options');
  await page.tap('[data-act="pace"][data-k="calm"]'); await page.waitForTimeout(300);
  await page.tap('[data-act="close"]'); await page.waitForTimeout(600);
  report.push('chips after calm pace: ' + (await page.$eval('.chips', (e) => e.innerText.replace(/\n/g, ' | '))));

  // report flow: pin must be visible above the sheet
  await page.tap('#reportFab'); await page.waitForTimeout(700);
  const pin = await page.evaluate(() => ({ pin: $('placePin').getBoundingClientRect().top, sheet: $('sheet').getBoundingClientRect().top, search: $('search').getBoundingClientRect().bottom }));
  check('report pin visible between search and sheet', pin.pin > pin.search && pin.pin + 52 < pin.sheet, JSON.stringify(pin));
  await shot('09-report');
  await page.tap('[data-act="cancelReport"]'); await page.waitForTimeout(600);

  // navigation (simulated positions)
  await page.evaluate(() => { window.__said = []; const o = speak; window.speak = (t) => { window.__said.push(t); }; });
  await page.tap('[data-act="nav"]');
  await page.waitForTimeout(1500);
  const offset = (lng, lat) => page.evaluate(([lng, lat]) => onPos({ coords: { longitude: lng, latitude: lat, accuracy: 8, speed: 5, heading: null } }), [lng, lat]);
  // feed positions along the route
  const pts = await page.evaluate(() => [100, 160, 220, 600, 1500, 2100].map((d) => pointAtDist(N.route, d)));
  for (const p of pts) { await offset(p[0], p[1]); await page.waitForTimeout(1100); }
  await shot('10-nav');
  const navTxt = await page.evaluate(() => ({ top: $('navTop').innerText.replace(/\n/g, ' | '), type: $('navType').innerText, bottom: $('navTime').innerText + ' ' + $('navRest').innerText, said: N.said }));
  report.push('nav: ' + JSON.stringify(navTxt));
  check('nav banner shows a maneuver', /\d/.test(navTxt.top) && navTxt.top.length > 8);
  // go off route 3 times -> reroute
  const off = await page.evaluate(() => { const p = pointAtDist(N.route, 2100); return [p[0] + 0.004, p[1] + 0.003]; });
  const before = await page.evaluate(() => N.route.id);
  for (let i = 0; i < 3; i++) { await offset(off[0], off[1]); await page.waitForTimeout(300); }
  await page.waitForTimeout(8000);
  const after = await page.evaluate(() => N.route.id);
  check('off-route triggers reroute', after !== before, `${before} -> ${after}`);
  await shot('11-nav-rerouted');
  // overview + recenter
  await page.tap('#navOverview'); await page.waitForTimeout(900); await shot('12-nav-overview');
  check('recenter shown after overview', await page.$eval('#navRecenter', (e) => !e.hidden));
  // arrive
  await page.evaluate(() => onPos({ coords: { longitude: S.B.lng, latitude: S.B.lat, accuracy: 5 } }));
  await page.waitForTimeout(1200);
  check('arrival ends navigation', await page.evaluate(() => !N.on && S.view === 'arrived'));
  await shot('13-arrived');
  report.push('said: ' + JSON.stringify(await page.evaluate(() => window.__said)));

  // save + home
  await page.tap('[data-act="backRoute"]'); await page.waitForTimeout(800);
  await page.evaluate(() => { const b = document.querySelector('.tools [data-act="save"]'); b.scrollIntoView(); });
  await page.tap('.tools [data-act="save"]'); await page.waitForTimeout(300);
  await page.$eval('#sheetBody', (e) => { e.scrollTop = 1e5; });
  await page.evaluate(() => document.querySelector('.tools [data-act="clear"]').click()); await page.waitForTimeout(800);
  check('home shows saved route', await page.evaluate(() => S.view === 'home' && !!document.querySelector('.savedgo')));
  await shot('14-home');

  report.push(...log.filter((l) => !/Failed to load resource|404/.test(l)).slice(0, 30));
  console.log(report.join('\n'));
  await b.close();
})().catch((e) => { console.log(report.join('\n')); console.log(log.filter((l) => !/404|GL Driver/.test(l)).slice(0, 30).join('\n')); console.error(String(e).slice(0, 400)); process.exit(1); });
