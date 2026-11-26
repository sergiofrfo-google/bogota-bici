// Shared reports test: two "phones" (separate browsers) talk to a fake in-memory copy of the
// Supabase functions (list_reports / add_report / vote_report), so it runs without network.
// Phone A posts a report, phone B sees it and votes "fixed"; then phone A posts with no signal
// and the report goes out once the connection is back.
// Usage: node dev/shared-reports-test.cjs <maplibre-dist-dir>
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const APP = path.join(__dirname, '..');
const ML = process.argv[2];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const db = { reports: [], votes: [] };
let offline = false, voteLimit = false, loseAnswer = false;
const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
function rpc(fn, a) {
  if (fn === 'list_reports') return db.reports.map((r) => ({ ...r, device: undefined,
    still: db.votes.filter((v) => v.report_id === r.id && v.vote === 'still').length,
    fixed: db.votes.filter((v) => v.report_id === r.id && v.vote === 'fixed').length }));
  if (fn === 'add_report') {
    if (a.p_lat < 4.45 || a.p_lat > 4.85) return [400, { message: 'violates check constraint' }];
    const dup = db.reports.find((r) => r.client_id === a.p_client_id && r.device === a.p_device);
    if (dup) return dup.id;
    const id = crypto.randomUUID();
    db.reports.push({ id, type: a.p_type, note: a.p_note, lat: a.p_lat, lng: a.p_lng, created_at: new Date().toISOString(), device: a.p_device, client_id: a.p_client_id });
    db.votes.push({ report_id: id, device: a.p_device, vote: 'still' });
    return id;
  }
  if (fn === 'vote_report') {
    if (voteLimit) return [400, { message: 'rate_limited' }];
    if (!db.votes.some((v) => v.report_id === a.p_report && v.device === a.p_device)) db.votes.push({ report_id: a.p_report, device: a.p_device, vote: a.p_vote });
    return null;
  }
}
async function phone(b, name) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, locale: 'es-CO' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(name, 'PAGEERROR', e.message));
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.host === 'app.test') {
      const f = path.join(APP, u.pathname === '/' ? 'index.html' : u.pathname);
      return route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': types[path.extname(f)] } });
    }
    if (u.host === 'unpkg.com') return route.fulfill({ status: 200, body: fs.readFileSync(path.join(ML, path.basename(u.pathname))), headers: { 'content-type': 'text/javascript' } });
    if (u.host.endsWith('supabase.co')) {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*' } });
      if (offline) return route.abort('internetdisconnected');
      const fn = u.pathname.split('/').pop();
      const out = rpc(fn, JSON.parse(route.request().postData() || '{}'));
      if (loseAnswer) return route.abort('connectionreset'); // saved on the server, but the phone never hears back
      if (Array.isArray(out) && out[0] === 400) return route.fulfill({ status: 400, headers: cors, body: JSON.stringify(out[1]) });
      return route.fulfill({ status: out === null ? 204 : 200, headers: cors, body: out === null ? '' : JSON.stringify(out) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://app.test/');
  await page.waitForFunction(() => window.map && map.loaded && map.isStyleLoaded !== undefined, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  return page;
}
const pins = (p) => p.evaluate(() => document.querySelectorAll('.pin.rep').length);
let fails = 0;
const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) fails++; };

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const A = await phone(b, 'A');
  const B = await phone(b, 'B');
  check((await pins(A)) === 0 && (await pins(B)) === 0, 'both phones start with no reports');

  await A.evaluate(() => map.jumpTo({ center: [-74.05, 4.70], zoom: 16 }));
  await A.tap('#reportFab'); await A.waitForTimeout(400);
  check(/Todos los ciclistas verán tu reporte/.test(await A.textContent('#sheet')), 'report form says every rider will see it');
  await A.fill('#note', 'Hueco grande frente al semáforo');
  await A.tap('[data-act="publish"]'); await A.waitForTimeout(800);
  check(db.reports.length === 1 && db.reports[0].note === 'Hueco grande frente al semáforo', 'phone A report reached the server');
  check(/Todos los ciclistas lo verán/.test(await A.textContent('#toast')), 'phone A got the "posted" message');

  await B.evaluate(() => syncReports()); await B.waitForTimeout(600);
  check((await pins(B)) === 1, 'phone B shows phone A\'s report on the map');
  await B.evaluate(() => openReport(S.reports[0])); await B.waitForTimeout(400);
  check(/Hueco grande frente al semáforo/.test(await B.textContent('#sheet')), 'phone B sees the note');
  await B.tap('[data-act="vote"][data-v="fixed"]'); await B.waitForTimeout(600);
  check(db.votes.filter((v) => v.vote === 'fixed').length === 1, 'phone B "fixed" vote reached the server');
  await B.reload(); await B.waitForTimeout(2500);
  check(await B.evaluate(() => S.reports[0] && S.reports[0].myVote === 'fixed'), 'phone B still remembers its vote after reload');

  await A.evaluate(() => syncReports()); await A.waitForTimeout(600);
  check(await A.evaluate(() => S.reports[0].fixed === 1 && S.reports[0].still === 1 && S.reports[0].myVote === 'still'), 'phone A sees 1 still / 1 fixed and its own vote');

  offline = true;
  await A.evaluate(() => map.jumpTo({ center: [-74.08, 4.66], zoom: 16 }));
  await A.tap('#reportFab'); await A.waitForTimeout(400);
  await A.tap('[data-act="cat"][data-k="theft"]'); await A.tap('[data-act="publish"]'); await A.waitForTimeout(800);
  check(/Sin señal/.test(await A.textContent('#toast')) && db.reports.length === 1, 'with no signal the report waits on the phone');
  check((await pins(A)) === 2, 'phone A still shows its waiting report');
  offline = false;
  await A.evaluate(() => syncReports()); await A.waitForTimeout(800);
  check(db.reports.length === 2 && db.reports[1].type === 'theft', 'waiting report was sent when the signal came back');
  check(await A.evaluate(() => LS.get('bb_outbox', []).length === 0 && S.reports.length === 2 && !S.reports.some((r) => r.pending)), 'nothing left waiting and no duplicates');

  await B.evaluate(() => syncReports()); await B.waitForTimeout(600);
  check((await pins(B)) === 2, 'phone B now shows both reports');

  // the server saves the report but the answer is lost: retrying must not make a second copy
  loseAnswer = true;
  await A.evaluate(() => map.jumpTo({ center: [-74.06, 4.68], zoom: 16 }));
  await A.tap('#reportFab'); await A.waitForTimeout(400);
  await A.tap('[data-act="cat"][data-k="closure"]'); await A.tap('[data-act="publish"]'); await A.waitForTimeout(800);
  loseAnswer = false;
  check(db.reports.length === 3, 'lost answer: report was saved once on the server');
  await A.evaluate(() => syncReports()); await A.waitForTimeout(800);
  check(db.reports.length === 3 && await A.evaluate(() => S.reports.length === 3), 'retry after a lost answer makes no duplicate');

  // too many votes: the vote is undone on the phone so it can be tried again later
  voteLimit = true;
  await B.evaluate(() => syncReports()); await B.waitForTimeout(600);
  await B.evaluate(() => openReport(S.reports.find((r) => r.type === 'closure'))); await B.waitForTimeout(300);
  await B.tap('[data-act="vote"][data-v="still"]'); await B.waitForTimeout(600);
  check(await B.evaluate(() => { const r = S.reports.find((x) => x.type === 'closure'); return r.myVote === null && r.still === 1; }), 'refused vote is undone on the phone');
  check(/muchas veces/.test(await B.textContent('#toast')), 'rider is told to try later');
  voteLimit = false;

  // a report older than 60 days that the server still lists (recently confirmed) stays on the map
  db.reports[0].created_at = new Date(Date.now() - 90 * 864e5).toISOString();
  await B.evaluate(() => syncReports()); await B.waitForTimeout(600);
  check((await pins(B)) === 3, 'old but recently confirmed report stays visible');
  await b.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
