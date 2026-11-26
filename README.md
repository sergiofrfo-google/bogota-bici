# Bogotá Bici

Planeador de rutas en bici para Bogotá, gratis y comunitario.

- Elige origen y destino y compara tres rutas: **más ciclorruta**, **equilibrada** y **más rápida** (más otras alternativas).
- **Navegación paso a paso** con GPS: próximo giro, voz en español, aviso de tramos con carros, recálculo si te sales de la ruta y pantalla siempre encendida.
- Tramos con nombre de calle; toca uno para verlo en el mapa y recórrelos con ‹ ›. También hay lista de indicaciones.
- Guarda tus rutas frecuentes, compártelas por enlace y ajusta tu ritmo (tranquilo, normal, rápido).
- Cada tramo se marca como ciclorruta exclusiva, compartida con peatones, carril pintado o con carros.
- Reporta huecos, cierres, conexiones faltantes, cruces peligrosos y zonas de robo, y confirma si "sigue ahí" o "ya está arreglado".
- **Pasar por**: escribe una calle (por ejemplo Avenida Boyacá) o mantén presionado el mapa para que la ruta pase por ahí; el punto se puede arrastrar.
- **Talleres y aire**: talleres, montallantas, bombas de aire y estaciones de reparación cerca de ti o a lo largo de tu ruta, con botón para parar ahí.
- Botón visible de **Reportar problema** en el mapa y durante la navegación.
- Español e inglés (según el idioma del teléfono, se cambia en Capas y opciones).
- Capa: red oficial de ciclorrutas (IDU).

## How it works

A static site: no build step, no server, no API keys. Open `index.html` through any static host (GitHub Pages).

| Need | Free service |
|---|---|
| Routing, path types, turn hints | [BRouter](https://brouter.de) (`safety`, `trekking` and `fastbike` profiles, OSM way tags, voice hints) |
| Street names for stretches and turns | Nominatim reverse geocoding (1 request per second) |
| Base map | OpenFreeMap, falling back to OpenStreetMap raster tiles |
| Place search | Photon and Nominatim |
| Official ciclorruta network | IDU via IDECA map server (CC BY 4.0) |
| Bike shops and pumps | OpenStreetMap via Overpass |

Reports are shared between all riders through a free Supabase project (`bogota-bici`). Riders need no account:
each phone keeps a random id that allows one vote per report and limits posting (10 reports and 60 votes per hour per phone,
300 reports per hour in total). The app can only call three database functions (`list_reports`, `add_report`, `vote_report`);
the tables themselves are closed. `supabase/schema.sql` is the exact setup. A report stays visible for 60 days after it was
posted or last confirmed "still there", and disappears once at least 3 riders say it is fixed and they outnumber "still there".
Without signal, reports and votes wait on the phone and are sent on the next sync. To hide an abusive report, set
`hidden = true` on its row in the Supabase table editor.

Open a route directly with `?a=lat,lng&b=lat,lng&an=Name&bn=Name&m=infra|balanced|fast`, plus `&v=lat,lng;lat,lng&vn=Name` for via points.
Add `&sim=1` to replay the route instead of using GPS when testing navigation at a desk.

`dev/shared-reports-test.cjs` checks sharing with two simulated phones and a fake server.
`dev/mobile-audit.cjs` runs a phone-sized Playwright check (sheet drag, route fitting, tramos, navigation, reroute, arrival, via street, places, report, English).

Map data © OpenStreetMap contributors.
