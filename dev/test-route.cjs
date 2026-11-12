const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, 'app'), ML = path.join(__dirname, 'deps/node_modules/maplibre-gl/dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const log = [];
  page.on('console', (m) => log.push(m.type() + ': ' + m.text()));
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
    if (/openstreetmap\.org$|openfreemap\.org$/.test(u.host) && !u.host.startsWith('nominatim')) return route.fulfill({ status: 404, body: '' });
    try {
      const req = route.request();
      const r = await fetch(u, { method: req.method(), body: req.postData() || undefined, headers: { 'content-type': req.headers()['content-type'] || 'text/plain', 'user-agent': 'bogota-bici-test' } });
      const body = Buffer.from(await r.arrayBuffer());
      log.push(`NET ${r.status} ${u.host}${u.pathname.slice(0, 40)}`);
      return route.fulfill({ status: r.status, body, headers: { 'content-type': r.headers.get('content-type') || 'text/plain', 'access-control-allow-origin': '*' } });
    } catch (e) { log.push('NETFAIL ' + u.host + ' ' + e.message); return route.abort(); }
  });
  await page.goto('http://app.test/?a=4.7180065,-74.0368149&b=4.6636370,-74.1112144&an=Rincón de Antigua&bn=Gran Reserva de Mallorca');
  try { await page.waitForSelector('.tabs', { timeout: 60000 }); } catch (e) { await page.screenshot({ path: 'shot-fail.png' }); console.log(log.join('\n')); console.log(await page.$eval('body', (x) => x.innerText)); process.exit(1); }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'shot-route.png' });
  console.log(await page.$eval('#sheetBody', (e) => e.innerText));
  await page.click('[data-mode="fast"]'); await page.waitForTimeout(1200);
  await page.screenshot({ path: 'shot-fast.png' });
  console.log(await page.$eval('#sheetBody', (e) => e.innerText.slice(0, 300)));
  await page.click('[data-mode="infra"]'); await page.click('[data-act="steps"]'); await page.waitForTimeout(6000);
  await page.screenshot({ path: 'shot-steps.png' });
  console.log(await page.$eval('#sheetBody', (e) => e.innerText.slice(0, 900)));
  await page.click('[data-act="back"]'); await page.click('#reportFab'); await page.waitForTimeout(500);
  await page.click('[data-k="danger"]'); await page.fill('#note', 'Prueba'); await page.screenshot({ path: 'shot-report.png' });
  await page.click('[data-act="publish"]'); await page.waitForTimeout(800);
  await page.click('.pin.rep'); await page.waitForTimeout(800);
  await page.screenshot({ path: 'shot-reportview.png' });
  await page.click('[data-act="vote"][data-v="fixed"]').catch(() => log.push('vote disabled (own report)'));
  await page.click('#layersBtn'); await page.waitForTimeout(400);
  await page.check('[data-layer="services"]'); await page.waitForTimeout(6000);
  await page.screenshot({ path: 'shot-layers.png' });
  console.log('service pins', await page.$$eval('.pin.shop,.pin.air', (x) => x.length));
  console.log(log.filter((l) => !l.startsWith('NET 200')).slice(0, 40).join('\n'));
  console.log('net ok count', log.filter((l) => l.startsWith('NET 200')).length);
  await b.close();
})();
