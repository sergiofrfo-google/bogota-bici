# Bogotá Bici

Planeador de rutas en bici para Bogotá, gratis y comunitario.

- Elige origen y destino y compara tres rutas: **más ciclorruta**, **equilibrada** y **más rápida** (más otras alternativas).
- **Navegación paso a paso** con GPS: próximo giro, voz en español, aviso de tramos con carros, recálculo si te sales de la ruta y pantalla siempre encendida.
- Tramos con nombre de calle; toca uno para verlo en el mapa y recórrelos con ‹ ›. También hay lista de indicaciones.
- Guarda tus rutas frecuentes, compártelas por enlace y ajusta tu ritmo (tranquilo, normal, rápido).
- Cada tramo se marca como ciclorruta exclusiva, compartida con peatones, carril pintado o con carros.
- Reporta huecos, cierres, conexiones faltantes, cruces peligrosos y zonas de robo, y confirma si "sigue ahí" o "ya está arreglado".
- Capas: red oficial de ciclorrutas (IDU), talleres y bombas de aire.

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

Reports are stored only in the browser (localStorage) for now. `supabase/schema.sql` is the planned shared backend.

Open a route directly with `?a=lat,lng&b=lat,lng&an=Name&bn=Name&m=infra|balanced|fast`.
Add `&sim=1` to replay the route instead of using GPS when testing navigation at a desk.

`dev/mobile-audit.cjs` runs a phone-sized Playwright check (sheet drag, route fitting, tramos, navigation, reroute, arrival).

Map data © OpenStreetMap contributors.
