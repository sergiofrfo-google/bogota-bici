// Snapshot of places for cyclists in Bogotá from OpenStreetMap (via Overpass), saved to data/places.json.
// The app reads this file instead of asking Overpass on every search: the free public Overpass servers are
// often overloaded and can take a minute or refuse, which left "Talleres y aire" empty.
// Run: node scripts/fetch-places.mjs   (a GitHub Action runs it every week, see .github/workflows/places.yml)
import { writeFileSync } from 'node:fs';

const BBOX = '4.45,-74.25,4.85,-73.98'; // Bogotá and the next towns (Chía, Soacha, Funza, Mosquera, La Calera)
const Q = `[out:json][timeout:180][bbox:${BBOX}];(nwr[shop~"^(bicycle|tyres)$"];nwr[amenity~"^(bicycle_repair_station|compressed_air)$"];nwr["service:bicycle:repair"="yes"];nwr["service:bicycle:pump"="yes"];nwr[craft=tyre];);out center tags;`;
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const KEEP = ['name', 'shop', 'amenity', 'craft', 'service:bicycle:repair', 'service:bicycle:pump', 'pump',
  'opening_hours', 'phone', 'contact:phone', 'addr:street', 'addr:housenumber'];
const MIN = 100; // fewer than this means a broken answer: keep the old file

async function get() {
  for (let round = 0; round < 4; round++) {
    for (const u of SERVERS) {
      try {
        const r = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(Q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'bogota-bici places snapshot (github.com/sergiofrfo-google/bogota-bici)' }, signal: AbortSignal.timeout(200000) });
        console.log(u, r.status);
        if (!r.ok) continue;
        const j = await r.json();
        if ((j.elements || []).length >= MIN) return j;
        console.log('  too few elements:', (j.elements || []).length, j.remark || '');
      } catch (e) { console.log(u, 'error', e.message); }
    }
    await new Promise((ok) => setTimeout(ok, 60000));
  }
  throw new Error('No Overpass server answered');
}

const j = await get();
const seen = new Set();
const elements = [];
for (const e of j.elements) {
  const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
  if (lat == null || seen.has(e.type + e.id)) continue;
  seen.add(e.type + e.id);
  const tags = {};
  for (const k of KEEP) if (e.tags?.[k]) tags[k] = e.tags[k];
  elements.push({ type: e.type, id: e.id, lat: +lat.toFixed(6), lon: +lon.toFixed(6), tags });
}
elements.sort((a, b) => (a.type + a.id).localeCompare(b.type + b.id));
const out = { generated: j.osm3s?.timestamp_osm_base || new Date().toISOString(), source: 'OpenStreetMap contributors (ODbL), via Overpass API', elements };
writeFileSync(new URL('../data/places.json', import.meta.url), JSON.stringify(out) + '\n');
console.log('saved', elements.length, 'places, OSM data from', out.generated);
